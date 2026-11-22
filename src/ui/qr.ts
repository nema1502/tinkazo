/**
 * El QR del comprobante, generado acá.
 *
 * Antes se pedía a un servicio ajeno, y eso tenía dos problemas de fondo.
 *
 * El primero es de privacidad, y es el que importa. El comprobante viaja en el
 * fragmento de la URL justamente para que los nombres de los participantes no
 * lleguen ni a los registros del hosting. Mandar esa misma URL como parámetro
 * de consulta a otro servidor tiraba toda esa disciplina a la basura: los
 * nombres salían del navegador igual, solo que a otro lado.
 *
 * El segundo es práctico. El QR aparece en el momento del ganador, con la sala
 * mirando, y dependía del wifi del evento. Ahora se dibuja en el navegador y
 * funciona con la red caída.
 *
 * Se usa `qrcode-generator`, que es una implementación conocida y chica, en vez
 * de escribir una a mano: un QR mal armado falla en silencio y recién se
 * descubre cuando alguien no puede escanearlo.
 */

import { marcarQr } from "../contar";

/** Cuánto mide el QR chico en píxeles de CSS, como mínimo. */
const SIZE = 200;
/** Margen obligatorio alrededor, en módulos. Sin esto muchos lectores fallan. */
const QUIET = 4;
/** Hasta este largo, el enlace es corto y el QR lleva más corrección de errores. */
const CORTO = 80;

/**
 * Dibuja el QR del enlace y devuelve una imagen lista para `src`.
 *
 * Devuelve `null` si el enlace no entra en un QR, que pasa con listas muy
 * grandes. En ese caso quien llama debería esconder el recuadro en vez de
 * mostrar uno roto: el enlace de todos modos se puede copiar y compartir.
 */
export async function qrDataUrl(text: string): Promise<string | null> {
  return (await dibujar(text, SIZE))?.url ?? null;
}

/**
 * Pone el QR en la imagen al tamaño en que se dibujó, para que el navegador
 * no lo reescale. Reescalado, un comprobante largo perdía módulos: de 339 a
 * 140 px quedaba en 1,2 px por módulo y no lo leía ningún celular (revisión
 * del 16 de octubre de 2026). `ancho` es lo que se quiere ocupar, en px de CSS.
 */
export async function pintarQr(img: HTMLImageElement, text: string, ancho = SIZE, fijo = false): Promise<boolean> {
  if (fijo) return pintarQrFijo(img, text, ancho);
  const qr = await dibujar(text, ancho);
  if (!qr) return false;
  img.src = qr.url;
  img.style.width = img.style.height = `${qr.lado}px`;
  return true;
}

/** Lo menos que mide un módulo del QR fijo: en px de CSS al elegir el tamaño y en px del equipo al dibujarlo. */
const MODULO_FIJO_MIN = 3;

/**
 * Las medidas del QR de tamaño fijo, para un QR de `total` módulos (con su margen) en un espacio de `disponible` px de CSS.
 *
 * - El tamaño en pantalla (`lado`) es un número entero de px de CSS por módulo y NO mira la densidad de la pantalla: con
 *   el zoom o en otra pantalla el QR mide lo mismo.
 * - El lienzo se dibuja con `cell` px del equipo por módulo, que alcanza para la densidad de ahora (nunca menos de 3). Con una
 *   densidad entera es exacto: cada módulo cae en píxeles enteros y nada se reescala.
 */
export function medidasFijas(total: number, disponible: number, dpr: number): { modulo: number; lado: number; cell: number } {
  const modulo = Math.max(MODULO_FIJO_MIN, Math.floor(disponible / total));
  return { modulo, lado: modulo * total, cell: Math.max(MODULO_FIJO_MIN, Math.ceil(modulo * dpr)) };
}

/** Cuánto lugar tiene el QR en su recuadro, en px de CSS: lo que mide el recuadro menos el borde, y como mucho `tope`. */
function lugarDelQr(img: HTMLImageElement, tope: number): number {
  const caja = img.parentElement;
  const ancho = caja ? caja.clientWidth : 0;
  if (!(ancho > 0)) return tope;
  const borde = (Number.parseFloat(getComputedStyle(img).borderLeftWidth) || 0) * 2;
  return Math.max(0, Math.min(tope, ancho - borde));
}

/**
 * El QR de un panel que se queda a la vista: mide siempre lo mismo en pantalla, aunque cambie el zoom o la densidad de la
 * pantalla, y se dibuja nítido para la densidad de ese momento. Quien lo llama lo vuelve a pedir cuando cambia la ventana.
 * El tamaño se pone antes que la imagen, para que nada se mueva mientras carga.
 */
