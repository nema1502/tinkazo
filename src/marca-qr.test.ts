import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { T } from "./i18n";

/**
 * Los QR clave de marca.html#qr (scripts/marca/qr-clave.mjs, archivos en public/marca/qr/): cada código lleva
 * exactamente a su destino, se lee a tamaño completo y reducido, y la página y el ZIP dicen lo mismo en los dos idiomas.
 */
const raiz = new URL("../public/marca/qr/", import.meta.url);
const enQr = (n: string): Buffer => readFileSync(new URL(n, raiz));
const leerHtml = (): string => readFileSync(new URL("../marca.html", import.meta.url), "utf8");

/** Lo que se espera de cada destino, escrito acá a mano: si alguien cambia una dirección, esta prueba tiene que enterarse. */
const ESPERADOS = {
  "tinkazo-app": "https://tinkazo.app/",
  "demo-carrera": "https://tinkazo.app/?demo=race",
  comprobar: "https://tinkazo.app/sorteo-verificable.html",
  juegos: "https://tinkazo.app/juegos.html",
  instagram: "https://www.instagram.com/tinkazo.app/",
} as const;
const EXTRAS = ["demo-carrera", "comprobar", "juegos", "instagram"] as const;
const FONDOS = ["blanco", "papel", "transparente"] as const;
const SOLOS = [
  ...FONDOS.map((f) => `qr-tinkazo-app-${f}`),
  ...EXTRAS.map((d) => `qr-${d}-blanco`),
];
const ETIQUETAS = ["qr-etiqueta-magenta.png", "qr-etiqueta-amarilla.png"];
const TARJETAS = ["cuadrada", "historia"].flatMap((f) => ["papel", "amarillo", "noche"].flatMap((fo) => ["es", "en"].map((l) => `qr-tarjeta-${f}-${fo}-${l}.png`)));

interface Img { w: number; h: number; d: Uint8ClampedArray; alfa0: number }

/** Un PNG de 8 bits (RGB o RGBA, sin entrelazar) a RGBA; lo transparente se compone sobre blanco, como lo ve quien lo pone sobre un fondo claro. */
function leerPng(b: Buffer): Img {
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const prof = b[24], tipo = b[25], entrelazado = b[28];
  if (prof !== 8 || (tipo !== 2 && tipo !== 6) || entrelazado !== 0) throw new Error("PNG no soportado");
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length;) {
    const n = b.readUInt32BE(o);
    if (b.toString("latin1", o + 4, o + 8) === "IDAT") idat.push(b.subarray(o + 8, o + 8 + n));
    o += n + 12;
  }
  const bpp = tipo === 6 ? 4 : 3, fila = w * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(h * fila);
  for (let y = 0; y < h; y++) {
    const filtro = raw[y * (fila + 1)]!, src = y * (fila + 1) + 1, dst = y * fila;
    for (let x = 0; x < fila; x++) {
      const a = x >= bpp ? px[dst + x - bpp]! : 0, arriba = y ? px[dst - fila + x]! : 0, c = x >= bpp && y ? px[dst - fila + x - bpp]! : 0;
      let v = raw[src + x]!;
      if (filtro === 1) v += a;
      else if (filtro === 2) v += arriba;
      else if (filtro === 3) v += (a + arriba) >> 1;
      else if (filtro === 4) { const p = a + arriba - c, pa = Math.abs(p - a), pb = Math.abs(p - arriba), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? arriba : c; }
      px[dst + x] = v & 255;
    }
  }
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    const alfa = bpp === 4 ? px[j + 3]! : 255;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round((px[j + k]! * alfa + 255 * (255 - alfa)) / 255);
    d[i * 4 + 3] = 255;
  }
  return { w, h, d, alfa0: bpp === 4 ? px[3]! : 255 };
}

