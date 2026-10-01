import type { Beacon, Game } from "../../state";
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
  plinko: async () => (await import("./plinko")).plinkoPixi,
  sapo: async () => (await import("./sapo")).sapoPixi,
  oruro: async () => (await import("./oruro")).oruroPixi,
  luz: async () => (await import("./luz")).luzPixi,
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
  const load = PIXI[game];
  if (!load) return false;
  const launch = await load();
  try {
    await launch(names, winners, beacon, done);
  } catch (err) {
    if (err instanceof PixiInitError) return false;
    throw err;
  }
  return true;
}
