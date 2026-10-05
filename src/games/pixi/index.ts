import { playableGame, type Beacon, type Game } from "../../state";
import { PixiInitError, warmPixi } from "./stage";

/**
 * Qué juegos tienen versión en el motor nuevo, y cómo se lanzan.
 *
 * El sitio pregunta acá primero (salvo con `?motor=clasico` o sin WebGL, ver
 * `../engine.ts`); si el juego no tiene versión nueva, sigue con la de
 * siempre. Cada versión se carga recién cuando se pide.
 */
type Launch = (names: string[], winners: readonly number[], beacon: Beacon, done: () => void) => Promise<void>;

const PIXI: Partial<Record<Game, () => Promise<Launch>>> = {
  race: async () => {
    const m = await import("../llamas/pixi-race");
    return (n, w, b, d) => m.llamasPixi(n, w, b, d, "andes");
  },
  wheel: async () => (await import("./wheel")).wheelPixi,
  tombola: async () => (await import("./tombola")).tombolaPixi,
  trompo: async () => (await import("./trompo")).trompoPixi,
  pinata: async () => (await import("./pinata")).pinataPixi,
  sapo: async () => (await import("./sapo")).sapoPixi,
  quien: async () => (await import("./quien")).quienPixi,
  oruro: async () => (await import("./oruro")).oruroPixi,
  luz: async () => (await import("./luz")).luzPixi,
  chovena: async () => (await import("./chovena")).chovenaPixi,
  totora: async () => {
    const m = await import("../llamas/pixi-race");
    return (n, w, b, d) => m.llamasPixi(n, w, b, d, "lago");
  },
  teleferico: async () => (await import("./cablecar")).cableCarPixi,
  pasanaku: async () => (await import("./pasanaku")).pasanakuPixi,
  ledger: async () => (await import("./ledger")).ledgerPixi,
  stellar: async () => (await import("./constellation")).constellationPixi,
  rockets: async () => {
    const m = await import("../llamas/pixi-race");
    return (n, w, b, d) => m.llamasPixi(n, w, b, d, "stellar");
  },
};

/**
 * Baja el juego y lo que PixiJS pide recién al arrancar, sin crear nada.
 * Ver `preloadGame` en `../engine.ts`.
 */
export async function preloadPixi(game: Game): Promise<void> {
  await Promise.all([PIXI[game]?.(), warmPixi()]);
}

/** `true` si el juego tiene versión en PixiJS. */
export const hasPixi = (game: Game): boolean => game in PIXI;

/**
 * Lanza la versión en PixiJS. Devuelve `false` si no hay o si el motor no
 * arrancó en este equipo, para seguir con la de siempre.
 */
export async function playPixi(game: Game, names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<boolean> {
  // La misma sustitución que hace el sorteo, también acá: si el juego no
  // aguanta esa lista, la carrera. Así ningún camino (la escena fija, una
  // repetición) le pasa a un juego más nombres de los que sabe contar.
  game = playableGame(game, names.length, names, winners);
  const load = PIXI[game];
  if (!load) return false;
  // Si el trozo del juego no baja (el wifi del evento se cortó justo), todavía
  // no se montó nada: el motor de siempre lo cuenta. Antes el error se perdía
  // y no aparecía ni el juego ni el ganador.
  let launch: Awaited<ReturnType<typeof load>>;
  try {
    launch = await load();
  } catch {
    return false;
  }
  try {
    await launch(names, winners, beacon, done);
  } catch (err) {
    if (err instanceof PixiInitError) return false;
    throw err;
  }
  return true;
}
