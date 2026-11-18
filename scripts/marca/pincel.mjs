/**
 * El pincel de los stickers con personaje: lo común para dibujarlos, troquelarlos y sacarlos a tamaño real.
 *
 * Empezó como copia de las herramientas de scripts/marca/coleccion.mjs, la colección que se imprimió en noviembre de 2026.
 * Esa colección se queda con su copia a propósito: lo que se mejore acá no puede mover ni un píxel de lo ya impreso.
 *
 * Cómo se piensa un dibujo: en unidades de alrededor de 1 mm a 5 cm. Un sticker ocupa unas 50 de ancho y al final se
 * escala entero para que la medida mayor del troquel sea la pedida (5, 6 o 7 cm). Todo es relleno plano, sin degradados,
 * con contorno de tinta y sombra dura abajo a la derecha, como el sitio. La llama de la marca no tiene cara ni ropa: lo
 * tierno sale de la pose y de lo que la acompaña.
 *
 * Cada cosa que se dibuja deja su masa en D.masa (rectángulos, con o sin giro, y círculos). Con la masa se calcula el
 * troquel: la unión de todo, agrandada un borde blanco y sin huecos. Lo que no deja masa no agranda el troquel.
 */
import { deflateSync } from "node:zlib";
import { chunk, negra, rect, circulo, poli, afin, rotar, rects as RECTS_LLAMA, anchoLlama, aplanar, rasterizar, azar } from "./base.mjs";
import { Lienzo, escribir, caja, medir, llamaGrande } from "./dibujo.mjs";
import { campo, silueta, aCmds, cajaLazos } from "./silueta.mjs";

// ───────────────────────── Colores ─────────────────────────
/** Los de los personajes de la colección, tomados de los juegos. Los de la marca van por nombre (magenta, naranja...). */
export const C = {
  blanco: "#ffffff", noche: "#2b2357", estrella: "#fff6e9",
  rojoBo: "#d52b1e", amarilloBo: "#f9e300", verdeBo: "#007934",
  pluma: "#8b7f72", plumaClara: "#b7ab9b", pico: "#4a3f36", rama: "#7a4f2a",
  rosa: "#f79cc8", tronco: "#7fb069", troncoOsc: "#5e8f4c", espina: "#f4efd6",
  madera: "#c98a4b", maderaOsc: "#8d5a2b", metal: "#b9c0c8",
  cielo: "#bfe3f2", nieve: "#ffffff", cerro: "#8a73e8", cerroOsc: "#6c4ce0",
  corazon: "#ff4d6d", fantasma: "#f3eee6", barra: "#e9e2d4",
  piel1: "#c68b59", piel2: "#8d5524", piel3: "#e0ac69", piel4: "#a0673f", pelo: "#3b2418", mejilla: "#f08aa8",
  plumaOsc: "#5e5247", luna: "#fff0b3", lunaOsc: "#f2d77a",
  troncoClaro: "#a9cf8c", flor: "#f58fc1", florOsc: "#d9529a", florClara: "#ffd0e6", florCentro: "#fff4c2",
  paja: "#f4e2b0", pajaOsc: "#d9bd78", uva: "#7d3c98", uvaClara: "#b07cc6", hoja: "#4f9a3a", cerroVerde: "#8cc66b",
  cerroVerdeOsc: "#5f9e4a", vid: "#2f6b2a", cieloTarde: "#ffe2a8", cieloNoche: "#1f1a45", sol: "#ffb636",
};
/** Las letras de los sprites que valen siempre ('.' y ' ' son vacío). Cada sprite suma las suyas con `col`. */
export const BASE = { k: "tinta", w: C.blanco, p: "papel", m: "magenta", n: "naranja", a: "amarillo", t: "turquesa", v: "morado" };
/** Los tonos de piel y pelo de las personas, como en los juegos. */
export const PIEL = { 1: C.piel1, 2: C.piel2, 3: C.piel3, 4: C.piel4, h: C.pelo, r: C.mejilla };

// ───────────────────────── El dibujante ─────────────────────────
/** Un lienzo más la masa (lo que ocupa lo dibujado, para el troquel) y las alturas de las letras (para medir si se leen). */
export class Dib {
  constructor() { this.L = new Lienzo(60, 60, "claro"); this.masa = []; this.caps = []; }
  r(x, y, w, h, rot = 0, rc) { this.masa.push({ r: [x, y, w, h], rot, rc }); }
  c(cx, cy, r) { this.masa.push({ c: [cx, cy, r] }); }
}

