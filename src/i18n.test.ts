import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La regla del repositorio: toda cadena visible nueva va en español y en
 * inglés en el mismo cambio. El tipo del diccionario no lo exige ·tiene una
 * firma de índice·, así que una clave olvidada en un idioma compilaba y en
 * pantalla aparecía la clave cruda.
 */
describe("diccionario", () => {
  it("los dos idiomas tienen exactamente las mismas claves", () => {
    const soloEs = Object.keys(T.es).filter((k) => !(k in T.en));
    const soloEn = Object.keys(T.en).filter((k) => !(k in T.es));
    expect({ soloEs, soloEn }).toEqual({ soloEs: [], soloEn: [] });
  });

  it("cada clave es del mismo tipo en los dos idiomas", () => {
    const distintas = Object.keys(T.es).filter((k) => {
      const a = T.es[k];
      const b = T.en[k];
      return Array.isArray(a) !== Array.isArray(b) || typeof a !== typeof b;
    });
    expect(distintas).toEqual([]);
  });

  it("ninguna cadena queda vacía", () => {
    const vacias = (["es", "en"] as const).flatMap((l) =>
      Object.entries(T[l])
        .filter(([, v]) => (typeof v === "string" && !v.trim()) || (Array.isArray(v) && (v.length === 0 || v.some((x) => !x.trim()))))
        .map(([k]) => `${l}.${k}`),
    );
    expect(vacias).toEqual([]);
  });

  it("Sapo: the drop line names the prize, never the co-winner, the tally counts, 'almost' and the frog's lip exist", () => {
    // Al caer el co-ganador la línea dice su número de premio: no hay nombre que decir.
    expect(T.es.cSapDone(2)).toMatch(/premio 2/i);
    expect(T.en.cSapDone(2)).toMatch(/prize 2/i);
    expect(T.es.cSapTally(1, 2)).toBe("Premio 1 de 2");
    expect(T.en.cSapTally(1, 2)).toBe("Prize 1 of 2");
    for (const k of ["cSapAlmost", "cSapLip"]) {
      expect(T.es[k]).toBeTruthy();
      expect(T.en[k]).toBeTruthy();
    }
  });

  it("la barra del sorteo dice número público, sin 'ronda' ni '#'", () => {
    // `${t("seed")} ${ronda}` arriba del estadio y en el rótulo del sorteo, y
    // `cWheelRound` en el motor anterior. "Ronda" es la palabra de drand, y "#"
    // ya es el número del sorteo en Mis sorteos ("Sorteo #12").
    for (const l of ["es", "en"] as const) {
      for (const k of ["seed", "cWheelRound"]) {
        const v = T[l][k] as string;
        expect(v).not.toMatch(/ronda|round|#/i);
        expect(v).toMatch(/número público|public number/i);
      }
    }
  });

  it("Teleférico: la última estación dice lo mismo que el contador", () => {
    // Al llegar con tres o más arriba no puede decir "quedan dos"; con dos, sí.
    // Las variantes salen al azar: se prueban muchas veces.
    for (let i = 0; i < 60; i++) {
      for (const left of [3, 4, 20]) {
        expect(T.es.cTelLast(left)).not.toMatch(/dos/i);
        expect(T.en.cTelLast(left)).not.toMatch(/two/i);
      }
      expect(T.es.cTelLast(2)).toMatch(/QUEDAN DOS|Última estación/);
      expect(T.en.cTelLast(2)).toMatch(/TWO LEFT|Last station/);
      // Los que se bajan juntos se nombran todos, y los que no entran se cuentan.
      expect(T.es.cTelOffN(["Ana", "Iván"], 0)).toMatch(/Ana e Iván/);
      expect(T.en.cTelOffN(["Ana", "Bea", "Ciro"], 15)).toMatch(/Ana, Bea, Ciro and 15 more/);
      expect(T.es.cTelOffN(["Ana", "Bea", "Ciro"], 15)).toMatch(/Ana, Bea, Ciro y 15 más/);
    }
  });

  it("Sapo: what gets thrown is a ring, never a chip or a token", () => {
    for (const l of ["es", "en"] as const) {
      const textos = Object.entries(T[l])
        .filter(([k]) => k.startsWith("cSap"))
        .flatMap(([, v]) => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []));
      expect(textos.filter((x) => /ficha|token|chip/i.test(x))).toEqual([]);
    }
  });

});
