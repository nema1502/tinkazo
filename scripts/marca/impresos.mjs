/**
 * Lo impreso para presentarnos y lo que necesita quien nos pone de sponsor: el roll-up (85 y 100 por 200 cm), el banner
 * de mesa (120 por 40 cm), los logos para la pared de sponsors y las imágenes para anunciar el patrocinio en redes.
 *
 * El roll-up y el banner llevan fotos de los juegos (scripts/marca/fotos, las saca fotos-juegos.mjs): en el PDF entran
 * tal cual, en el SVG van enlazadas a los JPEG que viajan al lado y en la vista previa de la página van adentro, chicas.
 * Todo se dibuja en milímetros, en el tema claro, con 5 mm de sangrado.
 */
import { readFileSync } from "node:fs";
import { negra, seminegra, azar, afin, medidasJpg, leerPng } from "./base.mjs";
import { Lienzo, escribir, medir, caja, etiqueta, franja, banderines, confeti, placaQr } from "./dibujo.mjs";
import { logo } from "./logos.mjs";
import { titular, heroLlama } from "./redes.mjs";
import { COLECCION, stickerColeccion } from "./coleccion.mjs";
import { matrizQr, ZONA } from "./qr.mjs";
import { URL_DEVFEST } from "./eventos.mjs";

export const URL_SITIO = "https://tinkazo.app";
export const INSTAGRAM = "@tinkazo.app";
/** Sangrado de las piezas grandes: cada imprenta pide el suyo (3, 5 o 10 mm), así que conviene pedirle la plantilla. */
export const SANGRE_IMPRESO = 5;
/** Lo que tapa la base del roll-up: según el soporte, de 4 a 15 cm. Ahí no va nada que importe. */
export const BASE_LIBRE = 150;
/** Las fotos de los juegos, en el orden del collage. */
export const JUEGOS_FOTO = ["race", "oruro", "guajojo", "toborochi", "pinata", "wheel"];

const NOMBRES = {
  es: { race: "Carrera de llamas", oruro: "La Entrada", guajojo: "Guajojó", toborochi: "El Toborochi", pinata: "Piñata", wheel: "Ruleta" },
  en: { race: "Llama race", oruro: "La Entrada", guajojo: "Guajojó", toborochi: "The Toborochi", pinata: "Piñata", wheel: "Wheel" },
};
export const TEXTO_IMPRESO = {
  es: {
    frase: ["Sorteos que", "cualquiera puede", "comprobar"], frase2: ["Sorteos que cualquiera", "puede comprobar"],
    escanea: "Escaneá y probá", gratis: "Participar es gratis", juegos: "Juegos de Bolivia",
    sponsor: ["Somos sponsor del", "DevFest Tarija"], fecha: "28 de noviembre de 2026", fraseCorta: "Sorteos que cualquiera puede comprobar",
    reservar: ["Escaneá para", "reservar tu lugar"],
  },
  en: {
    frase: ["Draws anyone", "can check"], frase2: ["Draws anyone", "can check"],
    escanea: "Scan and try it", gratis: "Entry is free", juegos: "Games from Bolivia",
    sponsor: ["Proud sponsor of", "DevFest Tarija"], fecha: "November 28, 2026", fraseCorta: "Draws anyone can check",
    reservar: ["Scan to", "save your seat"],
  },
};

/**
 * Las fotos de los juegos. "grande" (2560 px) para el roll-up; "media" (1280 px) para el banner de mesa, donde cada foto
 * mide 17 cm (unos 190 puntos por pulgada); "chica" (640 px), metida en el propio archivo, para las vistas de la página.
 * El SVG para editar siempre enlaza la grande.
 */
export function cargarFotos(tam = "grande") {
  const chica = tam === "chica";
  const fotos = {};
  for (const j of JUEGOS_FOTO) {
    const datos = readFileSync(new URL(`./fotos/${j}${tam === "grande" ? "" : `-${tam}`}.jpg`, import.meta.url));
    const { w, h, comp } = medidasJpg(datos);
    if (comp !== 3) throw new Error(`${j}: la foto tiene que ser RGB`);
    fotos[j] = { id: j, datos, w, h, href: chica ? `data:image/jpeg;base64,${datos.toString("base64")}` : `juego-${j}.jpg` };
  }
  return fotos;
}

