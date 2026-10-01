import { describe, expect, it } from "vitest";
import {
  CAPTURE_CLEAR,
  NEAR_MAX,
  NEAR_MIN,
  SAPO_MAX,
  arcPoint,
  fitsSapo,
  holeLayout,
  optsForArc,
  planThrows,
  throwTime,
  type Throw,
} from "./sapo-plan";

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

/** The sweeps run thousands of expectations; give them room on a busy machine. */
const SWEEP_MS = 60_000;
const SEEDS = Array.from({ length: 64 }, (_, i) => i * 7919 + 1);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Winner slots for a board of n: k distinct slots picked by a seeded shuffle. */
function winnersFor(n: number, k: number, seed: number): number[] {
  const r = rngOf(seed * 13 + n);
  const all = Array.from({ length: n }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [all[i], all[j]] = [all[j] as number, all[i] as number];
  }
  return all.slice(0, k);
}

describe("sapo: layout", () => {
  it("has one hole per participant, on a ring, apart from each other and from the frog", () => {
    for (let n = 2; n <= SAPO_MAX; n++) {
      const L = holeLayout(n);
      expect(L.holes).toHaveLength(n);
      expect(L.holeR).toBeGreaterThan(0);
      for (const h of L.holes) {
        expect(dist(h, { x: 0, y: 0 })).toBeCloseTo(L.ringR, 9);
        expect(dist(h, { x: 0, y: 0 }) - L.holeR).toBeGreaterThan(L.frogR);
        expect(dist(h, { x: 0, y: 0 }) + L.holeR * NEAR_MAX).toBeLessThan(L.tableR);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          // holes do not overlap and leave room for a rim ring plus a clear gap
          expect(dist(L.holes[i] as Throw["landing"], L.holes[j] as Throw["landing"])).toBeGreaterThan(2 * L.holeR);
        }
      }
    }
  });

  it("falls back to the race above SAPO_MAX, like Plinko does", () => {
    expect(SAPO_MAX).toBe(12);
    expect(fitsSapo(2)).toBe(true);
    expect(fitsSapo(SAPO_MAX)).toBe(true);
    expect(fitsSapo(SAPO_MAX + 1)).toBe(false);
    expect(fitsSapo(200)).toBe(false);
  });

  it("is a pure function of n", () => {
    expect(holeLayout(7)).toEqual(holeLayout(7));
  });
});

