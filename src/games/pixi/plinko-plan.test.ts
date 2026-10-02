import { describe, expect, it } from "vitest";
import {
  PLINKO_MAX,
  assignSlots,
  ballTrail,
  boardFor,
  fitsPlinko,
  hopDurations,
  landingSlot,
  locateHop,
  planDrop,
  planPath,
  slotsFor,
  type Step,
} from "./plinko-plan";

/** A tiny seeded rng (mulberry32), enough for the tests. */
function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

const rights = (steps: readonly Step[]): number => steps.filter((s) => s === 1).length;
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);

describe("plinko: board", () => {
  it("has one slot per participant and enough rows to reach every slot", () => {
    for (let n = 2; n <= PLINKO_MAX; n++) {
      const b = boardFor(n);
      expect(b.slots).toBe(slotsFor(n));
      expect(b.slots).toBe(n);
      // every position 0..rows belongs to exactly one slot, `perSlot` each
      expect(b.perSlot * b.slots).toBe(b.rows + 1);
      expect(b.rows).toBeGreaterThanOrEqual(b.slots - 1);
    }
  });

  it("falls back to the race above PLINKO_MAX, like the wheel does", () => {
    expect(PLINKO_MAX).toBe(12);
    expect(fitsPlinko(2)).toBe(true);
    expect(fitsPlinko(PLINKO_MAX)).toBe(true);
    expect(fitsPlinko(PLINKO_MAX + 1)).toBe(false);
    expect(fitsPlinko(200)).toBe(false);
  });
});

describe("plinko: backwards planning", () => {
  it("planPath has `rows` steps and exactly `rights` rights", () => {
    for (const seed of SEEDS) {
      for (const rows of [7, 9, 11, 13]) {
        for (const r of [0, 1, Math.floor(rows / 2), rows - 1, rows]) {
          for (const swerve of [-1, 0, 1] as const) {
            const p = planPath(rows, r, rngOf(seed), swerve);
            expect(p).toHaveLength(rows);
            expect(rights(p)).toBe(r);
            expect(p.every((s) => s === 1 || s === -1)).toBe(true);
          }
        }
      }
    }
  });

  it("is deterministic: same seed, same plan", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const a = planPath(11, 5, rngOf(seed), 1);
      const b = planPath(11, 5, rngOf(seed), 1);
      expect(a).toEqual(b);
      const board = boardFor(9);
      expect(planDrop(board, 4, rngOf(seed), true)).toEqual(planDrop(board, 4, rngOf(seed), true));
    }
  });

  it("different seeds give different paths (it is not a constant)", () => {
    const seen = new Set(SEEDS.map((s) => planPath(11, 5, rngOf(s), 0).join(",")));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("the ball lands in the winner's slot for every seed, board size and slot", () => {
    for (const seed of SEEDS) {
      for (let n = 2; n <= PLINKO_MAX; n++) {
        const board = boardFor(n);
        for (let slot = 0; slot < n; slot++) {
          for (const near of [false, true]) {
            const d = planDrop(board, slot, rngOf(seed + slot * 31 + n), near);
            expect(d.steps).toHaveLength(board.rows);
            expect(landingSlot(d.steps, board)).toBe(slot);
          }
        }
      }
    }
    // The sweep is heavy: give it room so a loaded machine does not flake it.
  }, 60_000);

  it("works on the edge slots (first and last)", () => {
    for (const n of [2, 3, 5, PLINKO_MAX]) {
      const board = boardFor(n);
      for (const slot of [0, n - 1]) {
        for (const seed of SEEDS.slice(0, 15)) {
          const d = planDrop(board, slot, rngOf(seed), true);
          expect(landingSlot(d.steps, board)).toBe(slot);
        }
      }
    }
    // with one position per slot the edges are forced straight runs
    const b = boardFor(PLINKO_MAX);
    expect(b.perSlot).toBe(1);
    expect(planDrop(b, 0, rngOf(1), true).steps.every((s) => s === -1)).toBe(true);
    expect(planDrop(b, b.slots - 1, rngOf(1), true).steps.every((s) => s === 1)).toBe(true);
  });

  it("a near miss approaches the target from the neighbour's side", () => {
    const board = boardFor(PLINKO_MAX);
    let approached = 0;
    for (const seed of SEEDS) {
      const d = planDrop(board, 5, rngOf(seed), true);
      if (d.swerve === 0) continue;
      const trail = ballTrail(d.steps);
      const end = trail[trail.length - 1] as number;
      // three rows from the end the ball hangs on the neighbour's side
      const before = trail[trail.length - 4] as number;
      expect(Math.sign(before - end)).toBe(d.swerve);
      approached++;
    }
    expect(approached).toBeGreaterThan(SEEDS.length / 2);
  });

  it("ballTrail starts at 0 and ends at (rights - rows / 2)", () => {
    const p = planPath(9, 3, rngOf(5), 0);
    const t = ballTrail(p);
    expect(t).toHaveLength(10);
    expect(t[0]).toBe(0);
    expect(t[9]).toBe(3 - 4.5);
    for (let j = 1; j < t.length; j++) expect(Math.abs((t[j] as number) - (t[j - 1] as number))).toBe(0.5);
  });
});