/** Reduce una imagen a `ancho` de ancho promediando los píxeles que caen en cada uno (como lo haría un celular al achicarla). */
function reducir(img: Img, ancho: number): Img {
  const k = img.w / ancho, alto = Math.round(img.h / k);
  const out = new Uint8ClampedArray(ancho * alto * 4);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const x0 = Math.floor(x * k), x1 = Math.max(x0 + 1, Math.floor((x + 1) * k)), y0 = Math.floor(y * k), y1 = Math.max(y0 + 1, Math.floor((y + 1) * k));
      let r = 0, g = 0, bl = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.h; yy++) {
        for (let xx = x0; xx < x1 && xx < img.w; xx++) { const i = (yy * img.w + xx) * 4; r += img.d[i]!; g += img.d[i + 1]!; bl += img.d[i + 2]!; n++; }
      }
      const o = (y * ancho + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = bl / n; out[o + 3] = 255;
    }
  }
  return { w: ancho, h: alto, d: out, alfa0: 255 };
}

/** Lo que lee un lector, sin probar la imagen invertida: un QR claro sobre oscuro no se lee en muchos celulares. */
const leer = (img: Img): string | null => jsQR(img.d, img.w, img.h, { inversionAttempts: "dontInvert" })?.data ?? null;

/** Dibuja los módulos del SVG de un código solo (cada `M x yh w v1 h-w z` es una tira de módulos oscuros) a `px` píxeles por módulo. */
function rasterSvg(svg: string, px = 20): { img: Img; lado: number; tiras: Array<[number, number, number]> } {
  const lado = Number(svg.match(/viewBox="0 0 (\d+) \1"/)![1]);
  const tiras = [...svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]);
  const W = lado * px, d = new Uint8ClampedArray(W * W * 4).fill(255);
  for (const [x, y, w] of tiras) for (let yy = y * px; yy < (y + 1) * px; yy++) for (let xx = x * px; xx < (x + w) * px; xx++) d.set([0, 0, 0, 255], (yy * W + xx) * 4);
  return { img: { w: W, h: W, d, alfa0: 255 }, lado, tiras };
}

