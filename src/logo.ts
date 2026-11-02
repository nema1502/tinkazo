import { sha256 } from "@noble/hashes/sha2.js";

/**
 * El logo de la comunidad, primera versión.
 *
 * Quien organiza sube una imagen; el navegador la redibuja sobre una placa
 * (sin SVG, sin metadatos, sin transparencia) y queda en ese navegador. No hay
 * servidor ni cuenta: la imagen viaja cifrada dentro del enlace corto
 * (`enlace-corto.ts`). No es parte del sorteo: no entra en la huella de la
 * lista, ni en la cadena, ni en el comprobante, y no decide quién gana.
 *
 * Este archivo no importa `i18n` ni toca la página: lo usa también la página de
 * comprobar, y sus pruebas corren en Node. La conversión (que necesita el
 * navegador) está al final; lo de arriba es puro.
 *
 * Lo que llega de un enlace no es de fiar (lo armó cualquiera): `validarLogo`
 * es la única barrera, porque el sitio no tiene una política de contenido. Se
 * corre sin red y antes de decodificar nada.
 */

/** Lo que viaja y se guarda: el tipo y los bytes en base64 común. */
export interface Logo {
  t: "image/webp" | "image/png";
  b: string;
}

/** Un logo ya validado, con el tamaño que dice su cabecera. */
export interface LogoLeido {
  logo: Logo;
  w: number;
  h: number;
}

/** Lo más que pesa la imagen, en bytes. Con esto, a la ruta le quedan unos 196 KB de los 256 KB del enlace corto. */
export const LOGO_MAX_BYTES = 48 * 1024;
/** El ancho de la placa y el alto máximo, en píxeles. */
export const LOGO_LADO = 256;
/** El alto mínimo de la placa: un logo apaisado no queda diminuto en un cuadrado. */
export const LOGO_ALTO_MIN = 128;
/** Lo más que pesa lo que se sube, antes de achicarlo. */
export const SUBIDA_MAX_BYTES = 10 * 1024 * 1024;
/** Lo más largo que se dibuja para medir los márgenes de lo que se sube. */
const TRABAJO_MAX = 1024;

/** La placa clara y la oscura (la del fondo del sitio, `#171126`). */
export const PLACA = { clara: "#ffffff", oscura: "#171126" } as const;
export type Placa = keyof typeof PLACA;

/* ------------------------------------------------------------- base64 y huella */

/** Bytes a base64 común (con relleno). */
export function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Base64 común a bytes, o null si no es base64 válido. */
export function deBase64(b: string): Uint8Array<ArrayBuffer> | null {
  if (b.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b)) return null;
  try {
    return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array): string => aBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * La huella del logo: 16 bytes del `sha256` de los bytes finales, en base64url
 * (22 letras). No entra en nada que se selle: solo nombra al logo en este
 * navegador (`Frozen.logo`, `Entry.logo`) y en la llave del enlace corto.
 */
export function huellaLogo(logo: Logo): string {
  const bytes = deBase64(logo.b) ?? new TextEncoder().encode(logo.b);
  return b64url(sha256(bytes).subarray(0, 16));
}

/* ------------------------------------------------------------- validar */

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (b: Uint8Array, desde: number, n: number): string => String.fromCharCode(...b.subarray(desde, desde + n));
const u32be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) * 0x1000000) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const u24le = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);

/**
 * El ancho y el alto que dice la cabecera, sin decodificar: `IHDR` en un PNG;
 * `VP8 `, `VP8L` o `VP8X` en un WebP. Null si no se pueden leer. Esto corta una
 * bomba de descompresión antes de que el navegador la abra.
 */
