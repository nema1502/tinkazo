/**
 * La portada del kit (1600 por 900): una imagen que resume todo lo que trae, para mandarla junto al enlace.
 * Junta miniaturas reales de las piezas: una imagen de redes, el afiche, stickers y el logo con la dirección.
 */
import { rect, afin, rotar, marco } from "./base.mjs";
import { Lienzo, escribir, caja, etiqueta, franja, confeti, medir } from "./dibujo.mjs";
import { logo } from "./logos.mjs";
import { titular } from "./redes.mjs";
import { escenaRed } from "./redes.mjs";
import { afiche } from "./afiches.mjs";
import { sticker, stickerLlama } from "./stickers.mjs";
import { azar } from "./base.mjs";

const TEXTO = {
  es: { titular: ["Kit para", "patrocinios", "y eventos"], etiquetas: ["Logos", "Stickers", "Afiches", "Redes", "Cartel de mesa"], pie: "tinkazo.app/marca.html", sub: "Todo para descargar, gratis" },
  en: { titular: ["Kit for", "sponsorships", "and events"], etiquetas: ["Logos", "Stickers", "Posters", "Social", "Table sign"], pie: "tinkazo.app/marca.html", sub: "Everything to download, free" },
};

/** Pone un trozo ya dibujado (formas) en el lienzo: lo escala, lo gira y le pone borde y sombra dura. */
function incrustar(l, { formas, w, h, x, y, k, rot = 0, borde = 4, sombra = 9, marcoColor = "tinta", sinMarco = false }) {
  const W = w * k, H = h * k, rc = [x + W / 2, y + H / 2];
  const g = (cmds) => (rot ? rotar(cmds, rot, ...rc) : cmds);
  if (!sinMarco) l.add(g(rect(x + sombra, y + sombra, W, H)), "tinta");
  for (const f of formas) if (f.capa !== "corte") l.formas.push({ ...f, cmds: g(afin(f.cmds, k, 0, 0, k, x, y)) });
  if (!sinMarco) l.add(g(marco(rect(x - borde, y - borde, W + 2 * borde, H + 2 * borde), rect(x, y, W, H))), marcoColor);
}

export function portada(lang) {
  const t = TEXTO[lang];
  const l = new Lienzo(1600, 900, "claro");
  const rng = azar(777);
  l.fondo("papel");
  franja(l, { h: 20, n: 16 });
  franja(l, { y: 880, h: 20, n: 16 });
  logo(l, { x: 70, y: 74, alto: 84, disp: "horizontal", url: true });
  const ti = titular(l, { lineas: t.titular, x: 70, y: 230, ancho: 640, altoMax: 330 });
  escribir(l, { s: t.sub, x: 70, y: ti.y1 + 54, tam: 31, font: undefined, color: "tinta2" });
  // Lo que trae, en pastillas.
  let x = 70, y = ti.y1 + 100;
  const colores = ["turquesa", "amarillo", "magenta", "naranja", "turquesa"];
  t.etiquetas.forEach((s, i) => {
    const w = medir(s, 25) + 25 + 30;
    if (x + w > 720) { x = 70; y += 70; }
    const b = etiqueta(l, { s, x, y, tam: 25, fill: colores[i], sombraCol: "tinta" });
    x += b.w + 26;
  });
  escribir(l, { s: t.pie, x: 70, y: 836, tam: 34, color: "magenta" });
  // El collage de piezas, a la derecha.
  const og = escenaRed("portada", "claro", lang);
  incrustar(l, { formas: og.formas, w: og.w, h: og.h, x: 790, y: 96, k: 0.46, rot: -3 });
  const af = afiche("claro", lang);
  incrustar(l, { formas: af.formas, w: af.w, h: af.h, x: 1210, y: 150, k: 1.62, rot: 4 });
  const piezas = [
    [stickerLlama({ cm: 5, sangre: 0 }), 800, 480, 3.1, -6],
    [sticker("verificable", { lang, cm: 5, sangre: 3 }), 930, 500, 3.3, 5],
    [sticker("gratis", { lang, cm: 5, sangre: 3 }), 800, 650, 3.3, 4],
    [sticker("escanea", { lang, cm: 5, sangre: 3 }), 975, 668, 3.3, -5],
  ];
  for (const [s, px, py, k, rot] of piezas) incrustar(l, { formas: s.formas, w: s.w, h: s.h, x: px, y: py, k, rot, sinMarco: true });
  // El logo con la dirección sobre una tarjeta.
  caja(l, { x: 1215, y: 698, w: 330, h: 150, fill: "tarjeta", borde: 4, sombra: 9, sombraCol: "magenta" });
  const lg = new Lienzo(10, 10, "claro");
  const b = logo(lg, { x: 0, y: 0, alto: 70, disp: "horizontal", url: true });
  logo(l, { x: 1215 + (330 - b.ancho * 0.72) / 2, y: 698 + (150 - b.alto * 0.72) / 2, alto: 70 * 0.72, disp: "horizontal", url: true });
  void rng; void confeti;
  return l;
}
