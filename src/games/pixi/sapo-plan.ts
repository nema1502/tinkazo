/**
 * Sapo (frog toss): the pure planning half (no Pixi, no DOM, no Math.random).
 *
 * The game decides nothing. The winners' holes are known before the first
 * toss, so the whole sequence is planned FORWARDS from that fact: for each
 * winner, a few throws that miss the holes (table surface) or nearly drop in
 * (the rim of a neighbouring hole), and a final throw that lands inside the
 * winner's own hole. The planner never produces a miss or a near miss that
 * falls inside any hole's capture radius, so the token provably ends where the
 * protocol said.
 *
 * Coordinates are table units, y pointing down (screen-like), the frog's
 * mouth at the origin and the holes on a ring of radius `ringR`.
 */

/** Sapo is readable up to this many participants; above it the draw falls back to the race. */
export const SAPO_MAX = 12;

/** Hole radius cap, in table units. */
const HOLE_R_CAP = 0.22;
/** Hole radius as a fraction of the distance between neighbouring holes. */
const HOLE_R_CHORD = 0.28;
/** The frog sits in the middle. */
const FROG_R = 0.34;
/** Distance of the holes from the frog. */
const RING_R = 1;
/** Table radius, measured from the frog. */
const TABLE_R = 1.55;
/** A non-hit landing stays at least this far outside a hole's capture radius. */
export const CAPTURE_CLEAR = 0.02;
/**
 * A near miss rests between these multiples of the hole radius from the hole's
 * centre: the ring (about 0.4 hole radii) rides on the rim, half over the hole,
 * with its centre outside the capture radius. At 1.7 to 2.1 it landed on the
 * neighbour's name and did not read as "almost" (agente evaluador, 2 de octubre
 * de 2026).
 */
export const NEAR_MIN = 1.2;
export const NEAR_MAX = 1.4;
/** Hard bounds on tension throws per winner. */
export const MAX_MISSES = 4;
export const MAX_NEARS = 2;
/** A hit lands within this fraction of the hole radius from its centre. */
const HIT_SPREAD = 0.45;
/** Where the tosser stands (below the table). The hand, not a landing. */
// Abajo a la derecha de la mesa: abajo al centro quedaba tapada por la caja
// de subtítulos (agente evaluador, 2 de octubre de 2026).
export const HAND = { x: 1.75, y: 1.7 } as const;

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  /** Hole centres; index = slot. Slot 0 is at the top, then clockwise. */
  holes: Point[];
  holeR: number;
  ringR: number;
  frogR: number;
  tableR: number;
}

/** `true` if Sapo can show `n` participants (otherwise the sorteo falls back to the race). */
export const fitsSapo = (n: number): boolean => n <= SAPO_MAX;

/** One hole per participant, evenly on a ring around the frog. */
export function holeLayout(n: number): Layout {
  const count = Math.max(2, Math.floor(n));
  const chord = 2 * RING_R * Math.sin(Math.PI / count);
  const holeR = Math.min(HOLE_R_CAP, HOLE_R_CHORD * chord);
  const holes: Point[] = Array.from({ length: count }, (_, s) => {
    const a = -Math.PI / 2 + (2 * Math.PI * s) / count;
    return { x: RING_R * Math.cos(a), y: RING_R * Math.sin(a) };
  });
  return { holes, holeR, ringR: RING_R, frogR: FROG_R, tableR: TABLE_R };
}

export type ThrowKind = "miss" | "near" | "hit";

export interface Throw {
  kind: ThrowKind;
  /** Index into `winnerSlots`: which winner this throw belongs to. */
  turn: number;
  landing: Point;
  /** `hit` only: the winner's hole. */
  targetSlot?: number;
  /** `near` only: the hole whose rim the token rests on (never the thrower's own target). */
  rimSlot?: number;
  /** Where a non-hit token ends up after it rolls or pops off the table. */
  exit: Point;
}

