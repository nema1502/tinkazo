import { describe, expect, it } from "vitest";
import { assignSlots } from "./slots";

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

describe("slots: el reparto de nombres", () => {
  it("es una permutación sembrada", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const n of [2, 5, 12]) {
        const a = assignSlots(n, [0], rngOf(seed));
        expect([...a.slotOf].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
        a.slotOf.forEach((s, name) => expect(a.nameAt[s]).toBe(name));
        expect(assignSlots(n, [0], rngOf(seed))).toEqual(a);
      }
    }
  });

  it("da lugares distintos a varios ganadores, en orden", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const winners = [7, 2, 5];
      const a = assignSlots(9, winners, rngOf(seed));
      expect(a.winnerSlots).toHaveLength(3);
      expect(new Set(a.winnerSlots).size).toBe(3);
      a.winnerSlots.forEach((s, i) => expect(a.nameAt[s]).toBe(winners[i]));
    }
  });
});