/**
 * Pixel art: `filas` es una lista de cadenas y cada letra un color ('.' vacío). Primero va el contorno de tinta (cada
 * píxel agrandado `borde`) y la sombra dura, después los colores, con los píxeles seguidos de una fila juntos.
 */
export function pixeles(D, filas, { x, y, p, col = {}, borde = 0.8, sombra = 0, rot = 0, rc, masa = true }) {
  const mapa = { ...BASE, ...col };
  const W = Math.max(...filas.map((f) => f.length)), H = filas.length;
  const centro = rc ?? [x + W * p / 2, y + H * p / 2];
  const g = (cmds) => (rot ? rotar(cmds, rot, ...centro) : cmds);
  const vacio = (ch) => ch === "." || ch === " " || ch === undefined;
  const runs = [], solidos = [];
  filas.forEach((f, j) => {
    for (let i = 0; i < f.length;) {
      if (vacio(f[i])) { i++; continue; }
      let k = i; while (k < f.length && f[k] === f[i]) k++;
      runs.push([i, j, k - i, f[i]]); i = k;
    }
    for (let i = 0; i < f.length;) {
      if (vacio(f[i])) { i++; continue; }
      let k = i; while (k < f.length && !vacio(f[k])) k++;
      solidos.push([i, j, k - i]); i = k;
    }
  });
  const exp = (d, dx = 0, dy = 0) => solidos.flatMap(([i, j, n]) => rect(x + i * p - d + dx, y + j * p - d + dy, n * p + 2 * d, p + 2 * d));
  if (sombra) D.L.add(g(exp(borde, sombra, sombra)), "tinta");
  if (borde) D.L.add(g(exp(borde)), "tinta");
  const por = new Map(), e = p * 0.03; // se solapan un poco: sin costuras entre colores
  for (const [i, j, n, ch] of runs) {
    const c = mapa[ch];
    if (!c) throw new Error(`color desconocido en un sprite: ${ch}`);
    if (!por.has(c)) por.set(c, []);
    por.get(c).push(...rect(x + i * p - e, y + j * p - e, n * p + 2 * e, p + 2 * e));
  }
  for (const [c, cmds] of por) D.L.add(g(cmds), c);
  if (masa) for (const [i, j, n] of solidos) D.r(x + i * p - borde, y + j * p - borde, n * p + 2 * borde + sombra, p + 2 * borde + sombra, rot, centro);
  return { w: W * p, h: H * p };
}
/** Un sprite espejado (mira para el otro lado). */
export const espejo = (filas) => filas.map((f) => [...f].reverse().join(""));
/** Un sprite simétrico a partir de su mitad izquierda. */
export const simetrico = (filas) => filas.map((f) => f + [...f].reverse().join(""));

/** Un brillo de cuatro puntas, en píxeles. */
export function brillo(D, x, y, p, color = "amarillo") {
  pixeles(D, ["..a..", "..a..", "aaaaa", "..a..", "..a.."], { x, y, p, col: { a: color }, borde: p * 0.45 });
}
export const CORAZON = [".rr.rr.", "rwrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."];
export const NOTA = ["..kk", "..kk", "..k.", "..k.", "kkk.", "kkk."];

// ───────────────────────── La llama ─────────────────────────
/**
 * Las poses de la llama en su cuadrícula: x de 0 a 22, y de 0 (la punta de la oreja) a 26 (las patas). La cabeza es la
 * misma en todas ([14, 2, 8, 4], con la oreja en [20, 0, 2, 3]): por eso los sombreros sirven para cualquier pose.
 * Mira a la derecha, como el logo.
 */
