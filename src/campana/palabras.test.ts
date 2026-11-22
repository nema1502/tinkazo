import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campanaDeEjemplo } from "./ejemplo";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_CONFIRMAR } from "./textos-confirmar";
import { TEXTOS_EMPIEZA } from "./textos-empieza";
import { TEXTOS_PREMIO } from "./textos-premio";

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

describe("los textos de la tarjeta de confirmar el correo", () => {
  const todos = (idioma: (typeof IDIOMAS)[number]): [string, string][] => Object.entries(TEXTOS_CONFIRMAR[idioma]);

  it("tiene las mismas claves, en el mismo orden, en español y en inglés", () => {
    expect(todos("es").map(([clave]) => clave)).toEqual(todos("en").map(([clave]) => clave));
  });

  it("no usa signos prohibidos en ningún texto", () => {
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of todos(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;\u00AB\u00BB\u0022\u201C\u201D\u201E\u2014\u2013\u00B7\u00A1!]/u);
        // Ni flechas ni rayas: la tarjeta es una frase corta y dicha de corrido.
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[\u2190-\u21FF\u27F5-\u27FF]/u);
        expect(texto.trim(), `${idioma}.${clave}`).toBe(texto);
        expect(texto.length, `${idioma}.${clave}`).toBeGreaterThan(3);
      }
    }
  });

  it("no usa palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet|token|otp|turnkey|pollar|passkey/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of todos(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
      }
    }
  });

  it("conserva los marcadores del correo y de los segundos en los dos idiomas", () => {
    for (const idioma of IDIOMAS) {
      expect(TEXTOS_CONFIRMAR[idioma].ccCodigoLinea, idioma).toContain("{mail}");
      expect(TEXTOS_CONFIRMAR[idioma].ccOtroCodigoEn, idioma).toContain("{s}");
    }
  });

  it("no repite ninguna clave de la página: cada diccionario tiene las suyas", () => {
    const repetidas = Object.keys(TEXTOS_CONFIRMAR.es).filter((clave) => clave in TEXTOS_CAMPANA.es);
    expect(repetidas).toEqual([]);
  });

  it("cada clave cc que usa el código existe en el diccionario de la tarjeta, y cada una del diccionario se usa", () => {
    const codigo = ["confirmar.ts", "confirmar-estado.ts"].map((f) => readFileSync(`src/campana/${f}`, "utf8")).join("\n");
    const usadas = new Set([...codigo.matchAll(/["'](cc[A-Z][A-Za-z0-9]*)["']/gu)].map((m) => m[1] ?? ""));
    for (const clave of usadas) expect(TEXTOS_CONFIRMAR.es[clave], clave).toBeTypeOf("string");
    const sinUso = Object.keys(TEXTOS_CONFIRMAR.es).filter((clave) => !usadas.has(clave));
    expect(sinUso).toEqual([]);
  });

  it("la tarjeta no importa el diccionario del sitio", () => {
    for (const archivo of ["confirmar.ts", "confirmar-estado.ts", "textos-confirmar.ts", "sesion-confirmar.ts"]) {
      expect(readFileSync(`src/campana/${archivo}`, "utf8"), archivo).not.toMatch(/from\s+["']\.\.\/i18n["']/u);
    }
  });
});

describe("los textos de Ganaste según la cuenta", () => {
  const todos = (idioma: (typeof IDIOMAS)[number]): [string, string][] => Object.entries(TEXTOS_PREMIO[idioma]);

  it("tiene las mismas claves, en el mismo orden, en español y en inglés", () => {
    expect(todos("es").map(([clave]) => clave)).toEqual(todos("en").map(([clave]) => clave));
  });

  it("no usa signos prohibidos, palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet|token|otp|turnkey|pollar|passkey/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of todos(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;\u00AB\u00BB\u0022\u201C\u201D\u201E\u2014\u2013\u00B7\u00A1!]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[\u2190-\u21FF\u27F5-\u27FF]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
        expect(texto.trim(), `${idioma}.${clave}`).toBe(texto);
      }
    }
  });

  it("no repite ninguna clave de la página ni de la tarjeta: cada diccionario tiene las suyas", () => {
    const propias = Object.keys(TEXTOS_PREMIO.es);
    expect(propias.filter((clave) => clave in TEXTOS_CAMPANA.es || clave in TEXTOS_CONFIRMAR.es)).toEqual([]);
  });

  it("cada clave cg que usa el código existe en el diccionario, y cada una del diccionario se usa", () => {
    const codigo = readFileSync("src/campana/premio.ts", "utf8");
    const usadas = new Set([...codigo.matchAll(/["'](cg[A-Z][A-Za-z0-9]*)["']/gu)].map((m) => m[1] ?? ""));
    for (const clave of usadas) expect(TEXTOS_PREMIO.es[clave], clave).toBeTypeOf("string");
    expect(Object.keys(TEXTOS_PREMIO.es).filter((clave) => !usadas.has(clave))).toEqual([]);
  });

  it("no importa el diccionario del sitio, y la página lo baja con import() y no de entrada", () => {
    for (const archivo of ["premio.ts", "textos-premio.ts"]) {
      expect(readFileSync(`src/campana/${archivo}`, "utf8"), archivo).not.toMatch(/from\s+["']\.\.\/i18n["']/u);
    }
    const celular = readFileSync("src/campana/celular.ts", "utf8");
    expect(celular).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']\.\/(?:premio|textos-premio)["']/mu);
    expect(celular).toMatch(/import\(["']\.\/premio["']\)/u);
  });
});

describe("los textos de El sorteo está por empezar", () => {
  const todos = (idioma: (typeof IDIOMAS)[number]): [string, string][] => Object.entries(TEXTOS_EMPIEZA[idioma]);

  it("tiene las mismas claves, en el mismo orden, en español y en inglés", () => {
    expect(todos("es").map(([clave]) => clave)).toEqual(todos("en").map(([clave]) => clave));
  });

  it("no usa signos prohibidos, palabras de juegos de azar ni términos técnicos", () => {
    const prohibidas = /\b(?:rifa|lotería|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu;
    const tecnicas = /stellar|usdc|blockchain|hash|wallet|token|drand|ronda|round|semilla|seed/iu;
    for (const idioma of IDIOMAS) {
      for (const [clave, texto] of todos(idioma)) {
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[;«»"“”„—–·¡!]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(/[←-⇿⟵-⟿]/u);
        expect(texto, `${idioma}.${clave}`).not.toMatch(prohibidas);
        expect(texto, `${idioma}.${clave}`).not.toMatch(tecnicas);
        expect(texto.trim(), `${idioma}.${clave}`).toBe(texto);
      }
    }
  });

  it("conserva el marcador del tiempo en los dos idiomas", () => {
    for (const idioma of IDIOMAS) expect(TEXTOS_EMPIEZA[idioma].ceEmpiezaEn, idioma).toContain("{t}");
  });

  it("no repite ninguna clave de la página, de la tarjeta ni de Ganaste: cada diccionario tiene las suyas", () => {
    const propias = Object.keys(TEXTOS_EMPIEZA.es);
    expect(propias.filter((clave) => clave in TEXTOS_CAMPANA.es || clave in TEXTOS_CONFIRMAR.es || clave in TEXTOS_PREMIO.es)).toEqual([]);
  });

  it("cada clave ce que usa el código existe en el diccionario, y cada una del diccionario se usa", () => {
    const codigo = readFileSync("src/campana/empieza.ts", "utf8");
    const usadas = new Set([...codigo.matchAll(/["'](ce[A-Z][A-Za-z0-9]*)["']/gu)].map((m) => m[1] ?? ""));
    for (const clave of usadas) expect(TEXTOS_EMPIEZA.es[clave], clave).toBeTypeOf("string");
    expect(Object.keys(TEXTOS_EMPIEZA.es).filter((clave) => !usadas.has(clave))).toEqual([]);
  });

  it("no importa el diccionario del sitio", () => {
    for (const archivo of ["empieza.ts", "empieza-ritmo.ts", "textos-empieza.ts"]) {
      expect(readFileSync(`src/campana/${archivo}`, "utf8"), archivo).not.toMatch(/from\s+["']\.\.\/i18n["']/u);
    }
  });
});
