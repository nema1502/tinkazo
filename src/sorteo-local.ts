import { hexToBytes } from "./protocol/quicknet";
import { select } from "./protocol/select";

/**
 * El resultado de un sorteo, calculado en el navegador con lo que quedó sellado y el número público ya comprobado.
 *
 * Es el único camino de cálculo de la pantalla: el modo libre y el sorteo con sello usan este mismo. Con sello, el
 * contrato hace la misma cuenta (protocolo §4 y §5) con la misma huella, la misma cantidad, los mismos ganadores y la
 * misma ronda, así que no puede dar otro resultado. Por eso el juego puede arrancar apenas el número está comprobado,
 * sin esperar a que el sorteo quede grabado, y al grabarlo se comparan los dos (`grabar-sorteo.ts`).
 */

/** Lo sellado que decide el resultado, además del número: la huella de la lista, cuántas personas y cuántos ganan. */
export interface LoSellado {
  /** `list_hash` en hex (protocolo §1). */
  listHash: string;
  /** Cuántas entradas tiene la lista sellada. */
  count: number;
  /** Cuántos ganan, tal como se selló. */
  numWinners: number;
}

/**
 * Los puestos de quienes ganan, en el orden de los premios. `randomness` es `sha256(firma)` en hex, de una firma ya
 * verificada. Lanza si lo sellado no tiene sentido: un sello así no puede existir, y elegir igual sería inventar.
 */
export function resultadoDelSello(sello: LoSellado, numero: { randomness: string }): number[] {
  const { count, numWinners } = sello;
  if (!Number.isInteger(count) || count < 1) throw new Error("lo sellado no tiene personas");
  if (!Number.isInteger(numWinners) || numWinners < 1 || numWinners > count) throw new Error("lo sellado no tiene una cantidad de ganadores posible");
  return select(hexToBytes(numero.randomness), hexToBytes(sello.listHash), count, numWinners);
}
