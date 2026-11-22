// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { claveDeLaCta, pintarLaCtaDeLaPagina } from "./cta-de-la-pagina";
import { T } from "./i18n";

/** El botón de entrar del final de como-funciona.html dice lo mismo que el de la portada. */

const html = readFileSync("como-funciona.html", "utf8");
const boton = /<a [^>]*data-cta-pagina[^>]*>[\s\S]*?<\/a>/u.exec(html)?.[0] ?? "";

describe("la clave del botón de entrar de las páginas de lectura", () => {
  it("con Google a mano dice Entrar con Google, con una sesión guardada Ir a sortear, y sin nada el texto de siempre", () => {
    expect(claveDeLaCta({ conSesion: false, conGoogle: true })).toBe("ctaGoogle");
    expect(claveDeLaCta({ conSesion: true, conGoogle: true })).toBe("ctaGo");
    expect(claveDeLaCta({ conSesion: true, conGoogle: false })).toBe("ctaGo");
    expect(claveDeLaCta({ conSesion: false, conGoogle: false })).toBe("ctaHero");
  });
});

describe("como-funciona.html", () => {
  it("trae el botón con el texto de siempre y la G escondida, sin el atributo que mueve la portada", () => {
    expect(boton).toContain('<span class="cta-t" data-i="ctaHero">Entrar y sortear gratis</span>');
    expect(boton).toContain('class="g-ico"');
    expect(boton).not.toContain("data-cta-entrar");
  });
});

describe("pintar el botón", () => {
  beforeEach(() => {
    document.body.innerHTML = boton;
  });

  it("con Google: el texto de la portada, en cada idioma, y la G a la vista", () => {
    for (const idioma of ["es", "en"] as const) {
      pintarLaCtaDeLaPagina(document, "ctaGoogle", (k) => String(T[idioma][k]));
      const enlace = document.querySelector<HTMLElement>("[data-cta-pagina]");
      expect(enlace?.dataset.g).toBe("1");
      expect(enlace?.textContent).toBe(T[idioma].ctaGoogle);
      expect(enlace?.querySelector<HTMLElement>(".cta-t")?.dataset.i).toBe("ctaGoogle");
    }
  });

  it("sin Google: el texto de siempre y la G escondida", () => {
    pintarLaCtaDeLaPagina(document, "ctaHero", (k) => String(T.es[k]));
    const enlace = document.querySelector<HTMLElement>("[data-cta-pagina]");
    expect(enlace?.dataset.g).toBe("0");
    expect(enlace?.textContent).toBe("Entrar y sortear gratis");
  });
});

describe("el botón de entrar en el celular", () => {
  it("la hoja le saca relleno a la tarjeta y al botón a 430 px o menos para que no se parta en cuatro renglones", () => {
    const hoja = readFileSync("src/styles.css", "utf8");
    const media = /@media \(max-width: 430px\)\s*\{\s*\.portada-fin\s*\{([^}]*)\}\s*a\.primary\.cta\.cta-pagina\s*\{([^}]*)\}/u.exec(hoja);
    expect(media?.[1]).toMatch(/padding-inline:\s*10px/u);
    expect(media?.[2]).toMatch(/padding-inline:\s*12px/u);
    expect(media?.[2]).toMatch(/font-size:\s*18px/u);
  });
});
