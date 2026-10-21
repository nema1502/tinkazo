import { qrLienzo } from "./qr";

/**
 * La tarjeta con el QR para compartir un comprobante o un evento otra vez: el
 * título, una línea (quién ganó, o cuántos sorteos) y el QR, con la marca.
 *
 * Es la misma pantalla que sale en "Mostrar en grande", en imagen: se dibuja en
 * el navegador (qr.ts, sin servicios de afuera) a 1080 × 1350, el 4:5 que
 * WhatsApp y las redes muestran entero. No lleva nada que no esté en el enlace.
 * Si el enlace es tan largo que no entra en un QR, no hay tarjeta: el mensaje
 * trae el enlace igual.
 *
 * No importa `i18n.ts`: la página de verificación la usa, y ese módulo trae el
 * diccionario entero. Los textos llegan ya traducidos.
 */

const W = 1080;
const H = 1350;
const M = 80;
const QR_LADO = 700;
const QR_ARRIBA = 420;
const PAD = 36;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const C = { fondo: "#171126", crema: "#f6efe2", crema2: "#cfc6b4", magenta: "#ff5cb3", tinta: "#000000" };
const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"];

export interface TarjetaQr {
  /** El título: el premio, o el nombre del evento. */
  titulo: string;
  /** Una línea debajo del título: quién ganó, o cuántos sorteos. */
  linea: string;
  /** El enlace que lleva el QR. */
  enlace: string;
  /** La línea de abajo del QR, en el idioma de quien comparte. */
  pie: string;
}

type Ctx = CanvasRenderingContext2D;

/** Parte el texto en renglones que entren en `ancho`. Una palabra más ancha se deja entera: `ajustar` la recorta. */
function partir(c: Ctx, texto: string, ancho: number): string[] {
  const lineas: string[] = [];
  let linea = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (!linea || c.measureText(prueba).width <= ancho) linea = prueba;
    else {
      lineas.push(linea);
      linea = palabra;
    }
  }
  if (linea) lineas.push(linea);
  return lineas;
}

/** Recorta con puntos suspensivos lo que no entre en `ancho`. */
function recortar(c: Ctx, texto: string, ancho: number): string {
  if (c.measureText(texto).width <= ancho) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && c.measureText(`${letras.join("")}…`).width > ancho) letras.pop();
  return `${letras.join("")}…`;
}

/** Como mucho `maximo` renglones; lo que sobra se junta en el último y se recorta. */
function ajustar(c: Ctx, lineas: string[], ancho: number, maximo: number): string[] {
  const cortadas = lineas.map((l) => recortar(c, l, ancho));
  if (cortadas.length <= maximo) return cortadas;
  return [...cortadas.slice(0, maximo - 1), recortar(c, cortadas.slice(maximo - 1).join(" "), ancho)];
}

function franja(c: Ctx, y: number): void {
  for (let i = 0; i * 60 < W; i++) {
    c.fillStyle = FRANJA[i % FRANJA.length] ?? C.magenta;
    c.fillRect(i * 60, y, 60, 16);
  }
}

/** La imagen de la tarjeta como PNG, o null si el enlace no entra en un QR. */
export async function tarjetaQr(t: TarjetaQr): Promise<Blob | null> {
  const qr = await qrLienzo(t.enlace, QR_LADO, 1);
  if (!qr) return null;
  const lienzo = document.createElement("canvas");
  lienzo.width = W;
  lienzo.height = H;
  const c = lienzo.getContext("2d");
  if (!c) return null;
  const ancho = W - 2 * M;

  c.textBaseline = "alphabetic";
  c.fillStyle = C.fondo;
  c.fillRect(0, 0, W, H);
  franja(c, 0);
  franja(c, H - 16);

  // La marca, arriba a la izquierda, con "zo" en magenta.
  c.font = `900 64px ${SANS}`;
  c.fillStyle = C.crema;
  c.fillText("Tinka", M, 130);
  c.fillStyle = C.magenta;
  c.fillText("zo", M + c.measureText("Tinka").width, 130);

  // El título: hasta dos renglones, con la letra más grande que entre así.
  let tam = 72;
  for (; tam > 44; tam -= 4) {
    c.font = `900 ${tam}px ${SANS}`;
    if (partir(c, t.titulo, ancho).length <= 2) break;
  }
  c.font = `900 ${tam}px ${SANS}`;
  c.fillStyle = C.crema;
  const titulo = ajustar(c, partir(c, t.titulo, ancho), ancho, 2);
  titulo.forEach((l, i) => c.fillText(l, M, 230 + i * Math.round(tam * 1.15)));
  const baseTitulo = 230 + (titulo.length - 1) * Math.round(tam * 1.15);

  // La línea de quién ganó (o cuántos sorteos), en una sola.
  c.font = `700 40px ${SANS}`;
  c.fillStyle = C.crema2;
  const linea = ajustar(c, partir(c, t.linea, ancho), ancho, 1)[0] ?? "";
  c.fillText(linea, M, baseTitulo + 66);

  // El QR, sobre una calcomanía de tinta: el borde y la sombra dura de la casa.
  const caja = qr.lado + 2 * PAD;
  const x = Math.round((W - caja) / 2);
  c.fillStyle = C.tinta;
  c.fillRect(x + 14, QR_ARRIBA + 14, caja, caja);
  c.fillStyle = "#ffffff";
  c.fillRect(x, QR_ARRIBA, caja, caja);
  c.drawImage(qr.canvas, x + PAD, QR_ARRIBA + PAD, qr.lado, qr.lado);

  // El pie: lo que pide escanear, y la dirección.
  c.textAlign = "center";
  c.font = `900 46px ${SANS}`;
  c.fillStyle = C.crema;
  c.fillText(recortar(c, t.pie, ancho), W / 2, QR_ARRIBA + caja + 56);
  c.font = `800 40px ${MONO}`;
  c.fillStyle = C.magenta;
  c.fillText("tinkazo.app", W / 2, QR_ARRIBA + caja + 112);
  c.textAlign = "left";

  return new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, "image/png"));
}
