/**
 * Las imágenes para redes y marketing: portada abierta, cuadrada, historia, cabeceras y las dos de patrocinio.
 * Cada una sale en claro y oscuro, en español y en inglés. Todo plano: color, bordes de tinta y sombras duras.
 */
import { negra, seminegra, azar, rect, rotar, PAL, anchoLlama } from "./base.mjs";
import { Lienzo, escribir, medir, caja, etiqueta, franja, banderines, confeti, rayas, llamaGrande, punteado } from "./dibujo.mjs";
import { logo } from "./logos.mjs";

export const FORMATOS = [
  { id: "portada", w: 1200, h: 630, nombre: "Portada abierta (Open Graph)" },
  { id: "cuadrada", w: 1080, h: 1080, nombre: "Cuadrada" },
  { id: "historia", w: 1080, h: 1920, nombre: "Historia" },
  { id: "cabecera", w: 1500, h: 500, nombre: "Cabecera ancha" },
  { id: "linkedin", w: 1584, h: 396, nombre: "Cabecera de LinkedIn" },
  { id: "patrocinio-cuadrada", w: 1080, h: 1080, nombre: "Patrocinio cuadrada" },
  { id: "patrocinio-ancha", w: 1920, h: 1080, nombre: "Patrocinio ancha" },
];

export const TEXTOS = {
  es: {
    frase: ["Sorteos que", "cualquiera puede", "comprobar"], frase4: ["Sorteos que", "cualquiera", "puede", "comprobar"], frase2: ["Sorteos que cualquiera", "puede comprobar"],
    gratis: "Participar es gratis", web: "tinkazo.app",
    patro3: ["Tinkazo", "patrocina", "este evento"], patro2: ["Tinkazo patrocina", "este evento"], logoEvento: "logo del evento",
  },
  en: {
    frase: ["Draws anyone", "can check"], frase4: ["Draws", "anyone", "can", "check"], frase2: ["Draws anyone", "can check"],
    gratis: "Entry is free", web: "tinkazo.app",
    patro3: ["Tinkazo", "sponsors", "this event"], patro2: ["Tinkazo sponsors", "this event"], logoEvento: "event logo",
  },
};

/** El titular en letra negra, todo del mismo cuerpo, con la última línea resaltada sobre una caja amarilla. */
export function titular(l, { lineas, x, y, ancho, tamMax = 999, altoMax, ancla = "l", resaltar = true, u = 1 }) {
  const unidad = lineas.map((s) => medir(s, 1, { font: negra, esp: -0.02 }));
  let em = Math.min(tamMax, ...unidad.map((u) => ancho / u));
  const n = lineas.length;
  if (altoMax) em = Math.min(em, altoMax / (0.7 + (n - 1) * 1.1 + (resaltar ? 0.3 : 0)));
  const lead = em * 1.1, cap = em * 0.7, pad = em * 0.13;
  let maxX = 0, minX = 1e9;
  lineas.forEach((s, i) => {
    const w = unidad[i] * em, base = y + cap + i * lead + (resaltar && i === n - 1 ? pad * 0.8 : 0);
    const x0 = ancla === "c" ? x - w / 2 : x;
    const ultima = resaltar && i === n - 1;
    if (ultima) caja(l, { x: x0 - pad * 1.2, y: base - cap - pad, w: w + pad * 2.4, h: cap + pad * 2, fill: "amarillo", borde: Math.max(3 * u, em * 0.05), sombra: Math.max(5 * u, em * 0.1), sombraCol: "magenta", rot: -1.5 });
    escribir(l, { s, x: x0, y: base, tam: em, font: negra, esp: -0.02, color: ultima ? "sobre" : "tinta", rot: ultima ? -1.5 : 0, rc: [x0 + w / 2, base - cap / 2] });
    maxX = Math.max(maxX, x0 + w); minX = Math.min(minX, x0);
  });
  return { x0: minX, x1: maxX, y0: y, y1: y + cap + (n - 1) * lead + (resaltar ? pad * 2.4 : 0), em, cap };
}