describe("plinko: slot assignment", () => {
  it("is a seeded permutation of the slots", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const n of [2, 5, PLINKO_MAX]) {
        const a = assignSlots(n, [0], rngOf(seed));
        expect([...a.slotOf].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
        a.slotOf.forEach((s, name) => expect(a.nameAt[s]).toBe(name));
        expect(assignSlots(n, [0], rngOf(seed))).toEqual(a);
      }
    }
  });

  it("gives distinct slots to several winners, and maps them in order", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const n = 9;
      const winners = [7, 2, 5];
      const a = assignSlots(n, winners, rngOf(seed));
      expect(a.winnerSlots).toHaveLength(3);
      expect(new Set(a.winnerSlots).size).toBe(3);
      a.winnerSlots.forEach((s, i) => expect(a.nameAt[s]).toBe(winners[i]));
    }
  });

  it("every winner's planned ball lands in that winner's slot (n=2 and n=PLINKO_MAX, all winners)", () => {
    for (const n of [2, PLINKO_MAX]) {
      const winners = Array.from({ length: n }, (_, i) => i);
      const a = assignSlots(n, winners, rngOf(99));
      const board = boardFor(n);
      a.winnerSlots.forEach((slot, i) => {
        const d = planDrop(board, slot, rngOf(i + 3), i === n - 1);
        expect(a.nameAt[landingSlot(d.steps, board)]).toBe(winners[i]);
      });
    }
  });
});

describe("plinko: timing", () => {
  it("has one hop per row plus the final fall, all positive", () => {
    for (const rows of [7, 11, 13]) {
      for (const grand of [false, true]) {
        const d = hopDurations(rows, grand);
        expect(d).toHaveLength(rows + 1);
        expect(d.every((x) => x > 0)).toBe(true);
      }
    }
  });

  it("the grand ball slows down at the end and takes longer than the others", () => {
    const g = hopDurations(11, true);
    const q = hopDurations(11, false);
    expect(g[g.length - 1] as number).toBeGreaterThan((g[0] as number) * 2);
    expect(g.reduce((a, b) => a + b, 0)).toBeGreaterThan(q.reduce((a, b) => a + b, 0));
  });

  it("locateHop maps a time to a segment and a fraction, clamped", () => {
    const d = [1, 2, 4];
    expect(locateHop(d, -1)).toEqual({ seg: 0, f: 0 });
    expect(locateHop(d, 0.5)).toEqual({ seg: 0, f: 0.5 });
    expect(locateHop(d, 2)).toEqual({ seg: 1, f: 0.5 });
    expect(locateHop(d, 5)).toEqual({ seg: 2, f: 0.5 });
    expect(locateHop(d, 99)).toEqual({ seg: 2, f: 1 });
  });
});