export const POSES = {
  parada: RECTS_LLAMA.map(([x, y, w, h]) => [x, y + 2, w, h]),
  // Echada: las mismas formas con las patas dobladas debajo, como en el sticker de la llama dormida.
  echada: [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [3, 20, 2.5, 1.8], [8, 20, 2.5, 1.8], [12.5, 20, 2.5, 1.8], [16, 20, 2.5, 1.8], [0, 11, 3, 4]],
  // Con la pata de adelante levantada y doblada, en tres patas (como los flamencos).
  pataArriba: [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [3, 20, 2.5, 6], [8, 20, 2.5, 6], [12.5, 20, 2.5, 6], [16, 20, 2.5, 2.6], [16.9, 21.6, 3.4, 1.9], [0, 11, 3, 4]],
  // Sentada: el pecho alto, la espalda que baja en escalones hasta las ancas apoyadas, la pata de atrás doblada en el
  // suelo y las dos de adelante derechas.
  sentada: [[14, 2, 8, 4], [20, 0, 2, 3], [15, 5, 4, 9], [12.6, 11, 6.9, 8], [7.6, 13.4, 6, 6.4], [4, 15.6, 5, 5], [2.8, 18.4, 9, 5.6], [5.4, 23.4, 7.8, 2.6], [13.6, 18, 2.4, 8], [17, 18, 2.4, 8], [1.6, 14.2, 3, 3.2]],
  // En el aire, con las cuatro patas dobladas: para el salto (con `rot` negativo sube la nariz).
  salto: [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [0, 11, 3, 4], [2.6, 19.4, 2.6, 2.6], [1.2, 21.2, 2.8, 2.2], [7.6, 19.4, 2.5, 3.6], [12.6, 19.4, 2.5, 3.6], [16, 19.4, 2.6, 2.6], [17.6, 21.0, 2.8, 2.2]],
};
/** El centro de giro de la llama: el mismo que usa `llama` y que tienen que usar los sombreros. */
export const centroLlama = ({ x, y, alto }) => [x + anchoLlama(alto) / 2, y + alto / 2];

/** La llama del logo, con contorno y sombra dura. (x, y) es la esquina de su caja de `alto` de alto. */
export function llama(D, { x, y, alto, color = "magenta", contorno = 0.8, sombra = 1.2, rot = 0 }) {
  llamaGrande(D.L, { x, y, alto, color, contorno, sombra, rot });
  const k = alto / 26, rc = centroLlama({ x, y, alto });
  for (const [rx, ry, w, h] of RECTS_LLAMA) D.r(x + rx * k - contorno, y + (ry + 2) * k - contorno, w * k + 2 * contorno + sombra, h * k + 2 * contorno + sombra, rot, rc);
}
/** Rectángulos sueltos [x, y, w, h] en una grilla de `k`, con contorno y sombra (para la llama en otras poses). */
export function bloques(D, rs, { x, y, k, color, contorno = 0.8, sombra = 1.2, rot = 0, rc }) {
  const rr = rs.map(([a, b, w, h]) => [x + a * k, y + b * k, w * k, h * k]);
  const centro = rc ?? [x + 11 * k, y + 13 * k];
  const g = (cmds) => (rot ? rotar(cmds, rot, ...centro) : cmds);
  const exp = (d, dx = 0, dy = 0) => rr.flatMap(([a, b, w, h]) => rect(a - d + dx, b - d + dy, w + 2 * d, h + 2 * d));
  if (sombra) D.L.add(g(exp(contorno, sombra, sombra)), "tinta");
  D.L.add(g(exp(contorno)), "tinta");
  D.L.add(g(exp(0)), color);
  for (const [a, b, w, h] of rr) D.r(a - contorno, b - contorno, w + 2 * contorno + sombra, h + 2 * contorno + sombra, rot, centro);
}
/**
 * La llama en una pose de `POSES` (o una lista propia de rectángulos), del mismo tamaño que la del logo: `alto` es lo que
 * mediría parada. Con `espejo` mira a la izquierda (sin sombrero: los sombreros están hechos para la que mira a la derecha).
 * Con `reflejo` queda patas arriba dentro de su caja, para el reflejo en el agua (sin contorno ni sombra, de un rosa claro).
 */
export function llamaEn(D, { x, y, alto, pose = "parada", color = "magenta", contorno = 0.8, sombra = 1.2, rot = 0, espejo: esp = false, reflejo = false }) {
  const k = alto / 26;
  let rs = typeof pose === "string" ? POSES[pose] : pose;
  if (!rs) throw new Error(`pose desconocida: ${pose}`);
  if (esp) rs = rs.map(([a, b, w, h]) => [22 - a - w, b, w, h]);
  if (reflejo) rs = rs.map(([a, b, w, h]) => [a, 26 - b - h, w, h]);
  bloques(D, rs, { x, y, k, color, contorno, sombra, rot, rc: centroLlama({ x, y, alto }) });
}