export function medidasDeCabecera(bytes: Uint8Array, tipo: Logo["t"]): { w: number; h: number } | null {
  if (tipo === "image/png") {
    if (bytes.length < 33 || !PNG.every((v, i) => bytes[i] === v)) return null;
    if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
    return { w: u32be(bytes, 16), h: u32be(bytes, 20) };
  }
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const trozo = ascii(bytes, 12, 4);
  if (trozo === "VP8X") return { w: u24le(bytes, 24) + 1, h: u24le(bytes, 27) + 1 };
  if (trozo === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = ((bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (trozo === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { w: ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff, h: ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff };
  }
  return null;
}

/**
 * Revisa un logo que llegó de afuera, sin red y antes de dibujar:
 * 1. el tipo es `image/webp` o `image/png`, y la base64 es válida;
 * 2. pesa hasta 48 KB;
 * 3. los primeros bytes coinciden con el tipo;
 * 4. el ancho y el alto de la cabecera existen, llegan a 256 píxeles y no pasan de 2:1.
 * Devuelve el logo limpio (solo `t` y `b`, nada más de lo que traía) y sus
 * medidas, o null.
 */
export function validarLogo(x: unknown): LogoLeido | null {
  if (!x || typeof x !== "object") return null;
  const { t, b } = x as { t?: unknown; b?: unknown };
  if (t !== "image/webp" && t !== "image/png") return null;
  if (typeof b !== "string" || b.length === 0 || b.length > Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 4) return null;
  const bytes = deBase64(b);
  if (!bytes || bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) return null;
  const m = medidasDeCabecera(bytes, t);
  if (!m || m.w < 1 || m.h < 1 || m.w > LOGO_LADO || m.h > LOGO_LADO) return null;
  // La placa que arma `encajarLogo` va de 1:1 a 2:1. Una tira de 256 x 1 es un logo armado a mano: estira la foto y tapa la marca.
  if (m.w > 2 * m.h + 1 || m.h > 2 * m.w + 1) return null;
  return { logo: { t, b }, w: m.w, h: m.h };
}

/* ------------------------------------------------------------- geometría de la conversión */

/** Un rectángulo en píxeles. */
export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Los márgenes vacíos de lo que se subió. Un píxel está vacío si es casi
 * transparente o, en una imagen opaca, si se parece al color de las esquinas
 * (el fondo liso de un JPG). Devuelve la caja de lo que no está vacío, con un
 * poco de aire, o la imagen entera si no hay nada o casi todo está lleno.
 * `rgba` son los píxeles de `getImageData`.
 */
export function recortarMargenes(rgba: Uint8ClampedArray, w: number, h: number): Caja {
  const entera: Caja = { x: 0, y: 0, w, h };
  if (w < 2 || h < 2 || rgba.length < w * h * 4) return entera;
  const px = (x: number, y: number): [number, number, number, number] => {
    const i = (y * w + x) * 4;
    return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0, rgba[i + 3] ?? 0];
  };
  let transparentes = 0;
  for (let i = 3; i < rgba.length; i += 4) if ((rgba[i] ?? 0) < 16) transparentes++;
  const conAlfa = transparentes / (w * h) > 0.02;
  // El fondo liso: el color mediano de las cuatro esquinas, solo si la imagen es opaca.
  const esquinas = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const med = (k: 0 | 1 | 2): number => [...esquinas.map((p) => p[k])].sort((a, b) => a - b)[1] ?? 0;
  const fondo = [med(0), med(1), med(2)];
  const vacio = (x: number, y: number): boolean => {
    const p = px(x, y);
    if (p[3] < 16) return true;
    if (conAlfa) return false;
    return Math.abs(p[0] - (fondo[0] ?? 0)) <= 24 && Math.abs(p[1] - (fondo[1] ?? 0)) <= 24 && Math.abs(p[2] - (fondo[2] ?? 0)) <= 24;
  };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (vacio(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return entera;
  const aire = Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 0.02);
  const x = Math.max(0, x0 - aire), y = Math.max(0, y0 - aire);
  return { x, y, w: Math.min(w, x1 + aire + 1) - x, h: Math.min(h, y1 + aire + 1) - y };
}

/**
 * La placa de un logo con transparencia o sin ella. Con transparencia, si lo
 * que se ve es casi todo claro (luminancia media de los píxeles opacos sobre
 * 0,8), un logo blanco sobre blanco desaparecería: va sobre la oscura. Sin
 * transparencia (un JPG), la placa solo rellena los costados: sigue al borde de
 * la imagen, clara si el borde es claro.
 */
export function elegirPlaca(rgba: Uint8ClampedArray, w: number, h: number): Placa {
  const lum = (i: number): number => (0.2126 * (rgba[i] ?? 0) + 0.7152 * (rgba[i + 1] ?? 0) + 0.0722 * (rgba[i + 2] ?? 0)) / 255;
  let opacos = 0, suma = 0, transparentes = 0, borde = 0, sumaBorde = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if ((rgba[i + 3] ?? 0) < 16) {
        transparentes++;
        continue;
      }
      if ((rgba[i + 3] ?? 0) < 128) continue;
      opacos++;
      const l = lum(i);
      suma += l;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        borde++;
        sumaBorde += l;
      }
    }
  }
  if (opacos === 0) return "clara";
  if (transparentes / (w * h) <= 0.02) return borde > 0 && sumaBorde / borde < 0.5 ? "oscura" : "clara";
  return suma / opacos > 0.8 ? "oscura" : "clara";
}

