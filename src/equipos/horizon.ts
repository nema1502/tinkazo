import { HORIZON_URLS, network } from "../stellar/config";
import { CUPON_MONTO, memoCupon } from "./modelo";

/**
 * Lo que los equipos leen de Horizon, el historial de Stellar: si una cuenta ya existe, los pagos que salieron de la
 * cuenta del evento (de ahí salen los cupones) y mandar la transacción de cupones ya aprobada.
 *
 * Solo lectura salvo `enviarTransaccion`. Sin el SDK de Stellar: son pedidos `fetch`. Todo recibe su `fetch` y su
 * dirección de Horizon para poder probarse con respuestas simuladas.
 */

type Fetch = typeof fetch;

export interface OpcionesDeHorizon {
  fetch?: Fetch;
  horizon?: string;
  /** Cuánto se espera cada pedido (12 s). */
  tiempoMs?: number;
}

const base = (o: OpcionesDeHorizon): string => (o.horizon ?? HORIZON_URLS[network.name]).replace(/\/$/, "");
const pedir = (o: OpcionesDeHorizon, url: string, init: RequestInit = {}): Promise<Response> =>
  (o.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(o.tiempoMs ?? 12_000) });

/* ------------------------------------------------------------------ cuentas */

/** Lo que sirve de una cuenta para armar una transacción. */
export type LecturaDeCuenta = { existe: false } | { existe: true; secuencia: string; xlm: number };

/** La cuenta en la red, o `null` si Horizon no contestó (sin respuesta no se afirma nada). */
export async function leerCuenta(cuenta: string, o: OpcionesDeHorizon = {}): Promise<LecturaDeCuenta | null> {
  try {
    const r = await pedir(o, `${base(o)}/accounts/${encodeURIComponent(cuenta)}`);
    // 404 es «la cuenta no existe todavía»: Pollar la crea al primer uso.
    if (r.status === 404) return { existe: false };
    if (!r.ok) return null;
    const c = (await r.json()) as { sequence?: unknown; balances?: { asset_type?: string; balance?: string }[] };
    if (typeof c.sequence !== "string" || !/^\d+$/.test(c.sequence)) return null;
    const nativo = c.balances?.find((b) => b.asset_type === "native");
    return { existe: true, secuencia: c.sequence, xlm: Number(nativo?.balance ?? 0) };
  } catch {
    return null;
  }
}

/**
 * Cuáles de estas cuentas ya existen en la red. `true` existe, `false` todavía no está activa (0 XLM: no recibe un
 * pago), `null` no se pudo saber. Pide de a pocas a la vez, para no saturar a Horizon con cien equipos.
 */
export async function cuentasActivas(cuentas: readonly string[], o: OpcionesDeHorizon & { enParalelo?: number } = {}): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const pendientes = [...new Set(cuentas)];
  const trabajador = async (): Promise<void> => {
    for (let c = pendientes.shift(); c !== undefined; c = pendientes.shift()) {
      const l = await leerCuenta(c, o);
      out.set(c, l === null ? null : l.existe);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.enParalelo ?? 6, pendientes.length) }, trabajador));
  return out;
}

/* -------------------------------------------------------------------- pagos */

/** Un pago de la cuenta del evento, con la nota de su transacción. */
export interface Pago {
  /** El número de la operación en la red: crece con el tiempo, y por eso ordena. */
  orden: bigint;
  hash: string;
  creado: string;
  de: string;
  a: string;
  monto: string;
  /** `true` si es XLM; si no, no sirve para un cupón. */
  nativo: boolean;
  /** La nota, si la transacción tiene una de texto. */
  memo: string | null;
}

interface RegistroDePago {
  type?: string;
  paging_token?: string;
  id?: string;
  transaction_successful?: boolean;
  transaction_hash?: string;
  created_at?: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  transaction?: { memo_type?: string; memo?: string };
}

