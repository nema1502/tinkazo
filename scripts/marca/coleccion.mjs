/**
 * La colección de stickers con personaje: los diez juegos numerados para completar la serie (sin sobres sorpresa:
 * cada uno se elige), la llama en sus días buenos, frases nuestras y una tanda para quienes programan.
 *
 * Todo se dibuja acá con formas planas: pixel art como el logo, unas pocas formas limpias y las letras de Montserrat
 * en trazos. La llama sigue sin cara ni poncho: lo tierno sale de la pose y de lo que la acompaña. Los demás
 * personajes (el sapo, el guajojó, la bailarina) sí tienen ojos, como en los juegos.
 *
 * Cada sticker se troquela por su silueta: la unión de lo dibujado, agrandada un borde blanco, con 3 mm de sangrado
 * y la línea de corte en una capa aparte. Sale en 5 y 7 cm (SVG y PDF), en hojas A4 y A3 y en PNG transparente.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { negra, seminegra, rect, circulo, poli, afin, rotar, rects as RECTS_LLAMA, anchoLlama, contornoUnion, rasterizar, pngNivel, pdf, svgMm, zip, azar } from "./base.mjs";
import { Lienzo, escribir, caja, medir, banderines, llamaGrande, tilde } from "./dibujo.mjs";
import { campo, silueta, aCmds, cajaLazos } from "./silueta.mjs";

// ───────────────────────── Colores ─────────────────────────
// Los de la marca (por nombre, del tema claro) y los de los personajes, tomados de los juegos.
const C = {
  blanco: "#ffffff", noche: "#2b2357", estrella: "#fff6e9",
  rojoBo: "#d52b1e", amarilloBo: "#f9e300", verdeBo: "#007934",
  sapo: "#c9953f", sapoOsc: "#97692a", panza: "#efcf8a", boca: "#3a2316", lengua: "#f2788f",
  pluma: "#8b7f72", plumaClara: "#b7ab9b", pico: "#4a3f36", rama: "#7a4f2a",
  rosa: "#f79cc8", tronco: "#7fb069", troncoOsc: "#5e8f4c", espina: "#f4efd6",
  madera: "#c98a4b", maderaOsc: "#8d5a2b", metal: "#b9c0c8",
  cielo: "#bfe3f2", nieve: "#ffffff", cerro: "#8a73e8", cerroOsc: "#6c4ce0",
  corazon: "#ff4d6d", fantasma: "#f3eee6", barra: "#e9e2d4",
  piel1: "#c68b59", piel2: "#8d5524", piel3: "#e0ac69", piel4: "#a0673f", pelo: "#3b2418", mejilla: "#f08aa8",
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
/** El número de la serie en una pastilla chica: "3/10". */
function numero(D, n, x, y) {
  const s = `${n}/10`, tam = 3.6, pad = 1.2;
  const w = medir(s, tam, { font: negra }) + 2 * pad, h = tam * 0.7 + 2 * pad;
  caja(D.L, { x, y, w, h, fill: "tarjeta", borde: 0.6, sombra: 0.8, radio: h / 2 });
  escribir(D.L, { s, x: x + w / 2, y: y + pad + tam * 0.7, tam, ancla: "c", color: "tinta", font: negra });
  D.r(x, y, w + 0.8, h + 0.8);
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
const SAPO = [
  "....ssss....ssss....",
  "...swwwws..swwwws...",
  "...swwkks..swwkks...",
  "...swwkks..swwkks...",
  "..ssssssssssssssss..",
  ".ssssssssssssssssss.",
  ".sssbbbbbbbbbbbbsss.",
  "ssrsbbbbbbbbbbbbsrss",
  "sssssbbbllllbbbsssss",
  "ssssssbbbbbbbbssssss",
  "ssssyyyyyyyyyyyyssss",
  ".sssyyyyyyyyyyyysss.",
  "sss.ssssssssssss.sss",
  "ssss..ssssssss..ssss",
];
const ARGOLLA = [".aaaa.", "aaaaaa", "aa..aa", "aa..aa", "aaaaaa", ".aaaa."];
const GUAJOJO = [
  "....gggggg....",
  "..gggggggggg..",
  ".gaaaaggaaaag.",
  ".gakkaggakkag.",
  ".gakkaggakkag.",
  ".gaaaaggaaaag.",
  "..ggggddgggg..",
  "..gggggggggg..",
  ".gglgggglgggg.",
  ".gggglggggglg.",
  ".gglggggglggg.",
  "..gggglggggg..",
  "..gglgggglgg..",
  "...gggggggg...",
  "...gggggggg...",
  "....gggggg....",
  ".....gggg.....",
];
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
/** El tronco del toborochi: una botella que se ensancha, con sus espinas. */
function tronco() {
  const anchos = [3, 3, 3, 3, 4, 5, 7, 9, 11, 12, 12, 11, 12];
  const W = 12;
  return anchos.map((a, j) => {
    const i0 = Math.floor((W - a) / 2);
    return Array.from({ length: W }, (_, i) => {
      if (i < i0 || i >= i0 + a) return ".";
      if (i === i0 + a - 1 && j > 4 && j < 12) return "o";
      return (i * 7 + j * 5) % 9 === 0 && j > 2 && j < 11 ? "e" : "t";
    }).join("");
  });
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
      cinta(D, { lineas: t, cx: 25, y: 34, ancho: 40, fill: "magenta" });
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
    id: "sapo", grupo: "juegos", num: 5, juego: { es: "Sapo", en: "Frog toss" }, insignia: [39.5, 1],
    lineas: { es: ["¡ADENTRO!"], en: ["RIGHT IN!"] },
    dibujar(D, l, t) {
      pixeles(D, SAPO, { x: 8, y: 8, p: 1.95, col: { s: C.sapo, b: C.boca, l: C.lengua, y: C.panza, r: C.mejilla }, borde: 0.85, sombra: 1.4 });
      pixeles(D, ARGOLLA, { x: 3.6, y: 2.6, p: 1.3, borde: 0.7, sombra: 0.9, rot: -25 });
      [[12, 4.4], [14.6, 6.2]].forEach(([x, y], i) => { D.L.add(rotar(rect(x, y, 2.6 - i * 0.7, 1), 30, x, y), "tinta"); D.c(x + 1, y + 0.5, 1.2); });
      cinta(D, { lineas: t, cx: 27, y: 37, ancho: 32, fill: "amarillo" });
    },
  },
  {
    id: "guajojo", grupo: "juegos", num: 6, juego: { es: "Guajojó", en: "Guajojó" },
    lineas: { es: ["Te estoy viendo"], en: ["I see you"] },
    dibujar(D, l, t) {
      disco(D, 25, 19.5, 18.5, C.noche, { borde: 0.9, sombra: 1.4 });
      D.L.add(circulo(11, 14, 3.2), "amarillo"); D.L.add(circulo(12.6, 12.9, 2.8), C.noche);
      for (const [x, y] of [[13.5, 5.5], [8.5, 22], [41, 23], [38.5, 10], [30, 3.6]]) pixeles(D, [".w.", "www", ".w."], { x, y, p: 0.75, borde: 0, col: { w: C.estrella } });
      D.L.add(rect(7, 31.6, 36, 3.2), "tinta"); D.L.add(rect(7.8, 32.4, 34.4, 1.6), C.rama);
      D.L.add(rect(34, 28.6, 1.6, 4), "tinta"); D.L.add(rect(34.4, 29.2, 0.8, 3), C.rama);
      pixeles(D, GUAJOJO, { x: 13.1, y: 3.4, p: 1.7, col: { g: C.pluma, l: C.plumaClara, d: C.pico }, borde: 0.8, sombra: 1.2 });
      cinta(D, { lineas: t, cx: 25, y: 37, ancho: l === "es" ? 42 : 32, fill: "amarillo" });
    },
  },
  {
    id: "toborochi", grupo: "juegos", num: 7, juego: { es: "Toborochi", en: "Toborochi" },
    lineas: { es: ["Panza llena,", "corazón contento"], en: ["Full belly,", "happy heart"] },
    dibujar(D, l, t) {
      pixeles(D, tronco(), { x: 25 - 6 * 1.5, y: 12.5, p: 1.5, col: { t: C.tronco, o: C.troncoOsc, e: C.espina }, borde: 0.85, sombra: 1.3 });
      const copa = [[15.5, 11, 6.2], [25, 7.5, 7.2], [34.5, 11, 6.2], [20, 15.5, 5.4], [30, 15.5, 5.4], [9.5, 15.8, 4.2], [40.5, 15.8, 4.2]];
      for (const [x, y, r] of copa) { D.L.add(circulo(x + 1.2, y + 1.2, r + 0.85), "tinta"); D.c(x + 0.6, y + 0.6, r + 1.5); }
      for (const [x, y, r] of copa) D.L.add(circulo(x, y, r + 0.85), "tinta");
      for (const [x, y, r] of copa) D.L.add(circulo(x, y, r), C.rosa);
      for (const [x, y] of [[13, 9], [22, 5], [31, 8], [37, 13], [18, 15], [27, 13], [10, 16.5], [41, 16.5], [33, 17]]) {
        pixeles(D, [".m.", "mam", ".m."], { x: x - 1, y: y - 1, p: 0.75, borde: 0 });
      }
      cinta(D, { lineas: t, cx: 25, y: 31.5, ancho: 44, fill: "turquesa" });
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
    id: "teleferico", grupo: "juegos", num: 10, juego: { es: "Teleférico", en: "Cable car" }, insignia: [3, 1.5],
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
      cinta(D, { lineas: t, cx: 25, y: 30, ancho: 40, fill: "amarillo" });
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
    lineas: { es: ["Nadie se", "queda afuera"], en: ["No one", "is left out"] },
    dibujar(D, l, t) {
      banderines(D.L, { x0: 3, x1: 47, y: 2.5, n: 7, alto: 4.6, sag: 1.6, hilo: 0.55, fondoCalado: "tarjeta" });
      D.r(2.5, 1.8, 45, 6.4);
      ["magenta", "naranja", "amarillo", "turquesa", "morado"].forEach((col, i) => llama(D, { x: 1.5 + i * 9.3, y: i % 2 ? 11 : 12.5, alto: 13, color: col, contorno: 0.7, sombra: 0.9 }));
      cinta(D, { lineas: t, cx: 25, y: 30, ancho: 40, fill: "naranja" });
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
    id: "todos-adentro", grupo: "frases",
    lineas: { es: ["TODOS", "ADENTRO"], en: ["EVERYONE'S", "IN"] },
    dibujar(D, l, t) {
      llama(D, { x: 16.5, y: 2, alto: 20, contorno: 0.85, sombra: 1.2 });
      chispas(D, { semilla: 11, n: 8, area: [3, 1, 44, 21], evitar: [[14.5, 0, 22, 23]], lado: 1.6 });
      cinta(D, { lineas: t, cx: 25, y: 24, ancho: l === "es" ? 40 : 42, fill: "naranja", tamMax: 12 });
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
      // La dirección en la barra de la ventana: el sticker que se fotografía dice de dónde es.
      const u = escribir(D.L, { s: "tinkazo.app", x: 44, y: 6.4, tam: 4.2, color: "tinta", font: negra, ancla: "r" });
      D.caps.push(u.cap);
      cinta(D, { lineas: t, cx: 25, y: 30.5, ancho: 40, fill: "amarillo" });
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
      // La dirección, chica, arriba del número: el sticker dice de dónde es.
      const u = escribir(D.L, { s: "tinkazo.app", x: 36.5, y: 6.2, tam: 4.8, color: "tinta", font: negra, ancla: "c" });
      D.caps.push(u.cap);
      D.r(u.x0 - 0.6, 6.2 - u.cap - 0.8, u.ancho + 1.2, u.cap + 1.8);
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
];

// ───────────────────────── Troquel, sangrado y salidas ─────────────────────────
const BORDE = 2.6; // el borde blanco alrededor del dibujo, en unidades (≈2,4 mm a 5 cm)
const MAX_SANGRE = 4.5; // el sangrado más grande que se pide, en unidades
const LANGS = ["es", "en"];
export const LADO_PNG = 512; // el lado mayor de los PNG de vista previa
export const langsDe = (st) => st.langs ?? LANGS;
export const nombreDe = (st, lang) => (lang ? `${st.id}-${lang}` : st.id);

const memo = new Map();
function base(st, lang) {
  const clave = nombreDe(st, lang);
  if (memo.has(clave)) return memo.get(clave);
  const D = new Dib(lang);
  st.dibujar(D, lang, st.lineas[lang]);
  if (st.num) numero(D, st.num, ...(st.insignia ?? [2.5, 1.5]));
  const c = campo(D.masa, BORDE + MAX_SANGRE);
  const corte = silueta(c, BORDE);
  if (corte.length !== 1) throw new Error(`${clave}: la silueta tiene ${corte.length} partes`);
  const b = { D, c, corte, caja: cajaLazos(corte) };
  memo.set(clave, b);
  return b;
}

/** Un sticker a tamaño real: la medida mayor del troquel es `cm`. Las formas tienen (0, 0) en la esquina del troquel. */
export function stickerColeccion(st, lang, cm, sangre) {
  const b = base(st, lang);
  const s = cm * 10 / Math.max(b.caja.w, b.caja.h);
  const fondo = sangre ? silueta(b.c, BORDE + sangre / s) : b.corte;
  const tr = (cmds) => afin(cmds, s, 0, 0, s, -b.caja.x * s, -b.caja.y * s);
  const formas = [
    { cmds: tr(aCmds(fondo)), fill: "#ffffff" },
    ...b.D.L.formas.map((f) => ({ ...f, cmds: tr(f.cmds) })),
    { cmds: tr(aCmds(b.corte)), trazo: "#ff00ff", grosor: 0.25, capa: "corte" },
  ];
  return { w: b.caja.w * s, h: b.caja.h * s, formas, capMin: Math.min(...b.D.caps) * s };
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
/** Qué va en cada hoja. Las de A4 se llenan con los que más se piden. */
export const HOJAS = {
  "hoja-a4-juegos": { ancho: 210, alto: 297, cols: 3, ids: [...COLECCION.filter((s) => s.grupo === "juegos").map((s) => s.id), "llama-corazon", "llama-dormida", "llama-salio", "caravana", "bolivia"] },
  "hoja-a4-frases": { ancho: 210, alto: 297, cols: 3, ids: ["con-k", "verificalo", "apthapi", "cacharpaya", "todos-adentro", "sin-trampa", "dev-mi-llama", "dev-404", "dev-commit", "dev-tests", "dev-hola", "llama-corazon", "caravana", "sapo", "toborochi"] },
  "hoja-a3": { ancho: 297, alto: 420, cols: 5, ids: [...COLECCION.map((s) => s.id), "llama-corazon", "dev-404", "caravana", "con-k"] },
};
const listaHoja = (h, lang) => h.ids.map((id) => [porId[id], porId[id].langs ? null : lang]);

export const GRUPOS = { juegos: ["Los diez juegos, para coleccionar", "The ten games, to collect"], llama: ["La llama", "The llama"], frases: ["Frases", "Sayings"], devs: ["Para devs", "For developers"] };
const NOTAS = {
  apthapi: ["El apthapi es la comida del altiplano donde cada uno trae algo y se comparte en el suelo, sobre un aguayo.", "An apthapi is the Andean shared meal where everyone brings something and it is laid out on a woven cloth."],
  cacharpaya: ["La cacharpaya es la fiesta de despedida: el cierre del carnaval o de un evento.", "The cacharpaya is the farewell party that closes a carnival or an event."],
  guajojo: ["El guajojó es el pájaro de la noche del oriente boliviano, el de los ojos grandes.", "The guajojó is the night bird of eastern Bolivia, the one with the big eyes."],
  toborochi: ["El toborochi es el árbol panzón de Santa Cruz, con flores rosadas.", "The toborochi is the pot-bellied tree of Santa Cruz, with pink flowers."],
  chovena: ["La chovena es una danza en ronda, de la mano.", "The chovena is a circle dance, hand in hand."],
  entrada: ["La Entrada es el desfile de las fraternidades del Carnaval de Oruro. En inglés, comparsa es crew.", "La Entrada is the parade of the dance groups of the Oruro Carnival."],
  teleferico: ["El teleférico de La Paz y El Alto, con cabinas del color de cada línea.", "The cable car of La Paz and El Alto, with cabins in the color of each line."],
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

26 stickers dibujados por nosotros: los diez juegos de Tinkazo numerados del 1 al 10 para completar la serie (cada uno se elige, no vienen en sobres sorpresa), la llama en sus días buenos, frases nuestras y una tanda para quienes programan.

QUÉ HAY ADENTRO
  stickers/  Cada sticker suelto a tamaño real, en PDF de 5 y de 7 cm (la medida mayor del troquel) y en SVG de 5 cm (1 unidad = 1 mm; se agranda sin perder calidad). Con 3 mm de sangrado y la capa 'corte' con la línea de troquelado, que sigue la silueta del dibujo con un borde blanco. Los de texto vienen en español (-es) y en inglés (-en).
  hojas/     Listas para la imprenta, en PDF: hoja A4 de los juegos y la llama, hoja A4 de frases y devs, y hoja A3 con los 26, todos de 5 cm, con 5 mm de aire entre troqueles y 2 mm de sangrado.
  png/       Cada sticker en PNG de 512 px, con fondo transparente, para redes o para un video.
  frases.txt Todas las frases en español y en inglés, con lo que quieren decir las palabras bolivianas.

PARA IMPRIMIR
  Vinilo mate con laminado, troquelado (die-cut). Si se reparten muchos en un evento, mejor kiss-cut: queda el papel de atrás y se despegan fácil. Los colores son RGB: la imprenta los convierte. Las letras están en trazos.

Sitio: https://tinkazo.app
Instagram: @tinkazo.app
Contacto: hola@tinkazo.app

-------------------------------------------------------------------------------

TINKAZO, STICKER COLLECTION
===========================

26 stickers we drew ourselves: the ten Tinkazo games numbered 1 to 10 to complete the series (you pick each one, there are no mystery packs), the llama on its good days, our own sayings and a batch for people who code.

WHAT IS INSIDE
  stickers/  Each sticker on its own at true size, as 5 and 7 cm PDF (the longest side of the cut) and 5 cm SVG (1 unit = 1 mm; it scales up without losing quality). With 3 mm bleed and the 'corte' layer holding the die-cut line, which follows the drawing with a white border. The ones with text come in Spanish (-es) and English (-en).
  hojas/     Print-ready PDF sheets: an A4 sheet with the games and the llama, an A4 sheet with sayings and developer stickers, and an A3 sheet with all 26, all at 5 cm, 5 mm apart with 2 mm bleed.
  png/       Each sticker as a 512 px PNG with a transparent background, for social media or a video.
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
  const zipE = [];
  const raiz = "tinkazo-stickers";
  const SANGRE = 3;
  const caps = [];
  for (const st of COLECCION) for (const lang of langsDe(st)) {
    const nombre = nombreDe(st, lang);
    for (const cm of [5, 7]) {
      const s = stickerColeccion(st, lang, cm, SANGRE);
      if (cm === 5) caps.push([nombre, s.capMin]);
      const w = s.w + 2 * SANGRE, h = s.h + 2 * SANGRE, formas = mueve(s.formas, SANGRE, SANGRE);
      // El SVG va solo en 5 cm (se agranda sin perder nada); el PDF, en las dos medidas. Así el ZIP queda por debajo de 4 MB.
      if (cm === 5) zipE.push([`${raiz}/stickers/tinkazo-${nombre}-${cm}cm.svg`, Buffer.from(svgMm(w, h, formas, `Tinkazo, sticker de ${cm} cm con ${SANGRE} mm de sangrado`))]);
      zipE.push([`${raiz}/stickers/tinkazo-${nombre}-${cm}cm.pdf`, pdf(w, h, SANGRE, formas)]);
    }
    const v = stickerColeccion(st, lang, 5, 0);
    const p = png(v.formas, v.w, v.h, LADO_PNG);
    escribir(`${nombre}.png`, p);
    zipE.push([`${raiz}/png/tinkazo-${nombre}.png`, p]);
  }
  for (const [id, h] of Object.entries(HOJAS)) for (const lang of LANGS) {
    const hoja = hojaColeccion(listaHoja(h, lang), { ancho: h.ancho, alto: h.alto, cols: h.cols });
    const nombre = `${id}-${lang}`;
    const titulo = `Tinkazo, ${id.startsWith("hoja-a3") ? "hoja A3" : "hoja A4"} de stickers de 5 cm`;
    const p = pdf(hoja.ancho, hoja.alto, 0, hoja.formas);
    escribir(`${nombre}.pdf`, p);
    zipE.push([`${raiz}/hojas/tinkazo-stickers-${nombre}.pdf`, p]);
    void titulo;
    const fondo = { cmds: rect(0, 0, hoja.ancho, hoja.alto), fill: "#e9e2d4" };
    escribir(`${nombre}.png`, png([fondo, ...hoja.formas], hoja.ancho, hoja.alto, 700));
  }
  const frases = Buffer.from(textoFrases(), "utf8");
  escribir("frases.txt", frases);
  zipE.push([`${raiz}/frases.txt`, frases], [`${raiz}/LEEME.txt`, Buffer.from(LEEME, "utf8")]);
  const z = zip(zipE);
  escribir("tinkazo-stickers.zip", z);
  return { stickers: COLECCION.length, archivosZip: zipE.length, capMin: caps.sort((a, b) => a[1] - b[1])[0] };
}
