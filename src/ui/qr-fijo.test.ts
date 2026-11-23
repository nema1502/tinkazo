import { describe, expect, it } from "vitest";
import { medidasFijas } from "./qr";

/**
 * El QR del panel de una campaña mide lo mismo en pantalla con cualquier zoom y cualquier pantalla, y se dibuja nítido para la
 * densidad de ese momento: cada módulo cae en píxeles enteros y nunca baja de tres.
 */

const DENSIDADES = [1, 1.25, 1.5, 2, 2.5, 3];
// Versiones de QR que salen con un enlace de campaña: de 41 a 69 módulos de lado más el margen de 4 a cada lado.
const TOTALES = [49, 53, 57, 61, 69, 77];

describe("las medidas del QR de tamaño fijo", () => {
  it("el tamaño en pantalla es el mismo con cualquier densidad", () => {
    for (const total of TOTALES) {
      const lados = DENSIDADES.map((d) => medidasFijas(total, 300, d).lado);
      expect(new Set(lados).size, `total ${total}`).toBe(1);
    }
  });

  it("el lado es un número entero de píxeles por módulo y entra en el lugar", () => {
    for (const total of TOTALES) {
      const m = medidasFijas(total, 300, 1);
      expect(m.lado).toBe(m.modulo * total);
      expect(Number.isInteger(m.modulo)).toBe(true);
      expect(m.lado).toBeLessThanOrEqual(300);
      expect(m.lado).toBeGreaterThan(300 - total);
    }
  });

  it("cada módulo se dibuja con píxeles del equipo enteros y nunca menos de tres", () => {
    for (const total of TOTALES) {
      for (const d of [0.5, ...DENSIDADES]) {
        const m = medidasFijas(total, 300, d);
        expect(Number.isInteger(m.cell), `total ${total}, densidad ${d}`).toBe(true);
        expect(m.cell, `total ${total}, densidad ${d}`).toBeGreaterThanOrEqual(3);
        // Alcanza para lo que se ve: el dibujo nunca se achica al mostrarlo, salvo con la pantalla alejada.
        if (d >= 1) expect(m.cell).toBeGreaterThanOrEqual(m.modulo * d);
      }
    }
  });

  it("con una densidad entera el dibujo es exacto, sin reescalar", () => {
    for (const d of [1, 2, 3]) {
      const m = medidasFijas(53, 300, d);
      expect(m.cell).toBe(m.modulo * d);
    }
  });

  it("en un lugar angosto baja el módulo pero no de tres píxeles", () => {
    expect(medidasFijas(53, 288, 1).modulo).toBe(5);
    expect(medidasFijas(53, 120, 1).modulo).toBe(3);
  });
});
