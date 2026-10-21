import { describe, expect, it } from "vitest";
import { GAJOS, gajoDe, repartir } from "./wheel-layout";

/** Los tamaños que pide la revisión de la ruleta: uno, dos, el tope, y de ahí para arriba. */
const CASOS = [1, 2, 24, 25, 50, 100, 200] as const;

describe("repartir", () => {
  it.each(CASOS)("con %i personas, cada una aparece una sola vez y nadie se pierde", (n) => {
    const plano = repartir(n).flat();
    expect(plano).toHaveLength(n);
    expect(new Set(plano).size).toBe(n);
    expect(Math.min(...plano)).toBe(0);
    expect(Math.max(...plano)).toBe(n - 1);
  });

  it.each(CASOS)("con %i personas, el orden de la lista se conserva", (n) => {
    // Aplanado, el reparto es la lista en orden: cada grupo es un tramo seguido.
    expect(repartir(n).flat()).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it.each(CASOS)("con %i personas, los gajos difieren en una persona como mucho", (n) => {
    const tams = repartir(n).map((g) => g.length);
    expect(Math.max(...tams) - Math.min(...tams)).toBeLessThanOrEqual(1);
  });

  it.each(CASOS)("con %i personas, hay min(personas, 24) gajos", (n) => {
    expect(repartir(n)).toHaveLength(Math.min(n, 24));
    expect(GAJOS).toBe(24);
  });

  it("es estable: la misma cantidad da el mismo reparto, sin azar", () => {
    for (const n of CASOS) expect(repartir(n)).toEqual(repartir(n));
  });

  it("hasta veinticuatro, cada persona tiene su gajo", () => {
    expect(repartir(1)).toEqual([[0]]);
    expect(repartir(2)).toEqual([[0], [1]]);
    expect(repartir(24)).toEqual(Array.from({ length: 24 }, (_, i) => [i]));
  });

  it("con veinticinco, el primer gajo lleva a dos y el resto a una", () => {
    const grupos = repartir(25);
    expect(grupos[0]).toEqual([0, 1]);
    expect(grupos.slice(1).every((g) => g.length === 1)).toBe(true);
  });

  it("con cincuenta, dos gajos de tres y veintidós de dos", () => {
    const tams = repartir(50).map((g) => g.length);
    expect(tams.filter((t) => t === 3)).toHaveLength(2);
    expect(tams.filter((t) => t === 2)).toHaveLength(22);
  });

  it("con doscientas, ocho gajos de nueve y dieciséis de ocho", () => {
    const tams = repartir(200).map((g) => g.length);
    expect(tams.filter((t) => t === 9)).toHaveLength(8);
    expect(tams.filter((t) => t === 8)).toHaveLength(16);
  });

  it("sin personas no hay gajos", () => {
    expect(repartir(0)).toEqual([]);
  });
});

describe("gajoDe", () => {
  it.each([25, 50, 100, 200])("con %i personas, cada una cae en el gajo que la contiene", (n) => {
    const grupos = repartir(n);
    for (let i = 0; i < n; i++) {
      const g = gajoDe(grupos, i);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(grupos[g]).toContain(i);
    }
  });

  it("una persona fuera del reparto no tiene gajo", () => {
    expect(gajoDe(repartir(10), 10)).toBe(-1);
  });
});