// ───────────────────────── Formas con borde ─────────────────────────
/** Un disco con borde de tinta y sombra dura. La masa son los dos círculos: el del borde y el de la sombra. */
export function disco(D, cx, cy, r, fill, { borde = 0.8, sombra = 1.2 } = {}) {
  if (sombra) D.L.add(circulo(cx + sombra, cy + sombra, r + borde), "tinta");
  D.L.add(circulo(cx, cy, r + borde), "tinta");
  D.L.add(circulo(cx, cy, r), fill);
  D.c(cx, cy, r + borde);
  if (sombra) D.c(cx + sombra, cy + sombra, r + borde);
}
/** Una caja con borde de tinta y sombra dura que además deja su masa (la `caja` de dibujo.mjs no la deja). */
export function bloque(D, { x, y, w, h, fill, borde = 0.8, sombra = 1.2, radio = 0, rot = 0, rc, sombraCol = "tinta" }) {
  const centro = rc ?? [x + w / 2, y + h / 2];
  caja(D.L, { x, y, w, h, fill, borde, sombra, radio, rot, rc: centro, sombraCol });
  D.r(x, y, w + sombra, h + sombra, rot, centro);
}
/**
 * Un polígono con borde (el mismo agrandado desde su centro), como en la colección. Sirve para formas casi convexas:
 * para las demás, `forma`, que hace el borde parejo y la sombra.
 */
export function poliBorde(D, pts, fill, { borde = 0.8, masa = true } = {}) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const grande = pts.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * borde * 1.6, y + (y - cy) / d * borde * 1.6]; });
  D.L.add(poli(grande), "tinta");
  D.L.add(poli(pts), fill);
  if (masa) masaPoligono(D, grande);
  const xs = grande.map((p) => p[0]), ys = grande.map((p) => p[1]);
  return { grande, caja: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
}
/** El borde de un polígono o de una línea como relleno: un rectángulo por lado y un círculo en cada vértice. */
function banda(pts, d, cerrado = true) {
  const cmds = [];
  const n = cerrado ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-9) continue;
    const nx = -(by - ay) / L * d, ny = (bx - ax) / L * d;
    cmds.push(...poli([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]));
  }
  for (const [x, y] of pts) cmds.push(...circulo(x, y, d));
  return cmds;
}
/** La masa de un polígono: tiras horizontales de lo que cubre, agrandadas el borde (la silueta solo entiende rectángulos y círculos). */
export function masaPoligono(D, pts, extra = 0, sombra = 0) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys), paso = 0.25;
  for (let y = y0; y < y1; y += paso) {
    const ym = Math.min(y + paso / 2, y1 - 1e-6), xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= ym && by > ym) || (by <= ym && ay > ym)) xs.push(ax + (ym - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) D.r(xs[k] - extra, y - extra, xs[k + 1] - xs[k] + 2 * extra + sombra, paso + 2 * extra + sombra);
  }
}
/**
 * Un polígono cualquiera (cóncavo también) con borde de tinta parejo y sombra dura. `pts` es la lista de vértices.
 * Con `masa: false` no agranda el troquel (para lo que va adentro de otra cosa).
 */
export function forma(D, pts, fill, { borde = 0.8, sombra = 0, sombraCol = "tinta", masa = true } = {}) {
  if (sombra) {
    const s = pts.map(([x, y]) => [x + sombra, y + sombra]);
    D.L.add([...poli(s), ...(borde ? banda(s, borde) : [])], sombraCol);
  }
  if (borde) D.L.add(banda(pts, borde), "tinta");
  D.L.add(poli(pts), fill);
  if (masa) masaPoligono(D, pts, borde, sombra);
}
/** Los vértices de una elipse (para pasarle a `forma`). */
export const elipse = (cx, cy, rx, ry, n = 48, giro = 0) => Array.from({ length: n }, (_, i) => {
  const a = 2 * Math.PI * i / n, x = rx * Math.cos(a), y = ry * Math.sin(a), g = giro * Math.PI / 180;
  return [cx + x * Math.cos(g) - y * Math.sin(g), cy + x * Math.sin(g) + y * Math.cos(g)];
});
/** La masa de una línea: un rectángulo girado por tramo y un círculo en cada punto (sin huecos entre puntos lejanos). */
function masaLinea(D, pts, grosor) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), cx = (ax + bx) / 2, cy = (ay + by) / 2;
    D.r(cx - L / 2, cy - grosor / 2, L, grosor, Math.atan2(by - ay, bx - ax) * 180 / Math.PI, [cx, cy]);
  }
  for (const [x, y] of pts) D.c(x, y, grosor / 2);
}
/** Una línea gruesa que pasa por `pts` (tallos, cuerdas, cintas), sin borde. Con `masa`, agranda el troquel. */
export function trazo(D, pts, grosor, color = "tinta", { masa = false } = {}) {
  D.L.add(banda(pts, grosor / 2, false), color);
  if (masa) masaLinea(D, pts, grosor);
}
/** Un arco grueso (líneas de movimiento). Ángulos en grados: 0 a la derecha, 90 abajo. */
export function arco(D, cx, cy, r, a0, a1, grosor, color = "tinta") {
  const n = 16, pts = [], medio = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([cx + (r + grosor / 2) * Math.cos(a), cy + (r + grosor / 2) * Math.sin(a)]); medio.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([cx + (r - grosor / 2) * Math.cos(a), cy + (r - grosor / 2) * Math.sin(a)]); }
  D.L.add(poli(pts), color);
  masaLinea(D, medio, grosor);
}

