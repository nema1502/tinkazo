import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { TEXTOS_EMPRESA } from "./textos";

const IDIOMAS = ["es", "en"] as const;

describe("los textos del panel de la empresa", () => {
  it("tiene las mismas claves en los dos idiomas y en el mismo orden", () => {
    const claves = Object.keys(TEXTOS_EMPRESA.es);
    expect(Object.keys(TEXTOS_EMPRESA.en)).toEqual(claves);
    expect(claves.length).toBeGreaterThan(30);
    expect(claves.every((c) => c.startsWith("epi"))).toBe(true);
  });

  it("cada clave es una cadena no vacía en los dos idiomas", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of Object.entries(TEXTOS_EMPRESA[idioma])) {
        expect(typeof texto === "string" && texto.length > 0, `${idioma}.${clave}`).toBe(true);
      }
    }
  });

  it("no usa signos prohibidos", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of Object.entries(TEXTOS_EMPRESA[idioma])) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;«»"“”„—–·¡!]/u);
      }
    }
  });

  it("no usa palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet|comisi[oó]n/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of Object.entries(TEXTOS_EMPRESA[idioma])) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
      }
    }
  });

  it("no choca con las claves del diccionario de siempre", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of Object.keys(TEXTOS_EMPRESA[idioma])) {
        expect(clave in T[idioma], `${idioma}.${clave} en T`).toBe(false);
      }
    }
  });
});