/** Un registro de Horizon como `Pago`, o `null` si no es un pago o no tiene lo que hace falta. */
export function comoPago(r: RegistroDePago): Pago | null {
  if (r.type !== "payment" || r.transaction_successful === false) return null;
  const id = r.paging_token ?? r.id;
  if (typeof id !== "string" || !/^\d+$/.test(id)) return null;
  if (typeof r.from !== "string" || typeof r.to !== "string" || typeof r.amount !== "string" || typeof r.transaction_hash !== "string") return null;
  return {
    orden: BigInt(id),
    hash: r.transaction_hash,
    creado: r.created_at ?? "",
    de: r.from,
    a: r.to,
    monto: r.amount,
    nativo: r.asset_type === "native",
    memo: r.transaction?.memo_type === "text" && typeof r.transaction.memo === "string" ? r.transaction.memo : null,
  };
}

/** Un registro de equipos vive 10 h (la sala se borra sola): más atrás no hay cupones suyos. Se miran 24 h por relojes corridos. */
export const VENTANA_DE_CUPONES_S = 24 * 3_600;
/** Cuántas páginas de 200 pagos se leen, como mucho, en cada revisión. Lo que falta se sigue en la próxima. */
export const PAGINAS_POR_LECTURA = 10;
/** Cuántas transacciones de la cuenta del evento se piden, como mucho, en cada revisión, para leer su nota. */
export const NOTAS_POR_LECTURA = 20;
const POR_PAGINA = 200;

/**
 * Lo ya leído de la cuenta de un evento, para no volver a leerlo: hasta dónde llegó cada recorrido, los pagos que
 * pueden ser cupones y la nota de cada transacción ya pedida.
 */
export interface MemoriaDeCupones {
  /** La ficha desde donde sigue el recorrido hacia atrás ("" es desde lo más nuevo). */
  atras: string;
  /** Si el recorrido hacia atrás ya llegó al comienzo de la ventana o al primer pago de la cuenta. */
  atrasListo: boolean;
  /** La ficha del pago más nuevo ya leído, desde donde sigue el recorrido hacia adelante. `null`: la cuenta no tenía pagos. */
  adelante: string | null;
  /** Si ya se fijó `adelante` (con la primera página). */
  iniciada: boolean;
  /** Si la última revisión devolvió `null` porque llegó a su tope y no porque Horizon falló: falta leer, no hay error. */
  pendiente: boolean;
  pagos: Map<string, Pago>;
  notas: Map<string, string | null>;
  cola: Promise<unknown>;
}

const memorias = new Map<string, MemoriaDeCupones>();

export interface OpcionesDeCupones extends OpcionesDeHorizon {
  /** Páginas por revisión (`PAGINAS_POR_LECTURA`). */
  paginas?: number;
  /** Notas por revisión (`NOTAS_POR_LECTURA`). */
  notas?: number;
  /** Para las pruebas: otro reloj, en milisegundos. */
  ahora?: () => number;
  /** Para las pruebas: otra memoria. */
  memoria?: Map<string, MemoriaDeCupones>;
}

const fichaDe = (r: RegistroDePago): string | null => {
  const f = r.paging_token ?? r.id;
  return typeof f === "string" && /^\d{1,30}$/.test(f) ? f : null;
};

/**
 * Los pagos que salieron de la cuenta del evento y pueden ser cupones (1 stroop de XLM), con la nota de su
 * transacción, del más viejo al más nuevo. `null` si no se pudo mirar todo lo que hacía falta: Horizon no contestó,
 * o la cuenta recibió tantos pagos que no se alcanzó a leerlos en esta revisión (la próxima sigue donde quedó). Un
 * resultado que no es `null` es completo: no depende de cuántos pagos de otras cuentas reciba la cuenta del evento.
 *
 * Cómo lee: la primera vez, de lo más nuevo hacia atrás hasta pasar `VENTANA_DE_CUPONES_S`; después, solo lo nuevo,
 * hacia adelante desde lo último que vio. Cada pago se lee una vez. Sin unir las transacciones (pesan mucho): la nota se
 * pide solo para las transacciones de la propia cuenta con pagos de 1 stroop, que son pocas.
 */