/** Corre todas las formas (también las fotos) sin cambiar su tamaño. */
export const trasladar = (formas, dx, dy) => formas.map((f) => (f.imagen ? { ...f, x: f.x + dx, y: f.y + dy } : { ...f, cmds: afin(f.cmds, 1, 0, 0, 1, dx, dy) }));

/** Una foto con borde de tinta y sombra dura, como las tarjetas del sitio. `w` es el ancho total; devuelve la caja. */
function tarjetaFoto(l, { img, x, y, w, borde, sombra, sombraCol }) {
  const ai = w - 2 * borde, hi = ai * img.h / img.w, h = hi + 2 * borde;
  caja(l, { x, y, w, h, fill: "tinta", borde, sombra, sombraCol });
  l.formas.push({ imagen: img, x: x + borde, y: y + borde, ancho: ai, alto: hi, cmds: [] });
  return { x, y, w, h };
}
/** El cuerpo de letra más grande, hasta `tam`, con que `s` entra en `ancho` dentro de una etiqueta. */
const tamEtiqueta = (s, tam, ancho, font = negra) => Math.min(tam, ancho / (medir(s, 1, { font }) + 1));
/** Mide el titular sin dibujarlo: devuelve su alto. */
const altoTitular = (o) => { const m = new Lienzo(10, 10, "claro"); const r = titular(m, { ...o, y: 0 }); return r.y1 - r.y0; };
/** El ancho del logo horizontal (sin dirección) para una llama de `alto`. */
const anchoLogo = (alto, url = false, disp = "horizontal") => { const m = new Lienzo(10, 10, "claro"); const b = logo(m, { x: 0, y: 0, alto: 100, disp, url }); return { ancho: b.ancho * alto / 100, alto: b.alto * alto / 100 }; };
const SOMBRAS = ["magenta", "turquesa", "naranja", "morado", "amarillo", "magenta"];
const FILLS = ["amarillo", "magenta", "turquesa", "amarillo", "naranja", "turquesa"];

/** Pasa un lienzo dibujado en medidas de corte a uno con el sangrado alrededor. */
function conSangre(l, S) {
  const out = new Lienzo(l.w + 2 * S, l.h + 2 * S, l.tema);
  out.formas = trasladar(l.formas, S, S);
  return out;
}

/** Los stickers de la colección que van en los impresos y en las imágenes para redes: los que más se quieren, y uno de código para los encuentros de desarrolladores. */
export const PERSONAJES = ["dev-mi-llama", "guajojo", "toborochi", "llama-corazon"];
/**
 * Una fila de stickers de la colección, con su borde blanco, centrada en la caja [x, y, w, h]. Cada uno mide lo mismo de
 * alto (o de ancho, si no entra) y quedan separados por `g`.
 */
function filaStickers(l, { ids, lang, x, y, w, h, g }) {
  const piezas = ids.map((id) => {
    const st = COLECCION.find((c) => c.id === id);
    const base = stickerColeccion(st, st.langs ? null : lang, 5, 0, { sello: false });
    return { formas: base.formas.filter((f) => f.capa !== "corte" && f.fill), w: base.w, h: base.h };
  });
  // La escala que hace entrar la fila: el alto pedido, o lo que permita el ancho.
  const k = Math.min(h / Math.max(...piezas.map((p) => p.h)), (w - g * (ids.length - 1)) / piezas.reduce((a, p) => a + p.w, 0));
  const total = piezas.reduce((a, p) => a + p.w * k, 0) + g * (ids.length - 1);
  let cx = x + (w - total) / 2;
  for (const p of piezas) {
    const dy = y + (h - p.h * k) / 2;
    for (const f of p.formas) l.formas.push({ ...f, cmds: afin(f.cmds, k, 0, 0, k, cx, dy) });
    cx += p.w * k + g;
  }
  return { y0: y + (h - Math.max(...piezas.map((p) => p.h)) * k) / 2, y1: y + (h + Math.max(...piezas.map((p) => p.h)) * k) / 2 };
}

