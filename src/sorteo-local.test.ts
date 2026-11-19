import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resultadoDelSello } from "./sorteo-local";

/**
 * El cálculo del navegador contra los vectores compartidos con el contrato (`docs/vectors.json`): si este cálculo
 * diera otra cosa, el juego mostraría un ganador distinto del que queda grabado.
 */
const V = JSON.parse(readFileSync(new URL("../docs/vectors.json", import.meta.url), "utf8")) as {
  list_hash: string;
  count: number;
  quicknet: { randomness: string };
  cases: { k: number; winners: number[] }[];
  extra: { count: number; k: number; winners: number[] }[];
};

describe("el resultado calculado en el navegador", () => {
  it("da lo mismo que los vectores del protocolo, con uno y con varios ganadores", () => {
    for (const c of V.cases) {
      expect(resultadoDelSello({ listHash: V.list_hash, count: V.count, numWinners: c.k }, V.quicknet)).toEqual(c.winners);
    }
  });

  it("da lo mismo con otras cantidades de personas, también con el orden completo", () => {
    for (const c of V.extra) {
      expect(resultadoDelSello({ listHash: V.list_hash, count: c.count, numWinners: c.k }, V.quicknet)).toEqual(c.winners);
    }
  });

  it("no inventa nada con un sello imposible", () => {
    expect(() => resultadoDelSello({ listHash: V.list_hash, count: 0, numWinners: 1 }, V.quicknet)).toThrow();
    expect(() => resultadoDelSello({ listHash: V.list_hash, count: 3, numWinners: 4 }, V.quicknet)).toThrow();
    expect(() => resultadoDelSello({ listHash: V.list_hash, count: 3, numWinners: 0 }, V.quicknet)).toThrow();
  });
});
