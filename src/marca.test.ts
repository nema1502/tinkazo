import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
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
    expect([...zip.keys()].sort()).toEqual(esperados.sort());
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
