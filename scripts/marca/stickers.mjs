/**
 * Los stickers nuevos y las hojas A4: se dibujan en una cuadrícula de 50 unidades de ancho y se escalan a milímetros
 * reales (5 o 7 cm). Cada uno lleva su sangrado y la línea de corte en una capa aparte.
 */
import { negra, seminegra, texto, mover, rect, circulo, redondeado, rects, contornoUnion, PAL, afin, rotar, llamaCmds, anchoLlama } from "./base.mjs";
import { Lienzo, escribir, caja, medir, tilde, placaQr, llamaGrande } from "./dibujo.mjs";

export const SANGRE = 3;           // mm, el de los stickers sueltos
export const SANGRE_HOJA = 2;      // mm, el de las hojas (entre stickers hay 5 mm de aire)
const URL_WEB = "https://tinkazo.app";
const CORTE = { trazo: "#ff00ff", capa: "corte" };

/** La forma del sticker, en unidades del dibujo: la del corte y la del fondo con sangrado. */
const contorno = (forma, w, h, d = 0) =>
  forma === "pastilla" ? redondeado(-d, -d, w + 2 * d, h + 2 * d, h / 2 + d)
    : forma === "redondo" ? circulo(w / 2, h / 2, w / 2 + d)
      : redondeado(-d, -d, w + 2 * d, h + 2 * d, 6 + d);

const capDe = (s, ajustar, font = negra) => { const t = texto(font, s, 100, 0); return t.mayuscula * ajustar / t.ancho; };

/** La banda de abajo de la tarjeta: la llama con contorno y tinkazo.app. */
function pie(L, { x, y, w, h }) {
  L.rect(x, y, w, 0.7, "tinta");
  L.rect(x, y + 0.7, w, h - 0.7, "papel");
  const al = h * 0.78;
  const tam = h * 0.46;
  const ancho = medir("tinkazo.app", tam, { font: negra });
  const ll = al * 22 / 26, total = ll + 1.8 + ancho, x0 = x + (w - total) / 2;
  llamaGrande(L, { x: x0, y: y + 0.7 + (h - 0.7 - al) / 2, alto: al, contorno: 0 });
  escribir(L, { s: "tinkazo.app", x: x0 + ll + 1.8, y: y + 0.7 + (h - 0.7) / 2 + tam * 0.36, tam, color: "tinta", font: negra, colorDe: (i) => (i >= 7 ? "magenta" : "tinta") });
}

