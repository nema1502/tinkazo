import { FINALISTAS, PELOTON_MAX, PELOTON_MIN, duracionPeloton } from "./games/llamas/peloton-plan";

/**
 * Cuánto dura la carrera según cuánta gente corre.
 *
 * Los demás juegos duran lo mismo con dos o con doscientas personas (`PACES`
 * en `state.ts`). La carrera de hasta 30 no: con el pelotón que se echa tiene
 * más para mostrar cuanta más gente hay, y el selector de duración lo dice.
 * Es más contenido y no cámara lenta: el tope de estiramiento sigue siendo el
 * de siempre, y cada ritmo se mide con el mismo auditor.
 *
 * Puro y sin DOM: lo usan el juego, las etiquetas del selector y los auditores
 * (`scripts/audit-rigor.mjs` lo importa para saber qué prometer).
 */

/** Los segundos de la carrera entre los ocho, sin estirar (`DUR` en `pixi-race.ts`). */
export const CARRERA_FINAL = 15;
/** Lo que tardan en entrar los ocho carriles antes de la cuenta: `FINALISTAS * P_LANE + P_TAIL`. */
export const CARRERA_CARRILES = FINALISTAS * 0.5 + 0.7;
/** La cuenta de la largada y el sostén del cartel: segundos reales que no se estiran. */
export const CARRERA_FIJOS = 6;
/** Cuánto se estira el contenido en "Normal" (el ritmo con que se mira el pelotón). */
const ESTIRON = 1.15;

/** Si el pelotón corre con esta cantidad de personas. */
export const hayPeloton = (n: number): boolean => n >= PELOTON_MIN && n <= PELOTON_MAX;

/**
 * Lo que dura la carrera en "Normal" con `n` personas, en segundos de show
 * sin contar el 3, 2, 1 de la sala; o `null` si no cambia (con 8 o menos y con
 * más de 30 sigue valiendo el de todos los juegos).
 *
 * Sale de lo que de verdad hay para ver: el pelotón, la presentación de los
 * carriles y la final, estirados un 15 % y sumados los segundos fijos. Redondea
 * a múltiplos de 1 para que la etiqueta no baile.
 */
export function normalCarrera(n: number): number | null {
  if (!hayPeloton(n)) return null;
  return Math.round((duracionPeloton(n) + CARRERA_CARRILES + CARRERA_FINAL) * ESTIRON + CARRERA_FIJOS);
}

/** Lo que promete cada posición del selector si "Normal" dura `normal` segundos. */
export function segundosDe(pace: "rapido" | "normal" | "epico", normal: number): number {
  if (pace === "normal") return normal;
  if (pace === "rapido") return Math.max(20, Math.round(normal / 2));
  return Math.round(normal * 1.18);
}
