import { stroopsDe } from "../stellar/pagos";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";

/**
 * El premio en la cuenta de quien organiza, antes de abrir la inscripción: una sola línea en el panel que dice si los dólares
 * digitales del premio están o cuánto falta. Es solo información: no frena nada ni suma ningún botón.
 *
 * La lectura es la de `saldo-dolares.ts`, que ya resta lo comprometido en ofertas abiertas y no cuenta una línea que el emisor
 * no autorizó. Con una lectura que falló no se afirma nada.
 */

export type EstadoDelDeposito =
  /** El saldo libre cubre el premio. */
  | { tipo: "alcanza"; total: bigint }
  /** Falta esto, en unidades mínimas, para cubrir el premio. */
  | { tipo: "falta"; falta: bigint }
  /** No se pudo leer: la línea no dice nada. */
  | { tipo: "sin-lectura" };

/** Lo que el panel necesita de afuera: leer cuántos dólares digitales puede usar una cuenta. */
export interface DepsDeDeposito {
  leer: (cuenta: string) => Promise<SaldoDeDolares>;
}

/** Con la lectura de la cuenta y el total de los premios (en unidades mínimas), qué se puede decir. Nunca lanza. */
export function estadoDelDeposito(lectura: SaldoDeDolares, total: bigint): EstadoDelDeposito {
  if (total <= 0n || lectura.tipo === "sin-red") return { tipo: "sin-lectura" };
  // Sin cuenta, o sin línea de dólares digitales (o con la línea sin autorizar), no hay nada en ella: falta todo.
  if (lectura.tipo === "sin-cuenta" || lectura.tipo === "sin-linea") return { tipo: "falta", falta: total };
  if (!/^\d{1,15}(?:\.\d{1,7})?$/u.test(lectura.saldo)) return { tipo: "sin-lectura" };
  const tiene = stroopsDe(lectura.saldo);
  return tiene >= total ? { tipo: "alcanza", total } : { tipo: "falta", falta: total - tiene };
}

/** La lectura de verdad: Horizon de la red principal, que se baja recién cuando hace falta. */
export function depsDeDepositoReales(): DepsDeDeposito {
  return {
    leer: async (cuenta) => {
      const { leerSaldoDeDolares } = await import("../stellar/saldo-dolares");
      return leerSaldoDeDolares(cuenta);
    },
  };
}
