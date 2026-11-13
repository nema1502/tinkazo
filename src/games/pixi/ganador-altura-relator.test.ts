import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENTRADA_RELATOR, escalaMaxRelator, reservaRelator, sobrepasoRelator } from "./ganador-altura";

/**
 * El piso del despeje no puede depender de en qué punto de su entrada está el relator: esa entrada es una animación del
 * DOM con el reloj de verdad, y con el piso medido en pleno rebote la misma ronda dibujaba cuadros distintos (el auditor
 * exigente, en el teleférico: 1 de 405 huellas distintas a los 37,4 s). El piso sale de la caja ya entrada, a escala 1.
 */

const escenario = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
const despeje = escenario.slice(escenario.indexOf("despejarGanador(cuerpo, holgura = 0) {"), escenario.indexOf("placaBajo: (m) =>"));

describe("lo que el rebote del relator pasa de su caja final", () => {
  it("la escala más grande del rebote pasa apenas de 1", () => {
    const e = escalaMaxRelator();
    expect(e).toBeGreaterThan(1);
    expect(e).toBeLessThan(1.02);
    expect(e).toBeGreaterThan(ENTRADA_RELATOR.escalas[0]);
  });

  it("arriba de la caja final, el rebote asoma la mitad de lo que crece de más", () => {
    for (const alto of [44, 80, 112.90625, 300]) {
      expect(sobrepasoRelator(alto)).toBeCloseTo((alto * (escalaMaxRelator() - 1)) / 2, 12);
      expect(sobrepasoRelator(alto)).toBeLessThan(alto * 0.01);
    }
    expect(sobrepasoRelator(0)).toBe(0);
  });

  it("la cota de antes, la del viaje entre dos lecturas, no cambia", () => {
    const [desde] = ENTRADA_RELATOR.escalas;
    expect(reservaRelator(100, true)).toBeCloseTo((100 * (escalaMaxRelator() - desde)) / (2 * desde), 12);
    expect(reservaRelator(100, false)).toBe(0);
  });
});

describe("el estadio mide el piso con la caja del relator ya entrada", () => {
  it("la reserva no depende del estado de la animación", () => {
    expect(despeje).toContain("const reservaPop = sobrepasoRelator(alto);");
    expect(despeje).not.toContain("reservaRelator(");
  });

  it("el borde de arriba sale del centro, que la escala no mueve, y del alto sin transformar", () => {
    expect(despeje).toContain("alto = commentEl.offsetHeight");
    expect(despeje).toContain("top: Math.round((visto.top + visto.height / 2 - alto / 2) * 64) / 64");
    expect(despeje).toMatch(/const pisoReal = commentEl\.textContent \? \(relator\.top - r\.top - 4 - holgura - reservaPop\)/);
  });
});
