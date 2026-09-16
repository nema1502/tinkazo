import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import vectors from "../../docs/vectors.json";
import { MAX_WINNERS, select } from "./select";

const randomness = hexToBytes(vectors.quicknet.randomness);
const listHash = hexToBytes(vectors.list_hash);

describe("selección determinista (protocolo §5)", () => {
  it("reproduce todos los casos de docs/vectors.json (mismos que el contrato)", () => {
    for (const c of vectors.cases) {
      expect(select(randomness, listHash, vectors.count, c.k)).toEqual(c.winners);
    }
    for (const e of vectors.extra) {
      expect(select(randomness, listHash, e.count, e.k)).toEqual(e.winners);
    }
  });

  it("devuelve índices únicos, en rango y en cantidad exacta", () => {
    for (const count of [2, 3, 18, 1_000, 50_000]) {
      const k = Math.min(count, 5);
      const out = select(randomness, listHash, count, k);
      expect(out).toHaveLength(k);
      expect(new Set(out).size).toBe(k);
      for (const i of out) expect(i >= 0 && i < count).toBe(true);
    }
  });

  it("cubre toda la lista cuando k = count", () => {
    const out = select(randomness, listHash, MAX_WINNERS, MAX_WINNERS);
    expect([...out].sort((a, b) => a - b)).toEqual(Array.from({ length: MAX_WINNERS }, (_, i) => i));
  });

  it("cambia con el hash de la lista", () => {
    const other = hexToBytes("11".repeat(32));
    expect(select(randomness, other, 1_000, 5)).not.toEqual(select(randomness, listHash, 1_000, 5));
  });

  it("rechaza parámetros fuera de rango", () => {
    expect(() => select(randomness, listHash, 1, 1)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 5, 0)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 5, 6)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 100, 33)).toThrow(RangeError);
    expect(() => select(new Uint8Array(31), listHash, 5, 1)).toThrow(RangeError);
  });
});
