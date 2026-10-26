import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";
import { metasDePagina } from "./idioma";

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
const INTERNAS = ["lista.html", "evento.html", "verificar.html", "c.html"];

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

/** Palabras que una cadena nueva de la portada no puede decir: la cifra vieja y las de apuesta. */
const PALABRAS_PROHIBIDAS = /doce|rifa|apuesta|loter[ií]a|casino|boleto|raffle/i;
/** Lo mismo en inglés: la cifra, la rifa, la lotería, la apuesta, el casino y el boleto. */
const PALABRAS_PROHIBIDAS_EN = /twelve|raffle|lotter|\bbet(s|ting)?\b|casino|\bticket/i;
const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const leerPublico = (ruta: string): Buffer => readFileSync(new URL(`../public/${ruta}`, import.meta.url));

/** Si la ruta, con barra inicial, es un archivo de public/. */
const esArchivoPublico = (ruta: string): boolean => {
  const url = new URL(`../public${ruta}`, import.meta.url);
  return ruta.startsWith("/") && existsSync(url) && statSync(url).isFile();
};

/** Ancho y alto de un PNG, leídos de su IHDR; null si no es un PNG. */
const dimensionesPng = (b: Buffer): { ancho: number; alto: number } | null =>
  b.subarray(0, 8).equals(PNG_FIRMA) && b.toString("ascii", 12, 16) === "IHDR"
    ? { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) }
    : null;

/** Ancho y alto de un JPEG, leídos del marcador SOF, recorriendo los segmentos desde el SOI. */
const dimensionesJpeg = (b: Buffer): { ancho: number; alto: number } | null => {
  if (b.readUInt16BE(0) !== 0xffd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marcador = b[i + 1] ?? 0;
    if (marcador === 0xff) {
      i += 1;
      continue;
    }
    if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
      return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
    }
    const sinLargo = marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7);
    i += sinLargo ? 2 : 2 + b.readUInt16BE(i + 2);
  }
  return null;
};

/** Las entradas de un ICO: ancho, alto, tamaño y desplazamiento, según su directorio de 16 bytes. */
const entradasIco = (b: Buffer): Array<{ ancho: number; alto: number; bytes: number; desde: number }> =>
  Array.from({ length: b.readUInt16LE(4) }, (_, i) => ({
    ancho: b[6 + 16 * i] || 256,
    alto: b[7 + 16 * i] || 256,
    bytes: b.readUInt32LE(14 + 16 * i),
    desde: b.readUInt32LE(18 + 16 * i),
  }));

