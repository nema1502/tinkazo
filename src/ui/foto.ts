import { drawAvatar } from "../avatar";
import { qrLienzo } from "./qr";

/**
 * La foto para compartir: quién ganó, qué se lleva y el QR para comprobarlo,
 * con la marca. Es la que va por WhatsApp junto al mensaje (compartir.ts), y una
 * sola para todo: hasta el 21 de octubre de 2026 había dos, la de los
 * ganadores sin QR (imagen.ts) y la tarjeta con el QR (tarjeta-qr.ts).
 *
 * Lleva el QR a pedido de Nicolás ("mandar también la foto de los ganadores
 * con un QR para comprobarlo y verlo todo"): quien tenga la foto puede abrir el
 * comprobante, que trae la lista entera. El diálogo lo dice al compartir.
 *
 * Se dibuja en el navegador, a 1080 × 1350: el 4:5 que WhatsApp, Instagram y X
 * muestran entero. Arriba la marca y el rótulo; en el medio, el sorteo; abajo,
 * el QR grande, sobre blanco y con su margen, y "Escaneá para comprobarlo". El
 * QR va derecho y con módulos de píxeles enteros: WhatsApp la achica a unos
 * 800 px y la recomprime, y un QR girado o borroso deja de leerse. Si el enlace
 * es tan largo que el QR no se leería en la foto, no se dibuja: la foto dice
 * que el enlace va en el mensaje.
 *
 * No importa `i18n.ts`: la usa la página de verificación, y ese módulo trae el
 * diccionario entero. Los textos llegan ya traducidos.
 */

export interface Foto {
  /** Arriba, en versalitas: "Sorteo #278 · 21 de octubre de 2026". */
  rotulo: string;
  /** "Ganó", "Ganaron" o el nombre del evento. */
  titulo: string;
  /** Debajo del título, chico: "3 sorteos". */
  sub?: string;
  /** Un sorteo: quienes ganaron, en orden, cada uno con su cara. */
  personas?: string[];
  /** Un evento: un renglón por sorteo, el premio y quién ganó. */
  filas?: Array<{ premio: string; ganadores: string }>;
  /** Debajo de los nombres: el premio y entre cuántos salió. */
  lineas: string[];
  /** "y {n} más", para lo que no entra. */
  mas: string;
  /** Lo que lleva el QR. */
  enlace: string;
  /** "Escaneá para comprobarlo". */
  escanear: string;
  /** Lo que dice la foto en lugar del QR, si no se leería. */
  sinQr: string;
}

export const ANCHO_FOTO = 1080;
export const ALTO_FOTO = 1350;
const W = ANCHO_FOTO;
const H = ALTO_FOTO;
const M = 84;
const ANCHO = W - 2 * M;
/** El lado de la tarjeta blanca del QR, con su margen adentro. */
const QR_LADO = 452;
const QR_X = W - M - QR_LADO;
const QR_Y = H - 16 - 66 - QR_LADO;
/**
 * Lo mínimo que puede medir un módulo del QR en la foto, en píxeles. Medido el
 * 21 de octubre de 2026 con la foto achicada a 800 px y recomprimida en JPEG
 * al 60 %, lo que hace WhatsApp, y leída con jsQR: con módulos de 5 px se
 * leyeron 23 de 23 enlaces largos distintos; con 4 px, 60 de 61. El enlace
 * corto queda en 9 px. Con menos de 5, la foto no lleva QR y dice dónde está
 * el enlace.
 */
export const MODULO_MINIMO = 5;
/** Hasta dónde llega el medio; el QR, o la tarjeta que lo reemplaza, empieza más abajo. */
const ARRIBA = 236;
/** El alto de la tarjeta que reemplaza al QR cuando el enlace no entraría legible. */
const SIN_QR_ALTO = 300;
const SIN_QR_Y = H - 16 - 66 - SIN_QR_ALTO;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const C = {
  fondo: "#171126",
  tarjeta: "#221a33",
  crema: "#f6efe2",
  crema2: "#cfc6b4",
  apagado: "#97909f",
  tinta: "#000000",
  magenta: "#ff5cb3",
  amarillo: "#ffd24d",
  turquesa: "#17c3b2",
};
const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"];