/**
 * Una grilla de capturas de juegos, centrada en la caja [x, y, w, h], con el nombre de cada juego en una etiqueta. Las
 * capturas crecen hasta llenar el ancho o el alto, lo que llegue primero. Devuelve la caja que ocupó.
 */
function grillaJuegos(l, { ids, lang, x, y, w, h, cols, g, fotos, tam = 20, borde = 4, sombra = 7 }) {
  const filas = Math.ceil(ids.length / cols);
  const gy = Math.max(g, tam * 1.2); // la etiqueta cuelga del borde de abajo: que no pise la captura de la fila siguiente
  const wPorAncho = (w - g * (cols - 1)) / cols;
  const wPorAlto = ((h - gy * (filas - 1) - tam * 0.5) / filas - 2 * borde) * 16 / 9 + 2 * borde;
  const wt = Math.min(wPorAncho, wPorAlto), ht = (wt - 2 * borde) * 9 / 16 + 2 * borde;
  const x0 = x + (w - (cols * wt + (cols - 1) * g)) / 2, y0 = y + (h - (filas * ht + (filas - 1) * gy + tam * 0.5)) / 2;
  ids.forEach((j, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const tx = x0 + c * (wt + g), ty = y0 + r * (ht + gy);
    tarjetaFoto(l, { img: fotos[j], x: tx, y: ty, w: wt, borde, sombra, sombraCol: SOMBRAS[i % SOMBRAS.length] });
    etiqueta(l, { s: NOMBRES[lang][j], x: tx + tam * 0.6, y: ty + ht - tam * 0.9, tam, fill: FILLS[i % FILLS.length], sombraCol: "tinta", u: 1 });
  });
  return [x0, y0, cols * wt + (cols - 1) * g, filas * ht + (filas - 1) * gy + tam];
}

/** Las capturas de los juegos para las imágenes en PNG: 800 por 450, ya leídas (el rasterizador las pinta). */
export function cargarFotosRed() {
  const fotos = {};
  for (const j of JUEGOS_FOTO) {
    const pix = leerPng(readFileSync(new URL(`./fotos/${j}-red.png`, import.meta.url)));
    fotos[j] = { id: j, pix, w: pix.w, h: pix.h };
  }
  return fotos;
}

/**
 * El roll-up, de `anchoCm` por 200 cm. De arriba abajo: banderines, el logo (se lee a más de 20 m), la frase (de 4 a 8 m),
 * la tarjeta amarilla con el QR a la altura del pecho (el código mide 32,5 cm de lado, de 0,9 a 1,3 m del piso: se escanea
 * desde unos 3 m),
 * seis juegos en una grilla del ancho de la tarjeta, cuatro personajes de los stickers y los 15 cm de abajo libres para
 * la base.
 */
