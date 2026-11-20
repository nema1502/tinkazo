/**
 * Las hojas de la serie de los departamentos: cómo se acomodan los troqueles y qué lleva cada hoja.
 *
 * Una hoja es una grilla. Cada columna mide lo que mide su sticker más ancho y cada fila, el más alto, con 5 mm de aire
 * como mínimo entre troqueles y 10 mm de margen contra el borde del papel. El tamaño de los stickers (la medida mayor
 * del troquel) se elige para llenar la hoja: el más grande que entra. Si sobra lugar en un sentido, el aire entre
 * troqueles se reparte parejo, así la hoja no queda con un hueco en un costado.
 *
 * El orden alterna los colores: se mide qué colores lleva cada sticker (a partir del dibujo, sin contar el blanco del
 * borde ni la tinta del contorno) y se busca el orden en que los vecinos, de lado y de arriba abajo, menos se parecen.
 * Los de un mismo departamento se mantienen juntos y la búsqueda usa una semilla fija: la misma hoja sale siempre igual.
 */
import { rasterizar, azar, afin } from "../base.mjs";
import { Lienzo, escribir, etiqueta, franja, caja } from "../dibujo.mjs";
import { aMedida, mueve } from "../pincel.mjs";

// ───────────────────────── Colores de un sticker ─────────────────────────
const BINES = 14; // 12 tonos, uno para los neutros (crema, gris, madera apagada) y uno que no se usa
export const NOMBRES_TONO = ["rojo", "naranja", "amarillo", "lima", "verde", "verde agua", "turquesa", "azul", "violeta", "morado", "magenta", "rosa", "neutro"];
const cacheHuella = new Map();

/**
 * El histograma de colores de un sticker: qué parte de su dibujo cae en cada tono. Ignora lo blanco, lo oscuro, lo
 * transparente y el magenta de la marca (la llama está en todos y los haría parecer iguales).
 */
export function huella(st) {
  if (cacheHuella.has(st.id)) return cacheHuella.get(st.id);
  const v = aMedida(st, 5, 0), e = 30 / 25.4;
  const W = Math.max(1, Math.round(v.w * e)), H = Math.max(1, Math.round(v.h * e));
  const formas = v.formas.filter((f) => f.fill).map((f) => ({ ...f, cmds: afin(f.cmds, e, 0, 0, e, 0, 0) }));
  const raw = rasterizar(formas, W, H), h = new Float64Array(BINES);
  let total = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * (W * 4 + 1) + 1 + x * 4;
    if (raw[i + 3] < 200) continue;
    const r = raw[i] / 255, g = raw[i + 1] / 255, b = raw[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
    if (mx < 0.3) continue; // la tinta del contorno y las sombras
    if (Math.hypot(raw[i] - 233, raw[i + 1] - 61, raw[i + 2] - 156) < 40) continue; // el magenta de la llama está en todos: no distingue
    if (s < 0.18) { if (mx > 0.92) continue; h[12]++; total++; continue; } // el borde blanco no cuenta
    const d = mx - mn;
    let tono = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h[Math.floor(tono * 60 / 30) % 12]++;
    total++;
  }
  const norm = Float64Array.from(h, (c) => (total ? c / total : 0));
  cacheHuella.set(st.id, norm);
  return norm;
}
/** Cuánto se parecen dos stickers en colores, de 0 (nada) a 1 (iguales): lo que tienen en común sus histogramas. */
export function parecido(a, b) {
  const ha = huella(a), hb = huella(b);
  let s = 0;
  for (let i = 0; i < BINES; i++) s += Math.min(ha[i], hb[i]);
  return s;
}
/** Los tonos que más pesan en un sticker, para contarlos en el informe. */
export function tonos(st, n = 2) {
  const h = huella(st);
  return [...h].map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, n).filter(([p]) => p > 0.08).map(([p, i]) => `${NOMBRES_TONO[i]} ${Math.round(p * 100)} %`);
}

// ───────────────────────── El orden ─────────────────────────
/**
 * El costo de un orden: para cada par de vecinos (de lado, de arriba abajo y, con menos peso, en diagonal) el parecido
 * al cuadrado, para que pese más juntar dos casi iguales que dos algo parecidos.
 */
