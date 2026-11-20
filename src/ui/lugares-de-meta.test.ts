import { describe, expect, it } from "vitest";
import { premioDeLugarEn, premiosDeLosLugares } from "./lugares-de-meta";

/**
 * La lectura del premio de cada lugar en el texto sellado: la usan el resultado, la línea del lugar, el pago y «No está».
 * Solo lee el texto: el orden de los lugares es el de los ganadores que dio el sorteo.
 */

const TRES = "1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro";

describe("el premio de un lugar", () => {
  it("con premios por lugar, devuelve el de ese lugar", () => {
    expect([1, 2, 3].map((l) => premioDeLugarEn(TRES, l))).toEqual(["Bici", "Termo", "Libro"]);
  });

  it("un lugar sin premio escrito, o que no está en el texto, da vacío y no el de otro lugar", () => {
    const sinElSegundo = "1.er premio: Bici, 3.er premio: Libro";
    expect(premioDeLugarEn(sinElSegundo, 2)).toBe("");
    expect(premioDeLugarEn(sinElSegundo, 4)).toBe("");
  });

  it("sin lugares (un solo premio, un sorteo de antes) no hay lugar que leer", () => {
    expect(premioDeLugarEn("Termo", 1)).toBeNull();
    expect(premioDeLugarEn("", 2)).toBeNull();
  });
});

describe("los premios que se reponen con «No está»", () => {
  it("son los de los lugares de quien no está, en ese orden", () => {
    expect(premiosDeLosLugares(TRES, [3, 1])).toEqual(["Libro", "Bici"]);
  });

  it("sin lugares no hay lista: se repone el premio sellado entero", () => {
    expect(premiosDeLosLugares("Una polera", [2])).toBeNull();
  });
});