export function rollUp(anchoCm, lang, fotos) {
  const t = TEXTO_IMPRESO[lang], S = SANGRE_IMPRESO, W = anchoCm * 10, H = 2000;
  const l = new Lienzo(W, H, "claro");
  const rng = azar(7700 + anchoCm + (lang === "en" ? 1 : 0));
  l.rect(-S, -S, W + 2 * S, H + 2 * S, "papel");
  franja(l, { x: -S, y: -S, w: W + 2 * S, h: 32 + S, n: anchoCm >= 100 ? 12 : 10 });
  banderines(l, { x0: -S, x1: W + S, y: 32, n: anchoCm >= 100 ? 11 : 9, alto: 95, sag: 26, hilo: 3 });
  const M = 55, C = W - 2 * M;
  const evitar = [];
  // El logo, del ancho del contenido o de 17 cm de llama, lo que sea menos.
  const altoLlama = Math.min(170, 100 * C / anchoLogo(100).ancho);
  const lw = anchoLogo(altoLlama).ancho, ly = 165;
  logo(l, { x: (W - lw) / 2, y: ly, alto: altoLlama, disp: "horizontal" });
  evitar.push([(W - lw) / 2 - 20, ly - 20, lw + 40, altoLlama + 40]);
  // La frase, centrada en su franja de 25,5 cm.
  const band = [ly + altoLlama + 45, 255];
  const opt = { lineas: t.frase, x: W / 2, ancho: C, altoMax: band[1], ancla: "c" };
  const ti = titular(l, { ...opt, y: band[0] + (band[1] - altoTitular(opt)) / 2 });
  evitar.push([M - 20, ti.y0 - 20, C + 40, ti.y1 - ti.y0 + 40]);
  // La tarjeta del QR, del ancho del contenido: el QR grande a la izquierda y la invitación a la derecha.
  const cy = band[0] + band[1] + 30, pad = 24, lado = 435, ch = lado + 2 * pad; // con la zona clara, el código mide 32,5 cm
  caja(l, { x: M, y: cy, w: C, h: ch, fill: "amarillo", borde: 4, sombra: 9, sombraCol: "magenta" });
  placaQr(l, { texto: URL_SITIO, x: M + pad, y: cy + pad, lado, borde: 3, sombra: 0 });
  const rx = M + pad + lado + 28, rw = M + C - pad - rx;
  const te = tamEtiqueta(t.escanea, 34, rw);
  etiqueta(l, { s: t.escanea, x: rx, y: cy + pad + 6, tam: te, fill: "magenta", sombraCol: "tinta", u: 1 });
  escribir(l, { s: "tinkazo.app", x: rx, y: cy + ch * 0.43, tam: 62, maximo: rw, color: "sobre" });
  escribir(l, { s: t.gratis, x: rx, y: cy + ch * 0.58, tam: 36, maximo: rw, font: seminegra, color: "sobre" });
  escribir(l, { s: "Instagram", x: rx, y: cy + ch * 0.8, tam: 28, maximo: rw, font: seminegra, color: "sobre" });
  escribir(l, { s: INSTAGRAM, x: rx, y: cy + ch * 0.89, tam: 32, maximo: rw, color: "sobre" });
  evitar.push([M - 20, cy - 20, C + 50, ch + 50]);
  // Seis juegos en tres columnas, del mismo ancho que la tarjeta, con el nombre de cada uno.
  const fin = H - BASE_LIBRE - 25;
  const tamJ = 26, hJ = tamJ * 1.9;
  const g = 24, b = 4;
  const wTile = (C - 2 * g) / 3, hTile = (wTile - 2 * b) * 9 / 16 + 2 * b;
  const y0 = cy + ch + 40 + hJ * 0.62;
  JUEGOS_FOTO.forEach((j, i) => {
    const c = i % 3, r = Math.floor(i / 3);
    const x = M + c * (wTile + g), y = y0 + r * (hTile + g);
    tarjetaFoto(l, { img: fotos[j], x, y, w: wTile, borde: b, sombra: 7, sombraCol: SOMBRAS[i] });
    etiqueta(l, { s: NOMBRES[lang][j], x: x + 10, y: y + hTile - 18, tam: anchoCm >= 100 ? 18 : 16, fill: FILLS[i], sombraCol: "tinta", u: 1 });
  });
  const tj = etiqueta(l, { s: t.juegos, x: W / 2, y: y0 - hJ * 0.62, tam: tamJ, fill: "turquesa", sombraCol: "tinta", ancla: "c", u: 1, rot: -1.5 });
  const finGrilla = y0 + 2 * hTile + g + 30;
  evitar.push([M - 20, tj.y - 20, C + 50, finGrilla - tj.y + 30]);
  // Los personajes de los stickers, grandes, en lo que queda hasta la base.
  const fs = filaStickers(l, { ids: PERSONAJES, lang, x: M, y: finGrilla + 20, w: C, h: fin - finGrilla - 20, g: anchoCm >= 100 ? 26 : 18 });
  evitar.push([M - 10, fs.y0 - 10, C + 20, fs.y1 - fs.y0 + 20]);
  confeti(l, { rng, n: anchoCm >= 100 ? 40 : 32, area: [-S, 130, W + 2 * S, fin - 130], evitar, tam: [9, 20] });
  // El remate de abajo: queda adentro de la base, y si se ve, se ve lindo. Nada más en los 15 cm de abajo.
  franja(l, { x: -S, y: H - 30, w: W + 2 * S, h: 30 + S, n: anchoCm >= 100 ? 12 : 10 });
  return conSangre(l, S);
}

