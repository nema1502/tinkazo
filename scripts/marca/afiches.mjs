/**
 * El afiche del evento (A4 y A3) y el cartel de mesa (A5), con QR, en claro y oscuro, en español y en inglés.
 * Se dibuja en milímetros; el A3 es el A4 ampliado.
 */
import { seminegra, azar, afin } from "./base.mjs";
import { Lienzo, escribir, medir, caja, etiqueta, franja, banderines, confeti, placaQr } from "./dibujo.mjs";
import { logo } from "./logos.mjs";
import { titular } from "./redes.mjs";

export const URL_SITIO = "https://tinkazo.app";
export const URL_COMPROBACION = "https://tinkazo.app/sorteo-para-meetup.html#comprobacion";

const TEXTO = {
  es: {
    titular: ["Hoy sorteamos", "con Tinkazo"], escanea: "Escaneá y comprobá",
    pasos: ["La lista se cierra antes de sortear.", "Gana quien sale de un número público que nadie conoce antes.", "Participar es gratis."],
    premio: "Premio:", gratis: "Participar es gratis",
    mesa: ["Este sorteo", "se puede", "comprobar"], mesaQr: "Escaneá y mirá cómo",
  },
  en: {
    titular: ["Today we draw", "with Tinkazo"], escanea: "Scan and check",
    pasos: ["The list is locked before the draw.", "The winner comes from a public number nobody knows in advance.", "Entry is free."],
    premio: "Prize:", gratis: "Entry is free",
    mesa: ["This draw", "can be", "checked"], mesaQr: "Scan and see how",
  },
};

/** Parte un texto en líneas que no pasen de `ancho` (en las unidades del dibujo). */
function envolver(s, tam, ancho, font = seminegra) {
  const lineas = [];
  let actual = "";
  for (const p of s.split(" ")) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (actual && medir(prueba, tam, { font }) > ancho) { lineas.push(actual); actual = p; } else actual = prueba;
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** El afiche A4 vertical (210 por 297 mm). */
export function afiche(tema, lang) {
  const t = TEXTO[lang];
  const l = new Lienzo(210, 297, tema);
  const rng = azar(4200 + (tema === "oscuro" ? 1 : 0));
  l.fondo("papel");
  franja(l, { h: 9 });
  franja(l, { y: 288, h: 9 });
  banderines(l, { x0: 0, x1: 210, y: 14.5, n: 12, alto: 17, sag: 5, hilo: 0.8 });
  const ti = titular(l, { lineas: t.titular, x: 105, y: 49, ancho: 182, altoMax: 58, ancla: "c", u: 0.3 });
  // El QR grande, a la izquierda.
  const qy = ti.y1 + 14, lado = 96;
  placaQr(l, { texto: URL_SITIO, x: 14, y: qy, lado, borde: 0.9, sombra: 2.4, sombraCol: "magenta" });
  // A la derecha: la invitación y las tres líneas de qué es.
  const rx = 122;
  etiqueta(l, { s: t.escanea, x: rx, y: qy, tam: 6, fill: "magenta", sombraCol: "tinta", u: 0.3 });
  let y = qy + 22;
  t.pasos.forEach((p, i) => {
    const col = ["magenta", "turquesa", "amarillo"][i];
    caja(l, { x: rx, y, w: 9, h: 9, fill: col, borde: 0.6, sombra: 1.2 });
    escribir(l, { s: String(i + 1), x: rx + 4.5, y: y + 6.4, tam: 6.6, ancla: "c", color: "sobre" });
    const lineas = envolver(p, 5.4, 61);
    lineas.forEach((ln, k) => escribir(l, { s: ln, x: rx + 13, y: y + 5.6 + k * 7, tam: 5.4, font: seminegra, color: "tinta" }));
    y += Math.max(9, 5.6 + (lineas.length - 1) * 7 + 3) + 7;
  });
  // La franja para escribir el premio a mano.
  const py = qy + lado + 14;
  caja(l, { x: 14, y: py, w: 182, h: 30, fill: "tarjeta", borde: 0.9, sombra: 2.4, sombraCol: "naranja" });
  escribir(l, { s: t.premio, x: 22, y: py + 19, tam: 10, color: "tinta" });
  l.rect(22 + medir(t.premio, 10) + 4, py + 21.5, 196 - 8 - (22 + medir(t.premio, 10) + 4), 0.6, "tinta");
  // Pie: el logo con la dirección y que participar es gratis.
  logo(l, { x: 14, y: 263.5, alto: 17.5, disp: "horizontal", url: true });
  const g = etiqueta(l, { s: t.gratis, x: 196 - 2.4, y: 265, tam: 6, fill: "turquesa", ancla: "r", u: 0.3 });
  confeti(l, { rng, n: 18, area: [4, 40, 202, 245], evitar: [[10, 44, 190, ti.y1 - 40], [8, qy - 4, 120, lado + 8], [118, qy - 4, 88, 100], [8, py - 4, 194, 36], [8, 260, 194, 26]], tam: [2.2, 4.6] });
  void g;
  return l;
}

/** El cartel de mesa A5 vertical (148 por 210 mm). */
export function cartel(tema, lang) {
  const t = TEXTO[lang];
  const l = new Lienzo(148, 210, tema);
  const rng = azar(5300 + (tema === "oscuro" ? 1 : 0));
  l.fondo("papel");
  franja(l, { h: 7, n: 10 });
  franja(l, { y: 203, h: 7, n: 10 });
  banderines(l, { x0: 0, x1: 148, y: 11, n: 9, alto: 12, sag: 3.5, hilo: 0.7 });
  const ti = titular(l, { lineas: t.mesa, x: 74, y: 33, ancho: 124, altoMax: 54, ancla: "c", u: 0.3 });
  const lado = 64, qy = ti.y1 + 7;
  placaQr(l, { texto: URL_COMPROBACION, x: 41, y: qy, lado, borde: 0.8, sombra: 2, sombraCol: "magenta" });
  etiqueta(l, { s: t.mesaQr, x: 74, y: qy + lado + 8, tam: 5, fill: "amarillo", ancla: "c", sombraCol: "magenta", u: 0.3 });
  logo(l, { x: 12, y: 186, alto: 13, disp: "horizontal", url: true });
  etiqueta(l, { s: t.gratis, x: 136, y: 187, tam: 4.4, fill: "turquesa", ancla: "r", u: 0.3 });
  confeti(l, { rng, n: 12, area: [3, 30, 142, 165], evitar: [[8, 30, 132, ti.y1 - 26], [30, qy - 4, 84, lado + 10], [20, qy + lado + 4, 108, 20], [6, 180, 136, 22]], tam: [2, 4] });
  return l;
}

/** Escala un lienzo de mm por k (para pasar el A4 a A3). */
export function ampliar(l, ancho, alto) {
  // A4 a A3: la diferencia entre el factor del ancho y el del alto es de un 0,01 %, invisible, y la hoja sale exacta.
  const kx = ancho / l.w, ky = alto / l.h;
  const m = new Lienzo(ancho, alto, l.tema);
  m.formas = l.formas.map((f) => ({ ...f, cmds: afin(f.cmds, kx, 0, 0, ky, 0, 0), grosor: f.grosor && f.grosor * kx }));
  return m;
}
