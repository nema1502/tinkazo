/**
 * El azar del kit: el mismo de todos los juegos, sin depender del estadio.
 *
 * Todo sale de la ronda. La misma ronda cuenta la misma historia en cualquier
 * equipo, y por eso ningún juego usa `Math.random` (lo mira `audit-rigor`).
 * Las cuentas son las de `stage.ts` (`seeded` y `hash`): acá viven aparte para
 * poder probar el kit en Node sin cargar PixiJS.
 */

/** Un azar que depende solo de sus argumentos: para lo que se calcula desde la hora. */
export function hashDe(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Un generador sembrado: de la misma semilla, la misma secuencia. */
export function sembrar(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** La semilla numérica de una ronda: los primeros ocho dígitos de su `randomness`. */
export const semillaDe = (ronda: string): number => parseInt(ronda.slice(0, 8), 16) | 0;

/** Un número de 32 bits para un texto (FNV-1a): mismo texto, mismo número. */
export function hashTexto(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Un azar de 0 a 1 que depende solo de la ronda y de una etiqueta: no gasta el `rng` del juego. */
export const azarDe = (ronda: string, etiqueta: string): number => hashDe(semillaDe(ronda), hashTexto(etiqueta));

export const acotar = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
