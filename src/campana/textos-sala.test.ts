import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_SALA_CAMPANA } from "./textos-sala";

const IDIOMAS = ["es", "en"] as const;
const AVISOS_DEL_CELULAR = [
  "cpoOtroModo",
  "cpoPremiosIguales",
  "cpoSalStand",
  "cpoSalEnsayo",
  "cpoSinFirma",
  "cpoMuchas",
  "cpoOtroModoAbierta",
  "cpoRevisaCampo",
  "cpoQrSinConexion",
  "cpoParaRevisarNota",
  "cpoSeBorra",
  "cpoElegirLinea",
  "cpoYaExiste",
];
const huecos = (texto: string): string[] => [...texto.matchAll(/\{[a-z]+\}/gu)].map((m) => m[0]).sort();

describe("los textos del panel de quien organiza", () => {
  it("tiene las mismas claves en los dos idiomas y en el mismo orden", () => {
    const claves = Object.keys(TEXTOS_SALA_CAMPANA.es);
    expect(Object.keys(TEXTOS_SALA_CAMPANA.en)).toEqual(claves);
    expect(claves.every((c) => c.startsWith("cpo"))).toBe(true);
  });

  it("cada texto lleva los mismos huecos en los dos idiomas", () => {
    for (const [clave, es] of Object.entries(TEXTOS_SALA_CAMPANA.es)) {
      expect(huecos(TEXTOS_SALA_CAMPANA.en[clave] ?? ""), clave).toEqual(huecos(es));
    }
  });

  it("no usa signos prohibidos", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of Object.entries(TEXTOS_SALA_CAMPANA[idioma])) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;«»"“”„—–·¡!]/u);
      }
    }
  });

  it("no usa palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of Object.entries(TEXTOS_SALA_CAMPANA[idioma])) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
      }
    }
  });

  it("no choca con las claves del diccionario ni con las del celular", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of Object.keys(TEXTOS_SALA_CAMPANA[idioma])) {
        expect(clave in TEXTOS_CAMPANA[idioma], `${idioma}.${clave} en TEXTOS_CAMPANA`).toBe(false);
        expect(clave in T[idioma], `${idioma}.${clave} en T`).toBe(false);
      }
    }
  });

  it("los avisos del panel caben en una línea de celular, unos 40 caracteres", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of AVISOS_DEL_CELULAR) {
        expect(TEXTOS_SALA_CAMPANA[idioma][clave]?.length ?? 99, `${idioma}.${clave}`).toBeLessThanOrEqual(46);
      }
    }
  });
});
