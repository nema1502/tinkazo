import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { esRastreador } from "./idioma";

/**
 * Lo que el buscador exige de cada página que se indexa: un título y una
 * descripción propios y con el largo que muestra Google, la dirección canónica,
 * los idiomas (hreflang y og:locale), una imagen para compartir, un solo h1,
 * imágenes con alt y datos estructurados que se parseen y digan lo mismo que la
 * página. Se lee del disco, sin navegador.
 */

const BASE = "https://tinkazo.app";
const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

const PAGINAS = [
  "index.html",
  "juegos.html",
  "como-funciona.html",
  "historia.html",
  "seguridad.html",
  "precios.html",
  "terminos.html",
  "marca.html",
  "sorteo-para-meetup.html",
  "sorteo-en-clase.html",
  "sorteo-verificable.html",
  "ruleta-de-nombres.html",
  "sorteo-para-eventos.html",
];

const dire = (archivo: string): string => (archivo === "index.html" ? `${BASE}/` : `${BASE}/${archivo}`);
const titulo = (html: string): string => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const meta = (html: string, nombre: string): string => html.match(new RegExp(`<meta (?:name|property)="${nombre}" content="([^"]*)"`))?.[1] ?? "";
const largo = (s: string): number => [...s].length;

const nodos = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
    const b = JSON.parse(m[1] ?? "{}") as Record<string, unknown>;
    return Array.isArray(b["@graph"]) ? (b["@graph"] as Array<Record<string, unknown>>) : [b];
  });

