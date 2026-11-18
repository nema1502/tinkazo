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