// ───────────────────────── Grupos: recortar, girar, espejar ─────────────────────────
/** Recorta un polígono contra otro convexo (Sutherland y Hodgman). Mantiene el sentido de giro del recortado. */
function recortar(sujeto, clip) {
  const cx = clip.reduce((a, p) => a + p[0], 0) / clip.length, cy = clip.reduce((a, p) => a + p[1], 0) / clip.length;
  const lado = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const cruce = (a, b, p, q) => {
    const d1 = lado(a, b, p), d2 = lado(a, b, q), t = d1 / (d1 - d2);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  let salida = sujeto;
  for (let i = 0; i < clip.length && salida.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], s = Math.sign(lado(a, b, [cx, cy]));
    const entra = salida;
    salida = [];
    for (let j = 0; j < entra.length; j++) {
      const p = entra[(j + entra.length - 1) % entra.length], q = entra[j];
      const pin = lado(a, b, p) * s >= 0, qin = lado(a, b, q) * s >= 0;
      if (qin) { if (!pin) salida.push(cruce(a, b, p, q)); salida.push(q); }
      else if (pin) salida.push(cruce(a, b, p, q));
    }
  }
  return salida;
}
/** Recorta trazos contra un círculo: aplana las curvas y corta cada polígono contra el círculo hecho polígono. */
function recortarCirculo(cmds, cx, cy, r) {
  const N = 144, circ = Array.from({ length: N }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / N), cy + r * Math.sin(2 * Math.PI * i / N)]);
  const r2 = (r * Math.cos(Math.PI / N)) ** 2; // el círculo inscrito en el polígono: lo que cae adentro no se corta
  const salida = [];
  for (const pol of aplanar(cmds)) {
    if (pol.length < 3) continue;
    const xs = pol.map((p) => p[0]), ys = pol.map((p) => p[1]);
    if (Math.max(...xs) < cx - r || Math.min(...xs) > cx + r || Math.max(...ys) < cy - r || Math.min(...ys) > cy + r) continue;
    const q = pol.every(([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 <= r2) ? pol : recortar(pol, circ);
    if (q.length < 3) continue;
    salida.push(["M", ...q[0]], ...q.slice(1).map((p) => ["L", ...p]), ["Z"]);
  }
  return salida;
}
/**
 * Todo lo que se dibuja en `dibujo()` queda recortado contra el círculo (cx, cy, r): para los paisajes adentro de un disco.
 * Lo de adentro no agranda el troquel (ya lo cubre el disco).
 */
export function dentro(D, { cx, cy, r }, dibujo) {
  const n0 = D.L.formas.length, m0 = D.masa.length;
  dibujo();
  const nuevas = D.L.formas.splice(n0).map((f) => ({ ...f, cmds: recortarCirculo(f.cmds, cx, cy, r) })).filter((f) => f.cmds.length);
  D.L.formas.push(...nuevas);
  D.masa.length = m0;
}
const girarPunto = ([x, y], g, [cx, cy]) => {
  const a = g * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  return [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co];
};
/** Gira todo lo que se dibuja en `dibujo()`: `grados` alrededor de `centro`. Se puede anidar con los giros de cada pieza. */
export function girar(D, grados, centro, dibujo) {
  const n0 = D.L.formas.length, m0 = D.masa.length;
  dibujo();
  if (!grados) return;
  for (let i = n0; i < D.L.formas.length; i++) D.L.formas[i] = { ...D.L.formas[i], cmds: rotar(D.L.formas[i].cmds, grados, ...centro) };
  for (let i = m0; i < D.masa.length; i++) {
    const f = D.masa[i];
    if (f.c) { const [x, y] = girarPunto(f.c, grados, centro); D.masa[i] = { c: [x, y, f.c[2]] }; continue; }
    // Un rectángulo girado es su centro y su ángulo: se gira el centro y se suman los ángulos.
    const [x, y, w, h] = f.r;
    let p = [x + w / 2, y + h / 2];
    if (f.rot) p = girarPunto(p, f.rot, f.rc);
    p = girarPunto(p, grados, centro);
    D.masa[i] = { r: [p[0] - w / 2, p[1] - h / 2, w, h], rot: (f.rot || 0) + grados, rc: p };
  }
}

// ───────────────────────── Letras y cintas ─────────────────────────
/** Letras grandes con contorno de tinta y sombra dura. */
export function letras(D, { s, x, y, tam, color, ancla = "l", contorno = 0.7, sombra = 1.4, sombraCol = "tinta", font = negra, rot = 0, rc }) {
  const r0 = escribir({ add() {}, c: (n) => n }, { s, x, y, tam, ancla, font });
  const centro = rc ?? [(r0.x0 + r0.x1) / 2, y - r0.cap / 2];
  if (sombra) escribir(D.L, { s, x: x + sombra, y: y + sombra, tam, color: sombraCol, ancla, font, rot, rc: [centro[0] + sombra, centro[1] + sombra] });
  if (contorno) for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    escribir(D.L, { s, x: x + contorno * Math.cos(a), y: y + contorno * Math.sin(a), tam, color: "tinta", ancla, font, rot, rc: centro });
  }
  const r = escribir(D.L, { s, x, y, tam, color, ancla, font, rot, rc: centro });
  D.caps.push(r.cap);
  D.r(r.x0 - contorno, y - r.cap * 1.08 - contorno, r.ancho + 2 * contorno + sombra, r.cap * 1.3 + 2 * contorno + sombra, rot, centro);
  return r;
}

