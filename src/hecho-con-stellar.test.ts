import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La firma "Hecho con" y el logo oficial de Stellar en la portada, y el aviso de marca de Stellar,
 * que va al final de la página de términos y no en la portada (docs/marca.md, "Marcas de otros").
 * Se lee el HTML y el CSS tal como están escritos.
 */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const terminos = readFileSync(new URL("../terminos.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const LOGOS = {
  claro: "public/terceros/stellar/stellar-logo-negro-511x128.webp",
  oscuro: "public/terceros/stellar/stellar-logo-blanco-511x128.webp",
};
const LIMITE_BYTES = 20 * 1024;
/** El logo oficial, ya achicado parejo: 511 por 128 píxeles. */
const PROPORCION = 511 / 128;

const linea = html.match(/<p class="built-on">[\s\S]*?<\/p>/)?.[0] ?? "";
const atributo = (etiqueta: string, nombre: string): string | undefined => new RegExp(`\\s${nombre}="([^"]*)"`).exec(etiqueta)?.[1];
const imagenes = [...linea.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);

describe("la firma «Hecho con» Stellar en la portada", () => {
  it("la línea está en el bloque de arriba de la portada, debajo del botón principal", () => {
    const hero = html.match(/<section class="hero hero-portada[^"]*">[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(linea).not.toBe("");
    expect(hero).toContain(linea);
    expect(hero.indexOf("data-cta-entrar")).toBeGreaterThan(-1);
    expect(hero.indexOf(linea)).toBeGreaterThan(hero.indexOf("data-cta-entrar"));
    expect(html.match(/class="built-on"/g)).toHaveLength(1);
  });

  it("toda la línea es un enlace a stellar.org que abre en otra pestaña, con noopener", () => {
    const enlaces = [...linea.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(enlaces).toHaveLength(1);
    const a = enlaces[0] as string;
    expect(atributo(a, "href")).toBe("https://stellar.org");
    expect(atributo(a, "target")).toBe("_blank");
    expect(atributo(a, "rel")).toMatch(/\bnoopener\b/);
    // El texto y las dos imágenes están adentro del enlace, y el texto va primero.
    const dentro = linea.slice(linea.indexOf(a) + a.length, linea.indexOf("</a>"));
    expect(dentro).toMatch(/^<span class="built-on-text" data-i="builtOn">Hecho con<\/span><img /);
    expect(dentro.match(/<img\b/g)).toHaveLength(2);
  });

  it("trae las dos imágenes, la clara y la oscura, con el alt «Stellar», su ancho y su alto", () => {
    expect(imagenes).toHaveLength(2);
    const [clara, oscura] = imagenes as [string, string];
    expect(atributo(clara, "class")).toContain("built-on-logo-light");
    expect(atributo(oscura, "class")).toContain("built-on-logo-dark");
    expect(atributo(clara, "src")).toBe(`/${LOGOS.claro.replace("public/", "")}`);
    expect(atributo(oscura, "src")).toBe(`/${LOGOS.oscuro.replace("public/", "")}`);
    for (const img of imagenes) {
      expect(atributo(img, "alt")).toBe("Stellar");
      const ancho = Number(atributo(img, "width"));
      const alto = Number(atributo(img, "height"));
      expect(Number.isInteger(ancho) && Number.isInteger(alto), img).toBe(true);
      // Una firma de unos 20 px de alto, y con la proporción del logo oficial (sin estirarlo).
      expect(alto).toBeGreaterThanOrEqual(18);
      expect(alto).toBeLessThanOrEqual(22);
      expect(Math.abs(ancho / alto / PROPORCION - 1)).toBeLessThan(0.01);
    }
  });

  it("«Hecho con» y «Built on» están en español y en inglés, y el HTML repite el español", () => {
    expect(T.es.builtOn).toBe("Hecho con");
    expect(T.en.builtOn).toBe("Built on");
    expect(linea).toContain(`data-i="builtOn">${T.es.builtOn}<`);
  });

  it("el logo no se altera: el CSS no le pone filtros, recortes ni transparencia, y cada tema ve su archivo", () => {
    const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const reglas = sinComentarios.match(/[^{}]*built-on-logo[^{}]*\{[^}]*\}/g) ?? [];
    expect(reglas.length).toBeGreaterThan(3);
    for (const regla of reglas) expect(regla).not.toMatch(/\b(filter|object-fit|object-position|clip|clip-path|mask|mix-blend-mode|opacity|transform|aspect-ratio)\b/);
    expect(css).toContain(':root[data-theme="dark"] .built-on-logo-dark { display: block; }');
    expect(css).toContain(':root[data-theme="dark"] .built-on-logo-light { display: none; }');
    expect(css).toContain(':root:not([data-theme="light"]) .built-on-logo-dark { display: block; }');
    expect(css).toContain(':root:not([data-theme="light"]) .built-on-logo-light { display: none; }');
    expect(css).toMatch(/\.built-on-logo-dark \{ display: none; \}/);
  });

  it("nada de lo nuevo lleva el punto medio", () => {
    const aviso = terminos.match(/<p class="note" data-i="tmStellarMarca"[\s\S]*?<\/p>/)?.[0] ?? "";
    expect(aviso).not.toBe("");
    const nuevo = [linea, aviso, ...(["es", "en"] as const).flatMap((l) => [T[l].builtOn, T[l].tmStellarMarca])];
    for (const texto of nuevo) expect(String(texto)).not.toContain("·");
  });
});

describe("el aviso de marca de Stellar va en la página de términos y no en la portada", () => {
  const AVISO_ES =
    "Stellar es una marca de la Stellar Development Foundation. Todos los derechos reservados. Tinkazo es un proyecto independiente: no está afiliado a la Stellar Development Foundation, ni patrocinado ni avalado por ella.";
  const AVISO_EN =
    '"Stellar" is a trademark of the Stellar Development Foundation. All rights reserved. Tinkazo is an independent project, not affiliated with, sponsored or endorsed by the Stellar Development Foundation.';

  it("la portada no lleva el aviso: ni el párrafo, ni la clase, ni la clave, ni el texto", () => {
    expect(html).not.toContain("trademark-note");
    expect(html).not.toContain("stellarNotice");
    expect(html).not.toContain("tmStellarMarca");
    expect(html).not.toContain("Stellar Development Foundation");
    expect(html).not.toContain("marca registrada");
    expect(css).not.toContain("trademark-note");
    // La firma, en cambio, sigue donde estaba: «Hecho con» y el logo.
    expect(html.match(/class="built-on"/g)).toHaveLength(1);
    // La clave vieja ya no existe en ningún idioma.
    for (const idioma of ["es", "en"] as const) expect(T[idioma].stellarNotice, idioma).toBeUndefined();
  });

  it("el diccionario dice, en español y en inglés, que Stellar es marca de la Fundación y que Tinkazo es independiente", () => {
    expect(T.es.tmStellarMarca).toBe(AVISO_ES);
    expect(T.en.tmStellarMarca).toBe(AVISO_EN);
  });

  it("terminos.html lleva el aviso como nota chica al final del contenido, con el texto en español", () => {
    const principal = terminos.slice(terminos.indexOf("<main"), terminos.indexOf("</main>"));
    const nota = `<p class="note" data-i="tmStellarMarca">${AVISO_ES}</p>`;
    expect(principal).toContain(nota);
    expect(terminos.match(/data-i="tmStellarMarca"/g)).toHaveLength(1);
    // Va después del enlace al documento legal, ya en el cierre de la sección «Y además».
    expect(principal.indexOf(nota)).toBeGreaterThan(principal.indexOf('data-i="tmLinkLegal"'));
    // No está en el pie, que en las páginas de lectura es solo navegación.
    expect(terminos.slice(terminos.indexOf("<footer"))).not.toContain("tmStellarMarca");
  });

  it("no insinúa aval: ni «socio», ni «aliado oficial», ni «certificado por Stellar»", () => {
    for (const idioma of ["es", "en"] as const) {
      expect(String(T[idioma].tmStellarMarca), idioma).not.toMatch(/socio|partner|aliad|certificad|certified|oficial/i);
    }
  });
});

describe("el tamaño de la firma y del aviso de marca", () => {
  it("la firma va en 16 px o más, sin agrandar el logo ni achicar el blanco de toque, y el aviso usa la nota de la página", () => {
    // La letra secundaria de la herramienta mide 16 px (la regla la mide scripts/audit-legible.mjs).
    expect(css).toContain("--letra-sec: 16px");
    const enlace = /\.built-on-link\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(enlace).toMatch(/font-size:\s*var\(--letra-sec\)/);
    expect(enlace).toContain("min-height: 44px");
    const logo = /\.built-on-logo\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(logo).toMatch(/height:\s*20px/);
    // El aviso es un `.note`, que mide 16 px y va en gris: chico, pero legible.
    const nota = /\n\s*\.note\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(nota).toMatch(/font-size:\s*16px/);
  });
});

describe("los archivos del logo de Stellar", () => {
  it.each(Object.entries(LOGOS))("el del tema %s existe, es WebP y pesa menos de 20 KB", (_tema, ruta) => {
    const archivo = new URL(`../${ruta}`, import.meta.url);
    expect(existsSync(archivo), ruta).toBe(true);
    expect(statSync(archivo).size, ruta).toBeLessThan(LIMITE_BYTES);
    const bytes = readFileSync(archivo);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("no están en public/marca, que es el kit de Tinkazo y tiene pruebas que cuentan sus archivos", () => {
    for (const ruta of Object.values(LOGOS)) expect(ruta.startsWith("public/terceros/stellar/")).toBe(true);
  });
});
