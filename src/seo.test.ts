import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Lo que los buscadores leen del sitio: etiquetas canónicas, idiomas, datos
 * estructurados, mapa del sitio y robots.txt. Se lee del disco, así que corre
 * sin navegador, igual que las demás pruebas del repo.
 */

const BASE = "https://tinkazo.app";
const leer = (ruta: string): string => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

/** Las páginas que se indexan, con la URL que cada una declara como canónica. */
const PUBLICAS: Record<string, string> = {
  "index.html": `${BASE}/`,
  "juegos.html": `${BASE}/juegos.html`,
  "historia.html": `${BASE}/historia.html`,
  "como-funciona.html": `${BASE}/como-funciona.html`,
  "seguridad.html": `${BASE}/seguridad.html`,
  "precios.html": `${BASE}/precios.html`,
  "terminos.html": `${BASE}/terminos.html`,
  "sorteo-para-meetup.html": `${BASE}/sorteo-para-meetup.html`,
  "sorteo-en-clase.html": `${BASE}/sorteo-en-clase.html`,
  "sorteo-verificable.html": `${BASE}/sorteo-verificable.html`,
};

/** Las de uso interno: no van al mapa del sitio y llevan noindex. */
const INTERNAS = ["lista.html", "evento.html", "verificar.html"];

/** Las páginas nuevas, con el título y el h1 que se pidieron para cada una. */
const NUEVAS: Record<string, { titulo: string; h1: string }> = {
  "sorteo-para-meetup.html": {
    titulo: "Sorteo para meetup: en pantalla grande y comprobable",
    h1: "Sorteo para tu meetup, en pantalla grande",
  },
  "sorteo-en-clase.html": {
    titulo: "Sorteo en clase: elegí quién pasa, de forma justa",
    h1: "Sorteo en clase, justo y comprobable",
  },
  "sorteo-verificable.html": {
    titulo: "Sorteo verificable: cómo comprobar el resultado",
    h1: "Sorteo verificable: no hace falta confiar en Tinkazo para rehacerlo",
  },
};

const canonical = (html: string): string | null => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
const descripcion = (html: string): string => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";

/** Todos los bloques `application/ld+json` de una página, ya parseados. */
const datosEstructurados = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? "{}") as Record<string, unknown>,
  );

