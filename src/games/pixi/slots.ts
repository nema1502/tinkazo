/**
 * Un lugar por nombre: el reparto de los participantes sobre los agujeros (o
 * casilleros) de un juego, mezclado con el `rng` sembrado de la ronda. Es una
 * permutación, así que cada nombre tiene su lugar y dos ganadores nunca
 * comparten uno. Puro, sin Pixi ni DOM, para probarlo en Node.
 */

export interface Assignment {
  /** El lugar de cada participante (por su índice en la lista). */
  slotOf: number[];
  /** El participante (índice) que ocupa cada lugar. */
  nameAt: number[];
  /** El lugar de cada ganador, en el orden de `winners`. Distintos. */
  winnerSlots: number[];
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** Reparte a los `n` participantes sobre `n` lugares. */
export function assignSlots(n: number, winners: readonly number[], rng: () => number): Assignment {
  const slotOf = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const nameAt: number[] = [];
  slotOf.forEach((s, name) => {
    nameAt[s] = name;
  });
  return { slotOf, nameAt, winnerSlots: winners.map((w) => slotOf[w] as number) };
}
