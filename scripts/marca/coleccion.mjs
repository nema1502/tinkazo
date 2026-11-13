/**
 * La colección de stickers con personaje: los diez juegos numerados para completar la serie (sin sobres sorpresa:
 * cada uno se elige), el especial de Tarija, la llama en sus días buenos, frases nuestras y una tanda para quienes programan.
 *
 * Todo se dibuja acá con formas planas: pixel art como el logo, unas pocas formas limpias y las letras de Montserrat
 * en trazos. La llama sigue sin cara ni poncho: lo tierno sale de la pose y de lo que la acompaña. Los demás
 * personajes (el sapo, el guajojó, la bailarina) sí tienen ojos, como en los juegos.
 *
 * Cada sticker se troquela por su silueta: la unión de lo dibujado, agrandada un borde blanco, con 3 mm de sangrado
 * y la línea de corte en una capa aparte. Todos llevan tinkazo.app en una etiqueta chica abajo. Sale en 5 y 7 cm (SVG y
 * PDF), en hojas A4 y A3 y en PNG transparente.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { negra, seminegra, rect, circulo, redondeado, poli, afin, rotar, rects as RECTS_LLAMA, anchoLlama, contornoUnion, rasterizar, pngNivel, pdf, svgMm, zip, azar } from "./base.mjs";
import { Lienzo, escribir, caja, medir, banderines, llamaGrande, tilde } from "./dibujo.mjs";
import { campo, silueta, aCmds, cajaLazos } from "./silueta.mjs";

// ───────────────────────── Colores ─────────────────────────
// Los de la marca (por nombre, del tema claro) y los de los personajes, tomados de los juegos.
const C = {
  blanco: "#ffffff", noche: "#2b2357", estrella: "#fff6e9",
  rojoBo: "#d52b1e", amarilloBo: "#f9e300", verdeBo: "#007934",
  pluma: "#8b7f72", plumaClara: "#b7ab9b", pico: "#4a3f36", rama: "#7a4f2a",
  rosa: "#f79cc8", tronco: "#7fb069", troncoOsc: "#5e8f4c", espina: "#f4efd6",
  madera: "#c98a4b", maderaOsc: "#8d5a2b", metal: "#b9c0c8",
  cielo: "#bfe3f2", nieve: "#ffffff", cerro: "#8a73e8", cerroOsc: "#6c4ce0",
  corazon: "#ff4d6d", fantasma: "#f3eee6", barra: "#e9e2d4",
  piel1: "#c68b59", piel2: "#8d5524", piel3: "#e0ac69", piel4: "#a0673f", pelo: "#3b2418", mejilla: "#f08aa8",
  // El sapo de bronce de la mesa del juego y su cajón.
  bronce: "#d39a36", bronceOsc: "#9a6520", bronceClaro: "#f3d27a", tapa: "#e2a868", agujero: "#4a2c14",
  // El guajojó: plumas de corteza y la luna.
  plumaOsc: "#5e5247", luna: "#fff0b3", lunaOsc: "#f2d77a",
  // El toborochi: tronco verde botella y flores rosadas de centro crema.
  troncoClaro: "#a9cf8c", flor: "#f58fc1", florOsc: "#d9529a", florClara: "#ffd0e6", florCentro: "#fff4c2",
  // Tarija: el sombrero chapaco, las uvas y los viñedos del valle.
  paja: "#f4e2b0", pajaOsc: "#d9bd78", uva: "#7d3c98", uvaClara: "#b07cc6", hoja: "#4f9a3a", cerroVerde: "#8cc66b",
  cerroVerdeOsc: "#5f9e4a", vid: "#2f6b2a", cieloTarde: "#ffe2a8", cieloNoche: "#1f1a45", sol: "#ffb636",
};
/** Las letras de los sprites: '.' es vacío. */
const BASE = { k: "tinta", w: C.blanco, p: "papel", m: "magenta", n: "naranja", a: "amarillo", t: "turquesa", v: "morado" };

// ───────────────────────── El dibujante ─────────────────────────
/** Un lienzo más la "masa": las formas que ocupa lo dibujado, para calcular la silueta del troquel. */
class Dib {
  constructor(lang) { this.L = new Lienzo(60, 60, "claro"); this.masa = []; this.lang = lang; this.caps = []; }
  r(x, y, w, h, rot = 0, rc) { this.masa.push({ r: [x, y, w, h], rot, rc }); }
  c(cx, cy, r) { this.masa.push({ c: [cx, cy, r] }); }
}

/**
 * Pixel art: `filas` es una lista de cadenas y cada letra un color ('.' vacío). Primero va el contorno de tinta (cada
 * píxel agrandado `borde`) y la sombra dura, después los colores, con los píxeles seguidos de una fila juntos.
 */
function pixeles(D, filas, { x, y, p, col = {}, borde = 0.8, sombra = 0, rot = 0, rc }) {
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
    if (!c) throw new Error(`color desconocido: ${ch}`);
    if (!por.has(c)) por.set(c, []);
    por.get(c).push(...rect(x + i * p - e, y + j * p - e, n * p + 2 * e, p + 2 * e));
  }
  for (const [c, cmds] of por) D.L.add(g(cmds), c);
  for (const [i, j, n] of solidos) D.r(x + i * p - borde, y + j * p - borde, n * p + 2 * borde + sombra, p + 2 * borde + sombra, rot, centro);
  return { w: W * p, h: H * p };
}