/**
 * La cinta de la frase: una caja con borde de tinta y sombra dura, girada unos grados como la llama del sitio, con una o
 * más líneas del mismo cuerpo. El cuerpo se elige para que la línea más larga llene `ancho` (sin pasar de `tamMax`).
 * `colorDe(i, letra, linea)` pinta letra por letra (para destacar una palabra). `despues` reserva `em` de ancho al final
 * de la última línea y lo dibuja con `despues.dibujar(D, { x, base, tam, cap, rot, rc })` (los tres puntitos de Cargando).
 */
export function cinta(D, { lineas, cx, y, ancho, fill = "amarillo", color = "sobre", rot = -3, tamMax = 9, font = negra, sombraCol = "tinta", pad = 1.7, sombra = 1.3, borde = 0.8, colorDe, despues }) {
  const extra = despues ? despues.em * 100 : 0;
  const unidad = lineas.map((s, i) => medir(s, 100, { font }) + (i === lineas.length - 1 ? extra : 0));
  const tam = Math.min(tamMax, (ancho - 2 * pad) * 100 / Math.max(...unidad));
  const cap = tam * 0.7, inter = cap * 0.5;
  const w = Math.max(...unidad) * tam / 100 + 2 * pad, h = 2 * pad + cap * lineas.length + inter * (lineas.length - 1);
  const rc = [cx, y + h / 2];
  caja(D.L, { x: cx - w / 2, y, w, h, fill, borde, sombra, sombraCol, rot, rc });
  lineas.forEach((s, i) => {
    const base = y + pad + cap * (i + 1) + inter * i, x0 = cx - unidad[i] * tam / 200;
    escribir(D.L, { s, x: x0, y: base, tam, color, font, rot, rc, colorDe: colorDe ? (k, ch) => colorDe(k, ch, i) ?? color : undefined });
    if (despues && i === lineas.length - 1) despues.dibujar(D, { x: x0 + medir(s, tam, { font }), base, tam, cap, rot, rc });
  });
  D.caps.push(cap);
  D.r(cx - w / 2, y, w + sombra, h + sombra, rot, rc);
  return { w, h, cap, tam, y1: y + h };
}