/**
 * Dónde cae el logo en la placa. El ancho de la placa es 256; el alto va de 128
 * a 256 según la forma del logo, para que uno apaisado no quede diminuto en un
 * cuadrado; uno más apaisado que 2:1 lleva relleno arriba y abajo. `lado` es
 * el ancho de la placa (256, o menos si hubo que achicarla para que pese poco).
 */
export function encajarLogo(w: number, h: number, lado = LOGO_LADO): { ancho: number; alto: number; dx: number; dy: number; dw: number; dh: number } {
  const forma = Math.max(1e-6, w) / Math.max(1, h);
  const ancho = lado;
  const alto = Math.round(Math.min(lado, Math.max(lado / 2, lado / forma)));
  const margen = Math.round(lado * 0.06);
  const libreW = ancho - 2 * margen, libreH = alto - 2 * margen;
  const e = Math.min(libreW / Math.max(1, w), libreH / Math.max(1, h));
  const dw = Math.max(1, Math.round(w * e)), dh = Math.max(1, Math.round(h * e));
  return { ancho, alto, dx: Math.round((ancho - dw) / 2), dy: Math.round((alto - dh) / 2), dw, dh };
}

/** Los intentos de la exportación, del mejor al más chico: ancho de la placa y calidad. */
export const INTENTOS: ReadonlyArray<readonly [number, number]> = [
  [256, 0.85], [256, 0.7], [256, 0.55],
  [192, 0.8], [192, 0.6],
  [128, 0.8], [128, 0.55],
  [96, 0.7],
];

/* ------------------------------------------------------------- la conversión (navegador) */

/** Por qué no se pudo: la interfaz lo traduce. */
export class LogoError extends Error {
  constructor(readonly motivo: "no-abre" | "pesa" | "grande") {
    super(`logo-${motivo}`);
  }
}