export function pagosDeLaCuenta(cuenta: string, o: OpcionesDeCupones = {}): Promise<Pago[] | null> {
  const memorias_ = o.memoria ?? memorias;
  const clave = `${base(o)}|${cuenta}`;
  let mem = memorias_.get(clave);
  if (!mem) {
    mem = { atras: "", atrasListo: false, adelante: null, iniciada: false, pendiente: false, pagos: new Map(), notas: new Map(), cola: Promise.resolve() };
    memorias_.set(clave, mem);
  }
  const m = mem;
  // Una revisión a la vez por cuenta: la segunda sigue donde quedó la primera.
  const leer = m.cola
    .then(() => {
      m.pendiente = false;
      return recorrer(cuenta, m, o);
    })
    .catch(() => null);
  m.cola = leer;
  return leer;
}

/**
 * Si la última lectura de `pagosDeLaCuenta` dio `null` solo porque llegó a su tope de páginas o de notas: Horizon
 * contestó bien y lo que falta se lee en la próxima, que conviene pedir enseguida. Falso si Horizon falló o si se leyó todo.
 */
export function quedaPorLeer(cuenta: string, o: OpcionesDeCupones = {}): boolean {
  return (o.memoria ?? memorias).get(`${base(o)}|${cuenta}`)?.pendiente ?? false;
}

