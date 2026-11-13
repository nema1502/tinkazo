import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * Los textos que se sumaron al pulir los modos de orden de turnos y varias participaciones (12 de noviembre de 2026): en
 * los dos idiomas, sin comillas angulares ni punto y coma, sin las palabras de apuesta y sin jerga. Y la tarjeta de la
 * portada en inglés dice turns, no shifts: en todo lo demás del modo se dice turns.
 */

// El rótulo del pliegue que nombraba el orden de turnos (masOpcionesModos) se fue el 13 de noviembre de 2026: el orden se
// elige a la vista, en el selector de arriba de la lista (src/ui/turnos-selector.test.ts).
const CLAVES = ["sigTope", "turnsSinComprobante", "turnsTellSin", "rec.sinTurnos"] as const;
/** Las comillas angulares, el punto medio, la raya larga y la flecha no se escriben en ningún texto que se vea: se arman con su código. */
const PROHIBIDOS = new RegExp(`[;${String.fromCharCode(0xab, 0xbb, 0xb7, 0x2014, 0x2192)}]|rifa|loter[ií]a|raffle|ticket|boleto|apuesta|\\bbet\\b`, "i");
const JERGA = /\b(XLM|drand|hash|firma|token|transacci[oó]n|blockchain|Soroban|Stellar)\b/i;

describe("los textos del pulido de los modos", () => {
  it("existen en español y en inglés y son texto", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        expect(typeof T[l][k], `${l}.${k}`).toBe("string");
        expect(String(T[l][k]).trim().length, `${l}.${k}`).toBeGreaterThan(8);
      }
    }
  });

  it("sin comillas angulares, punto y coma, punto medio, rayas ni palabras de apuesta, y sin jerga", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of CLAVES) {
        const v = String(T[l][k]);
        expect(v, `${l}.${k}`).not.toMatch(PROHIBIDOS);
        expect(v, `${l}.${k}`).not.toMatch(JERGA);
      }
    }
  });

  it("la barra con un orden que no entra trae el tope, y el aviso de la persona dice lo mismo en los dos idiomas", () => {
    expect(T.es.sigTope).toContain("{tope}");
    expect(T.en.sigTope).toContain("{tope}");
    expect(T.es.turnsTellSin).not.toContain("{enlace}");
    expect(T.en.turnsTellSin).not.toContain("{enlace}");
    expect(T.es.turnsSinComprobante).toBe("Este orden no se selló antes del sorteo, así que no se puede comprobar.");
    expect(T.en.turnsSinComprobante).toBe("This order was not sealed before the draw, so it can't be checked.");
  });

  it("la tarjeta de la portada en inglés dice turns, como todo el modo", () => {
    expect(String(T.en.uso3b)).toBe("Draw the year-end gift or the order of the turns, with a result anyone can check.");
    expect(String(T.en.uso3b)).not.toMatch(/shift/i);
    expect(String(T.es.uso3b)).toContain("turnos");
  });
});
