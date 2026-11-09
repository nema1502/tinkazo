/**
 * La silueta de troquelado de un sticker: la unión de todo lo dibujado, agrandada un radio `d` con esquinas redondas,
 * sin huecos adentro. Se calcula sobre una grilla fina (un campo de distancias) y se traza como un polígono suave.
 * Con el mismo campo salen la línea de corte y el sangrado, que es la misma silueta un poco más grande.
 */
import { poli } from "./base.mjs";

/** ¿El punto (px, py) cae adentro de la forma? Las formas son rectángulos (con giro) o círculos. */
function adentro(f, px, py) {
  if (f.c) { const [cx, cy, r] = f.c; return (px - cx) ** 2 + (py - cy) ** 2 <= r * r; }
  let x = px, y = py;
  if (f.rot) {
    const a = -f.rot * Math.PI / 180, [cx, cy] = f.rc;
    const dx = px - cx, dy = py - cy;
    x = cx + dx * Math.cos(a) - dy * Math.sin(a); y = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  const [rx, ry, w, h] = f.r;
  return x >= rx && x <= rx + w && y >= ry && y <= ry + h;
}
/** La caja de una forma, ya girada. */
function cajaDe(f) {
  if (f.c) { const [cx, cy, r] = f.c; return [cx - r, cy - r, cx + r, cy + r]; }
  const [x, y, w, h] = f.r;
  let pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  if (f.rot) {
    const a = f.rot * Math.PI / 180, [cx, cy] = f.rc;
    pts = pts.map(([px, py]) => [cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)]);
  }
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** Distancia euclídea al cuadrado en una dimensión (Felzenszwalb y Huttenlocher). */
function edt1(f, n) {
  const d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; } while (k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  return d;
}

/**
 * El campo de distancias de un conjunto de formas: para cada celda de la grilla, a cuánto está de lo dibujado.
 * `margen` es cuánto se puede agrandar después (la silueta más grande que se va a pedir).
 */
export function campo(formas, margen, paso = 0.25) {
  const cajas = formas.map(cajaDe);
  const x0 = Math.min(...cajas.map((c) => c[0])) - margen - 2 * paso, y0 = Math.min(...cajas.map((c) => c[1])) - margen - 2 * paso;
  const x1 = Math.max(...cajas.map((c) => c[2])) + margen + 2 * paso, y1 = Math.max(...cajas.map((c) => c[3])) + margen + 2 * paso;
  const W = Math.ceil((x1 - x0) / paso), H = Math.ceil((y1 - y0) / paso);
  const INF = 1e12;
  const g = new Float64Array(W * H).fill(INF);
  formas.forEach((f, n) => {
    const [a, b, c, d] = cajas[n];
    for (let j = Math.max(0, Math.floor((b - y0) / paso)); j <= Math.min(H - 1, Math.ceil((d - y0) / paso)); j++) {
      for (let i = Math.max(0, Math.floor((a - x0) / paso)); i <= Math.min(W - 1, Math.ceil((c - x0) / paso)); i++) {
        if (g[j * W + i] && adentro(f, x0 + (i + 0.5) * paso, y0 + (j + 0.5) * paso)) g[j * W + i] = 0;
      }
    }
  });
  // Dos pasadas: columnas y filas.
  const col = new Float64Array(H);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) col[j] = g[j * W + i];
    const d = edt1(col, H);
    for (let j = 0; j < H; j++) g[j * W + i] = d[j];
  }
  const fila = new Float64Array(W);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) fila[i] = g[j * W + i];
    const d = edt1(fila, W);
    for (let i = 0; i < W; i++) g[j * W + i] = Math.sqrt(d[i]) * paso;
  }
  return { x0, y0, W, H, paso, dist: g };
}

/** Douglas-Peucker sobre un lazo abierto. */
function simplificar(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplificar(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplificar(pts.slice(idx), eps)];
}
/** Chaikin con el corte limitado: redondea sin comerse los lados largos. */
function suavizar(pts, vueltas, corteMax) {
  let p = pts;
  for (let v = 0; v < vueltas; v++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const t = Math.min(0.25, corteMax / (L || 1));
      q.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [a[0] + (b[0] - a[0]) * (1 - t), a[1] + (b[1] - a[1]) * (1 - t)]);
    }
    p = q;
  }
  return p;
}

/**
 * La silueta a distancia `d` de lo dibujado, sin huecos, como lista de polígonos [[x, y], ...] (casi siempre uno).
 */
export function silueta(c, d) {
  const { x0, y0, W, H, paso, dist } = c;
  const lleno = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) lleno[k] = dist[k] <= d ? 1 : 0;
  // Sin huecos: lo que no se alcanza desde el borde de la grilla es adentro.
  const afuera = new Uint8Array(W * H), pila = [];
  for (let i = 0; i < W; i++) pila.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) pila.push(j * W, j * W + W - 1);
  while (pila.length) {
    const k = pila.pop();
    if (afuera[k] || lleno[k]) continue;
    afuera[k] = 1;
    const i = k % W, j = (k - i) / W;
    if (i > 0) pila.push(k - 1); if (i < W - 1) pila.push(k + 1); if (j > 0) pila.push(k - W); if (j < H - 1) pila.push(k + W);
  }
  const den = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !afuera[j * W + i];
  // Aristas del borde, con el interior a la derecha; se encadenan en lazos.
  const sig = new Map();
  const arista = (a, b) => { const k = a[0] * 100003 + a[1]; (sig.get(k) ?? sig.set(k, []).get(k)).push(b); };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!den(i, j)) continue;
    if (!den(i, j - 1)) arista([i, j], [i + 1, j]);
    if (!den(i + 1, j)) arista([i + 1, j], [i + 1, j + 1]);
    if (!den(i, j + 1)) arista([i + 1, j + 1], [i, j + 1]);
    if (!den(i - 1, j)) arista([i, j + 1], [i, j]);
  }
  const lazos = [];
  for (const [k0, lista] of sig) {
    while (lista.length) {
      const inicio = [Math.floor(k0 / 100003), k0 % 100003];
      const pts = [inicio];
      let p = lista.pop();
      while (!(p[0] === inicio[0] && p[1] === inicio[1])) {
        pts.push(p);
        p = sig.get(p[0] * 100003 + p[1]).pop();
      }
      if (pts.length < 8) continue;
      // A unidades del dibujo, simplificado y redondeado.
      const enU = pts.map(([i, j]) => [x0 + i * paso, y0 + j * paso]);
      // Un lazo cerrado se parte en el punto más lejano del inicio: dos mitades abiertas.
      let lejos = 0;
      enU.forEach((q, i) => { if (Math.hypot(q[0] - enU[0][0], q[1] - enU[0][1]) > Math.hypot(enU[lejos][0] - enU[0][0], enU[lejos][1] - enU[0][1])) lejos = i; });
      const eps = paso * 1.4;
      const cerrado = [...simplificar(enU.slice(0, lejos + 1), eps).slice(0, -1), ...simplificar([...enU.slice(lejos), enU[0]], eps).slice(0, -1)];
      lazos.push(suavizar(cerrado, 2, paso * 2.4));
    }
  }
  return lazos;
}
/** Los polígonos como órdenes de trazado. */
export const aCmds = (lazos) => lazos.flatMap((l) => poli(l));
/** La caja de una lista de polígonos. */
export function cajaLazos(lazos) {
  const xs = lazos.flat().map((p) => p[0]), ys = lazos.flat().map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