/** La llama del logo, en sus rectángulos (viewBox -1 -3 24 28). */
const LLAMA: readonly (readonly [number, number, number, number])[] = [
  [2, 11, 16, 7], [15, 3, 4, 10], [14, 0, 8, 4], [20, -2, 2, 3], [3, 18, 2.5, 6],
  [8, 18, 2.5, 6], [12.5, 18, 2.5, 6], [16, 18, 2.5, 6], [0, 9, 3, 4],
];

type Ctx = CanvasRenderingContext2D;

/* ------------------------------------------------------------- texto */

/** Parte el texto en renglones del ancho dado; una palabra más ancha que el renglón se corta por letras. */
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
  return lineas.flatMap((l) => (c.measureText(l).width <= ancho ? [l] : cortar(c, l, ancho)));
}

function cortar(c: Ctx, texto: string, ancho: number): string[] {
  const tramos: string[] = [];
  let tramo = "";
  for (const letra of Array.from(texto)) {
    if (tramo && c.measureText(tramo + letra).width > ancho) {
      tramos.push(tramo);
      tramo = letra;
    } else tramo += letra;
  }
  if (tramo) tramos.push(tramo);
  return tramos;
}

/** Recorta con puntos suspensivos lo que no entre en `ancho`. */
function recortar(c: Ctx, texto: string, ancho: number): string {
  if (c.measureText(texto).width <= ancho) return texto;
  const letras = Array.from(texto);
  while (letras.length > 1 && c.measureText(`${letras.join("")}…`).width > ancho) letras.pop();
  return `${letras.join("")}…`;
}

/** Como mucho `maximo` renglones: lo que sobra se junta en el último y se recorta. */
function renglones(c: Ctx, texto: string, ancho: number, maximo: number): string[] {
  const l = partir(c, texto, ancho);
  if (l.length <= maximo) return l;
  return [...l.slice(0, maximo - 1), recortar(c, l.slice(maximo - 1).join(" "), ancho)];
}

/** El tamaño más grande entre `max` y `min` en el que el texto entra en `maximo` renglones; si no entra ni en `min`, se recorta. */
function encajar(c: Ctx, texto: string, ancho: number, maximo: number, max: number, min: number, peso: number): { tam: number; lineas: string[] } {
  for (let tam = max; tam > min; tam -= 2) {
    c.font = `${peso} ${tam}px ${SANS}`;
    const l = partir(c, texto, ancho);
    if (l.length <= maximo) return { tam, lineas: l };
  }
  c.font = `${peso} ${min}px ${SANS}`;
  return { tam: min, lineas: renglones(c, texto, ancho, maximo) };
}

/** Texto con aire entre letras, para los rótulos en versalitas. Devuelve hasta dónde llegó. */
function espaciado(c: Ctx, texto: string, x: number, y: number, aire: number): number {
  for (const letra of Array.from(texto)) {
    c.fillText(letra, x, y);
    x += c.measureText(letra).width + aire;
  }
  return x;
}

function anchoEspaciado(c: Ctx, texto: string, aire: number): number {
  return Array.from(texto).reduce((n, l) => n + c.measureText(l).width + aire, 0);
}

/* ------------------------------------------------------------- piezas de la casa */

function franja(c: Ctx, y: number): void {
  for (let i = 0; i * 60 < W; i++) {
    c.fillStyle = FRANJA[i % FRANJA.length] ?? C.magenta;
    c.fillRect(i * 60, y, 60, 16);
  }
}

/** Una calcomanía: color plano, borde de tinta y sombra dura, apenas girada. */
function calcomania(c: Ctx, x: number, y: number, w: number, h: number, color: string, giro: number, dentro?: () => void, sombra = 12): void {
  const borde = Math.max(3, Math.round(Math.min(w, h) / 30));
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate((giro * Math.PI) / 180);
  c.translate(-w / 2, -h / 2);
  c.fillStyle = C.tinta;
  c.fillRect(sombra, sombra, w, h);
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  dentro?.();
  c.lineWidth = borde;
  c.strokeStyle = C.tinta;
  c.strokeRect(borde / 2, borde / 2, w - borde, h - borde);
  c.restore();
}

/** El avatar en su propio lienzo, derecho, y se pega entero dentro de la calcomanía. */
function cara(nombre: string, lado: number): HTMLCanvasElement {
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = Math.max(1, Math.round(lado));
  const c = lienzo.getContext("2d");
  if (c) drawAvatar(c, nombre, 0, 0, lienzo.width);
  return lienzo;
}

