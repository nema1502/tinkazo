/**
 * Los premios del panel: cuántas personas ganan (de 1 a 10) y cuánto se lleva
 * cada una, todo con botones de más y menos. El total de lo que la empresa pone
 * sale de la misma cuenta que el cobro (`comisionDe`), así el armado y el
 * depósito nunca muestran montos distintos.
 *
 * Todo en cantidades enteras de stroops (un dólar digital son 10.000.000, un
 * centavo 100.000): nada pasa por números con coma.
 */

import { DOLAR, comisionDe, totalACargar, totalDePremios } from "../campana/comision";

/** La escalera de montos que recorren los botones de más y menos, en dólares digitales enteros. */
export const MONTOS_EN_ORDEN = [5, 10, 20, 40, 50, 100, 200] as const;

export const GANAN_MINIMO = 1;
export const GANAN_MAXIMO = 10;

export interface PremiosDelPanel {
  /** El monto elegido, en dólares enteros, o null mientras no se eligió ninguno. */
  monto: number | null;
  ganan: number;
}

export type AccionDePremios =
  | { tipo: "ganan-mas" }
  | { tipo: "ganan-menos" }
  | { tipo: "ganar"; v: number }
  | { tipo: "monto-mas" }
  | { tipo: "monto-menos" }
  | { tipo: "monto-fijo"; v: number };

/** Sin premio elegido todavía: un solo ganador y ningún monto. */
export function premiosIniciales(): PremiosDelPanel {
  return { monto: null, ganan: GANAN_MINIMO };
}

/** Lo que queda después de un botón: en la escalera, o fijo en el valor de un botón grande. */
export function reducirPremios(p: PremiosDelPanel, accion: AccionDePremios | readonly AccionDePremios[]): PremiosDelPanel {
  let q = p;
  for (const a of Array.isArray(accion) ? accion : [accion]) {
    q = reducirUno(q, a);
  }
  return q;
}

function reducirUno(p: PremiosDelPanel, a: AccionDePremios): PremiosDelPanel {
  switch (a.tipo) {
    case "ganan-mas":
      return { ...p, ganan: Math.min(p.ganan + 1, GANAN_MAXIMO) };
    case "ganan-menos":
      return { ...p, ganan: Math.max(p.ganan - 1, GANAN_MINIMO) };
    case "ganar":
      return { ...p, ganan: Number.isSafeInteger(a.v) && a.v >= GANAN_MINIMO && a.v <= GANAN_MAXIMO ? a.v : p.ganan };
    case "monto-mas":
    case "monto-menos": {
      const enLa = (m: (typeof MONTOS_EN_ORDEN)[number]): number => MONTOS_EN_ORDEN.indexOf(m);
      const actual = p.monto !== null && (MONTOS_EN_ORDEN as readonly number[]).includes(p.monto) ? enLa(p.monto as (typeof MONTOS_EN_ORDEN)[number]) : null;
      let siguiente: number;
      if (a.tipo === "monto-mas") {
        siguiente = Math.min(actual === null ? 0 : actual + 1, MONTOS_EN_ORDEN.length - 1);
      } else {
        if (actual === null) return { ...p, monto: p.monto };
        siguiente = Math.max(actual - 1, 0);
      }
      return { ...p, monto: MONTOS_EN_ORDEN[siguiente] ?? p.monto };
    }
    case "monto-fijo":
      return { ...p, monto: (MONTOS_EN_ORDEN as readonly number[]).includes(a.v) ? a.v : p.monto };
  }
}

export interface ConfigDelCobro {
  pb: bigint;
  minimo: bigint;
}

/** Lo que la empresa pone, en stroops y sin coma: los premios, el servicio y el total. Null con montos que no valen. */
export function costosDeLaCampana(
  p: { monto: number; ganan: number },
  cfg: ConfigDelCobro | null,
): { premios: bigint; comision: bigint; total: bigint } | null {
  if (!Number.isSafeInteger(p.monto) || p.monto < 1 || !Number.isSafeInteger(p.ganan) || p.ganan < GANAN_MINIMO || p.ganan > GANAN_MAXIMO) {
    return null;
  }
  const lista = Array.from({ length: p.ganan }, () => BigInt(p.monto) * DOLAR);
  const premios = totalDePremios(lista);
  const comision = cfg === null ? 0n : comisionDe(lista, cfg.pb, cfg.minimo);
  return { premios, comision, total: totalACargar(lista, comision) };
}

/** El texto que ve la empresa: enteros y centavos justos, sin más digitos. */
export function textoDeDolares(stroops: bigint): string {
  const enteros = stroops / DOLAR;
  const restos = stroops % DOLAR;
  if (restos === 0n) return enteros.toString();
  const centavos = (restos * 100n) / DOLAR;
  return `${enteros}.${centavos.toString().padStart(2, "0")}`;
}