/** Los `href` de los `<link rel="icon">` de una página, en el orden en que aparecen. */
const enlacesDeIcono = (pagina: string): string[] =>
  [...pagina.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((etiqueta) => /\brel=["']icon["']/.test(etiqueta))
    .map((etiqueta) => {
      const m = etiqueta.match(/\bhref=(?:"([^"]*)"|'([^']*)')/);
      return m?.[1] ?? m?.[2] ?? "";
    });

/** Todas las cadenas de un valor JSON, a cualquier profundidad. */
const cadenasDe = (v: unknown): string[] => {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(cadenasDe);
  if (v && typeof v === "object") return Object.values(v).flatMap(cadenasDe);
  return [];
};

describe("ícono y tarjeta de compartir de la portada", () => {
  const html = leer("index.html");
  const iconos = enlacesDeIcono(html);
  const grafo = (datosEstructurados(html)[0]?.["@graph"] ?? []) as Array<Record<string, unknown>>;
  const nodo = (tipo: string): Record<string, unknown> | undefined => grafo.find((n) => n["@type"] === tipo);

  it("ningún rel=\"icon\" de la portada apunta a un data: (Google no puede rastrearlo)", () => {
    expect(iconos.filter((href) => href.startsWith("data:"))).toEqual([]);
  });

  it("cada rel=\"icon\" apunta a un archivo de public/, en el orden ico, png y svg", () => {
    expect(iconos).toEqual(["/favicon.ico", "/icon-192.png", "/icon.svg"]);
    for (const ruta of iconos) {
      expect(esArchivoPublico(ruta), ruta).toBe(true);
    }
  });

  it("icon-192.png e icon-512.png son PNG de 192 y 512 px, según su IHDR", () => {
    expect(dimensionesPng(leerPublico("icon-192.png"))).toEqual({ ancho: 192, alto: 192 });
    expect(dimensionesPng(leerPublico("icon-512.png"))).toEqual({ ancho: 512, alto: 512 });
  });

  it("favicon.ico es un ICO con entradas de 16, 32 y 48 px, y cada una es un PNG del tamaño que dice", () => {
    const ico = leerPublico("favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const entradas = entradasIco(ico);
    expect(entradas.map((e) => [e.ancho, e.alto])).toEqual([
      [16, 16],
      [32, 32],
      [48, 48],
    ]);
    for (const e of entradas) {
      expect(e.desde + e.bytes).toBeLessThanOrEqual(ico.length);
      expect(dimensionesPng(ico.subarray(e.desde, e.desde + e.bytes))).toEqual({ ancho: e.ancho, alto: e.alto });
    }
  });

  it("og.jpg es un JPEG de 1200x630, según su marcador SOF", () => {
    expect(dimensionesJpeg(leerPublico("og.jpg"))).toEqual({ ancho: 1200, alto: 630 });
  });

  it("el título es el de la portada, tiene de 30 a 60 caracteres, empieza con Tinkazo, y og:title lo repite", () => {
    const titulo = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    expect(titulo).toBe("Tinkazo · sorteos verificables para eventos y clases");
    expect([...titulo].length).toBeGreaterThanOrEqual(30);
    expect([...titulo].length).toBeLessThanOrEqual(60);
    expect(titulo.startsWith("Tinkazo")).toBe(true);
    expect(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]).toBe(titulo);
  });

  it("la meta description tiene de 120 a 160 caracteres", () => {
    const largo = [...descripcion(html)].length;
    expect(largo).toBeGreaterThanOrEqual(120);
    expect(largo).toBeLessThanOrEqual(160);
  });

  it("ninguna cadena nueva de la portada dice doce, rifa, apuesta, lotería, casino, boleto ni raffle", () => {
    const nuevas = [html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "", descripcion(html), ogDescripcion(html), ...cadenasDe(grafo)];
    expect(nuevas.filter((c) => PALABRAS_PROHIBIDAS.test(c))).toEqual([]);
  });

  it("la organización usa el ícono de 512 px como logo, y WebSite y SoftwareApplication usan og.jpg como imagen", () => {
    expect(nodo("Organization")?.logo).toBe("https://tinkazo.app/icon-512.png");
    expect(nodo("WebSite")?.image).toBe("https://tinkazo.app/og.jpg");
    expect(nodo("SoftwareApplication")?.image).toBe("https://tinkazo.app/og.jpg");
    expect(esArchivoPublico("/icon-512.png")).toBe(true);
    expect(esArchivoPublico("/og.jpg")).toBe(true);
  });

  it("el JSON-LD no trae valoraciones ni reseñas: no hay ninguna todavía", () => {
    expect(JSON.stringify(grafo)).not.toMatch(/aggregateRating|"review"/);
  });

  // La portada no pide su título ni su descripción por clave. Si el <html> los pidiera, el idioma cambiaría también
  // la etiqueta <title> y la meta description: el buscador renderiza con JavaScript y podría leer el inglés, mientras
  // og:title y el JSON-LD quedan en español. Las claves titPortada y descPortada siguen en el diccionario, con su
  // versión en inglés, por si el autor decide otra cosa.
  const claveTitulo = "titPortada";
  const claveDesc = "descPortada";
  const textoEn = (clave: string): string => {
    const valor = T.en[clave];
    return typeof valor === "string" ? valor : "";
  };

  it("la etiqueta html de la portada no pide título ni descripción por clave: el buscador lee los de la etiqueta y la meta", () => {
    const etiquetaHtml = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    expect(etiquetaHtml).not.toMatch(/\sdata-(titulo|desc)-clave=/);
  });

  it("titPortada y descPortada existen en es y en en: en español son el título y la meta de la portada", () => {
    expect(T.es[claveTitulo]).toBe(html.match(/<title>([^<]*)<\/title>/)?.[1]);
    expect(T.es[claveDesc]).toBe(descripcion(html));
    expect(textoEn(claveTitulo).trim(), "título en inglés").not.toBe("");
    expect(textoEn(claveDesc).trim(), "descripción en inglés").not.toBe("");
  });

  it("el título en inglés tiene de 30 a 60 caracteres y empieza con Tinkazo, la descripción de 120 a 160, y ninguna dice palabras prohibidas", () => {
    const tituloEn = textoEn(claveTitulo);
    const descEn = textoEn(claveDesc);
    expect([...tituloEn].length).toBeGreaterThanOrEqual(30);
    expect([...tituloEn].length).toBeLessThanOrEqual(60);
    expect(tituloEn.startsWith("Tinkazo")).toBe(true);
    expect([...descEn].length).toBeGreaterThanOrEqual(120);
    expect([...descEn].length).toBeLessThanOrEqual(160);
    expect([tituloEn, descEn].filter((c) => PALABRAS_PROHIBIDAS.test(c) || PALABRAS_PROHIBIDAS_EN.test(c))).toEqual([]);
  });
});

describe("cada página pública", () => {
  it.each(Object.entries(PUBLICAS))("%s declara como canónica su propia URL", (archivo, url) => {
    expect(canonical(leer(archivo))).toBe(url);
  });

  it.each(INTERNAS)("%s lleva noindex", (archivo) => {
    expect(leer(archivo)).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });

  it.each(Object.keys(NUEVAS))("%s tiene el título y el h1 pedidos", (archivo) => {
    const html = leer(archivo);
    const esperado = NUEVAS[archivo];
    expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(esperado?.titulo);
    expect(html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(esperado?.h1);
  });

  it.each(Object.keys(PUBLICAS))("%s: la meta description tiene de 120 a 160 caracteres", (archivo) => {
    const largo = [...descripcion(leer(archivo))].length;
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

describe("título y descripción de las páginas nuevas, en el idioma de la página", () => {
  /** Las claves que el `<html>` de una página pide para su título y su descripción. */
  const clavesDePagina = (html: string): { titulo: string; desc: string } => {
    const etiqueta = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    return {
      titulo: etiqueta.match(/\sdata-titulo-clave="([^"]+)"/)?.[1] ?? "",
      desc: etiqueta.match(/\sdata-desc-clave="([^"]+)"/)?.[1] ?? "",
    };
  };

  it.each(Object.keys(NUEVAS))("%s pide su título y su descripción por clave, y las dos existen en es y en", (archivo) => {
    const { titulo, desc } = clavesDePagina(leer(archivo));
    expect(titulo, "data-titulo-clave").not.toBe("");
    expect(desc, "data-desc-clave").not.toBe("");
    for (const clave of [titulo, desc]) {
      expect(textoEs(clave), `${clave} en es`).not.toBe("");
      expect(sinVersionEn(clave), `${clave} en en`).toBe(false);
    }
  });

  it.each(Object.keys(NUEVAS))("%s: en español, esas claves dan el <title> y la meta description de la página", (archivo) => {
    const html = leer(archivo);
    const { titulo, desc } = clavesDePagina(html);
    expect(T.es[titulo]).toBe(NUEVAS[archivo]?.titulo);
    expect(T.es[desc]).toBe(descripcion(html));
  });
});

describe("og:title y og:description, en el idioma de la página", () => {
  /** Las claves de título y descripción que pide el `<html>` de una página. */
  const clavesOg = (html: string): { tituloClave: string; descClave: string } => {
    const etiqueta = html.match(/<html\b[^>]*>/)?.[0] ?? "";
    return {
      tituloClave: etiqueta.match(/\sdata-titulo-clave="([^"]+)"/)?.[1] ?? "",
      descClave: etiqueta.match(/\sdata-desc-clave="([^"]+)"/)?.[1] ?? "",
    };
  };
  const ogTitulo = (html: string): string => html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? "";

  it.each(Object.keys(NUEVAS))("%s: sin JavaScript, las etiquetas og están en español, como el título", (archivo) => {
    const html = leer(archivo);
    const { tituloClave, descClave } = clavesOg(html);
    expect(ogTitulo(html)).toBe(T.es[tituloClave]);
    expect(ogDescripcion(html)).toBe(T.es[descClave]);
  });

  it.each(Object.keys(NUEVAS))("%s: en inglés, las mismas claves dan el og:title y el og:description en inglés", (archivo) => {
    const { tituloClave, descClave } = clavesOg(leer(archivo));
    const en = metasDePagina(T.en, { tituloClave, descClave });
    expect(en.titulo, "og:title en en").toBeTruthy();
    expect(en.desc, "og:description en en").toBeTruthy();
    expect(en.titulo).not.toBe(T.es[tituloClave]);
    expect(en.desc).not.toBe(T.es[descClave]);
  });

  it("una página sin claves no cambia sus etiquetas", () => {
    expect(metasDePagina(T.en, {})).toEqual({});
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
/** Desde `desde` (justo después de la apertura de `tag`), dónde cierra ese mismo elemento: un span dentro de un span no corta el de afuera. */
const cierreDe = (html: string, tag: string, desde: number): number => {
  const marca = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
  marca.lastIndex = desde;
  let profundidad = 1;
  for (let m = marca.exec(html); m; m = marca.exec(html)) {
    profundidad += m[0].startsWith("</") ? -1 : 1;
    if (profundidad === 0) return m.index;
  }
  return -1;
};

const copiasDe = (html: string): Copia[] => {
  const copias: Copia[] = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sdata-i(-html)?="([^"]+)"[^>]*>/g)) {
    const desde = (m.index ?? 0) + m[0].length;
    const fin = cierreDe(html, m[1] ?? "", desde);
    if (fin < 0) continue;
    const contenido = html.slice(desde, fin);
    const clave = m[3] ?? "";
    copias.push(
      m[2]
        ? { clave, tipo: "html", valor: espacios(contenido) }
        : { clave, tipo: "texto", valor: espacios(sinEntidades(sinEtiquetas(contenido))) },
    );
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

describe("el enlace corto (tinkazo.app/c/<id>) se sirve, no se indexa y se revisa", () => {
  const vercel = JSON.parse(leer("vercel.json")) as {
    rewrites?: Array<{ source: string; destination: string }>;
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const c = leer("c.html");

  it("vercel.json reescribe /c/:id a c.html y le pone noindex", () => {
    expect(vercel.rewrites).toContainEqual({ source: "/c/:id", destination: "/c.html" });
    const h = vercel.headers?.find((x) => x.source === "/c/(.*)");
    expect(h?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex" });
  });

  it("c.html está en la compilación, con su reescritura en dev y preview, y en check-paginas", () => {
    const vite = leer("vite.config.ts");
    expect(vite).toMatch(/\bc:\s*resolve\(__dirname,\s*"c\.html"\)/);
    expect(vite).toMatch(/configurePreviewServer/);
    expect(leer("scripts/check-paginas.mjs")).toMatch(/\{\s*p:\s*"c",/);
  });

  it("la vista previa de WhatsApp es genérica: el título, la imagen del sitio y nada del sorteo", () => {
    expect(c.match(/<meta property="og:title" content="([^"]*)"/)?.[1]).toBe("Comprobante de un sorteo en Tinkazo");
    expect(c.match(/<meta property="og:image" content="([^"]*)"/)?.[1]).toBe(`${BASE}/og.jpg`);
    expect(esArchivoPublico("/og.jpg")).toBe(true);
    expect(T.es.cTitulo).toBe("Comprobante de un sorteo en Tinkazo");
    expect(T.en.cTitulo).not.toBe(T.es.cTitulo);
  });

  it("robots.txt no bloquea /c/: así los que arman la vista previa leen sus etiquetas", () => {
    const bloqueos = leer("public/robots.txt")
      .split(/\r?\n/)
      .filter((l) => /^disallow:/i.test(l.trim()))
      .map((l) => l.trim().replace(/^disallow:\s*/i, ""))
      .filter(Boolean);
    expect(bloqueos.some((b) => "/c/Ab3dE6gH".startsWith(b))).toBe(false);
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
const NO_SE_DICE = /sin confiar en|without trusting|sin confiar en tinkazo|no hace falta confiar en tinkazo|without trusting tinkazo|you don't have to trust tinkazo|no hace falta creer en tinkazo|you don't have to believe tinkazo|sin confiar en quien|no hace falta confiar en quien|no controla nadie|nadie controla|nobody controls|favoritos|favorites|a dedo|suerte|(?<!nadie )garantiz|imposible de trampear|premio en efectivo|premio en dinero/i;

/** Lo que solo se nombra para decir que Tinkazo no sirve para eso: rifas, apuestas, casino. */
const DE_APUESTA = /rifa|raffle|apuesta|lotería|loteria|casino/i;

/** La portada y los términos dicen en qué no sirve Tinkazo, así que ahí no se mira `DE_APUESTA`. */
const CON_AVISO = ["index.html", "terminos.html"];

/** Lo que una página dice: sus claves en los dos idiomas, el título y las descripciones. */
const textosDe = (archivo: string): string[] => {
  const html = leer(archivo);
  const claves = [
    ...html.matchAll(/data-i(?:-html|-ph|-title|-aria)?="([^"]+)"/g),
    ...html.matchAll(/data-(?:titulo|desc)-clave="([^"]+)"/g),
  ].map((m) => m[1] ?? "");
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
const LISTA_ES = "la huella de la lista, la cantidad de entradas, cuántos ganadores, la ronda, la hora del sello y su número de bloque, el premio o título que escribiste, la dirección de quien organiza y el número del sorteo; y, al sortear, la prueba que publicó la ronda, el número que decidió la ronda, la hora del sorteo, si ya se sorteó, su número de bloque y las posiciones de los ganadores.";
const LISTA_EN = "the list's fingerprint, the number of entries, how many winners, the round, the seal's time and block number, the prize or title you wrote, the organizer's address and the draw's number; and, when drawn, the proof the round published, the number the round decided, the draw's time, whether it has been drawn, its block number and the winners' positions.";

describe("la lista que sube a Stellar está completa en la documentación, en los dos idiomas", () => {
  it.each([
    ["docs/amenazas.md", LISTA_ES],
    ["docs/threat-model.en.md", LISTA_EN],
  ])("%s trae la lista completa", (archivo, lista) => {
    expect(leer(archivo)).toContain(lista);
  });
});

describe("frases fijas de la segunda ronda", () => {
  it("el veredicto parcial se dice veredicto amarillo (yellow verdict), y no de otra forma", () => {
    expect(T.es.sgLimit1).toContain("veredicto amarillo");
    expect(T.en.sgLimit1).toContain("yellow verdict");
    expect(T.es.verifN2).toContain("veredicto amarillo");
    expect(T.en.verifN2).toContain("yellow verdict");
    expect(T.es.verifN2).not.toMatch(/cuenta/i);
    expect(T.en.verifN2).not.toMatch(/account/i);
    const todos = [...Object.values(T.es), ...Object.values(T.en)].filter((v): v is string => typeof v === "string");
    expect(todos.filter((t) => /veredicto de advertencia|warning verdict/i.test(t))).toEqual([]);
  });

  it.each(["sgLimit2", "meetListaDet", "tmQ3B"])("%s dice la lista completa que sube a Stellar, en los dos idiomas", (clave) => {
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

describe("frases fijas de la tercera ronda", () => {
  it("uso2b en inglés dice lo mismo que en español", () => {
    expect(T.en.uso2b).toBe("Who presents first, who takes the book home. Without anyone saying the organizer picked it to their liking.");
  });
});

describe("la página de precios, revisada con mirada de marketing (26 de octubre de 2026)", () => {
  const textos = textosDe("precios.html");

  it("no cobra distinto fuera de Latinoamérica y no promete un SDK gratis", () => {
    expect(textos.filter((t) => /doble|double|SDK gratis|free SDK/i.test(t))).toEqual([]);
    expect(leer("precios.html")).not.toMatch(/doble|double/i);
  });

  it("abre diciendo que hoy es gratis y que los números son los precios previstos", () => {
    expect(T.es.prNote).toMatch(/^Hoy Tinkazo es gratis\. Estos son los precios previstos para cuando empecemos a cobrar/);
    expect(T.en.prNote).toMatch(/^Today Tinkazo is free\. These are the planned prices for when we start charging/);
  });

  it("los números de la tabla siguen siendo los aprobados", () => {
    expect(T.es.prP1b).toContain("20 sorteos por mes por cuenta (50 si la comunidad está verificada)");
    expect(T.en.prP1b).toContain("20 draws a month per account (50 if the community is verified)");
    expect(T.es.prP2b).toBe("10 sorteos por Bs 20; 50 por Bs 90");
    expect(T.es.prP2l).toBe("10 sorteos por US$ 2; 50 por US$ 9");
    expect(T.en.prP2b).toBe("10 draws for Bs 20; 50 for Bs 90");
    expect(T.en.prP2l).toBe("10 draws for US$ 2; 50 for US$ 9");
    expect(T.es.prP3b).toBe("Bs 100 hasta 100 personas; Bs 200 hasta 500; Bs 400 hasta 5.000; Bs 1.500 con más");
    expect(T.es.prP5b).toBe("Bs 1.200 al año");
  });

  it("no pone el costo de la red en una cifra que cambia sola", () => {
    expect(`${T.es.nextBody} ${T.en.nextBody}`).not.toMatch(/0,76|0\.76|XLM por sorteo|XLM per draw/);
  });
});

describe("«Qué queda de tu sorteo y por cuánto tiempo», en Cómo funciona", () => {
  const html = leer("como-funciona.html");
  const claves = ["cfDuraT", "cfDuraB1", "cfDura1", "cfDura2", "cfDura3", "cfDuraPromesa"];
  const dichoEn = (idioma: "es" | "en"): string => claves.map((c) => String(T[idioma][c])).join(" ");

  it("está en la página, con su ancla, y cada clave existe en los dos idiomas", () => {
    expect(html).toContain('id="que-queda"');
    for (const clave of claves) {
      expect(html, clave).toMatch(new RegExp(`data-i(-html)?="${clave}"`));
      expect(textoEs(clave), `${clave} en es`).not.toBe("");
      expect(sinVersionEn(clave), `${clave} en en`).toBe(false);
    }
  });

  it("la frase de la promesa es la aprobada, textual, en los dos idiomas", () => {
    expect(T.es.cfDuraPromesa).toBe("Este comprobante lleva lo necesario para volver a comprobar el sorteo con herramientas abiertas. La hora del sello la confirman los archivos públicos de Stellar mientras existan: nadie garantiza ese plazo, tampoco nosotros. Guardalo.");
    expect(T.en.cfDuraPromesa).toBe("This proof carries what is needed to re-check the draw with open tools. The seal time is confirmed by Stellar's public archives for as long as they exist: nobody guarantees that term, and neither do we. Keep it.");
  });

  it("dice que la red de prueba se borra el 16 de diciembre de 2026 y cuánto dura la memoria del contrato", () => {
    expect(dichoEn("es")).toContain("16 de diciembre de 2026");
    expect(dichoEn("en")).toContain("December 16, 2026");
    for (const idioma of ["es", "en"] as const) {
      expect(dichoEn(idioma)).toMatch(/\b7 (días|days)\b/);
      expect(dichoEn(idioma)).toMatch(/\b120\b/);
    }
  });

  it("no promete que dure para siempre ni que no se pueda alterar", () => {
    expect(`${dichoEn("es")} ${dichoEn("en")}`).not.toMatch(/para siempre|inalterable|inmutable|forever|unalterable|immutable|tamper-proof/i);
  });

  it("«garantiz» solo pasa en «nadie garantiza»: una garantía afirmada sigue prohibida", () => {
    expect(NO_SE_DICE.test("Este plazo está garantizado")).toBe(true);
    expect(NO_SE_DICE.test("Garantizamos el resultado")).toBe(true);
    expect(NO_SE_DICE.test("nadie garantiza ese plazo, tampoco nosotros")).toBe(false);
  });

  it("la página de precios lleva a la sección", () => {
    expect(leer("precios.html")).toContain('href="/como-funciona.html#que-queda"');
  });
});

/** La raíz del repo: desde acá salen las carpetas que revisa la prueba de la revisión visual. */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/** Las menciones de la revisión con nombre propio: la palabra entera, sin marcar las palabras que solo la contienen. */
const REVISION_CON_NOMBRE = /\bagente\b/i;

/** Los archivos de una carpeta del repo, en todos sus niveles, como rutas desde la raíz. */
const archivosDe = (carpeta: string): string[] =>
  readdirSync(join(RAIZ, carpeta), { encoding: "utf8", recursive: true })
    .map((ruta) => join(carpeta, ruta))
    .filter((ruta) => statSync(join(RAIZ, ruta)).isFile());

describe("la revisión visual va sin nombre propio en el repo público", () => {
  const archivos = [
    ...archivosDe("src"),
    ...archivosDe("scripts"),
    ...archivosDe("docs"),
    ...readdirSync(RAIZ).filter((nombre) => nombre.endsWith(".html")),
  ];

  it("ni en src/, scripts/ o docs/, ni en los HTML de la raíz", () => {
    const con = archivos.filter((ruta) => REVISION_CON_NOMBRE.test(readFileSync(join(RAIZ, ruta), "utf8")));
    expect(con).toEqual([]);
  });
});

describe("el sorteo no se llama faro de azar", () => {
  it("ni los términos ni el mensaje al ganador lo dicen, en ninguno de sus casos", () => {
    expect(leer("terminos.html")).not.toMatch(/faro de azar/i);
    for (const idioma of ["es", "en"] as const) {
      for (const varios of [false, true]) {
        expect(T[idioma].tellBody("Ana", "", 8, "https://tinkazo.app/x", varios)).not.toMatch(/faro de azar/i);
      }
    }
  });
});
