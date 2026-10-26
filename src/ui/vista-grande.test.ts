import { describe, expect, it } from "vitest";
import { ANCHO_VISTA_GRANDE, esperaSola } from "./vista-grande";

const laptop = { ancho: 1440, tactil: false, busqueda: "" };

describe("la espera pasa sola a la vista grande", () => {
  it("en una laptop o un proyector, sí", () => {
    expect(esperaSola(laptop)).toBe(true);
    expect(esperaSola({ ...laptop, ancho: ANCHO_VISTA_GRANDE })).toBe(true);
  });

  it("en un celular, una tablet o una ventana angosta, no", () => {
    expect(esperaSola({ ...laptop, ancho: 390, tactil: true })).toBe(false);
    expect(esperaSola({ ...laptop, ancho: 1366, tactil: true })).toBe(false);
    expect(esperaSola({ ...laptop, ancho: ANCHO_VISTA_GRANDE - 1 })).toBe(false);
  });

  it("los enlaces de prueba y de ensayo la llevan a mano", () => {
    for (const p of ["demo=race", "instant=1", "lead=3", "pace=rapido", "pose=wheel"]) {
      expect(esperaSola({ ...laptop, busqueda: `?${p}` })).toBe(false);
    }
  });

  it("?grande=0 y lo guardado la apagan; ?grande=1 la fuerza en cualquier ancho", () => {
    expect(esperaSola({ ...laptop, busqueda: "?grande=0" })).toBe(false);
    expect(esperaSola({ ...laptop, guardado: "0" })).toBe(false);
    expect(esperaSola({ ancho: 390, tactil: true, busqueda: "?grande=1" })).toBe(true);
    expect(esperaSola({ ancho: 1440, tactil: false, busqueda: "?lead=3&grande=1" })).toBe(true);
  });
});