/** La llama en magenta con sombra de tinta, girada tres grados, y "Tinkazo" con "zo" en magenta. */
function marca(c: Ctx, x: number, base: number): void {
  const e = 3;
  c.save();
  c.translate(x, base - 78);
  c.rotate((-3 * Math.PI) / 180);
  for (const [color, d] of [[C.tinta, 5], [C.magenta, 0]] as const) {
    c.fillStyle = color;
    for (const [rx, ry, rw, rh] of LLAMA) c.fillRect((rx + 1) * e + d, (ry + 3) * e + d, rw * e, rh * e);
  }
  c.restore();
  c.font = `900 60px ${SANS}`;
  c.fillStyle = C.crema;
  c.fillText("Tinka", x + 96, base);
  c.fillStyle = C.magenta;
  c.fillText("zo", x + 96 + c.measureText("Tinka").width, base);
}

/* ------------------------------------------------------------- el medio */

/**
 * Cada bloque del medio sabe cuánto mide con una escala y cómo dibujarse desde
 * una altura. Se busca la escala más grande con la que todo entra entre el
 * rótulo y el QR, y se centra en ese espacio.
 */
interface Bloque {
  alto: number;
  dibujar: (y: number) => void;
}

function titulo(c: Ctx, f: Foto, s: number, conCara: string | null): Bloque {
  const evento = !f.personas;
  if (evento) {
    // El nombre del evento: hasta dos renglones, lo más grande que entre.
    const t = encajar(c, f.titulo, ANCHO, 2, Math.round(92 * s), Math.round(52 * s), 900);
    const paso = Math.round(t.tam * 1.08);
    const subTam = Math.round(34 * s);
    const alto = t.lineas.length * paso + (f.sub ? Math.round(subTam * 1.6) : 0);
    return {
      alto,
      dibujar: (y) => {
        c.font = `900 ${t.tam}px ${SANS}`;
        c.fillStyle = C.crema;
        t.lineas.forEach((l, i) => c.fillText(l, M, y + t.tam * 0.86 + i * paso));
        if (f.sub) {
          c.font = `700 ${subTam}px ${SANS}`;
          c.fillStyle = C.apagado;
          c.fillText(recortar(c, f.sub, ANCHO), M, y + t.lineas.length * paso + subTam * 1.25);
        }
      },
    };
  }
  const tam = Math.round(104 * s);
  const lado = conCara ? Math.round(124 * s) : 0;
  const alto = Math.max(Math.round(tam * 0.9), lado);
  return {
    alto,
    dibujar: (y) => {
      c.font = `900 ${tam}px ${SANS}`;
      c.fillStyle = C.crema;
      const base = y + alto / 2 + tam * 0.34;
      c.fillText(f.titulo, M, base);
      if (conCara) {
        const x = M + c.measureText(f.titulo).width + Math.round(40 * s);
        const foto = cara(conCara, lado);
        calcomania(c, x, y, lado, lado, "#fff", 3, () => c.drawImage(foto, 0, 0, lado, lado), Math.round(10 * s));
      }
    },
  };
}

/** Un solo ganador: el nombre grande, sobre la franja amarilla, renglón por renglón. */
function nombreGrande(c: Ctx, nombre: string, s: number): Bloque {
  const n = encajar(c, nombre, ANCHO - 28, 2, Math.round(120 * s), Math.round(60 * s), 900);
  const paso = Math.round(n.tam * 1.12) + 12;
  return {
    alto: n.lineas.length * paso - 12,
    dibujar: (y) => {
      c.font = `900 ${n.tam}px ${SANS}`;
      for (const [i, l] of n.lineas.entries()) {
        const arriba = y + i * paso;
        c.fillStyle = C.amarillo;
        c.fillRect(M - 14, arriba, c.measureText(l).width + 28, Math.round(n.tam * 1.12));
        c.fillStyle = C.fondo;
        c.fillText(l, M, arriba + n.tam * 0.9);
      }
    },
  };
}

