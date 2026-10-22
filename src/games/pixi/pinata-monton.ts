/**
 * El montón de caramelos al pie de la piñata (puro: sin Pixi ni DOM).
 *
 * Hasta el 21 de octubre de 2026 el montón crecía por columnas: cada caramelo
 * que se quedaba quieto subía la suya un caramelo entero, y solo resbalaba si
 * la ladera era empinada. Con doscientos quedaban torres de treinta caramelos
 * en la pantalla grande y de casi cincuenta en el celular, un bosque de
 * columnas que llegaba al papel picado (revisión de juegos del 20 de octubre,
 * pantalla-5). Y algunos no se asentaban nunca: seguían deslizando en la
 * ladera con su nombre a cuestas (pantalla-9).
 *
 * Ahora el montón es de arena. El caramelo que se asienta rueda hacia la
 * columna vecina más baja mientras la suya quede más alta que ella por más del
 * talud, y ahí se queda. Cada caramelo sube su columna medio caramelo, no uno
 * entero: el montón tiene fondo, y unos quedan delante de otros. Y se asienta
 * siempre: cuando casi no se mueve, o un rato después de tocar el piso.
 */

export interface PileOptions {
  /** Cuánto sube una columna con cada caramelo, en caramelos. */
  step?: number;
  /** El desnivel que aguanta una columna con su vecina, en caramelos. */
  slope?: number;
  /** El ancho de una columna, en caramelos. */
  width?: number;
}

export interface Pile {
  /** La columna de un x. */
  colOf(x: number): number;
  /** El x del centro de una columna. */
  centerOf(col: number): number;
  /** La altura del montón en una columna, en píxeles (cero fuera del montón). */
  heightAt(col: number): number;
  /**
   * Un caramelo que se asienta en `col`: rueda hasta donde el talud lo deja,
   * suma su altura a esa columna y devuelve la columna y la altura del montón
   * que queda debajo de él. `side` desempata hacia dónde rueda cuando las dos
   * vecinas son igual de bajas (-1, a la izquierda).
   */
  settle(col: number, side: number): { col: number; base: number };
  /** La columna más alta, en píxeles. */
  peak(): number;
  /** Las columnas que tienen algo, con su altura en píxeles, de izquierda a derecha. */
  columns(): [number, number][];
  clear(): void;
}

/** Valores por omisión: medio caramelo por caramelo, talud de tres cuartos, columnas de un caramelo y medio. */
export const PILE_STEP = 0.5;
export const PILE_SLOPE = 0.75;
export const PILE_WIDTH = 1.6;

/**
 * El montón para caramelos de `size` píxeles, entre `minX` y `maxX` (las
 * paredes): un caramelo nunca rueda fuera de la pantalla.
 */
export function createPile(size: number, minX: number, maxX: number, opts: PileOptions = {}): Pile {
  const sz = Number.isFinite(size) && size > 0 ? size : 1;
  const cw = sz * (opts.width ?? PILE_WIDTH);
  const stepPx = sz * (opts.step ?? PILE_STEP);
  const slopePx = sz * (opts.slope ?? PILE_SLOPE);
  const colOf = (x: number): number => Math.floor((Number.isFinite(x) ? x : 0) / cw);
  const lo = colOf(Math.min(minX, maxX));
  const hi = Math.max(lo, colOf(Math.max(minX, maxX)));
  const heights = new Map<number, number>();
  const heightAt = (col: number): number => heights.get(col) ?? 0;
  const inside = (col: number): number => Math.min(hi, Math.max(lo, col));
  return {
    colOf,
    centerOf: (col) => (col + 0.5) * cw,
    heightAt,
    settle(col, side) {
      let c = inside(col);
      // Rueda mientras quedaría más alto que una vecina por más del talud. Cada
      // paso baja, así que termina; el tope es por las dudas.
      for (let guard = 0; guard < 4096; guard++) {
        const h = heightAt(c) + stepPx;
        const l = c > lo ? heightAt(c - 1) : Infinity;
        const r = c < hi ? heightAt(c + 1) : Infinity;
        const low = Math.min(l, r);
        if (!(h - low > slopePx)) break;
        c = l < r ? c - 1 : r < l ? c + 1 : side < 0 ? c - 1 : c + 1;
      }
      const base = heightAt(c);
      heights.set(c, base + stepPx);
      return { col: c, base };
    },
    peak: () => Math.max(0, ...heights.values()),
    columns: () => [...heights.entries()].sort((a, b) => a[0] - b[0]),
    clear: () => heights.clear(),
  };
}

/** A cuántos segundos del primer toque con el piso un caramelo se asienta, aunque siga moviéndose. */
export const SETTLE_AFTER = 1.2;

/**
 * Si un caramelo que está en el piso ya se asienta: cuando casi no se mueve
 * (`k` es la unidad de la pantalla), o cuando pasó `SETTLE_AFTER` desde que lo
 * tocó por primera vez. Antes también hacía falta que la ladera fuera suave, y
 * en un montón empinado había caramelos que no se asentaban nunca.
 */
export function shouldSettle(vx: number, k: number, sinceTouch: number): boolean {
  return Math.abs(vx) < 6 * k || sinceTouch >= SETTLE_AFTER;
}
