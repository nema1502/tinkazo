import type { Game } from "../state";

/**
 * El selector recomienda según la cantidad de personas (auditoría de juegos,
 * sección 8.1, con los rangos de la sección 6 y la duración de la 8.2).
 *
 * Función pura: sin DOM ni idioma. Devuelve claves de nota y los números que
 * las completan; el texto lo pone la interfaz, en español y en inglés.
 *
 * Reglas, en orden:
 * - Por encima del máximo, el juego no encaja: se atenúa y dice por qué.
 * - Sin mínimo en la auditoría, no se recomienda ni se atenúa: queda neutral.
 * - Por debajo del mínimo, no encaja.
 * - Entre el mínimo y el máximo, encaja (Recomendado). Dentro del ideal, además va primero.
 * - Entre los que encajan, primero los del ideal, y después el puntaje de la
 *   sección 5. Ese puntaje es una meta sin probar: solo desempata.
 */

/** Los juegos del selector, en el orden de sus botones (`GAME_BUTTONS` en `freeze.ts`). */
export const SELECTOR: readonly Game[] = [
  "race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien",
];

export interface Rango {
  /** Mínimo real: con menos, el juego no se sostiene. */
  minimo?: number;
  /** El tramo en que el juego luce: el ideal para la lista. */
  ideal?: readonly [number, number];
  /** Máximo: con más, no se ofrece o no se ve. */
  maximo?: number;
  /** Puntaje de la sección 5 ("meta, sin probar"). Solo desempata. */
  meta?: number;
}

/**
 * Lo que dice la auditoría (sección 6) para cada juego del selector hoy.
 *
 * Sin entrada, el juego no tiene rango claro. Piñata y Carnaval de Oruro
 * (la versión de hoy, no La Entrada), Aguayo, Constelación y ¿Quién es? (la
 * versión de hoy, no De pie) quedan así: el rango de su reemplazo no es el
 * suyo. Ruleta tiene solo tope: el WHEEL_MAX de state.ts, 200 desde que reparte la
 * lista en gajos (21 de octubre de 2026; la sección 5 decía 24). No se importa de
 * state.ts porque ese módulo lee `location` al cargar: una prueba compara los dos.
 */
export const RANGOS: Partial<Record<Game, Rango>> = {
  race: { minimo: 2, ideal: [4, 8], maximo: 8, meta: 7.0 },
  sapo: { minimo: 2, ideal: [6, 12], maximo: 40, meta: 7.1 },
  trompo: { minimo: 2, ideal: [5, 14], maximo: 14, meta: 6.3 },
  chovena: { minimo: 8, ideal: [12, 60], maximo: 80, meta: 7.9 },
  teleferico: { minimo: 16, ideal: [30, 150], maximo: 200, meta: 7.1 },
  wheel: { maximo: 200 },
};

/**
 * La duración de la sección 8.2 para "Normal", en segundos, por tramo de
 * personas. No se muestra todavía: `state.ts` dice 38 s para Normal desde el 17
 * de octubre de 2026, y la ventana de 24 a 34 no cabe ahí (ver el informe).
 */
const VENTANA_NORMAL: ReadonlyArray<{ personas: readonly [number, number]; seg: readonly [number, number] }> = [
  { personas: [2, 8], seg: [24, 24] },
  { personas: [9, 20], seg: [26, 28] },
  { personas: [21, 50], seg: [28, 30] },
  { personas: [51, 100], seg: [30, 32] },
  { personas: [101, 200], seg: [32, 34] },
];

export interface Recomendacion {
  game: Game;
  /** `true`: encaja (Recomendado). `false`: no encaja (se atenúa). `null`: sin rango claro (neutral). */
  fits: boolean | null;
  /** Dentro del ideal de la sección 6. */
  ideal: boolean;
  /** Clave de la nota (`rec.<juego>.<lado>`), o `null` si no hay nota que decir. */
  note: string | null;
  /** Lo que completa la nota: la cantidad, el mínimo y el máximo del juego. */
  args: number[];
}

export interface Recomendaciones {
  /**
   * Todos los del selector. Primero los que encajan (los del ideal antes, y
   * después por puntaje), luego los neutrales, y al final los que no encajan.
   * Dentro de cada grupo, el orden del selector.
   */
  games: Recomendacion[];
  /** La duración de la sección 8.2 en Normal, o `null` fuera de 2 a 200. */
  duracionNormal: { desde: number; hasta: number } | null;
}

function evaluar(game: Game, n: number): Recomendacion {
  const r = RANGOS[game];
  const args = [n, r?.minimo ?? 0, r?.maximo ?? 0];
  if (!r) return { game, fits: null, ideal: false, note: null, args };
  if (r.maximo !== undefined && n > r.maximo) return { game, fits: false, ideal: false, note: `rec.${game}.largo`, args };
  if (r.minimo === undefined) return { game, fits: null, ideal: false, note: null, args };
  if (n < r.minimo) return { game, fits: false, ideal: false, note: `rec.${game}.corto`, args };
  const [ideNo, ideSi] = r.ideal ?? [0, 0];
  const ideal = n >= ideNo && n <= ideSi && !!r.ideal;
  const lado = ideal ? "ideal" : n < ideNo ? "bajo" : "alto";
  return { game, fits: true, ideal, note: `rec.${game}.${lado}`, args };
}

/** Dónde encaja el juego: 0 los que encajan, 1 los neutrales, 2 los que no. */
const grupo = (r: Recomendacion): number => (r.fits === true ? 0 : r.fits === null ? 1 : 2);
const indice = (g: Game): number => SELECTOR.indexOf(g);
const meta = (g: Game): number => RANGOS[g]?.meta ?? -1;

function ordenar(a: Recomendacion, b: Recomendacion): number {
  const ga = grupo(a);
  const gb = grupo(b);
  if (ga !== gb) return ga - gb;
  if (ga === 0) {
    return Number(b.ideal) - Number(a.ideal) || meta(b.game) - meta(a.game) || indice(a.game) - indice(b.game);
  }
  return indice(a.game) - indice(b.game);
}

/**
 * Qué juegos del selector sirven para `n` personas, con su nota y la duración
 * de la sección 8.2. `n` se toma entero y nunca negativo.
 */
export function recomendar(n: number): Recomendaciones {
  const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const games = SELECTOR.map((g) => evaluar(g, k)).sort(ordenar);
  const tramo = VENTANA_NORMAL.find(({ personas: [de, a] }) => k >= de && k <= a);
  return {
    games,
    duracionNormal: tramo ? { desde: tramo.seg[0], hasta: tramo.seg[1] } : null,
  };
}