/** Confeti en píxeles cuadrados, con semilla, esquivando rectángulos y siempre cerca de lo dibujado (el troquel no se parte). */
export function chispas(D, { semilla, n, area: [ax, ay, aw, ah], evitar = [], lado = 1.6, colores = ["magenta", "naranja", "amarillo", "turquesa", "morado"] }) {
  const rng = azar(semilla);
  // La distancia de un punto a una forma de la masa; si el rectángulo está girado, se gira el punto al revés.
  const distA = (f, x, y) => {
    if (f.c) return Math.max(0, Math.hypot(x - f.c[0], y - f.c[1]) - f.c[2]);
    const [a, b, w, h] = f.r;
    const [px, py] = f.rot ? girarPunto([x, y], -f.rot, f.rc) : [x, y];
    return Math.hypot(Math.max(a - px, 0, px - a - w), Math.max(b - py, 0, py - b - h));
  };
  let puestos = 0, intentos = 0;
  const hechos = [];
  while (puestos < n && intentos++ < n * 80) {
    const x = ax + rng() * aw, y = ay + rng() * ah;
    if (evitar.some(([ex, ey, ew, eh]) => x > ex - lado && x < ex + ew + lado && y > ey - lado && y < ey + eh + lado)) continue;
    if (hechos.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < lado * 3.2)) continue;
    if (!D.masa.some((f) => distA(f, x, y) < 4.2 - lado)) continue;
    hechos.push([x, y]);
    const g = (rng() - 0.5) * 50;
    D.L.add(rotar(rect(x - lado / 2 - 0.45, y - lado / 2 - 0.45, lado + 0.9, lado + 0.9), g, x, y), "tinta");
    D.L.add(rotar(rect(x - lado / 2, y - lado / 2, lado, lado), g, x, y), colores[puestos % colores.length]);
    D.c(x, y, lado);
    puestos++;
  }
  return hechos;
}

// ───────────────────────── La dirección, el troquel y las salidas ─────────────────────────
/** El borde blanco alrededor del dibujo, en unidades (unos 2,4 mm a 5 cm), y el sangrado más grande que se pide. */
export const BORDE = 2.6;
const MAX_SANGRE = 4.5;
/**
 * La dirección, en todos: una etiqueta chica de tinta con tinkazo.app en papel, colgada del borde de abajo del troquel
 * (o donde pida `conf`: { ancla: "l" | "c" | "r", x, y, dy }). La letra mide lo mismo en todos a la medida final: 2,35 mm
 * de alto a 5 cm. Como la escala depende de la caja del troquel, y la caja de la etiqueta, se resuelve en pocas pasadas.
 */
const SELLO = { s: "tinkazo.app", cap: 2.35, padX: 1.3, padY: 1.05, sombra: 0.45 }; // en mm a 5 cm
function cajaMasa(masa) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of masa) {
    let pts;
    if (f.c) { const [cx, cy, r] = f.c; pts = [[cx - r, cy - r], [cx + r, cy + r]]; }
    else {
      const [x, y, w, h] = f.r;
      pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      if (f.rot) pts = pts.map((p) => girarPunto(p, f.rot, f.rc));
    }
    for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  }
  return { x0, y0, x1, y1 };
}
export function sello(D, conf = {}) {
  const c0 = cajaMasa(D.masa);
  const medida = (s) => {
    const tam = SELLO.cap / 0.7 / s, w = medir(SELLO.s, tam, { font: negra }) + 2 * SELLO.padX / s, h = SELLO.cap / s + 2 * SELLO.padY / s;
    const ancla = conf.ancla ?? "c";
    const xr = conf.x ?? (ancla === "l" ? c0.x0 : ancla === "r" ? c0.x1 : (c0.x0 + c0.x1) / 2);
    const x = ancla === "l" ? xr : ancla === "r" ? xr - w : xr - w / 2;
    const y = conf.y ?? c0.y1 + (conf.dy ?? -0.2);
    return { tam, w, h, x, y, sombra: SELLO.sombra / s };
  };
  let s = 0.9, m;
  for (let i = 0; i < 6; i++) {
    m = medida(s);
    const W = Math.max(c0.x1, m.x + m.w + m.sombra) - Math.min(c0.x0, m.x), H = Math.max(c0.y1, m.y + m.h + m.sombra) - Math.min(c0.y0, m.y);
    s = 50 / (Math.max(W, H) + 2 * BORDE);
  }
  caja(D.L, { x: m.x, y: m.y, w: m.w, h: m.h, fill: "tinta", borde: 0, sombra: m.sombra, sombraCol: "magenta", radio: m.h / 2 });
  const n0 = D.L.formas.length;
  const r = escribir(D.L, { s: SELLO.s, x: m.x + m.w / 2, y: m.y + m.h / 2 + SELLO.cap / s / 2, tam: m.tam, ancla: "c", color: "papel", font: negra });
  for (let i = n0; i < D.L.formas.length; i++) D.L.formas[i].clase = "sello";
  D.r(m.x, m.y, m.w + m.sombra, m.h + m.sombra);
  return r.cap;
}

const memo = new WeakMap();
/**
 * Dibuja un sticker ({ id, frase, dibujar(D, frase), sello? }), le pone la dirección y calcula su troquel. El troquel
 * tiene que salir de una sola pieza: si algo quedó suelto (un brillo lejos, una nota), la silueta se parte y avisa.
 */