/** La llama del logo, con contorno y sombra dura. */
function llama(D, { x, y, alto, color = "magenta", contorno = 0.8, sombra = 1.2, rot = 0 }) {
  llamaGrande(D.L, { x, y, alto, color, contorno, sombra, rot });
  const k = alto / 26, rc = [x + anchoLlama(alto) / 2, y + alto / 2];
  for (const [rx, ry, w, h] of RECTS_LLAMA) D.r(x + rx * k - contorno, y + (ry + 2) * k - contorno, w * k + 2 * contorno + sombra, h * k + 2 * contorno + sombra, rot, rc);
}
/** Rectángulos sueltos [x, y, w, h] en una grilla de `k`, con contorno y sombra (para la llama en otras poses). */
function bloques(D, rs, { x, y, k, color, contorno = 0.8, sombra = 1.2 }) {
  const rr = rs.map(([a, b, w, h]) => [x + a * k, y + b * k, w * k, h * k]);
  const exp = (d, dx = 0, dy = 0) => rr.flatMap(([a, b, w, h]) => rect(a - d + dx, b - d + dy, w + 2 * d, h + 2 * d));
  if (sombra) D.L.add(exp(contorno, sombra, sombra), "tinta");
  D.L.add(exp(contorno), "tinta");
  D.L.add(exp(0), color);
  for (const [a, b, w, h] of rr) D.r(a - contorno, b - contorno, w + 2 * contorno + sombra, h + 2 * contorno + sombra);
}
/** Un disco con borde de tinta y sombra dura. */
function disco(D, cx, cy, r, fill, { borde = 0.8, sombra = 1.2 } = {}) {
  if (sombra) D.L.add(circulo(cx + sombra, cy + sombra, r + borde), "tinta");
  D.L.add(circulo(cx, cy, r + borde), "tinta");
  D.L.add(circulo(cx, cy, r), fill);
  D.c(cx + sombra / 2, cy + sombra / 2, r + borde + sombra / 2);
}
/** Un polígono con borde (el mismo agrandado desde su centro). */
function poliBorde(D, pts, fill, { borde = 0.8 } = {}) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const grande = pts.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / d * borde * 1.6, y + (y - cy) / d * borde * 1.6]; });
  D.L.add(poli(grande), "tinta");
  D.L.add(poli(pts), fill);
  const xs = grande.map((p) => p[0]), ys = grande.map((p) => p[1]);
  return { grande, caja: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
}
/** Un arco grueso (líneas de movimiento). */
function arco(D, cx, cy, r, a0, a1, grosor, color = "tinta") {
  const n = 16, pts = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([cx + (r + grosor / 2) * Math.cos(a), cy + (r + grosor / 2) * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push([cx + (r - grosor / 2) * Math.cos(a), cy + (r - grosor / 2) * Math.sin(a)]); }
  D.L.add(poli(pts), color);
  for (let i = 0; i <= 4; i++) { const a = (a0 + (a1 - a0) * i / 4) * Math.PI / 180; D.c(cx + r * Math.cos(a), cy + r * Math.sin(a), grosor); }
}
/** Un brillo de cuatro puntas, en píxeles. */
function brillo(D, x, y, p, color = "amarillo") {
  pixeles(D, ["..a..", "..a..", "aaaaa", "..a..", "..a.."], { x, y, p, col: { a: color }, borde: p * 0.45 });
}
/** Letras grandes con contorno de tinta y sombra dura. */
function letras(D, { s, x, y, tam, color, ancla = "l", contorno = 0.7, sombra = 1.4, sombraCol = "tinta", font = negra, rot = 0, rc }) {
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
 * La cinta de la frase: una caja con borde de tinta y sombra dura, girada unos grados como la llama del sitio,
 * con una o más líneas del mismo cuerpo. El cuerpo se elige para que la línea más larga llene `ancho`.
 */
function cinta(D, { lineas, cx, y, ancho, fill = "amarillo", color = "sobre", rot = -3, tamMax = 9, font = negra, sombraCol = "tinta", pad = 1.7, sombra = 1.3, borde = 0.8 }) {
  const unidad = lineas.map((s) => medir(s, 100, { font }));
  const tam = Math.min(tamMax, (ancho - 2 * pad) * 100 / Math.max(...unidad));
  const cap = tam * 0.7, inter = cap * 0.5;
  const w = Math.max(...unidad) * tam / 100 + 2 * pad, h = 2 * pad + cap * lineas.length + inter * (lineas.length - 1);
  const rc = [cx, y + h / 2];
  caja(D.L, { x: cx - w / 2, y, w, h, fill, borde, sombra, sombraCol, rot, rc });
  lineas.forEach((s, i) => escribir(D.L, { s, x: cx, y: y + pad + cap * (i + 1) + inter * i, tam, ancla: "c", color, font, rot, rc }));
  D.caps.push(cap);
  D.r(cx - w / 2, y, w + sombra, h + sombra, rot, rc);
  return { w, h, cap, y1: y + h };
}
/** El número de la serie en una pastilla chica, en una esquina: "3/10". */
function numero(D, n, x, y) {
  const s = `${n}/10`, tam = 2.9, pad = 0.9;
  const w = medir(s, tam, { font: negra }) + 2 * pad, h = tam * 0.7 + 2 * pad;
  caja(D.L, { x, y, w, h, fill: "tarjeta", borde: 0.5, sombra: 0.6, radio: h / 2 });
  escribir(D.L, { s, x: x + w / 2, y: y + pad + tam * 0.7, tam, ancla: "c", color: "tinta", font: negra });
  D.r(x, y, w + 0.6, h + 0.6);
}

/**
 * La dirección, en todos: una etiqueta chica de tinta con «tinkazo.app» en papel, colgada del borde de abajo del troquel
 * (o de la esquina que pida el sticker). Mide lo mismo en todos a la medida final: la letra, 2,35 mm de alto a 5 cm.
 * Como la escala final depende de la caja del troquel, y la caja de la etiqueta, se resuelve en unas pocas pasadas.
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
      if (f.rot) {
        const a = f.rot * Math.PI / 180, [cx, cy] = f.rc;
        pts = pts.map(([px, py]) => [cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a), cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a)]);
      }
    }
    for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
  }
  return { x0, y0, x1, y1 };
}
function sello(D, conf = {}) {
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
/** Distancia de un punto a la caja de una forma de la masa (sin contar el giro: alcanza para acercar el confeti). */
function distA(f, x, y) {
  if (f.c) return Math.max(0, Math.hypot(x - f.c[0], y - f.c[1]) - f.c[2]);
  const [a, b, w, h] = f.r;
  return Math.hypot(Math.max(a - x, 0, x - a - w), Math.max(b - y, 0, y - b - h));
}
/** Confeti en píxeles cuadrados, con semilla, esquivando un rectángulo. */
function chispas(D, { semilla, n, area: [ax, ay, aw, ah], evitar = [], lado = 1.6 }) {
  const rng = azar(semilla), cols = ["magenta", "naranja", "amarillo", "turquesa", "morado"];
  let puestos = 0, intentos = 0;
  const hechos = [];
  while (puestos < n && intentos++ < n * 80) {
    const x = ax + rng() * aw, y = ay + rng() * ah;
    if (evitar.some(([ex, ey, ew, eh]) => x > ex - lado && x < ex + ew + lado && y > ey - lado && y < ey + eh + lado)) continue;
    if (hechos.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < lado * 3.2)) continue;
    // Cerca de lo ya dibujado: si no, el troquel quedaría partido en islas.
    if (!D.masa.some((f) => distA(f, x, y) < 4.2 - lado)) continue;
    hechos.push([x, y]);
    const g = (rng() - 0.5) * 50;
    D.L.add(rotar(rect(x - lado / 2 - 0.45, y - lado / 2 - 0.45, lado + 0.9, lado + 0.9), g, x, y), "tinta");
    D.L.add(rotar(rect(x - lado / 2, y - lado / 2, lado, lado), g, x, y), cols[puestos % 5]);
    D.c(x, y, lado);
    puestos++;
  }
}

// ───────────────────────── Los sprites ─────────────────────────
/**
 * El sapo de bronce de la mesa del juego, sentado, con la boca cerrada y cara de pícaro: los párpados a media asta y
 * los ojos de reojo hacia la ficha. g bronce, d sombra, h brillo, r mejilla.
 */
const SAPO = [
  "....gggg........gggg....",
  "...gddddg......gddddg...",
  "...gwwkkg......gwwkkg...",
  "..ggwwwwggggggggwwwwgg..",
  "..ghhhgggggggggggggggg..",
  ".ghhgggggggggggggkggggg.",
  ".grrggggggggggggkggrrgg.",
  ".ggggggkkkkkkkkkkgggggg.",
  "gggggghhhhhhhhhhhhgggggg",
  "dgggghhhhhhhhhhhhhhggggd",
  "ddggdhhhhhhhhhhhhhhdggdd",
  "dddgdghhhhhhhhhhhhgdgddd",
  "gdgdg.gdg......gdg.gdgdg",
];
/** El guajojó, de frente: ojos grandes y amarillos, pico chico, pecho de corteza con chevrones. Se espeja desde la mitad. */
const espejo = (filas) => filas.map((f) => f + [...f].reverse().join(""));
const GUAJOJO = espejo([
  "..dd.....",
  "..ddd....",
  "..dgggggg",
  ".dggggggg",
  "dggaaaagg",
  "dgaaaaaag",
  "dgaawkaag",
  "dgaakkaag",
  "dgaakkaag",
  "dggaaaagp",
  "ddggggggp",
  "ddgggggll",
  "ddgldllll",
  "ddglldlll",
  "ddgllldll",
  ".ddglllld",
  ".ddgllldl",
  "..ddgllll",
  "...ddgggg",
  "....ff.ff",
]);
const TROMPO = [
  ".....oo.....",
  "....oooo....",
  "..mmmmmmmm..",
  ".mmmmmmmmmm.",
  "oooooooooooo",
  "tttttttttttt",
  "oooooooooooo",
  ".aaaaaaaaaa.",
  ".oooooooooo.",
  "..oooooooo..",
  "...vvvvvv...",
  "....oooo....",
  ".....oo.....",
  ".....xx.....",
  ".....xx.....",
];
const BAILARINA = [
  "........t.v.......",
  ".......mtnva......",
  "........mna.......",
  "......aaaaaa......",
  "....aaaaaaaaaa....",
  "......hhhhhh......",
  "w....hffffffh....w",
  "ww...hfkffkfh...ww",
  ".ff..hrffffrh..ff.",
  "..f..hffqqffh..f..",
  "..ff.hhffffhh.ff..",
  "...ffmmmmmmmmff...",
  "....fmmmmmmmmf....",
  ".....hmmmmmmh.....",
  ".....hmmwwmmh.....",
  "....nnnnnnnnnn....",
  "...aaaaaaaaaaaa...",
  "...tttttttttttt...",
  "..nnnnnnnnnnnnnn..",
  "..vvvvvvvvvvvvvv..",
  ".mmmmmmmmmmmmmmmm.",
  ".aaaaaaaaaaaaaaaa.",
  "......ff..ff......",
  ".....kkk..kkk.....",
];
const CABINA = [
  "......kkk......",
  ".......k.......",
  ".......k.......",
  "...nnnnnnnnn...",
  "..nnnnnnnnnnn..",
  ".nnnnnnnnnnnnn.",
  ".nccnccnccnccn.",
  ".nhcnchnhcnchn.",
  ".nfcncfnfcncfn.",
  ".nnnnnnnnnnnnn.",
  ".naaaaaaaaaaan.",
  ".nnnnnnnnnnnnn.",
  "..nnnnnnnnnnn..",
];
const CORAZON = [".rr.rr.", "rwrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."];
const NOTA = ["..kk", "..kk", "..k.", "..k.", "kkk.", "kkk."];

/** La fila de la chovena: personas de la mano, cada una con su cinta y su tono de piel. */
function ronda(n) {
  const persona = [
    "..hhh..",
    ".hhhhh.",
    ".fkfkf.",
    ".rfffr.",
    "..fff..",
    ".wwwww.",
    "fwwwwwf",
    ".wcccw.",
    ".wwwww.",
    "wwwwwww",
    "wwwwwww",
    ".f...f.",
    ".k...k.",
  ];
  const pieles = ["1", "2", "3", "4"], cintas = ["m", "t", "n", "v", "a"];
  return persona.map((f, j) => Array.from({ length: n }, (_, i) => {
    const fila = f.replaceAll("f", pieles[i % 4]).replaceAll("c", cintas[i % 5]);
    const mano = j === 6 && i < n - 1 ? pieles[i % 4] : ".";
    return fila + (i < n - 1 ? mano : "");
  }).join(""));
}
/**
 * El toborochi: el árbol botella de Santa Cruz. Tronco verde y panzón que se angosta arriba, ramas abiertas como un
 * paraguas y racimos de flores rosadas con el centro crema, separados para que se vean las ramas.
 * t tronco, o sombra, l luz, e espina, b rama, r flor, s sombra de flor, p pétalo claro, c centro.
 */
function toborochi() {
  const W = 42, H = 30;
  const g = Array.from({ length: H }, () => Array(W).fill("."));
  const pon = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
  // El tronco, de la fila 13 a la 29: angosto arriba, la panza abajo y un pie que se abre.
  const anchos = [4, 4, 4, 5, 6, 8, 10, 12, 14, 15, 16, 16, 16, 15, 14, 14, 16];
  anchos.forEach((a, k) => {
    const j = 13 + k, i0 = Math.round(21 - a / 2);
    for (let i = i0; i < i0 + a; i++) {
      let ch = "t";
      if (i >= i0 + a - 2) ch = "o";
      else if (a >= 8 && i === i0 + 1) ch = "l";
      else if (a >= 10 && (i * 7 + j * 3) % 13 === 0) ch = "e";
      pon(i, j, ch);
    }
  });
  // Las ramas: de la punta del tronco hacia afuera y arriba.
  const ramas = [[4, 7], [12, 2.5], [21, 1], [30, 2.5], [38, 7]];
  for (const [ex, ey] of ramas) {
    const sx = 21 + Math.sign(ex - 21) * 0.6, sy = 13.5, n = 40;
    for (let k = 0; k <= n; k++) {
      const u = k / n, x = sx + (ex - sx) * u, y = sy + (ey - sy) * Math.pow(u, 0.8);
      pon(Math.round(x), Math.round(y), "b"); pon(Math.round(x) + (ex > 21 ? -1 : 1), Math.round(y), "b");
    }
  }
  // Los racimos de flores: en la punta de cada rama y a mitad de las de los costados.
  const racimos = [[4, 6.5, 3.6], [12, 3, 3.6], [21, 2.6, 3.9], [30, 3, 3.6], [38, 6.5, 3.6], [8.5, 10.5, 2.1], [33.5, 10.5, 2.1]];
  for (const [cx, cy, r] of racimos) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.1);
      if (d > r) continue;
      // Cada flor es una cruz: centro crema y cuatro pétalos; entre flores, sombra rosada.
      const f = ((x + 2 * y) % 5 + 5) % 5;
      pon(x, y, f === 0 ? "c" : f === 1 || f === 4 ? "r" : y > cy + r * 0.35 ? "s" : d < r * 0.45 && f === 2 ? "p" : "r");
    }
  }
  return g.map((f) => f.join(""));
}