export function costoVecinos(lista, cols) {
  let c = 0;
  const filas = Math.ceil(lista.length / cols);
  const en = (f, k) => (f < filas && k < cols && f * cols + k < lista.length ? lista[f * cols + k] : null);
  for (let f = 0; f < filas; f++) for (let k = 0; k < cols; k++) {
    const a = en(f, k);
    for (const [df, dk, peso] of [[0, 1, 1], [1, 0, 1], [1, 1, 0.45], [1, -1, 0.45]]) {
      const b = en(f + df, k + dk);
      if (a && b) c += peso * parecido(a, b) ** 2;
    }
  }
  return c;
}

/**
 * Busca el orden que menos junta colores parecidos. `bloques` es una lista de tamaños (los stickers de cada bloque solo
 * se cambian entre sí: un departamento, una fila). Recocido simulado con semilla fija y un pequeño costo por alejarse
 * del orden de partida, que desempata a favor del orden pensado (la postal primero, por ejemplo).
 */
export function ordenar(lista, { cols, bloques = [lista.length], semilla = 7, rondas = 24, pasos = 3000, apego = 0.012 }) {
  const rng = azar(semilla);
  const inicio = lista.map((_, i) => i);
  const desde = []; // el bloque de cada posición
  bloques.reduce((a, n, b) => { for (let i = a; i < a + n; i++) desde[i] = b; return a + n; }, 0);
  const costo = (perm) => costoVecinos(perm.map((i) => lista[i]), cols) + apego * perm.reduce((s, i, pos) => s + Math.abs(i - pos), 0) / lista.length;
  let mejor = inicio.slice(), mejorCosto = costo(mejor);
  for (let r = 0; r < rondas; r++) {
    const perm = inicio.slice();
    if (r) { // una mezcla al azar dentro de cada bloque
      let a = 0;
      for (const n of bloques) {
        for (let i = a + n - 1; i > a; i--) { const j = a + Math.floor(rng() * (i - a + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
        a += n;
      }
    }
    let c = costo(perm);
    for (let p = 0; p < pasos; p++) {
      const T = 0.35 * (1 - p / pasos) + 1e-4;
      const i = Math.floor(rng() * lista.length);
      const b = desde[i];
      let j = i;
      for (let t = 0; t < 8 && (j === i || desde[j] !== b); t++) j = Math.floor(rng() * lista.length);
      if (j === i || desde[j] !== b) continue;
      [perm[i], perm[j]] = [perm[j], perm[i]];
      const c2 = costo(perm);
      if (c2 <= c || rng() < Math.exp((c - c2) / T)) { c = c2; if (c < mejorCosto - 1e-12) { mejorCosto = c; mejor = perm.slice(); } } else [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }
  return mejor.map((i) => lista[i]);
}

// ───────────────────────── La grilla ─────────────────────────
const dimsCache = new WeakMap();
const dimsDe = (st) => {
  if (!dimsCache.has(st)) { const m = aMedida(st, 5, 0); dimsCache.set(st, { w: m.w, h: m.h }); }
  return dimsCache.get(st);
};

/** Las medidas de la grilla si los stickers miden `cm` (la medida mayor): ancho de cada columna, alto de cada fila y el bloque entero. */
function grilla(lista, cols, cm, aire) {
  const filas = Math.ceil(lista.length / cols), k = cm / 5;
  const colW = Array(cols).fill(0), rowH = Array(filas).fill(0);
  lista.forEach((st, i) => {
    const d = dimsDe(st), f = Math.floor(i / cols), c = i % cols;
    colW[c] = Math.max(colW[c], d.w * k); rowH[f] = Math.max(rowH[f], d.h * k);
  });
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  return { filas, colW, rowH, W: sum(colW) + (cols - 1) * aire, H: sum(rowH) + (filas - 1) * aire };
}

/** El `cm` mayor (de a 0,1) con el que la grilla entra en el lugar disponible. */
export function mejorCm(lista, { cols, aire = 5, libreX, libreY, tope = 8 }) {
  let mejor = 0;
  for (let d = 30; d <= tope * 10 + 1e-9; d++) {
    const cm = d / 10, g = grilla(lista, cols, cm, aire);
    if (g.W <= libreX + 1e-9 && g.H <= libreY + 1e-9) mejor = cm; else break;
  }
  return mejor;
}

/**
 * Una hoja armada: los stickers en su grilla, con su sangrado y la línea de corte de todos al final, en su capa.
 * `arriba` y `abajo` reservan lugar desde el borde del papel para un título o un pie (nunca menos que el margen).
 * Devuelve las formas, el cm usado y los troqueles (para medir que no se toquen).
 */
export function armarHoja(lista, { ancho, alto, cols, cm, aire = 5, sangre = 2, margen = 10, arriba = 0, abajo = 0, repartir = 13 }) {
  const top = Math.max(margen, arriba), bot = Math.max(margen, abajo);
  const libreX = ancho - 2 * margen, libreY = alto - top - bot;
  if (lista.length % cols) throw new Error(`${lista.length} stickers no llenan filas de ${cols}`);
  const usado = cm ?? mejorCm(lista, { cols, aire, libreX, libreY });
  const g = grilla(lista, cols, usado, aire);
  if (g.W > libreX + 1e-6 || g.H > libreY + 1e-6) throw new Error(`no entran: ${lista.length} de ${usado} cm piden ${g.W.toFixed(1)} por ${g.H.toFixed(1)} mm y hay ${libreX} por ${libreY}`);
  // Lo que sobra se reparte en el aire entre troqueles, hasta `repartir` mm; si todavía sobra, queda en los bordes.
  const gapX = cols > 1 ? Math.min(repartir, aire + (libreX - g.W) / (cols - 1)) : aire;
  const gapY = g.filas > 1 ? Math.min(repartir, aire + (libreY - g.H) / (g.filas - 1)) : aire;
  const W = g.colW.reduce((s, v) => s + v, 0) + (cols - 1) * gapX, H = g.rowH.reduce((s, v) => s + v, 0) + (g.filas - 1) * gapY;
  const x0 = (ancho - W) / 2, y0 = top + (libreY - H) / 2;
  const xs = [], ys = [];
  g.colW.reduce((a, w, c) => { xs[c] = a; return a + w + gapX; }, x0);
  g.rowH.reduce((a, h, f) => { ys[f] = a; return a + h + gapY; }, y0);
  const formas = [], celdas = [];
  lista.forEach((st, i) => {
    const f = Math.floor(i / cols), c = i % cols, s = aMedida(st, usado, sangre);
    const dx = xs[c] + (g.colW[c] - s.w) / 2, dy = ys[f] + (g.rowH[f] - s.h) / 2;
    formas.push(...mueve(s.formas, dx, dy));
    celdas.push({ id: st.id, x: dx, y: dy, w: s.w, h: s.h });
  });
  return { ancho, alto, cm: usado, gapX, gapY, formas: [...formas.filter((x) => x.capa !== "corte"), ...formas.filter((x) => x.capa === "corte")], celdas };
}

/** Lo que mide una hoja armada: el aire más chico entre troqueles, el margen más chico contra el papel y cuánto papel ocupan. */
export function medirHoja(h) {
  let aire = Infinity, margen = Infinity;
  for (const a of h.celdas) {
    margen = Math.min(margen, a.x, a.y, h.ancho - a.x - a.w, h.alto - a.y - a.h);
    for (const b of h.celdas) {
      if (a === b) continue;
      const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
      aire = Math.min(aire, Math.hypot(dx, dy));
    }
  }
  const area = h.celdas.reduce((s, a) => s + a.w * a.h, 0);
  return { aire, margen, ocupa: area / (h.ancho * h.alto) };
}

// ───────────────────────── El título de la hoja grande ─────────────────────────
/**
 * El encabezado y el pie de la A3: una placa amarilla con la llama y el título, una línea que lo explica y la dirección.
 * Es parte del impreso (queda en el vinilo que sobra al cortar), no de los troqueles.
 */
export function marcosA3(ancho, alto, arriba, abajo) {
  const l = new Lienzo(ancho, alto, "claro");
  franja(l, { x: 0, y: 0, w: ancho, h: 3.2, n: 25 });
  const cx = ancho / 2;
  etiqueta(l, { s: "Bolivia en stickers", x: cx, y: 13.5, tam: 11.5, fill: "amarillo", ancla: "c", llama: true, borde: 0.9, sombra: 1.7, rot: -1.2, rc: [cx, 13.5 + 11.5 * 1.9 / 2] });
  escribir(l, { s: "Los nueve departamentos, el Tinku y los tiernos", x: cx, y: 41.5, tam: 5, ancla: "c", color: "tinta" });
  // El pie: la dirección en una pastilla de tinta, como la etiqueta de cada sticker.
  const tam = 4.6, w = 30, h = 8.2, by = alto - abajo + (abajo - h) / 2 - 1;
  caja(l, { x: cx - w / 2, y: by, w, h, fill: "tinta", borde: 0, sombra: 0.9, sombraCol: "magenta", radio: h / 2 });
  escribir(l, { s: "tinkazo.app", x: cx, y: by + h / 2 + tam * 0.35, tam, ancla: "c", color: "papel" });
  return l.formas;
}