/** Bloque amarillo con la llama grande a la derecha, rayas de velocidad a la izquierda y sombra dura. Devuelve su caja. */
export function heroLlama(l, { x, y, w, h, fill = "amarillo" }) {
  caja(l, { x, y, w, h, fill, borde: Math.max(4, h * 0.012), sombra: Math.max(8, h * 0.03), sombraCol: "tinta" });
  const alto = Math.min(h * 0.72, w * 0.58), aw = anchoLlama(alto);
  const g = alto * 0.075, grupo = Math.min(w * 0.86, aw + alto * 1.9);
  const lx = x + (w + grupo) / 2 - aw, ly = y + (h - alto) / 2, disp = grupo - aw - g;
  rayas(l, { xFin: lx - g, y: ly + alto * 0.18, largos: [disp * 0.95, disp * 0.62, disp * 0.8, disp * 0.45], grosor: g, sep: g * 0.8, colores: ["naranja", "turquesa", "morado", "magenta"], borde: Math.max(2, g * 0.14) });
  llamaGrande(l, { x: lx, y: ly, alto, contorno: Math.max(5, alto * 0.025), sombra: alto * 0.045, sombraCol: "tinta" });
  return [x, y, w + 14, h + 14];
}
const caja2 = (b, m = 26) => [b.x0 ?? b.x, b.y0 ?? b.y, (b.x1 ?? b.x + b.w) - (b.x0 ?? b.x), (b.y1 ?? b.y + (b.h ?? 0)) - (b.y0 ?? b.y)].map((v, i) => (i < 2 ? v - m : v + 2 * m));

export const pastillas = (l, t, { x, y, tam, u = 1 }) => {
  const a = etiqueta(l, { s: t.gratis, x, y, tam, fill: "turquesa", u });
  const sep = tam * 0.7;
  const b = etiqueta(l, { s: t.web, x: a.x + a.w + sep, y, tam, fill: "amarillo", sombraCol: "magenta", u });
  return { x: a.x, y, w: b.x + b.w - a.x, h: a.h };
};