describe("sapo: planThrows invariants", () => {
  it("one hit per winner, last of its group, into that winner's slot (all n, 1..k winners, 64 seeds)", () => {
    for (const seed of SEEDS) {
      for (let n = 2; n <= SAPO_MAX; n++) {
        for (const k of [1, Math.min(n, 2), Math.min(n, 4), n]) {
          const ws = winnersFor(n, k, seed);
          const th = planThrows(n, ws, rngOf(seed), optsForArc("susto"));
          expect(th.filter((t) => t.kind === "hit")).toHaveLength(k);
          for (let w = 0; w < k; w++) {
            const group = th.filter((t) => t.turn === w);
            const hit = group[group.length - 1] as Throw;
            expect(hit.kind).toBe("hit");
            expect(hit.targetSlot).toBe(ws[w]);
            expect(group.filter((t) => t.kind === "hit")).toHaveLength(1);
          }
          // turns come in `winners` order, never interleaved
          const turns = th.map((t) => t.turn);
          expect([...turns].sort((a, b) => a - b)).toEqual(turns);
          // the very last throw is the last winner's hit: the big moment
          expect((th[th.length - 1] as Throw).turn).toBe(k - 1);
          expect((th[th.length - 1] as Throw).kind).toBe("hit");
        }
      }
    }
  }, SWEEP_MS);

  it("misses and near misses never land inside any hole's capture radius", () => {
    for (const seed of SEEDS) {
      for (let n = 2; n <= SAPO_MAX; n++) {
        const L = holeLayout(n);
        const ws = winnersFor(n, Math.min(n, 3), seed);
        const th = planThrows(n, ws, rngOf(seed), optsForArc(["susto", "duelo", "remontada", "tapada"][seed % 4] as "susto"));
        for (const t of th) {
          if (t.kind === "hit") continue;
          for (const h of L.holes) expect(dist(t.landing, h)).toBeGreaterThan(L.holeR + CAPTURE_CLEAR);
          expect(dist(t.landing, { x: 0, y: 0 })).toBeGreaterThan(L.frogR);
          expect(dist(t.landing, { x: 0, y: 0 })).toBeLessThan(L.tableR);
        }
      }
    }
  }, SWEEP_MS);

  it("a near miss rests on the rim of a hole that is not its own target, outside the capture radius", () => {
    let nears = 0;
    for (const seed of SEEDS) {
      for (let n = 2; n <= SAPO_MAX; n++) {
        const L = holeLayout(n);
        const ws = winnersFor(n, Math.min(n, 3), seed);
        for (const t of planThrows(n, ws, rngOf(seed), optsForArc("duelo"))) {
          if (t.kind !== "near") continue;
          nears++;
          expect(t.rimSlot).not.toBeUndefined();
          expect(t.rimSlot).not.toBe(ws[t.turn]);
          const d = dist(t.landing, L.holes[t.rimSlot as number] as Throw["landing"]);
          expect(d).toBeGreaterThanOrEqual(L.holeR * NEAR_MIN - 1e-9);
          expect(d).toBeLessThanOrEqual(L.holeR * NEAR_MAX + 1e-9);
          expect(d).toBeGreaterThan(L.holeR + CAPTURE_CLEAR);
        }
      }
    }
    expect(nears).toBeGreaterThan(SEEDS.length);
  }, SWEEP_MS);

  it("the roll-off path of every miss and near miss stays clear of every hole", () => {
    const segDist = (p: Throw["landing"], a: Throw["landing"], b: Throw["landing"]): number => {
      const dx = b.x - a.x, dy = b.y - a.y;
      const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - (a.x + f * dx), p.y - (a.y + f * dy));
    };
    for (const seed of SEEDS) {
      for (let n = 2; n <= SAPO_MAX; n++) {
        const L = holeLayout(n);
        for (let k = 1; k <= Math.min(n, 3); k++) {
          for (const t of planThrows(n, winnersFor(n, k, seed), rngOf(seed), optsForArc("remontada"))) {
            if (t.kind === "hit") continue;
            for (const h of L.holes) expect(segDist(h, t.landing, t.exit)).toBeGreaterThan(L.holeR + CAPTURE_CLEAR);
          }
        }
      }
    }
  }, SWEEP_MS);

  it("a hit lands inside its hole's capture radius", () => {
    for (const seed of SEEDS) {
      for (let n = 2; n <= SAPO_MAX; n++) {
        const L = holeLayout(n);
        const ws = winnersFor(n, Math.min(n, 3), seed);
        for (const t of planThrows(n, ws, rngOf(seed), optsForArc("remontada"))) {
          if (t.kind !== "hit") continue;
          expect(dist(t.landing, L.holes[t.targetSlot as number] as Throw["landing"])).toBeLessThan(L.holeR * 0.6);
        }
      }
    }
  }, SWEEP_MS);

  it("is deterministic: same seed, same plan; different seeds differ", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(planThrows(9, [3, 5], rngOf(seed), optsForArc("susto"))).toEqual(planThrows(9, [3, 5], rngOf(seed), optsForArc("susto")));
    }
    const seen = new Set(SEEDS.map((s) => JSON.stringify(planThrows(9, [3], rngOf(s), optsForArc("susto")))));
    expect(seen.size).toBeGreaterThan(30);
  });

  it("keeps throw counts bounded for every n, every number of winners and every arc", () => {
    for (const arc of ["remontada", "susto", "duelo", "tapada"] as const) {
      const o = optsForArc(arc);
      for (const seed of SEEDS.slice(0, 16)) {
        for (let n = 2; n <= SAPO_MAX; n++) {
          for (let k = 1; k <= n; k++) {
            const th = planThrows(n, winnersFor(n, k, seed), rngOf(seed), o);
            const lastGroup = th.filter((t) => t.turn === k - 1);
            const others = th.length - lastGroup.length;
            // last winner: at least a hit and its misses; others: bounded too
            expect(lastGroup.length).toBe(o.lastMisses + o.lastNears + 1);
            expect(others).toBe((k - 1) * (o.otherMisses + o.otherNears + 1));
            expect(th.length).toBeGreaterThanOrEqual(k * 2);
            expect(th.length).toBeLessThanOrEqual(k * 8);
          }
        }
      }
    }
  }, SWEEP_MS);

  it("builds tension: misses first, near misses next, the hit last", () => {
    const th = planThrows(10, [4], rngOf(5), { lastMisses: 3, lastNears: 2, otherMisses: 1, otherNears: 0 });
    expect(th.map((t) => t.kind)).toEqual(["miss", "miss", "miss", "near", "near", "hit"]);
  });

  it("the last winner always gets more suspense than the others", () => {
    for (const arc of ["remontada", "susto", "duelo", "tapada"] as const) {
      const o = optsForArc(arc);
      expect(o.lastMisses + o.lastNears).toBeGreaterThan(o.otherMisses + o.otherNears);
    }
  });

  it("rejects winner slots that are repeated or outside the board", () => {
    expect(() => planThrows(5, [1, 1], rngOf(1), optsForArc("susto"))).toThrow(RangeError);
    expect(() => planThrows(5, [5], rngOf(1), optsForArc("susto"))).toThrow(RangeError);
    expect(() => planThrows(5, [-1], rngOf(1), optsForArc("susto"))).toThrow(RangeError);
    expect(() => planThrows(5, [], rngOf(1), optsForArc("susto"))).toThrow(RangeError);
  });
});

describe("sapo: motion helpers", () => {
  it("arcPoint is a parabola: exact ends, apex in the middle", () => {
    const a = { x: 0, y: 10 };
    const b = { x: 4, y: 2 };
    expect(arcPoint(a, b, 0, 3)).toEqual(a);
    const end = arcPoint(b, a, 1, 3);
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBeCloseTo(10, 9);
    const mid = arcPoint(a, b, 0.5, 3);
    expect(mid.x).toBeCloseTo(2, 9);
    expect(mid.y).toBeCloseTo(6 - 3, 9);
  });

  it("throwTime is positive and the grand hit is the slowest", () => {
    for (const k of ["miss", "near", "hit"] as const) {
      expect(throwTime(k, false)).toBeGreaterThan(0);
      expect(throwTime(k, true)).toBeGreaterThanOrEqual(throwTime(k, false));
    }
    expect(throwTime("hit", true)).toBeGreaterThan(throwTime("miss", false) * 2);
  });
});