/**
 * El banner para el frente de la mesa, de 120 por 40 cm (lona): el logo y la frase a la izquierda, cuatro juegos al medio
 * y la invitación con el QR a la derecha. Texto y QR quedan a 6 cm de cada borde, para el dobladillo y los ojales.
 */
export function bannerMesa(lang, fotos) {
  const t = TEXTO_IMPRESO[lang], S = SANGRE_IMPRESO, W = 1200, H = 400;
  const l = new Lienzo(W, H, "claro");
  const rng = azar(8800 + (lang === "en" ? 1 : 0));
  l.rect(-S, -S, W + 2 * S, H + 2 * S, "papel");
  franja(l, { x: -S, y: -S, w: W + 2 * S, h: 20 + S, n: 14 });
  franja(l, { x: -S, y: H - 20, w: W + 2 * S, h: 20 + S, n: 14 });
  const M = 60, evitar = [];
  // Izquierda: logo y frase.
  const izq = 400;
  const altoLlama = Math.min(78, 78 * izq / anchoLogo(78).ancho);
  logo(l, { x: M, y: M, alto: altoLlama, disp: "horizontal" });
  const opt = { lineas: t.frase, x: M, ancho: izq, altoMax: 190 };
  const yFrase = M + altoLlama + 24;
  const ti = titular(l, { ...opt, y: yFrase + (H - M - yFrase - altoTitular(opt)) / 2 });
  evitar.push([M - 15, M - 15, izq + 30, ti.y1 - M + 30]);
  // Derecha: "Escaneá y probá" arriba del QR, y la dirección debajo.
  const lado = 180, qx = W - M - lado;
  const te = tamEtiqueta(t.escanea, 24, lado + 40);
  const et = etiqueta(l, { s: t.escanea, x: qx + lado / 2, y: M, tam: te, fill: "amarillo", sombraCol: "magenta", ancla: "c", u: 1, rot: -2 });
  const qy = et.y + et.h + 14;
  placaQr(l, { texto: URL_SITIO, x: qx, y: qy, lado, borde: 3, sombra: 7, sombraCol: "magenta" });
  escribir(l, { s: "tinkazo.app", x: qx + lado / 2, y: H - M - 8, tam: 38, maximo: lado + 30, ancla: "c" });
  evitar.push([qx - 30, M - 15, lado + 50, H - 2 * M + 30]);
  // Al medio: cuatro juegos y, debajo, Instagram.
  const g = 16, b = 3;
  const wTile = 168, hTile = (wTile - 2 * b) * 9 / 16 + 2 * b;
  const gx = (M + izq + qx) / 2 - (2 * wTile + g) / 2, gy = M;
  ["race", "guajojo", "oruro", "toborochi"].forEach((j, i) => {
    const c = i % 2, r = Math.floor(i / 2);
    tarjetaFoto(l, { img: fotos[j], x: gx + c * (wTile + g), y: gy + r * (hTile + g), w: wTile, borde: b, sombra: 6, sombraCol: SOMBRAS[i] });
  });
  const ig = etiqueta(l, { s: `Instagram ${INSTAGRAM}`, x: gx + wTile + g / 2, y: gy + 2 * hTile + g + 22, tam: 22, fill: "magenta", sombraCol: "tinta", ancla: "c", u: 1 });
  evitar.push([gx - 15, gy - 15, 2 * wTile + g + 40, ig.y + ig.h + 20 - gy]);
  confeti(l, { rng, n: 16, area: [0, 26, W, H - 52], evitar, tam: [6, 13] });
  return conSangre(l, S);
}

// ───────────────────────── Para quien nos pone de sponsor ─────────────────────────
export const VARIANTES_PARED = ["claro", "oscuro", "negro", "blanco"];
/**
 * El logo para la pared de sponsors, en una caja fija (1200 por 600 el horizontal, 800 por 800 el cuadrado) con el aire
 * de la regla de uso alrededor, para que quede del mismo tamaño que los demás en una grilla. Fondo transparente.
 * "claro" es para fondo claro, "oscuro" para fondo oscuro, y "negro" y "blanco" son de un solo color.
 */
