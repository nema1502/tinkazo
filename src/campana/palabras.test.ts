import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import { TEXTOS_CAMPANA } from "./textos";

const IDIOMAS = ["es", "en"] as const;
const CLAVES_DE_RED = [
  "cpPasoInstagram",
  "cpPasoTiktok",
  "cpPasoX",
  "cpPasoYoutube",
  "cpPasoFacebook",
  "cpPasoWhatsapp",
  "cpPasoEnlace",
] as const;

function textosCp(idioma: (typeof IDIOMAS)[number]): [string, string][] {
  return Object.entries(TEXTOS_CAMPANA[idioma]).filter(([clave]) => clave.startsWith("cp"));
}

describe("las palabras de la campaña", () => {
  it("tiene todas las claves cp en los dos idiomas y en el mismo orden", () => {
    expect(textosCp("es").map(([clave]) => clave)).toEqual(textosCp("en").map(([clave]) => clave));
  });

  it("no usa signos prohibidos en ningún texto cp", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of textosCp(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;\u00AB\u00BB\u0022\u201C\u201D\u201E\u2014\u2013\u00B7\u00A1!]/u);
      }
    }
  });

  it("no usa palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of textosCp(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
      }
    }
  });

  it("no dice ejemplo ni example en ningún texto cp", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of textosCp(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/ejemplo|example/iu);
      }
    }
  });

  it("no dice ejemplo ni example en los datos visibles de la campaña de muestra", () => {
    const campana = campanaDeEjemplo(Date.UTC(2026, 10, 21, 18));
    const visibles = [
      campana.empresa.nombre,
      campana.lugar.es,
      campana.lugar.en,
      campana.bases.es,
      campana.bases.en,
    ];
    for (const texto of visibles) expect(texto).not.toMatch(/ejemplo|example/iu);
  });

  it("mantiene cada texto de red en cuarenta caracteres o menos", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of CLAVES_DE_RED) {
        expect(TEXTOS_CAMPANA[idioma][clave]?.length ?? 0, `${idioma}.${clave}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("conserva los marcadores de cantidad y costo en los dos idiomas", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of ["cpContadorN", "cpPremioIguales", "cpEnLaListaN"] as const) {
        expect(TEXTOS_CAMPANA[idioma][clave], `${idioma}.${clave}`).toContain("{n}");
      }
      expect(TEXTOS_CAMPANA[idioma].cpRetiro, `${idioma}.cpRetiro`).toContain("{costo}");
    }
  });
});

describe("los términos de los sorteos de empresas", () => {
  const CLAVES_TM = ["tmCampanaT", "tmCampanaA", "tmCampanaB"] as const;

  it("trae las tres claves, con texto, en los dos idiomas", () => {
    for (const idioma of IDIOMAS) {
      for (const clave of CLAVES_TM) {
        expect(TEXTOS_CAMPANA[idioma][clave]?.length ?? 0, `${idioma}.${clave}`).toBeGreaterThan(10);
      }
    }
  });

  it("no usa signos ni palabras prohibidas", () => {
    const signos = /[;«»"“”„—–·¡!]/u;
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    for (const idioma of IDIOMAS) {
      for (const clave of CLAVES_TM) {
        const texto = TEXTOS_CAMPANA[idioma][clave] ?? "";
        expect(texto, `${idioma}.${clave}`).not.toMatch(signos);
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
      }
    }
  });

  it("dice que participar es gratis y que el premio se recibe gratis", () => {
    expect(TEXTOS_CAMPANA.es.tmCampanaA).toContain("Participar es gratis");
    expect(TEXTOS_CAMPANA.es.tmCampanaB).toContain("recibirlo es gratis");
    expect(TEXTOS_CAMPANA.en.tmCampanaA).toContain("Taking part is free");
    expect(TEXTOS_CAMPANA.en.tmCampanaB).toContain("receiving it is free");
  });

  it("terminos.html los trae con su texto en español, fuera de lo que depende del cobro", () => {
    const html = readFileSync("terminos.html", "utf8");
    const sinCobro = html.replace(/<template\b[\s\S]*?<\/template>/gu, "");
    for (const clave of CLAVES_TM) {
      const hallazgo = new RegExp(`data-i="${clave}">([^<]*)<`, "u").exec(sinCobro);
      expect(hallazgo, clave).not.toBeNull();
      expect(hallazgo?.[1], clave).toBe(TEXTOS_CAMPANA.es[clave]);
    }
  });
});