describe("cada página que se indexa", () => {
  const titulos = PAGINAS.map((a) => titulo(leer(a)));

  it("tiene un título distinto de todos los demás", () => {
    expect(new Set(titulos).size).toBe(PAGINAS.length);
  });

  it.each(PAGINAS)("%s: título de 50 a 60 caracteres y descripción de 140 a 160, en los dos idiomas", (archivo) => {
    const html = leer(archivo);
    const etiqueta = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    const claves = [etiqueta.match(/data-titulo-clave="([^"]+)"/)?.[1] ?? "", etiqueta.match(/data-desc-clave="([^"]+)"/)?.[1] ?? ""];
    expect(claves.every(Boolean), "pide su título y su descripción por clave").toBe(true);
    for (const idioma of ["es", "en"] as const) {
      const [t, d] = claves.map((c) => T[idioma][c as string]) as [string, string];
      expect(largo(t), `título ${idioma}: ${t}`).toBeGreaterThanOrEqual(50);
      expect(largo(t), `título ${idioma}: ${t}`).toBeLessThanOrEqual(60);
      expect(largo(d), `descripción ${idioma}: ${d}`).toBeGreaterThanOrEqual(140);
      expect(largo(d), `descripción ${idioma}: ${d}`).toBeLessThanOrEqual(160);
      // Sin el separador punto medio y sin "Tinkazo" tres veces.
      expect(`${t} ${d}`).not.toContain("·");
      expect(`${t} ${d}`.match(/Tinkazo/g)?.length ?? 0).toBeLessThanOrEqual(2);
    }
    expect(titulo(html)).toBe(T.es[claves[0] as string]);
    expect(meta(html, "description")).toBe(T.es[claves[1] as string]);
  });

  it.each(PAGINAS)("%s: canonical a la dirección limpia, hreflang es, en y x-default, y og:locale", (archivo) => {
    const html = leer(archivo);
    const url = dire(archivo);
    expect(html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]).toBe(url);
    const alternativas = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(alternativas).toEqual([
      ["es", url],
      ["en", archivo === "index.html" ? `${BASE}/?lang=en` : `${url}?lang=en`],
      ["x-default", url],
    ]);
    expect(meta(html, "og:locale")).toBe("es_BO");
    expect(meta(html, "og:locale:alternate")).toBe("en_US");
    expect(meta(html, "og:site_name")).toBe("Tinkazo");
    expect(meta(html, "og:url")).toBe(url);
    expect(meta(html, "og:image")).toMatch(/^https:\/\/tinkazo\.app\/og\.jpg$/);
    expect(html).toMatch(/<html lang="es"/);
  });

  it.each(PAGINAS)("%s: un solo h1 y todas las imágenes con alt", (archivo) => {
    const html = leer(archivo);
    expect(html.match(/<h1\b/g)?.length ?? 0).toBe(1);
    const imagenes = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    for (const img of imagenes) expect(img, img.slice(0, 90)).toMatch(/\balt="/);
  });

  it.each(PAGINAS)("%s: los datos estructurados se parsean y dicen lo mismo que la página", (archivo) => {
    const html = leer(archivo);
    const grafo = nodos(html);
    expect(grafo.length).toBeGreaterThan(0);
    const pagina = grafo.find((n) => n["@type"] === "WebPage");
    expect(pagina).toMatchObject({ url: dire(archivo), name: titulo(html), description: meta(html, "description"), inLanguage: "es" });
    // Participar es gratis: nada de ofertas ni precios en los datos.
    expect(JSON.stringify(grafo)).not.toMatch(/"(offers|price|priceCurrency)"/);
    if (archivo !== "index.html") {
      const migas = grafo.find((n) => n["@type"] === "BreadcrumbList") as { itemListElement: Array<{ position: number; name: string; item: string }> };
      expect(migas.itemListElement.map((i) => [i.position, i.item])).toEqual([
        [1, `${BASE}/`],
        [2, dire(archivo)],
      ]);
    }
  });

  it("la portada dice su nombre: Tinkazo, con tinkazo.app como nombre alternativo", () => {
    const sitio = nodos(leer("index.html")).find((n) => n["@type"] === "WebSite");
    expect(sitio).toMatchObject({ name: "Tinkazo", alternateName: ["tinkazo.app"] });
    expect(meta(leer("index.html"), "og:site_name")).toBe("Tinkazo");
  });

  it("el título de la portada empieza con Tinkazo, y ningún título de otra página repite 'Tinkazo' por costumbre al principio y al final", () => {
    expect(titulo(leer("index.html")).startsWith("Tinkazo")).toBe(true);
    for (const t of titulos) expect(t.match(/Tinkazo/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("las preguntas frecuentes de los datos estructurados son las que se ven", () => {
  it.each(["ruleta-de-nombres.html", "sorteo-para-eventos.html"])("%s: cada pregunta y cada respuesta está escrita en la página", (archivo) => {
    const html = leer(archivo);
    const faq = nodos(html).find((n) => n["@type"] === "FAQPage") as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(3);
    const visible = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    for (const q of faq.mainEntity) {
      expect(visible, q.name).toContain(q.name);
      expect(visible, q.acceptedAnswer.text).toContain(q.acceptedAnswer.text);
    }
  });

  it("solo las dos páginas nuevas traen FAQPage: en las demás no hay preguntas y respuestas de verdad", () => {
    const con = PAGINAS.filter((a) => nodos(leer(a)).some((n) => n["@type"] === "FAQPage"));
    expect(con).toEqual(["ruleta-de-nombres.html", "sorteo-para-eventos.html"]);
  });
});

describe("las dos páginas de aterrizaje nuevas", () => {
  const palabras = (archivo: string, idioma: "es" | "en"): number => {
    const claves = [...leer(archivo).matchAll(/data-i="([^"]+)"/g)].map((m) => m[1] as string).filter((k) => /^(rul|sorEv)/.test(k) && !/(Kicker|ImgAlt|ImgCap|Guia|Demo)$/.test(k));
    return claves.map((k) => String(T[idioma][k])).join(" ").split(/\s+/).length;
  };

  it.each(["ruleta-de-nombres.html", "sorteo-para-eventos.html"])("%s: de 300 a 500 palabras de contenido, en es y en en", (archivo) => {
    for (const idioma of ["es", "en"] as const) {
      expect(palabras(archivo, idioma), idioma).toBeGreaterThanOrEqual(300);
      expect(palabras(archivo, idioma), idioma).toBeLessThanOrEqual(500);
    }
  });

  it.each(["ruleta-de-nombres.html", "sorteo-para-eventos.html"])("%s: usa una captura que existe en public/juegos y enlaza al inicio y a los juegos", (archivo) => {
    const html = leer(archivo);
    for (const src of [...html.matchAll(/(?:src|srcset)="(\/juegos\/[^"]+)"/g)].map((m) => m[1] as string)) {
      expect(() => readFileSync(new URL(`../public${src}`, import.meta.url)), src).not.toThrow();
    }
    expect(html).toContain('href="/#sortear"');
    expect(html).toContain('href="/juegos.html"');
    expect(html).toContain('href="/"');
  });
});

describe("los rastreadores reciben el español", () => {
  it.each(["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "Mozilla/5.0 Chrome/120 Safari/537.36 Chrome-Lighthouse"])(
    "%s",
    (ua) => {
      expect(esRastreador(ua)).toBe(true);
    },
  );

  it("un navegador de persona no es un rastreador", () => {
    expect(esRastreador("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")).toBe(false);
    expect(esRastreador("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});

describe("los íconos del navegador y de Google son la llama sola, sin fondo", () => {
  const publico = (r: string): Buffer => readFileSync(new URL(`../public/${r}`, import.meta.url));
  /** El tipo de color de un PNG (6 es RGBA, con transparencia), leído de su IHDR. */
  const tipoDeColor = (b: Buffer): number => b[25] ?? -1;

  it("icon-96.png y cada entrada de favicon.ico son PNG con transparencia", () => {
    expect(tipoDeColor(publico("icon-96.png"))).toBe(6);
    const ico = publico("favicon.ico");
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const desde = ico.readUInt32LE(18 + 16 * i);
      expect(tipoDeColor(ico.subarray(desde, desde + 33)), `entrada ${i}`).toBe(6);
    }
  });

  it("favicon.svg no tiene rectángulo de fondo y usa el rosa de la llama con el contorno de la marca", () => {
    const svg = publico("favicon.svg").toString("utf8");
    expect(svg).not.toMatch(/<rect width="512" height="512"/);
    expect(svg).toContain("#e93d9c");
    expect(svg).toContain("#171126");
  });

  it("los íconos de la app instalada siguen con el cuadrado oscuro, y no se declaran como rel=\"icon\"", () => {
    const portada = leer("index.html");
    expect([...portada.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1])).toEqual(["/favicon.ico", "/icon-96.png", "/favicon.svg"]);
    expect(tipoDeColor(publico("icon-192.png"))).toBe(6);
    expect(leer("public/manifest.webmanifest")).toContain("/icon-192.png");
  });
});
