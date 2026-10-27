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
 * El tamaño de los chips con nombre (`chip()` de `stage.ts`) sobre el de 12 px de letra en una pantalla de 720 con
 * que nacieron: la letra de un chip a escala 1 es `12 * CHIP_SCALE * k`, 19 px en 720.
 */
export const CHIP_SCALE = 1.6;

/**
 * La escala más chica con que un chip con nombre cumple la regla en una pantalla de unidad `k`: lo que se le pasa
 * a `chip(nombre, escala)`, o el piso de un juego que achica sus nombres para que entren. En 1080 y en un celular
 * parado vale 0,97 (28 de 28,8 px y 17,3 de 17,8); en un celular girado, donde manda el piso de 16 px, más que 1.
 * Un juego nunca achica un nombre por debajo de esto: si no entra, muestra menos nombres o los acorta.
 */
export function escalaChipLegible(k: number, principal = false): number {
  return letraMinima(k, principal) / (12 * CHIP_SCALE * k);
}

/**
 * La unidad `k` de una pantalla de `sw` por `sh`: un píxel del diseño de 720 de alto, o lo que entre en un celular parado.
 * Es la `u()` de `stage.ts`, aparte para poder medir la regla sin una placa de video.
 */
export function unidadDePantalla(sw: number, sh: number): number {
  return sw < sh ? Math.min(sw / 420, sh / 900) : sh / 720;
}

/**
 * Un nombre «se lee» cuando su letra, en píxeles de pantalla, llega a la regla de la sala (`letraMinima`), con medio píxel
 * de margen por el redondeo. Es la vara de `audit-legible` y `audit-pantalla`: la letra (el tamaño de fuente por la escala
 * con que se dibuja), no el alto de la caja del texto, que con la interlínea es un cuarto más grande y dejaba pasar en
 * `audit-identidad` un nombre de 23 px de letra en 1080 que los otros dos rechazan (cierre del barrido, 26 de octubre
 * de 2026).
 */
export function seLee(letraPx: number, sw: number, sh: number): boolean {
  return Number.isFinite(letraPx) && letraPx >= letraMinima(unidadDePantalla(sw, sh)) - 0.5;
}

/**
 * El tamaño de un texto en unidades `k` que no baja de la regla: `diseño` es el
 * que el juego quiere (en `k`); `k` la unidad del juego en este momento.
 */
export function letraSala(diseño: number, k: number, principal = false): number {
  return Math.max(diseño, letraMinima(k, principal) / Math.max(k, 1e-6));
}
