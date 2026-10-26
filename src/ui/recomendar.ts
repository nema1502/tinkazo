import { JUEGOS } from "../games/pixi/kit/catalogo";
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

/**
 * Los ocho juegos del selector, en el orden de sus botones (`GAME_BUTTONS` en
 * `freeze.ts`): el de la auditoría, de las salas chicas a las grandes. De pie y
 * El Trueque salieron el 26 de octubre de 2026: siguen abriendo con `?demo=`.
 */
const SELECTOR_BASE: readonly Game[] = [
  "race", "sapo", "trompo", "chovena", "pinata", "wheel", "teleferico", "oruro",
];

/** Los ocho y, al final, los del kit que ya se encendieron (`kit/catalogo.ts`). */
export const SELECTOR: readonly Game[] = [...SELECTOR_BASE, ...JUEGOS.filter((j) => j.selector && !SELECTOR_BASE.includes(j.id)).map((j): Game => j.id)];

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
 * Sin entrada, el juego no tiene rango claro y queda neutral. Piñata, De pie y
 * La Entrada (`oruro`) no están entre los ocho de la auditoría: sus rangos son
 * los de `docs/juegos.md` (25 de octubre de 2026) y no traen ideal ni puntaje.
 * Sin `ideal`, todo su tramo cae del lado «alto» de la nota, y sin puntaje se
 * recomiendan al final: nunca antes de un juego con ideal, y el juego de
 * siempre sigue siendo el que era. La piñata solo tiene tope (anda con dos
 * personas), así que queda neutral. De pie va de 8 a 100: el doc lo prueba
 * hasta 200, pero pasados unos 100 el nombre de cada carta no se lee desde el
 * fondo de la sala (evaluador, 26 de octubre de 2026). Y pide que la lista
 * sea la gente de la sala: el aviso de la sección 7.5 para cuando no lo es
 * todavía no está, y por eso su nota lo dice. La Entrada se pensó de 30 a 200:
 * con menos anda, con pocas fraternidades. Ruleta tiene solo tope: el WHEEL_MAX de state.ts, 200 desde que reparte la
 * lista en gajos (21 de octubre de 2026; la sección 5 decía 24). No se importa de
 * state.ts porque ese módulo lee `location` al cargar: una prueba compara los dos.
 */
const RANGOS_BASE: Partial<Record<Game, Rango>> = {
  // La carrera llega a 200 desde el 26 de octubre de 2026: con 9 a 30 salen todas y se van echando de a una; con más, pasa por tandas.
  race: { minimo: 2, ideal: [4, 30], maximo: 200, meta: 7.0 },
  sapo: { minimo: 2, ideal: [6, 12], maximo: 40, meta: 7.1 },
  trompo: { minimo: 2, ideal: [5, 14], maximo: 14, meta: 6.3 },
  chovena: { minimo: 8, ideal: [12, 60], maximo: 80, meta: 7.9 },
  teleferico: { minimo: 16, ideal: [30, 150], maximo: 200, meta: 7.1 },
  wheel: { maximo: 200 },
  pinata: { maximo: 200 },
  oruro: { minimo: 30, maximo: 200 },
};

/** Los rangos de la tabla y los de los juegos del kit encendidos; la tabla manda. */
export const RANGOS: Partial<Record<Game, Rango>> = {
  ...Object.fromEntries(JUEGOS.filter((j) => j.selector).map((j) => [j.id, j.rango])),
  ...RANGOS_BASE,
};

/** El rango de personas que muestra el selector bajo el nombre: el ideal si lo tiene, y si no, del mínimo al máximo ("6–12"). */
export function rangoVisible(game: Game): string | null {
  const r = RANGOS[game];
  if (!r) return null;
  const desde = r.ideal?.[0] ?? r.minimo ?? 2;
  const hasta = r.ideal?.[1] ?? r.maximo;
  return hasta === undefined ? null : `${desde}–${hasta}`;
}

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

