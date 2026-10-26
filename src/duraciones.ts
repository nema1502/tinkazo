import { FINALISTAS, FIJOS, TARJETA, normalDe } from "./games/llamas/carrera-duracion";

/**
 * Cuánto dura la carrera según cuánta gente corre.
 *
 * Los demás juegos duran lo mismo con dos o con doscientas personas (`PACES`
 * en `state.ts`). La carrera no: con el grupo que se va echando (y, con más de
 * 30, las tandas que lo arman) tiene más para mostrar cuanta más gente hay, y el
 * selector de duración lo dice. Es más contenido y no cámara lenta: el tope de
 * estiramiento sigue siendo el de siempre, y cada ritmo se mide con el mismo
 * auditor (`audit-rigor`, que no deja pasar de 90 s con ninguna cantidad).
 *
 * Puro y sin DOM: lo usan el juego, las etiquetas del selector y los auditores
 * (`scripts/audit-rigor.mjs` lo importa para saber qué prometer).
 */

/** Los segundos que no se estiran: el sostén del cartel de quien gana y la cuenta de la sala. */
export const CARRERA_FIJOS = FIJOS;
/** La tarjeta de "cómo se juega", que cuenta dentro del total de "Normal". */
export const CARRERA_TARJETA = TARJETA;

/** Si hay grupo que se echa: con 9 o más. Con 8 o menos corren las ocho (o las que sean) directo a la recta. */
export const hayPeloton = (n: number): boolean => n > FINALISTAS;

/**
 * Lo que dura la carrera en "Normal" con `n` personas, en segundos de show sin
 * contar el 3, 2, 1 de la sala; o `null` si no hay a quién contar (menos de
 * dos). Sale de lo que de verdad hay para ver: el vuelo y los nombres, las
 * tandas si las hay, el grupo que se echa y la recta, más lo que no se estira.
 * Redondea a segundos enteros para que la etiqueta no baile.
 */
export function normalCarrera(n: number): number | null {
  if (!(n >= 2)) return null;
  return normalDe(n);
}

/**
 * Lo que promete cada posición del selector si "Normal" dura `normal` segundos.
 * Rápido no es la mitad: la carrera se echa de a una, con 1 s como mínimo entre
 * echada y echada, y por debajo de un 0,85 del tiempo nominal la que se echa ya
 * no se ve (regla del niño). Épico, un 18 % más.
 */
export function segundosDe(pace: "rapido" | "normal" | "epico", normal: number): number {
  if (pace === "normal") return normal;
  if (pace === "rapido") return Math.max(20, Math.round(normal * 0.9));
  return Math.round(normal * 1.18);
}
