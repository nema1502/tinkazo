import { readFileSync, readdirSync, existsSync } from "node:fs";
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
      expect(Object.keys(textos![lang]!).length).toBeLessThan(200);
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
    expect(leeme).toContain("Stickers: archivos a tamaño real con 3 mm de sangrado; la capa 'corte' es la línea de corte; imprimir en vinilo mate; los colores son RGB, la imprenta los convierte");
    expect(leeme).toContain("Stickers: true-size files with 3 mm bleed; the 'corte' layer is the cut line; print on matte vinyl; colors are RGB, the printer converts them");
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
    const listar = (): string[] => readdirSync(dir).sort();
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
    expect(zip.size).toBe(27 + 114);
    const leeme = zip.get("tinkazo-kit-marca/LEEME.txt")!.toString("utf8");
    for (const frag of ["tinkazo-kit-portada.png", "stickers/hojas/", "redes/", "afiches/", "Escaneá y comprobá", "Scan and check", "1200x630", "1584x396", "A3", "https://tinkazo.app/sorteo-para-meetup.html#comprobacion"]) expect(leeme, frag).toContain(frag);
  });
  it("ningún SVG de public/marca trae texto: todo son trazos", () => {
    const todos = svgsDe("../public/marca/");
    expect(todos.length).toBe(56);
    for (const n of todos) {
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
