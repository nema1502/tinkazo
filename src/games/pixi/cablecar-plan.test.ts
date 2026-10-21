import { beforeAll, describe, expect, it, vi } from "vitest";
import { cuantosGrupos, grupoDe } from "../grupos";

/** El plan toma `clamp` de overlay.ts, que lee `location` al cargarse, y vitest corre en Node. */
let planCableCar: typeof import("./cablecar-plan").planCableCar;
beforeAll(async () => {
  vi.stubGlobal("location", { search: "" });
  ({ planCableCar } = await import("./cablecar-plan"));
});

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

const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

describe("teleférico por grupos: el plan", () => {
  it.each([2, 8, 16, 18, 40, 200])("con %i personas, cada parada baja un grupo entero y quedan dos", (n) => {
    for (const seed of [1, 2, 3, 4]) {
      const winners = [n > 3 ? 3 : 0];
      const P = planCableCar(lista(n), winners, rngOf(seed));
      const K = cuantosGrupos(n);
      expect(P.C).toBe(K);
      expect(P.R).toBe(K);
      // Todos están en una sola lista de bajada, y el ganador llega primero.
      expect([...P.rank].sort((a, b) => a - b)).toEqual(lista(n).map((_, i) => i));
      expect(P.rank[0]).toBe(winners[0]);
      expect(P.left[0]).toBe(n);
      expect(P.left[P.R]).toBe(2);
      // Cada parada, salvo la última, baja un grupo entero.
      for (let r = 0; r < P.R - 1; r++) {
        const baja = P.rank.slice(P.left[r + 1], P.left[r]);
        const g = grupoDe(baja[0] ?? 0, n);
        expect(baja.every((i) => grupoDe(i, n) === g)).toBe(true);
        expect(baja.length).toBe(lista(n).filter((_, i) => grupoDe(i, n) === g).length);
      }
      // En la última, bajan de a uno los del grupo del ganador, y quedan dos.
      const ultima = P.rank.slice(P.left[P.R], P.left[P.R - 1]);
      expect(ultima.every((i) => grupoDe(i, n) === grupoDe(winners[0] ?? 0, n))).toBe(true);
      // Los dos que llegan juntos son del grupo del ganador.
      if (n >= 2) expect(grupoDe(P.rank[1] ?? 0, n)).toBe(grupoDe(winners[0] ?? 0, n));
      // Cada cabina lleva un solo grupo, y el grupo de cada persona es el de su cabina.
      for (let i = 0; i < n; i++) expect(P.groupOfCab[P.cabinOf.get(i) ?? -1]).toBe(grupoDe(i, n));
      // Los dos que quedan no bajan; la cabina del ganador no se suelta.
      expect(P.offAt.has(P.rank[0] ?? -1)).toBe(false);
      expect(P.offAt.has(P.rank[1] ?? -1)).toBe(false);
      expect(P.detachT[P.winnerCab]).toBe(Infinity);
    }
  });

  it("con co-ganadores, cada uno baja en su lugar y el primero llega arriba", () => {
    const n = 40;
    const winners = [1, 5, 9];
    const P = planCableCar(lista(n), winners, rngOf(7));
    expect(P.rank[0]).toBe(1);
    expect([...P.rank].sort((a, b) => a - b)).toEqual(lista(n).map((_, i) => i));
    expect(P.left[P.R]).toBe(2);
  });

  it("con el mismo azar, el mismo plan", () => {
    const a = planCableCar(lista(50), [7], rngOf(11));
    const b = planCableCar(lista(50), [7], rngOf(11));
    expect(a.rank).toEqual(b.rank);
    expect(a.left).toEqual(b.left);
    expect(a.groupOfCab).toEqual(b.groupOfCab);
  });

  it("con una sola persona no hay paradas que dibujar", () => {
    const P = planCableCar(["Sola"], [0], rngOf(3));
    expect(P.rank).toEqual([0]);
    expect(P.R).toBe(1);
  });
});
