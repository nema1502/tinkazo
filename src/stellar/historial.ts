import { HORIZON_URLS, type NetworkName } from "./config";
import { type ContratoOficial, contratosOficiales, passphraseDe } from "./oficiales";

/**
 * El sello de un sorteo, leído del historial de transacciones de Stellar.
 *
 * El estado del contrato (`registro.ts`) vence: 7 días en testnet y 120 en
 * mainnet, y mantenerlo vivo cuesta renta. La transacción que selló la lista, en
 * cambio, sigue en el historial de la red sin renta, y lo que dura lo decide
 * quien lo guarda: el Horizon público de mainnet guarda unos 413 días (una
 * ventana móvil, y la SDF lo describe cerca del fin de su vida) y el de testnet
 * se borra entero el 16 de diciembre de 2026. Con el hash de esa transacción
 * (`stx` del comprobante) se lee de Horizon, se decodifica lo que se mandó al
 * contrato y de ahí salen la huella de la lista, la cantidad, los ganadores, la
 * ronda y la hora del sello: lo mismo que guardaba el estado, salvo el número del
 * sorteo, que lo devuelve el contrato y no viaja en la transacción.
 *
 * Qué se le cree a Horizon y qué no:
 * - El contenido de la transacción no se le cree: se decodifica el sobre
 *   (`envelope_xdr`), se calcula su hash con la passphrase de la red y tiene que
 *   ser el pedido. Un sobre cualquiera no puede pasar por el de otra transacción.
 * - Que la transacción entró, que salió bien, en qué ledger y a qué hora cerró
 *   ese ledger sí se lo cree: es una sola fuente, igual que el RPC en
 *   `registro.ts`. Lo dice docs/amenazas.md.
 *
 * El SDK de Stellar se pide recién acá adentro, con `import()`: las páginas no lo
 * bajan al abrirse.
 */

type Fetch = typeof fetch;

/**
 * Por qué no se pudo tomar un sello del historial:
 * - `no-encontrada`: Horizon no conoce esa transacción. No dice por qué: puede no haber existido nunca
 *   (hash inventado, red equivocada) o que esa fuente ya no la guarde (una ventana que avanza, una red
 *   reiniciada). Por eso nunca se toma como que el sorteo no existe.
 * - `fuera-de-ventana`: Horizon contestó 410 (`before_history`): lo pedido es más antiguo de lo que esa
 *   fuente guarda. No quiere decir que la transacción no exista.
 * - `fallida`: existe, pero la red la rechazó: no selló nada.
 * - `no-es-un-sello`: no es una llamada a `seal`.
 * - `contrato-ajeno`: el contrato no es uno de los oficiales de esa red, o es un anterior y la
 *   transacción es posterior a su último sello oficial (`retirado`), o no tiene ese tope (`sinTope`).
 * - `red-caida`: no se pudo hablar con Horizon (corte, tiempo agotado, límite de pedidos o error del servidor).
 * - `respuesta-invalida`: Horizon contestó algo que no es la transacción pedida.
 *
 * Solo `fallida`, `no-es-un-sello` y `contrato-ajeno` son una contradicción: se leyó la transacción y no
 * es un sello oficial. Los demás no dicen nada del sorteo.
 */
export type ErrorDelHistorial =
  | "no-encontrada"
  | "fuera-de-ventana"
  | "fallida"
  | "no-es-un-sello"
  | "contrato-ajeno"
  | "red-caida"
  | "respuesta-invalida";

/** Lo que se mandó a `seal`, más cuándo y en qué ledger quedó. */
export interface SelloDelHistorial {
  /** El hash pedido, en minúsculas: el de la transacción, o el de la interior si un fee-bump la envolvió. */
  hash: string;
  /**
   * El hash de la transacción interior, calculado del sobre: el mismo para quien cita el hash de afuera
   * de un fee-bump y para quien cita el de adentro. Es el que identifica el sello; `hash` es solo cómo se lo pidió.
   */
  hashInterior: string;
  /** El contrato al que se llamó. */
  contractId: string;
  organizer: string;
  /** Huella de la lista, en hex y en minúsculas. */
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  meta: string;
  /** Cuándo cerró el ledger de la transacción (Unix, segundos): es el `sealed_at` del contrato. */
  closedAt: number;
  /** El ledger de la transacción: es el `sealed_ledger` del contrato. */
  ledger: number;
}

