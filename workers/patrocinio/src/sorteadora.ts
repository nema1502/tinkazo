/**
 * El sorteo por el servidor: el portero de mainnet manda el `draw` desde una cuenta propia, la sorteadora, para que la
 * persona no tenga que firmarlo (en mainnet, cada firma de una cuenta de Google le cuesta créditos de Pollar a Tinkazo).
 * El contrato no pide la firma de nadie para sortear y el resultado no depende de quién lo mande.
 *
 *   POST /v1/sorteo   {"sorteo": "1234", "firma": "<la firma de la ronda, 96 bytes en hexadecimal>"}
 *        200 {hash, status} o {ya:true}   400 {motivo:"cuerpo"|"fallaria"}   403 {motivo:"no-es-nuestro"|"origen"}
 *        409 {motivo:"ronda-no-lista", reintentarEn}
 *        503 {motivo:"fondo"|"apagado"}   502 {motivo:"red"}   429 {motivo:"cupo-cuenta"|"cupo-ip"}
 *
 * Solo en mainnet con `ALTAS=1`, `SORTEO_SERVIDOR=1` y la cuenta sorteadora. La firma llega ya sin comprimir (los 96
 * bytes que pide `draw`), como hoy la arma el navegador: el Worker no descomprime nada, y la firma la comprueba el
 * contrato en la simulación. Así el Worker solo arma, firma con Ed25519 (WebCrypto) y manda.
 *
 * Acá vive lo que no sabe de cupos: leer el sorteo con `get_raffle`, armar y firmar el `draw`, y la cola de secuencias
 * de la sorteadora. Quién paga y cuánto lo decide el portero (`Portero.sortear`, en `servicio.ts`).
 */