export function logoPared(disp, variante) {
  const [W, H] = disp === "horizontal" ? [1200, 600] : [800, 800];
  const tema = variante === "oscuro" || variante === "blanco" ? "oscuro" : "claro";
  const l = new Lienzo(W, H, tema);
  const mono = variante === "negro" ? "#191919" : variante === "blanco" ? "#ffffff" : null;
  const forma = disp === "horizontal" ? "horizontal" : "apilado";
  const base = anchoLogo(100, false, forma);
  // El aire de la regla de uso: alrededor, al menos el alto de la llama... en la caja fija entra con un 80 % de ancho.
  const k = Math.min((W * 0.8) / base.ancho, (H * 0.62) / base.alto);
  const w = base.ancho * k, h = base.alto * k;
  logo(l, { x: (W - w) / 2, y: (H - h) / 2, alto: 100 * k, disp: forma, ...(mono ? { colorLlama: mono, colorTinta: mono } : {}) });
  return l;
}

export const SPONSOR_FORMATOS = [
  { id: "sponsor-post", w: 1080, h: 1350, nombre: "Publicación de Instagram" },
  { id: "sponsor-historia", w: 1080, h: 1920, nombre: "Historia de Instagram" },
  { id: "sponsor-linkedin", w: 1584, h: 396, nombre: "Cabecera de LinkedIn" },
  { id: "sponsor-x", w: 1500, h: 500, nombre: "Cabecera de X" },
  { id: "sponsor-panoramica", w: 1200, h: 675, nombre: "Panorámica para la web o para LinkedIn" },
  { id: "sponsor-banner", w: 1980, h: 400, nombre: "Banner ancho para la web del evento" },
];

/** Los formatos que además salen con capturas de los juegos, para que quien organiza tenga dos estilos para elegir. */
export const SPONSOR_CON_JUEGOS = ["sponsor-post", "sponsor-historia", "sponsor-panoramica"];

/** El borde de la placa blanca del QR, en las imágenes para redes. */
const BORDE_QR = 4;
/** Lo que mide la placa del QR de `url` cuando cada módulo mide `modulo` píxeles (zona tranquila de 4 módulos incluida). */
const ladoQr = (url, modulo, borde = BORDE_QR) => (matrizQr(url).n + 2 * ZONA) * modulo + 2 * borde;
/** La leyenda del QR («Escaneá para reservar tu lugar») en dos renglones. Devuelve la caja que ocupó. */
function leyendaQr(l, { t, x, y, tam, maximo, ancla = "l" }) {
  let yy = y, x0 = Infinity, x1 = -Infinity;
  const e = Math.min(tam, ...t.reservar.map((s) => maximo / medir(s, 1, { font: negra })));
  for (const s of t.reservar) {
    const r = escribir(l, { s, x, y: yy, tam: e, ancla, font: negra, color: "tinta" });
    x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1);
    yy += e * 1.28;
  }
  return { x0, x1, y0: y - e * 0.72, y1: yy - e * 0.28 };
}

/**
 * Las imágenes para anunciar que somos sponsor del DevFest Tarija. Planas, en los dos temas y los dos idiomas, en dos
 * estilos: "personajes" (el sapo, el guajojó, el toborochi y la llama de la colección de stickers) y "juegos" (capturas
 * de los juegos con su nombre; hace falta `fotos`, de cargarFotosRed). La publicación, la historia y la panorámica,
 * que son las que se comparten por Instagram y WhatsApp, llevan el QR del enlace para reservar lugar en el DevFest.
 */
