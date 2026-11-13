import { HORIZON_URLS } from "./config";
import { DOLAR_DIGITAL } from "./pago-con-saldo";
import { esDireccionG, stroopsDe } from "./pagos";

/**
 * Cuántos dólares digitales tiene una cuenta para pagar, leído en Horizon de la red principal. Solo lee: no firma, no
 * arma nada y no le pregunta nada al proveedor de la billetera (leer no cuesta créditos).
 *
 * Lo que se puede usar es el saldo menos lo comprometido en ofertas abiertas (`selling_liabilities`). Una línea que el
 * emisor no autorizó no sirve para pagar. Nunca lanza: lo que no se pudo leer es `sin-red`, y ante la duda no se ofrece
 * pagar con el saldo.
 */

export type SaldoDeDolares =
  /** Lo que se puede usar, con siete decimales. */
  | { tipo: "saldo"; saldo: string }
  /** La cuenta existe y no tiene la línea del dólar digital (o el emisor no la autorizó). */
  | { tipo: "sin-linea" }
  /** La cuenta todavía no existe en la red. */
  | { tipo: "sin-cuenta" }
  /** No se pudo leer. */
  | { tipo: "sin-red" };

export interface OpcionesDeSaldo {
  fetch?: typeof fetch;
  horizon?: string;
  tiempoMs?: number;
}

/** Cuánto se espera a Horizon: es una lectura antes de mostrar cómo pagar, y sin respuesta se sigue como hoy. */
export const TOPE_SALDO_MS = 4_000;

/** Siete decimales, como los escribe la red. */
const siete = (m: string): string => {
  const [e = "0", d = ""] = m.split(".");
  return `${e}.${d.padEnd(7, "0").slice(0, 7)}`;
};

const esMonto = (x: unknown): x is string => typeof x === "string" && /^\d{1,15}(?:\.\d{1,7})?$/.test(x);

/** De stroops a texto con siete decimales. */
const deStroops = (n: bigint): string => {
  const s = (n < 0n ? 0n : n).toString().padStart(8, "0");
  return `${s.slice(0, -7)}.${s.slice(-7)}`;
};

/** Lo que dice el cuerpo de `/accounts/<cuenta>` sobre el dólar digital. */
export function saldoDelCuerpo(cuerpo: unknown): SaldoDeDolares {
  const j = (cuerpo ?? {}) as { balances?: unknown };
  if (!Array.isArray(j.balances)) return { tipo: "sin-red" };
  for (const b of j.balances as Array<Record<string, unknown>>) {
    if (b.asset_type !== "credit_alphanum4" || b.asset_code !== DOLAR_DIGITAL.code || b.asset_issuer !== DOLAR_DIGITAL.issuer) continue;
    if (b.is_authorized === false) return { tipo: "sin-linea" };
    if (!esMonto(b.balance)) return { tipo: "sin-red" };
    const comprometido = esMonto(b.selling_liabilities) ? stroopsDe(siete(b.selling_liabilities)) : 0n;
    return { tipo: "saldo", saldo: deStroops(stroopsDe(siete(b.balance)) - comprometido) };
  }
  return { tipo: "sin-linea" };
}

/** Lee el saldo de dólares digitales de la cuenta. Nunca lanza. */
export async function leerSaldoDeDolares(cuenta: string, o: OpcionesDeSaldo = {}): Promise<SaldoDeDolares> {
  if (!esDireccionG(cuenta)) return { tipo: "sin-red" };
  const f = o.fetch ?? fetch;
  const base = o.horizon ?? HORIZON_URLS.mainnet;
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), o.tiempoMs ?? TOPE_SALDO_MS);
  try {
    const r = await f(`${base}/accounts/${encodeURIComponent(cuenta)}`, { signal: ctl.signal });
    if (r.status === 404) return { tipo: "sin-cuenta" };
    if (!r.ok) return { tipo: "sin-red" };
    return saldoDelCuerpo(await r.json());
  } catch {
    return { tipo: "sin-red" };
  } finally {
    clearTimeout(reloj);
  }
}

/** ¿Alcanza el saldo para el monto? Los dos con siete decimales o como los escribe el servidor. */
export function alcanza(saldo: string, monto: string): boolean {
  if (!esMonto(saldo) || !esMonto(monto)) return false;
  return stroopsDe(siete(saldo)) >= stroopsDe(siete(monto));
}

/** Cuánto falta para el monto, con siete decimales (cero si alcanza). */
export function faltaPara(saldo: string, monto: string): string {
  if (!esMonto(saldo) || !esMonto(monto)) return deStroops(0n);
  return deStroops(stroopsDe(siete(monto)) - stroopsDe(siete(saldo)));
}