/** Varios ganadores: una fila por persona, con su cara y su número; de siete en adelante, en dos columnas. */
function filasDePersonas(c: Ctx, f: Foto, nombres: string[], s: number): Bloque {
  const total = nombres.length;
  const enDos = total > 6;
  const tope = enDos ? 12 : 6;
  const vistos = total > tope ? tope - 1 : total;
  const resto = total - vistos;
  const porColumna = enDos ? Math.ceil((vistos + (resto ? 1 : 0)) / 2) : vistos + (resto ? 1 : 0);
  const colW = enDos ? (ANCHO - 40) / 2 : ANCHO;
  const fila = Math.round((enDos ? 74 : 112) * s);
  const lado = fila - Math.round(18 * s);
  const numTam = Math.round(Math.min(40, fila * 0.34));
  c.font = `800 ${numTam}px ${MONO}`;
  const numW = c.measureText(`#${vistos}`).width;
  const libre = colW - lado - 22 - numW - 16;
  // La letra baja hasta que entren todos los nombres, con un piso; lo que no entre ni así se recorta.
  let nomTam = Math.round(Math.min(64, fila * 0.48));
  const piso = enDos ? 24 : 30;
  for (; nomTam > piso; nomTam -= 2) {
    c.font = `900 ${nomTam}px ${SANS}`;
    if (nombres.slice(0, vistos).every((n) => c.measureText(n).width <= libre)) break;
  }
  return {
    alto: porColumna * fila,
    dibujar: (y) => {
      for (let k = 0; k < vistos + (resto ? 1 : 0); k++) {
        const x0 = M + (enDos ? Math.floor(k / porColumna) : 0) * (colW + 40);
        const y0 = y + (k % porColumna) * fila;
        const medio = y0 + lado / 2;
        if (k === vistos) {
          c.font = `800 ${Math.round(nomTam * 0.9)}px ${SANS}`;
          c.fillStyle = C.crema2;
          c.fillText(f.mas.replace("{n}", String(resto)), x0, medio + nomTam * 0.32);
          continue;
        }
        const nombre = nombres[k] ?? "";
        const foto = cara(nombre, lado);
        calcomania(c, x0, y0, lado, lado, "#fff", k % 2 ? 2 : -2, () => c.drawImage(foto, 0, 0, lado, lado), Math.max(4, Math.round(lado / 14)));
        c.font = `900 ${nomTam}px ${SANS}`;
        c.fillStyle = C.crema;
        c.fillText(recortar(c, nombre, libre), x0 + lado + 22, medio + nomTam * 0.36);
        c.font = `800 ${numTam}px ${MONO}`;
        c.fillStyle = C.magenta;
        c.textAlign = "right";
        c.fillText(`#${k + 1}`, x0 + colW, medio + numTam * 0.36);
        c.textAlign = "left";
      }
    },
  };
}

/** Un evento: un renglón por sorteo, el premio en una etiqueta amarilla y quién ganó al lado. */
function filasDeEvento(c: Ctx, f: Foto, s: number): Bloque {
  const filas = f.filas ?? [];
  const tope = 7;
  const vistas = filas.length > tope ? tope - 1 : filas.length;
  const resto = filas.length - vistas;
  const alto1 = Math.round(66 * s);
  const tam = Math.round(36 * s);
  const etiTam = Math.round(28 * s);
  c.font = `800 ${etiTam}px ${SANS}`;
  // La etiqueta del premio ocupa lo que necesite, hasta el 42 % del ancho; todas del mismo ancho.
  const etiW = Math.min(
    Math.round(ANCHO * 0.42),
    Math.max(...filas.slice(0, vistas).map((x) => c.measureText(x.premio).width), 60) + 28,
  );
  return {
    alto: (vistas + (resto ? 1 : 0)) * alto1,
    dibujar: (y) => {
      filas.slice(0, vistas).forEach((x, i) => {
        const y0 = y + i * alto1;
        const etiH = Math.round(alto1 * 0.7);
        c.fillStyle = C.amarillo;
        c.fillRect(M, y0, etiW, etiH);
        c.font = `800 ${etiTam}px ${SANS}`;
        c.fillStyle = C.fondo;
        c.fillText(recortar(c, x.premio, etiW - 28), M + 14, y0 + etiH / 2 + etiTam * 0.36);
        c.font = `900 ${tam}px ${SANS}`;
        c.fillStyle = C.crema;
        c.fillText(recortar(c, x.ganadores, ANCHO - etiW - 24), M + etiW + 24, y0 + etiH / 2 + tam * 0.36);
      });
      if (resto) {
        c.font = `800 ${tam}px ${SANS}`;
        c.fillStyle = C.crema2;
        c.fillText(f.mas.replace("{n}", String(resto)), M, y + vistas * alto1 + Math.round(alto1 * 0.35) + tam * 0.36);
      }
    },
  };
}