export interface PlanOpts {
  /** Misses before the last winner's final throw. */
  lastMisses: number;
  /** Near misses before the last winner's final throw (after the misses). */
  lastNears: number;
  /** Same, for every other winner. */
  otherMisses: number;
  otherNears: number;
}

export type ArcName = "remontada" | "susto" | "duelo" | "tapada";

/** How many tension throws each arc gets (see `drama.ts`). */
export function optsForArc(arc: ArcName): PlanOpts {
  switch (arc) {
    case "susto":
      return { lastMisses: 2, lastNears: 2, otherMisses: 1, otherNears: 0 };
    case "duelo":
      return { lastMisses: 2, lastNears: 2, otherMisses: 1, otherNears: 0 };
    case "remontada":
      return { lastMisses: 4, lastNears: 1, otherMisses: 1, otherNears: 0 };
    case "tapada":
      return { lastMisses: 1, lastNears: 1, otherMisses: 1, otherNears: 0 };
  }
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));
const len = (p: Point): number => Math.hypot(p.x, p.y);
const gap = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from point `p` to the segment `a`-`b`. */
function segGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return gap(p, { x: a.x + f * dx, y: a.y + f * dy });
}

/**
 * A point where a rolling token leaves the table: outwards from where it
 * landed, and never across a hole. It starts from a seeded direction and turns
 * (in fixed steps, so it is deterministic) until the straight roll from `p`
 * stays clear of every hole's capture radius.
 */
function exitFrom(L: Layout, p: Point, rng: () => number): Point {
  const a0 = Math.atan2(p.y, p.x) + (rng() - 0.5) * 0.8;
  const r = TABLE_R + 0.7;
  /** Where a ray from `p` along angle `a` crosses the circle of radius `r` around the frog. */
  const along = (a: number): Point => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const b = p.x * dx + p.y * dy;
    const t = -b + Math.sqrt(b * b - (p.x * p.x + p.y * p.y - r * r));
    return { x: p.x + dx * t, y: p.y + dy * t };
  };
  const STEPS = 72;
  for (let i = 0; i < STEPS; i++) {
    // 0, +1, -1, +2, -2...: the closest directions to the seeded one first.
    const off = (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * ((2 * Math.PI) / STEPS);
    const e = along(a0 + off);
    if (L.holes.every((h) => segGap(h, p, e) > L.holeR + CAPTURE_CLEAR)) return e;
  }
  return along(a0);
}

function planMiss(L: Layout, rng: () => number): Point {
  const clear = L.holeR + CAPTURE_CLEAR + 0.04;
  const rMin = L.frogR + 0.12;
  const rMax = L.tableR - 0.12;
  for (let i = 0; i < 24; i++) {
    const a = rng() * 2 * Math.PI;
    const r = rMin + rng() * (rMax - rMin);
    const p = { x: r * Math.cos(a), y: r * Math.sin(a) };
    if (L.holes.every((h) => gap(p, h) > clear)) return p;
  }
  // Deterministic fallback: the gap between two neighbouring holes, on the ring.
  const n = L.holes.length;
  const a = -Math.PI / 2 + (2 * Math.PI * (Math.floor(rng() * n) + 0.5)) / n;
  return { x: L.ringR * Math.cos(a), y: L.ringR * Math.sin(a) };
}

function planNear(L: Layout, rim: number, rng: () => number): Point {
  const c = L.holes[rim] as Point;
  const ok = (p: Point): boolean =>
    L.holes.every((h) => gap(p, h) > L.holeR + CAPTURE_CLEAR) && len(p) > L.frogR && len(p) < L.tableR;
  // Only on the half of the rim that faces the frog: the name of each hole
  // sits on the outer side, and a near miss out there landed under the name.
  const haciaRana = Math.atan2(-c.y, -c.x);
  for (let i = 0; i < 24; i++) {
    const a = haciaRana + (rng() - 0.5) * Math.PI;
    const d = L.holeR * (NEAR_MIN + rng() * (NEAR_MAX - NEAR_MIN));
    const p = { x: c.x + d * Math.cos(a), y: c.y + d * Math.sin(a) };
    if (ok(p)) return p;
  }
  // Deterministic fallback: straight in from the hole, towards the frog.
  const d = L.holeR * ((NEAR_MIN + NEAR_MAX) / 2);
  const k = len(c) || 1;
  return { x: c.x - (c.x / k) * d, y: c.y - (c.y / k) * d };
}

