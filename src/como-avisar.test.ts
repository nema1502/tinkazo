import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Una forma de torcer un sorteo es una falla de seguridad, y la política (SECURITY.md) pide
 * avisarla por correo antes de contarla en público. El sitio y los README no pueden decir otra
 * cosa: quien los lea no tiene que publicar la falla antes de que se pueda arreglar. Las
 * pruebas cuidan el hecho (adónde manda cada texto) y no fijan las frases.
 */
const CORREO = "hola@tinkazo.app";
const REPO = "https://github.com/nema1502/tinkazo";
const POLITICA = `${REPO}/blob/main/SECURITY.md`;

const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8").split(String.fromCharCode(13)).join("");

/** El bloque de la página de seguridad que habla de qué hacer si se encuentra una falla. */
const bloqueDelReporte = (): string => {
  const html = leer("seguridad.html");
  const desde = html.indexOf('data-i="sgReportT"');
  expect(desde).toBeGreaterThanOrEqual(0);
  const hasta = html.indexOf("</section>", desde);
  expect(hasta).toBeGreaterThan(desde);
  return html.slice(desde, hasta);
};

const enlaces = (html: string): { href: string; clave: string | null; resto: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>/g)].map((m) => ({
    href: /href="([^"]*)"/.exec(m[1]!)?.[1] ?? "",
    clave: /data-i="([^"]*)"/.exec(m[1]!)?.[1] ?? null,
    resto: m[1]!,
  }));

describe("la página de seguridad dice cómo avisar una falla", () => {
  it.each(["es", "en"] as const)("el texto del reporte en %s trae el correo y no manda a abrir un issue", (idioma) => {
    const texto = T[idioma]["sgReportB"] as string;
    expect(texto).toContain(CORREO);
    expect(texto).not.toMatch(/\bissues?\b/i);
  });

  it("el bloque del HTML trae el mismo texto de partida que el diccionario en español", () => {
    const html = bloqueDelReporte();
    const parrafo = /<p[^>]*data-i="sgReportB"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(parrafo).not.toBeNull();
    expect(parrafo![1]).toContain(CORREO);
    expect(parrafo![1]).not.toMatch(/\bissues?\b/i);
  });

  it("el bloque no enlaza la lista de issues y sí la política de seguridad", () => {
    const links = enlaces(bloqueDelReporte());
    expect(links.filter((l) => /\/issues\b/.test(l.href))).toEqual([]);
    const aviso = links.filter((l) => l.href === POLITICA);
    expect(aviso).toHaveLength(1);
    expect(aviso[0]!.clave).toBe("sgLinkAviso");
    expect(aviso[0]!.resto).toContain('target="_blank"');
    expect(aviso[0]!.resto).toContain('rel="noopener"');
  });

  it("el botón nuevo existe en los dos idiomas con la misma flecha que los otros", () => {
    for (const idioma of ["es", "en"] as const) {
      const d = T[idioma] as Record<string, unknown>;
      expect(typeof d["sgLinkAviso"], idioma).toBe("string");
      expect(d["sgLinkAviso"] as string, idioma).toMatch(/ ↗$/);
      expect(d["sgLinkAviso"] as string, idioma).not.toMatch(/\bissues?\b/i);
    }
  });

  it("las claves de enlace de esa página no quedan huérfanas", () => {
    const paginas = ["seguridad.html", "terminos.html"].map(leer).join("\n");
    const usadas = new Set([...paginas.matchAll(/data-i="(sgLink\w+)"/g)].map((m) => m[1]!));
    for (const idioma of ["es", "en"] as const) {
      const definidas = Object.keys(T[idioma]).filter((k) => /^sgLink/.test(k));
      expect(definidas.filter((k) => !usadas.has(k)), idioma).toEqual([]);
    }
    // El botón viejo ya no está en la página de seguridad: lo sigue usando la de términos.
    expect(enlaces(leer("seguridad.html")).some((l) => l.clave === "sgLinkIssue")).toBe(false);
  });
});

describe("los README dicen cómo avisar una falla", () => {
  it.each([
    { archivo: "README.md", frase: /skew a draw/ },
    { archivo: "README.es.md", frase: /torcer un sorteo/ },
  ])("$archivo manda a escribir al correo y enlaza la política, no a abrir un issue", ({ archivo, frase }) => {
    const lineas = leer(archivo).split("\n").filter((l) => frase.test(l));
    expect(lineas).toHaveLength(1);
    const linea = lineas[0]!;
    expect(linea).toContain(CORREO);
    expect(linea).toContain("(SECURITY.md)");
    expect(linea).not.toMatch(/(open|abr[ií]) (an|un) issue/i);
  });
});
