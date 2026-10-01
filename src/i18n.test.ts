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

  it("Sapo: the drop line says winner, the tally counts, the rule and 'almost' exist", () => {
    expect(T.es.cSapDone("Ana")).toContain("ganador");
    expect(T.en.cSapDone("Ana")).toContain("winner");
    expect(T.es.cSapTally(1, 2)).toBe("Ganador 1 de 2");
    expect(T.en.cSapTally(1, 2)).toBe("Winner 1 of 2");
    for (const k of ["cSapRuleMany", "cSapRuleOne", "cSapAlmost"]) {
      expect(T.es[k]).toBeTruthy();
      expect(T.en[k]).toBeTruthy();
    }
  });

  it("Ahorcado: the label, the lines and the counters exist in both languages", () => {
    for (const l of ["es", "en"] as const) {
      for (const k of ["gameAhorcado", "cHngStart", "cHngRuleOne", "cHngRuleMany", "cHngDanger", "cHngLast", "cHngSolved"]) {
        expect(T[l][k]).toBeTruthy();
      }
      expect(T[l].cHngRight("B")).toContain("B");
      expect(T[l].cHngWrong("Q")).toContain("Q");
      expect(T[l].cHngCount(5)).toContain("5");
      expect(T[l].cHngNext(2, 3)).toContain("2");
      expect(T[l].cHngDone("Ana")).toContain("Ana");
    }
    expect(T.es.cHngTally(1, 2)).toBe("Ganador 1 de 2");
    expect(T.en.cHngTally(1, 2)).toBe("Winner 1 of 2");
    expect(T.es.cHngStrike(1)).not.toBe(T.es.cHngStrike(3));
    expect(T.en.cHngLeft(1)).not.toBe(T.en.cHngLeft(3));
  });
});
