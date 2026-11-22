/**
 * Cuándo se publica cada ronda de drand quicknet: solo la cuenta del tiempo, sin la curva ni el cálculo de la semilla.
 *
 * Vive aparte de `quicknet.ts` porque ese archivo trae `@noble/hashes` y la página del celular, que solo necesita saber a
 * qué hora es una ronda, no puede cargarlo. `quicknet.ts` reexporta todo esto: no hay dos cuentas.
 */

/** Instante (Unix, segundos) en que nace la ronda 1 de la cadena. */
export const GENESIS_TIME = 1_692_803_367;

/** Segundos entre una ronda y la siguiente. */
export const PERIOD = 3;

/** Instante (Unix, segundos) en que se publica una ronda. La ronda 1 nace en el génesis. */
export function roundTime(round: number): number {
  return GENESIS_TIME + (Math.max(1, round) - 1) * PERIOD;
}

/** Ronda vigente en un instante (Unix, segundos). */
export function roundAt(timestamp: number): number {
  if (timestamp < GENESIS_TIME) return 1;
  return Math.floor((timestamp - GENESIS_TIME) / PERIOD) + 1;
}
