import { HORIZON_URLS, network } from "../stellar/config";
import { CUPON_MONTO, memoCupon } from "./modelo";

/**
 * Lo que los equipos leen de Horizon, el historial de Stellar: si una cuenta ya existe, los pagos de la cuenta del
 * evento (de ahí salen los cupones) y mandar la transacción de cupones ya aprobada.
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

/**
 * Los últimos pagos de una cuenta, del más viejo al más nuevo. Lee de los más nuevos para atrás hasta `paginas`
 * páginas de 200: alcanza de sobra para un evento. `null` si Horizon no contestó.
 */
export async function pagosDeLaCuenta(cuenta: string, o: OpcionesDeHorizon & { paginas?: number } = {}): Promise<Pago[] | null> {
  const todos: Pago[] = [];
  let url: string | null = `${base(o)}/accounts/${encodeURIComponent(cuenta)}/payments?order=desc&limit=200&join=transactions&include_failed=false`;
  try {
    for (let p = 0; p < (o.paginas ?? 5) && url; p++) {
      const r = await pedir(o, url);
      if (r.status === 404) return [];
      if (!r.ok) return null;
      const cuerpo = (await r.json()) as { _embedded?: { records?: RegistroDePago[] }; _links?: { next?: { href?: string } } };
      const registros = cuerpo._embedded?.records ?? [];
      for (const reg of registros) {
        const pago = comoPago(reg);
        if (pago) todos.push(pago);
      }
      url = registros.length >= 200 ? (cuerpo._links?.next?.href ?? null) : null;
    }
  } catch {
    return null;
  }
  return todos.sort((a, b) => (a.orden < b.orden ? -1 : a.orden > b.orden ? 1 : 0));
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