export type LecturaDelHistorial =
  | { ok: true; sello: SelloDelHistorial }
  | {
      ok: false;
      error: ErrorDelHistorial;
      /** Con `contrato-ajeno`: es un contrato anterior y la transacción es posterior a su último sello oficial. */
      retirado?: boolean;
      /** Con `contrato-ajeno`: es un contrato anterior al que le falta `ultimoLedger`: por historial no se acepta. */
      sinTope?: boolean;
    };

export interface OpcionesDelHistorial {
  /** Para las pruebas: otro `fetch`. */
  fetch?: Fetch;
  /** Para las pruebas: otra dirección de Horizon. */
  horizon?: string;
  /** Para las pruebas: otra lista de contratos oficiales. */
  contratos?: readonly ContratoOficial[];
  /** Cuánto se espera cada intento (8 s). */
  tiempoMs?: number;
  /** Lo más que se acepta de una respuesta, en bytes (256 KB: una transacción de sello pesa unos 4). */
  maxBytes?: number;
  /** Cuántas veces se pregunta antes de decir que no se pudo (2). */
  intentos?: number;
  /** Cuánto se espera entre un intento y el siguiente (700 ms, creciente). */
  esperaMs?: number;
}

const TIEMPO_MS = 8_000;
const MAX_BYTES = 256 * 1024;
const INTENTOS = 2;
const ESPERA_MS = 700;

const ES_HASH = /^[0-9a-f]{64}$/;
const ES_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

const fallo = (error: ErrorDelHistorial, extra: { retirado?: boolean; sinTope?: boolean } = {}): LecturaDelHistorial => ({
  ok: false,
  error,
  ...extra,
});

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/* --------------------------------------------------------------------- la red */

type Pedido = { tipo: "ok"; texto: string } | { tipo: "no-encontrada" | "fuera-de-ventana" | "red-caida" | "respuesta-invalida" };

/**
 * Corre `hacer` con un tiempo límite: al vencer, corta el pedido y falla,
 * aunque quien contesta (en las pruebas, un `fetch` falso) no escuche la señal.
 */
async function conEspera<T>(ms: number, hacer: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const vence = new Promise<never>((_, rechazar) => {
    ctl.signal.addEventListener("abort", () => rechazar(new Error("historial-espera")), { once: true });
  });
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await Promise.race([hacer(ctl.signal), vence]);
  } finally {
    clearTimeout(t);
  }
}

/** El cuerpo de la respuesta como texto, o `null` si pasa de `max` bytes (se deja de leer apenas pasa). */
async function leerAcotado(res: Response, max: number): Promise<string | null> {
  const declarado = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declarado) && declarado > max) {
    void res.body?.cancel().catch(() => undefined);
    return null;
  }
  const lector = res.body?.getReader();
  if (!lector) {
    const texto = await res.text();
    return texto.length > max ? null : texto;
  }
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      void lector.cancel().catch(() => undefined);
      return null;
    }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let en = 0;
  for (const t of trozos) {
    todo.set(t, en);
    en += t.length;
  }
  return new TextDecoder().decode(todo);
}

/** Un pedido a Horizon, con reintentos para lo que es de la red y no del hash. */
async function traer(url: string, op: OpcionesDelHistorial): Promise<Pedido> {
  const f = op.fetch ?? fetch;
  const intentos = Math.max(1, op.intentos ?? INTENTOS);
  const esperaMs = op.esperaMs ?? ESPERA_MS;
  const max = op.maxBytes ?? MAX_BYTES;
  for (let i = 0; i < intentos; i++) {
    if (i) await new Promise((r) => setTimeout(r, esperaMs * i));
    try {
      const res = await conEspera(op.tiempoMs ?? TIEMPO_MS, async (signal) => {
        // Sin encabezados propios: así el pedido es "simple" y el navegador no hace la consulta previa de CORS.
        const r = await f(url, { signal });
        if (r.status === 404) return { tipo: "no-encontrada" } as const;
        // 410 es la ventana de historia de Horizon (`before_history`): lo pedido es más antiguo de lo que guarda.
        // No depende de la red ni se arregla preguntando de nuevo, y tampoco dice que la transacción no exista.
        if (r.status === 410) {
          void r.body?.cancel().catch(() => undefined);
          return { tipo: "fuera-de-ventana" } as const;
        }
        // Lo que no depende de qué hash se pidió se vuelve a intentar: el límite de pedidos, un 5xx, un corte.
        if (r.status === 408 || r.status === 429 || r.status >= 500) {
          void r.body?.cancel().catch(() => undefined);
          return null;
        }
        if (!r.ok) return { tipo: "respuesta-invalida" } as const;
        const texto = await leerAcotado(r, max);
        return texto === null ? ({ tipo: "respuesta-invalida" } as const) : ({ tipo: "ok", texto } as const);
      });
      if (res) return res;
    } catch {
      /* un corte o un tiempo agotado: se vuelve a preguntar */
    }
  }
  return { tipo: "red-caida" };
}