/** El premio y entre cuántos, debajo de los nombres: el primero en crema y grande, el resto apagado. */
function cola(c: Ctx, lineas: string[], s: number): Bloque {
  const piezas = lineas.filter(Boolean).map((texto, i) => {
    const tam = Math.round((i === 0 && lineas.length > 1 ? 44 : 32) * s);
    const peso = i === 0 && lineas.length > 1 ? 700 : 600;
    c.font = `${peso} ${tam}px ${SANS}`;
    return { tam, peso, color: i === 0 && lineas.length > 1 ? C.crema : C.apagado, l: renglones(c, texto, ANCHO, 2) };
  });
  const paso = (p: { tam: number }): number => Math.round(p.tam * 1.3);
  return {
    alto: piezas.reduce((n, p) => n + p.l.length * paso(p), 0),
    dibujar: (y) => {
      for (const p of piezas) {
        c.font = `${p.peso} ${p.tam}px ${SANS}`;
        c.fillStyle = p.color;
        for (const l of p.l) {
          c.fillText(l, M, y + p.tam);
          y += paso(p);
        }
      }
    },
  };
}

function medio(c: Ctx, f: Foto, s: number): Bloque[] {
  const separa = (n: number): Bloque => ({ alto: Math.round(n * s), dibujar: () => undefined });
  const personas = f.personas ?? [];
  if (!f.personas) return [titulo(c, f, s, null), separa(30), filasDeEvento(c, f, s), separa(24), cola(c, f.lineas, s)];
  if (personas.length === 1) {
    return [titulo(c, f, s, personas[0] ?? ""), separa(34), nombreGrande(c, personas[0] ?? "", s), separa(34), cola(c, f.lineas, s)];
  }
  return [titulo(c, f, s, null), separa(26), filasDePersonas(c, f, personas, s), separa(24), cola(c, f.lineas, s)];
}

/* ------------------------------------------------------------- abajo: el QR */

/**
 * El QR para la tarjeta blanca, o null si no entra en un QR que se lea en la
 * foto. `qrLienzo` deja cada módulo en píxeles enteros (con densidad 1, el
 * lienzo mide justo lo que dice).
 */
async function elQr(enlace: string): Promise<{ lienzo: HTMLCanvasElement; lado: number; modulo: number } | null> {
  const qr = await qrLienzo(enlace, QR_LADO - 2 * 8, 1);
  return qr && qr.modulo >= MODULO_MINIMO ? { lienzo: qr.canvas, lado: qr.lado, modulo: qr.modulo } : null;
}

function abajoConQr(c: Ctx, f: Foto, qr: { lienzo: HTMLCanvasElement; lado: number }): void {
  // La tarjeta blanca, derecha (un QR girado se lee peor), con borde y sombra dura.
  c.fillStyle = C.tinta;
  c.fillRect(QR_X + 14, QR_Y + 14, QR_LADO, QR_LADO);
  c.fillStyle = "#ffffff";
  c.fillRect(QR_X, QR_Y, QR_LADO, QR_LADO);
  c.lineWidth = 6;
  c.strokeStyle = C.tinta;
  c.strokeRect(QR_X + 3, QR_Y + 3, QR_LADO - 6, QR_LADO - 6);
  const x = Math.round(QR_X + (QR_LADO - qr.lado) / 2);
  const y = Math.round(QR_Y + (QR_LADO - qr.lado) / 2);
  c.imageSmoothingEnabled = false;
  c.drawImage(qr.lienzo, x, y, qr.lado, qr.lado);
  c.imageSmoothingEnabled = true;

  // A la izquierda: lo que hay que hacer, en grande, y la dirección.
  const ancho = QR_X - M - 44;
  const t = encajar(c, f.escanear, ancho, 3, 64, 40, 900);
  const paso = Math.round(t.tam * 1.08);
  const altoTexto = t.lineas.length * paso;
  const dirAlto = 72;
  const bloque = altoTexto + 40 + dirAlto;
  let y0 = QR_Y + Math.round((QR_LADO - bloque) / 2);
  c.font = `900 ${t.tam}px ${SANS}`;
  c.fillStyle = C.crema;
  t.lineas.forEach((l, i) => c.fillText(l, M, y0 + t.tam * 0.86 + i * paso));
  y0 += altoTexto + 40;
  dominio(c, M, y0, dirAlto);
}