export function escenaSponsor(id, tema, lang, estilo = "personajes", fotos = null) {
  const juegos = estilo === "juegos";
  if (juegos && !fotos) throw new Error("el estilo con juegos necesita las fotos");
  const f = SPONSOR_FORMATOS.find((q) => q.id === id), t = TEXTO_IMPRESO[lang];
  const l = new Lienzo(f.w, f.h, tema);
  const rng = azar(9100 + f.w + f.h * 3 + (tema === "oscuro" ? 1 : 0) + (lang === "en" ? 5 : 0) + (juegos ? 17 : 0));
  l.fondo("papel");
  const caja2 = (b, m = 24) => [b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m];
  const LOGO = (o) => { const b = logo(l, o); return { x: b.x, y: b.y, w: b.ancho, h: b.alto }; };
  const TI = (o) => { const r = titular(l, o); return { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, y1: r.y1 }; };
  const centrado = (alto, url = true) => (f.w - anchoLogo(alto, url).ancho) / 2;
  if (id === "sponsor-post" || id === "sponsor-historia") {
    const alto = id === "sponsor-post";
    const k = alto ? 1 : 1.12;
    franja(l, { h: 24 * k });
    franja(l, { y: f.h - 24 * k, h: 24 * k });
    banderines(l, { x0: 0, x1: f.w, y: 46 * k, n: 10, alto: 62 * k, sag: 12, hilo: 4 });
    // En la historia, lo importante queda entre los 250 px de arriba y los 340 de abajo que tapa la app.
    const yLogo = alto ? 170 : 270, aLogo = alto ? 76 : 104;
    const lg = LOGO({ x: centrado(aLogo), y: yLogo, alto: aLogo, disp: "horizontal", url: true });
    const ti = TI({ lineas: t.sponsor, x: f.w / 2, y: lg.y + lg.h + (alto ? 56 : 62), ancho: 900, altoMax: alto ? 300 : 360, ancla: "c" });
    const fe = etiqueta(l, { s: t.fecha, x: f.w / 2, y: ti.y1 + (alto ? 40 : 46), tam: 40 * k, fill: "turquesa", sombraCol: "tinta", ancla: "c" });
    // Abajo va el QR de la inscripción, así que los personajes o las capturas van en una sola fila.
    const hy = fe.y + fe.h + (alto ? 46 : 44), hh = alto ? (juegos ? 250 : 230) : (juegos ? 190 : 230);
    let hb;
    if (juegos) {
      hb = grillaJuegos(l, alto
        ? { ids: JUEGOS_FOTO, lang, x: 56, y: hy, w: f.w - 112, h: hh, cols: 3, g: 22, fotos, tam: 20 }
        : { ids: ["race", "oruro", "guajojo", "toborochi"], lang, x: 50, y: hy, w: f.w - 100, h: hh, cols: 4, g: 16, fotos, tam: 15 });
    } else {
      const fs = filaStickers(l, { ids: PERSONAJES, lang, x: 60, y: hy, w: f.w - 120, h: hh, g: 22 });
      hb = [60, fs.y0, f.w - 120, fs.y1 - fs.y0];
    }
    const fy = hy + hh + (alto ? 56 : 54);
    const fr = escribir(l, { s: t.fraseCorta, x: f.w / 2, y: fy, tam: 34 * k, maximo: 900, ancla: "c", font: seminegra, color: "tinta" });
    // El QR a la izquierda y, al lado, la leyenda y el Instagram.
    const mod = alto ? 5 : 7, lado = ladoQr(URL_DEVFEST, mod), qx = alto ? 90 : 80, qy = fy + (alto ? 34 : 38);
    placaQr(l, { texto: URL_DEVFEST, x: qx, y: qy, lado, borde: BORDE_QR, sombra: 8, sombraCol: "magenta" });
    const rx = qx + lado + 40, rw = f.w - 60 - rx;
    const le = leyendaQr(l, { t, x: rx, y: qy + lado * (alto ? 0.26 : 0.27), tam: alto ? 54 : 58, maximo: rw });
    const ig = etiqueta(l, { s: INSTAGRAM, x: rx, y: le.y1 + (alto ? 30 : 40), tam: 30 * k, fill: "magenta", sombraCol: "tinta" });
    const qrCaja = [qx - 20, qy - 20, lado + 48, lado + 48];
    confeti(l, { rng, n: alto ? 24 : 32, area: [16, 130 * k, f.w - 32, f.h - 260 * k], evitar: [caja2(lg), caja2(ti), caja2(fe), hb, [fr.x0 - 24, fy - 50, fr.ancho + 48, 70], qrCaja, [rx - 20, le.y0 - 20, rw + 40, ig.y + ig.h - le.y0 + 50]], tam: [12, 26] });
  } else if (id === "sponsor-panoramica") {
    // Panorámica: el anuncio a la izquierda, con una fila de personajes o capturas, y el QR de la inscripción a la derecha.
    franja(l, { h: 18 });
    franja(l, { y: f.h - 18, h: 18 });
    const x0 = 64, ancho = 560;
    const lg = LOGO({ x: x0, y: 64, alto: 64, disp: "horizontal", url: true });
    const ti = TI({ lineas: t.sponsor, x: x0, y: lg.y + lg.h + 34, ancho, altoMax: 250 });
    const fe = etiqueta(l, { s: t.fecha, x: x0, y: ti.y1 + 22, tam: 28, fill: "turquesa", sombraCol: "tinta" });
    const ig = etiqueta(l, { s: INSTAGRAM, x: x0, y: fe.y + fe.h + 16, tam: 26, fill: "magenta", sombraCol: "tinta" });
    const hy = ig.y + ig.h + 24, hh = f.h - 18 - 24 - hy;
    let hb;
    if (juegos) {
      const gj = grillaJuegos(l, { ids: ["race", "wheel"], lang, x: x0, y: hy, w: ancho, h: hh, cols: 2, g: 24, fotos, tam: 14, borde: 3, sombra: 5 });
      hb = [gj[0] - 10, gj[1] - 10, gj[2] + 20, gj[3] + 20];
    } else {
      const fs = filaStickers(l, { ids: PERSONAJES, lang, x: x0, y: hy, w: ancho, h: hh, g: 14 });
      hb = [x0 - 10, fs.y0 - 10, ancho + 20, fs.y1 - fs.y0 + 20];
    }
    const lado = ladoQr(URL_DEVFEST, 6), qx = 700 + (f.w - 64 - 700 - lado) / 2, qy = 40;
    placaQr(l, { texto: URL_DEVFEST, x: qx, y: qy, lado, borde: BORDE_QR, sombra: 8, sombraCol: "magenta" });
    const le = leyendaQr(l, { t, x: qx + lado / 2, y: qy + lado + 56, tam: 38, maximo: lado + 40, ancla: "c" });
    confeti(l, { rng, n: 14, area: [16, 24, f.w - 32, f.h - 48], evitar: [caja2(lg), caja2(ti), caja2(fe), caja2(ig), hb, [qx - 20, qy - 20, lado + 48, lado + 48], [le.x0 - 20, le.y0 - 20, le.x1 - le.x0 + 40, le.y1 - le.y0 + 40]], tam: [10, 20] });
  } else {
    // Las cabeceras: la foto de perfil tapa la esquina de abajo a la izquierda, así que todo arranca después de los 430 px.
    // El banner ancho para la web del evento no tiene foto encima: arranca en el borde.
    const banner = id === "sponsor-banner";
    const x0 = banner ? 70 : 440, xh = f.w - (banner ? 800 : 330);
    franja(l, { h: id === "sponsor-x" ? 14 : 10 });
    const grande = id === "sponsor-x" || banner;
    const altoL = grande ? 46 : 38;
    const lg = LOGO({ x: x0, y: id === "sponsor-x" ? 70 : banner ? 48 : 32, alto: altoL, disp: "horizontal", url: true });
    const ti = TI({ lineas: t.sponsor, x: x0, y: lg.y + lg.h + 22, ancho: xh - x0 - 60, altoMax: id === "sponsor-x" ? 220 : banner ? 200 : 180 });
    const fe = etiqueta(l, { s: t.fecha, x: x0, y: ti.y1 + 18, tam: grande ? 26 : 20, fill: "turquesa", sombraCol: "tinta" });
    const ig = etiqueta(l, { s: INSTAGRAM, x: fe.x + fe.w + 22, y: fe.y, tam: grande ? 26 : 20, fill: "magenta", sombraCol: "tinta" });
    const ids = banner ? PERSONAJES : PERSONAJES.slice(0, 2);
    const hs = id === "sponsor-x" ? 300 : banner ? 300 : 300;
    const fs = filaStickers(l, { ids, lang, x: xh - 20, y: (f.h - hs) / 2 + 4, w: f.w - xh - (banner ? 40 : 30), h: hs, g: 16 });
    const hb = [xh - 20, fs.y0, f.w - xh, fs.y1 - fs.y0];
    confeti(l, { rng, n: 16, area: [0, 24, f.w, f.h - 40], evitar: [caja2(lg), caja2(ti), caja2(fe), caja2(ig), hb], tam: [8, 18] });
  }
  return l;
}
