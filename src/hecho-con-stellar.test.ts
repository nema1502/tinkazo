import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * La firma "Hecho con" y el logo oficial de Stellar en la portada, y el aviso de marca en su pie
 * (docs/marca.md, "Marcas de otros"). Se lee el HTML y el CSS tal como están escritos.
 */
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
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
    const pie = html.slice(html.indexOf("<footer"));
    const nuevo = [linea, pie.match(/<p class="trademark-note"[\s\S]*?<\/p>/)?.[0] ?? "", ...(["es", "en"] as const).flatMap((l) => [T[l].builtOn, T[l].stellarNotice])];
    for (const texto of nuevo) expect(String(texto)).not.toContain("·");
  });
});

describe("el aviso de marca en el pie de la portada", () => {
  it("dice, en español y en inglés, que Tinkazo es independiente y que Stellar es marca de la Fundación", () => {
    expect(T.es.stellarNotice).toBe(
      "Tinkazo es software independiente: no está afiliado a la Stellar Development Foundation ni avalado por ella. Stellar es una marca registrada de la Stellar Development Foundation.",
    );
    expect(T.en.stellarNotice).toBe(
      "Tinkazo is independent software: it is not affiliated with or endorsed by the Stellar Development Foundation. Stellar is a registered trademark of the Stellar Development Foundation.",
    );
  });

  it("está dentro del pie y repite el español", () => {
    const pie = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(pie).toContain(`<p class="trademark-note" data-i="stellarNotice">${T.es.stellarNotice}</p>`);
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