async function recorrer(cuenta: string, mem: MemoriaDeCupones, o: OpcionesDeCupones): Promise<Pago[] | null> {
  let paginas = o.paginas ?? PAGINAS_POR_LECTURA;
  let notasPedidas = 0;
  const limite = Math.floor((o.ahora?.() ?? Date.now()) / 1000) - VENTANA_DE_CUPONES_S;
  const viejo = (r: RegistroDePago): boolean => {
    const t = Date.parse(r.created_at ?? "");
    return Number.isFinite(t) && t / 1000 < limite;
  };

  const pagina = async (orden: "asc" | "desc", cursor: string | null): Promise<RegistroDePago[] | "no-existe" | null> => {
    const url = `${base(o)}/accounts/${encodeURIComponent(cuenta)}/payments?order=${orden}&limit=${POR_PAGINA}&include_failed=false${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await pedir(o, url);
    if (r.status === 404) return "no-existe";
    if (!r.ok) return null;
    const cuerpo = (await r.json()) as { _embedded?: { records?: unknown } };
    const registros = cuerpo._embedded?.records;
    if (!Array.isArray(registros)) return null;
    // Sin la ficha de cada pago no se sabe hasta dónde se leyó.
    if (registros.some((x) => !x || typeof x !== "object" || fichaDe(x as RegistroDePago) === null)) return null;
    return registros as RegistroDePago[];
  };

  /** La nota de una transacción: el texto, `null` si no tiene una de texto, `undefined` si no se pudo leer. */
  const nota = async (hash: string): Promise<string | null | undefined> => {
    const r = await pedir(o, `${base(o)}/transactions/${encodeURIComponent(hash)}`);
    if (!r.ok) return undefined;
    const t = (await r.json()) as { memo_type?: unknown; memo?: unknown };
    return t.memo_type === "text" && typeof t.memo === "string" ? t.memo : null;
  };

  /** Anota el pago si es uno de 1 stroop que salió de la cuenta. Falso si no se pudo (sin nota o sin tope para pedirla). */
  const anotar = async (r: RegistroDePago): Promise<boolean> => {
    const p = comoPago(r);
    // Lo que entra a la cuenta, lo de otro monto o de otro activo no es un cupón: ni se pide su nota.
    if (!p || p.de !== cuenta || !p.nativo || p.monto !== CUPON_MONTO) return true;
    let memo = mem.notas.get(p.hash);
    if (memo === undefined) {
      if (notasPedidas >= (o.notas ?? NOTAS_POR_LECTURA)) {
        mem.pendiente = true;
        return false;
      }
      notasPedidas++;
      const leida = await nota(p.hash);
      if (leida === undefined) return false;
      memo = leida;
      mem.notas.set(p.hash, memo);
    }
    mem.pagos.set(String(p.orden), { ...p, memo });
    return true;
  };

  const llegoAlTope = (): null => {
    mem.pendiente = true;
    return null;
  };

  // Hacia atrás, hasta el comienzo de la ventana o el primer pago de la cuenta.
  while (!mem.atrasListo) {
    if (paginas <= 0) return llegoAlTope();
    const regs = await pagina("desc", mem.atras || null);
    paginas--;
    if (regs === "no-existe") return [];
    if (regs === null) return null;
    if (!mem.iniciada) {
      mem.iniciada = true;
      mem.adelante = regs[0] ? fichaDe(regs[0]) : null;
    }
    for (const r of regs) {
      if (viejo(r)) {
        mem.atrasListo = true;
        break;
      }
      if (!(await anotar(r))) return null;
      mem.atras = fichaDe(r) as string;
    }
    if (regs.length < POR_PAGINA) mem.atrasListo = true;
  }

  // Hacia adelante, lo que llegó después. Siempre al menos una página: lo nuevo es lo que más importa.
  paginas = Math.max(paginas, 1);
  for (;;) {
    if (paginas <= 0) return llegoAlTope();
    const regs = await pagina("asc", mem.adelante);
    paginas--;
    if (regs === "no-existe") return [];
    if (regs === null) return null;
    for (const r of regs) {
      if (!(await anotar(r))) return null;
      mem.adelante = fichaDe(r);
    }
    if (regs.length < POR_PAGINA) break;
  }
  return [...mem.pagos.values()].sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0));
}

/** Un cupón recibido por una cuenta. */
export interface Cupon {
  orden: bigint;
  hash: string;
}

/**
 * Los cupones que mandó la cuenta del evento, por cuenta que lo recibió. Un cupón es un pago de 1 stroop de XLM
 * desde esa cuenta, con la nota `tk:cupon:<evento>`: otro pago, de otro monto, de otra cuenta o con otra nota, no
 * cuenta (cualquiera puede mandarle un stroop a un equipo para aparentar un cupón, pero no puede hacerlo pasar por
 * el de la cuenta del evento). Si una cuenta recibió dos, vale el primero.
 */
export function cuponesEnviados(pagos: readonly Pago[], emisor: string, evento: string): Map<string, Cupon> {
  const nota = memoCupon(evento);
  const out = new Map<string, Cupon>();
  for (const p of pagos) {
    if (!p.nativo || p.de !== emisor || p.monto !== CUPON_MONTO || p.memo !== nota) continue;
    const antes = out.get(p.a);
    if (!antes || p.orden < antes.orden) out.set(p.a, { orden: p.orden, hash: p.hash });
  }
  return out;
}

/* ------------------------------------------------------------------- envío */

/** Por qué la red no aceptó la transacción, dicho en una palabra que la pantalla traduce. */
export type MotivoDeEnvio = "sin-destino" | "sin-saldo" | "secuencia" | "tarde" | "red" | "rechazada";

export type ResultadoDeEnvio = { ok: true; hash: string } | { ok: false; motivo: MotivoDeEnvio };

/** Manda a la red una transacción ya aprobada. */
export async function enviarTransaccion(xdr: string, o: OpcionesDeHorizon = {}): Promise<ResultadoDeEnvio> {
  try {
    const r = await pedir(o, `${base(o)}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tx: xdr }).toString(),
    });
    const cuerpo = (await r.json().catch(() => ({}))) as { hash?: string; extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
    if (r.ok && typeof cuerpo.hash === "string") return { ok: true, hash: cuerpo.hash };
    if (r.status === 429 || r.status >= 500) return { ok: false, motivo: "red" };
    const tx = cuerpo.extras?.result_codes?.transaction ?? "";
    const ops = cuerpo.extras?.result_codes?.operations ?? [];
    if (ops.includes("op_no_destination")) return { ok: false, motivo: "sin-destino" };
    if (tx === "tx_insufficient_balance" || ops.includes("op_underfunded") || tx === "tx_insufficient_fee") return { ok: false, motivo: "sin-saldo" };
    if (tx === "tx_bad_seq") return { ok: false, motivo: "secuencia" };
    if (tx === "tx_too_late" || tx === "tx_too_early") return { ok: false, motivo: "tarde" };
    return { ok: false, motivo: "rechazada" };
  } catch {
    return { ok: false, motivo: "red" };
  }
}