describe("portada: canonical, idiomas y datos estructurados", () => {
  const html = leer("index.html");

  it("tiene canonical a la portada", () => {
    expect(canonical(html)).toBe(`${BASE}/`);
  });

  it("declara es, en y x-default con sus URL", () => {
    const alternos = Object.fromEntries(
      [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
    );
    expect(alternos).toEqual({ es: `${BASE}/`, en: `${BASE}/?lang=en`, "x-default": `${BASE}/` });
  });

  it("el bloque ld+json se parsea y trae WebSite, Organization y SoftwareApplication", () => {
    const bloques = datosEstructurados(html);
    expect(bloques).toHaveLength(1);
    const grafo = (bloques[0]?.["@graph"] ?? []) as Array<Record<string, unknown>>;
    expect(grafo.map((n) => n["@type"])).toEqual(expect.arrayContaining(["WebSite", "Organization", "SoftwareApplication"]));
    expect(grafo.find((n) => n["@type"] === "Organization")).toMatchObject({
      name: "Tinkazo",
      url: `${BASE}/`,
      sameAs: ["https://github.com/nema1502/tinkazo"],
    });
    expect(grafo.find((n) => n["@type"] === "SoftwareApplication")).toMatchObject({
      name: "Tinkazo",
      url: `${BASE}/`,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web",
      inLanguage: ["es", "en"],
      isAccessibleForFree: true,
    });
  });

  it("la descripción del programa es la misma que la meta description, y no hay precios", () => {
    const grafo = (datosEstructurados(html)[0]?.["@graph"] ?? []) as Array<Record<string, unknown>>;
    const app = grafo.find((n) => n["@type"] === "SoftwareApplication");
    expect(app?.description).toBe(descripcion(html));
    expect(JSON.stringify(grafo)).not.toMatch(/"(offers|price|priceCurrency)"/);
  });
});

describe("cada página pública", () => {
  it.each(Object.entries(PUBLICAS))("%s declara como canónica su propia URL", (archivo, url) => {
    expect(canonical(leer(archivo))).toBe(url);
  });

  it.each(INTERNAS)("%s lleva noindex", (archivo) => {
    expect(leer(archivo)).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });

  it.each(Object.keys(NUEVAS))("%s tiene el título y el h1 pedidos, y una descripción de 120 a 160 caracteres", (archivo) => {
    const html = leer(archivo);
    const esperado = NUEVAS[archivo];
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(esperado?.titulo);
    expect(html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(esperado?.h1);
    const largo = [...descripcion(html)].length;
    expect(largo).toBeGreaterThanOrEqual(120);
    expect(largo).toBeLessThanOrEqual(160);
  });

  it.each(Object.keys(NUEVAS))("%s lleva un WebPage con name, description, url e inLanguage es", (archivo) => {
    const pagina = datosEstructurados(leer(archivo)).find((b) => b["@type"] === "WebPage");
    expect(pagina).toMatchObject({
      "@type": "WebPage",
      name: NUEVAS[archivo]?.titulo,
      description: descripcion(leer(archivo)),
      url: PUBLICAS[archivo],
      inLanguage: "es",
    });
  });

  it.each(Object.keys(NUEVAS))("%s no usa palabras que el texto nuevo no puede decir", (archivo) => {
    const html = leer(archivo);
    const claves = [...html.matchAll(/data-i(?:-html)?="([^"]+)"/g)].map((m) => m[1] ?? "");
    const textos = [
      ...claves.flatMap((k) => [T.es[k], T.en[k]]),
      NUEVAS[archivo]?.titulo,
      descripcion(html),
    ].filter((v): v is string => typeof v === "string");
    const prohibidas = /rifa|raffle|apuesta|lotería|loteria|casino|premio en efectivo|premio en dinero|garantiz|imposible de trampear/i;
    expect(textos.filter((t) => prohibidas.test(t))).toEqual([]);
  });
});

describe("mapa del sitio y robots.txt", () => {
  const mapa = leer("public/sitemap.xml");
  const urls = [...mapa.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");

  it("lista todas las páginas públicas, y solo esas", () => {
    expect([...urls].sort()).toEqual(Object.values(PUBLICAS).sort());
  });

  it("no lista ninguna página de uso interno", () => {
    for (const archivo of INTERNAS) {
      expect(urls.some((u) => u.endsWith(`/${archivo}`))).toBe(false);
    }
  });

  it("cada entrada tiene fecha de última modificación", () => {
    const entradas = [...mapa.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1] ?? "");
    expect(entradas).toHaveLength(Object.keys(PUBLICAS).length);
    for (const entrada of entradas) {
      expect(entrada).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    }
  });

  const lineas = leer("public/robots.txt")
    .split(/\r?\n/)
    .map((l) => l.trim());
  const bloqueos = lineas
    .filter((l) => /^disallow:/i.test(l))
    .map((l) => l.replace(/^disallow:\s*/i, ""))
    .filter((p) => p.length > 0);

  it("robots.txt no bloquea ninguna página pública", () => {
    const rutas = Object.keys(PUBLICAS).map((a) => (a === "index.html" ? "/" : `/${a}`));
    for (const ruta of rutas) {
      for (const bloqueo of bloqueos) {
        expect(ruta.startsWith(bloqueo), `${ruta} quedó bloqueada por ${bloqueo}`).toBe(false);
      }
    }
  });

  it("robots.txt deja rastrear verificar.html, para que Google lea su noindex", () => {
    expect(bloqueos.some((b) => "/verificar.html".startsWith(b))).toBe(false);
  });

  it("robots.txt declara el mapa del sitio", () => {
    expect(lineas).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });
});

describe("las páginas nuevas están en la compilación y en la revisión", () => {
  const vite = leer("vite.config.ts");
  const revision = leer("scripts/check-paginas.mjs");

  it.each(Object.keys(NUEVAS))("%s está en las entradas de vite.config.ts", (archivo) => {
    const nombre = archivo.replace(/\.html$/, "");
    const entrada = new RegExp(`"${nombre}":\\s*resolve\\(__dirname,\\s*"${archivo.replace(/\./g, "\\.")}"\\)`);
    expect(vite).toMatch(entrada);
  });

  it.each(Object.keys(NUEVAS))("%s está en PAGINAS de scripts/check-paginas.mjs", (archivo) => {
    const lista = revision.match(/const PAGINAS = \[([^\]]*)\]/)?.[1] ?? "";
    const nombres = lista.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    expect(nombres).toContain(archivo.replace(/\.html$/, ""));
  });
});

describe("enlaces a las páginas nuevas", () => {
  const conPie = [
    "index.html",
    "juegos.html",
    "historia.html",
    "como-funciona.html",
    "seguridad.html",
    "precios.html",
    "terminos.html",
    ...Object.keys(NUEVAS),
  ];

  it.each(conPie)("%s enlaza a las tres páginas nuevas desde el pie", (archivo) => {
    const pie = leer(archivo).match(/<nav class="pies"[\s\S]*?<\/nav>/)?.[0] ?? "";
    for (const nueva of Object.keys(NUEVAS)) {
      expect(pie).toContain(`href="/${nueva}"`);
    }
  });

  it("la portada las enlaza desde Para saber más", () => {
    const html = leer("index.html");
    const inicio = html.indexOf('data-i="masTitle"');
    const seccion = html.slice(inicio, html.indexOf("</section>", inicio));
    for (const nueva of Object.keys(NUEVAS)) {
      expect(seccion).toContain(`href="/${nueva}"`);
    }
  });
});
