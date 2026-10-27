import { describe, expect, it } from "vitest";
import { CHIP_SCALE, LEGIBLE, escalaChipLegible, letraMinima, letraSala, seLee, unidadDePantalla } from "./letra";

describe("cuándo un nombre «se lee» (la vara de audit-identidad, la misma de audit-legible)", () => {
  it("la unidad es la de stage.ts: sh/720 en horizontal y lo que entre en un celular parado", () => {
    expect(unidadDePantalla(1920, 1080)).toBeCloseTo(1.5, 5);
    expect(unidadDePantalla(1280, 720)).toBeCloseTo(1, 5);
    expect(unidadDePantalla(390, 844)).toBeCloseTo(390 / 420, 5);
    expect(unidadDePantalla(844, 390)).toBeCloseTo(390 / 720, 5);
  });

  it("en 1080 se lee a partir de 28 px de letra (no de 28 px de caja: 23 px de letra no se lee)", () => {
    expect(seLee(28, 1920, 1080)).toBe(true);
    expect(seLee(27.6, 1920, 1080)).toBe(true);
    expect(seLee(23, 1920, 1080)).toBe(false);
    expect(seLee(26.9, 1920, 1080)).toBe(false);
  });

  it("en un celular parado se lee a partir de lo que pide la regla (17,3 px en 390×844), no de un 2,6 % del alto", () => {
    expect(seLee(17.4, 390, 844)).toBe(true);
    expect(seLee(16, 390, 844)).toBe(false);
    // El 2,6 % de 844 son 21,9 px: la vara de antes pedía eso de caja, o sea unos 17 px de letra, y la de ahora pide la regla.
    expect(letraMinima(unidadDePantalla(390, 844))).toBeCloseTo(17.3, 1);
  });

  it("nunca baja de los 16 px aunque la pantalla sea chica", () => {
    expect(seLee(15, 844, 390)).toBe(false);
    expect(seLee(16, 844, 390)).toBe(true);
  });

  it("un tamaño que no es un número no se lee", () => {
    expect(seLee(Number.NaN, 1920, 1080)).toBe(false);
    expect(seLee(Number.POSITIVE_INFINITY, 1920, 1080)).toBe(false);
  });
});

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

  it("un chip con nombre a la escala mínima cumple la regla en 1080, en un celular parado y en uno girado", () => {
    // La letra de un chip a escala `e` es 12 × CHIP_SCALE × k × e (`chip()` de stage.ts).
    const letra = (k: number, e: number): number => 12 * CHIP_SCALE * k * e;
    for (const k of [1.5, 1.2, 0.9286, 0.857, 0.54]) {
      expect(letra(k, escalaChipLegible(k))).toBeGreaterThanOrEqual(letraMinima(k) - 1e-9);
      expect(letra(k, escalaChipLegible(k))).toBeLessThan(letraMinima(k) + 1e-9);
    }
    expect(escalaChipLegible(1.5)).toBeCloseTo(28 / (19.2 * 1.5), 6);
    // Con la unidad de un celular girado manda el piso de 16 px y el chip tiene que crecer.
    expect(escalaChipLegible(0.54)).toBeGreaterThan(1);
    // La base legible de los chips (escala 1) ya cumple en todo lo que no es un celular girado.
    expect(escalaChipLegible(1.5)).toBeLessThan(1);
    expect(escalaChipLegible(0.9286)).toBeLessThan(1);
  });

  it("letraSala nunca da menos que el diseño ni menos que la regla", () => {
    expect(letraSala(30, 1.5)).toBe(30);
    expect(letraSala(10, 1.5) * 1.5).toBeCloseTo(28, 5);
    expect(letraSala(10, 0.54) * 0.54).toBeCloseTo(16, 5);
    expect(letraSala(20, 1.5, true) * 1.5).toBeCloseTo(48, 5);
  });
});
