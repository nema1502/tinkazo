import { describe, expect, it } from "vitest";
import { planQualifier, wavesFor } from "./qualifier";

/** Un rng sembrado y simple, solo para las pruebas (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("qualifier: la clasificatoria", () => {
  it("con pocos nombres no hay oleadas y todos son finalistas", () => {
    const q = planQualifier(7, [3], 12, rngOf(1));
    expect(q.finalists).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(q.waves).toEqual([]);
    expect(q.finalWinners).toEqual([3]);
  });

  it("los ganadores siempre pasan a la final, en cualquier tamaño y semilla", () => {
    for (const n of [13, 30, 50, 200]) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = rngOf(seed);
        const winners = [Math.floor(rng() * n)];
        if (seed % 3 === 0) {
          const otro = (winners[0] as number + 7) % n;
          winners.push(otro);
        }
        const q = planQualifier(n, winners, 12, rngOf(seed));
        expect(q.finalists).toHaveLength(12);
        for (const w of winners) expect(q.finalists).toContain(w);
        q.finalWinners.forEach((f, i) => expect(q.finalists[f]).toBe(winners[i]));
      }
    }
  });

  it("cada nombre queda en un solo lugar: finalista o en una oleada", () => {
    for (const n of [13, 50, 200]) {
      const q = planQualifier(n, [0, 5], 12, rngOf(n));
      const todos = [...q.finalists, ...q.waves.flat()].sort((a, b) => a - b);
      expect(todos).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(q.waves.flat()).not.toContain(0);
      expect(q.waves.flat()).not.toContain(5);
    }
  });

  it("las oleadas se achican y son una a tres según cuántos se van", () => {
    expect(wavesFor(0)).toBe(0);
    expect(wavesFor(10)).toBe(1);
    expect(wavesFor(38)).toBe(2);
    expect(wavesFor(188)).toBe(3);
    const q = planQualifier(200, [9], 12, rngOf(3));
    expect(q.waves).toHaveLength(3);
    const largos = q.waves.map((w) => w.length);
    expect(largos[0]).toBeGreaterThan(largos[1] as number);
    expect(largos[1]).toBeGreaterThan(largos[2] as number);
  });

  it("es determinista: la misma ronda arma la misma clasificatoria", () => {
    expect(planQualifier(50, [17], 12, rngOf(99))).toEqual(planQualifier(50, [17], 12, rngOf(99)));
    expect(planQualifier(50, [17], 12, rngOf(99))).not.toEqual(planQualifier(50, [17], 12, rngOf(100)));
  });

  it("rechaza lo imposible en vez de colgarse", () => {
    expect(() => planQualifier(50, [1, 1], 12, rngOf(1))).toThrow();
    expect(() => planQualifier(50, [60], 12, rngOf(1))).toThrow();
    expect(() => planQualifier(50, Array.from({ length: 13 }, (_, i) => i), 12, rngOf(1))).toThrow();
  });
});
