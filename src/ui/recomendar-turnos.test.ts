import { describe, expect, it } from "vitest";
import { JUEGO_DE_SIEMPRE, RANGOS, juegoPorDefecto } from "./recomendar";

/**
 * El juego por defecto de un orden de turnos: la ruleta, cuando la lista entra en la ruleta. Con más personas que su tope
 * (200), el que ya elige el código de siempre. Los carteles de cada juego no se tocan: eso se mira con un navegador.
 */

describe("juegoPorDefecto con un orden de turnos", () => {
  it("la ruleta, con 2, 12, 50 y hasta 200 personas", () => {
    for (const n of [2, 8, 12, 30, 50, 100, 200]) expect(juegoPorDefecto(n, n, true), `con ${n}`).toBe("wheel");
  });

  it("el tope de la ruleta es el de la tabla de rangos (200): con 201 y 300 queda el que ya elige el código", () => {
    expect(RANGOS.wheel?.maximo).toBe(200);
    for (const n of [201, 250, 300]) {
      const sinModo = juegoPorDefecto(n, n);
      expect(sinModo, `con ${n}`).not.toBe("wheel");
      expect(juegoPorDefecto(n, n, true), `con ${n}`).toBe(sinModo);
    }
  });

  it("sin el modo, nada cambia: ni con muchos premios ni sin pasar el tercer argumento", () => {
    for (const n of [2, 4, 8, 12, 20, 31, 50, 120, 200, 300]) {
      for (const premios of [1, 2, 3, n]) {
        expect(juegoPorDefecto(n, premios, false), `${n} personas, ${premios} premios`).toBe(juegoPorDefecto(n, premios));
      }
    }
    // La carrera sigue siendo el juego de siempre para listas chicas, y la ruleta no se cuela sola.
    expect(juegoPorDefecto(6)).toBe(JUEGO_DE_SIEMPRE);
    expect(juegoPorDefecto(12, 12)).not.toBe("wheel");
    expect(juegoPorDefecto(50, 50)).not.toBe("wheel");
  });

  it("con menos de dos personas no hay orden: no fuerza la ruleta", () => {
    expect(juegoPorDefecto(1, 1, true)).toBe(juegoPorDefecto(1, 1));
    expect(juegoPorDefecto(0, 1, true)).toBe(juegoPorDefecto(0, 1));
  });
});
