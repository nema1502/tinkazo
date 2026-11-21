/**
 * El saldo de la empresa, leído de la red con `mirarCuenta` de
 * `src/stellar/usdc-cuenta.ts` (la misma lectura que usa el sitio para saber si
 * una cuenta puede recibir dólares digitales). Nunca lanza: lo que no se pudo
 * leer es un estado, y la página lo dice.
 */

import { type NetworkName } from "../stellar/config";
import { stroopsDe } from "../stellar/pagos";
import { mirarCuenta, usdcDeLaRed, type CuentaMirada, type OpcionesDeLectura } from "../stellar/usdc-cuenta";

/** Los siete decimales de un monto de Horizon. */
const siete = (m: string): string => {
  const [e = "0", d = ""] = m.split(".");
  return `${e}.${d.padEnd(7, "0").slice(0, 7)}`;
};

export type SaldoDeLaEmpresa =
  | { tipo: "ok"; saldo: bigint }
  | { tipo: "sin-cuenta" }
  | { tipo: "sin-linea" }
  | { tipo: "sin-red" };

/** Qué pasó con la lectura del saldo de la cuenta de la empresa: siempre un estado, nunca un lanzamiento. */
export async function saldoDeLaEmpresa(red: NetworkName, cuenta: string, op: OpcionesDeLectura = {}): Promise<SaldoDeLaEmpresa> {
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

/** La cuenta en bruto, para cuando el panel quiere ver sus firmantes o su secuencia. */
export type { CuentaMirada };
