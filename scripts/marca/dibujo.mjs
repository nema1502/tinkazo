/**
 * Un lienzo de formas planas para las piezas de marca: texto en trazos, cajas con borde de tinta y sombra dura,
 * franja de cinco colores, banderines de papel picado, confeti, rayas de velocidad y la llama con contorno.
 * Todo con relleno plano (sin degradados, sin brillos): sirve igual para PNG, SVG y PDF.
 */
import { negra, texto, mover, rotar, rect, circulo, redondeado, poli, llamaCmds, anchoLlama, rects, PAL, ACENTOS } from "./base.mjs";
import { cmdsQr, matrizQr, ZONA } from "./qr.mjs";

export class Lienzo {
  constructor(w, h, tema) { this.w = w; this.h = h; this.tema = tema; this.p = PAL[tema]; this.formas = []; }
  c(n) { return this.p[n] ?? n; }
  add(cmds, fill, extra = {}) { if (cmds.length) this.formas.push({ cmds, fill: this.c(fill), ...extra }); }
  fondo(color = "papel") { this.add(rect(0, 0, this.w, this.h), color); }
  rect(x, y, w, h, color, grados = 0) { this.add(grados ? rotar(rect(x, y, w, h), grados, x + w / 2, y + h / 2) : rect(x, y, w, h), color); }
}

/**
 * Escribe texto en trazos. `tam` es el cuerpo de la letra; con `ajustar` el texto se estira hasta ese ancho exacto y con
 * `maximo` solo se achica si no entra. `esp` es el espaciado en em. `colorDe(i, letra)` pinta letra por letra.
 */
export function escribir(l, { s, x, y, tam = 100, font = negra, color = "tinta", esp = 0, ancla = "l", ajustar, maximo, rot = 0, rc, colorDe }) {
  const t = texto(font, s, 100, esp * 100);
  let e = tam / 100;
  if (ajustar) e = ajustar / t.ancho;
  else if (maximo && t.ancho * e > maximo) e = maximo / t.ancho;
  const ancho = t.ancho * e;
  const tx = ancla === "c" ? x - ancho / 2 : ancla === "r" ? x - ancho : x;
  const grupos = new Map();
  t.glifos.forEach((g, i) => {
    const col = colorDe ? colorDe(i, g.ch) : color;
    if (!grupos.has(col)) grupos.set(col, []);
    grupos.get(col).push(...mover(g.cmds, e, tx, y));
  });
  for (const [col, cmds] of grupos) l.add(rot ? rotar(cmds, rot, ...(rc ?? [x, y])) : cmds, col);
  return { ancho, cap: t.mayuscula * e, tam: e * 100, x0: tx, x1: tx + ancho, y };
}
/** Ancho que tendría un texto, sin dibujarlo. */
export const medir = (s, tam, { font = negra, esp = 0 } = {}) => texto(font, s, 100, esp * 100).ancho * tam / 100;

/** Una caja con borde de tinta y sombra dura (sin desenfoque), como los botones y tarjetas del sitio. */
export function caja(l, { x, y, w, h, fill = "tarjeta", borde = 3, sombra = 6, sombraCol = "tinta", tinta = "tinta", radio = 0, rot = 0, rc }) {
  const forma = (xx, yy, ww, hh, r) => (r > 0 ? redondeado(xx, yy, ww, hh, r) : rect(xx, yy, ww, hh));
  const giro = (cmds) => (rot ? rotar(cmds, rot, ...(rc ?? [x + w / 2, y + h / 2])) : cmds);
  if (sombra) l.add(giro(forma(x + sombra, y + sombra, w, h, radio)), sombraCol);
  l.add(giro(forma(x, y, w, h, radio)), tinta);
  l.add(giro(forma(x + borde, y + borde, w - 2 * borde, h - 2 * borde, Math.max(0, radio - borde))), fill);
}
/** Una pastilla con texto adentro. Devuelve su caja. */
export function etiqueta(l, { s, x, y, tam, fill = "amarillo", color = "sobre", font = negra, esp = 0, relleno, borde, sombra, sombraCol, rot = 0, rc, ancla = "l", llama, radio = 0, colorDe, u = 1 }) {
  const pad = relleno ?? tam * 0.5;
  const tw = medir(s, tam, { font, esp });
  const ll = llama ? anchoLlama(tam * 1.25) + pad * 0.6 : 0;
  const w = tw + 2 * pad + ll, h = tam * 1.9;
  const bx = ancla === "c" ? x - w / 2 : ancla === "r" ? x - w : x;
  caja(l, { x: bx, y, w, h, fill, borde: borde ?? Math.max(2 * u, tam * 0.09), sombra: sombra ?? Math.max(3 * u, tam * 0.16), sombraCol, radio: radio === true ? h / 2 : radio, rot, rc: rc ?? [bx + w / 2, y + h / 2] });
  const cx = bx + w / 2, cy = y + h / 2;
  const base = y + h / 2 + tam * 0.36; // la mayúscula de Montserrat mide ~0,70 em
  const rc2 = rc ?? [cx, cy];
  if (llama) l.add(rot ? rotar(llamaCmds(bx + pad, y + h / 2 - tam * 0.625, tam * 1.25), rot, ...rc2) : llamaCmds(bx + pad, y + h / 2 - tam * 0.625, tam * 1.25), "magenta");
  escribir(l, { s, x: bx + pad + ll, y: base, tam, font, esp, color, rot, rc: rc2, colorDe });
  return { x: bx, y, w, h };
}

