import { describe, expect, it } from "vitest";
import { MODO_LIDER_BASE, MODOS_LIDER, SALTO_ARO, golpeAro, modoLider } from "./carrera-3d-lider";

describe("la marca de quien va adelante en el 3D", () => {
  it("sin pedirla, o con algo que no existe, es el aro dorado", () => {
    expect(MODO_LIDER_BASE).toBe("aro");
    expect(modoLider("")).toBe("aro");
    expect(modoLider("?motor=3d")).toBe("aro");
    expect(modoLider("?lider=cohete")).toBe("aro");
  });

  it("cada una de las marcas se pide con ?lider=", () => {
    for (const m of MODOS_LIDER) expect(modoLider(`?demo=race&motor=3d&lider=${m}`)).toBe(m);
  });

  it("al cambiar de dueña el aro salta de una vez y se asienta en menos de 0,3 s, sin saltos por el camino", () => {
    expect(SALTO_ARO).toBeLessThan(0.3);
    expect(golpeAro(0)).toBeGreaterThan(1.2);
    expect(golpeAro(SALTO_ARO)).toBeCloseTo(1, 9);
    expect(golpeAro(1)).toBe(1);
    let prev = golpeAro(0);
    for (let t = 0.01; t <= 0.3; t += 0.01) {
      const g = golpeAro(t);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - g).toBeLessThan(0.05);
      prev = g;
    }
  });
});
