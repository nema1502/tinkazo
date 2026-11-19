import { describe, expect, it } from "vitest";
import "../i18n";
import { withRepeatCounts } from "./repeated-names";

/**
 * Los nombres juntos por persona (`repeated-names.ts`): quien sale más de una vez va una sola vez, con su
 * cuenta, en el orden de la primera salida. Sin repetidos, la lista no se toca.
 */
describe("los nombres repetidos, juntos por persona", () => {
  it("junta los repetidos respetando el orden de la primera vez, en los dos idiomas", () => {
    expect(withRepeatCounts("es", ["Ana", "Beto", "Ana"])).toEqual(["Ana (2 veces)", "Beto"]);
    expect(withRepeatCounts("en", ["Ana", "Beto", "Ana"])).toEqual(["Ana (2 times)", "Beto"]);
    expect(withRepeatCounts("es", ["Beto", "Ana", "Ana", "Beto", "Ana"])).toEqual(["Beto (2 veces)", "Ana (3 veces)"]);
  });

  it("sin repetidos la lista queda igual, y la vacía también", () => {
    expect(withRepeatCounts("es", ["Ana", "Beto"])).toEqual(["Ana", "Beto"]);
    expect(withRepeatCounts("en", [])).toEqual([]);
  });
});
