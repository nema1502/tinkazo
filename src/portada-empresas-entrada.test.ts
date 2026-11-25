// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La entrada de las empresas a la vista (25 de noviembre de 2026). Antes era un enlace chico al final de la portada y, en
 * la cabecera, solo existía dentro de Más en el celular. Ahora está en la fila de la cabecera en escritorio, en el pie y
 * en la portada, y en los tres sitios sigue la misma regla de siempre: nace escondida y la muestra `main.ts` solo con las
 * campañas abiertas.
 */
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("Para empresas en la cabecera y en el pie", () => {
  it("la cabecera y el pie traen el enlace, escondido hasta que las campañas estén abiertas", () => {
    const cabecera = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
    const pie = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
    for (const [donde, trozo] of [["cabecera", cabecera], ["pie", pie]] as const) {
      const enlace = trozo.match(/<a\b[^>]*href="\/crear-campana\.html"[^>]*>/)?.[0] ?? "";
      expect(enlace, donde).not.toBe("");
      expect(enlace, donde).toContain("data-campana-enlace");
      expect(enlace, donde).toMatch(/\bhidden\b/);
      expect(enlace, donde).toContain('data-i="navEmpresas"');
    }
  });

  it("todo enlace a la campaña de la portada nace escondido: sin las campañas abiertas no se ve ninguno", () => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    const enlaces = [...document.querySelectorAll<HTMLElement>('a[href="/crear-campana.html"]')];
    expect(enlaces.length).toBeGreaterThanOrEqual(3);
    for (const e of enlaces) {
      // El aviso del premio en plata se esconde y se muestra solo, con su propia prueba (src/ui/premio-plata.test.ts).
      const marcado = e.closest<HTMLElement>("[data-campana-enlace], #prize-plata");
      expect(marcado, e.outerHTML).not.toBeNull();
      expect(marcado?.hasAttribute("hidden"), e.outerHTML).toBe(true);
    }
  });

  it("styles.css ya no esconde Para empresas en la fila de escritorio", () => {
    expect(css).not.toMatch(/@media \(min-width: 761px\) \{ \.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \} \}/);
    // Lo escondido por el atributo sigue escondido, en la cabecera y en el pie (los dos tienen su propia regla de display).
    expect(css).toMatch(/\.topnav \.mas-lista a\[data-campana-enlace\]\[hidden\] \{ display: none; \}/);
    expect(css).toMatch(/\.pies a\[hidden\] \{ display: none; \}/);
  });

  it("el texto del enlace está en español y en inglés", () => {
    expect(T.es.navEmpresas).toBe("Para empresas");
    expect(T.en.navEmpresas).toBe("For companies");
  });
});

describe("Empresas en la fila de la cabecera del celular", () => {
  it("el enlace corto nace escondido, con su texto en los dos idiomas, y no repite el nombre largo", () => {
    const cabecera = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
    const corto = cabecera.match(/<a\b[^>]*class="nav-empresas-cel"[^>]*>/)?.[0] ?? "";
    expect(corto).toContain('href="/crear-campana.html"');
    expect(corto).toContain("data-campana-enlace");
    expect(corto).toMatch(/\bhidden\b/);
    expect(corto).toContain('data-i="navEmpresasC"');
    expect(T.es.navEmpresasC).toBe("Empresas");
    expect(T.en.navEmpresasC).toBe("Companies");
  });

  it("de 360 a 760 px se ve en la fila y sale de Más, y por debajo de 360 px sigue dentro de Más", () => {
    expect(css).toMatch(/\.topnav a\.nav-empresas-cel \{ display: none; \}/);
    const bloque = css.match(/@media \(min-width: 360px\) and \(max-width: 760px\) \{([^}]*\{[^}]*\}[^}]*\{[^}]*\})\s*\}/)?.[1] ?? "";
    expect(bloque).toMatch(/nav-empresas-cel:not\(\[hidden\]\) \{ display: inline-flex; order: 2; \}/);
    expect(bloque).toMatch(/\.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \}/);
  });
});
