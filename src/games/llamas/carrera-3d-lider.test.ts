import { describe, expect, it } from "vitest";
import { MODO_LIDER_BASE, MODOS_LIDER, modoLider } from "./carrera-3d-lider";

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
});
