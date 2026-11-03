/**
 * La geometría de las fichas de nombre de la carrera, pura (sin Pixi): cuándo dos se pisan, cómo se mete una en lo que se ve de la
 * pantalla y dónde se acomoda una que pisa a otra. `carrera.ts` la llama una vez por cuadro, de la ficha que más manda a la que menos.
 */

/** Una caja en el mundo: de `x0,y0` (arriba a la izquierda) a `x1,y1`. */
export interface CajaF {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Dos fichas se pisan cuando lo que tapa una a la otra pasa de esta parte de la más chica. */
export const PISA_MAX = 0.1;
/** A cuántos renglones de su llama puede correrse una ficha para no pisar a otra: más lejos ya no se sabe de quién es. */
export const RENGLONES_MAX = 2;

const area = (a: CajaF): number => (a.x1 - a.x0) * (a.y1 - a.y0);

/** La parte de la más chica de las dos que tapa la otra (0 si no se tocan). */
export function pisadura(a: CajaF, b: CajaF): number {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ox <= 0 || oy <= 0) return 0;
  const chica = Math.min(area(a), area(b));
  return chica > 0 ? (ox * oy) / chica : 0;
}

/** ¿Esta caja pisa a alguna de las ya puestas más del 10 % de la más chica? */
export const pisaA = (a: CajaF, puestas: readonly CajaF[]): boolean => puestas.some((b) => pisadura(a, b) > PISA_MAX);

/**
 * Cuánto hay que correr la caja para que entre entera en `lim`. `null` si no cabe (es más grande que lo que se ve) o si habría que
 * correrla más de tres cuartos de su ancho a un costado, o más de dos renglones (de su alto) hacia arriba o abajo.
 */
export function metida(r: CajaF, lim: CajaF): { dx: number; dy: number } | null {
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  if (w > lim.x1 - lim.x0 || h > lim.y1 - lim.y0) return null;
  let dx = 0, dy = 0;
  if (r.x0 < lim.x0) dx = lim.x0 - r.x0;
  else if (r.x1 > lim.x1) dx = lim.x1 - r.x1;
  if (r.y0 < lim.y0) dy = lim.y0 - r.y0;
  else if (r.y1 > lim.y1) dy = lim.y1 - r.y1;
  if (Math.abs(dx) > 0.75 * w || Math.abs(dy) > RENGLONES_MAX * 0.9 * h) return null;
  return { dx, dy };
}

/**
 * Cuánto correr la caja hacia arriba o abajo para que no pise a ninguna de las `puestas`: un renglón arriba, uno abajo (o dos arriba
 * primero, si `primeroArriba`: sobre la cabeza de su llama, abajo taparía a su propia llama) y así hasta `RENGLONES_MAX`, siempre
 * dentro de `lim`. `yaCorrido` es lo que la caja ya se corrió de su lugar natural (por ejemplo al meterla en la pantalla): cuenta
 * para el tope de renglones. `null` si no cabe en ninguno.
 */
export function sitioLibre(r: CajaF, puestas: readonly CajaF[], lim: CajaF, primeroArriba = false, yaCorrido = 0): number | null {
  const paso = (r.y1 - r.y0) * 1.0 + 1;
  const saltos = primeroArriba ? [-1, -2, 1, 2] : [-1, 1, -2, 2];
  for (const j of saltos.slice(0, RENGLONES_MAX * 2)) {
    const c = { ...r, y0: r.y0 + j * paso, y1: r.y1 + j * paso };
    if (Math.abs(yaCorrido + j * paso) > RENGLONES_MAX * paso + 0.01 || c.y0 < lim.y0 || c.y1 > lim.y1 || pisaA(c, puestas)) continue;
    return j * paso;
  }
  return null;
}