export async function pintarQrFijo(img: HTMLImageElement, text: string, ancho = SIZE): Promise<boolean> {
  const turno = String(Number(img.dataset.qrTurno ?? "0") + 1);
  img.dataset.qrTurno = turno;
  const qr = await armar(text);
  // Otro dibujo más nuevo ya salió: este no pisa a ese.
  if (!qr || img.dataset.qrTurno !== turno) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const m = medidasFijas(qr.total, lugarDelQr(img, ancho), dpr);
  const canvas = cuadro(qr, m.cell);
  if (!canvas) return false;
  img.style.width = img.style.height = `${m.lado}px`;
  img.src = canvas.toDataURL("image/png");
  return true;
}

/**
 * El QR de un comprobante: con la marca `o=qr` antes del `#` (`marcarQr` en
 * src/contar.ts), para que la página sepa que se abrió desde el QR, y sin ella
 * si así no entra.
 */
export async function pintarQrDelComprobante(img: HTMLImageElement, enlace: string, ancho = SIZE): Promise<boolean> {
  const marcado = marcarQr(enlace);
  return (await pintarQr(img, marcado, ancho)) || (marcado !== enlace && (await pintarQr(img, enlace, ancho)));
}

/** Baja la librería del QR de antemano: con el wifi caído al final del show, igual se dibuja. */
export function precargarQr(): Promise<unknown> {
  return import("qrcode-generator").catch(() => undefined);
}

/**
 * El QR como lienzo, para componerlo en otra imagen (la tarjeta para compartir).
 * `ancho` es lo que se quiere ocupar en px del equipo, y `dpr` la densidad: con
 * 1 el lienzo sale del tamaño exacto que se pide, sin el redondeo de la pantalla.
 */
export async function qrLienzo(
  text: string,
  ancho: number,
  dpr = Math.min(window.devicePixelRatio || 1, 3),
): Promise<{ canvas: HTMLCanvasElement; lado: number; modulo: number; modulos: number } | null> {
  const qr = await armar(text);
  if (!qr) return null;
  // Cada módulo es un número entero de píxeles del equipo, y nunca menos de
  // dos: si no, el redondeo deja costuras y los lectores se confunden. Se
  // muestra a ese mismo tamaño (`lado`), sin que el navegador lo estire.
  const cell = Math.max(2, Math.floor((ancho * dpr) / qr.total));
  const canvas = cuadro(qr, cell);
  if (!canvas) return null;
  return { canvas, lado: canvas.width / dpr, modulo: cell / dpr, modulos: qr.total };
}

/** Un QR ya armado: cuántos módulos mide de lado con su margen, y cuáles son oscuros. */
interface QrArmado {
  count: number;
  total: number;
  oscuro: (fila: number, columna: number) => boolean;
}

async function armar(text: string): Promise<QrArmado | null> {
  const { default: qrcode } = await import("qrcode-generator");
  let qr: ReturnType<typeof qrcode>;
  try {
    // Versión 0 es automática: elige la más chica que entre. Con el enlace
    // largo, corrección "L": es largo y la pantalla está limpia, sin sol ni
    // manchas. Con el corto (tinkazo.app/c/…, unos 55 caracteres) sobra lugar
    // y va "Q", que aguanta un cuarto del QR tapado o borroso: lo escanean
    // desde el fondo de la sala o de una foto recomprimida por WhatsApp.
    qr = qrcode(0, text.length <= CORTO ? "Q" : "L");
    qr.addData(text);
    qr.make();
  } catch {
    return null;
  }
  const count = qr.getModuleCount();
  return { count, total: count + QUIET * 2, oscuro: (r, c) => qr.isDark(r, c) };
}

/** El QR dibujado con `cell` píxeles del equipo por módulo. */
function cuadro(q: QrArmado, cell: number): HTMLCanvasElement | null {
  const side = cell * q.total;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const c = canvas.getContext("2d");
  if (!c) return null;

  // Oscuro sobre claro, siempre, sin importar el tema de la página. Usar la
  // tinta de la paleta parecía elegante y rompía el QR en tema oscuro, donde
  // la tinta es casi blanca: quedaba claro sobre blanco y ningún lector lo
  // encontraba. Un QR no tiene tema.
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, side, side);
  c.fillStyle = "#191919";
  for (let r = 0; r < q.count; r++) {
    for (let col = 0; col < q.count; col++) {
      if (!q.oscuro(r, col)) continue;
      c.fillRect((col + QUIET) * cell, (r + QUIET) * cell, cell, cell);
    }
  }
  return canvas;
}

async function dibujar(text: string, ancho: number): Promise<{ url: string; lado: number } | null> {
  const q = await qrLienzo(text, ancho);
  return q ? { url: q.canvas.toDataURL("image/png"), lado: q.lado } : null;
}