/** La calcomanía magenta con "tinkazo.app". */
function dominio(c: Ctx, x: number, y: number, alto: number): void {
  const dir = "tinkazo.app";
  c.font = `900 42px ${SANS}`;
  const w = Math.ceil(c.measureText(dir).width) + 44;
  calcomania(c, x, y, w, alto, C.magenta, -2, () => {
    c.fillStyle = C.fondo;
    c.font = `900 42px ${SANS}`;
    c.fillText(dir, 22, alto / 2 + 15);
  }, 9);
}

function abajoSinQr(c: Ctx, f: Foto): void {
  // Sin QR legible: una tarjeta que dice dónde está el enlace, del ancho de la foto.
  const alto = SIN_QR_ALTO;
  const y = SIN_QR_Y;
  c.fillStyle = C.tarjeta;
  c.fillRect(M, y, ANCHO, alto);
  c.lineWidth = 4;
  c.setLineDash([16, 12]);
  c.strokeStyle = C.crema2;
  c.strokeRect(M + 2, y + 2, ANCHO - 4, alto - 4);
  c.setLineDash([]);
  const t = encajar(c, f.sinQr, ANCHO - 80, 3, 52, 34, 800);
  const paso = Math.round(t.tam * 1.15);
  c.font = `800 ${t.tam}px ${SANS}`;
  c.fillStyle = C.crema;
  const arriba = y + 40;
  t.lineas.forEach((l, i) => c.fillText(l, M + 40, arriba + t.tam * 0.86 + i * paso));
  dominio(c, M + 40, y + alto - 40 - 72, 72);
}

/* ------------------------------------------------------------- la foto */

/** Dibuja la foto. Exportada para las capturas y las pruebas; para compartir, `fotoPng`. */
export async function dibujarFoto(f: Foto): Promise<HTMLCanvasElement> {
  const lienzo = document.createElement("canvas");
  lienzo.width = W;
  lienzo.height = H;
  const c = lienzo.getContext("2d");
  if (!c) throw new Error("sin lienzo 2d");
  c.textBaseline = "alphabetic";
  c.fillStyle = C.fondo;
  c.fillRect(0, 0, W, H);
  franja(c, 0);
  franja(c, H - 16);
  marca(c, M, 132);

  // El rótulo: qué es, el número y cuándo, en versalitas espaciadas.
  c.font = `700 25px ${MONO}`;
  c.fillStyle = C.apagado;
  let rotulo = f.rotulo.toUpperCase();
  while (rotulo.length > 1 && anchoEspaciado(c, rotulo, 2.5) > ANCHO) rotulo = `${Array.from(rotulo).slice(0, -2).join("")}…`;
  espaciado(c, rotulo, M, 196, 2.5);

  // Abajo va el QR, o la tarjeta que lo reemplaza: se sabe antes, para centrar el medio en lo que queda.
  const qr = await elQr(f.enlace).catch(() => null);
  const abajo = (qr ? QR_Y : SIN_QR_Y) - 48;

  // El medio, con la escala más grande que entre entre el rótulo y lo de abajo.
  let bloques: Bloque[] = [];
  let alto = 0;
  for (let s = 1; s >= 0.55; s -= 0.05) {
    bloques = medio(c, f, s);
    alto = bloques.reduce((n, b) => n + b.alto, 0);
    if (alto <= abajo - ARRIBA) break;
  }
  let y = ARRIBA + Math.max(0, Math.round((abajo - ARRIBA - alto) / 2));
  for (const b of bloques) {
    b.dibujar(y);
    y += b.alto;
  }

  if (qr) abajoConQr(c, f, qr);
  else abajoSinQr(c, f);
  return lienzo;
}

/** La foto como PNG. Null si el navegador no puede dibujarla. */
export async function fotoPng(f: Foto): Promise<Blob | null> {
  try {
    const lienzo = await dibujarFoto(f);
    return await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/png"));
  } catch {
    return null;
  }
}

/** Si el QR de este enlace se leería en la foto: el diálogo lo usa para avisar antes de dibujarla. */
export async function qrEntraEnLaFoto(enlace: string): Promise<boolean> {
  return (await elQr(enlace).catch(() => null)) !== null;
}
