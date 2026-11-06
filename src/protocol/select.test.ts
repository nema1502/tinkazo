import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import vectors from "../../docs/vectors.json";
import { MAX_WINNERS, select } from "./select";

const randomness = hexToBytes(vectors.quicknet.randomness);
const listHash = hexToBytes(vectors.list_hash);

/** La huella de una lista de ganadores: sha256 de los índices en be32, uno detrás de otro (la misma del contrato, `winners_digest` de test.rs). */
const huella = (winners: readonly number[]): string => {
  const bytes = new Uint8Array(4 * winners.length);
  winners.forEach((w, i) => new DataView(bytes.buffer).setUint32(4 * i, w));
  return bytesToHex(sha256(bytes));
};

describe("selección determinista (protocolo §5)", () => {
  it("reproduce todos los casos de docs/vectors.json (mismos que el contrato)", () => {
    for (const c of vectors.cases) {
      expect(select(randomness, listHash, vectors.count, c.k)).toEqual(c.winners);
    }
    for (const e of vectors.extra) {
      expect(select(randomness, listHash, e.count, e.k)).toEqual(e.winners);
    }
  });

  it("el tope es el del contrato: cien ganadores", () => {
    expect(MAX_WINNERS).toBe(100);
  });

  it("cien de cien: una permutación completa, la misma que calcula el contrato", () => {
    const vector = vectors.extra.find((e) => e.count === 100 && e.k === 100);
    expect(vector, "falta el vector 100 de 100 en docs/vectors.json").toBeDefined();
    const out = select(randomness, listHash, 100, 100);
    expect(out).toEqual(vector?.winners);
    expect([...out].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    // Las mismas huellas y puntas que el contrato fija en `contracts/raffle/src/test.rs` (calculadas aparte, con node:crypto).
    expect(huella(out)).toBe("dbc1fe6ab52d7c555c8b49b42a7b88d22cf97f9c3f01a737c7eb71283457af68");
    expect([out[0], out[4], out[99]]).toEqual([12, 66, 87]);
  });

  it("cien de mil: sin repetidos, en rango, y los cinco primeros son los del vector de cinco", () => {
    const vector = vectors.extra.find((e) => e.count === 1000 && e.k === 100);
    expect(vector, "falta el vector 100 de 1.000 en docs/vectors.json").toBeDefined();
    const out = select(randomness, listHash, 1000, 100);
    expect(out).toEqual(vector?.winners);
    expect(new Set(out).size).toBe(100);
    for (const i of out) expect(i >= 0 && i < 1000).toBe(true);
    expect(huella(out)).toBe("90fe82cc7071d4906c3032c89e6fa172bf5ed8f0b001d1dcb7a748d3a76055b4");
    expect(out.slice(0, 5)).toEqual(vectors.extra.find((e) => e.count === 1000 && e.k === 5)?.winners);
  });

  it("pedir más ganadores no cambia a los primeros: es el mismo recorrido, y por eso el orden de los premios es estable", () => {
    const cien = select(randomness, listHash, 100, 100);
    for (const k of [1, 3, 32, 50, 99]) expect(select(randomness, listHash, 100, k)).toEqual(cien.slice(0, k));
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

  it("cubre toda la lista cuando k = count, hasta el tope", () => {
    for (const n of [2, 32, 33, MAX_WINNERS]) {
      const out = select(randomness, listHash, n, n);
      expect([...out].sort((a, b) => a - b), `con ${n}`).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("cambia con el hash de la lista", () => {
    const other = hexToBytes("11".repeat(32));
    expect(select(randomness, other, 1_000, 5)).not.toEqual(select(randomness, listHash, 1_000, 5));
  });

  it("rechaza parámetros fuera de rango", () => {
    expect(() => select(randomness, listHash, 1, 1)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 5, 0)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 5, 6)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 1_000, MAX_WINNERS + 1)).toThrow(RangeError);
    expect(() => select(randomness, listHash, 1_000, MAX_WINNERS)).not.toThrow();
    expect(() => select(new Uint8Array(31), listHash, 5, 1)).toThrow(RangeError);
  });
});
