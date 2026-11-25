// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T, setLang } from "./i18n";

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
      expect(trozo, donde).toContain('data-i="navEmpresas"');
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

  it("la guía de UX cuenta los cortes de verdad: 412 px para la fila, 859 y 820 px para los renglones de las puertas", () => {
    const ux = readFileSync("docs/ux.md", "utf8");
    expect(ux).toContain("de 412 a 760 px");
    expect(ux).not.toMatch(/375 a 760 px/);
    expect(ux).toContain("Hasta 859 px de ancho, y desde 860 px solo en una pantalla de 820 px de alto o menos");
    expect(ux).not.toContain("menos de 820 px de alto");
    expect(css).toMatch(/@media \(max-width: 859px\), \(min-width: 860px\) and \(max-height: 820px\) \{/);
  });

  it("de 412 a 760 px se ve en la fila y sale de Más, y por debajo de 412 px sigue dentro de Más", () => {
    expect(css).toMatch(/\.topnav a\.nav-empresas-cel \{ display: none; \}/);
    const bloque = css.match(/@media \(min-width: 412px\) and \(max-width: 760px\) \{([^}]*\{[^}]*\}[^}]*\{[^}]*\})\s*\}/)?.[1] ?? "";
    expect(bloque).toMatch(/\.topnav a\.nav-empresas-cel \{ display: inline-flex; \}/);
    expect(bloque).toMatch(/\.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \}/);
    // El enlace de adentro de Más solo se esconde en ese tramo: por debajo de 412 px se ve y desde 761 px la lista no es un menú.
    expect(css.match(/\.topnav \.mas-lista a\[data-campana-enlace\] \{ display: none; \}/g)?.length).toBe(1);
    expect(css).not.toMatch(/min-width: 375px\) and \(max-width: 760px/);
  });
});

describe("el enlace de escritorio dice Empresas de 1101 a 1439 px y Para empresas en los demás anchos", () => {
  const enlace = (): HTMLAnchorElement => {
    document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
    return document.querySelector<HTMLAnchorElement>('header .mas-lista a[href="/crear-campana.html"]') as HTMLAnchorElement;
  };

  it("lleva los dos nombres adentro, cada uno con su clave, y el enlace queda marcado y a la vista", () => {
    const a = enlace();
    expect(a.hasAttribute("data-campana-enlace")).toBe(true);
    expect(a.hasAttribute("hidden")).toBe(false);
    // El texto vive en los dos hijos: el enlace no lleva data-i, o setLang le borraría los hijos.
    expect(a.hasAttribute("data-i")).toBe(false);
    expect(a.querySelector(".nav-emp-l")?.getAttribute("data-i")).toBe("navEmpresas");
    expect(a.querySelector(".nav-emp-c")?.getAttribute("data-i")).toBe("navEmpresasC");
    expect(a.children).toHaveLength(2);
  });

  it("los dos nombres se traducen: Para empresas y Empresas, For companies y Companies", () => {
    const a = enlace();
    setLang("es");
    expect(a.querySelector(".nav-emp-l")?.textContent).toBe("Para empresas");
    expect(a.querySelector(".nav-emp-c")?.textContent).toBe("Empresas");
    setLang("en");
    expect(a.querySelector(".nav-emp-l")?.textContent).toBe("For companies");
    expect(a.querySelector(".nav-emp-c")?.textContent).toBe("Companies");
    setLang("es");
    expect(a.querySelector(".nav-emp-l")?.textContent).toBe("Para empresas");
  });

  it("la hoja esconde el corto por defecto y, de 1101 a 1439 px, esconde el largo y muestra el corto, con display none", () => {
    expect(css).toMatch(/\.topnav a \.nav-emp-c \{ display: none; \}/);
    const bloque = css.match(/@media \(min-width: 1101px\) and \(max-width: 1439px\) \{\s*\.topnav a \.nav-emp-l \{ display: none; \}\s*\.topnav a \.nav-emp-c \{ display: inline; \}\s*\}/);
    expect(bloque).not.toBeNull();
    // Ninguna otra regla cambia cuál se ve, ni reordena la fila.
    expect(css.match(/\.nav-emp-l \{/g)?.length).toBe(1);
    expect(css.match(/\.nav-emp-c \{/g)?.length).toBe(2);
  });

  it("el orden de la fila no cambia: Sortear, Mis sorteos, Empresas corto del celular, Más y adentro Juegos, Cómo funciona y Para empresas", () => {
    const h = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
    const orden = ['data-i="navSortear"', 'data-i="navMis"', "nav-empresas-cel", 'data-i="navJuegos"', 'data-i="navComo"', 'class="nav-emp-l"'].map((m) => h.indexOf(m));
    expect(orden.every((n) => n > -1), String(orden)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });
});

describe("los tres pasos de la portada, en una fila desde 761 px", () => {
  it("desde 761 px la grilla pide 220 px por columna y 20 px de hueco: tres columnas caben en 700 px, el ancho útil de 761 px es 721", () => {
    const base = css.match(/\.steps \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\((\d+)px, 1fr\)\); gap: 14px (\d+)px;/);
    // Por debajo de 761 px quedan como estaban.
    expect(base?.[1]).toBe("260");
    expect(base?.[2]).toBe("28");
    const bloque = css.match(/@media \(min-width: 761px\) \{ \.steps \{ grid-template-columns: repeat\(auto-fit, minmax\((\d+)px, 1fr\)\); gap: 14px (\d+)px; \} \}/);
    expect(bloque).not.toBeNull();
    const columna = Number(bloque?.[1]);
    const hueco = Number(bloque?.[2]);
    const relleno = 40;
    const barra = 15;
    const util761 = 761 - relleno - barra;
    expect(3 * columna + 2 * hueco, "tres columnas").toBeLessThanOrEqual(util761);
    // Lo que queda de la columna para el título y la línea, después del dibujo de 64 px y su hueco de 16 px.
    expect(columna - 64 - 16).toBeGreaterThanOrEqual(140);
  });
});
