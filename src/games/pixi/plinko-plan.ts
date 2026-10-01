/**
 * Plinko: the pure planning half (no Pixi, no DOM, no Math.random).
 *
 * The game decides nothing. The winner's slot is known before the ball
 * is dropped, so the path is planned BACKWARDS: pick the slot, pick a
 * landing position inside it, then pick a seeded left/right sequence with
 * exactly that many rights. The ball provably lands where the protocol said.
 *
 * Geometry. A board with `rows` peg rows has `rows + 1` landing positions
 * (0..rows = number of rights). They are split evenly into `slots` slots of
 * `perSlot` positions each, so `slot = floor(rights / perSlot)`. With
 * `slots = n` and `perSlot = 1` this is the classic Galton board; with few
 * participants the board gets extra rows (more bounces, more suspense).
 *
 * Coordinates are in units of the peg spacing: after `j` steps a ball with
 * `r` rights is at x = r - j / 2.
 */

/** Plinko is readable up to this many participants; above it the draw falls back to the race. */
export const PLINKO_MAX = 12;

/** Minimum number of landing positions: keeps tiny boards from being two bounces long. */
const MIN_POSITIONS = 8;

/** -1 = left, +1 = right. */
export type Step = -1 | 1;

export interface Board {
  slots: number;
  rows: number;
  /** Landing positions per slot. */
  perSlot: number;
}

/** `true` if Plinko can show `n` participants (otherwise the sorteo falls back to the race). */
export const fitsPlinko = (n: number): boolean => n <= PLINKO_MAX;

/** One slot per participant. */
export const slotsFor = (n: number): number => Math.max(1, Math.floor(n));

export function boardFor(n: number): Board {
  const slots = slotsFor(n);
  const perSlot = Math.ceil(MIN_POSITIONS / slots);
  return { slots, perSlot, rows: slots * perSlot - 1 };
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** How many closing steps of a swerve are forced to the "return" direction. */
const SWERVE_TAIL = 3;

/**
 * A seeded sequence of `rows` steps with exactly `rights` rights.
 *
 * With `swerve` = d (+1 / -1) the last steps (up to three) all go the other
 * way, so the ball hangs on the d side of its target and swings back at the
 * end: a near miss. It never changes the count of rights.
 */
export function planPath(rows: number, rights: number, rng: () => number, swerve: -1 | 0 | 1 = 0): Step[] {
  const r = Math.max(0, Math.min(rows, Math.floor(rights)));
  const pool: Step[] = [...Array<Step>(r).fill(1), ...Array<Step>(rows - r).fill(-1)];
  if (swerve === 0) return shuffle(pool, rng);
  const back: Step = swerve === 1 ? -1 : 1;
  const have = pool.filter((s) => s === back).length;
  const tail = Math.min(SWERVE_TAIL, have);
  // Remove `tail` return steps from the pool, shuffle the rest, and append them.
  let removed = 0;
  const rest = pool.filter((s) => (s === back && removed < tail ? (removed++, false) : true));
  return [...shuffle(rest, rng), ...Array<Step>(tail).fill(back)];
}

/** Slot where a ball with this path lands. */
export function landingSlot(steps: readonly Step[], board: Board): number {
  const r = steps.reduce<number>((a, s) => a + (s === 1 ? 1 : 0), 0);
  return Math.min(board.slots - 1, Math.floor(r / board.perSlot));
}

/** x of the ball after each step (index 0 = start), in peg spacings. */
export function ballTrail(steps: readonly Step[]): number[] {
  const out = [0];
  let r = 0;
  steps.forEach((s, i) => {
    if (s === 1) r++;
    out.push(r - (i + 1) / 2);
  });
  return out;
}

export interface Drop {
  steps: Step[];
  /** Landing position (number of rights). */
  pos: number;
  /** Side the ball hangs on before the last rows (0 = no near miss). */
  swerve: -1 | 0 | 1;
}

/**
 * Plans one ball for a given slot. With `near`, and a neighbour slot to
 * graze, the landing position is the one closest to that neighbour and the
 * ball approaches from its side.
 */
export function planDrop(board: Board, slot: number, rng: () => number, near: boolean): Drop {
  const m = board.perSlot;
  const neighbours: (-1 | 1)[] = [];
  if (slot > 0) neighbours.push(-1);
  if (slot < board.slots - 1) neighbours.push(1);
  let dir: -1 | 0 | 1 = 0;
  let pos = slot * m + Math.floor(rng() * m);
  if (near && neighbours.length > 0) {
    dir = neighbours[Math.floor(rng() * neighbours.length)] ?? 0;
    pos = dir === 1 ? slot * m + m - 1 : slot * m;
    // Not enough return steps to swing back (needs at least two)? Then no swerve.
    const back = dir === 1 ? board.rows - pos : pos;
    if (back < 2) dir = 0;
  }
  return { steps: planPath(board.rows, pos, rng, dir), pos, swerve: dir };
}

export interface Assignment {
  /** Slot of each participant (by index in the list). */
  slotOf: number[];
  /** Participant (index) that sits in each slot. */
  nameAt: number[];
  /** Slot of each winner, in the order of `winners`. Distinct. */
  winnerSlots: number[];
}

/** Seeded shuffle of the participants over the slots. */
export function assignSlots(n: number, winners: readonly number[], rng: () => number): Assignment {
  const slotOf = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const nameAt: number[] = [];
  slotOf.forEach((s, name) => {
    nameAt[s] = name;
  });
  return { slotOf, nameAt, winnerSlots: winners.map((w) => slotOf[w] as number) };
}

/**
 * Duration, in game seconds, of each segment of the fall: drop to the first
 * peg, one hop per row, and the final fall into the slot (`rows + 1` in
 * total). The ball that closes the draw ("grand") is slower and slows down
 * more in the last three segments.
 */
export function hopDurations(rows: number, grand: boolean): number[] {
  const base = grand ? 0.65 : 0.38;
  const out: number[] = Array.from({ length: rows + 1 }, () => base);
  if (grand) {
    // The very last fall is the slowest: the room is looking at one slot.
    out[rows] = base * 2.4;
    out[rows - 1] = base * 1.8;
    out[rows - 2] = base * 1.3;
  }
  return out;
}

/** Segment and fraction (0..1) for a time `t` into the fall, clamped to its ends. */
export function locateHop(durs: readonly number[], t: number): { seg: number; f: number } {
  if (t <= 0) return { seg: 0, f: 0 };
  let acc = 0;
  for (let i = 0; i < durs.length; i++) {
    const d = durs[i] as number;
    if (t < acc + d) return { seg: i, f: (t - acc) / d };
    acc += d;
  }
  return { seg: durs.length - 1, f: 1 };
}