// ───────────────────────── Tarija ─────────────────────────
/**
 * El valle de Tarija en un disco: el cielo (de tarde o de noche), el sol o la luna, dos lomas y las hileras de la viña.
 * Las lomas se recortan contra el círculo a mano: cada una es su borde de arriba y el arco de abajo del disco.
 */
function valle(D, { cx, cy, r, noche = false }) {
  disco(D, cx, cy, r, noche ? C.cieloNoche : C.cieloTarde, { borde: 0.9, sombra: 1.4 });
  if (noche) {
    D.L.add(circulo(cx - r * 0.5, cy - r * 0.42, r * 0.2), C.luna);
    D.L.add(circulo(cx - r * 0.44, cy - r * 0.47, r * 0.17), C.cieloNoche);
    for (const [u, v] of [[-0.15, -0.7], [0.55, -0.55], [0.75, -0.1], [-0.8, 0.05], [0.3, -0.85]]) pixeles(D, [".w.", "www", ".w."], { x: cx + u * r - 1.1, y: cy + v * r - 1.1, p: 0.75, borde: 0, col: { w: C.estrella } });
  } else {
    D.L.add(circulo(cx - r * 0.48, cy - r * 0.38, r * 0.24), C.sol);
  }
  const loma = (f, color) => {
    const n = 72, arriba = [], abajo = [];
    for (let i = 0; i <= n; i++) {
      const x = cx - r + 2 * r * i / n, h = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
      const yb = cy + h, yt = Math.min(yb, Math.max(f(x), cy - h));
      arriba.push([x, yt]); abajo.push([x, yb]);
    }
    D.L.add(poli([...arriba, ...abajo.reverse()]), color);
  };
  loma((x) => cy + r * 0.05 - 3.2 * Math.sin((x - cx) / r * 2.2 + 0.6), noche ? C.cerroVerdeOsc : C.cerroVerde);
  const f2 = (x) => cy + r * 0.32 - 2.4 * Math.sin((x - cx) / r * 1.8 - 0.9);
  loma(f2, noche ? C.vid : C.cerroVerdeOsc);
  // Las hileras de la viña: plantitas en fila, con una uva cada tanto.
  for (let k = 0; k < 4; k++) for (let x = cx - r; x < cx + r; x += 2.3) {
    const xx = x + (k % 2) * 1.15, yy = f2(xx) + 2.2 + k * 2.4;
    if (Math.hypot(xx - cx, yy - cy) > r - 1.6) continue;
    D.L.add(redondeado(xx - 0.8, yy - 0.5, 1.6, 1.1, 0.5), noche ? C.cerroVerdeOsc : C.vid);
    if (Math.round(xx * 3 + k) % 3 === 0) D.L.add(circulo(xx + 0.5, yy + 0.6, 0.42), C.uva);
  }
}
/** El sombrero chapaco de ala ancha, sobre la cabeza de la llama (la de `llama`, con su esquina y su alto). */
function sombreroChapaco(D, { x, y, alto }) {
  // La cabeza de la llama va de 14 a 22 en x y arranca en `yh`: el ala se apoya arriba y deja la cara a la vista.
  const k = alto / 26, yh = y + 2 * k;
  const copa = [x + 14.6 * k, yh - 4.6 * k, 7.2 * k, 3.9 * k], ala = [x + 8.6 * k, yh - 1.3 * k, 18.8 * k, 1.8 * k];
  caja(D.L, { x: copa[0], y: copa[1], w: copa[2], h: copa[3], fill: C.paja, borde: 0.8, sombra: 1, radio: 1.4 * k });
  D.L.add(rect(copa[0] + 0.8, copa[1] + copa[3] - 1.25 * k, copa[2] - 1.6, 1 * k), C.rojoBo);
  caja(D.L, { x: ala[0], y: ala[1], w: ala[2], h: ala[3], fill: C.paja, borde: 0.8, sombra: 1.1, radio: ala[3] / 2 });
  D.L.add(rect(ala[0] + 1.4 * k, ala[1] + ala[3] - 0.85, ala[2] - 2.8 * k, 0.35 * k), C.pajaOsc);
  D.r(copa[0], copa[1], copa[2] + 1, copa[3] + 1);
  D.r(ala[0], ala[1], ala[2] + 1.1, ala[3] + 1.1);
}
/** Un racimo de uvas con su tallo y una hoja. (x, y) es el arranque del tallo; `u` el radio de cada uva. */
function racimo(D, { x, y, u }) {
  const pos = [];
  [3, 3, 2, 1].forEach((n, fila) => { for (let i = 0; i < n; i++) pos.push([x + 2.2 * u + (i - (n - 1) / 2) * 2 * u * 0.95, y + 1.9 * u + fila * 1.7 * u]); });
  D.L.add(rotar(rect(x - 0.35, y - 0.2, 0.7, 2.6 * u), -40, x, y), "tinta");
  poliBorde(D, [[x, y + 0.2], [x + 3.4 * u, y - 1.6 * u], [x + 4.4 * u, y + 0.2 * u], [x + 2.4 * u, y + 1.1 * u]], C.hoja, { borde: 0.6 });
  for (const [px, py] of pos) D.L.add(circulo(px + 0.7, py + 0.7, u + 0.65), "tinta");
  for (const [px, py] of pos) D.L.add(circulo(px, py, u + 0.65), "tinta");
  for (const [px, py] of pos) D.L.add(circulo(px, py, u), C.uva);
  for (const [px, py] of pos) D.L.add(circulo(px - u * 0.35, py - u * 0.35, u * 0.32), C.uvaClara);
  for (const [px, py] of pos) D.c(px + 0.35, py + 0.35, u + 1);
  D.r(x - 0.5, y - 1.8 * u, 5 * u, 2.4 * u + 1);
}

// ───────────────────────── La colección ─────────────────────────
const PIEL = { 1: C.piel1, 2: C.piel2, 3: C.piel3, 4: C.piel4, h: C.pelo, r: C.mejilla };

/**
 * Cada sticker: id, grupo, número en la serie (los juegos), frase en es y en (las líneas tal como van en la cinta),
 * idiomas y cómo se dibuja. Todo en unidades de ~1 mm a 5 cm.
 */
