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
    h1: "Sorteo verificable: cualquiera puede rehacer el resultado",
  },
};

const canonical = (html: string): string | null => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
const descripcion = (html: string): string => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
const ogDescripcion = (html: string): string => html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? "";

/** Todos los bloques `application/ld+json` de una página, ya parseados. */
const datosEstructurados = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1] ?? "{}") as Record<string, unknown>,
  );

describe("portada: canonical, sin hreflang y datos estructurados", () => {
  const html = leer("index.html");

  it("tiene canonical a la portada", () => {
    expect(canonical(html)).toBe(`${BASE}/`);
  });

  it("no declara hreflang: la portada se indexa en una sola URL, la canónica", () => {
    expect(html).not.toMatch(/hreflang/);
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

  it("og:description es la misma que la meta description, y las dos caben en 160 caracteres", () => {
    expect(ogDescripcion(html)).toBe(descripcion(html));
    expect([...descripcion(html)].length).toBeLessThanOrEqual(160);
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

  it.each(Object.keys(NUEVAS))("%s: og:description igual a la meta, y de 160 caracteres o menos", (archivo) => {
    const html = leer(archivo);
    expect(ogDescripcion(html)).toBe(descripcion(html));
    expect([...descripcion(html)].length).toBeLessThanOrEqual(160);
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
});

/** Cada elemento con `data-i`: su clave y el texto que trae escrito, sin etiquetas ni espacios de más. */
const elementosConClave = (html: string): Array<{ clave: string; texto: string }> =>
  [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sdata-i="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => ({
    clave: m[2] ?? "",
    texto: (m[3] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim(),
  }));

/** El texto de `T.es` para una clave, con los espacios como en el HTML. */
const textoEs = (clave: string): string => {
  const valor = T.es[clave];
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";
};

/** Sin versión en inglés: la clave no existe en `T.en` o viene vacía. */
const sinVersionEn = (clave: string): boolean => {
  const valor = T.en[clave];
  return typeof valor !== "string" || valor.trim() === "";
};

describe("el texto escrito en las páginas nuevas y en las tarjetas es el del diccionario", () => {
  it.each(Object.keys(NUEVAS))("%s repite en español el texto de T.es, y cada clave tiene su versión en inglés", (archivo) => {
    const elementos = elementosConClave(leer(archivo));
    expect(elementos.length).toBeGreaterThan(0);
    expect(elementos.filter((e) => e.texto !== textoEs(e.clave)).map((e) => `${e.clave}: ${e.texto}`)).toEqual([]);
    expect(elementos.filter((e) => sinVersionEn(e.clave)).map((e) => e.clave)).toEqual([]);
  });

  it("las tarjetas de meetup, clase y verificable de la portada repiten el texto de T.es", () => {
    const tarjetas = elementosConClave(leer("index.html")).filter((e) => /^mas(Meetup|Clase|Verif)[TB]$/.test(e.clave));
    expect(tarjetas.map((e) => e.clave).sort()).toEqual(["masClaseB", "masClaseT", "masMeetupB", "masMeetupT", "masVerifB", "masVerifT"]);
    expect(tarjetas.filter((e) => e.texto !== textoEs(e.clave)).map((e) => `${e.clave}: ${e.texto}`)).toEqual([]);
    expect(tarjetas.filter((e) => sinVersionEn(e.clave)).map((e) => e.clave)).toEqual([]);
  });
});

/** Lo que el HTML trae escrito en un elemento: el texto de `data-i`, el HTML de `data-i-html` o un atributo `data-i-*`. */
const sinEtiquetas = (s: string): string => s.replace(/<[^>]+>/g, "");
const sinEntidades = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const espacios = (s: string): string => s.replace(/\s+/g, " ").trim();

type Copia = { clave: string; tipo: "texto" | "html" | "placeholder" | "title" | "aria-label"; valor: string };

/** Todas las copias estáticas de una página: cada `data-i`, `data-i-html` y atributo `data-i-ph`, `-title` o `-aria`. */
const copiasDe = (html: string): Copia[] => {
  const copias: Copia[] = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sdata-i="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    copias.push({ clave: m[2] ?? "", tipo: "texto", valor: espacios(sinEntidades(sinEtiquetas(m[3] ?? ""))) });
  }
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sdata-i-html="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    copias.push({ clave: m[2] ?? "", tipo: "html", valor: espacios(m[3] ?? "") });
  }
  const atributos = [
    ["data-i-ph", "placeholder"],
    ["data-i-title", "title"],
    ["data-i-aria", "aria-label"],
  ] as const;
  for (const [dataAttr, atributo] of atributos) {
    for (const m of html.matchAll(new RegExp(`<[a-z][a-z0-9]*\\b[^>]*?\\s${dataAttr}="([^"]+)"[^>]*>`, "g"))) {
      const valor = m[0].match(new RegExp(`\\s${atributo}="([^"]*)"`))?.[1] ?? "";
      copias.push({ clave: m[1] ?? "", tipo: atributo, valor: sinEntidades(valor) });
    }
  }
  return copias;
};

/** Cuántos atributos `data-i*` tiene el HTML: la extracción de `copiasDe` tiene que encontrarlos todos. */
const atributosDataI = (html: string): number => (html.match(/\sdata-i(?:-html|-ph|-title|-aria)?="/g) ?? []).length;

/** Cuánto se aparta una copia de lo que dice T.es; null si coincide. Los textos se comparan con los espacios normalizados; los atributos, tal cual. */
const diferencia = (c: Copia): string | null => {
  const es = T.es[c.clave];
  if (typeof es !== "string") return `${c.clave}: sin texto en T.es`;
  const igual = c.tipo === "texto" || c.tipo === "html" ? c.valor === espacios(es) : c.valor === es;
  return igual ? null : `${c.clave} (${c.tipo}): el HTML dice «${c.valor}» y T.es dice «${es}»`;
};

describe("el texto de cada elemento de cada página es el de T.es, y cada clave tiene su versión en inglés", () => {
  it.each([...Object.keys(PUBLICAS), ...INTERNAS])("%s", (archivo) => {
    const html = leer(archivo);
    const copias = copiasDe(html);
    expect(copias.length).toBe(atributosDataI(html));
    expect(copias.map(diferencia).filter((d): d is string => d !== null)).toEqual([]);
    expect(copias.filter((c) => sinVersionEn(c.clave)).map((c) => c.clave)).toEqual([]);
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

/** Lo que no dice la portada ni ninguna página de lectura, en español y en inglés. */
const NO_SE_DICE = /sin confiar en tinkazo|no hace falta confiar en tinkazo|without trusting tinkazo|you don't have to trust tinkazo|sin confiar en quien|no hace falta confiar en quien|no controla nadie|nadie controla|nobody controls|favoritos|favorites|a dedo|suerte|garantiz|imposible de trampear|premio en efectivo|premio en dinero/i;

/** Lo que solo se nombra para decir que Tinkazo no sirve para eso: rifas, apuestas, casino. */
const DE_APUESTA = /rifa|raffle|apuesta|lotería|loteria|casino/i;

/** La portada y los términos dicen en qué no sirve Tinkazo, así que ahí no se mira `DE_APUESTA`. */
const CON_AVISO = ["index.html", "terminos.html"];

/** Lo que una página dice: sus claves en los dos idiomas, el título y las descripciones. */
const textosDe = (archivo: string): string[] => {
  const html = leer(archivo);
  const claves = [...html.matchAll(/data-i(?:-html|-ph|-title|-aria)?="([^"]+)"/g)].map((m) => m[1] ?? "");
  const declarados = [
    html.match(/<title>([^<]*)<\/title>/)?.[1],
    descripcion(html),
    ogDescripcion(html),
    ...[...html.matchAll(/"description":\s*"([^"]*)"/g)].map((m) => m[1]),
  ];
  return [...claves.flatMap((k) => [T.es[k], T.en[k]]), ...declarados].filter((v): v is string => typeof v === "string");
};

describe("la portada y las páginas de lectura no dicen lo que el sitio no puede sostener", () => {
  it.each(Object.keys(PUBLICAS))("%s", (archivo) => {
    const prohibidas = CON_AVISO.includes(archivo) ? NO_SE_DICE : new RegExp(`${NO_SE_DICE.source}|${DE_APUESTA.source}`, "i");
    expect(textosDe(archivo).filter((t) => prohibidas.test(t))).toEqual([]);
  });
});

/** La lista que sube a Stellar, completa: la misma frase en la interfaz, en las páginas y en la documentación. */
const LISTA_ES = "la huella de la lista, la cantidad de entradas, cuántos ganadores, la ronda, la hora del sello, el premio o título que escribiste, la dirección de quien organiza y el número del sorteo; y, al sortear, el número que decidió la ronda, la hora del sorteo y las posiciones de los ganadores.";
const LISTA_EN = "the list's fingerprint, the number of entries, how many winners, the round, the time of the seal, the prize or title you wrote, the organizer's address and the draw's number; and, when drawing, the number that decided the round, the time of the draw and the winners' positions.";

describe("frases fijas de la segunda ronda", () => {
  it("el veredicto parcial se dice veredicto amarillo (yellow verdict), y no de otra forma", () => {
    expect(T.es.sgLimit1).toContain("veredicto amarillo");
    expect(T.en.sgLimit1).toContain("yellow verdict");
    expect(T.es.verifN2).toContain("veredicto amarillo");
    expect(T.en.verifN2).toContain("yellow verdict");
    const todos = [...Object.values(T.es), ...Object.values(T.en)].filter((v): v is string => typeof v === "string");
    expect(todos.filter((t) => /veredicto de advertencia|warning verdict/i.test(t))).toEqual([]);
  });

  it.each(["sgLimit2", "meetNamesB", "tmQ3B"])("%s dice la lista completa que sube a Stellar, en los dos idiomas", (clave) => {
    expect(T.es[clave]).toContain(LISTA_ES);
    expect(T.en[clave]).toContain(LISTA_EN);
  });

  it.each(["seguridad.html", "sorteo-para-meetup.html", "terminos.html"])("%s repite la lista completa que sube a Stellar", (archivo) => {
    expect(leer(archivo)).toContain(LISTA_ES);
  });

  it("la h1 de la verificación es la pedida, en los dos idiomas, y la página la muestra", () => {
    expect(T.es.verifH1).toBe("Sorteo verificable: cualquiera puede rehacer el resultado");
    expect(T.en.verifH1).toBe("Verifiable draw: anyone can redo the result");
    expect(leer("sorteo-verificable.html")).toMatch(/<h1[^>]*data-i="verifH1">Sorteo verificable: cualquiera puede rehacer el resultado<\/h1>/);
  });
});