function lienzo(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const aBlob = (c: HTMLCanvasElement, tipo: string, q?: number): Promise<Blob | null> => new Promise((r) => c.toBlob(r, tipo, q));

/**
 * Lo que sube la persona, redibujado sobre una placa y exportado a WebP (o PNG
 * si el navegador no sabe WebP). El lienzo descarta los metadatos, también el
 * GPS; un GIF o un WebP animado quedan en su primer cuadro; el SVG, el HEIC y
 * un archivo roto no se abren. Tira `LogoError`.
 *
 * `placa` fuerza el fondo ("Cambiar el fondo"); sin él, lo elige `elegirPlaca`.
 */
export async function convertirLogo(archivo: Blob, placa?: Placa): Promise<LogoLeido & { placa: Placa }> {
  if (archivo.size > SUBIDA_MAX_BYTES) throw new LogoError("grande");
  if (/svg/i.test(archivo.type)) throw new LogoError("no-abre");
  let mapa: ImageBitmap;
  try {
    mapa = await createImageBitmap(archivo);
  } catch {
    throw new LogoError("no-abre");
  }
  try {
    return await desdeImagen(mapa, mapa.width, mapa.height, placa);
  } finally {
    mapa.close();
  }
}

/** La conversión desde algo ya decodificado (también lo usa el logo de prueba). */
export async function desdeImagen(fuente: CanvasImageSource, w: number, h: number, placa?: Placa): Promise<LogoLeido & { placa: Placa }> {
  if (w < 1 || h < 1) throw new LogoError("no-abre");
  // 1. A una medida de trabajo, para no leer los píxeles de una foto de 50 megas.
  const e = Math.min(1, TRABAJO_MAX / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * e)), th = Math.max(1, Math.round(h * e));
  const trabajo = lienzo(tw, th);
  const tc = trabajo.getContext("2d", { willReadFrequently: true });
  if (!tc) throw new LogoError("no-abre");
  tc.drawImage(fuente, 0, 0, tw, th);
  const datos = tc.getImageData(0, 0, tw, th).data;
  // 2. Fuera los márgenes vacíos, y 3. la placa que se ve.
  const caja = recortarMargenes(datos, tw, th);
  const elegida = placa ?? elegirPlaca(datos, tw, th);
  // 4. Encajar y aplanar sobre la placa, achicando hasta que pese poco.
  for (const [lado, calidad] of INTENTOS) {
    const g = encajarLogo(caja.w, caja.h, lado);
    const sal = lienzo(g.ancho, g.alto);
    const c = sal.getContext("2d");
    if (!c) throw new LogoError("no-abre");
    c.fillStyle = PLACA[elegida];
    c.fillRect(0, 0, g.ancho, g.alto);
    c.imageSmoothingQuality = "high";
    c.drawImage(trabajo, caja.x, caja.y, caja.w, caja.h, g.dx, g.dy, g.dw, g.dh);
    const blob = (await aBlob(sal, "image/webp", calidad)) ?? (await aBlob(sal, "image/png"));
    if (!blob) throw new LogoError("no-abre");
    // Safari no sabe WebP y devuelve PNG: se mira lo que salió.
    const tipo = blob.type === "image/webp" ? "image/webp" : "image/png";
    if (blob.size > LOGO_MAX_BYTES) continue;
    const logo: Logo = { t: tipo, b: aBase64(new Uint8Array(await blob.arrayBuffer())) };
    const ok = validarLogo(logo);
    if (ok) return { ...ok, placa: elegida };
  }
  throw new LogoError("pesa");
}

/* ------------------------------------------------------------- dibujar uno ya validado */

const decodificados = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * El logo en un lienzo, para mostrarlo o pegarlo en la foto. Se valida antes
 * (`validarLogo`) y se dibuja en un `<canvas>`: queda el primer cuadro, así que
 * un PNG animado o un WebP animado no parpadean, y nunca va a un `innerHTML`.
 * Null si no es un logo o el navegador no lo abre.
 */
export function logoALienzo(logo: Logo): Promise<HTMLCanvasElement | null> {
  const clave = huellaLogo(logo);
  const ya = decodificados.get(clave);
  if (ya) return ya;
  const p = (async (): Promise<HTMLCanvasElement | null> => {
    const ok = validarLogo(logo);
    const bytes = ok ? deBase64(ok.logo.b) : null;
    if (!ok || !bytes) return null;
    try {
      const mapa = await createImageBitmap(new Blob([bytes], { type: ok.logo.t }));
      try {
        const c = lienzo(ok.w, ok.h);
        c.getContext("2d")?.drawImage(mapa, 0, 0, ok.w, ok.h);
        return c;
      } finally {
        mapa.close();
      }
    } catch {
      return null;
    }
  })();
  decodificados.set(clave, p);
  // Lo que no se pudo abrir no se recuerda: otra vez puede salir (un fallo del navegador no es del logo).
  void p.then((c) => {
    if (!c) decodificados.delete(clave);
  });
  return p;
}
