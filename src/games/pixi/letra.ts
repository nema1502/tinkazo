/**
 * La regla de la letra de la sala, aparte de `stage.ts` para poder probarla sin
 * una placa de video (la mide `scripts/audit-legible.mjs`; el porqué está en
 * `docs/marca.md`, "La letra").
 *
 * Lo que cuenta es el ángulo de la altura de la x, así que la regla es la misma
 * en un proyector y en un celular: a 1080 de alto (un proyector visto desde el
 * fondo de la sala) lo secundario mide 28 px y lo principal 48, que son el 2,6 %
 * y el 4,4 % del alto; en un celular parado, 16 y 22. Los juegos dibujan en
 * unidades `k` (un píxel del diseño de 720 de alto, 1,5 en 1080): 18,7 y 32.
 */
export const LEGIBLE = {
  /** Lo secundario (nombres, marcador, escena) y lo principal (el cartel del ganador), en unidades `k`. */
  sec: 28 / 1.5,
  prin: 48 / 1.5,
  /** Lo que nunca baja en píxeles de pantalla, aunque `k` sea chico (un celular parado o girado). */
  secPx: 16,
  prinPx: 22,
  /** Como parte del alto de la pantalla: lo que `audit-identidad` pide para dar un nombre por leído. */
  fraccionSec: 0.026,
  fraccionPrin: 0.044,
} as const;

/** La letra mínima de la sala, en píxeles de pantalla, para la unidad `k` del juego. */
export function letraMinima(k: number, principal = false): number {
  return principal ? Math.max(LEGIBLE.prinPx, LEGIBLE.prin * k) : Math.max(LEGIBLE.secPx, LEGIBLE.sec * k);
}

/**
 * El tamaño de un texto en unidades `k` que no baja de la regla: `diseño` es el
 * que el juego quiere (en `k`); `k` la unidad del juego en este momento.
 */
export function letraSala(diseño: number, k: number, principal = false): number {
  return Math.max(diseño, letraMinima(k, principal) / Math.max(k, 1e-6));
}
