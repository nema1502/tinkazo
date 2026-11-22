/**
 * El saldo de la cuenta que tiene el premio de la campaña, leído de la red con `mirarCuenta` de
 * `src/stellar/usdc-cuenta.ts` (la misma lectura que usa el sitio para saber si una cuenta puede recibir dólares
 * digitales). Nunca lanza: lo que no se pudo leer es un estado, y el stand lo dice.
 *
 * Es la misma lectura del saldo que el panel de la empresa (issue #183, `src/empresa/saldo.ts` en su rama): esa
 * pieza no está en esta rama todavía, así que el stand lleva la suya con los mismos estados. Cuando se junten las
 * ramas, este módulo se puede cambiar por el del panel.
 */

import type { NetworkName } from "../stellar/config";
import { stroopsDe } from "../stellar/pagos";
import { mirarCuenta, usdcDeLaRed, type OpcionesDeLectura } from "../stellar/usdc-cuenta";

export type EstadoDeSaldo =
  | { tipo: "ok"; saldo: bigint }
  | { tipo: "sin-cuenta" }
  | { tipo: "sin-linea" }
  | { tipo: "sin-red" };

/** Los siete decimales de un monto de Horizon. */
const siete = (m: string): string => {
  const [e = "0", d = ""] = m.split(".");
  return `${e}.${d.padEnd(7, "0").slice(0, 7)}`;
};

/** Qué pasó con la lectura del saldo de la cuenta del premio: siempre un estado, nunca un lanzamiento. */
export async function saldoDeLaCuenta(red: NetworkName, cuenta: string, op: OpcionesDeLectura = {}): Promise<EstadoDeSaldo> {
  const lectura = await mirarCuenta(red, cuenta, op);
  if (lectura === "sin-red") return { tipo: "sin-red" };
  if (lectura === "no-existe") return { tipo: "sin-cuenta" };
  const usdc = usdcDeLaRed(red);
  const linea = lectura.saldos.find((l) => l.code === usdc.code && l.issuer === usdc.issuer);
  if (!linea) return { tipo: "sin-linea" };
  return { tipo: "ok", saldo: stroopsDe(siete(linea.saldo)) };
}

/** ¿Le alcanza el saldo para lo que la campaña pide? Con saldo igual, le alcanza. */
export function leAlcanza(saldo: bigint, total: bigint): { tipo: "alcanza" } | { tipo: "falta"; falta: bigint } {
  if (!(total <= saldo)) return { tipo: "falta", falta: total - saldo };
  return { tipo: "alcanza" };
}