import { Account, Operation, TransactionBuilder, nativeToScVal, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk/base";
import type { Config } from "./config";
import { cors, json, origenPermitido } from "./http";
import type { PorIp } from "./por-ip";
import { ErrorDeRed, type Red, type Simulacion } from "./red";
import type { Firmante, Respuesta } from "./servicio";

/** El número de `Error::AlreadyDrawn` en el contrato (`contracts/raffle/src/lib.rs`). Es ABI: no cambia. */
export const CODIGO_YA_SORTEADO = 2;
/** El de `Error::RoundNotReady`: la ronda todavía no llegó según la hora del ledger. Se reintenta en unos segundos. */
export const CODIGO_RONDA_NO_LISTA = 7;
/** Cuánto esperar antes de reintentar una ronda que la red todavía no alcanzó: un ledger y algo. */
export const REINTENTAR_RONDA_MS = 5_000;
/** La oferta de inclusión de la transacción interna, por operación: la base de la red. La del sobre es la del portero. */
export const INCLUSION_INTERNA = 100;
/** Cuánto vale el `draw` armado por el servidor, en segundos. */
export const VENTANA_SORTEO_S = 240;
/**
 * Después de que la red toma un `draw` (PENDING), la cola de la sorteadora espera a que entre antes de mandar el
 * siguiente: Stellar Core guarda una sola transacción pendiente por cuenta de origen (desde el protocolo 19), y la
 * siguiente vuelve con TRY_AGAIN_LATER. Pregunta cada tanto, hasta unas cuantas veces; un ledger cierra en unos 5 s.
 */
export const CONFIRMAR_CADA_MS = 1_000;
export const CONFIRMAR_VECES = 10;
/** Lo más que se acepta de cuerpo en `/v1/sorteo`. */
const MAX_CUERPO = 1024;
const U64_MAX = (1n << 64n) - 1n;

/** Lo que importa de un sorteo leído de la red con `get_raffle`. */
export interface SorteoEnRed {
  id: bigint;
  /** La dirección del organizador, tal como la guarda el contrato. */
  organizador: string;
  /** La huella de la lista, en hexadecimal (minúsculas). */
  huellaLista: string;
  ronda: number;
  ganadores: number;
  /** Si ya tiene resultado (`Status::Drawn`). */
  sorteado: boolean;
}

/** El número de un sorteo como lo manda el sitio: un entero positivo de 64 bits, en decimal y sin ceros adelante. */
export function leerNumeroDeSorteo(s: unknown): bigint | null {
  const t = typeof s === "number" && Number.isSafeInteger(s) ? String(s) : s;
  if (typeof t !== "string" || !/^[1-9]\d{0,19}$/.test(t)) return null;
  const n = BigInt(t);
  return n <= U64_MAX ? n : null;
}

/** La firma de la ronda sin comprimir: 96 bytes en hexadecimal (192 caracteres). */
export function leerFirma(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !/^[0-9a-fA-F]{192}$/.test(s)) return null;
  const b = new Uint8Array(96);
  for (let i = 0; i < 96; i++) b[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return b;
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Lo que devuelve `get_raffle` (un `Option<Raffle>` en base64): null si no existe. Lo que no tenga exactamente la forma
 * del contrato lanza un error: no se adivina.
 */
export function leerRetornoDelSorteo(retorno: string): SorteoEnRed | null {
  const v = xdr.ScVal.fromXDR(retorno, "base64");
  if (v.type === "scvVoid") return null;
  if (v.type !== "scvMap") throw new Error("sorteo-forma");
  const n = scValToNative(v) as Record<string, unknown>;
  const { id, organizer, list_hash, round, num_winners, status } = n;
  if (typeof id !== "bigint" || typeof organizer !== "string" || !(list_hash instanceof Uint8Array) || list_hash.length !== 32) throw new Error("sorteo-forma");
  if (typeof round !== "bigint" || round < 0n || round > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("sorteo-forma");
  if (typeof num_winners !== "number" || !Array.isArray(status) || typeof status[0] !== "string") throw new Error("sorteo-forma");
  return { id, organizador: organizer, huellaLista: hex(list_hash), ronda: Number(round), ganadores: num_winners, sorteado: status[0] === "Drawn" };
}

/** Una invocación del contrato oficial, sin firmar, con la secuencia que se diga (para simular alcanza cualquiera). */
function invocar(o: { passphrase: string; contractId: string; origen: string; secuencia: string; metodo: string; args: xdr.ScVal[]; datos?: string; venceS?: number }): Transaction {
  const b = new TransactionBuilder(new Account(o.origen, o.secuencia), { fee: String(INCLUSION_INTERNA), networkPassphrase: o.passphrase }).addOperation(
    Operation.invokeContractFunction({ contract: o.contractId, function: o.metodo, args: o.args }),
  );
  if (o.datos) b.setSorobanData(o.datos);
  b.setTimebounds(0, o.venceS ?? 0);
  return b.build();
}

/**
 * Lee un sorteo de la red con una simulación de `get_raffle` (solo lectura: no se manda nada ni se paga nada). null si
 * no existe. Una red que no contesta, o que contesta algo sin sentido, es `ErrorDeRed`: ante la duda no se paga.
 */
export async function leerSorteo(red: Red, o: { passphrase: string; contractId: string; origen: string }, id: bigint): Promise<SorteoEnRed | null> {
  const tx = invocar({ ...o, secuencia: "0", metodo: "get_raffle", args: [nativeToScVal(id, { type: "u64" })] });
  const sim = await red.simular(tx.toXDR());
  if (!sim.ok || !sim.retorno) throw new ErrorDeRed("lectura-sorteo");
  try {
    return leerRetornoDelSorteo(sim.retorno);
  } catch {
    throw new ErrorDeRed("lectura-sorteo");
  }
}

export interface OpcionesSorteadora {
  passphrase: string;
  contractId: string;
  /** La cuenta sorteadora (G…): el origen del `draw`. */
  cuenta: string;
  red: Red;
  /** La llave de la sorteadora (el secreto `CLAVE_SORTEADORA`). */
  firmante: Firmante;
  /** Cómo se espera entre una pregunta y otra a la red. Las pruebas pasan la suya: nunca esperan de verdad. */
  esperar?: (ms: number) => Promise<void>;
}

/**
 * La sorteadora: arma, firma y ordena los `draw` del servidor. Las secuencias salen de una cola en la memoria del
 * objeto: un envío detrás del otro, y después de un envío aceptado la cola espera a que entre (`esperarQueEntre`),
 * porque la red tiene una sola pendiente por cuenta. Así dos sorteos a la vez salen con secuencias seguidas, el segundo
 * unos segundos después. La secuencia se lee de la red la primera vez y después de cualquier cosa que no sea un envío
 * aceptado que entró.
 */
export class Sorteadora {
  /** La secuencia de la cuenta (la de su última transacción), si se sabe. */
  private actual: bigint | null = null;
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: OpcionesSorteadora) {}

  get cuenta(): string {
    return this.o.cuenta;
  }

  /** Lee un sorteo de la red (ver `leerSorteo`), con la sorteadora como origen de la simulación. */
  leer(id: bigint): Promise<SorteoEnRed | null> {
    return leerSorteo(this.o.red, { passphrase: this.o.passphrase, contractId: this.o.contractId, origen: this.o.cuenta }, id);
  }

  /** Simula el `draw`: ahí el contrato comprueba la firma de la ronda. Si pasa, trae los recursos para armarlo. */
  simular(id: bigint, firma: Uint8Array): Promise<Simulacion> {
    return this.o.red.simular(this.armar(id, firma, 0n, undefined, 0).toXDR());
  }

  /** El `draw` sin firmar, con la secuencia siguiente a `actual`, los recursos de la simulación y su vencimiento. */
  armar(id: bigint, firma: Uint8Array, actual: bigint, datos: string | undefined, venceS: number): Transaction {
    return invocar({
      passphrase: this.o.passphrase,
      contractId: this.o.contractId,
      origen: this.o.cuenta,
      secuencia: actual.toString(),
      metodo: "draw",
      args: [nativeToScVal(id, { type: "u64" }), nativeToScVal(firma, { type: "bytes" })],
      ...(datos ? { datos } : {}),
      venceS,
    });
  }

  /** Firma la transacción con la llave de la sorteadora. Devuelve el XDR firmado y su hash en hexadecimal. */
  async firmar(tx: Transaction): Promise<{ xdr: string; hash: string }> {
    const h = tx.hash();
    const firma = await this.o.firmante.firmar(h);
    tx.addSignature(this.o.firmante.clavePublica, btoa(String.fromCharCode(...firma)));
    return { xdr: tx.toXDR(), hash: hex(h) };
  }

  /**
   * De a uno: lo que se pone en la cola corre cuando terminó lo anterior, salga bien o mal. `fn` puede `retener` la cola
   * con una promesa: su resultado sale enseguida, pero lo siguiente de la cola espera también a esa promesa.
   */
  enCola<T>(fn: (retener: (p: Promise<unknown>) => void) => Promise<T>): Promise<T> {
    let retenida: Promise<unknown> = Promise.resolve();
    const correr = () =>
      fn((p) => {
        retenida = p;
      });
    const r = this.cola.then(correr, correr);
    this.cola = r.then(
      () => retenida,
      () => retenida,
    ).catch(() => undefined);
    return r;
  }

  /**
   * Espera a que la red diga en qué quedó una transacción que tomó (la cola no manda otra hasta entonces). Si entró, bien
   * o mal, la secuencia recordada vale. Si no aparece en el plazo, se olvida la secuencia: la próxima vez se lee de la
   * red. Una red que no contesta, o que contesta cualquier cosa, cuenta como "todavía no". Nunca falla.
   */
  async esperarQueEntre(hash: string): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND"> {
    const esperar = this.o.esperar ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
    for (let i = 0; i < CONFIRMAR_VECES; i++) {
      await esperar(CONFIRMAR_CADA_MS);
      try {
        const c = await this.o.red.consultar(hash);
        if (c.status === "SUCCESS" || c.status === "FAILED") return c.status;
      } catch {
        // Sin respuesta con sentido: todavía no se sabe, se vuelve a preguntar.
      }
    }
    this.olvidar();
    return "NOT_FOUND";
  }

  /** La secuencia de la cuenta: la recordada o la de la red. null si la cuenta no existe. */
  async secuencia(): Promise<bigint | null> {
    if (this.actual !== null) return this.actual;
    const c = await this.o.red.leerCuenta(this.o.cuenta);
    if (!c) return null;
    if (c.secuencia === undefined || !/^\d{1,20}$/.test(c.secuencia)) throw new ErrorDeRed("secuencia");
    this.actual = BigInt(c.secuencia);
    return this.actual;
  }

  /** La red tomó la transacción con la secuencia siguiente a `actual`: esa pasa a ser la de la cuenta. */
  usada(actual: bigint): void {
    this.actual = actual + 1n;
  }

  /** No se sabe en qué quedó la cuenta: la próxima vez se lee de la red. */
  olvidar(): void {
    this.actual = null;
  }
}

/**
 * La ruta `/v1/sorteo` del Worker, sin Cloudflare (se prueba en Node). Solo en mainnet: en testnet devuelve null y la
 * ruta sigue sin existir. Abierta desde los orígenes del sitio, sin sesión: lo peor que logra un pedido es adelantar un
 * sorteo que iba a dar lo mismo, una sola vez por sello, y solo de un sello que pagó el portero.
 */
export async function atenderSorteo(request: Request, cfg: Config, porIp: PorIp, llamar: (sorteo: string, firma: string) => Promise<Respuesta>): Promise<Response | null> {
  if (cfg.red !== "mainnet") return null;
  const origen = request.headers.get("Origin");
  const cabeceras = cors(origen, false);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras });
  if (request.method !== "POST") return json({ motivo: "metodo" }, 405, cabeceras);
  if (!cfg.sorteoServidor) return json({ motivo: "apagado" }, 503, cabeceras);
  // Un navegador manda su origen; un programa puede mentirlo: la defensa de verdad es el libro y los sellos del portero.
  if (!origenPermitido(origen)) return json({ motivo: "origen" }, 403, cabeceras);
  if (!porIp.toca(request.headers.get("CF-Connecting-IP") ?? "0.0.0.0", cfg.porIpPorHora)) return json({ motivo: "cupo-ip" }, 429, cabeceras);
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return json({ motivo: "cuerpo" }, 400, cabeceras);
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const { sorteo, firma } = cuerpo as { sorteo?: unknown; firma?: unknown };
  const id = leerNumeroDeSorteo(sorteo);
  if (id === null || !leerFirma(firma)) return json({ motivo: "cuerpo" }, 400, cabeceras);
  try {
    const r = await llamar(id.toString(), String(firma).toLowerCase());
    return json(r.cuerpo, r.estado, cabeceras);
  } catch {
    return json({ motivo: "interno" }, 500, cabeceras);
  }
}
