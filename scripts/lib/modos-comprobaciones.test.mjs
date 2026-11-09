import { describe, expect, it } from "vitest";
import { esperadoSinElParametro, evaluarRepetidos, personasDeLosRenglones } from "./modos-comprobaciones.mjs";

describe("evaluarRepetidos: el aviso de «salió N veces»", () => {
  const repetida = ["Ana Quispe (1/3)", "Beto Rojas", "Ana Quispe (2/3)"];

  it("los renglones traen el sufijo: se cuenta por persona", () => {
    expect(personasDeLosRenglones(repetida)).toEqual(["Ana Quispe", "Beto Rojas", "Ana Quispe"]);
  });

  it("alguien repite y la caja no trae el aviso: falla (antes aprobaba siempre)", () => {
    expect(evaluarRepetidos(repetida, "Ganadores: tres").ok).toBe(false);
  });

  it("alguien repite y la caja dice «Ana Quispe salió 2 veces: #1 y #3.»: aprueba", () => {
    expect(evaluarRepetidos(repetida, "Ana Quispe salió 2 veces: #1 y #3.").ok).toBe(true);
  });

  it("el aviso tiene que ser de esa persona y con esa cantidad", () => {
    expect(evaluarRepetidos(repetida, "Beto Rojas salió 2 veces: #1 y #3.").ok).toBe(false);
    expect(evaluarRepetidos(repetida, "Ana Quispe salió 3 veces: #1, #2 y #3.").ok).toBe(false);
  });

  it("en inglés: «came out 2 times»", () => {
    expect(evaluarRepetidos(repetida, "Ana Quispe came out 2 times: #1 and #3.").ok).toBe(true);
    expect(evaluarRepetidos(repetida, "").ok).toBe(false);
  });

  it("nadie repite y la caja trae el aviso: falla; sin aviso, aprueba", () => {
    const distintas = ["Ana Quispe (1/3)", "Beto Rojas", "Carla Suarez (2/2)"];
    expect(evaluarRepetidos(distintas, "Ana Quispe salió 2 veces: #1 y #3.").ok).toBe(false);
    expect(evaluarRepetidos(distintas, "tres ganadores").ok).toBe(true);
    expect(evaluarRepetidos(distintas, "tres ganadores").hayRepetidos).toBe(false);
  });

  it("un nombre con signos de expresión regular no rompe la búsqueda", () => {
    expect(evaluarRepetidos(["A+B (1/2)", "A+B (2/2)"], "A+B salió 2 veces: #1 y #2.").ok).toBe(true);
  });
});

describe("esperadoSinElParametro: la verificación del caso C sin ?modo=", () => {
  it("en la construcción de siempre: siete participantes y siete renglones", () => {
    const e = esperadoSinElParametro(false);
    expect(e.renglones).toBe(7);
    expect(e.cuenta.test("7 participantes")).toBe(true);
    expect(e.cuenta.test("4 personas, 7 participaciones")).toBe(false);
  });

  it("con la bandera de construcción: cuatro personas y cuatro renglones", () => {
    const e = esperadoSinElParametro(true);
    expect(e.renglones).toBe(4);
    expect(e.cuenta.test("4 personas, 7 participaciones")).toBe(true);
    expect(e.cuenta.test("7 participantes")).toBe(false);
  });
});