export function escenaRed(id, tema, lang) {
  const f = FORMATOS.find((q) => q.id === id), t = TEXTOS[lang];
  const l = new Lienzo(f.w, f.h, tema);
  const rng = azar(1000 + f.w + f.h * 7 + (tema === "oscuro" ? 1 : 0));
  l.fondo("papel");
  const es = lang === "es";
  const LOGO = (o) => { const b = logo(l, o); return { x: b.x, y: b.y, w: b.ancho, h: b.alto }; };
  if (id === "portada") {
    franja(l, { h: 16 });
    const lg = LOGO({ x: 64, y: 50, alto: 54, disp: "horizontal" });
    const ti = titular(l, { lineas: es ? t.frase : ["Draws anyone", "can check"], x: 64, y: 150, ancho: 660, altoMax: 300 });
    const pl = pastillas(l, t, { x: 64, y: 506, tam: 25 });
    const hb = heroLlama(l, { x: 770, y: 96, w: 370, h: 420 });
    confeti(l, { rng, n: 26, area: [20, 30, 1160, 570], evitar: [caja2(lg), caja2(ti), caja2(pl), hb], tam: [10, 22] });
  } else if (id === "cuadrada") {
    franja(l, { h: 24 });
    franja(l, { y: 1056, h: 24 });
    banderines(l, { x0: 0, x1: 1080, y: 46, n: 10, alto: 62, sag: 12, hilo: 4 });
    const lg = LOGO({ x: 80, y: 150, alto: 60, disp: "horizontal" });
    const ti = titular(l, { lineas: es ? t.frase : ["Draws anyone", "can check"], x: 80, y: 250, ancho: 920, altoMax: 400 });
    const hy = ti.y1 + 46;
    const hb = heroLlama(l, { x: 80, y: hy, w: 920, h: 270 });
    const pl = pastillas(l, t, { x: 80, y: hy + 270 + 40, tam: 30 });
    confeti(l, { rng, n: 22, area: [20, 130, 1040, 920], evitar: [caja2(lg), caja2(ti), hb, caja2(pl)], tam: [12, 26] });
  } else if (id === "historia") {
    franja(l, { h: 30 });
    franja(l, { y: 1890, h: 30 });
    banderines(l, { x0: 0, x1: 1080, y: 56, n: 10, alto: 74, sag: 14, hilo: 4 });
    const lg = LOGO({ x: 540 - 190, y: 290, alto: 84, disp: "horizontal" });
    const ti = titular(l, { lineas: es ? t.frase4 : ["Draws", "anyone", "can check"], x: 540, y: 470, ancho: 880, altoMax: 560, ancla: "c" });
    const hb = heroLlama(l, { x: 150, y: ti.y1 + 70, w: 780, h: 440 });
    const pl = pastillas(l, t, { x: 140, y: ti.y1 + 70 + 440 + 70, tam: 34 });
    confeti(l, { rng, n: 34, area: [20, 160, 1040, 1710], evitar: [caja2(lg), caja2(ti), hb, caja2(pl)], tam: [14, 30] });
  } else if (id === "cabecera") {
    franja(l, { h: 14 });
    banderines(l, { x0: 0, x1: 1500, y: 34, n: 18, alto: 40, sag: 8, hilo: 3 });
    const lg = LOGO({ x: 480, y: 100, alto: 46, disp: "horizontal" });
    const ti = titular(l, { lineas: es ? t.frase : ["Draws anyone", "can check"], x: 480, y: 170, ancho: 640, altoMax: 220 });
    const pl = pastillas(l, t, { x: 480, y: ti.y1 + 30, tam: 19 });
    const hb = heroLlama(l, { x: 1180, y: 96, w: 280, h: 340 });
    confeti(l, { rng, n: 16, area: [0, 90, 1500, 400], evitar: [caja2(lg), caja2(ti), caja2(pl), hb], tam: [9, 20] });
  } else if (id === "linkedin") {
    franja(l, { h: 10 });
    const lg = LOGO({ x: 400, y: 44, alto: 40, disp: "horizontal" });
    const ti = titular(l, { lineas: es ? t.frase2 : ["Draws anyone", "can check"], x: 400, y: 108, ancho: 800, altoMax: 170 });
    const pl = pastillas(l, t, { x: 400, y: ti.y1 + 26, tam: 15 });
    const hb = heroLlama(l, { x: 1250, y: 56, w: 280, h: 280 });
    confeti(l, { rng, n: 14, area: [0, 30, 1584, 360], evitar: [caja2(lg), caja2(ti), caja2(pl), hb, [30, 220, 280, 180]], tam: [8, 17] });
  } else if (id === "patrocinio-cuadrada") {
    franja(l, { h: 22 });
    franja(l, { y: 1058, h: 22 });
    banderines(l, { x0: 0, x1: 1080, y: 42, n: 10, alto: 58, sag: 12, hilo: 4 });
    const ti = titular(l, { lineas: t.patro2, x: 540, y: 150, ancho: 900, altoMax: 240, ancla: "c" });
    const bx = 150, by = ti.y1 + 60, bw = 780, bh = 790 - by;
    caja(l, { x: bx, y: by, w: bw, h: bh, fill: "tarjeta", borde: 4, sombra: 8, sombraCol: "magenta" });
    punteado(l, { x: bx + 26, y: by + 26, w: bw - 52, h: bh - 52, grosor: 4, trazo: 22, hueco: 14 });
    escribir(l, { s: t.logoEvento, x: bx + bw / 2, y: by + bh / 2 + 16, tam: 46, font: seminegra, color: "apagado", ancla: "c" });
    const lg = LOGO({ x: 540 - 235, y: 864, alto: 92, disp: "horizontal", url: true });
    confeti(l, { rng, n: 18, area: [20, 100, 1040, 950], evitar: [caja2(ti), [bx - 20, by - 20, bw + 50, bh + 50], caja2(lg)], tam: [12, 24] });
  } else {
    franja(l, { h: 24 });
    franja(l, { y: 1056, h: 24 });
    banderines(l, { x0: 0, x1: 1920, y: 48, n: 18, alto: 56, sag: 12, hilo: 4 });
    const ti = titular(l, { lineas: t.patro3, x: 100, y: 190, ancho: 760, altoMax: 520 });
    const bx = 1000, by = 190, bw = 820, bh = 560;
    caja(l, { x: bx, y: by, w: bw, h: bh, fill: "tarjeta", borde: 5, sombra: 10, sombraCol: "magenta" });
    punteado(l, { x: bx + 30, y: by + 30, w: bw - 60, h: bh - 60, grosor: 5, trazo: 26, hueco: 16 });
    escribir(l, { s: t.logoEvento, x: bx + bw / 2, y: by + bh / 2 + 20, tam: 56, font: seminegra, color: "apagado", ancla: "c" });
    const lg = LOGO({ x: 100, y: 830, alto: 104, disp: "horizontal", url: true });
    const fr = escribir(l, { s: es ? "Sorteos que cualquiera puede comprobar" : "Draws anyone can check", x: 1000, y: 910, tam: 40, font: seminegra, color: "tinta2" });
    confeti(l, { rng, n: 22, area: [20, 100, 1880, 950], evitar: [caja2(ti), [bx - 20, by - 20, bw + 50, bh + 50], caja2(lg), [fr.x0 - 20, 850, fr.ancho + 40, 90]], tam: [12, 26] });
  }
  return l;
}