/** La franja de cinco colores de la cabecera del sitio. Los bloques se solapan 1 unidad: sin costuras. */
export function franja(l, { x = 0, y = 0, w = l.w, h, n = 10 }) {
  const por = Array.from({ length: 5 }, () => []);
  for (let i = 0; i < n; i++) {
    const a = Math.round(x + w * i / n), b = Math.round(x + w * (i + 1) / n);
    por[i % 5].push(...rect(a, y, b - a + 1, h));
  }
  ACENTOS.forEach((nom, k) => l.add(por[k], nom));
}

/** Papel picado: un hilo con banderines de colores y un calado en cada uno. */
export function banderines(l, { x0, x1, y, n, alto, sag = 0, hilo = 3, colores = ACENTOS, ancho, fondoCalado = "papel" }) {
  const ws = ancho ?? (x1 - x0) / n * 0.86;
  const P = (t) => [x0 + t * (x1 - x0), y + sag * 4 * t * (1 - t)];
  const tinta = [], por = new Map(), calado = [];
  const seg = 40;
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = P(i / seg), [bx, by] = P((i + 1) / seg);
    tinta.push(...poli([[ax, ay - hilo / 2], [bx + 0.6, by - hilo / 2], [bx + 0.6, by + hilo / 2], [ax, ay + hilo / 2]]));
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, dt = ws / 2 / (x1 - x0);
    const a = P(t - dt), b = P(t + dt), m = P(t);
    const col = colores[i % colores.length];
    if (!por.has(col)) por.set(col, []);
    por.get(col).push(...poli([[a[0], a[1] - hilo / 2], [b[0], b[1] - hilo / 2], [m[0], m[1] + alto]]));
    const cy = m[1] + alto * 0.3, r = alto * 0.11;
    calado.push(...poli([[m[0], cy - r], [m[0] + r, cy], [m[0], cy + r], [m[0] - r, cy]]));
  }
  l.add(tinta, "tinta");
  for (const [col, cmds] of por) l.add(cmds, col);
  l.add(calado, fondoCalado);
}

/** Confeti plano: cuadrados, tiras, triángulos y puntos que giran, esquivando las zonas con texto. */
export function confeti(l, { rng, n, area, evitar = [], tam = [8, 18], colores = ACENTOS, separacion = 1.6 }) {
  const por = new Map(), puestos = [];
  let intentos = 0;
  while (puestos.length < n && intentos++ < n * 60) {
    const s = tam[0] + rng() * (tam[1] - tam[0]);
    const x = area[0] + rng() * area[2], y = area[1] + rng() * area[3];
    const m = s * 1.2;
    if (evitar.some(([ex, ey, ew, eh]) => x + m > ex && x - m < ex + ew && y + m > ey && y - m < ey + eh)) continue;
    if (puestos.some(([px, py, ps]) => Math.hypot(px - x, py - y) < (ps + s) * separacion * 0.6)) continue;
    puestos.push([x, y, s]);
    const tipo = Math.floor(rng() * 4), g = rng() * 360;
    const col = colores[Math.floor(rng() * colores.length)];
    let cmds;
    if (tipo === 0) cmds = rotar(rect(x - s / 2, y - s / 2, s, s), g, x, y);
    else if (tipo === 1) cmds = rotar(rect(x - s * 0.9, y - s * 0.22, s * 1.8, s * 0.44), g, x, y);
    else if (tipo === 2) cmds = rotar(poli([[x - s * 0.6, y + s * 0.5], [x + s * 0.6, y + s * 0.5], [x, y - s * 0.6]]), g, x, y);
    else cmds = circulo(x, y, s * 0.36);
    if (!por.has(col)) por.set(col, []);
    por.get(col).push(...cmds);
  }
  for (const [col, cmds] of por) l.add(cmds, col);
  return puestos;
}