/**
 * Los carriles de la recta final de la carrera: con más premios que carriles, los que no entran se echarían del
 * grupo y después se anunciarían ganadores. Es `FINALISTAS` de `games/llamas/carrera-base.ts` (una prueba compara
 * los dos: ese módulo no se importa acá porque este viaja con la portada).
 */
export const CARRILES_CARRERA = 8;

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

function evaluar(game: Game, n: number, premios = 1): Recomendacion {
  const r = RANGOS[game];
  const args = [n, r?.minimo ?? 0, r?.maximo ?? 0];
  if (!r) return { game, fits: null, ideal: false, note: null, args };
  // Cada premio es un carril de la recta: con más de ocho, la carrera echaría a quien después anuncia como ganadora.
  if (game === "race" && premios > CARRILES_CARRERA) return { game, fits: false, ideal: false, note: "rec.race.premios", args: [n, premios, CARRILES_CARRERA] };
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

/** El juego que sale elegido cuando nadie eligió otro (`app.game` en state.ts). */
export const JUEGO_DE_SIEMPRE: Game = "race";

/**
 * El juego que queda elegido para `n` personas si quien organiza no eligió
 * otro: el de siempre si encaja, y si no, el primero que se recomienda (el del
 * ideal y, entre esos, el de mejor puntaje). Si ninguno encaja, el de siempre.
 *
 * Hasta el 21 de octubre de 2026, con 20 personas quedaba elegida la carrera,
 * que llega hasta 8 y no estaba entre los recomendados, mientras los cuatro de
 * arriba del selector sí (D02, de la evaluación crítica de experiencia).
 */
export function juegoPorDefecto(n: number, premios = 1): Game {
  const r = recomendar(n, premios).games;
  // Hasta 30 sale la carrera sola; con más encaja (pasa por tandas) pero no es lo ideal: se recomienda otro primero.
  if (n <= 30 && r.find((x) => x.game === JUEGO_DE_SIEMPRE)?.fits === true) return JUEGO_DE_SIEMPRE;
  // Si ninguno encaja, el de siempre, salvo que no entren los premios: ahí el primero del selector que no sea la carrera.
  return r.find((x) => x.fits === true)?.game ?? (premios > CARRILES_CARRERA ? (r.find((x) => x.game !== JUEGO_DE_SIEMPRE)?.game ?? JUEGO_DE_SIEMPRE) : JUEGO_DE_SIEMPRE);
}

/**
 * El juego que sigue para el próximo premio: otro de los que encajan con `n`
 * personas, el que viene después de `actual` en el orden de la recomendación
 * (y vuelve al primero al llegar al último). Así un evento con varios premios
 * no repite el mismo juego sin que nadie tenga que elegir (24 de octubre de
 * 2026: "seguir sorteando y seguir jugando, viendo juegos"). Si ninguno
 * encaja, o encaja uno solo, queda `actual`. Siempre el mismo para la misma
 * entrada: no hay azar.
 */
export function juegoSiguiente(n: number, actual: Game, premios = 1): Game {
  const buenos = recomendar(n, premios).games.filter((x) => x.fits === true).map((x) => x.game);
  if (!buenos.length) return actual;
  const i = buenos.indexOf(actual);
  return buenos[(i + 1) % buenos.length] ?? actual;
}

/**
 * Qué juegos del selector sirven para `n` personas, con su nota y la duración
 * de la sección 8.2. `n` se toma entero y nunca negativo. `premios` (uno, si no
 * se dice) solo le importa a la carrera: con más de ocho no encaja.
 */
export function recomendar(n: number, premios = 1): Recomendaciones {
  const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const p = Number.isFinite(premios) ? Math.max(1, Math.floor(premios)) : 1;
  const games = SELECTOR.map((g) => evaluar(g, k, p)).sort(ordenar);
  const tramo = VENTANA_NORMAL.find(({ personas: [de, a] }) => k >= de && k <= a);
  return {
    games,
    duracionNormal: tramo ? { desde: tramo.seg[0], hasta: tramo.seg[1] } : null,
  };
}
