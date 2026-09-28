import type { Beacon, Game } from "../../state";

/**
 * Qué juegos tienen versión en el motor nuevo, y cómo se lanzan.
 *
 * Con `?motor=pixi` el sitio pregunta acá primero; si el juego todavía no
 * tiene versión nueva, sigue con la de siempre. Cada versión se carga recién
 * cuando se pide, así que el motor nuevo no le pesa a quien no lo usa.
 */
type Launch = (names: string[], winners: readonly number[], beacon: Beacon, done: () => void) => Promise<void>;

const PIXI: Partial<Record<Game, () => Promise<Launch>>> = {
  race: async () => {
    const m = await import("../llamas/pixi-race");
    return (n, w, b, d) => m.llamasPixi(n, w, b, d, "andes");
  },
  wheel: async () => (await import("./wheel")).wheelPixi,
  tombola: async () => (await import("./tombola")).tombolaPixi,
  teleferico: async () => (await import("./cablecar")).cableCarPixi,
  pasanaku: async () => (await import("./pasanaku")).pasanakuPixi,
  ledger: async () => (await import("./ledger")).ledgerPixi,
  stellar: async () => (await import("./constellation")).constellationPixi,
  rockets: async () => {
    const m = await import("../llamas/pixi-race");
    return (n, w, b, d) => m.llamasPixi(n, w, b, d, "stellar");
  },
};

/** `true` si el juego tiene versión en PixiJS. */
export const hasPixi = (game: Game): boolean => game in PIXI;

/** Lanza la versión en PixiJS. Devuelve `false` si no hay, para seguir con la de siempre. */
export async function playPixi(game: Game, names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<boolean> {
  const load = PIXI[game];
  if (!load) return false;
  const launch = await load();
  await launch(names, winners, beacon, done);
  return true;
}