/** Rayas de velocidad: barras planas horizontales que terminan en `xFin` (la llama va delante). */
export function rayas(l, { xFin, y, largos, grosor, sep, colores = ["naranja", "amarillo", "turquesa", "morado"], borde = 0 }) {
  largos.forEach((lg, i) => {
    const yy = y + i * (grosor + sep);
    if (borde) l.rect(xFin - lg - borde, yy - borde, lg + 2 * borde, grosor + 2 * borde, "tinta");
    l.rect(xFin - lg, yy, lg, grosor, colores[i % colores.length]);
  });
}

/** La llama con contorno de tinta y sombra dura. (x, y) es la esquina de su caja de `alto` de alto. */
export function llamaGrande(l, { x, y, alto, color = "magenta", contorno = 0, sombra = 0, sombraCol = "tinta", tinta = "tinta", rot = 0, rc }) {
  const k = alto / 26;
  const rr = rects.map(([rx, ry, w, h]) => [x + rx * k, y + (ry + 2) * k, w * k, h * k]);
  const exp = (d, dx = 0, dy = 0) => rr.flatMap(([a, b, w, h]) => rect(a - d + dx, b - d + dy, w + 2 * d, h + 2 * d));
  const giro = (cmds) => (rot ? rotar(cmds, rot, ...(rc ?? [x + anchoLlama(alto) / 2, y + alto / 2])) : cmds);
  if (sombra) l.add(giro(exp(contorno, sombra, sombra)), sombraCol);
  if (contorno) l.add(giro(exp(contorno)), tinta);
  l.add(giro(exp(0)), color);
}

/** Un tilde de píxeles, a juego con la llama. Cuadrícula de 9 por 7 celdas. */
export function tilde(l, { x, y, celda, color = "sobre" }) {
  const filas = ["........X", ".......XX", "X.....XX.", "XX...XX..", ".XX.XX...", "..XXX....", "...X....."];
  const cmds = [];
  filas.forEach((f, j) => [...f].forEach((ch, i) => { if (ch === "X") cmds.push(...rect(x + i * celda - 0.01, y + j * celda - 0.01, celda + 0.02, celda + 0.02)); }));
  l.add(cmds, color);
  return { ancho: 9 * celda, alto: 7 * celda };
}

/** La placa blanca con el QR adentro (módulos siempre en tinta oscura para que lo lea cualquier cámara). */
export function placaQr(l, { texto: url, x, y, lado, borde = 3, sombra = 6, sombraCol = "tinta" }) {
  const { n } = matrizQr(url);
  const modulo = (lado - 2 * borde) / (n + 2 * ZONA);
  caja(l, { x, y, w: lado, h: lado, fill: "#ffffff", borde, sombra, sombraCol });
  const q = cmdsQr(url, x + borde + ZONA * modulo, y + borde + ZONA * modulo, n * modulo);
  l.add(q.cmds, "#191919", { clase: "qr" });
  return { n, modulo };
}

/** Un recuadro punteado (de rectángulos chicos). */
export function punteado(l, { x, y, w, h, grosor, trazo, hueco, color = "apagado" }) {
  const cmds = [];
  const lado = (x0, y0, largo, horiz) => {
    const n = Math.max(1, Math.round((largo - trazo) / (trazo + hueco)));
    const paso = (largo - trazo) / n;
    for (let i = 0; i <= n; i++) cmds.push(...(horiz ? rect(x0 + i * paso, y0, trazo, grosor) : rect(x0, y0 + i * paso, grosor, trazo)));
  };
  lado(x, y, w, true); lado(x, y + h - grosor, w, true);
  lado(x, y, h, false); lado(x + w - grosor, y, h, false);
  l.add(cmds, color);
}