/* ------------------------------------------------------------------- la lectura */

/**
 * El sello de la transacción `hash` en `red`, leído de su historial. Nunca lanza.
 *
 * Solo devuelve `ok` si Horizon dice que la transacción salió bien, si su sobre
 * tiene el hash pedido (el suyo, o el de la transacción interior si un fee-bump
 * la envolvió: así la devuelve Horizon cuando se la pide por ese hash), si es una
 * llamada a `seal` de un contrato oficial de esa red y, en un contrato anterior,
 * si cayó en un ledger que no pasa de su último sello oficial (`ultimoLedger`).
 */
export async function leerHistorial(red: NetworkName, hash: string, op: OpcionesDelHistorial = {}): Promise<LecturaDelHistorial> {
  // Lo que no es un hash de transacción no se pregunta: no existe.
  if (!ES_HASH.test(hash)) return fallo("no-encontrada");
  const base = op.horizon ?? (HORIZON_URLS as Record<string, string | undefined>)[red];
  if (!base) return fallo("contrato-ajeno");

  const pedido = await traer(`${base}/transactions/${hash}`, op);
  if (pedido.tipo !== "ok") return fallo(pedido.tipo);

  let rec: unknown;
  try {
    rec = JSON.parse(pedido.texto);
  } catch {
    return fallo("respuesta-invalida");
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return fallo("respuesta-invalida");
  const r = rec as Record<string, unknown>;
  // La hora tal como la da Horizon (ISO 8601 en UTC): lo que `Date.parse` aceptaría de más ("1", una zona, un año de seis cifras) no se toma.
  const cerrado = typeof r.created_at === "string" && ES_HORA.test(r.created_at) ? Math.floor(Date.parse(r.created_at) / 1000) : NaN;
  if (
    typeof r.envelope_xdr !== "string" ||
    !r.envelope_xdr ||
    typeof r.successful !== "boolean" ||
    typeof r.ledger !== "number" ||
    !Number.isSafeInteger(r.ledger) ||
    r.ledger <= 0 ||
    !Number.isSafeInteger(cerrado) ||
    cerrado <= 0
  ) {
    return fallo("respuesta-invalida");
  }

  // Desestructurado, como en `registro.ts`: así el empaquetador se queda con las tres piezas que se usan
  // y no con el SDK entero (con el módulo guardado en una variable, el trozo del SDK crece 158 kB).
  let sdk: Pick<typeof import("@stellar/stellar-sdk"), "TransactionBuilder" | "Address" | "scValToNative">;
  try {
    const { TransactionBuilder, Address, scValToNative } = await import("@stellar/stellar-sdk");
    sdk = { TransactionBuilder, Address, scValToNative };
  } catch {
    return fallo("red-caida");
  }

  try {
    // Lo que importa es el sobre, no lo que Horizon diga de él.
    const tx = sdk.TransactionBuilder.fromXDR(r.envelope_xdr, passphraseDe(red));
    const interior = "innerTransaction" in tx ? tx.innerTransaction : tx;
    const hashes = [hex(tx.hash()), hex(interior.hash())];
    if (!hashes.includes(hash)) return fallo("respuesta-invalida");
    // Si Horizon dice de qué transacción habla, tiene que ser una de las dos.
    if (typeof r.hash === "string" && !hashes.includes(r.hash)) return fallo("respuesta-invalida");

    if (!r.successful) return fallo("fallida");

    const ops = interior.operations;
    const o = ops[0];
    if (ops.length !== 1 || !o || o.type !== "invokeHostFunction" || o.func.type !== "hostFunctionTypeInvokeContract") {
      return fallo("no-es-un-sello");
    }
    const llamada = o.func.invokeContract;
    if (llamada.functionName.toString() !== "seal") return fallo("no-es-un-sello");

    const contractId = sdk.Address.fromScAddress(llamada.contractAddress).toString();
    const oficial = (op.contratos ?? contratosOficiales(red)).find((c) => c.red === red && c.contractId === contractId);
    if (!oficial) return fallo("contrato-ajeno");
    // Un contrato anterior sigue abierto: cualquiera puede sellar en él. Vale hasta su último sello oficial.
    if (!oficial.vigente) {
      if (!Number.isSafeInteger(oficial.ultimoLedger)) return fallo("contrato-ajeno", { sinTope: true });
      if (r.ledger > (oficial.ultimoLedger as number)) return fallo("contrato-ajeno", { retirado: true });
    }

    // seal(organizer: Address, list_hash: BytesN<32>, count: u32, num_winners: u32, round: u64, meta: String)
    const a = llamada.args;
    const tipos = a.map((x) => x.type);
    if (tipos.join() !== "scvAddress,scvBytes,scvU32,scvU32,scvU64,scvString") return fallo("respuesta-invalida");
    const [organizer, listHash, count, numWinners, round, meta] = a.map((x) => sdk.scValToNative(x) as unknown);
    if (
      typeof organizer !== "string" ||
      !(listHash instanceof Uint8Array) ||
      listHash.length !== 32 ||
      typeof count !== "number" ||
      typeof numWinners !== "number" ||
      typeof round !== "bigint" ||
      round > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return fallo("respuesta-invalida");
    }
    const texto = typeof meta === "string" ? meta : meta instanceof Uint8Array ? new TextDecoder().decode(meta) : null;
    if (texto === null) return fallo("respuesta-invalida");

    return {
      ok: true,
      sello: {
        hash,
        hashInterior: hashes[1] as string,
        contractId,
        organizer,
        listHash: hex(listHash),
        count,
        numWinners,
        round: Number(round),
        meta: texto,
        closedAt: cerrado,
        ledger: r.ledger,
      },
    };
  } catch {
    // Un sobre que no se decodifica, o una dirección que no es de un contrato.
    return fallo("respuesta-invalida");
  }
}

/* ------------------------------------------------------------- el lector de una página */

export interface OpcionesDelLector extends OpcionesDelHistorial {
  /** Para las pruebas: otro reloj, en milisegundos. */
  ahora?: () => number;
  /** Cuánto se deja de preguntarle a una red que no contestó (30 s). */
  reposoMs?: number;
}

/** Tras una red que no contestó, el lector no vuelve a preguntarle por este tiempo. */
const REPOSO_MS = 30_000;

/**
 * Un lector para una página, con memoria: el mismo hash no se pide dos veces y,
 * si Horizon no contesta, no se vuelve a esperar por cada sorteo de un evento
 * (diez sorteos con Horizon caído serían minutos de espera).
 *
 * Una falla pasajera no apaga la lectura: el descanso es por red (que una no
 * conteste no dice nada de la otra) y dura `REPOSO_MS`; pasado ese tiempo se
 * vuelve a preguntar. Y lo que falló por la red o por una respuesta rara no se
 * recuerda: el mismo hash se vuelve a pedir la próxima vez. Lo que Horizon contestó
 * de verdad (un sello, o que no lo es) dura lo que la página.
 */
export function crearLectorDeHistorial(op: OpcionesDelLector = {}): (red: NetworkName, hash: string) => Promise<LecturaDelHistorial> {
  const ahora = op.ahora ?? Date.now;
  const reposo = op.reposoMs ?? REPOSO_MS;
  const hechas = new Map<string, Promise<LecturaDelHistorial>>();
  /** Hasta cuándo no se le pregunta a cada red que no contestó. */
  const sinPreguntarHasta = new Map<NetworkName, number>();
  return (red, hash) => {
    const clave = `${red}:${hash}`;
    const previa = hechas.get(clave);
    if (previa) return previa;
    const hasta = sinPreguntarHasta.get(red);
    if (hasta !== undefined) {
      if (ahora() < hasta) return Promise.resolve(fallo("red-caida"));
      sinPreguntarHasta.delete(red);
    }
    const p: Promise<LecturaDelHistorial> = leerHistorial(red, hash, op).then((l) => {
      if (!l.ok && l.error === "red-caida") sinPreguntarHasta.set(red, ahora() + reposo);
      if (!l.ok && (l.error === "red-caida" || l.error === "respuesta-invalida") && hechas.get(clave) === p) hechas.delete(clave);
      return l;
    });
    hechas.set(clave, p);
    return p;
  };
}
