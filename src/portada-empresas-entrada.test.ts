// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La entrada de las empresas a la vista (25 de noviembre de 2026). Antes era un enlace chico al final de la portada y, en
 * la cabecera, solo existía dentro de Más en el celular. Ahora está en la fila de la cabecera en escritorio, en el pie y
 * en la portada. La bandera de las campañas se decide antes del primer pintado: un atributo en el elemento html, puesto al
 * construir, y una regla de CSS que esconde lo de empresas cuando no vale lo que vale con las campañas abiertas.
 */
const html = readFileSync("index.html", "utf8");
const css = readFileSync("src/styles.css", "utf8");

describe("Para empresas en la cabecera y en el pie", () => {
  it("la cabecera y el pie traen el enlace marcado, a la vista desde el primer pintado (sin hidden)", () => {
    const cabecera = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
    const pie = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
    for (const [donde, trozo] of [["cabecera", cabecera], ["pie", pie]] as const) {
      const enlaces = trozo.match(/<a\b[^>]*href="\/crear-campana\.html"[^>]*>/g) ?? [];
      expect(enlaces.length, donde).toBeGreaterThanOrEqual(1);
      for (const enlace of enlaces) {
        expect(enlace, donde).toContain("data-campana-enlace");
        expect(enlace, donde).not.toMatch(/\bhidden\b/);
      }
      expect(enlaces.some((e) => e.includes('data-i="navEmpresas"')), donde).toBe(true);
    }
  });

  it("todo enlace a la campaña de la portada está marcado: sin las campañas abiertas la regla de CSS los esconde a todos", () => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    const enlaces = [...document.querySelectorAll<HTMLElement>('a[href="/crear-campana.html"]')];
    expect(enlaces.length).toBeGreaterThanOrEqual(3);
    for (const e of enlaces) {
      // El aviso del premio en plata se esconde y se muestra solo, con su propia prueba (src/ui/premio-plata.test.ts).
      const marcado = e.closest<HTMLElement>("[data-campana-enlace], #prize-plata");
      expect(marcado, e.outerHTML).not.toBeNull();
      expect(marcado?.hasAttribute("hidden") && !marcado.matches("#prize-plata"), e.outerHTML).toBeFalsy();
    }
  });

  it("styles.css ya no esconde Para empresas en la fila de escritorio y esconde lo de empresas con la bandera cerrada", () => {
    expect(css).not.toMatch(/@media \(min-width: 761px\) \{ \.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \} \}/);
    // Una sola regla, sin depender de un guion: el atributo de html decide, en la cabecera, el pie, la portada y Sortear.
    expect(css).toMatch(
      /html\[data-campanas\]:not\(\[data-campanas="1"\]\):not\(\[data-campanas="true"\]\) \[data-campana-enlace\] \{ display: none; \}/,
    );
    expect(css).not.toMatch(/a\[data-campana-enlace\]\[hidden\]/);
    expect(css).not.toMatch(/\.pies a\[hidden\]/);
  });

  it("el texto del enlace está en español y en inglés", () => {
    expect(T.es.navEmpresas).toBe("Para empresas");
    expect(T.en.navEmpresas).toBe("For companies");
  });
});

describe("Empresas en la fila de la cabecera del celular", () => {
  const cabecera = (): string => html.slice(html.indexOf("<header>"), html.indexOf("</header>"));

  it("el enlace corto está marcado, con su texto en los dos idiomas, y no repite el nombre largo", () => {
    const corto = cabecera().match(/<a\b[^>]*class="nav-empresas-cel"[^>]*>/)?.[0] ?? "";
    expect(corto).toContain('href="/crear-campana.html"');
    expect(corto).toContain("data-campana-enlace");
    expect(corto).not.toMatch(/\bhidden\b/);
    expect(corto).toContain('data-i="navEmpresasC"');
    expect(T.es.navEmpresasC).toBe("Empresas");
    expect(T.en.navEmpresasC).toBe("Companies");
  });

  it("va en el HTML donde se ve: después de Mis sorteos y antes de Más, y el CSS no lo reordena", () => {
    const h = cabecera();
    const orden = ["nav-app", "/#mis-sorteos", "nav-empresas-cel", 'class="mas"'].map((m) => h.indexOf(m));
    expect(orden.every((n) => n > -1), String(orden)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(css).not.toMatch(/\.topnav (?:> a|\.mas|a\.nav)[^{]*\{[^}]*\border: \d/);
  });

  it("de 375 a 760 px se ve en la fila y sale de Más, y por debajo de 375 px sigue dentro de Más", () => {
    expect(css).toMatch(/\.topnav a\.nav-empresas-cel \{ display: none; \}/);
    const bloque = css.match(/@media \(min-width: 375px\) and \(max-width: 760px\) \{([^}]*\{[^}]*\}[^}]*\{[^}]*\})\s*\}/)?.[1] ?? "";
    expect(bloque).toMatch(/\.topnav a\.nav-empresas-cel \{ display: inline-flex; \}/);
    expect(bloque).toMatch(/\.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \}/);
  });
});
