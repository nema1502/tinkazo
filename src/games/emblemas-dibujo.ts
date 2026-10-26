/**
 * El dibujo de los emblemas: la ficha (aro de color, papel y dibujo) en HTML,
 * en un lienzo o como textura de PixiJS.
 *
 * Los dibujos son imágenes SVG incrustadas en el sitio, no emoji del sistema:
 * se ven igual en todos los navegadores, con el wifi del evento caído y en los
 * auditores. Viven en una sola hoja (`emblemas/hoja.svg`, un <symbol> por
 * clave) que se arma con `scripts/emblemas-hoja.mjs`. Cambiar el set
 * provisorio por el definitivo es cambiar esa hoja: las claves son las mismas.
 *
 * **Hay que esperar `cargarEmblemas()` antes de arrancar el juego.** Una
 * imagen se decodifica cuando el navegador quiere, y los primeros cuadros de
 * cada ficha salían sin cara (lo mismo que `avatar.ts` evita). Con la promesa
 * resuelta todo lo de acá es síncrono y sale idéntico desde el primer cuadro.
 *
 * La ficha mide 40 unidades de lado: borde de tinta, aro del color de la
 * persona, papel teñido de ese color y el dibujo ocupando casi todo. La
 * silueta es lo principal y el color, lo secundario; por eso el dibujo es
 * oscuro o saturado sobre un papel claro, en tema claro y en tema oscuro.
 */
import type { ClaveEmblema, Emblema } from "./emblemas";

const TINTA = "#191919";
const BLANCO = "#ffffff";

/** El lado de la ficha, en unidades. */
const L = 40;
/** El borde de tinta, el aro y el margen del dibujo, en unidades, medidos desde el borde. */
const BORDE = 1;
const ARO = 3.4;
const DIBUJO = 4.6;
const RADIO = 8;

/** Mezcla un color con blanco: `t` es cuánto blanco (0 es el color, 1 es blanco). */
export function aclarar(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): string => Math.round(v + (255 - v) * t).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** El papel de la ficha: el color de la persona, muy claro. */
export const papelDe = (color: string): string => aclarar(color, 0.86);

let simbolos: Map<ClaveEmblema, string> | null = null;
const imagenes = new Map<ClaveEmblema, HTMLImageElement>();
let promesa: Promise<void> | null = null;

/** Saca los <symbol> de la hoja: clave y su interior. */
export function simbolosDe(hoja: string): Map<ClaveEmblema, string> {
  const res = new Map<ClaveEmblema, string>();
  for (const m of hoja.matchAll(/<symbol id="([a-z]+)" viewBox="0 0 36 36">([\s\S]*?)<\/symbol>/g)) {
    res.set(m[1] as ClaveEmblema, m[2] as string);
  }
  return res;
}

const svgSuelto = (interior: string, lado: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="${lado}" height="${lado}">${interior}</svg>`;

const urlDe = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/**
 * Carga la hoja y deja decodificadas las imágenes de los treinta y dos
 * dibujos. Se puede llamar muchas veces. La hoja viaja en su propio archivo:
 * no pesa en la carga del sitio, solo cuando un juego la pide.
 */
export function cargarEmblemas(): Promise<void> {
  promesa ??= import("./emblemas/hoja.svg?raw").then(async (m) => {
    const mapa = simbolosDe(m.default);
    if (typeof Image !== "undefined") {
      await Promise.all(
        [...mapa].map(async ([clave, interior]) => {
          const img = new Image();
          img.src = urlDe(svgSuelto(interior, 144));
          await img.decode();
          imagenes.set(clave, img);
        }),
      );
    }
    simbolos = mapa;
  });
  return promesa;
}

/** ¿Ya se puede dibujar de forma síncrona? */
export const emblemasListos = (): boolean => simbolos !== null;

/** Para las pruebas y para quien ya tiene la hoja en la mano: carga los símbolos sin imágenes. */
export function cargarHoja(hoja: string): void {
  simbolos = simbolosDe(hoja);
}

const rr = (x: number, y: number, w: number, h: number, r: number): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

/**
 * La ficha entera como un SVG suelto, lista para el `src` de una imagen o
 * para meter en el HTML. Es para la interfaz; en un lienzo, `dibujarEmblema`.
 */
export function emblemaSvg(e: Emblema, lado: number): string {
  const interior = simbolos?.get(e.clave) ?? "";
  const a = BORDE + ARO;
  const d = DIBUJO;
  const caja = L - 2 * d;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L} ${L}" width="${lado}" height="${lado}" data-emblema="${e.clave}">` +
    `<g fill="${TINTA}">${rr(0, 0, L, L, RADIO)}</g>` +
    `<g fill="${e.color}">${rr(BORDE, BORDE, L - 2 * BORDE, L - 2 * BORDE, RADIO - BORDE)}</g>` +
    `<g fill="${papelDe(e.color)}">${rr(a, a, L - 2 * a, L - 2 * a, RADIO - a + 1)}</g>` +
    `<svg x="${d}" y="${d}" width="${caja}" height="${caja}" viewBox="0 0 36 36">${interior}</svg>` +
    `</svg>`
  );
}

const urls = new Map<string, string>();

/** La ficha como dirección `data:`, con memoria. */
export function emblemaUrl(e: Emblema, lado: number): string {
  const k = `${e.clave}|${e.color}|${lado}`;
  let u = urls.get(k);
  if (!u) {
    u = urlDe(emblemaSvg(e, lado));
    urls.set(k, u);
  }
  return u;
}

/**
 * Pinta la ficha en un lienzo, en el cuadro que empieza en `x, y`. Las
 * medidas van al píxel entero, como `drawAvatar`, para que dos fichas vecinas
 * no dejen una raya entre sí.
 */
export function dibujarEmblema(c: CanvasRenderingContext2D, e: Emblema, x: number, y: number, lado: number): void {
  const k = lado / L;
  const px = (v: number): number => Math.round(v);
  const caja = (inset: number, relleno: string, radio: number): void => {
    const x0 = px(x + inset * k), y0 = px(y + inset * k);
    const w = px(x + (L - inset) * k) - x0;
    const h = px(y + (L - inset) * k) - y0;
    c.fillStyle = relleno;
    c.beginPath();
    c.roundRect(x0, y0, w, h, Math.max(0, radio * k));
    c.fill();
  };
  const a = BORDE + ARO;
  caja(0, TINTA, RADIO);
  caja(BORDE, e.color, RADIO - BORDE);
  caja(a, papelDe(e.color), RADIO - a + 1);
  const img = imagenes.get(e.clave);
  if (img) {
    const x0 = px(x + DIBUJO * k), y0 = px(y + DIBUJO * k);
    const d = px(x + (L - DIBUJO) * k) - x0;
    c.drawImage(img, x0, y0, d, d);
  }
}

const lienzos = new Map<string, HTMLCanvasElement>();

/**
 * Un lienzo cuadrado con la ficha, con memoria: para pasarlo a textura de
 * PixiJS (potencia de dos y con mipmaps) o a un `drawImage`.
 */
export function emblemaCanvas(e: Emblema, lado: number): HTMLCanvasElement {
  const k = `${e.clave}|${e.color}|${lado}`;
  let cv = lienzos.get(k);
  if (!cv) {
    cv = document.createElement("canvas");
    cv.width = cv.height = lado;
    const cx = cv.getContext("2d");
    if (cx) dibujarEmblema(cx, e, 0, 0, lado);
    lienzos.set(k, cv);
  }
  return cv;
}