export const COLECCION = [
  // ── Los diez juegos, numerados ──
  {
    id: "carrera", grupo: "juegos", num: 1, juego: { es: "Carrera de llamas", en: "Llama race" },
    lineas: { es: ["A TODA LLAMA"], en: ["FULL LLAMA", "AHEAD"] },
    dibujar(D, l, t) {
      const largos = [11, 15, 8, 13];
      largos.forEach((lg, i) => {
        const yy = 9 + i * 3.4;
        D.L.add(rect(15 - lg - 0.5, yy - 0.5, lg + 1, 2.2), "tinta");
        D.L.add(rect(15 - lg, yy, lg, 1.2), ["naranja", "amarillo", "turquesa", "morado"][i]);
        D.r(15 - lg - 0.5, yy - 0.5, lg + 1, 2.2);
      });
      llama(D, { x: 15.5, y: 2.5, alto: 27, contorno: 0.9, sombra: 1.4, rot: -7 });
      cinta(D, { lineas: t, cx: 25, y: l === "es" ? 33 : 31, ancho: 44, fill: "amarillo" });
    },
  },
  {
    id: "ruleta", grupo: "juegos", num: 2, juego: { es: "Ruleta", en: "Wheel" },
    lineas: { es: ["VUELTA", "Y VUELTA"], en: ["ROUND AND", "ROUND"] },
    dibujar(D, l, t) {
      const cx = 25, cy = 17, r = 13.5;
      disco(D, cx, cy, r, "tarjeta", { borde: 0.9, sombra: 1.4 });
      const cols = ["magenta", "naranja", "amarillo", "turquesa", "morado"];
      for (let i = 0; i < 10; i++) {
        const a0 = (i * 36 - 90) * Math.PI / 180, a1 = ((i + 1) * 36 - 90) * Math.PI / 180;
        const pts = [[cx, cy]];
        for (let k = 0; k <= 8; k++) { const a = a0 + (a1 - a0) * k / 8; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        D.L.add(poli(pts), cols[i % 5]);
        D.L.add(poli([[cx, cy], [cx + (r + 0.05) * Math.cos(a0) + 0.3 * Math.sin(a0), cy + (r + 0.05) * Math.sin(a0) - 0.3 * Math.cos(a0)], [cx + (r + 0.05) * Math.cos(a0) - 0.3 * Math.sin(a0), cy + (r + 0.05) * Math.sin(a0) + 0.3 * Math.cos(a0)]]), "tinta");
      }
      disco(D, cx, cy, 2.6, "papel", { borde: 0.8, sombra: 0 });
      // El perno tricolor que marca la vuelta.
      const px = cx - 2.4;
      D.L.add(rect(px - 0.8, 0.2, 6.4, 7.6), "tinta");
      [C.rojoBo, C.amarilloBo, C.verdeBo].forEach((c, i) => D.L.add(rect(px, 1 + i * 2, 4.8, 2), c));
      D.L.add(poli([[px - 0.8, 7.6], [px + 5.6, 7.6], [cx, 10.6]]), "tinta");
      D.r(px - 0.8, 0.2, 6.4, 10.4);
      arco(D, cx, cy, r + 4.2, -20, 25, 1.1);
      arco(D, cx, cy, r + 4.2, 160, 205, 1.1);
      cinta(D, { lineas: t, cx: 25, y: 32, ancho: 36, fill: "turquesa" });
    },
  },
  {
    id: "pinata", grupo: "juegos", num: 3, juego: { es: "Piñata", en: "Piñata" },
    lineas: { es: ["DALE, DALE,", "DALE"], en: ["SWING,", "SWING, SWING"] },
    dibujar(D, l, t) {
      const cx = 25, cy = 18, cols = ["magenta", "naranja", "amarillo", "turquesa", "morado", "naranja", "magenta"];
      // La cuerda de arriba.
      D.L.add(rect(cx - 0.7, 0.5, 1.4, 10), "tinta"); D.r(cx - 0.7, 0.5, 1.4, 10);
      const conos = [];
      for (let i = 0; i < 7; i++) {
        const a = (-90 + 360 / 14 + i * 360 / 7) * Math.PI / 180, b = 4.6;
        const base = 5.5, punta = 15.5;
        const n = [Math.cos(a), Math.sin(a)], tg = [-Math.sin(a), Math.cos(a)];
        conos.push({ pts: [[cx + n[0] * base + tg[0] * b, cy + n[1] * base + tg[1] * b], [cx + n[0] * punta, cy + n[1] * punta], [cx + n[0] * base - tg[0] * b, cy + n[1] * base - tg[1] * b]], a, col: cols[i], tip: [cx + n[0] * punta, cy + n[1] * punta] });
      }
      for (const c of conos) { const r = poliBorde(D, c.pts, c.col, { borde: 0.8 }); D.r(...r.caja); }
      for (const [i, c] of conos.entries()) {
        const [tx, ty] = c.tip, g = c.a * 180 / Math.PI + 90;
        D.L.add(rotar(rect(tx - 1.6, ty - 1.4, 3.2, 2.6), g, tx, ty), "tinta");
        D.L.add(rotar(rect(tx - 1.1, ty - 0.9, 2.2, 1.6), g, tx, ty), cols[(i + 2) % 7]);
        D.c(tx, ty, 2.2);
      }
      disco(D, cx, cy, 7, "amarillo", { borde: 0.9, sombra: 1.2 });
      D.L.add(rect(cx - 7, cy - 1.6, 14, 1.2), "magenta");
      D.L.add(rect(cx - 6.6, cy + 1.2, 13.2, 1.2), "turquesa");
      cinta(D, { lineas: t, cx: 25, y: 34, ancho: 44, fill: "magenta" });
    },
  },
  {
    id: "trompo", grupo: "juegos", num: 4, juego: { es: "Trompo", en: "Spinning top" },
    lineas: { es: ["MANO A MANO"], en: ["HEAD TO HEAD"] },
    dibujar(D, l, t) {
      pixeles(D, TROMPO, { x: 14, y: 1.5, p: 1.85, col: { o: C.madera, x: C.metal }, borde: 0.85, sombra: 1.3, rot: -10 });
      arco(D, 25, 15, 17, 150, 200, 1.1);
      arco(D, 25, 15, 17, -20, 30, 1.1);
      arco(D, 25, 15, 20.5, 165, 190, 1.1);
      arco(D, 25, 15, 20.5, -5, 15, 1.1);
      cinta(D, { lineas: t, cx: 25, y: 31.5, ancho: 44, fill: "naranja" });
    },
  },
  {
    id: "sapo", grupo: "juegos", num: 5, juego: { es: "Sapo", en: "Frog toss" },
    lineas: { es: ["Puntería fina"], en: ["Nice aim"] },
    dibujar(D, l, t) {
      // El cajón de madera de la mesa del sapo: la tapa y el frente con sus agujeros.
      caja(D.L, { x: 6.5, y: 29.2, w: 37, h: 8.6, fill: C.madera, borde: 0.85, sombra: 1.3 });
      D.r(6.5, 29.2, 38.3, 9.9);
      [14.5, 25, 35.5].forEach((x) => { D.L.add(circulo(x, 33.5, 2.25), "tinta"); D.L.add(circulo(x, 33.5, 1.5), C.agujero); });
      [19.75, 30.25].forEach((x) => D.L.add(rect(x - 0.35, 30.1, 0.7, 6.8), C.maderaOsc));
      caja(D.L, { x: 4.5, y: 26.4, w: 41, h: 3.4, fill: C.tapa, borde: 0.85, sombra: 1.1 });
      D.r(4.5, 26.4, 42.1, 4.5);
      // El sapo de bronce, con la boca cerrada, de reojo hacia la ficha.
      pixeles(D, SAPO, { x: 25 - 12 * 1.5, y: 7, p: 1.5, col: { g: C.bronce, d: C.bronceOsc, h: C.bronceClaro, r: C.mejilla }, borde: 0.8, sombra: 1.2 });
      // La ficha dorada en el aire, con su estela.
      arco(D, 41.5, 7.5, 5.6, -10, 50, 0.9);
      arco(D, 41.5, 7.5, 8, 0, 35, 0.9);
      disco(D, 41.5, 7.5, 3.5, "amarillo", { borde: 0.8, sombra: 1 });
      D.L.add(circulo(41.5, 7.5, 2.2), "tinta"); D.L.add(circulo(41.5, 7.5, 1.6), C.bronceClaro);
      brillo(D, 34.5, 0.6, 0.6, "amarillo");
      cinta(D, { lineas: t, cx: 25, y: 39.5, ancho: 40, fill: "turquesa" });
    },
  },
  {
    id: "guajojo", grupo: "juegos", num: 6, juego: { es: "Guajojó", en: "Guajojó" },
    lineas: { es: ["Te estoy viendo"], en: ["I see you"] },
    dibujar(D, l, t) {
      disco(D, 25, 19.5, 18.5, C.noche, { borde: 0.9, sombra: 1.4 });
      // La luna llena detrás de la cabeza: la silueta del pájaro se recorta contra ella.
      D.L.add(circulo(35.5, 9.5, 6.5), C.luna);
      for (const [x, y, r] of [[38, 7.5, 1.2], [39, 12, 0.8]]) D.L.add(circulo(x, y, r), C.lunaOsc);
      for (const [x, y] of [[9.5, 9], [7.5, 23], [41.5, 25], [13, 4.5], [11.5, 29.5]]) pixeles(D, [".w.", "www", ".w."], { x, y, p: 0.75, borde: 0, col: { w: C.estrella } });
      // La rama, con su muñón y una hoja.
      D.L.add(rect(6.5, 31.4, 37, 3.2), "tinta"); D.L.add(rect(7.3, 32.2, 35.4, 1.6), C.rama);
      D.L.add(rect(36.5, 28.2, 1.8, 4), "tinta"); D.L.add(rect(36.9, 28.8, 1, 3), C.rama);
      pixeles(D, GUAJOJO, { x: 25 - 9 * 1.38, y: 4.6, p: 1.38, col: { g: C.pluma, l: C.plumaClara, d: C.plumaOsc, p: C.pico, f: "naranja" }, borde: 0.8, sombra: 1.2 });
      cinta(D, { lineas: t, cx: 25, y: 37, ancho: l === "es" ? 45 : 34, fill: "amarillo" });
    },
  },
  {
    id: "toborochi", grupo: "juegos", num: 7, juego: { es: "Toborochi", en: "Toborochi" },
    lineas: { es: ["Panza llena,", "corazón contento"], en: ["Full belly,", "happy heart"] },
    dibujar(D, l, t) {
      pixeles(D, toborochi(), { x: 25 - 21 * 1.1, y: 0.6, p: 1.1, col: { t: C.tronco, o: C.troncoOsc, l: C.troncoClaro, e: C.espina, b: C.troncoOsc, r: C.flor, s: C.florOsc, p: C.florClara, c: C.florCentro }, borde: 0.75, sombra: 1.1 });
      for (const [x, y] of [[5.5, 19], [42, 17.5], [10, 25]]) pixeles(D, [".r.", "rcr", ".r."], { x, y, p: 0.85, borde: 0.4, col: { r: C.flor, c: C.florCentro } });
      cinta(D, { lineas: t, cx: 25, y: 31.5, ancho: 47, fill: "turquesa" });
    },
  },
  {
    id: "chovena", grupo: "juegos", num: 8, juego: { es: "Chovena", en: "Chovena" },
    lineas: { es: ["Nadie se suelta"], en: ["No one lets go"] },
    dibujar(D, l, t) {
      pixeles(D, ronda(4), { x: 3, y: 7, p: 1.42, col: PIEL, borde: 0.75, sombra: 1.1 });
      pixeles(D, NOTA, { x: 9, y: 0.6, p: 0.95, borde: 0.45, col: { k: "morado" } });
      pixeles(D, NOTA, { x: 37, y: 1.2, p: 0.95, borde: 0.45, col: { k: "magenta" } });
      pixeles(D, NOTA, { x: 23.5, y: 0.2, p: 0.8, borde: 0.4, col: { k: "turquesa" } });
      cinta(D, { lineas: t, cx: 25, y: 30, ancho: 44, fill: "naranja" });
    },
  },
  {
    id: "entrada", grupo: "juegos", num: 9, juego: { es: "La Entrada", en: "La Entrada" },
    lineas: { es: ["Con mi", "comparsa"], en: ["With", "my crew"] },
    dibujar(D, l, t) {
      pixeles(D, BAILARINA, { x: 13.5, y: 1, p: 1.28, col: { f: C.piel4, h: C.pelo, r: C.mejilla, q: "#b8416a" }, borde: 0.75, sombra: 1.1 });
      chispas(D, { semilla: 9, n: 9, area: [3, 2, 44, 26], evitar: [[12.5, 0, 25, 32]], lado: 1.6 });
      cinta(D, { lineas: t, cx: 25, y: 32, ancho: 30, fill: "magenta" });
    },
  },
  {
    id: "teleferico", grupo: "juegos", num: 10, juego: { es: "Teleférico", en: "Cable car" }, insignia: [3.5, 4],
    lineas: { es: ["Todos arriba"], en: ["All aboard"] },
    dibujar(D, l, t) {
      // Los cerros con nieve y el sol de la tarde.
      disco(D, 40.5, 15, 3.4, "amarillo", { borde: 0.7, sombra: 0 });
      const cerro = (pts, fill) => {
        const r = poliBorde(D, pts, fill, { borde: 0.7 }); D.r(...r.caja);
        const [[ax, ay], [px, py], [bx, by]] = pts, u = 0.3; // la nieve: el tercio de arriba
        const izq = [px + (ax - px) * u, py + (ay - py) * u], der = [px + (bx - px) * u, py + (by - py) * u];
        D.L.add(poli([[px, py], der, [der[0] - (der[0] - izq[0]) * 0.3, der[1] - 1.2], [(izq[0] + der[0]) / 2, der[1] + 0.4], [izq[0] + (der[0] - izq[0]) * 0.3, izq[1] - 1.2], izq]), C.nieve);
      };
      cerro([[1.5, 32], [9, 15.5], [21, 32]], C.cerro);
      cerro([[28, 32], [43, 19], [49, 32]], C.cerro);
      cerro([[14, 32], [27, 17], [40, 32]], C.cerroOsc);
      // El cable, levemente en diagonal.
      const a = -8;
      D.L.add(rotar(rect(1, 10.6, 48, 1.2), a, 25, 11.2), "tinta"); D.r(1, 10.6, 48, 1.2, a, [25, 11.2]);
      pixeles(D, CABINA, { x: 25 - 7.5 * 1.62, y: 10.4, p: 1.62, col: { c: C.cielo, h: C.pelo, f: C.piel3 }, borde: 0.8, sombra: 1.2 });
      cinta(D, { lineas: t, cx: 25, y: 33.5, ancho: 36, fill: "amarillo" });
    },
  },
  // ── La llama ──
  {
    id: "llama-corazon", grupo: "llama",
    lineas: { es: ["Llama de", "mi corazón"], en: ["My llama,", "my heart"] },
    dibujar(D, l, t) {
      llama(D, { x: 5, y: 3, alto: 28, contorno: 0.9, sombra: 1.4, rot: -3 });
      pixeles(D, CORAZON, { x: 32, y: 2.5, p: 1.75, col: { r: C.corazon }, borde: 0.8, sombra: 1.1, rot: 10 });
      brillo(D, 44, 0.5, 0.7); brillo(D, 30, 14, 0.6, "turquesa");
      cinta(D, { lineas: t, cx: 26, y: 31.5, ancho: 40, fill: "turquesa" });
    },
  },
  {
    id: "llama-dormida", grupo: "llama",
    lineas: { es: ["Despertame", "cuando salga", "mi nombre"], en: ["Wake me up", "when they", "call my name"] },
    dibujar(D, l, t) {
      // La llama del logo, echada: las mismas formas con las patas dobladas debajo, para que se reconozca de un vistazo.
      const echada = [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [3, 20, 2.5, 1.8], [8, 20, 2.5, 1.8], [12.5, 20, 2.5, 1.8], [16, 20, 2.5, 1.8], [0, 11, 3, 4]];
      bloques(D, echada, { x: 5, y: 2, k: 1.15, color: "magenta", contorno: 0.9, sombra: 1.4 });
      letras(D, { s: "z", x: 34, y: 11, tam: 6, color: "morado", contorno: 0.5, sombra: 0.8 });
      letras(D, { s: "z", x: 38.5, y: 6.5, tam: 8, color: "turquesa", contorno: 0.55, sombra: 0.9 });
      letras(D, { s: "Z", x: 43, y: 2.5, tam: 8, color: "amarillo", contorno: 0.6, sombra: 1 });
      cinta(D, { lineas: t, cx: 25, y: 30, ancho: 44, fill: "amarillo" });
    },
  },
  {
    id: "llama-salio", grupo: "llama",
    lineas: { es: ["¡Salió", "mi nombre!"], en: ["They called", "my name!"] },
    dibujar(D, l, t) {
      llama(D, { x: 14, y: 1.5, alto: 26, contorno: 0.9, sombra: 1.4, rot: -14 });
      chispas(D, { semilla: 4, n: 10, area: [2, 1, 46, 28], evitar: [[11.5, 0, 26, 29]], lado: 1.7 });
      cinta(D, { lineas: t, cx: 25, y: 31, ancho: 40, fill: "amarillo" });
    },
  },
  {
    id: "caravana", grupo: "llama",
    lineas: { es: ["Participar", "es gratis"], en: ["Entry", "is free"] },
    dibujar(D, l, t) {
      banderines(D.L, { x0: 3, x1: 47, y: 2.5, n: 7, alto: 4.6, sag: 1.6, hilo: 0.55, fondoCalado: "tarjeta" });
      D.r(2.5, 1.8, 45, 6.4);
      ["magenta", "naranja", "amarillo", "turquesa", "morado"].forEach((col, i) => llama(D, { x: 1.5 + i * 9.3, y: i % 2 ? 11 : 12.5, alto: 13, color: col, contorno: 0.7, sombra: 0.9 }));
      cinta(D, { lineas: t, cx: 25, y: 30, ancho: 40, fill: "naranja", tamMax: 7.6 });
    },
  },
  {
    id: "bolivia", grupo: "llama",
    lineas: { es: ["HECHO EN", "BOLIVIA"], en: ["MADE IN", "BOLIVIA"] },
    dibujar(D, l, t) {
      D.L.add(rect(9.4, 23.4, 33, 9), "tinta"); D.L.add(rect(8.2, 22.2, 33, 9), "tinta");
      [C.rojoBo, C.amarilloBo, C.verdeBo].forEach((c, i) => D.L.add(rect(9, 23 + i * 2.5, 31.4, 2.5), c));
      D.r(8.2, 22.2, 34.2, 10.2);
      llama(D, { x: 14.5, y: 0.5, alto: 22.5, contorno: 0.9, sombra: 1.3 });
      cinta(D, { lineas: t, cx: 25, y: 33.5, ancho: 34, fill: "tarjeta", color: "tinta" });
    },
  },
  {
    id: "con-k", grupo: "llama",
    lineas: { es: ["Con K", "de Tinkazo"], en: ["Tinkazo,", "with a K"] },
    dibujar(D, l, t) {
      letras(D, { s: "K", x: 4.5, y: 27, tam: 40, color: "magenta", contorno: 0.9, sombra: 1.8 });
      llama(D, { x: 28, y: 6, alto: 21, contorno: 0.85, sombra: 1.2, rot: 7 });
      cinta(D, { lineas: t, cx: 25, y: 31, ancho: 38, fill: "amarillo" });
    },
  },
  // ── Frases ──
  {
    id: "verificalo", grupo: "frases",
    lineas: { es: ["VERIFICALO", "VOS"], en: ["DON'T TRUST,", "VERIFY"] },
    dibujar(D, l, t) {
      const cx = 20, cy = 14;
      D.L.add(rotar(rect(cx + 6, cy - 2.6 + 0.9, 15, 5.2), 45, cx + 0.9, cy + 0.9), "tinta");
      D.L.add(rotar(rect(cx + 6, cy - 2.6, 15, 5.2), 45, cx, cy), "tinta");
      D.L.add(rotar(rect(cx + 7, cy - 1.8, 13.2, 3.6), 45, cx, cy), "naranja");
      D.r(cx + 6, cy - 2.6, 16, 6.2, 45, [cx, cy]);
      disco(D, cx, cy, 11, "turquesa", { borde: 0.9, sombra: 1.4 });
      D.L.add(circulo(cx, cy, 9.1), "tinta"); D.L.add(circulo(cx, cy, 8.3), "tarjeta");
      tilde(D.L, { x: cx - 6.3, y: cy - 4.6, celda: 1.4, color: "tinta" });
      brillo(D, 32, 0.8, 0.7, "magenta");
      cinta(D, { lineas: t, cx: 25, y: 29.5, ancho: 40, fill: "amarillo" });
    },
  },
  {
    id: "apthapi", grupo: "frases", texto: { es: "APTHAPI: cada uno trae algo", en: "APTHAPI: everyone brings something" },
    lineas: { es: ["cada uno", "trae algo"], en: ["everyone", "brings something"] },
    dibujar(D, l, t) {
      letras(D, { s: "APTHAPI", x: 24.3, y: 13, tam: 42 * 100 / medir("APTHAPI", 100), color: "tinta", ancla: "c", contorno: 0, sombra: 0.6, sombraCol: "magenta" });
      // Una franja de aguayo: rayas finas y una fila de rombos.
      const x = 3, w = 44, y = 17;
      D.L.add(rect(x + 1.2, y + 1.2, w, 11), "tinta"); D.L.add(rect(x, y, w, 11), "tinta");
      const rayas = ["magenta", "naranja", "amarillo", "turquesa", "morado"];
      rayas.forEach((c, i) => D.L.add(rect(x + 0.8, y + 0.8 + i * 0.66, w - 1.6, 0.66), c));
      rayas.slice().reverse().forEach((c, i) => D.L.add(rect(x + 0.8, y + 6.9 + i * 0.66, w - 1.6, 0.66), c));
      D.L.add(rect(x + 0.8, y + 4.1, w - 1.6, 2.8), "tinta");
      for (let i = 0; i < 11; i++) { const rx = x + 2.8 + i * 4; D.L.add(poli([[rx, y + 4.3], [rx + 1.3, y + 5.5], [rx, y + 6.7], [rx - 1.3, y + 5.5]]), rayas[i % 5]); }
      D.r(x, y, w + 1.2, 12.2);
      cinta(D, { lineas: t, cx: 25, y: 26.5, ancho: l === "es" ? 36 : 44, fill: "tarjeta", color: "tinta" });
    },
  },
  {
    id: "cacharpaya", grupo: "frases", texto: { es: "Hasta la cacharpaya", en: "See you at the cacharpaya" },
    lineas: { es: ["Hasta la", "CACHARPAYA"], en: ["See you at the", "CACHARPAYA"] },
    dibujar(D, l, t) {
      banderines(D.L, { x0: 2, x1: 48, y: 3, n: 6, alto: 7.5, sag: 2.5, hilo: 0.6, fondoCalado: "tarjeta" });
      D.r(1.5, 2.2, 47, 10.5);
      const a = cinta(D, { lineas: [t[0]], cx: 22, y: 15.5, ancho: l === "es" ? 26 : 40, fill: "tarjeta", color: "tinta", rot: -3, tamMax: 8 });
      cinta(D, { lineas: [t[1]], cx: 25, y: a.y1 + 1, ancho: 45, fill: "magenta", rot: -3 });
      chispas(D, { semilla: 7, n: 4, area: [3, 34, 44, 8], lado: 1.6 });
    },
  },
  {
    id: "todos-lista", grupo: "frases",
    lineas: { es: ["Todos en", "la lista"], en: ["Everyone's", "on the list"] },
    dibujar(D, l, t) {
      // La lista en una tablilla, con un nombre por renglón y todos marcados.
      const x = 23.5, y = 6.5, w = 22, h = 23.5, g = 6, rc = [x + w / 2, y + h / 2];
      caja(D.L, { x, y, w, h, fill: "tarjeta", borde: 0.85, sombra: 1.3, rot: g, rc });
      D.r(x, y, w + 1.3, h + 1.3, g, rc);
      const giro = (cmds) => rotar(cmds, g, ...rc);
      D.L.add(giro(rect(x + w / 2 - 4.5, y - 1.6, 9, 3.4)), "tinta");
      D.L.add(giro(rect(x + w / 2 - 3.7, y - 0.8, 7.4, 1.8)), C.metal);
      const cols = ["magenta", "naranja", "turquesa", "morado", "amarillo"];
      for (let i = 0; i < 5; i++) {
        const yy = y + 3.6 + i * 3.9;
        D.L.add(giro(circulo(x + 3.6, yy + 1, 1.35)), "tinta");
        D.L.add(giro(circulo(x + 3.6, yy + 1, 0.85)), cols[i]);
        D.L.add(giro(rect(x + 6, yy + 0.35, [10, 8, 11, 7, 9][i], 1.3)), C.barra);
        const tl = [];
        ["........X", ".......XX", "X.....XX.", "XX...XX..", ".XX.XX...", "..XXX....", "...X....."].forEach((f, j) => [...f].forEach((ch, k) => { if (ch === "X") tl.push(...rect(x + w - 5.6 + k * 0.42, yy - 0.6 + j * 0.42, 0.44, 0.44)); }));
        D.L.add(giro(tl), "turquesa");
      }
      // La llama, orgullosa, con la pata delantera sobre la tablilla.
      llama(D, { x: 1.8, y: 2, alto: 28, contorno: 0.9, sombra: 1.4 });
      brillo(D, 43.5, 2.5, 0.7, "amarillo"); brillo(D, 3, 6.5, 0.6, "turquesa");
      cinta(D, { lineas: t, cx: 24, y: 31.5, ancho: 40, fill: "naranja", tamMax: 7.6 });
    },
  },
  {
    id: "sin-trampa", grupo: "frases",
    lineas: { es: ["Sin trampa,", "con cariño"], en: ["No tricks,", "all heart"] },
    dibujar(D, l, t) {
      pixeles(D, CORAZON, { x: 25 - 3.5 * 2.6, y: 1.5, p: 2.6, col: { r: C.corazon }, borde: 0.9, sombra: 1.4 });
      tilde(D.L, { x: 25 - 4.95, y: 5.4, celda: 1.1, color: "tarjeta" });
      brillo(D, 7, 4, 0.75, "turquesa"); brillo(D, 39.5, 9, 0.75, "amarillo");
      cinta(D, { lineas: t, cx: 25, y: 20.5, ancho: 42, fill: "amarillo", tamMax: 10 });
    },
  },
  // ── Para devs ──
  {
    id: "dev-mi-llama", grupo: "devs",
    lineas: { es: ["Funciona", "en mi llama"], en: ["Works on", "my llama"] },
    dibujar(D, l, t) {
      caja(D.L, { x: 4, y: 2, w: 42, h: 27, fill: "tinta", borde: 0.9, sombra: 1.6, sombraCol: "magenta" });
      D.r(4, 2, 43.6, 28.6);
      D.L.add(rect(4.9, 2.9, 40.2, 4.4), C.barra);
      ["magenta", "amarillo", "turquesa"].forEach((c, i) => D.L.add(circulo(8 + i * 3.2, 5.1, 1), c));
      llama(D, { x: 19, y: 9, alto: 15, contorno: 0, sombra: 0 });
      escribir(D.L, { s: ">_", x: 7, y: 26, tam: 4.4, color: "turquesa", font: negra });
      // En la barra de la ventana, la máquina de siempre: en la de quien programa, anda.
      const u = escribir(D.L, { s: "localhost", x: 44, y: 6.4, tam: 4.7, color: "tinta", font: negra, ancla: "r" });
      D.caps.push(u.cap);
      cinta(D, { lineas: t, cx: 25, y: 30.5, ancho: 44, fill: "amarillo" });
    },
  },
  {
    id: "dev-404", grupo: "devs", texto: { es: "404: llama no encontrada", en: "404: llama not found" },
    lineas: { es: ["Llama no", "encontrada"], en: ["Llama", "not found"] },
    dibujar(D, l, t) {
      // El fantasma de la llama: su contorno punteado.
      const k = 20 / 26, x = 3.5, y = 3;
      const rr = RECTS_LLAMA.map(([rx, ry, w, h]) => [x + rx * k, y + (ry + 2) * k, w * k, h * k]);
      D.L.add(rr.flatMap(([a, b, w, h]) => rect(a, b, w, h)), C.fantasma);
      const lazos = contornoUnion(rr, 0);
      const trazos = [];
      let px = 0, py = 0, ini = null;
      for (const [op, ...q] of lazos) {
        if (op === "M") { [px, py] = q; ini = q; continue; }
        const [qx, qy] = op === "Z" ? ini : q;
        const L = Math.hypot(qx - px, qy - py), n = Math.max(1, Math.round(L / 1.9));
        for (let i = 0; i < n; i++) {
          const u = (i + 0.2) / n, v = (i + 0.75) / n;
          const ax = px + (qx - px) * u, ay = py + (qy - py) * u, bx = px + (qx - px) * v, by = py + (qy - py) * v;
          trazos.push(...rect(Math.min(ax, bx) - 0.35, Math.min(ay, by) - 0.35, Math.abs(bx - ax) + 0.7, Math.abs(by - ay) + 0.7));
        }
        [px, py] = [qx, qy];
      }
      D.L.add(trazos, "tinta");
      for (const [a, b, w, h] of rr) D.r(a - 0.4, b - 0.4, w + 0.8, h + 0.8);
      letras(D, { s: "404", x: 36, y: 21, tam: 17, color: "magenta", ancla: "c", contorno: 0.8, sombra: 1.5 });
      cinta(D, { lineas: t, cx: 25, y: 27.5, ancho: 40, fill: "turquesa" });
    },
  },
  {
    id: "dev-commit", grupo: "devs", langs: [null],
    lineas: { null: ["git commit", "-m \"llama\""] },
    dibujar(D) {
      llama(D, { x: 33, y: 0.5, alto: 11, contorno: 0.7, sombra: 0.9 });
      caja(D.L, { x: 2, y: 10.5, w: 46, h: 23, fill: "tinta", borde: 0.9, sombra: 1.6, sombraCol: "turquesa" });
      D.r(2, 10.5, 47.6, 24.6);
      D.L.add(rect(2.9, 11.4, 44.2, 4), C.barra);
      ["magenta", "amarillo", "turquesa"].forEach((c, i) => D.L.add(circulo(6 + i * 3, 13.4, 0.9), c));
      const tam = Math.min(6.4, 39 * 6.4 / medir("$ git commit", 6.4));
      escribir(D.L, { s: "$ git commit", x: 5.5, y: 23, tam, color: "amarillo", font: negra });
      const r = escribir(D.L, { s: "-m \"", x: 5.5, y: 30.5, tam, color: "papel", font: negra });
      const r2 = escribir(D.L, { s: "llama", x: r.x1, y: 30.5, tam, color: "magenta", font: negra });
      escribir(D.L, { s: "\"", x: r2.x1, y: 30.5, tam, color: "papel", font: negra });
      D.caps.push(tam * 0.7);
    },
  },
  {
    id: "dev-tests", grupo: "devs",
    lineas: { es: ["Mi sorteo", "tiene tests"], en: ["My draw", "has tests"] },
    dibujar(D, l, t) {
      caja(D.L, { x: 7, y: 1.5, w: 36, h: 25, fill: "tarjeta", borde: 0.9, sombra: 1.5, sombraCol: "tinta" });
      D.r(7, 1.5, 37.5, 26.5);
      [0, 1, 2].forEach((i) => {
        const yy = 5 + i * 7.2;
        D.L.add(rect(10.5, yy, 5.6, 5.6), "tinta"); D.L.add(rect(11.2, yy + 0.7, 4.2, 4.2), "turquesa");
        tilde(D.L, { x: 11.55, y: yy + 1.3, celda: 0.39, color: "sobre" });
        D.L.add(rect(18.5, yy + 1.4, [19, 14, 17][i], 1.4), C.barra);
        D.L.add(rect(18.5, yy + 3.4, [12, 16, 9][i], 1.1), C.barra);
      });
      cinta(D, { lineas: t, cx: 25, y: 28.5, ancho: 40, fill: "magenta" });
    },
  },
  {
    id: "dev-hola", grupo: "devs",
    lineas: { es: ["Hola,", "mundo"], en: ["Hello,", "world"] },
    dibujar(D, l, t) {
      llama(D, { x: 2, y: 17, alto: 25, contorno: 0.9, sombra: 1.4 });
      // El globo de diálogo, con la cola hacia la cabeza de la llama.
      const g = cinta(D, { lineas: t, cx: 35, y: 1.5, ancho: 25, fill: "tarjeta", color: "tinta", rot: 0, tamMax: 9, pad: 2.4 });
      const izq = 35 - g.w / 2, yb = g.y1;
      D.L.add(poli([[izq + 1.2, yb - 1.4], [izq + 7.6, yb - 1.4], [izq - 2.2, yb + 3.6]]), "tinta");
      D.L.add(poli([[izq + 2.4, yb - 1.6], [izq + 6.2, yb - 1.6], [izq - 0.4, yb + 1.8]]), "tarjeta");
      D.r(izq - 3, yb - 1.5, 11, 6.5);
    },
  },
  // ── Especial Tarija ──
  {
    id: "tarija", grupo: "tarija", texto: { es: "Tinkazo en Tarija", en: "Tinkazo in Tarija" },
    lineas: { es: ["Tinkazo en", "TARIJA"], en: ["Tinkazo in", "TARIJA"] },
    dibujar(D, l, t) {
      valle(D, { cx: 25, cy: 19, r: 17.5 });
      const ll = { x: 8.5, y: 5.2, alto: 27 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      sombreroChapaco(D, ll);
      const k = ll.alto / 26;
      racimo(D, { x: ll.x + 22.3 * k, y: ll.y + 5.6 * k, u: 1.45 });
      brillo(D, 43, 2.5, 0.65, "amarillo");
      const a = cinta(D, { lineas: [t[0]], cx: 21, y: 30.6, ancho: 35, fill: "tarjeta", color: "tinta", rot: -3, tamMax: 6 });
      cinta(D, { lineas: [t[1]], cx: 25, y: a.y1 + 0.6, ancho: 40, fill: "magenta", rot: -3, tamMax: 11 });
    },
  },
  {
    id: "tarija-laptop", grupo: "tarija", langs: [null],
    lineas: { null: ["DevFest", "Tarija 2026"] },
    dibujar(D) {
      valle(D, { cx: 25, cy: 19, r: 17.5, noche: true });
      const ll = { x: 17.5, y: 6.5, alto: 25 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      sombreroChapaco(D, ll);
      // La laptop, de espaldas: la tapa con sus stickers (la llama, unas uvas y un «</>») y la base.
      const lx = 3.2, ly = 16.2, lw = 21.5, lh = 14.8;
      caja(D.L, { x: lx, y: ly, w: lw, h: lh, fill: "#3b3a4a", borde: 0.85, sombra: 1.4, radio: 1.2 });
      D.r(lx, ly, lw + 1.4, lh + 1.4);
      caja(D.L, { x: lx - 2.5, y: ly + lh - 0.2, w: lw + 5, h: 2.4, fill: C.metal, borde: 0.8, sombra: 1.2, radio: 0.8 });
      D.r(lx - 2.5, ly + lh - 0.2, lw + 6.2, 3.6);
      D.L.add(circulo(lx + 5.6, ly + 5.4, 3.6), C.blanco);
      llamaGrande(D.L, { x: lx + 3, y: ly + 2.4, alto: 6, color: "magenta" });
      caja(D.L, { x: lx + 10.6, y: ly + 2.2, w: 8.8, h: 4.6, fill: "turquesa", borde: 0.45, sombra: 0, radio: 1 });
      escribir(D.L, { s: "</>", x: lx + 15, y: ly + 5.9, tam: 4, ancla: "c", color: "tinta", font: negra });
      racimo(D, { x: lx + 11.2, y: ly + 7.6, u: 0.85 });
      brillo(D, 44.5, 6, 0.65, "amarillo");
      cinta(D, { lineas: ["DevFest", "Tarija 2026"], cx: 25, y: 33, ancho: 38, fill: "amarillo", tamMax: 8 });
    },
  },
];

// ───────────────────────── Troquel, sangrado y salidas ─────────────────────────
const BORDE = 2.6; // el borde blanco alrededor del dibujo, en unidades (≈2,4 mm a 5 cm)
const MAX_SANGRE = 4.5; // el sangrado más grande que se pide, en unidades
const LANGS = ["es", "en"];
export const LADO_PNG = 512; // el lado mayor de los PNG de vista previa
export const langsDe = (st) => st.langs ?? LANGS;
export const nombreDe = (st, lang) => (lang ? `${st.id}-${lang}` : st.id);

const memo = new Map();
function base(st, lang, conSello) {
  const clave = `${nombreDe(st, lang)}${conSello ? "" : "-sin-sello"}`;
  if (memo.has(clave)) return memo.get(clave);
  const D = new Dib(lang);
  st.dibujar(D, lang, st.lineas[lang]);
  if (st.num) numero(D, st.num, ...(st.insignia ?? [2.5, 1.5]));
  const capSello = conSello ? sello(D, st.sello) : 0;
  const c = campo(D.masa, BORDE + MAX_SANGRE);
  const corte = silueta(c, BORDE);
  if (corte.length !== 1) throw new Error(`${clave}: la silueta tiene ${corte.length} partes`);
  const b = { D, c, corte, caja: cajaLazos(corte), capSello };
  memo.set(clave, b);
  return b;
}

/**
 * Un sticker a tamaño real: la medida mayor del troquel es `cm`. Las formas tienen (0, 0) en la esquina del troquel.
 * Con `sello: false` sale sin la etiqueta de la dirección (para los impresos, que ya la dicen en grande).
 */
export function stickerColeccion(st, lang, cm, sangre, { sello: conSello = true } = {}) {
  const b = base(st, lang, conSello);
  const s = cm * 10 / Math.max(b.caja.w, b.caja.h);
  const fondo = sangre ? silueta(b.c, BORDE + sangre / s) : b.corte;
  const tr = (cmds) => afin(cmds, s, 0, 0, s, -b.caja.x * s, -b.caja.y * s);
  const formas = [
    { cmds: tr(aCmds(fondo)), fill: "#ffffff" },
    ...b.D.L.formas.map((f) => ({ ...f, cmds: tr(f.cmds) })),
    { cmds: tr(aCmds(b.corte)), trazo: "#ff00ff", grosor: 0.25, capa: "corte" },
  ];
  return { w: b.caja.w * s, h: b.caja.h * s, formas, capMin: Math.min(...b.D.caps) * s, capSello: b.capSello * s };
}

const mueve = (formas, dx, dy) => formas.map((f) => ({ ...f, cmds: afin(f.cmds, 1, 0, 0, 1, dx, dy) }));
/** El PNG de un conjunto de formas en mm, con fondo transparente. */
function png(formas, wMm, hMm, lado) {
  const e = lado / Math.max(wMm, hMm), W = Math.round(wMm * e), H = Math.round(hMm * e);
  const f = formas.filter((x) => x.fill).map((x) => ({ ...x, cmds: afin(x.cmds, e, 0, 0, e, 0, 0) }));
  return pngNivel(W, H, rasterizar(f, W, H));
}

/** Una hoja: los stickers en una grilla de celdas de `cm`, con 5 mm de aire entre troqueles. */
export function hojaColeccion(lista, { cm = 5, ancho, alto, cols, aire = 5, sangre = 2 }) {
  const lado = cm * 10, filas = Math.ceil(lista.length / cols);
  const W = cols * lado + (cols - 1) * aire, H = filas * lado + (filas - 1) * aire;
  const x0 = (ancho - W) / 2, y0 = (alto - H) / 2;
  const formas = [];
  lista.forEach(([st, lang], k) => {
    const s = stickerColeccion(st, lang, cm, sangre);
    const fila = Math.floor(k / cols), col = k % cols;
    const n = Math.min(cols, lista.length - fila * cols); // la última fila va centrada
    const dx = x0 + (cols - n) * (lado + aire) / 2 + col * (lado + aire) + (lado - s.w) / 2, dy = y0 + fila * (lado + aire) + (lado - s.h) / 2;
    formas.push(...mueve(s.formas, dx, dy));
  });
  return { ancho, alto, formas: [...formas.filter((f) => f.capa !== "corte"), ...formas.filter((f) => f.capa === "corte")] };
}

const porId = Object.fromEntries(COLECCION.map((s) => [s.id, s]));
/** Los nueve de la hoja «laptop», con por qué cada uno. */
export const LAPTOP = [
  ["carrera", "La llama del logo a toda velocidad: es la marca y se reconoce de lejos."],
  ["tarija", "El especial de Tarija, el más trabajado de la tanda: sombrero chapaco, uvas y viñedos."],
  ["tarija-laptop", "El del evento: una llama con su laptop en una laptop, para quien estuvo ahí."],
  ["verificalo", "La promesa de Tinkazo en dos palabras, con una lupa que se lee a un metro."],
  ["dev-mi-llama", "El chiste de quien programa, nacido para pegarse al lado del teclado."],
  ["llama-salio", "El momento del sorteo que todos quieren vivir, con la llama saltando."],
  ["guajojo", "El pájaro de la noche con la luna: la silueta más fuerte de los juegos."],
  ["ruleta", "Los cinco colores de la marca en un círculo: alegra cualquier tapa."],
  ["con-k", "La K grande enseña a escribir el nombre: marketing que se pega solo."],
];
/**
 * Qué va en cada hoja. Las de A4 se llenan con los que más se piden; la «laptop» trae los nueve que más dan ganas de
 * pegar, en 6 cm. La A3 no va en el ZIP (con ella pasaba de los 4 MB que tolera el repo): se baja suelta.
 */
export const HOJAS = {
  "hoja-a4-juegos": { ancho: 210, alto: 297, cols: 3, ids: [...COLECCION.filter((s) => s.grupo === "juegos").map((s) => s.id), "llama-corazon", "llama-dormida", "llama-salio", "caravana", "bolivia"] },
  "hoja-a4-frases": { ancho: 210, alto: 297, cols: 3, ids: ["con-k", "verificalo", "apthapi", "cacharpaya", "todos-lista", "sin-trampa", "dev-mi-llama", "dev-404", "dev-commit", "dev-tests", "dev-hola", "tarija", "tarija-laptop", "caravana", "llama-corazon"] },
  "hoja-a4-laptop": { ancho: 210, alto: 297, cols: 3, cm: 6, ids: LAPTOP.map(([id]) => id) },
  "hoja-a3": { ancho: 297, alto: 420, cols: 5, enZip: false, ids: [...COLECCION.map((s) => s.id), "tarija", "llama-corazon", "dev-404", "con-k"] },
};
const listaHoja = (h, lang) => h.ids.map((id) => [porId[id], porId[id].langs ? null : lang]);

export const GRUPOS = { juegos: ["Los diez juegos, para coleccionar", "The ten games, to collect"], tarija: ["Especial Tarija", "Tarija special"], llama: ["La llama", "The llama"], frases: ["Frases", "Sayings"], devs: ["Para devs", "For developers"] };
const NOTAS = {
  apthapi: ["El apthapi es la comida del altiplano donde cada uno trae algo y se comparte en el suelo, sobre un aguayo.", "An apthapi is the Andean shared meal where everyone brings something and it is laid out on a woven cloth."],
  cacharpaya: ["La cacharpaya es la fiesta de despedida: el cierre del carnaval o de un evento.", "The cacharpaya is the farewell party that closes a carnival or an event."],
  guajojo: ["El guajojó es el pájaro de la noche del oriente boliviano, el de los ojos grandes.", "The guajojó is the night bird of eastern Bolivia, the one with the big eyes."],
  toborochi: ["El toborochi es el árbol panzón de Santa Cruz, con flores rosadas.", "The toborochi is the pot-bellied tree of Santa Cruz, with pink flowers."],
  chovena: ["La chovena es una danza en ronda, de la mano.", "The chovena is a circle dance, hand in hand."],
  entrada: ["La Entrada es el desfile de las fraternidades del Carnaval de Oruro. En inglés, comparsa es crew.", "La Entrada is the parade of the dance groups of the Oruro Carnival."],
  teleferico: ["El teleférico de La Paz y El Alto, con cabinas del color de cada línea.", "The cable car of La Paz and El Alto, with cabins in the color of each line."],
  tarija: ["La llama chapaca, de Tarija: sombrero de ala ancha, un racimo de uvas y los viñedos del valle.", "The chapaca llama, from Tarija: a wide-brimmed hat, a bunch of grapes and the valley vineyards."],
  "tarija-laptop": ["La misma llama chapaca, con su laptop, para el DevFest Tarija del 28 de noviembre de 2026.", "The same chapaca llama, with its laptop, for DevFest Tarija on November 28, 2026."],
};

/** El texto con todas las frases, en los dos idiomas, para el kit. */
export function textoFrases() {
  // Lo que dice el sticker; `texto` cuando el dibujo suma letras fuera de la cinta (APTHAPI, 404).
  const fr = (st, l) => st.texto?.[l] ?? (st.lineas[l] ?? st.lineas.null).join(" ").replace(/\s+/g, " ");
  const bloque = (l) => {
    const salida = [];
    for (const [g, [es, en]] of Object.entries(GRUPOS)) {
      salida.push("", (l === "es" ? es : en).toUpperCase());
      for (const st of COLECCION.filter((s) => s.grupo === g)) {
        const nombre = st.juego ? `${st.num}/10 ${st.juego[l]}: ` : "";
        salida.push(`  ${nombre}${fr(st, l)}`);
        if (NOTAS[st.id]) salida.push(`      ${NOTAS[st.id][l === "es" ? 0 : 1]}`);
      }
    }
    return salida;
  };
  return [
    "TINKAZO, FRASES DE LOS STICKERS",
    "===============================",
    "Para copiar en un pie de foto, una placa de video o un cartel. Siempre se escribe Tinkazo, con K. Instagram: @tinkazo.app",
    ...bloque("es"),
    "",
    "-------------------------------------------------------------------------------",
    "",
    "TINKAZO, STICKER SAYINGS",
    "========================",
    "To copy into a caption, a video title card or a sign. It is always written Tinkazo, with a K. Instagram: @tinkazo.app",
    ...bloque("en"),
    "",
  ].join("\r\n");
}

const LEEME = `TINKAZO, COLECCIÓN DE STICKERS
==============================

28 stickers dibujados por nosotros: los diez juegos de Tinkazo numerados del 1 al 10 para completar la serie (cada uno se elige, no vienen en sobres sorpresa), el especial de Tarija, la llama en sus días buenos, frases nuestras y una tanda para quienes programan. Todos llevan tinkazo.app en una etiqueta chica abajo.

QUÉ HAY ADENTRO
  stickers/  Cada sticker suelto a tamaño real, en PDF de 5 y de 7 cm (la medida mayor del troquel) y en SVG de 5 cm (1 unidad = 1 mm). El SVG se agranda sin perder calidad. Con 3 mm de sangrado y la capa 'corte' con la línea de troquelado, que sigue la silueta del dibujo con un borde blanco. Los de texto vienen en español (-es) y en inglés (-en).
  hojas/     Listas para la imprenta, en PDF: hoja A4 de los juegos y la llama, hoja A4 de frases, devs y Tarija (de 5 cm), y la hoja laptop, con los nueve que más dan ganas de pegar, de 6 cm. Con 5 mm de aire entre troqueles y 2 mm de sangrado. La hoja A3 con los 28 se baja suelta desde https://tinkazo.app/marca.html.
  Los PNG de 512 px con fondo transparente, para redes o para un video, van aparte en tinkazo-stickers-png.zip (con todo junto pasaba de los 4 MB): https://tinkazo.app/marca.html
  frases.txt Todas las frases en español y en inglés, con lo que quieren decir las palabras bolivianas.

PARA IMPRIMIR
  Vinilo mate con laminado, troquelado (die-cut). Si se reparten muchos en un evento, mejor kiss-cut: queda el papel de atrás y se despegan fácil. Los colores son RGB: la imprenta los convierte. Las letras están en trazos.

Sitio: https://tinkazo.app
Instagram: @tinkazo.app
Contacto: hola@tinkazo.app

-------------------------------------------------------------------------------

TINKAZO, STICKER COLLECTION
===========================

28 stickers we drew ourselves: the ten Tinkazo games numbered 1 to 10 to complete the series (you pick each one, there are no mystery packs), the Tarija special, the llama on its good days, our own sayings and a batch for people who code. Each one carries tinkazo.app on a small tag at the bottom.

WHAT IS INSIDE
  stickers/  Each sticker on its own at true size, as 5 and 7 cm PDF (the longest side of the cut) and 5 cm SVG (1 unit = 1 mm). The SVG scales up without losing quality. With 3 mm bleed and the 'corte' layer holding the die-cut line, which follows the drawing with a white border. The ones with text come in Spanish (-es) and English (-en).
  hojas/     Print-ready PDF sheets: an A4 sheet with the games and the llama, an A4 sheet with sayings, developer stickers and Tarija (at 5 cm), and the laptop sheet with the nine you most want to stick on one, at 6 cm. 5 mm apart with 2 mm bleed. The A3 sheet with all 28 is a separate download at https://tinkazo.app/marca.html.
  The 512 px PNG files with a transparent background, for social media or a video, come separately in tinkazo-stickers-png.zip (all together it went over 4 MB): https://tinkazo.app/marca.html
  frases.txt Every saying in Spanish and English, with what the Bolivian words mean.

PRINTING
  Matte laminated vinyl, die-cut. If you hand out many at an event, kiss-cut is better: the backing stays and they peel easily. Colors are RGB: the printer converts them. The lettering is converted to outlines.

Site: https://tinkazo.app
Instagram: @tinkazo.app
Contact: hola@tinkazo.app

The lettering is drawn from Montserrat (SIL Open Font License 1.1, https://openfontlicense.org).
`.replace(/\n/g, "\r\n");

/** Genera todo en public/marca/coleccion/ y devuelve un resumen. */
export function generarColeccion(destino) {
  mkdirSync(destino, { recursive: true });
  const escribir = (n, d) => writeFileSync(new URL(n, destino), d);
  const zipE = [], zipPng = [];
  const raiz = "tinkazo-stickers";
  const SANGRE = 3;
  const caps = [], sellos = [];
  for (const st of COLECCION) for (const lang of langsDe(st)) {
    const nombre = nombreDe(st, lang);
    for (const cm of [5, 7]) {
      const s = stickerColeccion(st, lang, cm, SANGRE);
      if (cm === 5) { caps.push([nombre, s.capMin]); sellos.push(s.capSello); }
      const w = s.w + 2 * SANGRE, h = s.h + 2 * SANGRE, formas = mueve(s.formas, SANGRE, SANGRE);
      // El SVG va solo en 5 cm (se agranda sin perder nada); el PDF, en las dos medidas. Así el ZIP queda por debajo de 4 MB.
      if (cm === 5) zipE.push([`${raiz}/stickers/tinkazo-${nombre}-${cm}cm.svg`, Buffer.from(svgMm(w, h, formas, `Tinkazo, sticker de ${cm} cm con ${SANGRE} mm de sangrado`))]);
      zipE.push([`${raiz}/stickers/tinkazo-${nombre}-${cm}cm.pdf`, pdf(w, h, SANGRE, formas)]);
    }
    const v = stickerColeccion(st, lang, 5, 0);
    const p = png(v.formas, v.w, v.h, LADO_PNG);
    escribir(`${nombre}.png`, p);
    zipPng.push([`${raiz}-png/tinkazo-${nombre}.png`, p]);
  }
  for (const [id, h] of Object.entries(HOJAS)) for (const lang of LANGS) {
    const hoja = hojaColeccion(listaHoja(h, lang), { ancho: h.ancho, alto: h.alto, cols: h.cols, cm: h.cm ?? 5 });
    const nombre = `${id}-${lang}`;
    const p = pdf(hoja.ancho, hoja.alto, 0, hoja.formas);
    escribir(`${nombre}.pdf`, p);
    if (h.enZip !== false) zipE.push([`${raiz}/hojas/tinkazo-stickers-${nombre}.pdf`, p]);
    const fondo = { cmds: rect(0, 0, hoja.ancho, hoja.alto), fill: "#e9e2d4" };
    escribir(`${nombre}.png`, png([fondo, ...hoja.formas], hoja.ancho, hoja.alto, 700));
  }
  const frases = Buffer.from(textoFrases(), "utf8");
  escribir("frases.txt", frases);
  zipE.push([`${raiz}/frases.txt`, frases], [`${raiz}/LEEME.txt`, Buffer.from(LEEME, "utf8")]);
  const z = zip(zipE);
  escribir("tinkazo-stickers.zip", z);
  // Los PNG van en su propio ZIP: con ellos adentro, el de la imprenta pasaba de los 4 MB que tolera el repo.
  escribir("tinkazo-stickers-png.zip", zip(zipPng));
  return { stickers: COLECCION.length, archivosZip: zipE.length, archivosPng: zipPng.length, capMin: caps.sort((a, b) => a[1] - b[1])[0], capSello: Math.min(...sellos) };
}