function planHit(L: Layout, slot: number, rng: () => number): Point {
  const c = L.holes[slot] as Point;
  const a = rng() * 2 * Math.PI;
  const d = L.holeR * HIT_SPREAD * rng();
  return { x: c.x + d * Math.cos(a), y: c.y + d * Math.sin(a) };
}

/**
 * The whole toss sequence, in order. For each winner (in `winnerSlots` order):
 * `misses` throws on the bare table, then `nears` rim throws, then the hit in
 * that winner's hole. The last winner closes the draw.
 *
 * A near miss rests on the rim of any hole that is still free, the winner's
 * own included, and the narrator names whoever sits there. Until 4 October
 * 2026 it always went to a neighbour of the winner's hole: with two near
 * misses the winner sat right between them, eight seconds early. Now where
 * the ring dances says nothing about who wins.
 */
export function planThrows(n: number, winnerSlots: readonly number[], rng: () => number, opts: PlanOpts): Throw[] {
  const L = holeLayout(n);
  const holes = L.holes.length;
  if (winnerSlots.length === 0) throw new RangeError("planThrows: at least one winner is needed");
  const seen = new Set<number>();
  for (const s of winnerSlots) {
    if (!Number.isInteger(s) || s < 0 || s >= holes) throw new RangeError(`planThrows: slot ${s} is outside 0..${holes - 1}`);
    if (seen.has(s)) throw new RangeError(`planThrows: slot ${s} is repeated`);
    seen.add(s);
  }
  const out: Throw[] = [];
  const lastTurn = winnerSlots.length - 1;
  winnerSlots.forEach((slot, turn) => {
    const isLast = turn === lastTurn;
    const misses = clampInt(isLast ? opts.lastMisses : opts.otherMisses, 0, MAX_MISSES);
    const nears = clampInt(isLast ? opts.lastNears : opts.otherNears, 0, MAX_NEARS);
    for (let i = 0; i < misses; i++) {
      const landing = planMiss(L, rng);
      out.push({ kind: "miss", turn, landing, exit: exitFrom(L, landing, rng) });
    }
    // Holes already won in an earlier turn carry a medal: a ring on that rim
    // would name someone who already has a prize.
    const won = new Set(winnerSlots.slice(0, turn));
    const free = Array.from({ length: holes }, (_, s) => s).filter((s) => !won.has(s));
    for (let i = 0; i < nears; i++) {
      const rimSlot = free[Math.floor(rng() * free.length)] as number;
      const landing = planNear(L, rimSlot, rng);
      out.push({ kind: "near", turn, landing, rimSlot, exit: exitFrom(L, landing, rng) });
    }
    const landing = planHit(L, slot, rng);
    out.push({ kind: "hit", turn, landing, targetSlot: slot, exit: landing });
  });
  return out;
}

/** Duration of a throw's flight, in game seconds. The grand (last winner's) throws are slower. */
export function throwTime(kind: ThrowKind, grand: boolean): number {
  const base = kind === "miss" ? 0.75 : kind === "near" ? 0.9 : 0.85;
  if (!grand) return base;
  return kind === "hit" ? 2.2 : base * 1.25;
}

/** A parabola from `a` to `b` at fraction `f` (0..1); `h` is the apex height above the straight line (y points down). */
export function arcPoint(a: Point, b: Point, f: number, h: number): Point {
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f - 4 * h * f * (1 - f) };
}