/** El sticker de la primera vuelta: anillo de tinta, la llama y el nombre. */
function insignia(L, forma, alto, ancho, sep) {
  const anillo = forma === "redondo" ? circulo(25, 25, 22.6) : redondeado(2.2, 2.2, 45.6, 45.6, 3.8);
  const adentro = forma === "redondo" ? circulo(25, 25, 21.7) : redondeado(3.1, 3.1, 43.8, 43.8, 2.9);
  L.add(anillo, "tinta"); L.add(adentro, "papel");
  const t = texto(negra, "TINKAZO", 100, 6), e = ancho / t.ancho, cap = t.mayuscula * e;
  const top = (50 - (alto + sep + cap)) / 2;
  L.add(llamaCmds(25 - anchoLlama(alto) / 2, top, alto), "magenta");
  const tx = 25 - ancho / 2, ty = top + alto + sep + cap;
  L.add(t.glifos.filter((g) => !"ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, e, tx, ty)), "tinta");
  L.add(t.glifos.filter((g) => "ZO".includes(g.ch)).flatMap((g) => mover(g.cmds, e, tx, ty)), "magenta");
}

/** Cada diseño: tamaño en unidades, forma, temas, idiomas y cómo se dibuja. */
export const DISENOS = {
  // Los tres de la primera vuelta, para las hojas (sus archivos sueltos los genera generar-marca.mjs).
  redondo: {
    w: 50, h: 50, forma: "redondo", temas: ["claro", "oscuro"], langs: [null], soloHoja: true,
    dibujar(L) { insignia(L, "redondo", 21, 30, 4); },
  },
  cuadrado: {
    w: 50, h: 50, forma: "cuadrado", temas: ["claro"], langs: [null], soloHoja: true,
    dibujar(L) { insignia(L, "cuadrado", 25, 36, 4.8); },
  },
  web: {
    w: 50, h: 18, forma: "pastilla", temas: ["claro", "oscuro"], langs: [null],
    dibujar(L) {
      caja(L, { x: 2, y: 2, w: 44.2, h: 12.2, borde: 0.9, sombra: 1.8, fill: "amarillo", sombraCol: "magenta", radio: 6.1 });
      llamaGrande(L, { x: 7.2, y: 4.4, alto: 7.6, contorno: 0.35 });
      escribir(L, { s: "tinkazo.app", x: 16.8, y: 11.7, ajustar: 26.5, color: "sobre", font: negra });
    },
  },
  verificable: {
    w: 50, h: 50, forma: "cuadrado", temas: ["claro"], langs: ["es", "en"],
    dibujar(L, lang) {
      caja(L, { x: 3, y: 3, w: 41.8, h: 41.8, borde: 0.9, sombra: 2.2, fill: "turquesa" });
      L.add(circulo(23.9, 13.8, 8.3), "tinta"); L.add(circulo(23.9, 13.8, 7.4), "amarillo");
      tilde(L, { x: 23.9 - 5.4, y: 13.8 - 4.2, celda: 1.2 });
      const [a, b] = lang === "es" ? [["SORTEO", 26], ["VERIFICABLE", 33]] : [["VERIFIABLE", 33], ["DRAW", 22]];
      const y1 = 25 + capDe(a[0], a[1]);
      escribir(L, { s: a[0], x: 23.9, y: y1, ajustar: a[1], ancla: "c", color: "sobre" });
      escribir(L, { s: b[0], x: 23.9, y: y1 + 2.1 + capDe(b[0], b[1]), ajustar: b[1], ancla: "c", color: "sobre" });
      pie(L, { x: 3.9, y: 37.2, w: 40, h: 6.7 });
    },
  },
  gratis: {
    w: 50, h: 50, forma: "cuadrado", temas: ["claro"], langs: ["es", "en"],
    dibujar(L, lang) {
      caja(L, { x: 3, y: 3, w: 41.8, h: 41.8, borde: 0.9, sombra: 2.2, fill: "amarillo", sombraCol: "magenta" });
      const [chica, grande] = lang === "es" ? ["PARTICIPAR ES", "GRATIS"] : ["ENTRY IS", "FREE"];
      escribir(L, { s: chica, x: 23.9, y: 9.6 + capDe(chica, lang === "es" ? 30 : 22), ajustar: lang === "es" ? 30 : 22, ancla: "c", color: "sobre" });
      const cx = 23.9, cy = 23.8;
      const giro = (cmds) => rotar(cmds, -4, cx, cy);
      L.add(giro(rect(cx - 17.5 + 1.2, cy - 8.5 + 1.2, 35, 17)), "tinta");
      L.add(giro(rect(cx - 17.5, cy - 8.5, 35, 17)), "tinta");
      L.add(giro(rect(cx - 17.5 + 0.9, cy - 8.5 + 0.9, 33.2, 15.2)), "magenta");
      const aj = lang === "es" ? 28 : 25;
      escribir(L, { s: grande, x: cx, y: cy + capDe(grande, aj) / 2, ajustar: aj, ancla: "c", color: "sobre", rot: -4, rc: [cx, cy] });
      pie(L, { x: 3.9, y: 37.2, w: 40, h: 6.7 });
    },
  },
  escanea: {
    w: 50, h: 50, forma: "cuadrado", temas: ["claro"], langs: ["es", "en"],
    dibujar(L, lang) {
      caja(L, { x: 3, y: 3, w: 41.8, h: 41.8, borde: 0.9, sombra: 2.2, fill: "magenta" });
      const [a, b] = lang === "es" ? [["ESCANEÁ", 26], ["Y COMPROBÁ", 31]] : [["SCAN", 17], ["AND CHECK", 29]];
      const y1 = 5.6 + capDe(a[0], a[1]);
      escribir(L, { s: a[0], x: 23.9, y: y1, ajustar: a[1], ancla: "c", color: "sobre" });
      const lado = 23.6;
      placaQr(L, { texto: URL_WEB, x: 23.9 - lado / 2, y: y1 + 2.2, lado, borde: 0.7, sombra: 1.2 });
      escribir(L, { s: b[0], x: 23.9, y: y1 + 2.2 + lado + 1.2 + 2.4 + capDe(b[0], b[1]), ajustar: b[1], ancla: "c", color: "sobre" });
    },
  },
  evento: {
    w: 50, h: 50, forma: "cuadrado", temas: ["claro"], langs: ["es", "en"],
    dibujar(L, lang) {
      caja(L, { x: 3, y: 3, w: 41.8, h: 41.8, borde: 0.9, sombra: 2.2, fill: "naranja" });
      const [a, b, c, premio] = lang === "es" ? ["HOY", "SORTEAMOS", "CON ", "PREMIO"] : ["TODAY", "WE DRAW", "WITH ", "PRIZE"];
      const aja = lang === "es" ? 15 : 21, ajb = lang === "es" ? 34 : 30;
      const ya = 5.6 + capDe(a, aja);
      escribir(L, { s: a, x: 23.9, y: ya, ajustar: aja, ancla: "c", color: "sobre" });
      const yb = ya + 1.9 + capDe(b, ajb);
      escribir(L, { s: b, x: 23.9, y: yb, ajustar: ajb, ancla: "c", color: "sobre" });
      // "CON TINKAZO" sobre papel, con el ZO en magenta como el logo.
      const txt = `${c}TINKAZO`, anc = 33, capc = capDe(txt, anc);
      L.rect(23.9 - anc / 2 - 1.8, yb + 2.4, anc + 3.6, capc + 3.2, "tinta");
      L.rect(23.9 - anc / 2 - 1.8 + 0.6, yb + 2.4 + 0.6, anc + 3.6 - 1.2, capc + 3.2 - 1.2, "papel");
      escribir(L, { s: txt, x: 23.9, y: yb + 2.4 + 1.6 + capc, ajustar: anc, ancla: "c", color: "tinta", colorDe: (i) => (i >= txt.length - 2 ? "magenta" : "tinta") });
      // La franja para escribir el premio a mano.
      const fy = 30.6, fh = 12.2;
      L.rect(6.2, fy, 35.4, fh, "tinta"); L.rect(6.8, fy + 0.6, 34.2, fh - 1.2, "tarjeta");
      escribir(L, { s: premio + ":", x: 8.2, y: fy + 1.5 + capDe(premio + ":", 11), ajustar: 11, color: "apagado", font: seminegra });
      L.rect(8.2, fy + fh - 2.6, 31.4, 0.35, "tinta");
    },
  },
};

/** Escala un lienzo (dibujo + corte) a milímetros y arma el sticker con origen en la esquina del recorte. */
function aMm(formas, s) {
  return formas.map((f) => ({ ...f, cmds: afin(f.cmds, s, 0, 0, s, 0, 0), grosor: f.grosor && f.grosor * s }));
}
const lienzoDe = (tema) => new Lienzo(50, 50, tema);

/** Un sticker de un diseño: { w, h } del recorte en mm y las formas con (0, 0) en su esquina. */
export function sticker(nombre, { tema = "claro", lang = "es", cm = 5, sangre = SANGRE }) {
  const d = DISENOS[nombre];
  const s = cm * 10 / d.w, b = sangre / s;
  const L = new Lienzo(d.w, d.h, tema);
  L.add(contorno(d.forma, d.w, d.h, b), "papel");
  d.dibujar(L, lang);
  const arte = aMm(L.formas, s);
  const corte = { cmds: afin(contorno(d.forma, d.w, d.h), s, 0, 0, s, 0, 0), ...CORTE, grosor: 0.25 };
  return { w: d.w * s, h: d.h * s, formas: [...arte, corte] };
}

/** La llama recortada al contorno, con un borde blanco de 2 mm. La línea de corte sigue el borde. */
export function stickerLlama({ cm = 5, sangre = SANGRE }) {
  const BORDE = 2;
  const k = (cm * 10 - 2 * BORDE) / 26; // mm por unidad: la caja total (llama + borde) mide cm de alto
  const rr = rects.map(([x, y, w, h]) => [x * k, (y + 2) * k, w * k, h * k]);
  const ancho = 22 * k + 2 * BORDE, alto = 26 * k + 2 * BORDE;
  const desde = (d) => rr.flatMap(([x, y, w, h]) => rect(x - d + BORDE, y - d + BORDE, w + 2 * d, h + 2 * d));
  const filete = 0.9 * cm / 5; // contorno de tinta de la llama
  const formas = [
    { cmds: contornoUnion(rr.map(([x, y, w, h]) => [x + BORDE, y + BORDE, w, h]), BORDE + sangre), fill: PAL.claro.tarjeta },
    { cmds: desde(filete), fill: PAL.claro.tinta },
    { cmds: desde(0), fill: PAL.claro.magenta },
    { cmds: contornoUnion(rr.map(([x, y, w, h]) => [x + BORDE, y + BORDE, w, h]), BORDE), ...CORTE, grosor: 0.25 },
  ];
  return { w: ancho, h: alto, formas };
}

/** Lista de lo que se publica de los stickers sueltos: [nombre de archivo, { diseño, tema, lang }]. */
export function listaStickers() {
  const salida = [["sticker-llama-recortada", { llama: true }]];
  for (const [nombre, d] of Object.entries(DISENOS)) if (!d.soloHoja) for (const tema of d.temas) for (const lang of d.langs) {
    const sufijoTema = tema === "oscuro" ? "-oscuro" : "";
    salida.push([`sticker-${nombre}${lang ? `-${lang}` : ""}${sufijoTema}`, { nombre, tema, lang: lang ?? "es" }]);
  }
  return salida;
}
export const construir = (spec, cm, sangre) => (spec.llama ? stickerLlama({ cm, sangre }) : sticker(spec.nombre, { ...spec, cm, sangre }));

/** Una hoja: los stickers acomodados en filas con 5 mm de aire. `filas` es una lista de listas de [spec]. */
export function hoja(filas, cm, { ancho = 210, alto = 297, aire = 5 } = {}) {
  const celdas = filas.map((f) => f.map((spec) => construir(spec, cm, SANGRE_HOJA)));
  const altoTotal = celdas.reduce((a, f) => a + Math.max(...f.map((c) => c.h)), 0) + aire * (celdas.length - 1);
  let y = (alto - altoTotal) / 2;
  const formas = [];
  for (const fila of celdas) {
    const anchoFila = fila.reduce((a, c) => a + c.w, 0) + aire * (fila.length - 1);
    let x = (ancho - anchoFila) / 2;
    const hf = Math.max(...fila.map((c) => c.h));
    for (const c of fila) {
      const dy = y + (hf - c.h) / 2;
      for (const f of c.formas) formas.push({ ...f, cmds: afin(f.cmds, 1, 0, 0, 1, x, dy) });
      x += c.w + aire;
    }
    y += hf + aire;
  }
  // Las de corte al final, para que la capa quede arriba.
  return { ancho, alto, formas: [...formas.filter((f) => f.capa !== "corte"), ...formas.filter((f) => f.capa === "corte")] };
}
