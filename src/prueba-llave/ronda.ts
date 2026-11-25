import { roundTime } from "../protocol/quicknet-hora";
import { targetRound } from "../protocol/quicknet";

/**
 * La ronda con que se sella. 120 s son 60 de tope para el desbloqueo, 30 que pide el contrato, unos 20 para simular y
 * confirmar y 10 de margen.
 */
export const MARGEN_DE_LA_RONDA_S = 120;

/** Lo que tiene que quedar antes de pedir el desbloqueo, y lo que tiene que quedar después de que se dio. */
export const MINIMO_ANTES_DEL_DESBLOQUEO_S = 100;
export const MINIMO_DESPUES_DEL_DESBLOQUEO_S = 40;

/** Cuántos ledgers vive la firma que da la llave: unos 5 minutos, dentro de la guía de 12 a 60 y más corto que los 720 del kit. */
export const VIDA_DE_LA_FIRMA_LEDGERS = 60;

/** La primera ronda que nace al menos 120 s después de `ahoraS`. */
export function elegirRonda(ahoraS: number): number {
  return targetRound(ahoraS, MARGEN_DE_LA_RONDA_S);
}

/** ¿Queda al menos `minimoS` segundos entre `ahoraS` y el nacimiento de la ronda? */
export function quedaTiempo(ronda: number, ahoraS: number, minimoS: number): boolean {
  return roundTime(ronda) - ahoraS >= minimoS;
}

/** El ledger hasta el que vale la firma de la entrada. */
export function vencimientoDeLaFirma(ledger: number): number {
  return ledger + VIDA_DE_LA_FIRMA_LEDGERS;
}
