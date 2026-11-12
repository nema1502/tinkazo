import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { T } from "./i18n";
import config from "../vite.config";

// La integración usa el hook público de Vite, como dev y build.
async function textosInyectados(pagina: string): Promise<Record<string, Record<string, string>> | null> {
  const plugins = config.plugins as Array<{ name: string; transformIndexHtml?: { handler: Function } }>;
  const plugin = plugins.find(p => p.name === "tinkazo:textos-por-pagina")!;
  const archivo = new URL(`../${pagina}`, import.meta.url);
  const resultado = await plugin.transformIndexHtml!.handler.call({ warn: (s: string) => { throw new Error(s); } }, leer(pagina), { filename: fileURLToPath(archivo), path: `/${pagina}` });
  return resultado ? JSON.parse(resultado[0].children) : null;
}
const leer = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
describe("recursos públicos de marca", () => {
  it("ofrece la página, entradas y descargas del mismo origen", () => {
    expect(existsSync(new URL("../marca.html", import.meta.url))).toBe(true);
    const html = leer("marca.html");
    for (const recurso of ["llama.svg", "llama.png", "llama-oscuro.svg", "llama-oscuro.png", "sello-es.svg", "sello-en.svg"]) {
      expect(existsSync(new URL(`../public/marca/${recurso}`, import.meta.url))).toBe(true);
    }
    expect(html).toContain('download="tinkazo-llama.svg"');
    expect(html).toContain('download="tinkazo-llama.png"');
    expect(html).toContain('download="tinkazo-llama-oscuro.svg"');
    expect(html).toContain('download="tinkazo-llama-oscuro.png"');
    expect(html).toContain('/src/marca.ts');
    expect(leer("src/marca.ts")).toContain('import "./pagina"');
    expect(leer("vite.config.ts")).toContain('marca: resolve(__dirname, "marca.html")');
    expect(leer("public/sitemap.xml")).toContain('https://tinkazo.app/marca.html');
    expect(leer("index.html")).toContain('href="/marca.html"');
  });
  it("todo pie común lleva a Marca, también el de verificar y los de los enlaces", () => {
    const raiz = fileURLToPath(new URL("../", import.meta.url));
    const conPie = readdirSync(raiz).filter(p => p.endsWith(".html")).filter(p => {
      const pie = leer(p).split("<footer")[1] ?? "";
      return pie.includes('href="/historia.html"');
    });
    expect(conPie).toContain("verificar.html");
    for (const pagina of conPie) {
      const pie = leer(pagina).split("<footer")[1]!;
      expect(pie, `${pagina} no lleva a Marca en el pie`).toMatch(/<a href="\/marca\.html"[^>]*data-i="navMarca">/);
    }
  });
  it("cada texto y atributo traducible existe en ambos idiomas y el español coincide", () => {
    const html = leer("marca.html");
    for (const m of html.matchAll(/data-i="([^"]+)"[^>]*>([^<]*)</g)) {
      expect(T.es[m[1]!], m[1]).toBe(m[2]);
      expect(typeof T.en[m[1]!], m[1]).toBe("string");
    }
    for (const m of html.matchAll(/data-(?:i-aria|titulo-clave|desc-clave)="([^"]+)"/g)) {
      for (const lang of ["es", "en"] as const) expect(typeof T[lang][m[1]!]).toBe("string");
    }
    expect(T.es.maLimite).toContain("comprobante verificable");
    expect(T.en.maLimite).toContain("verifiable receipt");
  });
  it("Vite inyecta los textos dinámicos de marca sin cargar el diccionario entero", async () => {
    const textos = await textosInyectados("marca.html");
    for (const lang of ["es", "en"] as const) {
      for (const clave of ["maCopiado", "maError", "maFondo", "maMorado", "maH1", "navComoUsa"]) {
        expect(textos?.[lang]?.[clave]).toBe(T[lang][clave]);
      }
      // Con los stickers, los impresos y el kit de sponsors la página usa varios cientos de claves: sigue lejos del diccionario entero.
      expect(Object.keys(textos![lang]!).length).toBeLessThan(440);
      expect(Object.keys(textos![lang]!).length).toBeLessThan(Object.keys(T[lang]).length / 3);
    }
  });
  it("PRESERVE: Historia conserva su diccionario reducido y la herramienta no recibe uno duplicado", async () => {
    const textos = await textosInyectados("historia.html");
    expect(textos?.en?.hiTitle).toBe(T.en.hiTitle);
    expect(textos?.es?.hiTitle).toBe(T.es.hiTitle);
    expect(textos?.es?.maH1).toBeUndefined();
    expect(await textosInyectados("index.html")).toBeNull();
  });
  it("la llama para fondo oscuro es la misma silueta, en el magenta del tema oscuro", () => {
    const clara = leer("public/marca/llama.svg");
    const oscura = leer("public/marca/llama-oscuro.svg");
    expect(oscura.replace(/\r/g, "")).toBe(clara.replace(/\r/g, "").replace("#e93d9c", "#ff5cb3"));
    const b = readFileSync(new URL("../public/marca/llama-oscuro.png", import.meta.url));
    expect([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]]).toEqual([2048, 2048, 8, 6]);
  });
  it("trae el bloque corto de cómo se escribe Tinkazo, con lo que sí y lo que no, en los dos idiomas", () => {
    const html = leer("marca.html");
    expect(html).toContain('data-i="maEscribeT"');
    for (let i = 1; i <= 5; i++) {
      expect(html).toContain(`data-i="maSi${i}"`);
      expect(html).toContain(`data-i="maNo${i}"`);
      for (const lang of ["es", "en"] as const) {
        expect(typeof T[lang][`maSi${i}`]).toBe("string");
        expect(typeof T[lang][`maNo${i}`]).toBe("string");
      }
    }
    expect(T.es.maSi1).toContain("T mayúscula");
    expect(T.es.maNo2).toContain("sorteo");
  });
  it("lo que no también enseña las dos reglas de docs/marca.md: sin comillas angulares y sin punto y coma", () => {
    const html = leer("marca.html");
    const guia = leer("docs/marca.md");
    const plano = (s: string): string => s.replace(/<[^>]+>/g, "");
    // maNo6 lleva negrita y cursiva: el ejemplo enseña cómo se nombra un botón. La copia del HTML es la del diccionario.
    for (const [clave, atributo] of [["maNo6", "data-i-html"], ["maNo7", "data-i"]] as const) {
      expect(html).toContain(`<li ${atributo}="${clave}">${T.es[clave]}</li>`);
      for (const lang of ["es", "en"] as const) {
        expect(plano(String(T[lang][clave])), `${lang} ${clave}`).not.toMatch(/[\u00ab\u00bb;]/);
        expect(String(T[lang][clave]), `${lang} ${clave}`).not.toMatch(/["\u201c\u201d]/);
      }
    }
    expect(T.es.maNo6).toMatch(/^Comillas angulares, las de apertura y las de cierre, en español y en inglés\. /);
    expect(T.es.maNo6).toContain("<strong>Sellar la lista</strong>");
    expect(T.en.maNo6).toContain("<strong>Seal the list</strong>");
    // La regla del punto y coma se dice con las mismas palabras que la guía de marca.
    expect(guia).toContain(`- ${T.es.maNo7}`);
    expect(T.en.maNo7).toMatch(/^Semicolons/);
  });
  it("en inglés, la capa de corte se nombra como se llama en el archivo", () => {
    // En los SVG y en los PDF la capa se llama corte: una capa llamada cut no existe y la imprenta no la encuentra.
    for (const clave of ["maStB", "maHojB", "maColNota", "maColHojB"]) {
      expect(T.en[clave], clave).toContain("named corte");
      expect(T.en[clave], clave).not.toMatch(/cut layer/);
    }
  });
  it("la silueta SVG es exactamente la del icono sin su fondo", () => {
    const icono = leer("public/icon.svg");
    const llama = leer("public/marca/llama.svg");
    expect(llama.match(/<g[\s\S]*<\/g>/)?.[0]).toBe(icono.match(/<g[\s\S]*<\/g>/)?.[0]);
    expect(llama).not.toMatch(/rx=|<image|<script|<filter/);
  });
  it("el PNG RGBA de 2048 conserva exactamente la máscara pixelada y el magenta", () => {
    const b = readFileSync(new URL("../public/marca/llama.png", import.meta.url));
    expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]]).toEqual([2048, 2048, 8, 6]);
    const idat: Buffer[] = [];
    for (let i = 8; i < b.length;) {
      const n = b.readUInt32BE(i);
      if (b.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(b.subarray(i + 8, i + 8 + n));
      i += n + 12;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const rects = [...leer("public/icon.svg").matchAll(/<rect x="([\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m => m.slice(1).map(Number));
    let opacos = 0;
    for (let y = 0; y < 2048; y++) {
      if (raw[y * 8193] !== 0) throw new Error("filtro inesperado");
      for (let x = 0; x < 2048; x++) {
        const u = ((x + .5) / 4 - 256) / 14 + 11, v = ((y + .5) / 4 - 256) / 14 + 11;
        const dentro = rects.some(([rx, ry, w, h]) => u >= rx! && u < rx! + w! && v >= ry! && v < ry! + h!);
        const i = y * 8193 + 1 + x * 4;
        if (raw[i + 3] !== (dentro ? 255 : 0)) throw new Error(`alpha distinto en ${x},${y}`);
        if (dentro) {
          opacos++;
          if (raw[i] !== 233 || raw[i + 1] !== 61 || raw[i + 2] !== 156) throw new Error("magenta distinto");
        }
      }
    }
    expect(opacos).toBeGreaterThan(0);
    expect(opacos).toBeLessThan(2048 * 2048);
  });
  it.each([['es', 'Sorteo verificable con'], ['en', 'Verifiable draw with']])("sello %s: transparente, con las letras en trazos y sin fuentes remotas", (lang, frase) => {
    const svg = leer(`public/marca/sello-${lang}.svg`);
    expect(svg).toContain(`<title id="titulo">${frase} Tinkazo</title>`);
    expect(svg).not.toMatch(/<text|<tspan|font-family|system-ui/); // las letras van en trazos
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(4);
    expect(svg).not.toMatch(/<image|@import|https?:\/\/(?!www.w3.org)/);
  });
});

// El kit para patrocinios y eventos: logos, stickers y el ZIP.
const LOGOS = ["logo-horizontal", "logo-horizontal-oscuro", "logo-apilado", "logo-apilado-oscuro"];
const STICKERS = ["sticker-redondo", "sticker-redondo-oscuro", "sticker-cuadrado"].flatMap(n => [5, 7].map(cm => `${n}-${cm}cm`));
const publico = (n: string): Buffer => readFileSync(new URL(`../public/marca/${n}`, import.meta.url));
/** Lee el directorio central de un ZIP: nombre → bytes ya descomprimidos. */
function leerZip(b: Buffer): Map<string, Buffer> {
  const fin = b.lastIndexOf(Buffer.from("504b0506", "hex"));
  const n = b.readUInt16LE(fin + 10);
  let pos = b.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const metodo = b.readUInt16LE(pos + 10), tam = b.readUInt32LE(pos + 20), largo = b.readUInt32LE(pos + 24);
    const nombre = b.toString("utf8", pos + 46, pos + 46 + b.readUInt16LE(pos + 28));
    const local = b.readUInt32LE(pos + 42);
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const datos = b.subarray(ini, ini + tam);
    const plano = metodo === 8 ? inflateRawSync(datos) : datos;
    expect(plano.length, nombre).toBe(largo);
    salida.set(nombre, plano);
    pos += 46 + b.readUInt16LE(pos + 28) + b.readUInt16LE(pos + 30) + b.readUInt16LE(pos + 32);
  }
  return salida;
}
describe("kit de marca para patrocinios y eventos", () => {
  it("existen los cuatro logos en SVG y en PNG de 2048 de ancho, con fondo transparente", () => {
    for (const n of LOGOS) {
      expect(existsSync(new URL(`../public/marca/${n}.svg`, import.meta.url)), n).toBe(true);
      const b = publico(`${n}.png`);
      expect([b.readUInt32BE(16), b[24], b[25]], n).toEqual([2048, 8, 6]);
      expect(b.readUInt32BE(20)).toBeGreaterThan(300);
    }
  });
  it("las letras de logos, sello y stickers van en trazos: ningún SVG trae texto", () => {
    for (const n of [...LOGOS, ...STICKERS, "sello-es", "sello-en"]) {
      const svg = publico(`${n}.svg`).toString("utf8");
      expect(svg, n).not.toMatch(/<text|<tspan|font-family|font-size|@font-face|<image|<script/);
      expect(svg, n).toContain("<path");
    }
  });
  it("el logo lleva el ZO y la llama en el magenta del tema, claro y oscuro", () => {
    expect(publico("logo-horizontal.svg").toString("utf8")).toMatch(/fill="#e93d9c"/);
    expect(publico("logo-horizontal.svg").toString("utf8")).toMatch(/fill="#191919"/);
    expect(publico("logo-horizontal-oscuro.svg").toString("utf8")).toMatch(/fill="#ff5cb3"/);
    expect(publico("logo-horizontal-oscuro.svg").toString("utf8")).toMatch(/fill="#f6efe2"/);
  });
  it.each(STICKERS)("sticker %s: a tamaño real en mm, con sangrado y la capa corte aparte", (n) => {
    const cm = Number(n.match(/(\d)cm/)![1]);
    const svg = publico(`${n}.svg`).toString("utf8");
    const lado = cm * 10 + 6; // 3 mm de sangrado por lado
    expect(svg).toContain(`width="${lado}mm" height="${lado}mm" viewBox="0 0 ${lado} ${lado}"`);
    expect(svg).toContain('<g id="arte">');
    expect(svg).toMatch(/<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0\.25">/);
    expect(svg.indexOf('id="arte"')).toBeLessThan(svg.indexOf('id="corte"'));
    const pdf = publico(`${n}.pdf`).toString("latin1");
    const pt = (lado * 72 / 25.4).toFixed(3);
    expect(pdf.startsWith("%PDF-1.5")).toBe(true);
    expect(pdf).toContain(`/MediaBox [0 0 ${pt} ${pt}]`);
    expect(pdf).toContain("/TrimBox [8.504 8.504");
    expect(pdf).toContain("/OCG");
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    // El xref apunta a cada objeto de verdad.
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offs = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
    offs.forEach((o, i) => expect(pdf.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
  it("el ZIP trae la lista esperada, sin fechas que cambien, con el LEEME en los dos idiomas", () => {
    const bytes = publico("tinkazo-kit-marca.zip");
    const zip = leerZip(bytes);
    const esperados = [
      "LEEME.txt",
      ...LOGOS.flatMap(n => ["svg", "png"].map(e => `logos/tinkazo-${n}.${e}`)),
      ...["llama", "llama-oscuro"].flatMap(n => ["svg", "png"].map(e => `llama/tinkazo-${n}.${e}`)),
      "sello/tinkazo-sello-es.svg", "sello/tinkazo-sello-en.svg",
      ...STICKERS.flatMap(n => ["svg", "pdf"].map(e => `stickers/tinkazo-${n}.${e}`)),
    ].map(n => `tinkazo-kit-marca/${n}`);
    for (const e of esperados) expect(zip.has(e), e).toBe(true); // la lista completa, con lo nuevo, la mide el bloque de la segunda vuelta
    // Los archivos del zip son los mismos de public/marca.
    expect(zip.get("tinkazo-kit-marca/logos/tinkazo-logo-apilado.png")!.equals(publico("logo-apilado.png"))).toBe(true);
    expect(zip.get("tinkazo-kit-marca/stickers/tinkazo-sticker-cuadrado-7cm.pdf")!.equals(publico("sticker-cuadrado-7cm.pdf"))).toBe(true);
    // La fecha de cada entrada es siempre la misma (1 de enero de 1980).
    const fin = bytes.lastIndexOf(Buffer.from("504b0506", "hex"));
    let i = bytes.readUInt32LE(fin + 16);
    for (let k = 0; k < zip.size; k++) {
      expect(bytes.readUInt32LE(i)).toBe(0x02014b50);
      expect([bytes.readUInt16LE(i + 12), bytes.readUInt16LE(i + 14)]).toEqual([0, 0x21]);
      i += 46 + bytes.readUInt16LE(i + 28) + bytes.readUInt16LE(i + 30) + bytes.readUInt16LE(i + 32);
    }
    const leeme = zip.get("tinkazo-kit-marca/LEEME.txt")!.toString("utf8");
    for (const lang of ["es", "en"] as const) expect(leeme).toContain(`${T[lang].maDescL}\r\n${T[lang].maDescP}`);
    expect(leeme).toContain("https://tinkazo.app");
    expect(leeme).toContain("hola@tinkazo.app");
    expect(leeme).toContain("Stickers: archivos a tamaño real con 3 mm de sangrado. La capa llamada corte es la línea de corte. Imprimilos en vinilo mate. Los colores son RGB y la imprenta los convierte.");
    expect(leeme).toContain("Stickers: true-size files with 3 mm bleed. The layer named corte is the cut line. Print them on matte vinyl. Colors are RGB and the printer converts them.");
    // Sin comillas angulares, sin punto y coma y sin comillas rectas: los textos de cada pieza, entre comillas curvas.
    expect(leeme).not.toMatch(/[«»;"]/);
    expect(leeme).not.toContain("'corte'");
    expect(leeme).toContain("“Sorteo verificable con Tinkazo”");
    expect(leeme).toContain("Se escribe Tinkazo, todo junto y con la T mayúscula.");
    expect(leeme).toContain("#fff6e9");
    expect(leeme).toContain("24 px");
    expect(leeme).toContain("8 mm");
  });
  it("la fuente y su licencia están versionadas junto al script", () => {
    for (const f of ["Montserrat-Black.ttf", "Montserrat-Bold.ttf", "OFL.txt"]) expect(existsSync(new URL(`../scripts/marca/fuentes/${f}`, import.meta.url)), f).toBe(true);
    expect(leer("scripts/marca/fuentes/OFL.txt")).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
  it("la sección de marca ofrece los logos, los stickers, el ZIP, el texto y las reglas, y todo está en es y en", () => {
    const html = leer("marca.html");
    expect(html).toContain('href="/marca/tinkazo-kit-marca.zip"');
    for (const n of [...LOGOS, ...STICKERS]) for (const e of n.startsWith("logo") ? ["svg", "png"] : ["svg", "pdf"]) {
      expect(html, `${n}.${e}`).toContain(`href="/marca/${n}.${e}"`);
    }
    expect(html).toContain("https://tinkazo.app");
    expect(html).toContain("mailto:hola@tinkazo.app");
    for (const clave of ["maKitT", "maKitB", "maKitZip", "maStT", "maStB", "maDescT", "maDescL", "maDescP", "maUsoT", "maUso1", "maUso2", "maUso3", "maUso4", "maUso5", "maUso6", "maDirT", "maLetraLogo"]) {
      expect(html, clave).toContain(`data-i="${clave}"`);
      expect(T.es[clave], clave).toBeTruthy();
      expect(T.en[clave], clave).toBeTruthy();
      if (clave !== "maStT") expect(T.en[clave], clave).not.toBe(T.es[clave]);
    }
    expect(T.es.maKitT).toBe("Para patrocinios y eventos");
    expect(T.en.maKitT).toBe("For sponsorships and events");
    expect(T.es.maDescL).toBe("Tinkazo: sorteos que cualquiera puede comprobar");
    expect(T.es.maUso2).toContain("24 px");
    expect(T.es.maUso2).toContain("8 mm");
    for (const k of Object.keys(T.es).filter(k => /^ma(Kit|St|Desc|Uso|Dir|Logo|Dl|LetraLogo)/.test(k))) {
      for (const lang of ["es", "en"] as const) {
        expect(T[lang][k], `${lang}.${k}`).not.toMatch(/·|drand|hash|WebGL|Worker|bytes/i);
      }
    }
  });
  it("generar-marca es reproducible: dos corridas en el mismo equipo dejan los mismos bytes, y los SVG coinciden con los del commit", async () => {
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync, rmSync } = await import("node:fs");
    const dir = new URL("../public/marca/", import.meta.url);
    // Con las subcarpetas (la colección vive en public/marca/coleccion/).
    const listar = (): string[] => (readdirSync(dir, { recursive: true }) as string[]).map(n => n.replaceAll("\\", "/")).filter(n => statSync(new URL(n, dir)).isFile()).sort();
    const foto = (): Map<string, Buffer> => new Map(listar().map(n => [n, readFileSync(new URL(n, dir))]));
    const generar = (): void => { execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/generar-marca.mjs", import.meta.url))], { stdio: "pipe" }); };
    const original = foto();
    try {
      // Lo binario (zip, png, pdf) depende de la versión de zlib de cada equipo: se compara una corrida contra otra, no contra el commit.
      generar();
      const uno = foto();
      generar();
      const dos = foto();
      expect([...dos.keys()]).toEqual([...uno.keys()]);
      for (const [n, bytes] of uno) if (/\.(zip|png|pdf)$/.test(n)) expect(dos.get(n)!.equals(bytes), n).toBe(true);
      // El texto (SVG) es determinista en cualquier equipo: tiene que coincidir con lo commiteado.
      const lf = (b: Buffer): string => b.toString("utf8").split("\r\n").join("\n");
      for (const [n, bytes] of uno) if (n.endsWith(".svg")) {
        expect(original.has(n), `${n} falta en el commit`).toBe(true);
        expect(lf(bytes), n).toBe(lf(original.get(n)!));
      }
    } finally {
      // Deja public/marca/ exactamente como estaba: los mismos archivos con los mismos bytes.
      for (const n of listar()) if (!original.has(n)) rmSync(new URL(n, dir));
      for (const [n, bytes] of original) writeFileSync(new URL(n, dir), bytes);
    }
  }, 300_000);
});

// Segunda vuelta del kit: logos con la dirección, más stickers, hojas A4, redes, afiches, cartel y portada.
const TEMAS_K = ["claro", "oscuro"] as const;
const LANGS_K = ["es", "en"] as const;
const WEB_LOGOS = ["logo-web-horizontal", "logo-web-horizontal-oscuro", "logo-web-apilado", "logo-web-apilado-oscuro"];
const STICKERS_NUEVOS = [
  "sticker-llama-recortada", "sticker-web", "sticker-web-oscuro",
  ...["verificable", "gratis", "escanea", "evento"].flatMap(n => LANGS_K.map(l => `sticker-${n}-${l}`)),
].flatMap(n => [5, 7].map(cm => `${n}-${cm}cm`));
const HOJAS = LANGS_K.flatMap(l => [`stickers-hoja-a4-${l}`, `stickers-hoja-a4-7cm-${l}`]);
const REDES = [["portada", 1200, 630], ["cuadrada", 1080, 1080], ["historia", 1080, 1920], ["cabecera", 1500, 500], ["linkedin", 1584, 396], ["patrocinio-cuadrada", 1080, 1080], ["patrocinio-ancha", 1920, 1080]] as const;
const REDES_ARCHIVOS = REDES.flatMap(([id]) => TEMAS_K.flatMap(t => LANGS_K.map(l => `redes-${id}-${t}-${l}`)));
const AFICHES = TEMAS_K.flatMap(t => LANGS_K.flatMap(l => ["afiche-evento-a4", "afiche-evento-a3", "cartel-mesa-a5"].map(n => `${n}-${t}-${l}`)));
const PORTADAS = ["kit-portada", "kit-portada-en"];
const svgsDe = (dir: string): string[] => readdirSync(new URL(dir, import.meta.url)).filter(n => n.endsWith(".svg")).sort();

/** Dibuja los módulos del QR que trae un SVG (los trazos con class="qr") y los decodifica con jsQR. */
function decodificarQrs(svg: string): string[] {
  const salida: string[] = [];
  for (const m of svg.matchAll(/<path class="qr" d="([^"]+)"/g)) {
    const rects = m[1]!.split("M").slice(1).map(sub => {
      const nums = [...sub.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
    });
    const x0 = Math.min(...rects.map(r => r[0])), y0 = Math.min(...rects.map(r => r[1]));
    const x1 = Math.max(...rects.map(r => r[2])), y1 = Math.max(...rects.map(r => r[3]));
    const modulo = Math.min(...rects.map(r => r[3] - r[1])) / 1.03; // los módulos solapan un 3 %
    const px = 6 / modulo, margen = 4 * modulo;
    const w = Math.ceil((x1 - x0 + 2 * margen) * px), h = Math.ceil((y1 - y0 + 2 * margen) * px);
    const img = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const [a, b, c, d] of rects) {
      for (let y = Math.round((b - y0 + margen) * px); y < Math.round((d - y0 + margen) * px); y++) {
        for (let x = Math.round((a - x0 + margen) * px); x < Math.round((c - x0 + margen) * px); x++) img.set([0, 0, 0, 255], (y * w + x) * 4);
      }
    }
    const r = jsQR(img, w, h);
    salida.push(r?.data ?? "(no se pudo leer)");
  }
  return salida;
}
const comoZip = (n: string): string[] => [`tinkazo-kit-marca/${n}`];

describe("kit de marca, segunda vuelta", () => {
  it("existen todos los archivos nuevos: logos con la dirección, stickers, hojas, redes, afiches y portadas", () => {
    for (const n of WEB_LOGOS) for (const e of ["svg", "png"]) expect(existsSync(new URL(`../public/marca/${n}.${e}`, import.meta.url)), `${n}.${e}`).toBe(true);
    for (const n of [...STICKERS_NUEVOS, ...HOJAS, ...AFICHES]) for (const e of n.startsWith("sticker") && !n.startsWith("stickers-hoja") ? ["svg", "pdf"] : ["svg", "pdf"]) expect(existsSync(new URL(`../public/marca/${n}.${e}`, import.meta.url)), `${n}.${e}`).toBe(true);
    for (const n of [...REDES_ARCHIVOS, ...PORTADAS]) expect(existsSync(new URL(`../public/marca/${n}.png`, import.meta.url)), n).toBe(true);
  });
  it("el ZIP trae exactamente la lista nueva, con las mismas bytes que public/marca", () => {
    const zip = leerZip(publico("tinkazo-kit-marca.zip"));
    const nuevos: Array<[string, string]> = [
      ...WEB_LOGOS.flatMap(n => ["svg", "png"].map(e => [`logos/tinkazo-${n}.${e}`, `${n}.${e}`] as [string, string])),
      ...STICKERS_NUEVOS.flatMap(n => ["svg", "pdf"].map(e => [`stickers/tinkazo-${n}.${e}`, `${n}.${e}`] as [string, string])),
      ...HOJAS.flatMap(n => ["svg", "pdf"].map(e => [`stickers/hojas/tinkazo-${n}.${e}`, `${n}.${e}`] as [string, string])),
      ...REDES_ARCHIVOS.map(n => [`redes/tinkazo-${n}.png`, `${n}.png`] as [string, string]),
      ...AFICHES.flatMap(n => ["svg", "pdf"].map(e => [`afiches/tinkazo-${n}.${e}`, `${n}.${e}`] as [string, string])),
      ["tinkazo-kit-portada.png", "kit-portada.png"], ["tinkazo-kit-portada-en.png", "kit-portada-en.png"],
    ];
    expect(nuevos.length).toBe(114);
    for (const [ruta, archivo] of nuevos) {
      const dentro = zip.get(comoZip(ruta)[0]!);
      expect(dentro, ruta).toBeTruthy();
      expect(dentro!.equals(publico(archivo)), ruta).toBe(true);
    }
    expect(zip.size).toBe(27 + 114); // los impresos y lo de sponsors van en sus propios ZIP, para no pasar de los 4 MB del repo
    const leeme = zip.get("tinkazo-kit-marca/LEEME.txt")!.toString("utf8");
    for (const frag of ["tinkazo-kit-portada.png", "stickers/hojas/", "redes/", "afiches/", "Escaneá y comprobá", "Scan and check", "1200x630", "1584x396", "A3", "https://tinkazo.app/sorteo-para-meetup.html#comprobacion"]) expect(leeme, frag).toContain(frag);
  });
  it("ningún SVG de public/marca trae texto: todo son trazos", () => {
    const todos = svgsDe("../public/marca/");
    expect(todos.length).toBe(56 + SVGS_NUEVOS);
    // El roll-up, el banner de mesa y sus vistas llevan fotos de los juegos: se miran en el bloque de los impresos.
    for (const n of todos.filter(n => !/^(rollup-|banner-mesa-|vista-)/.test(n))) {
      const svg = publico(n).toString("utf8");
      expect(svg, n).not.toMatch(/<text|<tspan|font-family|font-size|@font-face|<image|<script|<foreignObject/);
      expect(svg, n).toMatch(/<path|<rect/);
    }
  });
  it("los PNG de redes miden lo que dicen, la portada 1600 por 900 y los logos con dirección 2048 de ancho", () => {
    for (const [id, w, h] of REDES) for (const t of TEMAS_K) for (const l of LANGS_K) {
      const b = publico(`redes-${id}-${t}-${l}.png`);
      expect([b.readUInt32BE(16), b.readUInt32BE(20), b[24], b[25]], `${id} ${t} ${l}`).toEqual([w, h, 8, 6]);
    }
    for (const n of PORTADAS) expect([publico(`${n}.png`).readUInt32BE(16), publico(`${n}.png`).readUInt32BE(20)]).toEqual([1600, 900]);
    for (const n of WEB_LOGOS) { const b = publico(`${n}.png`); expect(b.readUInt32BE(16), n).toBe(2048); expect(b.readUInt32BE(20)).toBeGreaterThan(300); }
  });
  it("las imágenes en claro y en oscuro, y en español y en inglés, son distintas entre sí", () => {
    for (const [id] of REDES) {
      const c = publico(`redes-${id}-claro-es.png`), o = publico(`redes-${id}-oscuro-es.png`), e = publico(`redes-${id}-claro-en.png`);
      expect(c.equals(o), `${id} claro/oscuro`).toBe(false);
      expect(c.equals(e), `${id} es/en`).toBe(false);
    }
  });
  it("los QR decodifican a su dirección: stickers, afiches, cartel y hojas", () => {
    const SITIO = "https://tinkazo.app", COMPROBACION = "https://tinkazo.app/sorteo-para-meetup.html#comprobacion";
    for (const l of LANGS_K) for (const cm of [5, 7]) expect(decodificarQrs(publico(`sticker-escanea-${l}-${cm}cm.svg`).toString("utf8")), `escanea ${l} ${cm}`).toEqual([SITIO]);
    for (const t of TEMAS_K) for (const l of LANGS_K) {
      for (const tam of ["a4", "a3"]) expect(decodificarQrs(publico(`afiche-evento-${tam}-${t}-${l}.svg`).toString("utf8")), `afiche ${tam} ${t} ${l}`).toEqual([SITIO]);
      expect(decodificarQrs(publico(`cartel-mesa-a5-${t}-${l}.svg`).toString("utf8")), `cartel ${t} ${l}`).toEqual([COMPROBACION]);
    }
    for (const n of HOJAS) {
      const qrs = decodificarQrs(publico(`${n}.svg`).toString("utf8"));
      expect(qrs.length, n).toBeGreaterThanOrEqual(1);
      for (const q of qrs) expect(q, n).toBe(SITIO);
    }
  });
  it("las hojas y los afiches miden lo que dicen en SVG y en PDF, y las hojas traen la capa de corte de cada sticker", () => {
    const mm = (v: number): string => (v * 72 / 25.4).toFixed(3);
    for (const n of HOJAS) {
      const svg = publico(`${n}.svg`).toString("utf8");
      expect(svg, n).toContain('width="210mm" height="297mm" viewBox="0 0 210 297"');
      expect(svg).toContain('<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0.25">');
      const cortes = (svg.split('<g id="corte"')[1]!.match(/<path /g) ?? []).length;
      expect(cortes, n).toBeGreaterThanOrEqual(n.includes("7cm") ? 8 : 18);
      const pdf = publico(`${n}.pdf`).toString("latin1");
      expect(pdf).toContain(`/MediaBox [0 0 ${mm(210)} ${mm(297)}]`);
      expect(pdf).toContain("/OCG");
    }
    const cabe = (n: string, w: number, h: number): void => {
      expect(publico(`${n}.svg`).toString("utf8"), n).toContain(`width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"`);
      expect(publico(`${n}.pdf`).toString("latin1"), n).toContain(`/MediaBox [0 0 ${mm(w)} ${mm(h)}]`);
    };
    for (const t of TEMAS_K) for (const l of LANGS_K) { cabe(`afiche-evento-a4-${t}-${l}`, 210, 297); cabe(`afiche-evento-a3-${t}-${l}`, 297, 420); cabe(`cartel-mesa-a5-${t}-${l}`, 148, 210); }
  });
  it("entre sticker y sticker de una hoja hay 5 mm de aire", () => {
    // En las filas de tres cuadrados, los recortes (capa corte) arrancan cada 55 mm: 50 de sticker más 5 de aire.
    const svg = publico("stickers-hoja-a4-es.svg").toString("utf8");
    const cortes = [...svg.split('<g id="corte"')[1]!.matchAll(/<path d="M([\d.]+) ([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])] as const);
    const filas = new Map<number, number[]>();
    for (const [x, y] of cortes) filas.set(Math.round(y), [...(filas.get(Math.round(y)) ?? []), x]);
    const conPaso = [...filas.values()].filter(xs => xs.length === 3).map(xs => xs.sort((p, q) => p - q)).filter(xs => Math.abs(xs[1]! - xs[0]! - 55) < 0.01 && Math.abs(xs[2]! - xs[1]! - 55) < 0.01);
    expect(conPaso.length).toBeGreaterThanOrEqual(2);
    expect(filas.size).toBeGreaterThanOrEqual(6);
  });
  it("los stickers nuevos: tamaño real con sangrado, capa de corte y PDF válido", () => {
    for (const n of STICKERS_NUEVOS) {
      const svg = publico(`${n}.svg`).toString("utf8");
      const cm = Number(n.match(/(\d)cm/)![1]);
      expect(svg, n).toMatch(new RegExp(`width="[\\d.]+mm" height="[\\d.]+mm" viewBox="0 0 [\\d.]+ [\\d.]+"`));
      expect(svg).toContain('<g id="arte">');
      expect(svg).toMatch(/<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0\.25">/);
      const ancho = Number(svg.match(/width="([\d.]+)mm"/)![1]);
      if (!n.includes("llama-recortada") && !n.includes("web")) expect(ancho, n).toBeCloseTo(cm * 10 + 6, 3);
      if (n.includes("web")) expect(ancho, n).toBeCloseTo(cm * 10 + 6, 3);
      const pdf = publico(`${n}.pdf`).toString("latin1");
      expect(pdf.startsWith("%PDF-1.5")).toBe(true);
      expect(pdf).toContain("/TrimBox [8.504 8.504");
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
      const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
      expect(pdf.slice(xref, xref + 4)).toBe("xref");
      const offs = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
      offs.forEach((o, i) => expect(pdf.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
    }
  });
  it("la llama recortada: el corte sigue el contorno con 2 mm de borde y el PDF trae el dibujo comprimido", () => {
    const svg = publico("sticker-llama-recortada-5cm.svg").toString("utf8");
    const corte = svg.split('<g id="corte"')[1]!;
    expect(corte).toMatch(/<path d="M[\d. L]+Z"\/>/);
    const pdf = publico("sticker-llama-recortada-5cm.pdf");
    expect(pdf.toString("latin1")).toContain("/FlateDecode");
    const ini = pdf.indexOf("stream\n") + 7, fin = pdf.indexOf("\nendstream");
    const contenido = inflateSync(pdf.subarray(ini, fin)).toString("latin1");
    expect(contenido).toContain("/OC /corte BDC");
    expect(contenido).toContain("EMC");
  });
  it("el logo con la dirección lleva tinkazo.app en trazos y el .app en magenta, claro y oscuro", () => {
    const l = publico("logo-web-horizontal.svg").toString("utf8");
    expect(l).toContain("<title id=\"titulo\">Tinkazo, tinkazo.app</title>");
    expect((l.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(5); // llama, TINKA, ZO, tinkazo, .app
    expect(l).toMatch(/fill="#e93d9c"/);
    const o = publico("logo-web-apilado-oscuro.svg").toString("utf8");
    expect(o).toMatch(/fill="#ff5cb3"/);
    expect(o).toMatch(/fill="#f6efe2"/);
    // El apilado es más alto que el horizontal en proporción.
    const dim = (s: string): number => { const m = s.match(/width="([\d.]+)" height="([\d.]+)"/)!; return Number(m[1]) / Number(m[2]); };
    expect(dim(l)).toBeGreaterThan(3.5);
    expect(dim(publico("logo-web-apilado.svg").toString("utf8"))).toBeLessThan(1.5);
  });
  it("la página ofrece cada archivo nuevo, todo existe y los que cambian con el idioma tienen su versión en inglés", () => {
    const html = leer("marca.html");
    const raiz = fileURLToPath(new URL("../public", import.meta.url));
    for (const m of html.matchAll(/(?:href|src|data-href|data-src)="(\/marca\/[^"]+)"/g)) {
      const ruta = m[1]!;
      const variantes = ruta.includes("{l}") ? LANGS_K.map(l => ruta.replaceAll("{l}", l)) : ruta.includes("{en}") ? [ruta.replaceAll("{en}", ""), ruta.replaceAll("{en}", "-en")] : [ruta];
      for (const v of variantes) expect(existsSync(`${raiz}${v}`), v).toBe(true);
    }
    for (const n of [...WEB_LOGOS, ...STICKERS_NUEVOS.filter(n => !/-(es|en)-/.test(n)), "kit-portada"]) expect(html, n).toContain(`/marca/${n}`);
    for (const [id] of REDES) expect(html, id).toContain(`/marca/redes-${id}-claro-es.png`);
    for (const t of TEMAS_K) { expect(html).toContain(`/marca/afiche-evento-a4-${t}-es.pdf`); expect(html).toContain(`/marca/cartel-mesa-a5-${t}-es.svg`); }
    for (const n of ["stickers-hoja-a4-es", "stickers-hoja-a4-7cm-es"]) for (const e of ["pdf", "svg"]) expect(html).toContain(`/marca/${n}.${e}`);
    expect(leer("src/marca.ts")).toContain("data-src");
    expect(leer("src/marca.ts")).toContain("onLangChange(actualizarTodo)");
  });
  it("cada texto nuevo de la página está en español y en inglés, sin punto medio ni tecnicismos", () => {
    const claves = Object.keys(T.es).filter(k => /^ma(Web|StNota|StLlama|StWeb|StVer|StGra|StEsc|StEve|Hoj|Red|Af|Ca|Portada|Uso7)/.test(k));
    expect(claves.length).toBeGreaterThanOrEqual(40);
    const html = leer("marca.html");
    for (const k of claves) {
      expect(html, k).toContain(`data-i="${k}"`);
      for (const lang of ["es", "en"] as const) {
        expect(T[lang][k], `${lang}.${k}`).toBeTruthy();
        expect(T[lang][k], `${lang}.${k}`).not.toMatch(/·|drand|hash|WebGL|Worker|bytes/i);
      }
      if (!/^ma(Red[1-7]|StVer|StGra)$/.test(k)) expect(T.en[k], k).not.toBe(T.es[k]);
    }
    expect(T.es.maRedT).toBe("Para redes y marketing");
    expect(T.en.maRedT).toBe("For social media and marketing");
    expect(T.es.maWebT).toBe("Logo con la dirección");
    expect(T.en.maAfT).toBe("Posters and table sign");
  });
  it("los textos que van en las imágenes están en los dos idiomas", () => {
    const frases = [["Sorteos que cualquiera puede comprobar", "Draws anyone can check"], ["Participar es gratis", "Entry is free"], ["Tinkazo patrocina este evento", "Tinkazo sponsors this event"], ["logo del evento", "event logo"]];
    const fuente = leer("scripts/marca/redes.mjs");
    for (const [es, en] of frases) {
      const palabras = (s: string): string[] => s.split(" ");
      for (const p of [es!, en!]) {
        if (p.startsWith("Sorteos") || p.startsWith("Draws")) continue; // el titular va partido en líneas
        if (p.startsWith("Tinkazo")) continue;
        expect(fuente, p).toContain(`"${p}"`);
      }
      void palabras;
    }
    for (const frag of ["Sorteos que", "cualquiera puede", "comprobar", "Draws anyone", "can check", "Tinkazo", "patrocina", "este evento", "sponsors", "this event", "tinkazo.app"]) expect(fuente, frag).toContain(frag);
  });
});

// La colección de stickers con personaje: módulo scripts/marca/coleccion.mjs, archivos en public/marca/coleccion/.
type St = { id: string; grupo: string; num?: number; langs?: Array<string | null>; lineas: Record<string, string[]> };
const COL = "../public/marca/coleccion/";
const enCol = (n: string): Buffer => readFileSync(new URL(`${COL}${n}`, import.meta.url));
const claveCol = (id: string): string => "maCol" + id.split("-").map(p => p[0]!.toUpperCase() + p.slice(1)).join("");

describe("colección de stickers con personaje", async () => {
  const ruta = new URL("../scripts/marca/coleccion.mjs", import.meta.url).href; // un .mjs sin tipos: se importa por su URL
  const m = await import(/* @vite-ignore */ ruta) as unknown as {
    COLECCION: St[]; HOJAS: Record<string, { ids: string[] }>; LADO_PNG: number;
    stickerColeccion: (st: St, lang: string | null, cm: number, sangre: number) => { w: number; h: number; capMin: number; capSello: number; formas: Array<{ capa?: string; clase?: string }> };
    LAPTOP: Array<[string, string]>;
  };
  const langs = (st: St): Array<string | null> => st.langs ?? ["es", "en"];
  const nombres = m.COLECCION.flatMap(st => langs(st).map(l => (l ? `${st.id}-${l}` : st.id)));

  it("son 28: los diez juegos numerados del 1 al 10, el especial de Tarija, la llama, frases y devs", () => {
    expect(m.COLECCION.length).toBe(28);
    expect(new Set(m.COLECCION.map(s => s.id)).size).toBe(28);
    expect(m.COLECCION.filter(s => s.grupo === "tarija").map(s => s.id)).toEqual(["tarija", "tarija-laptop"]);
    // Lo que se sacó el 7 de noviembre de 2026 no vuelve: ni la boca abierta del sapo ni las frases de «adentro» y «afuera».
    const frases = m.COLECCION.flatMap(st => Object.values(st.lineas).flat()).join("\n");
    expect(frases).not.toMatch(/adentro|afuera|right in|everyone's in|left out/i);
    expect(m.COLECCION.filter(s => s.grupo === "juegos").map(s => s.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const g of ["llama", "frases", "devs"]) expect(m.COLECCION.filter(s => s.grupo === g).length, g).toBeGreaterThanOrEqual(5);
    for (const st of m.COLECCION) for (const l of langs(st)) expect(st.lineas[String(l)]?.length, `${st.id} ${l}`).toBeGreaterThan(0);
  });
  it("se leen a 5 cm: la medida mayor es 5 cm y ninguna letra baja de 2,8 mm de alto", () => {
    for (const st of m.COLECCION) for (const l of langs(st)) {
      const s = m.stickerColeccion(st, l, 5, 0);
      expect(Math.max(s.w, s.h), st.id).toBeCloseTo(50, 3);
      expect(s.capMin, `${st.id} ${l}`).toBeGreaterThanOrEqual(2.8);
      expect(s.formas.filter(f => f.capa === "corte").length).toBe(1);
    }
  });
  it("todos llevan tinkazo.app abajo, del mismo tamaño y legible a 5 cm: la letra mide al menos 2,2 mm (26 puntos a 300 ppp)", () => {
    const sellos: number[] = [];
    for (const st of m.COLECCION) for (const l of langs(st)) {
      const s = m.stickerColeccion(st, l, 5, 0);
      expect(s.formas.some(f => f.clase === "sello"), `${st.id} ${l}`).toBe(true);
      expect(s.capSello, `${st.id} ${l}`).toBeGreaterThanOrEqual(2.2);
      expect(s.capSello * 300 / 25.4, `${st.id} ${l}`).toBeGreaterThanOrEqual(26);
      sellos.push(s.capSello);
    }
    expect(Math.max(...sellos) - Math.min(...sellos)).toBeLessThan(0.05);
  });
  it("cada sticker tiene su PNG con fondo transparente y la página los ofrece en es y en", () => {
    const html = leer("marca.html");
    for (const n of nombres) {
      const b = enCol(`${n}.png`);
      expect([Math.max(b.readUInt32BE(16), b.readUInt32BE(20)), b[24], b[25]], n).toEqual([m.LADO_PNG, 8, 6]);
      const idat: Buffer[] = [];
      for (let i = 8; i < b.length;) { const k = b.readUInt32BE(i); if (b.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(b.subarray(i + 8, i + 8 + k)); i += k + 12; }
      expect(inflateSync(Buffer.concat(idat))[4], `${n}: la esquina es transparente`).toBe(0);
    }
    for (const st of m.COLECCION) {
      const ruta = st.langs ? `/marca/coleccion/${st.id}.png` : `/marca/coleccion/${st.id}-{l}.png`;
      expect(html, st.id).toContain(st.langs ? `src="${ruta}"` : `data-src="${ruta}"`);
      expect(html, st.id).toContain(`data-i="${claveCol(st.id)}"`);
    }
    for (const h of Object.keys(m.HOJAS)) expect(html, h).toContain(`data-href="/marca/coleccion/${h}-{l}.pdf"`);
    expect(html).toContain('href="/marca/coleccion/tinkazo-stickers.zip"');
    expect(html).toContain('href="/marca/coleccion/frases.txt"');
  });
  it("las hojas miden A4 y A3, traen la capa de corte, la A3 lleva los 28 y la de la laptop, nueve de 6 cm", () => {
    const mm = (v: number): string => (v * 72 / 25.4).toFixed(3);
    for (const l of ["es", "en"]) for (const [h, [w, alto]] of [["hoja-a4-juegos", [210, 297]], ["hoja-a4-frases", [210, 297]], ["hoja-a4-laptop", [210, 297]], ["hoja-a3", [297, 420]]] as const) {
      const pdf = enCol(`${h}-${l}.pdf`).toString("latin1");
      expect(pdf, h).toContain(`/MediaBox [0 0 ${mm(w)} ${mm(alto)}]`);
      expect(pdf).toContain("/OCG");
      expect(existsSync(new URL(`${COL}${h}-${l}.png`, import.meta.url))).toBe(true);
    }
    expect(new Set(m.HOJAS["hoja-a3"]!.ids)).toEqual(new Set(m.COLECCION.map(s => s.id)));
    expect(m.HOJAS["hoja-a4-juegos"]!.ids.length).toBe(15);
    expect(m.HOJAS["hoja-a4-frases"]!.ids.length).toBe(15);
    expect(m.HOJAS["hoja-a4-laptop"]!.ids).toEqual(m.LAPTOP.map(([id]) => id));
    expect(m.LAPTOP.length).toBe(9);
    for (const [id, por] of m.LAPTOP) { expect(m.COLECCION.some(s => s.id === id), id).toBe(true); expect(por.length, id).toBeGreaterThan(20); }
  });
  it("el ZIP pesa menos de 4 MB y trae cada sticker en PDF de 5 y 7 cm, SVG de 5 cm con sangrado y corte, las hojas A4 y las frases; los PNG van en otro", () => {
    const bytes = enCol("tinkazo-stickers.zip");
    expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
    const zip = leerZip(bytes);
    const bytesPng = enCol("tinkazo-stickers-png.zip");
    expect(bytesPng.length).toBeLessThan(4 * 1024 * 1024);
    const png = leerZip(bytesPng);
    const r = "tinkazo-stickers/";
    expect(zip.has(`${r}LEEME.txt`)).toBe(true);
    // El ZIP guarda frases.txt tal como estaba en la máquina que lo generó (fin de línea CRLF en Windows), y git entrega
    // el archivo suelto con el fin de línea de cada sistema: se comparan las líneas, no los bytes.
    const lineas = (b: Buffer): string => b.toString("utf8").replace(/\r\n/g, "\n");
    expect(lineas(zip.get(`${r}frases.txt`)!)).toBe(lineas(enCol("frases.txt")));
    for (const n of nombres) {
      for (const cm of [5, 7]) expect(zip.get(`${r}stickers/tinkazo-${n}-${cm}cm.pdf`)!.toString("latin1").startsWith("%PDF-1.5"), n).toBe(true);
      const svg = zip.get(`${r}stickers/tinkazo-${n}-5cm.svg`)!.toString("utf8");
      const [w, h] = [Number(svg.match(/width="([\d.]+)mm"/)![1]), Number(svg.match(/height="([\d.]+)mm"/)![1])];
      expect(Math.max(w, h), n).toBeCloseTo(56, 2); // 50 mm de troquel más 3 mm de sangrado por lado
      expect(svg).toMatch(/<g id="corte" fill="none" stroke="#ff00ff" stroke-width="0\.25">\n<path d="M[^"]+Z"\/>\n<\/g>/);
      expect(svg).not.toMatch(/<text|<tspan|font-family|<image|<script/);
      expect(zip.has(`${r}png/tinkazo-${n}.png`), n).toBe(false);
      expect(png.get(`tinkazo-stickers-png/tinkazo-${n}.png`)!.equals(enCol(`${n}.png`)), n).toBe(true);
    }
    const enZip = Object.keys(m.HOJAS).filter(h => h !== "hoja-a3");
    for (const l of ["es", "en"]) for (const h of enZip) expect(zip.get(`${r}hojas/tinkazo-stickers-${h}-${l}.pdf`)!.equals(enCol(`${h}-${l}.pdf`)), h).toBe(true);
    expect(zip.size).toBe(2 + nombres.length * 3 + enZip.length * 2);
    expect(png.size).toBe(nombres.length);
    const leeme = zip.get(`${r}LEEME.txt`)!.toString("utf8");
    for (const f of ["@tinkazo.app", "kiss-cut", "5 mm", "3 mm", "no vienen en sobres sorpresa", "no mystery packs"]) expect(leeme, f).toContain(f);
  });
  it("las frases están en es y en, con Instagram, sin punto medio y sin nada de apuestas", () => {
    const txt = enCol("frases.txt").toString("utf8");
    for (const st of m.COLECCION) for (const l of langs(st)) expect(txt.toLowerCase(), st.id).toContain(st.lineas[String(l)]!.join(" ").toLowerCase());
    expect(txt).toContain("@tinkazo.app");
    const todo = [txt, ...m.COLECCION.flatMap(st => Object.values(st.lineas).flat())].join("\n");
    expect(todo).not.toMatch(/·|apuest|apost|casino|jackpot|\bbet\b|gambl|suerte|\bluck/i);
  });
  it("cada texto de la sección está en español y en inglés, sin punto medio ni tecnicismos", () => {
    const claves = Object.keys(T.es).filter(k => k.startsWith("maCol"));
    expect(claves.length).toBe(48);
    const html = leer("marca.html");
    for (const k of claves) {
      expect(html, k).toContain(`data-i="${k}"`);
      for (const lang of ["es", "en"] as const) expect(T[lang][k], `${lang}.${k}`).not.toMatch(/·|drand|hash|WebGL|Worker|bytes|blockchain/i);
      if (!["maColGuajojo", "maColToborochi", "maColChovena", "maColEntrada", "maColPinata", "maColDevCommit", "maColTarijaLaptop"].includes(k)) expect(T.en[k], k).not.toBe(T.es[k]);
    }
    expect(T.es.maColT).toBe("Stickers con personaje");
    expect(T.en.maColT).toBe("Character stickers");
  });
});

// Los impresos del stand (roll-up y banner de mesa) y lo que necesita quien nos pone de sponsor.
const JUEGOS_FOTO = ["race", "oruro", "guajojo", "toborochi", "pinata", "wheel"];
const IMPRESOS = LANGS_K.flatMap(l => [`rollup-85x200-${l}`, `rollup-100x200-${l}`, `banner-mesa-120x40-${l}`]);
const VISTAS = LANGS_K.flatMap(l => [`vista-rollup-85x200-${l}`, `vista-banner-mesa-120x40-${l}`]);
const PARED = ["horizontal", "cuadrado"].flatMap(d => ["", "-oscuro", "-negro", "-blanco"].map(v => `logo-pared-${d}${v}`));
const SPONSOR_REDES = [["sponsor-post", 1080, 1350], ["sponsor-historia", 1080, 1920], ["sponsor-linkedin", 1584, 396], ["sponsor-x", 1500, 500], ["sponsor-panoramica", 1200, 675], ["sponsor-banner", 1980, 400]] as const;
const SPONSOR_REDES_ARCHIVOS = SPONSOR_REDES.flatMap(([id]) => TEMAS_K.flatMap(t => LANGS_K.map(l => `redes-${id}-${t}-${l}`)));
const IMPRESOS_ZIP = IMPRESOS.length + JUEGOS_FOTO.length; // los SVG y las fotos que enlazan: los PDF pesados se bajan sueltos
// Cada logo de pared en SVG, PNG, PNG de 2400 px y PDF; las imágenes; los textos y las preguntas para coordinar.
const SPONSOR_ZIP = PARED.length * 4 + SPONSOR_REDES_ARCHIVOS.length + 2;
const SVGS_NUEVOS = IMPRESOS.length + VISTAS.length + PARED.length;
/** Las coordenadas y de un trazado de SVG (pares x y). */
const ysDe = (d: string): number[] => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0])).filter((_, i) => i % 2 === 1);
/** El canal alfa del primer píxel de un PNG de los nuestros (sin filtro en la primera fila). */
const alfaEsquina = (b: Buffer): number => {
  const idat: Buffer[] = [];
  for (let i = 8; i < b.length;) { const n = b.readUInt32BE(i); if (b.toString("ascii", i + 4, i + 8) === "IDAT") idat.push(b.subarray(i + 8, i + 8 + n)); i += n + 12; }
  const raw = inflateSync(Buffer.concat(idat));
  return raw[4]!;
};
const textosSponsor = async (): Promise<{ TEXTOS_SPONSOR: Record<"es" | "en", { d25: string; d50: string; d100: string; posts: string[]; nombre: string; donde: string }>; palabras: (s: string) => number }> =>
  import(/* @vite-ignore */ new URL("../scripts/marca/textos-sponsor.mjs", import.meta.url).href);

describe("kit de marca: impresos y sponsors", () => {
  it("el roll-up y el banner de mesa miden lo que dicen, con 5 mm de sangrado, y el PDF trae las fotos adentro", () => {
    const mm = (v: number): string => (v * 72 / 25.4).toFixed(3);
    for (const [base, w, h, fotos] of [["rollup-85x200", 850, 2000, 6], ["rollup-100x200", 1000, 2000, 6], ["banner-mesa-120x40", 1200, 400, 4]] as const) {
      for (const l of LANGS_K) {
        const n = `${base}-${l}`;
        expect(publico(`${n}.svg`).toString("utf8"), n).toContain(`width="${w + 10}mm" height="${h + 10}mm" viewBox="0 0 ${w + 10} ${h + 10}"`);
        const pdf = publico(`${n}.pdf`).toString("latin1");
        expect(pdf, n).toContain(`/MediaBox [0 0 ${mm(w + 10)} ${mm(h + 10)}]`);
        expect(pdf, n).toContain(`/TrimBox [${mm(5)} ${mm(5)} ${mm(w + 5)} ${mm(h + 5)}]`);
        expect((pdf.match(/\/Subtype \/Image/g) ?? []).length, n).toBe(fotos);
        expect((pdf.match(/\/Filter \/DCTDecode/g) ?? []).length, n).toBe(fotos);
        const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
        expect(pdf.slice(xref, xref + 4)).toBe("xref");
        const offs = [...pdf.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m => Number(m[1]));
        offs.forEach((o, i) => expect(pdf.slice(o, o + 12).startsWith(`${i + 1} 0 obj`), `${n} objeto ${i + 1}`).toBe(true));
      }
    }
    // Las fotos del roll-up son las grandes (2560 de ancho): a 36 cm de ancho, unos 180 puntos por pulgada.
    const roll = publico("rollup-85x200-es.pdf").toString("latin1");
    for (const m of roll.matchAll(/\/Width (\d+) \/Height (\d+)/g)) expect([Number(m[1]), Number(m[2])]).toEqual([2560, 1440]);
  });
  it("el SVG para editar enlaza las fotos que viajan al lado, y la vista de la página las lleva adentro", () => {
    const zip = leerZip(publico("tinkazo-kit-impresos.zip"));
    expect(zip.size).toBe(IMPRESOS_ZIP);
    expect(publico("tinkazo-kit-impresos.zip").length).toBeLessThan(4 * 1024 * 1024);
    for (const n of IMPRESOS) {
      expect(zip.get(`tinkazo-kit-impresos/tinkazo-${n}.svg`)?.equals(publico(`${n}.svg`)), n).toBe(true);
    }
    for (const n of IMPRESOS) {
      const svg = publico(`${n}.svg`).toString("utf8");
      expect(svg, n).not.toMatch(/<text|<tspan|font-family|<script|<foreignObject|data:/);
      const enlaces = [...svg.matchAll(/<image href="([^"]+)"/g)].map(m => m[1]!);
      expect(enlaces.length, n).toBe(n.startsWith("banner") ? 4 : 6);
      for (const e of enlaces) {
        expect(e, n).toMatch(/^juego-[a-z]+\.jpg$/);
        expect(existsSync(new URL(`../public/marca/${e}`, import.meta.url)), e).toBe(true);
        expect(zip.get(`tinkazo-kit-impresos/${e}`)!.equals(publico(e)), e).toBe(true);
      }
    }
    for (const n of VISTAS) {
      const svg = publico(`${n}.svg`).toString("utf8");
      expect(svg, n).not.toMatch(/<text|<script|<foreignObject/);
      const fotos = [...svg.matchAll(/<image href="([^"]+)"/g)].map(m => m[1]!);
      expect(fotos.length, n).toBeGreaterThanOrEqual(4);
      for (const f of fotos) expect(f.startsWith("data:image/jpeg;base64,"), n).toBe(true);
      // Con los personajes de los stickers en trazos, la vista del roll-up ronda el medio mega: sigue cargando tarde (lazy).
      expect(publico(`${n}.svg`).length, n).toBeLessThan(600_000);
    }
    for (const j of JUEGOS_FOTO) expect(publico(`juego-${j}.jpg`).equals(readFileSync(new URL(`../scripts/marca/fotos/${j}.jpg`, import.meta.url))), j).toBe(true);
  });
  it("el QR lleva a tinkazo.app, en el roll-up mide más de 18 cm (25 con su margen blanco) y queda a la altura del pecho, y los 15 cm de abajo están libres", () => {
    for (const n of IMPRESOS) expect(decodificarQrs(publico(`${n}.svg`).toString("utf8")), n).toEqual(["https://tinkazo.app"]);
    for (const n of IMPRESOS.filter(n => n.startsWith("rollup"))) {
      const svg = publico(`${n}.svg`).toString("utf8");
      const qr = ysDe(svg.match(/<path class="qr" d="([^"]+)"/)![1]!);
      const alto = Math.max(...qr) - Math.min(...qr);
      expect(alto, n).toBeGreaterThan(180);
      // Del piso (2005 mm, sin el sangrado) al QR: entre 90 y 150 cm.
      expect(2005 - Math.max(...qr), n).toBeGreaterThan(900);
      expect(2005 - Math.min(...qr), n).toBeLessThan(1500);
      // En la franja que tapa la base no hay nada más que el fondo y el remate de colores de los últimos 3 cm.
      for (const m of svg.matchAll(/<path(?: class="[^"]+")? d="([^"]+)"/g)) {
        const ys = ysDe(m[1]!);
        if (Math.min(...ys) <= 0) continue; // el fondo entero
        if (Math.max(...ys) > 1855) expect(Math.min(...ys), `${n}: algo en la base`).toBeGreaterThanOrEqual(1975);
      }
      for (const m of svg.matchAll(/<image href="[^"]+" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)) expect(Number(m[1]) + Number(m[2]), n).toBeLessThan(1855);
      expect(svg, n).toMatch(/<title id="titulo">Tinkazo, roll-up de \d+ por 200 cm, con 5 mm de sangrado<\/title>/);
    }
  });
  it("los logos para la pared de sponsors: caja fija, fondo transparente, en color, negro y blanco", () => {
    for (const n of PARED) {
      const [w, h] = n.includes("horizontal") ? [1200, 600] : [800, 800];
      const b = publico(`${n}.png`);
      expect([b.readUInt32BE(16), b.readUInt32BE(20), b[25]], n).toEqual([w, h, 6]);
      expect(alfaEsquina(b), n).toBe(0);
      const svg = publico(`${n}.svg`).toString("utf8");
      expect(svg, n).toContain(`width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`);
      expect(svg, n).not.toMatch(/<text|<image|<rect width="100%"/);
      const colores = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map(m => m[1]));
      if (n.endsWith("-negro")) expect([...colores]).toEqual(["#191919"]);
      else if (n.endsWith("-blanco")) expect([...colores]).toEqual(["#ffffff"]);
      else expect(colores.has(n.endsWith("-oscuro") ? "#ff5cb3" : "#e93d9c"), n).toBe(true);
    }
  });
  it("las imágenes para anunciar el patrocinio miden lo que dicen y cambian con el tema y el idioma", () => {
    for (const [id, w, h] of SPONSOR_REDES) {
      for (const t of TEMAS_K) for (const l of LANGS_K) {
        const b = publico(`redes-${id}-${t}-${l}.png`);
        expect([b.readUInt32BE(16), b.readUInt32BE(20)], `${id} ${t} ${l}`).toEqual([w, h]);
      }
      expect(publico(`redes-${id}-claro-es.png`).equals(publico(`redes-${id}-oscuro-es.png`)), id).toBe(false);
      expect(publico(`redes-${id}-claro-es.png`).equals(publico(`redes-${id}-claro-en.png`)), id).toBe(false);
    }
  });
  it("el kit para sponsors es un ZIP liviano con los logos, las imágenes y los textos, y el kit completo no los duplica", () => {
    const b = publico("tinkazo-kit-sponsor.zip");
    expect(b.length).toBeLessThan(3_000_000);
    const zip = leerZip(b);
    expect(zip.size).toBe(SPONSOR_ZIP);
    const completo = leerZip(publico("tinkazo-kit-marca.zip"));
    const pares: Array<[string, string]> = [
      ...PARED.flatMap(n => ["svg", "png", "pdf", "2400.png"].map(e => { const f = e === "2400.png" ? `${n}-2400.png` : `${n}.${e}`; return [`logos/tinkazo-${f}`, f] as [string, string]; })),
      ...SPONSOR_REDES_ARCHIVOS.map(n => [`redes/tinkazo-${n}.png`, `${n}.png`] as [string, string]),
      ["tinkazo-textos-sponsor.txt", "textos-sponsor.txt"],
      ["tinkazo-preguntas-para-coordinar.txt", "preguntas-organizadores.txt"],
    ];
    for (const [ruta, archivo] of pares) {
      expect(zip.get(`tinkazo-kit-sponsor/${ruta}`)?.equals(publico(archivo)), ruta).toBe(true);
      expect(completo.get(`tinkazo-kit-marca/sponsor/${ruta}`), ruta).toBeUndefined();
    }
    expect(publico("tinkazo-kit-marca.zip").length).toBeLessThan(4 * 1024 * 1024);
    const leeme = completo.get("tinkazo-kit-marca/LEEME.txt")!.toString("utf8");
    for (const frag of ["tinkazo-kit-impresos.zip", "85x200", "100x200", "120x40", "@tinkazo.app", "https://www.instagram.com/tinkazo.app/", "15 cm", "tinkazo-kit-sponsor.zip"]) expect(leeme, frag).toContain(frag);
  });
  it("los textos para sponsors: los mismos en la página y en el archivo, del largo que dicen, en los dos idiomas", async () => {
    const { TEXTOS_SPONSOR, palabras } = await textosSponsor();
    const txt = publico("textos-sponsor.txt").toString("utf8");
    for (const lang of LANGS_K) {
      const t = TEXTOS_SPONSOR[lang];
      expect(T[lang].maSpD25).toBe(t.d25);
      expect(T[lang].maSpD50).toBe(t.d50);
      expect(T[lang].maSpD100).toBe(t.d100);
      t.posts.forEach((p, i) => expect(T[lang][`maSpPost${i + 1}`]).toBe(p));
      expect(T[lang].maSpNombre).toBe(t.nombre);
      expect(palabras(t.d25)).toBeLessThanOrEqual(25);
      // Los títulos prometen un largo exacto: quien organiza los pega en un formulario con tope.
      expect(palabras(t.d50)).toBe(50);
      expect(palabras(t.d100)).toBe(100);
      for (const p of t.posts) expect(p).toContain("@tinkazo.app");
      for (const s of [t.d25, t.d50, t.d100, ...t.posts, t.nombre, t.donde]) {
        expect(txt, s).toContain(s);
        expect(s).not.toMatch(/·|drand|hash|blockchain|Stellar|apost|casino|jackpot|suerte|!/i);
      }
    }
  });
  it("las imágenes de sponsor con los juegos: tres formatos en dos temas y dos idiomas, con fotos, en la página y fuera del ZIP", () => {
    const zip = leerZip(publico("tinkazo-kit-sponsor.zip"));
    const html = leer("marca.html");
    for (const [id, w, h] of SPONSOR_REDES.filter(([id]) => ["sponsor-post", "sponsor-historia", "sponsor-panoramica"].includes(id))) {
      for (const t of TEMAS_K) for (const l of LANGS_K) {
        const n = `redes-${id}-juegos-${t}-${l}.png`;
        const b = publico(n);
        expect([b.readUInt32BE(16), b.readUInt32BE(20)], n).toEqual([w, h]);
        // No es la misma imagen que la de los personajes, y con las capturas pesa más (hay fotos adentro).
        expect(b.equals(publico(`redes-${id}-${t}-${l}.png`)), n).toBe(false);
        expect(b.length, n).toBeGreaterThan(publico(`redes-${id}-${t}-${l}.png`).length);
        expect(b.length, n).toBeLessThan(500_000);
        expect([...zip.keys()].some(k => k.endsWith(n)), n).toBe(false);
      }
      expect(html, id).toContain(`/marca/redes-${id}-juegos-claro-{l}.png`);
      expect(html, id).toContain(`/marca/redes-${id}-juegos-oscuro-{l}.png`);
    }
  });
  it("en los roll-up el código QR mide de 31 a 34 cm de lado, para escanearlo desde unos 3 m", () => {
    for (const n of ["rollup-85x200", "rollup-100x200"]) for (const l of LANGS_K) {
      const svg = publico(`${n}-${l}.svg`).toString("utf8");
      const d = svg.match(/<path class="qr" d="([^"]+)"/)?.[1] ?? "";
      const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]));
      const xs = nums.filter((_, i) => i % 2 === 0);
      const lado = Math.max(...xs) - Math.min(...xs);
      expect(lado, `${n}-${l}`).toBeGreaterThanOrEqual(310);
      expect(lado, `${n}-${l}`).toBeLessThanOrEqual(340);
    }
  });
  it("los textos para redes van rotulados como sugeridos para los organizadores y no prometen sorteos ni stand", async () => {
    const { TEXTOS_SPONSOR } = await textosSponsor();
    const txt = publico("textos-sponsor.txt").toString("utf8");
    expect(txt).toContain("TEXTOS SUGERIDOS PARA QUE PUBLIQUEN LOS ORGANIZADORES");
    expect(txt).toContain("TEXTS SUGGESTED FOR THE ORGANIZERS TO PUBLISH");
    expect(T.es.maSpPostT).toContain("sugeridos para que publiquen los organizadores");
    expect(T.en.maSpPostT).toContain("suggested for the organizers to publish");
    for (const lang of LANGS_K) for (const p of TEXTOS_SPONSOR[lang].posts) {
      expect(p).not.toMatch(/stand|booth|los sorteos los hace|draws are run by|sorteos de hoy|today's draws/i);
    }
  });
  it("la página tiene la sección de sponsors y los impresos, con Instagram bien escrito y todo en es y en", () => {
    const html = leer("marca.html");
    expect(html).toContain('href="/marca/tinkazo-kit-sponsor.zip"');
    expect(html).toContain('id="sponsors"');
    expect(html).toContain('id="impresos"');
    expect(html).toContain('href="https://www.instagram.com/tinkazo.app/"');
    expect(html).not.toMatch(/tincaso|tinkaso|tincazo\.app/i);
    for (const n of PARED) expect(html, n).toContain(`/marca/${n}.png`);
    for (const [id] of SPONSOR_REDES) expect(html, id).toContain(`/marca/redes-${id}-`);
    for (const n of ["rollup-85x200", "rollup-100x200", "banner-mesa-120x40"]) for (const e of ["pdf", "svg"]) expect(html, n).toContain(`/marca/${n}-{l}.${e}`);
    // El logo y el afiche del evento viven solo en la sección de eventos (el bloque del DevFest Tarija enlaza a la
    // página oficial del evento): las piezas de Tinkazo para sponsors siguen sin logos de terceros.
    const sinDevfest = html.replace(/<section class="marca-eventos"[\s\S]*?<\/section>/, "");
    expect(sinDevfest).not.toMatch(/devfest[^"]*\.(svg|png|jpg|webp)|gdg[^"]*\.(svg|png|jpg|webp)/i);
    expect(html).toContain('href="https://gdg.community.dev/events/details/google-gdg-tarija-presents-devfest-tarija-2026/"');
    const claves = Object.keys(T.es).filter(k => /^ma(Sp|Imp)/.test(k));
    expect(claves.length).toBeGreaterThanOrEqual(50);
    for (const k of claves) {
      expect(html, k).toContain(`data-i="${k}"`);
      for (const lang of ["es", "en"] as const) {
        expect(T[lang][k], `${lang}.${k}`).toBeTruthy();
        expect(T[lang][k], `${lang}.${k}`).not.toMatch(/·|drand|hash|WebGL|bytes/i);
      }
      if (k !== "maImpRoll") expect(T.en[k], k).not.toBe(T.es[k]);
    }
    expect(leer("src/marca.ts")).toContain("data-copiar");
  });
});

describe("la frase de la marca en marca.html", () => {
  const html = leer("marca.html");
  it("está arriba, con la dirección, el lema, la línea de gratis y el botón de copiar", () => {
    expect(html).toContain('id="frase"');
    expect(html.indexOf('id="frase"')).toBeLessThan(html.indexOf('id="devfest"'));
    expect(html).toContain("tinkazo.app</p>");
    expect(html).toContain('data-i="maFrTitulo"');
    expect(html).toContain('data-i="maFrGratis"');
    expect(html).toContain('data-copiar="fr-copia"');
    expect(html).toContain('href="#frase"');
  });
  it("dice lo mismo en los dos idiomas y lo copiable trae el nombre, la dirección y la frase", () => {
    for (const l of ["es", "en"] as const) {
      const copia = T[l].maFrCopia as string;
      expect(copia).toContain("Tinkazo");
      expect(copia).toContain("tinkazo.app");
      expect(copia.toLowerCase()).toContain((T[l].maFrTitulo as string).toLowerCase().replace(/\.$/, ""));
      expect(copia).toContain(T[l].maFrGratis as string);
      expect(copia).not.toContain("·");
    }
    expect(T.es.maFrTitulo).toBe("Sorteos que cualquiera puede comprobar.");
    expect(T.en.maFrTitulo).toBe("Draws anyone can check.");
  });
});
