import { describe, expect, it } from "vitest";
import { metida, pisadura, pisaA, sitioLibre, type CajaF } from "./carrera-fichas";

const caja = (x0: number, y0: number, w = 100, h = 20): CajaF => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const PANTALLA = caja(0, 0, 800, 600);

describe("cuándo dos fichas se pisan", () => {
  it("si no se tocan no se pisan, y la parte es sobre la más chica", () => {
    expect(pisadura(caja(0, 0), caja(200, 0))).toBe(0);
    expect(pisadura(caja(0, 0), caja(0, 20))).toBe(0);
    // Una ficha de 100 por 20 sobre la mitad de otra de 50 por 20: tapa toda la chica.
    expect(pisadura(caja(0, 0), caja(50, 0, 50, 20))).toBe(1);
    expect(pisadura(caja(0, 0), caja(90, 0))).toBeCloseTo(0.1);
  });

  it("hasta el 10 % se deja pasar y de ahí para arriba se pisan", () => {
    expect(pisaA(caja(0, 0), [caja(90.5, 0)])).toBe(false);
    expect(pisaA(caja(0, 0), [caja(89, 0)])).toBe(true);
  });
});

describe("meter una ficha en la pantalla", () => {
  it("la que ya está adentro no se mueve", () => {
    expect(metida(caja(100, 100), PANTALLA)).toEqual({ dx: 0, dy: 0 });
  });

  it("la que se corta en el borde izquierdo se corre hacia adentro", () => {
    expect(metida(caja(-30, 100), PANTALLA)).toEqual({ dx: 30, dy: 0 });
    expect(metida(caja(740, 100), PANTALLA)).toEqual({ dx: -40, dy: 0 });
  });

  it("la que se mete bajo la cabecera baja lo justo", () => {
    expect(metida(caja(100, -10), PANTALLA)).toEqual({ dx: 0, dy: 10 });
  });

  it("la que habría que correr demasiado, o no entra, se calla", () => {
    expect(metida(caja(-90, 100), PANTALLA)).toBeNull();
    expect(metida(caja(0, -60), PANTALLA)).toBeNull();
    expect(metida(caja(0, 0, 900, 20), PANTALLA)).toBeNull();
  });
});

describe("dónde va la que pisa a otra", () => {
  const puesta = caja(100, 100);

  it("se corre un renglón (su alto y un píxel) y no pisa a la puesta", () => {
    const dy = sitioLibre(caja(100, 100), [puesta], PANTALLA);
    expect(dy).toBe(-21);
  });

  it("alterna arriba y abajo, y con la cabeza debajo va primero arriba y después abajo", () => {
    const tres = [puesta, caja(100, 79)];
    expect(sitioLibre(caja(100, 100), tres, PANTALLA)).toBe(21);
    expect(sitioLibre(caja(100, 100), tres, PANTALLA, true)).toBe(-42);
  });

  it("la que el relator nombra busca primero abajo y recién después arriba", () => {
    expect(sitioLibre(caja(100, 100), [puesta], PANTALLA, false, 0, true)).toBe(21);
    // Con el renglón de abajo ocupado, sube uno; nunca empuja dos hacia abajo antes de probar arriba.
    expect(sitioLibre(caja(100, 100), [puesta, caja(100, 121)], PANTALLA, false, 0, true)).toBe(-21);
    expect(sitioLibre(caja(100, 100), [puesta, caja(100, 121), caja(100, 79)], PANTALLA, false, 0, true)).toBe(42);
  });

  it("el letrero de salida cuenta como una caja puesta: una ficha que lo pisa se corre", () => {
    const letrero = { x0: 90, y0: 100, x1: 160, y1: 120 };
    expect(pisaA(caja(100, 100), [letrero])).toBe(true);
    expect(sitioLibre(caja(100, 100), [letrero], PANTALLA)).toBe(-21);
  });

  it("no se va más de dos renglones: si no hay sitio, null", () => {
    const todas = [puesta, caja(100, 79), caja(100, 121), caja(100, 58), caja(100, 142)];
    expect(sitioLibre(caja(100, 100), todas, PANTALLA)).toBeNull();
  });

  it("lo que ya se corrió para entrar en la pantalla cuenta para el tope de renglones", () => {
    // Ya se corrió 43 px hacia arriba (dos renglones): subir otro pasaría el tope, así que busca solo para abajo.
    expect(sitioLibre(caja(100, 100), [puesta], PANTALLA, false, -43)).toBe(21);
    expect(sitioLibre(caja(100, 100), [puesta, caja(100, 121)], PANTALLA, false, -43)).toBe(42);
  });

  it("no sale de la pantalla buscando sitio", () => {
    const arriba = caja(100, 0);
    expect(sitioLibre(arriba, [arriba], PANTALLA)).toBe(21);
  });

  it("es determinista: mismas cajas, mismo sitio", () => {
    expect(sitioLibre(caja(100, 100), [puesta], PANTALLA, true)).toBe(sitioLibre(caja(100, 100), [puesta], PANTALLA, true));
  });
});
