/**
 * Los pagos de USDC que llegan a una cuenta, leídos de Horizon.
 *
 * Lo usan el Worker, que comprueba por su cuenta (no confía en el navegador) antes de acreditar la primera carga o
 * de activar un plan, y el sitio, que lo mira para decir "Tus primeros dólares digitales llegaron". Es el mismo
 * código para los dos. No importa nada de Cloudflare ni de la página: se prueba con un Horizon de mentira.
 *
 * Solo cuenta un pago de USDC del emisor oficial de la red, exitoso. Un "USDC" de otro emisor no vale.
 */
import { EMISOR_USDC, PLAN, type Red, UN_USDC, aStroops, memoDePlan } from "./reglas";

export const HORIZON: Record<Red, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

export interface ContextoHorizon {
  red: Red;
  /** Sin barra al final. Por defecto, el Horizon de la red. */
  horizon?: string;
  fetch: typeof fetch;
}

/** Un pago entrante, ya leído. */
export interface Pago {
  de: string;
  a: string;
  monto: bigint;
  /** La transacción: su hash, para el enlace al explorador y para no usar un pago dos veces. */
  tx: string;
  /** La nota de texto de la transacción, si tiene. */
  memo: string | null;
  ms: number;
}

const TIPOS = new Set(["payment", "path_payment_strict_send", "path_payment_strict_receive"]);
const POR_PAGINA = 200;
const PAGINAS = 5;
const ESPERA_MS = 10_000;

const base = (c: ContextoHorizon): string => (c.horizon ?? HORIZON[c.red]).replace(/\/+$/, "");

/** Lo que cuenta de un registro de Horizon, o null si no es un pago de USDC (del emisor oficial) que haya entrado. */
function pagoDe(r: unknown, red: Red): Pago | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  if (typeof x.type !== "string" || !TIPOS.has(x.type)) return null;
  if (x.transaction_successful === false) return null;
  if (x.asset_code !== "USDC" || x.asset_issuer !== EMISOR_USDC[red]) return null;
  const monto = aStroops(x.amount);
  if (monto === null || typeof x.to !== "string" || typeof x.from !== "string") return null;
  const tx = typeof x.transaction_hash === "string" ? x.transaction_hash : "";
  if (!tx) return null;
  const t = x.transaction as Record<string, unknown> | undefined;
  const memo = t && t.memo_type === "text" && typeof t.memo === "string" ? t.memo : null;
  const ms = typeof x.created_at === "string" ? Date.parse(x.created_at) : Number.NaN;
  return { de: x.from, a: x.to, monto, tx, memo, ms: Number.isFinite(ms) ? ms : 0 };
}

export type Lectura<T> = { ok: true; valor: T } | { ok: false };

/**
 * Los pagos entrantes de USDC de una cuenta, del más nuevo al más viejo, hasta que `parar` diga que ya alcanza o
 * se acaben las páginas (cinco de 200). Una cuenta que no existe no tiene pagos. Si Horizon no contesta, no se afirma nada.
 */
export async function pagosEntrantes(cuenta: string, ctx: ContextoHorizon, parar: (acumulados: Pago[]) => boolean = () => false): Promise<Lectura<Pago[]>> {
  const inicio = base(ctx);
  let url: string | null = `${inicio}/accounts/${encodeURIComponent(cuenta)}/payments?order=desc&limit=${POR_PAGINA}&include_failed=false&join=transactions`;
  const pagos: Pago[] = [];
  for (let pagina = 0; pagina < PAGINAS && url; pagina++) {
    let cuerpo: { _embedded?: { records?: unknown[] }; _links?: { next?: { href?: string } } };
    try {
      const res: Response = await ctx.fetch(url, { signal: AbortSignal.timeout(ESPERA_MS), headers: { Accept: "application/json" } });
      if (res.status === 404) return { ok: true, valor: pagos };
      if (!res.ok) return { ok: false };
      cuerpo = (await res.json()) as typeof cuerpo;
    } catch {
      return { ok: false };
    }
    const registros = cuerpo._embedded?.records ?? [];
    for (const r of registros) {
      const p = pagoDe(r, ctx.red);
      if (p && p.a === cuenta) pagos.push(p);
    }
    if (parar(pagos) || registros.length < POR_PAGINA) break;
    // Solo se sigue por el mismo Horizon: una dirección de "siguiente" ajena no se visita.
    const siguiente: string | undefined = cuerpo._links?.next?.href;
    url = siguiente && siguiente.startsWith(`${inicio}/`) ? siguiente : null;
  }
  return { ok: true, valor: pagos };
}

/** Si la cuenta existe en la red (tiene su primer saldo). */
export async function cuentaExiste(cuenta: string, ctx: ContextoHorizon): Promise<Lectura<boolean>> {
  try {
    const res = await ctx.fetch(`${base(ctx)}/accounts/${encodeURIComponent(cuenta)}`, { signal: AbortSignal.timeout(ESPERA_MS), headers: { Accept: "application/json" } });
    if (res.status === 404) return { ok: true, valor: false };
    if (!res.ok) return { ok: false };
    return { ok: true, valor: true };
  } catch {
    return { ok: false };
  }
}

/**
 * La primera carga: un pago de 1 USDC o más a la cuenta, de otra cuenta, y que no sea un pago de Tinkazo (los
 * cupones y los premios llevan una nota `tk:…`: no son una carga hecha por quien recibe).
 */
export async function buscarCarga(cuenta: string, ctx: ContextoHorizon): Promise<Lectura<Pago | null>> {
  const esCarga = (p: Pago): boolean => p.de !== cuenta && p.monto >= UN_USDC && !(p.memo ?? "").startsWith("tk:");
  const r = await pagosEntrantes(cuenta, ctx, (ps) => ps.some(esCarga));
  if (!r.ok) return r;
  return { ok: true, valor: r.valor.find(esCarga) ?? null };
}

/**
 * Los pagos del plan de `comprador` a la cuenta de planes: de 5 USDC o más y con la nota exacta
 * `tk:plan:<últimos 8 caracteres de su cuenta>`, del más nuevo al más viejo.
 */
export async function buscarPagosDePlan(planes: string, comprador: string, ctx: ContextoHorizon): Promise<Lectura<Pago[]>> {
  const nota = memoDePlan(comprador);
  const r = await pagosEntrantes(planes, ctx);
  if (!r.ok) return r;
  return { ok: true, valor: r.valor.filter((p) => p.memo === nota && p.monto >= BigInt(PLAN.usdc) * UN_USDC) };
}