export function troquel(st) {
  if (memo.has(st)) return memo.get(st);
  const D = new Dib();
  st.dibujar(D, st.frase);
  const capSello = sello(D, st.sello);
  const c = campo(D.masa, BORDE + MAX_SANGRE);
  const corte = silueta(c, BORDE);
  if (corte.length !== 1) throw new Error(`${st.id}: el troquel sale en ${corte.length} partes. Todo tiene que tocarse: acercá lo que quedó suelto`);
  const b = { D, c, corte, caja: cajaLazos(corte), capSello };
  memo.set(st, b);
  return b;
}

/**
 * Un sticker a tamaño real: la medida mayor del troquel es `cm`. Las formas tienen (0, 0) en la esquina del troquel y
 * vienen en orden: el fondo blanco (con `sangre` mm de sangrado), el dibujo y la línea de corte en la capa "corte".
 * `capMin` es la letra más chica de la frase en mm, y `capSello`, la de tinkazo.app.
 */
export function aMedida(st, cm, sangre = 0) {
  const b = troquel(st);
  const s = cm * 10 / Math.max(b.caja.w, b.caja.h);
  const fondo = sangre ? silueta(b.c, BORDE + sangre / s) : b.corte;
  const tr = (cmds) => afin(cmds, s, 0, 0, s, -b.caja.x * s, -b.caja.y * s);
  const formas = [
    { cmds: tr(aCmds(fondo)), fill: "#ffffff" },
    ...b.D.L.formas.map((f) => ({ ...f, cmds: tr(f.cmds) })),
    { cmds: tr(aCmds(b.corte)), trazo: "#ff00ff", grosor: 0.25, capa: "corte" },
  ];
  return { w: b.caja.w * s, h: b.caja.h * s, formas, capMin: b.D.caps.length ? Math.min(...b.D.caps) * s : Infinity, capSello: b.capSello * s, escala: s };
}

/** Mueve formas (en mm). */
export const mueve = (formas, dx, dy) => formas.map((f) => ({ ...f, cmds: afin(f.cmds, 1, 0, 0, 1, dx, dy) }));

/**
 * El PNG de formas medidas en mm, con fondo transparente, a `ppp` puntos por pulgada (300 para imprenta, 96 para ver en
 * pantalla a tamaño real). Lleva la resolución adentro (pHYs), así un programa de diseño lo abre a su medida.
 */
export function pngMm(formas, wMm, hMm, ppp = 300) {
  const e = ppp / 25.4, W = Math.max(1, Math.round(wMm * e)), H = Math.max(1, Math.round(hMm * e));
  const f = formas.filter((x) => x.fill).map((x) => ({ ...x, cmds: afin(x.cmds, e, 0, 0, e, 0, 0) }));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const phys = Buffer.alloc(9), ppm = Math.round(ppp / 0.0254);
  phys.writeUInt32BE(ppm); phys.writeUInt32BE(ppm, 4); phys[8] = 1;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("pHYs", phys), chunk("IDAT", deflateSync(rasterizar(f, W, H), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Una hoja: los stickers en una grilla de celdas de `cm`, con `aire` mm entre troqueles y `sangre` mm de sangrado. La
 * última fila va centrada. Las líneas de corte van al final, todas juntas en su capa.
 */
export function hoja(lista, { cm = 6, ancho = 210, alto = 297, cols = 3, aire = 5, sangre = 2 }) {
  const lado = cm * 10, filas = Math.ceil(lista.length / cols);
  const W = cols * lado + (cols - 1) * aire, H = filas * lado + (filas - 1) * aire;
  if (W > ancho || H > alto) throw new Error(`no entran: ${lista.length} de ${cm} cm en ${cols} columnas piden ${W} por ${H} mm y la hoja mide ${ancho} por ${alto}`);
  const x0 = (ancho - W) / 2, y0 = (alto - H) / 2;
  const formas = [];
  lista.forEach((st, k) => {
    const s = aMedida(st, cm, sangre);
    const fila = Math.floor(k / cols), col = k % cols;
    const n = Math.min(cols, lista.length - fila * cols);
    const dx = x0 + (cols - n) * (lado + aire) / 2 + col * (lado + aire) + (lado - s.w) / 2, dy = y0 + fila * (lado + aire) + (lado - s.h) / 2;
    formas.push(...mueve(s.formas, dx, dy));
  });
  return { ancho, alto, formas: [...formas.filter((f) => f.capa !== "corte"), ...formas.filter((f) => f.capa === "corte")] };
}
