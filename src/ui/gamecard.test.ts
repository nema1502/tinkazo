import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { NOMBRE, REGLA, VARIOS } from "./gamecard";

describe("la tarjeta de cómo se juega", () => {
  it("cada nombre y cada regla existen como texto en los dos idiomas", () => {
    // Con una clave mal escrita, t() devuelve la clave cruda, y en el proyector
    // salía "gcNuevo" en letra grande durante tres segundos y medio.
    const claves = [...Object.values(NOMBRE), ...Object.values(REGLA), ...Object.values(VARIOS), "gcKicker", "gcHonest", "gcSapoQual"];
    const faltan = (["es", "en"] as const).flatMap((l) => claves.filter((k) => typeof T[l][k] !== "string").map((k) => `${l}.${k}`));
    expect(faltan).toEqual([]);
  });

  it("los textos con número existen en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) {
      expect(T[l].gcPeople(18)).toMatch(/18/);
      expect(T[l].gcPrizes(3)).toMatch(/3/);
      expect(T[l].gcPrizesNote(3)).toMatch(/3/);
    }
  });
});
