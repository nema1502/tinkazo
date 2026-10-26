import { describe, expect, it } from "vitest";
import { LEGIBLE, letraMinima, letraSala } from "./letra";

describe("la regla de la letra de la sala", () => {
  it("en 1080 de alto (k = 1,5) pide 28 px lo secundario y 48 lo principal", () => {
    expect(letraMinima(1.5)).toBeCloseTo(28, 5);
    expect(letraMinima(1.5, true)).toBeCloseTo(48, 5);
  });

  it("en un celular parado (k = 0,93) lo escala, pero nunca baja de 16 y 22", () => {
    expect(letraMinima(0.93)).toBeGreaterThanOrEqual(16);
    expect(letraMinima(0.93, true)).toBeGreaterThanOrEqual(22);
  });

  it("en un celular girado (k = 0,54) manda el piso de píxeles", () => {
    expect(letraMinima(0.54)).toBe(16);
    expect(letraMinima(0.54, true)).toBe(22);
  });

  it("el 2,6 % y el 4,4 % del alto de 1080 son los 28 y 48 px de la regla", () => {
    expect(LEGIBLE.fraccionSec * 1080).toBeCloseTo(28, 0);
    expect(LEGIBLE.fraccionPrin * 1080).toBeCloseTo(48, 0);
  });

  it("letraSala nunca da menos que el diseño ni menos que la regla", () => {
    expect(letraSala(30, 1.5)).toBe(30);
    expect(letraSala(10, 1.5) * 1.5).toBeCloseTo(28, 5);
    expect(letraSala(10, 0.54) * 0.54).toBeCloseTo(16, 5);
    expect(letraSala(20, 1.5, true) * 1.5).toBeCloseTo(48, 5);
  });
});