describe("QR clave: los destinos", () => {
  it("son exactamente los esperados: empiezan con https://tinkazo.app/ (salvo Instagram) y no llevan rastreo", async () => {
    const m = await import(/* @vite-ignore */ new URL("../scripts/marca/qr-clave.mjs", import.meta.url).href) as { DESTINOS: Array<{ id: string; url: string; principal?: boolean }> };
    expect(Object.fromEntries(m.DESTINOS.map((d) => [d.id, d.url]))).toEqual(ESPERADOS);
    expect(m.DESTINOS[0]!.id).toBe("tinkazo-app");
    expect(m.DESTINOS.filter((d) => d.principal).length).toBe(1);
    expect(m.DESTINOS.length - 1).toBeLessThanOrEqual(4); // el principal y, como mucho, cuatro más
    for (const d of m.DESTINOS) {
      if (d.id !== "instagram") expect(d.url.startsWith("https://tinkazo.app/"), d.id).toBe(true);
      expect(d.url, d.id).not.toMatch(/utm_|fbclid|gclid|[?&](ref|o|via|id|uid|user|email)=/i);
    }
    // La única consulta que lleva un destino es la de la demo, que nunca graba nada.
    expect(m.DESTINOS.filter((d) => d.url.includes("?")).map((d) => d.url)).toEqual(["https://tinkazo.app/?demo=race"]);
    // verificar.html sin un comprobante en la dirección dice «Este enlace no trae un sorteo»: no sirve de destino general.
    expect(m.DESTINOS.map((d) => d.url)).not.toContain("https://tinkazo.app/verificar.html");
    // Los destinos son páginas que existen en el sitio.
    for (const d of m.DESTINOS.filter((q) => q.id !== "instagram" && q.id !== "tinkazo-app")) {
      const camino = new URL(d.url).pathname.slice(1);
      if (camino) expect(existsSync(new URL(`../${camino}`, import.meta.url)), camino).toBe(true);
    }
  });
  it("la demo es ?demo=race: la carrera de llamas, que el sitio abre sin grabar nada", () => {
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).toContain('params.get("demo")');
    expect(main).toContain('GAMES.find((g) => g === mode) ?? "race"');
    expect(main).toMatch(/const GAMES: readonly Game\[\] = \[\.\.\.new Set<Game>\(\["race",/);
  });
});

describe("QR clave: los códigos solos", () => {
  it.each(SOLOS)("%s: el SVG decodifica a su destino, oscuro sobre claro y con el margen de 4 módulos", (nombre) => {
    const id = nombre.replace(/^qr-/, "").replace(/-(blanco|papel|transparente)$/, "") as keyof typeof ESPERADOS;
    const fondo = nombre.match(/-(blanco|papel|transparente)$/)![1]!;
    const svg = enQr(`${nombre}.svg`).toString("utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
    expect(svg).toContain(ESPERADOS[id]);
    expect(svg).toContain('fill="#191919"');
    expect(svg).not.toMatch(/<text|<tspan|font-family|<image|<script/);
    if (fondo === "transparente") expect(svg).not.toContain("<rect");
    else expect(svg).toContain(`<rect width="${svg.match(/viewBox="0 0 (\d+)/)![1]}" height="${svg.match(/viewBox="0 0 (\d+)/)![1]}" fill="${fondo === "blanco" ? "#ffffff" : "#fff6e9"}"/>`);
    const { img, lado, tiras } = rasterSvg(svg);
    // El margen de silencio: ningún módulo oscuro a menos de 4 módulos del borde.
    for (const [x, y, w] of tiras) {
      expect(x, nombre).toBeGreaterThanOrEqual(4);
      expect(y, nombre).toBeGreaterThanOrEqual(4);
      expect(x + w, nombre).toBeLessThanOrEqual(lado - 4);
      expect(y + 1, nombre).toBeLessThanOrEqual(lado - 4);
    }
    expect(leer(img), nombre).toBe(ESPERADOS[id]);
    expect(leer(reducir(img, 400)), `${nombre} a 400 px`).toBe(ESPERADOS[id]);
  }, 60_000);
  it.each(SOLOS)("%s: el PNG decodifica a su destino, a tamaño completo y a 400 px de ancho", (nombre) => {
    const id = nombre.replace(/^qr-/, "").replace(/-(blanco|papel|transparente)$/, "") as keyof typeof ESPERADOS;
    const fondo = nombre.match(/-(blanco|papel|transparente)$/)![1]!;
    const img = leerPng(enQr(`${nombre}.png`));
    expect(img.w).toBe(img.h);
    expect(img.w).toBeGreaterThanOrEqual(2000); // unos 2000 px: módulos de píxeles enteros, sin bordes suaves
    expect(img.w).toBeLessThanOrEqual(2048);
    // El fondo es el papel que dice el nombre, y el primer módulo del código es de tinta (#191919) a 4 módulos del borde.
    expect([...img.d.slice(0, 4)], nombre).toEqual(fondo === "papel" ? [255, 246, 233, 255] : [255, 255, 255, 255]);
    expect(img.alfa0, nombre).toBe(fondo === "transparente" ? 0 : 255);
    const lado = Number(readFileSync(new URL(`${nombre}.svg`, raiz), "utf8").match(/viewBox="0 0 (\d+)/)![1]);
    const escala = img.w / lado;
    expect(Number.isInteger(escala), nombre).toBe(true);
    const o = (4 * escala * img.w + 4 * escala) * 4;
    expect([...img.d.slice(o, o + 3)], nombre).toEqual([25, 25, 25]);
    expect(leer(img), `${nombre} completo`).toBe(ESPERADOS[id]);
    expect(leer(reducir(img, 400)), `${nombre} a 400 px`).toBe(ESPERADOS[id]);
  }, 60_000);
});

describe("QR clave: la etiqueta y las tarjetas", () => {
  it.each([...ETIQUETAS, ...TARJETAS])("%s lleva a tinkazo.app, a tamaño completo y a 400 px de ancho", (nombre) => {
    const img = leerPng(enQr(nombre));
    if (nombre.includes("etiqueta")) expect([img.w, img.h]).toEqual([2000, 2580]);
    else expect([img.w, img.h]).toEqual(nombre.includes("historia") ? [1080, 1920] : [1080, 1080]);
    expect(leer(img), `${nombre} completo`).toBe(ESPERADOS["tinkazo-app"]);
    expect(leer(reducir(img, 400)), `${nombre} a 400 px`).toBe(ESPERADOS["tinkazo-app"]);
  }, 60_000);
  it("la etiqueta tiene fondo transparente y las tarjetas no", () => {
    for (const n of ETIQUETAS) expect(leerPng(enQr(n)).alfa0, n).toBe(0);
    for (const n of TARJETAS) expect(leerPng(enQr(n)).alfa0, n).toBe(255);
  }, 60_000);
});

/** El ZIP: [nombre, bytes] por la lista central. */
function leerZip(b: Buffer): Map<string, Buffer> {
  const fin = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = b.readUInt16LE(fin + 10);
  let o = b.readUInt32LE(fin + 16);
  const m = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const metodo = b.readUInt16LE(o + 10), comp = b.readUInt32LE(o + 20), largo = b.readUInt16LE(o + 28), extra = b.readUInt16LE(o + 30), coment = b.readUInt16LE(o + 32), local = b.readUInt32LE(o + 42);
    const nombre = b.toString("utf8", o + 46, o + 46 + largo);
    const dato = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const cuerpo = b.subarray(dato, dato + comp);
    m.set(nombre, metodo === 8 ? inflateRawSync(cuerpo) : Buffer.from(cuerpo));
    o += 46 + largo + extra + coment;
  }
  return m;
}

describe("QR clave: el ZIP", () => {
  const bytes = enQr("tinkazo-qr.zip");
  const zip = leerZip(bytes);
  it("pesa menos de 4 MB y la página dice cuánto", () => {
    expect(bytes.length).toBeLessThan(4 * 1024 * 1024);
    for (const lang of ["es", "en"] as const) {
      const nota = String(T[lang].maQrZipNota);
      const mb = Number(nota.match(/(\d+)[,.](\d) MB/)!.slice(1, 3).join("."));
      expect(Math.abs(mb - bytes.length / 1e6), `${lang}: ${nota}`).toBeLessThan(0.1);
    }
  });
  it("trae la etiqueta, las doce tarjetas, los códigos solos y un LEEME, y cada archivo es el de public/marca/qr", () => {
    const esperados = new Map<string, string>([["tinkazo-qr/LEEME.txt", ""]]);
    for (const n of ETIQUETAS) esperados.set(`tinkazo-qr/etiquetas/${n}`, n);
    for (const n of TARJETAS) esperados.set(`tinkazo-qr/tarjetas/${n}`, n);
    for (const n of SOLOS) for (const e of ["svg", "png"]) esperados.set(`tinkazo-qr/codigos/${n.startsWith("qr-tinkazo-app") ? "" : "mas-destinos/"}${n}.${e}`, `${n}.${e}`);
    expect([...zip.keys()].sort()).toEqual([...esperados.keys()].sort());
    for (const [ruta, archivo] of esperados) if (archivo) expect(zip.get(ruta)!.equals(enQr(archivo)), ruta).toBe(true);
  });
  it("el LEEME está en español y en inglés, con cada destino, el tamaño mínimo y las reglas, y sin punto medio", () => {
    const leeme = zip.get("tinkazo-qr/LEEME.txt")!.toString("utf8").replace(/\r\n/g, "\n");
    expect(leeme).toContain("TINKAZO, QR PARA TU ARTE");
    expect(leeme).toContain("TINKAZO, QR CODES FOR YOUR ARTWORK");
    // Una vez por idioma (la dirección entera, no como comienzo de otra: tinkazo.app/ empieza todas las demás).
    for (const url of Object.values(ESPERADOS)) expect((leeme.match(new RegExp(`${url.replace(/[.?/]/g, "\\$&")}(?=\\s|$)`, "g")) ?? []).length, url).toBe(2);
    expect(leeme).not.toContain("verificar.html");
    for (const f of ["2 cm", "3 cm", "Corrección de errores nivel Q", "Error correction level Q", "REGLAS PARA QUE SIEMPRE LEA", "RULES SO IT ALWAYS READS", "#191919", "#fff6e9"]) expect(leeme, f).toContain(f);
    expect(leeme).not.toMatch(/·|apuest|casino|rifa/i);
    // Como todo lo que se lee en el sitio y en sus descargas: sin comillas angulares ni punto y coma, y la dirección sin comillas.
    expect(leeme).not.toMatch(/[«»;"]/);
    expect(leeme).toContain("la dirección tinkazo.app abajo");
    expect(leeme).toContain("the address tinkazo.app below");
  });
  it("regenerar los códigos solos y el ZIP deja los mismos bytes, y los SVG son los del repositorio", async () => {
    const m = await import(/* @vite-ignore */ new URL("../scripts/marca/qr-clave.mjs", import.meta.url).href) as { generarQrClave: (dir: URL) => { archivos: number; zip: number } };
    const hechos: Array<Map<string, Buffer>> = [];
    const base = mkdtempSync(join(tmpdir(), "tinkazo-qr-"));
    try {
      for (const corrida of ["a", "b"]) {
        const dir = join(base, corrida);
        mkdirSync(dir, { recursive: true });
        // Lo que se dibuja aparte (la etiqueta y las tarjetas) viaja tal cual: se copia para que el ZIP lo encuentre.
        for (const n of [...ETIQUETAS, ...TARJETAS]) copyFileSync(new URL(n, raiz), join(dir, n));
        m.generarQrClave(new URL(pathToFileURL(dir).href + "/"));
        hechos.push(new Map(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n))])));
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    const [a, b] = hechos as [Map<string, Buffer>, Map<string, Buffer>];
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [n, bytes2] of a) expect(b.get(n)!.equals(bytes2), n).toBe(true);
    const lf = (x: Buffer): string => x.toString("utf8").replace(/\r\n/g, "\n");
    // Lo binario (PNG y ZIP) depende de la versión de zlib de cada equipo: se compara una corrida contra otra. El texto (SVG) es el mismo en cualquier equipo.
    for (const [n, bytes2] of a) if (n.endsWith(".svg")) expect(lf(bytes2), n).toBe(lf(enQr(n)));
  }, 60_000);
});

describe("QR clave: la página", () => {
  const html = leerHtml();
  const seccion = html.split('<section class="marca-qr" id="qr"')[1]!.split("</section>")[0]!;
  it("tiene su enlace en la barra y la sección va entre los impresos y los creadores", () => {
    expect(html).toContain('<a href="#qr" data-i="maIrQr">QR</a>');
    expect(html.indexOf('id="impresos"')).toBeLessThan(html.indexOf('id="qr"'));
    expect(html.indexOf('id="qr"')).toBeLessThan(html.indexOf('id="creadores"'));
    expect(html.indexOf('href="#impresos"')).toBeLessThan(html.indexOf('href="#qr"'));
    expect(html.indexOf('href="#qr"')).toBeLessThan(html.indexOf('href="#creadores"'));
    expect(readFileSync(new URL("./marca.css", import.meta.url), "utf8")).toMatch(/#qr, #creadores/);
  });
  it("muestra la etiqueta como principal, ofrece el ZIP y a lo sumo cuatro destinos más, y todo existe", () => {
    expect(seccion).toContain('href="/marca/qr/tinkazo-qr.zip"');
    expect(seccion.indexOf("qr-etiqueta-magenta.png")).toBeGreaterThan(-1);
    expect(seccion.indexOf("qr-etiqueta-magenta.png")).toBeLessThan(seccion.indexOf("qr-tarjeta-cuadrada-papel"));
    expect(seccion.indexOf("qr-tarjeta-cuadrada-papel")).toBeLessThan(seccion.indexOf('class="marca-qr-extra"'));
    expect(seccion.split('class="marca-qr-extra"').length - 1).toBe(4);
    const rutas = [...seccion.matchAll(/(?:href|src|data-href|data-src)="(\/marca\/qr\/[^"]+)"/g)].map((m) => m[1]!);
    expect(rutas.length).toBeGreaterThan(30);
    for (const ruta of rutas) {
      const variantes = ruta.includes("{l}") ? ["es", "en"].map((l) => ruta.replaceAll("{l}", l)) : [ruta];
      for (const v of variantes) expect(existsSync(new URL(`..${v.replace("/marca/", "/public/marca/")}`, import.meta.url)), v).toBe(true);
    }
    // Cada archivo de public/marca/qr (menos las vistas) se puede bajar desde la página, y las doce tarjetas, en los dos idiomas.
    for (const n of [...ETIQUETAS, ...SOLOS.flatMap((s) => [`${s}.svg`, `${s}.png`]), "tinkazo-qr.zip"]) expect(seccion, n).toContain(`/marca/qr/${n}`);
    for (const f of ["cuadrada", "historia"]) for (const fo of ["papel", "amarillo", "noche"]) expect(seccion, `${f} ${fo}`).toContain(`/marca/qr/qr-tarjeta-${f}-${fo}-{l}.png`);
    // Y no sobra nada: la carpeta tiene las etiquetas, las tarjetas, los códigos solos (SVG y PNG) y el ZIP.
    expect(readdirSync(raiz).length).toBe(ETIQUETAS.length + TARJETAS.length + SOLOS.length * 2 + 1);
  });
  it("cada imagen tiene alt traducible y medidas, y cada botón de descarga dice de qué es", () => {
    const imgs = [...seccion.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBe(2 + 3 + 4);
    for (const i of imgs) {
      expect(i, i).toMatch(/ alt="[^"]{12,}"/);
      expect(i, i).toMatch(/ data-i-alt="maQr\w+"/);
      expect(i, i).toMatch(/ width="\d+" height="\d+"/);
      // El alt del markup es el del diccionario en español: el mismo texto antes y después de traducir.
      expect(i.match(/ alt="([^"]+)"/)![1], i).toBe(T.es[i.match(/ data-i-alt="([^"]+)"/)![1]!]);
    }
    const ids = new Set([...seccion.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!));
    const enlaces = [...seccion.matchAll(/<a [^>]*download=[^>]*>/g)].map((m) => m[0]);
    expect(enlaces.length).toBe(1 + 2 + 6 + 6 + 8); // el ZIP, las etiquetas, los solos, las tarjetas y los otros destinos
    for (const a of enlaces) {
      expect(a, a).toMatch(/aria-describedby="([^"]+)"/);
      expect(ids.has(a.match(/aria-describedby="([^"]+)"/)![1]!), a).toBe(true);
    }
  });
  it("cada texto nuevo está en español y en inglés, en la página, sin punto medio ni tecnicismos", () => {
    const claves = Object.keys(T.es).filter((k) => /^maQr|^maIrQr$/.test(k));
    expect(claves.length).toBeGreaterThanOrEqual(45);
    expect(Object.keys(T.en).filter((k) => /^maQr|^maIrQr$/.test(k)).sort()).toEqual([...claves].sort());
    for (const k of claves) {
      expect(html, k).toMatch(new RegExp(`data-i(?:-alt)?="${k}"`));
      for (const lang of ["es", "en"] as const) {
        const t = String(T[lang][k]);
        expect(t, `${lang}.${k}`).toBeTruthy();
        expect(t, `${lang}.${k}`).not.toMatch(/·|drand|hash|WebGL|Worker|bytes|blockchain|corrección de errores|error correction|rifa|raffle|apuest|casino/i);
      }
      if (k !== "maIrQr") expect(T.en[k], k).not.toBe(T.es[k]);
    }
    expect(T.es.maQrT).toBe("QR para tu arte");
    expect(T.en.maQrT).toBe("QR codes for your artwork");
    // La etiqueta principal lleva el nombre que lleva en la tarjeta: «Armá tu sorteo» y «Make your draw».
    expect(T.es.maQrEtT).toBe("Armá tu sorteo");
    expect(T.en.maQrEtT).toBe("Make your draw");
    // El tamaño mínimo se dice igual en la página y en el LEEME.
    expect(T.es.maQrR1).toContain("2 cm");
    expect(T.es.maQrR1).toContain("3 cm");
    expect(T.en.maQrR1).toContain("2 cm");
    expect(T.en.maQrR1).toContain("3 cm");
  });
  it("la página dice, por cada destino, a dónde lleva, con el camino corto y sin parámetros de rastreo", () => {
    // El <wbr> deja partir la dirección después de la barra en una pantalla angosta; el texto es el mismo.
    const caminos = [...seccion.matchAll(/<code>(.*?)<\/code>/g)].map((m) => m[1]!.replace(/<wbr>/g, ""));
    expect(caminos).toEqual(["tinkazo.app/?demo=race", "tinkazo.app/sorteo-verificable.html", "tinkazo.app/juegos.html", "instagram.com/tinkazo.app"]);
    for (const c of caminos) expect(c, c).not.toMatch(/https?:|utm_|ref=/);
  });
});
