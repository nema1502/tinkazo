/**
 * Oriente: Santa Cruz, Beni y Pando, cuatro stickers por departamento (la postal y tres sueltos), y tres de los tiernos
 * de flores y bichos de toda Bolivia (la kantuta, el patujú y el jucumari; el perezoso está en bolivia.mjs).
 *
 *   Santa Cruz: santacruz-tajibo (postal), santacruz-cunape, santacruz-elay, santacruz-achachairu
 *   Beni:       beni-mamore (postal), beni-paraba, beni-victoria, beni-capiguara
 *   Pando:      pando-selva (postal), pando-castana, pando-asai, pando-tucan
 *   Tiernos:    tierno-kantuta, tierno-patuju, tierno-jucumari
 *
 * Acá están también lo que solo usa esta zona: el sombrero de saó de la llama cruceña, sus colores, los tajibos, las
 * hojas y palmeras con borde, y los sprites de los bichos (el bufeo, las parabas, la capiguara, el tucán, el picaflor,
 * la ranita y el jucumari).
 */
import { rect, circulo, poli } from "../base.mjs";
import { caja, escribir } from "../dibujo.mjs";
import { pixeles, llama, llamaEn, disco, bloque, forma, elipse, trazo, brillo, cinta, girar, centroLlama, espejo, CORAZON } from "../pincel.mjs";
import { C as C0, postal, franjaDisco } from "./comun.mjs";

/** La paleta de la serie más los tonos que solo usa el oriente. */
const C = {
  ...C0,
  tajiboOsc: "#e9a400", tajiboClaro: "#fff1a6", tajiboCentro: "#ff7a1a",
  laptop: "#3b3a4a", taza: "#ffffff", cafe: "#6b3e26", vapor: "#f3eee6",
  cunapeOsc: "#d99a2b", cunapeClaro: "#fbe29a",
  achachairuOsc: "#ec7410", achachairuClaro: "#ffc48a", pulpa: "#fffaf0", pepa: "#8d5a2b",
  // Beni
  bufeoClaro: "#fbd3dc", bufeoLomo: "#b9788e", parabaOsc: "#14649a", parabaCara: "#f4f8fb", parabaBarba: "#2b86d8", picoParaba: "#34303a", rio: "#00a896", rioClaro: "#5fd3c6",
  capiguaraOsc: "#7a4c2c", capiguaraClaro: "#c08a5e", pajarito: "#ffd23f",
  // Pando
  selvaLejos: "#8cc66b", selvaMedio: "#4f9a3a", selvaCerca: "#2f6b2a", copaClaro: "#5f9e4a",
  vaso: "#e6f6f8", asaiEspuma: "#9b5aa8", asaiFruta: "#3a1640",
  castanaOsc: "#6b4220", castanaHueco: "#3b2414", castanaClaro: "#c9a27a",
  tucan: "#26242c", tucanBrillo: "#45424f", tucanPico: "#3c3946", tucanOjo: "#5bc0eb", tucanPecho: "#fffdf2",
  // Los tiernos
  kantutaRoja: "#d52b1e", kantutaTubo: "#f9e300", kantutaCaliz: "#007934", picaflor: "#17c3b2", picaflorOsc: "#0f8f83", picaflorClaro: "#bff0e8", oreja: "#6c4ce0",
  rana: "#7ccf4a",
  bromelia: "#d52b1e", helecho: "#5f9e4a",
};

/** Arma un sprite evaluando `f(x, y)` en el centro de cada casilla: devuelve la letra o null para vacío. */
const grilla = (W, H, f) => Array.from({ length: H }, (_, j) => Array.from({ length: W }, (_, i) => f(i + 0.5, j + 0.5) ?? ".").join(""));

/**
 * Una hoja de punta: de la base (x0, y0) a la punta (x1, y1), de `ancho` en el medio, con borde, sombra y la nervadura
 * del medio. `curva` la arquea (positivo hacia la izquierda de la dirección de la hoja).
 */
function hoja(D, { x0, y0, x1, y1, ancho, col = C.hoja, nervio = C.vid, curva = 0, borde = 0.6, sombra = 0.7, masa = true }) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const n = 20, izq = [], der = [], medio = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, w = ancho / 2 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75), c = curva * Math.sin(Math.PI * t);
    const cx = x0 + dx * t + nx * c, cy = y0 + dy * t + ny * c;
    izq.push([cx + nx * w, cy + ny * w]); der.push([cx - nx * w, cy - ny * w]); medio.push([cx, cy]);
  }
  forma(D, [...izq, ...der.reverse().slice(1, -1)], col, { borde, sombra, masa });
  if (nervio) trazo(D, medio.slice(1, -2), Math.max(0.3, ancho * 0.07), nervio);
  return medio;
}

/**
 * Una hoja de palmera: el raquis curvo por `pts` y los foliolos a los dos lados, cada uno una hojita de punta con su
 * borde, más largos en el medio. Un lado más claro que el otro, para que no se junten en una mancha.
 */
function palma(D, { pts, largo = 5, paso = 1.7, col = C.hoja, colOsc = C.cerroVerdeOsc, angulo = 50, ancho = 1.5 }) {
  // Se reparte a lo largo del raquis, por distancia.
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acum[acum.length - 1];
  const en = (d) => {
    let i = 1; while (i < pts.length - 1 && acum[i] < d) i++;
    const t = (d - acum[i - 1]) / (acum[i] - acum[i - 1] || 1), [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    return [[ax + (bx - ax) * t, ay + (by - ay) * t], [(bx - ax) / (acum[i] - acum[i - 1] || 1), (by - ay) / (acum[i] - acum[i - 1] || 1)]];
  };
  const foliolos = [];
  for (let d = paso * 0.8; d < total - 0.4; d += paso) {
    const [[px, py], [tx, ty]] = en(d), s = d / total, l = largo * Math.sin(Math.PI * (0.18 + s * 0.78)) ** 0.7;
    for (const lado of [1, -1]) {
      const a = (angulo * Math.PI / 180) * lado, ex = tx * Math.cos(a) - ty * Math.sin(a), ey = tx * Math.sin(a) + ty * Math.cos(a);
      foliolos.push([[px, py], [px + ex * l, py + ey * l], lado]);
    }
  }
  for (const lado of [-1, 1]) for (const [[ax, ay], [bx, by], l] of foliolos) if (l === lado) hoja(D, { x0: ax, y0: ay, x1: bx, y1: by, ancho, col: lado > 0 ? col : colOsc, nervio: null, borde: 0.45, sombra: 0 });
  trazo(D, pts, 1.2, "tinta", { masa: true });
  trazo(D, pts, 0.45, C.vid);
}

// ───────────────────────── El sombrero de saó ─────────────────────────
/**
 * El sombrero de saó cruceño, tejido con hojas de palmera: copa baja y redonda, ala ancha que cae apenas en las puntas,
 * paja clara con la cuadrícula del tejido y una cinta turquesa (no verde, para que no se lea como bandera). Va sobre la
 * llama `ll` como los sombreros de comun.mjs y gira con ella.
 */
function sombreroSao(D, ll) {
  const { x, y, alto } = ll, k = alto / 26;
  const u = (a) => x + a * k, v = (b) => y + b * k;
  const cx = 18.4, base = 1.2, rx = 4.5, ry = 4.1;
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    // La copa: baja, de costados casi rectos y techo apenas redondeado (una superelipse), como la de un sombrero y no
    // como una cúpula.
    const n = 3.2, copa = [];
    for (let i = 0; i <= 36; i++) {
      const a = Math.PI + Math.PI * i / 36, c = Math.cos(a), s = Math.sin(a);
      copa.push([u(cx + Math.sign(c) * Math.abs(c) ** (2 / n) * rx), v(base + Math.sign(s) * Math.abs(s) ** (2 / n) * ry)]);
    }
    forma(D, copa, C.paja, { borde: 0.7, sombra: 0.5 });
    // El tejido de la copa: rayitas cruzadas adentro.
    const anchoEn = (b) => rx * Math.max(0, 1 - Math.abs((base - b) / ry) ** n) ** (1 / n);
    const t = 0.17;
    for (let b = base - 0.9; b > base - ry + 0.5; b -= 0.95) { const w = anchoEn(b) - 0.45; D.L.add(rect(u(cx - w), v(b) - t / 2, 2 * w * k, t), C.pajaOsc); }
    for (let a = -rx + 0.9; a < rx - 0.5; a += 0.95) {
      const top = base - ry * Math.max(0, 1 - Math.abs(a / rx) ** n) ** (1 / n) + 0.45;
      if (top < base - 0.4) D.L.add(rect(u(cx + a) - t / 2, v(top), t, (base - top) * k), C.pajaOsc);
    }
    // La cinta turquesa, alrededor de la base de la copa.
    const c0 = base - 2.05, c1 = base - 0.55, w0 = anchoEn(c0), w1 = anchoEn(c1);
    D.L.add(poli([[u(cx - w0), v(c0)], [u(cx + w0), v(c0)], [u(cx + w1), v(c1)], [u(cx - w1), v(c1)]]), "tinta");
    D.L.add(poli([[u(cx - w0 + 0.3), v(c0 + 0.28)], [u(cx + w0 - 0.3), v(c0 + 0.28)], [u(cx + w1 - 0.3), v(c1 - 0.28)], [u(cx - w1 + 0.3), v(c1 - 0.28)]]), "turquesa");
    // El ala: ancha, con las puntas que caen un poco, delante de la copa.
    const x0 = 10.6, x1 = 26.4, N = 28, arriba = [], abajo = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N, m = 2 * s - 1, a = x0 + (x1 - x0) * s;
      const top = base - 0.3 + 0.6 * m * m, grueso = 1.4 * (1 - 0.45 * m ** 4);
      arriba.push([u(a), v(top)]); abajo.push([u(a), v(top + grueso)]);
    }
    forma(D, [...arriba, ...abajo.reverse()], C.paja, { borde: 0.65, sombra: 0.45 });
    // El tejido del ala: rayitas que la cruzan y una que la recorre.
    for (let i = 2; i < N - 1; i += 2) {
      const [ax, ay] = arriba[i], [, by] = abajo[N - i];
      D.L.add(rect(ax - t / 2, ay + 0.3, t, by - ay - 0.6), C.pajaOsc);
    }
    const medio = arriba.map(([ax, ay], i) => [ax, (ay + abajo[N - i][1]) / 2]).slice(1, -1);
    trazo(D, medio, t, C.pajaOsc);
  });
}

// ───────────────────────── Santa Cruz ─────────────────────────
/**
 * Un tajibo en flor, en píxeles: tronco, ramas abiertas y racimos de flores en las puntas, casi sin hojas, como en
 * agosto. Devuelve las filas del sprite: b tronco y ramas, o su sombra, f flor, s flor en sombra, l y c los puntitos de
 * los pétalos (los colores van con `colTajibo`). `racimos` son círculos [x, y, radio] y `ramas`, [x, y, arranque].
 */
function tajibo({ ancho = 20, alto = 24, racimos, ramas, tronco = [9, 10] }) {
  const g = Array.from({ length: alto }, () => Array(ancho).fill("."));
  const pon = (i, j, ch) => { i = Math.round(i); j = Math.round(j); if (i >= 0 && i < ancho && j >= 0 && j < alto) g[j][i] = ch; };
  // El tronco, de abajo hasta donde se abren las ramas.
  const [t0, t1] = tronco, arranque = Math.floor(Math.min(...ramas.map(([, , sy]) => sy ?? 12)));
  for (let j = arranque; j < alto; j++) for (let i = t0; i <= t1; i++) pon(i, j, i === t1 ? "o" : "b");
  pon(t0 - 1, alto - 1, "b"); pon(t1 + 1, alto - 1, "o");
  // Las ramas: del tronco a cada racimo, de dos píxeles cerca del tronco y de uno en la punta.
  for (const [ex, ey, sy = 12] of ramas) {
    const sx = ex < (t0 + t1) / 2 ? t0 : t1, n = 30;
    for (let q = 0; q <= n; q++) {
      const s = q / n, px = sx + (ex - sx) * s, py = sy + (ey - sy) * Math.pow(s, 0.85);
      pon(Math.round(px), Math.round(py), "b");
      if (q < n * 0.6) pon(Math.round(px) + (ex < sx ? 1 : -1), Math.round(py), "b");
    }
  }
  // Los racimos: la copa llena de flor, con puntitos claros de los pétalos al sol y la sombra abajo a la derecha.
  for (const [cx, cy, r] of racimos) {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const d = Math.hypot(i - cx, (j - cy) * 1.12);
      if (d > r) continue;
      const f = ((i + 2 * j) % 5 + 5) % 5;
      const sombra = (i - cx) * 0.45 + (j - cy) > r * 0.35;
      pon(i, j, f === 0 ? (sombra ? "c" : "l") : sombra ? "s" : "f");
    }
  }
  return g.map((f) => f.join(""));
}
const TAJIBO_AMARILLO = tajibo({
  ancho: 16, alto: 21, tronco: [7, 8],
  ramas: [[3, 8, 12.5], [5, 4, 12], [11, 4, 12], [13, 8, 12.5]],
  racimos: [[4.6, 6.4, 3.4], [8, 4.2, 3.7], [11.6, 6.4, 3.4], [6, 9.4, 3.2], [10.4, 9.6, 3.2], [2.8, 9.6, 2.4], [13.4, 9.8, 2.4]],
});
const TAJIBO_ROSADO = tajibo({
  ancho: 14, alto: 14, tronco: [6, 7],
  ramas: [[2.5, 6, 10], [5, 3, 9.5], [9, 3, 9.5], [11.5, 6, 10]],
  racimos: [[3.8, 5.6, 3.1], [7, 3.6, 3.4], [10.2, 5.6, 3.1], [5.4, 8.2, 2.8], [8.8, 8.2, 2.8]],
});
const colTajibo = (amarillo) => (amarillo
  ? { f: C.tajiboAmarillo, s: C.tajiboOsc, l: C.tajiboClaro, c: C.tajiboOsc, b: C.maderaOsc, o: C.pelo }
  : { f: C.flor, s: C.florOsc, l: C.florClara, c: C.florOsc, b: C.maderaOsc, o: C.pelo });
/** Una flor de tajibo caída o en el aire: cuatro pétalos en cruz y el centro, del color del árbol. */
function florTajibo(D, x, y, p, amarillo) {
  pixeles(D, [".f.", "fcf", ".f."], { x, y, p, col: { f: amarillo ? C.tajiboAmarillo : C.flor, c: amarillo ? C.tajiboCentro : C.florOsc }, borde: p * 0.42 });
}

/** La silueta del achachairú: un huevo más ancho arriba, con la puntita abajo. */
function siluetaAchachairu(cx, cy, w, h) {
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = 2 * Math.PI * i / 48, s = Math.sin(a), r = 1 - 0.08 * s;
    pts.push([cx + Math.cos(a) * w / 2 * r, cy + s * h / 2]);
  }
  pts.splice(12, 1, [cx, cy + h / 2 + 0.9]);
  return pts;
}
/** Un achachairú entero: la cáscara naranja lisa con su sombra y su brillo, y el cabito arriba. */
function achachairu(D, cx, cy, { w = 6.2, h = 7.6, giro = 0 } = {}) {
  girar(D, giro, [cx, cy], () => {
    forma(D, siluetaAchachairu(cx, cy, w, h), C.achachairu, { borde: 0.7, sombra: 0.9 });
    // La sombra del costado, angosta, y el brillo de la cáscara lisa.
    const media = [];
    for (let i = 0; i <= 16; i++) { const a = -Math.PI * 0.3 + Math.PI * 0.75 * i / 16; media.push([cx + Math.cos(a) * w / 2 * 0.98, cy + Math.sin(a) * h / 2 * 0.98]); }
    for (let i = 16; i >= 0; i--) { const a = -Math.PI * 0.3 + Math.PI * 0.75 * i / 16; media.push([cx + Math.cos(a) * w / 2 * 0.62 + w * 0.08, cy + Math.sin(a) * h / 2 * 0.85]); }
    D.L.add(poli(media), C.achachairuOsc);
    D.L.add(poli(elipse(cx - w * 0.2, cy - h * 0.14, w * 0.13, h * 0.2, 16, 12)), C.achachairuClaro);
    D.L.add(poli(elipse(cx - w * 0.22, cy - h * 0.2, w * 0.05, h * 0.08, 12)), C.blanco);
    D.L.add(rect(cx - 0.3, cy - h / 2 - 1.1, 0.6, 1.4), C.maderaOsc);
  });
}

/** La taza de café con su vapor: loza blanca, café adentro, asa a la derecha. */
function taza(D, x, y) {
  // El asa, detrás del cuerpo.
  forma(D, [[x + 6.2, y + 2.2], [x + 8.6, y + 2.4], [x + 9.2, y + 4.4], [x + 8, y + 6.2], [x + 6, y + 6.4], [x + 6, y + 5.1], [x + 7.3, y + 4.9], [x + 7.8, y + 4.2], [x + 7.4, y + 3.6], [x + 6.2, y + 3.6]], C.taza, { borde: 0.6, sombra: 0.6 });
  forma(D, [[x, y + 0.8], [x + 7, y + 0.8], [x + 6.5, y + 7.4], [x + 5.6, y + 8.2], [x + 1.4, y + 8.2], [x + 0.5, y + 7.4]], C.taza, { borde: 0.7, sombra: 1 });
  D.L.add(poli(elipse(x + 3.5, y + 1.25, 3.1, 0.75, 24)), C.cafe);
  D.L.add(rect(x + 0.9, y + 3.6, 5.4, 0.9), "turquesa");
  // El vapor: tres hilitos ondulados.
  [[x + 1.6, 0], [x + 3.6, 1], [x + 5.6, 0]].forEach(([vx, d]) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([vx + 0.65 * Math.sin(i / 10 * Math.PI * 2 + d * 2), y - 0.6 - i * 0.48 - d * 0.4]);
    trazo(D, pts, 1.15, "tinta", { masa: true });
    trazo(D, pts, 0.5, C.vapor);
  });
}

/**
 * Un cuñapé: una bolita inflada y lisa de almidón y queso, dorada, un poco más ancha que alta, con la sombra abajo, el
 * brillo de la corteza arriba a la izquierda y una sola mancha clara de queso. Sin puntitos ni grietas: con ellos se
 * leía como un pan con semillas o una galleta.
 */
function cunape(D, cx, cy, r) {
  const rx = r * 1.06, ry = r * 0.94;
  forma(D, elipse(cx, cy, rx, ry, 40), C.cunape, { borde: 0.65, sombra: 0.7 });
  // La sombra abajo, una media luna: la bolita se ve inflada, no chata.
  const media = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * 0.06 + Math.PI * 0.88 * i / 16; media.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  for (let i = 16; i >= 0; i--) { const a = Math.PI * 0.06 + Math.PI * 0.88 * i / 16; media.push([cx + Math.cos(a) * rx * 0.9, cy + Math.sin(a) * ry * 0.55 + ry * 0.16]); }
  D.L.add(poli(media), C.cunapeOsc);
  // La mancha de queso, clara y blanda, y el brillo.
  D.L.add(poli(elipse(cx + rx * 0.3, cy + ry * 0.05, rx * 0.34, ry * 0.24, 20, -18)), C.cunapeClaro);
  D.L.add(poli(elipse(cx - rx * 0.4, cy - ry * 0.42, rx * 0.26, ry * 0.17, 16, -30)), C.cunapeClaro);
  D.L.add(poli(elipse(cx - rx * 0.46, cy - ry * 0.46, rx * 0.11, ry * 0.08, 12, -30)), C.blanco);
}

/** La llama del logo, parada en tres patas, con la mano de adelante estirada hacia adelante: la apoya en el teclado. */
const TECLEA = [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [0, 11, 3, 4], [3, 20, 2.5, 6], [8, 20, 2.5, 6], [12.5, 20, 2.5, 6], [15.8, 18, 2.5, 3.6], [15.8, 19.2, 7.6, 2.4]];

const SANTA_CRUZ = [
  {
    id: "santacruz-tajibo",
    nombre: "Postal de Santa Cruz",
    frase: ["Tinkazo en", "SANTA CRUZ"],
    nota: "Los tajibos en flor, amarillos y rosados, que pintan la ciudad de Santa Cruz entre julio y septiembre. La llama lleva sombrero de saó, tejido con hojas de palmera.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "naranja",
        paisaje(D) {
          D.L.add(circulo(19.4, 4.9, 2.3), C.sol);
          franjaDisco(D, { arriba: (x) => 27.4 + 0.5 * Math.sin(x / 4), color: C.cerroVerde });
          pixeles(D, TAJIBO_ROSADO, { x: 7.6, y: 5.4, p: 1.0, col: colTajibo(false), borde: 0.42 });
          pixeles(D, TAJIBO_AMARILLO, { x: 28.6, y: 7.6, p: 1.0, col: colTajibo(true), borde: 0.45 });
          // La alfombra de flores caídas bajo el tajibo amarillo.
          for (const [fx, fy] of [[30.5, 28.6], [33.4, 29.4], [36.2, 28.5], [39, 29.3], [41.6, 28.4]]) florTajibo(D, fx, fy, 0.62, true);
          for (const [fx, fy, a] of [[27.6, 24.5, true], [42.4, 24.5, true], [6, 20.5, false]]) florTajibo(D, fx, fy, 0.6, a);
        },
        sombrero: sombreroSao,
        delante(D) { florTajibo(D, 41.6, 1.6, 0.75, true); florTajibo(D, 45.2, 5.6, 0.7, false); },
      });
    },
  },
  {
    id: "santacruz-cunape",
    nombre: "Cuñapé y código",
    frase: ["Cuñapé", "y código"],
    nota: "El café de la tarde con cuñapé, de almidón de yuca y queso, es la pausa cruceña. Así se programa en una hackatón de Santa Cruz.",
    dibujar(D, frase) {
      // La laptop de frente: la pantalla con el código y, delante, el teclado.
      const lx = 22.6, ly = 8.6, lw = 15.4, lh = 12.6;
      bloque(D, { x: lx, y: ly, w: lw, h: lh, fill: C.laptop, borde: 0.85, sombra: 1.3, radio: 1.2 });
      D.L.add(rect(lx + 1.1, ly + 1.1, lw - 2.2, lh - 2.4), C.cieloNoche);
      escribir(D.L, { s: "</>", x: lx + lw / 2, y: ly + 6.6, tam: 6.4, ancla: "c", color: "turquesa" });
      for (const [dx, dy, w, col] of [[2.2, 8.4, 4.6, "magenta"], [7.4, 8.4, 3.2, "amarillo"], [3.4, 9.9, 6.2, "naranja"]]) D.L.add(rect(lx + dx, ly + dy, w, 0.75), col);
      const t0 = ly + lh - 0.3, t1 = t0 + 4.2;
      forma(D, [[lx - 0.6, t0], [lx + lw + 0.6, t0], [lx + lw + 2.6, t1], [lx - 2.6, t1]], C.metal, { borde: 0.8, sombra: 1.1 });
      for (let f = 0; f < 3; f++) {
        const y = t0 + 0.75 + f * 1.15, a = lx - 0.4 - f * 0.55, b = lx + lw + 0.4 + f * 0.55, n = 8 - (f === 2 ? 2 : 0);
        for (let i = 0; i < n; i++) { const w = (b - a - 0.6) / n; D.L.add(rect(a + 0.3 + i * w + (f === 2 ? w : 0) + 0.1, y, w - 0.32, 0.72), C.piedraOsc); }
      }
      // La llama entera, parada al lado, con una mano en el teclado.
      llamaEn(D, { x: 0.4, y: 1.6, alto: 24.2, pose: TECLEA, contorno: 0.9, sombra: 1.4 });
      // Del otro lado de la laptop, el café y la canastita de cuñapés.
      taza(D, 40.6, 9.0);
      const bx = 38.6, by = 21.0;
      cunape(D, bx + 3.0, by - 1.5, 2.75); cunape(D, bx + 8.2, by - 1.4, 2.75); cunape(D, bx + 5.6, by - 5.4, 2.75);
      forma(D, [[bx, by], [bx + 11.4, by], [bx + 10.4, by + 4.8], [bx + 1, by + 4.8]], C.madera, { borde: 0.7, sombra: 1 });
      for (let i = 0; i < 5; i++) D.L.add(rect(bx + 1.3 + i * 2.1, by + 1.2 + (i % 2) * 1.5, 1.3, 0.55), C.maderaOsc);
      D.L.add(rect(bx + 0.3, by + 0.1, 10.8, 0.5), C.maderaOsc);
      cinta(D, { lineas: frase, cx: 25, y: 28.0, ancho: 37, fill: "amarillo", tamMax: 8.5 });
    },
  },
  {
    id: "santacruz-elay",
    nombre: "¡Elay puej!",
    frase: ["¡Elay puej!"],
    nota: "Elay es la expresión cruceña de asombro, y se dice con cariño. La llama salta de alegría con su sombrero de saó.",
    dibujar(D, frase) {
      const ll = { x: 9.5, y: 16.6, alto: 27, rot: -12 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      sombreroSao(D, ll);
      // El globo, con la cola hacia la llama.
      const g = cinta(D, { lineas: frase, cx: 25, y: 1.2, ancho: 41, fill: "tarjeta", color: "tinta", rot: 0, tamMax: 10, pad: 2.6 });
      // La cola baja hasta la punta del ala del sombrero, al lado de la cara de la llama.
      const bx = 34.4, yb = g.y1;
      D.L.add(poli([[bx, yb - 1.4], [bx + 6.6, yb - 1.4], [bx - 0.8, yb + 4.4]]), "tinta");
      D.L.add(poli([[bx + 1.2, yb - 1.6], [bx + 5.2, yb - 1.6], [bx + 0.6, yb + 2.7]]), "tarjeta");
      D.r(bx - 1.8, yb - 1.5, 9, 6.4);
      brillo(D, 39.6, 13.8, 0.72, "amarillo");
      brillo(D, 6, 13.6, 0.62, "turquesa");
      florTajibo(D, 35.4, 24.6, 0.82, true);
      florTajibo(D, 8.4, 29.2, 0.78, false);
    },
  },
  {
    id: "santacruz-achachairu",
    nombre: "Dulce achachairú",
    frase: ["Dulce", "achachairú"],
    nota: "El achachairú, la fruta de cáscara naranja y pulpa blanca que todo cruceño reconoce al instante y que tiene su propia feria.",
    dibujar(D, frase) {
      llama(D, { x: 2, y: 4, alto: 26, contorno: 0.9, sombra: 1.4, rot: 5 });
      // La canastita: el asa detrás, las frutas y el cuerpo tejido delante.
      const bx = 23, by = 19.5, bw = 23, bh = 9.5;
      trazo(D, Array.from({ length: 25 }, (_, i) => { const a = Math.PI + Math.PI * i / 24; return [bx + bw / 2 + Math.cos(a) * (bw / 2 - 1.6), by + 0.5 + Math.sin(a) * 15]; }), 2.4, "tinta", { masa: true });
      trazo(D, Array.from({ length: 25 }, (_, i) => { const a = Math.PI + Math.PI * i / 24; return [bx + bw / 2 + Math.cos(a) * (bw / 2 - 1.6), by + 0.5 + Math.sin(a) * 15]; }), 0.9, C.madera);
      forma(D, [[bx + 9.6, by - 1.2], [bx + 13.6, by - 4.4], [bx + 17.4, by - 4.8], [bx + 15.6, by - 1.8]], C.hoja, { borde: 0.6, sombra: 0.6 });
      forma(D, [[bx + 2.6, by - 0.8], [bx + 0.2, by - 4.6], [bx - 1.6, by - 5.6], [bx - 0.6, by - 2.2]], C.hoja, { borde: 0.6, sombra: 0.6 });
      achachairu(D, bx + 6.4, by - 3.2, { giro: -14 });
      achachairu(D, bx + 15.8, by - 3.4, { giro: 12 });
      achachairu(D, bx + 11.2, by - 5.4, { giro: 3 });
      achachairu(D, bx + 3.2, by - 0.6, { giro: -30 });
      forma(D, [[bx, by], [bx + bw, by], [bx + bw - 1.8, by + bh], [bx + 1.8, by + bh]], C.madera, { borde: 0.8, sombra: 1.2 });
      for (let f = 0; f < 3; f++) for (let i = 0; i < 6; i++) D.L.add(rect(bx + 2.2 + f * 0.4 + i * 3.25 + (f % 2) * 1.6, by + 2.4 + f * 2.4, 1.8, 0.75), C.maderaOsc);
      bloque(D, { x: bx - 0.8, y: by - 0.8, w: bw + 1.6, h: 2.2, fill: C.madera, borde: 0.75, sombra: 0.8, radio: 1 });
      // El partido, delante de la canasta: cáscara, pulpa blanca y la pepa.
      const px = bx + 18.8, py = by + 6.4;
      girar(D, 22, [px, py], () => {
        forma(D, siluetaAchachairu(px, py, 7.2, 8.8), C.achachairu, { borde: 0.7, sombra: 1 });
        D.L.add(poli(siluetaAchachairu(px, py + 0.1, 5.9, 7.4)), C.pulpa);
        D.L.add(poli(elipse(px, py + 0.5, 1.45, 2.5, 24)), "tinta");
        D.L.add(poli(elipse(px, py + 0.5, 1.05, 2.1, 24)), C.pepa);
        D.L.add(poli(elipse(px - 0.35, py - 0.3, 0.3, 0.6, 12)), C.castanaClaro);
        D.L.add(rect(px - 0.3, py - 5.5, 0.6, 1.4), C.maderaOsc);
      });
      cinta(D, { lineas: frase, cx: 25, y: 31.4, ancho: 40, fill: "turquesa", tamMax: 8.5 });
    },
  },
];

// ───────────────────────── Beni ─────────────────────────
/**
 * El bufeo saliendo del agua de un salto, en diagonal y con el lomo un poco arqueado, mirando a la derecha: la frente
 * redonda, el hocico largo y fino, la cresta baja del lomo, la aleta del pecho y la cola abierta abajo. Se arma en su
 * propio eje curvo (u a lo largo del cuerpo, v de través) y se pinta en casillas derechas, así los píxeles no quedan
 * girados. o lomo, b cuerpo, l panza, k ojo, w brillo, r mejilla.
 */
const BUFEO = (() => {
  const W = 21, H = 21, g = -40 * Math.PI / 180, c0 = [10.5, 10.5], curva = 0.035;
  // El eje propio, curvado como el salto: el lomo arriba y la cola y la cabeza un poco más abajo.
  const eje = (x, y) => {
    const dx = x - c0[0], dy = y - c0[1], u = dx * Math.cos(g) + dy * Math.sin(g), v = -dx * Math.sin(g) + dy * Math.cos(g);
    return [u, v - curva * u * u];
  };
  // El grueso del cuerpo a lo largo de u: fino en la cola, ancho en el medio, la cabeza redonda adelante.
  const perfil = [[-8.6, 0.55], [-6, 1.3], [-3, 2.3], [0, 2.85], [3, 2.7], [5.4, 2.1], [6.4, 1.3]];
  const grueso = (u) => {
    if (u < perfil[0][0] || u > perfil[perfil.length - 1][0]) return -1;
    for (let i = 1; i < perfil.length; i++) if (u <= perfil[i][0]) { const [a, ga] = perfil[i - 1], [b, gb] = perfil[i]; return ga + (gb - ga) * (u - a) / (b - a); }
    return -1;
  };
  return grilla(W, H, (x, y) => {
    const [u, v] = eje(x, y);
    if (Math.hypot(u - 4.9, v + 0.45) < 0.6) return "w";
    if (Math.hypot(u - 4.9, v - 0.4) < 0.62) return "k";
    if (Math.hypot(u - 6.2, v - 1.55) < 0.55) return "r";
    const cuerpo = Math.abs(v) < grueso(u) || Math.hypot(u - 4.4, v + 0.25) < 2.95;
    const hocico = u > 5.6 && u < 10.6 && Math.abs(v - 0.6) < 0.68;
    const cresta = u > -3 && u < 0.4 && v < 0 && -v < 2.6 + 1.5 * Math.max(0, 1 - Math.abs(u + 1.6) / 1.4);
    const aleta = u > 0.8 && u < 3.2 && v > 0 && v < 2.4 + (3.2 - u) * 0.75 && v > 2.0;
    const cola = u < -7.4 && u > -10.6 && Math.abs(v) < 0.3 + (-7.4 - u) * 1.1;
    if (!(cuerpo || hocico || cresta || aleta || cola)) return null;
    if (hocico && !cuerpo) return v > 0.65 ? "l" : "b";
    if (cola || cresta || aleta) return "o";
    return v < -0.85 ? "o" : v > 1.0 ? "l" : "b";
  });
})();
const COL_BUFEO = { o: C.bufeoLomo, b: C.bufeo, l: C.bufeoClaro, r: C.mejilla };

/**
 * Una palmera chica con borde, para fuera de los discos: el tronco anillado y las hojas largas que salen de la punta y
 * caen hacia los costados.
 */
function palmera(D, { x, yBase, alto, largo = 9.5 }) {
  const tx = x - 1.2, ty = yBase - alto;
  forma(D, [[x - 1.3, yBase], [x + 1.3, yBase], [tx + 0.85, ty], [tx - 0.85, ty]], C.madera, { borde: 0.75, sombra: 1 });
  for (let i = 1; i < 6; i++) { const t = i / 6, cx = x + (tx - x) * t, w = 1.3 - 0.45 * t; D.L.add(rect(cx - w, yBase - alto * t - 0.18, 2 * w, 0.36), C.maderaOsc); }
  [[-168, 0.9, 1.6], [-135, 1, 1.4], [-100, 1.05, -0.6], [-62, 1, -1.4], [-28, 0.95, -1.6], [8, 0.8, -1.4]].forEach(([g, f, curva], i) => {
    const a = g * Math.PI / 180;
    hoja(D, { x0: tx, y0: ty, x1: tx + Math.cos(a) * largo * f, y1: ty + Math.sin(a) * largo * f + 1.2, ancho: 3, curva, col: i % 2 ? C.hoja : C.cerroVerdeOsc, nervio: C.vid, borde: 0.6, sombra: 0.6 });
  });
}

/** La motacú: tronco grueso y las hojas largas que suben y se abren como un plumero. Va adentro del paisaje. */
function motacu(D, { x, yBase, alto, col = C.vid, ancho = 1.6 }) {
  D.L.add(poli([[x - ancho / 2, yBase], [x + ancho / 2, yBase], [x + ancho * 0.4, yBase - alto], [x - ancho * 0.4, yBase - alto]]), C.maderaOsc);
  const cy = yBase - alto;
  [[-62, 9], [-35, 10], [-8, 9], [20, 10], [48, 9], [-88, 7], [75, 7]].forEach(([g, l]) => {
    const a = (g - 90) * Math.PI / 180, pts = [];
    for (let i = 0; i <= 10; i++) { const s = i / 10; pts.push([x + Math.cos(a) * l * s + Math.sign(g) * s * s * 2.2, cy + Math.sin(a) * l * s + s * s * 3.2]); }
    const izq = [], der = [];
    pts.forEach(([px, py], i) => { const w = 1.25 * Math.sin(Math.PI * Math.min(0.95, i / 10 + 0.05)); izq.push([px - Math.sin(a) * w, py + Math.cos(a) * w]); der.push([px + Math.sin(a) * w, py - Math.cos(a) * w]); });
    D.L.add(poli([...izq, ...der.reverse()]), col);
  });
}

/**
 * La paraba barba azul, posada de perfil mirando a la derecha: corona, nuca y alas turquesa, las plumas largas azules,
 * pecho y vientre amarillos, la cara blanca, la barba azul bajo el pico oscuro y la cola larga, azul arriba y amarilla
 * abajo. t turquesa, T azul, c cara, w y k el ojo, B barba, x pico, h su brillo, a amarillo, g patas.
 */
const PARABA = [
  ".....tttt.....",
  "....tttttt....",
  "...ttttttttx..",
  "...ttttcccxxx.",
  "..tttccwkcxhxx",
  "..tttcckkcxxxx",
  "..tttccccBxx.x",
  "..ttttcBBBxx..",
  "..tttBBBBB....",
  ".ttttBBBBaa...",
  ".tttTTTaaaaa..",
  ".ttTTTTaaaaa..",
  ".tTTTTTaaaaa..",
  ".tTTTTTaaaaa..",
  ".tTTTTTaaaa...",
  "..TTTTTaaaa...",
  "..TTTTaaaa....",
  "..TTTTaaagg...",
  "...TTTaa.gg...",
  "...TTTa.......",
  "...TTTa.......",
  "....TTa.......",
  "....TTa.......",
  ".....Ta.......",
];
const COL_PARABA = { t: C.paraba, T: C.parabaOsc, c: C.parabaCara, B: C.parabaBarba, a: "amarillo", g: C.pico, x: C.picoParaba, h: C.metal };

/**
 * La capiguara echada, de perfil mirando a la derecha (se espeja para que mire a la llama): cuerpo de barril, cabeza
 * grande y cuadrada, orejita, ojo entrecerrado de calma, la nariz oscura y la mejilla. f pelaje, F sombra, l claro,
 * n nariz, e oreja, r mejilla.
 */
const CAPIGUARA = [
  "..................ee......",
  ".................eeFf.....",
  "......FFFFFFFFFFFffffff...",
  "...FFFFffffffffffffffffnn.",
  "..FFffffffffffffffllffffn.",
  ".FFfffffffffffffffkkfffff.",
  ".Ffffffffffffffffffffffff.",
  "Fffffffffffffffffffrffffk.",
  "fffffffffffffffffffffffk..",
  "ffffffffffffffffffffff....",
  ".fffffffffffffffffffff....",
  "..lllllllllllllllllll.....",
  "...FFF.....FFF...FFF......",
];
const COL_CAPIGUARA = { f: C.capiguara, F: C.capiguaraOsc, l: C.capiguaraClaro, n: C.pico, e: C.capiguaraOsc, r: C.mejilla };
/** El pajarito amarillo que se le posa en la cabeza, mirando a la izquierda: pico, ojo, ala, cola y patitas. */
const PAJARITO = ["..yyy...", ".yyyyy..", "nykyyyo.", ".yyyyooo", "..yyyyo.", "...k.k.."];

const BENI = [
  {
    id: "beni-mamore",
    nombre: "Postal del Beni",
    frase: ["Tinkazo en el", "BENI"],
    nota: "El atardecer en el río Mamoré, con las palmeras de motacú y un bufeo, el delfín de los ríos del Beni, saltando frente al sol. La llama navega en su canoa de madera.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "turquesa", cielo: C.atardecer,
        llama: { x: 6.6, y: 3.9, alto: 25.5 },
        paisaje(D) {
          franjaDisco(D, { arriba: () => 18.6, color: C.cieloTarde });
          // El sol ya casi se escondió: deja libre el cielo naranja detrás del bufeo.
          D.L.add(circulo(37.2, 22.4, 3.6), "amarillo");
          franjaDisco(D, { arriba: () => 21.8, color: C.rio });
          // El sol en el agua: rayitas claras.
          for (const [x0, y0, w] of [[33.4, 23.4, 7.4], [34.6, 25.1, 5], [35.8, 26.8, 2.8]]) D.L.add(rect(x0, y0, w, 0.75), C.cieloTarde);
          for (const [x0, y0, w] of [[11, 24, 4], [17.5, 27.4, 3.5], [40.5, 28.4, 2.5]]) D.L.add(rect(x0, y0, w, 0.6), C.rioClaro);
          motacu(D, { x: 12.6, yBase: 22, alto: 9.5 });
          motacu(D, { x: 45.6, yBase: 22, alto: 12 });
          // El bufeo sale del agua de un salto, con el hocico largo hacia adelante y la cola todavía en el río.
          pixeles(D, BUFEO, { x: 26.6, y: 8.9, p: 0.71, col: COL_BUFEO, borde: 0.6 });
          // Las gotitas donde sale del agua.
          for (const [gx, gy] of [[25.4, 19.4], [31.8, 21.2], [24.2, 21.4]]) pixeles(D, [".w.", "www"], { x: gx, y: gy, p: 0.55, borde: 0.3, col: { w: C.rioClaro } });
        },
        delante(D) {
          // La canoa de madera: casco largo y bajo, con la proa levantada a la derecha. Deja ver las patas de la llama.
          const n = 30, x0 = 4.2, x1 = 36.4, arriba = [];
          for (let i = 0; i <= n; i++) { const s = i / n; arriba.push([x0 + (x1 - x0) * s, 27.4 - 2.8 * Math.pow(Math.max(0, s - 0.8) / 0.2, 2.2) - 0.9 * Math.pow(Math.max(0, 0.1 - s) / 0.1, 2)]); }
          const abajo = [[x1 - 2.6, 31.8], [x0 + 1.6, 31.8]];
          forma(D, [...arriba, ...abajo], C.madera, { borde: 0.8, sombra: 1.2 });
          D.L.add(poli([...arriba.map(([x, y]) => [x, y - 0.05]), ...arriba.map(([x, y]) => [x, y + 1.05]).reverse()]), C.maderaOsc);
          D.L.add(rect(7, 29.4, 24, 0.5), C.maderaOsc);
        },
      });
    },
  },
  {
    id: "beni-paraba",
    nombre: "Única en el mundo",
    frase: ["Única en", "el mundo"],
    nota: "La paraba barba azul vive solo en los Llanos de Moxos, en el Beni, y en ningún otro lugar del mundo. Acá viaja posada en el lomo de la llama.",
    dibujar(D, frase) {
      palmera(D, { x: 42.4, yBase: 31.4, alto: 19, largo: 8.6 });
      const ll = { x: 10.4, y: 6.8, alto: 27 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      // Posada en el lomo, sobre las ancas, mirando hacia la cabeza de la llama, con la cola que cae por el costado.
      const p = 0.88, k = ll.alto / 26;
      pixeles(D, PARABA, { x: ll.x - 1.4 * k, y: ll.y + 13 * k - 17.6 * p, p, col: COL_PARABA, borde: 0.6, sombra: 0.6 });
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 38, fill: "magenta", tamMax: 8.5 });
    },
  },
  {
    id: "beni-victoria",
    nombre: "Victoria boliviana",
    frase: ["Victoria", "boliviana"],
    nota: "La Victoria boliviana, el nenúfar más grande del mundo, crece solo en los Llanos de Moxos y se describió como especie nueva en 2022. La llama descansa sobre su hoja.",
    dibujar(D, frase) {
      // El agua alrededor, de borde ondulado, con dos ondas.
      const agua = elipse(24.5, 27, 24.5, 6.4, 120).map(([x, y], i) => { const f = 1 + 0.03 * Math.sin(i / 120 * 2 * Math.PI * 9); return [24.5 + (x - 24.5) * f, 27 + (y - 27) * f]; });
      forma(D, agua, "turquesa", { borde: 0.8, sombra: 1.2 });
      for (const [x, y, w] of [[2.8, 27.6, 4.4], [42.6, 28.8, 4.2]]) D.L.add(rect(x, y, w, 0.7), C.rioClaro);
      // La hoja como una bandeja: el revés rojizo del borde levantado (lo de adelante), la cara de adentro del borde
      // (lo de atrás, más claro) y el fondo verde con sus nervaduras.
      forma(D, elipse(22.5, 24.8, 20.6, 7.0, 64), C.victoriaBorde, { borde: 0.85, sombra: 1.3 });
      forma(D, elipse(22.5, 23.8, 19.7, 5.8, 64), C.cerroVerde, { borde: 0.5, sombra: 0, masa: false });
      D.L.add(poli(elipse(22.5, 24.5, 18.7, 4.9, 64)), C.victoria);
      for (let i = 0; i < 18; i++) {
        const a = 2 * Math.PI * i / 18, x1 = 22.5 + Math.cos(a) * 17.4, y1 = 24.5 + Math.sin(a) * 4.4;
        trazo(D, [[22.5 + Math.cos(a) * 2, 24.5 + Math.sin(a) * 0.6], [x1, y1]], 0.32, C.vid);
      }
      trazo(D, elipse(22.5, 24.5, 10, 2.6, 40).concat([[32.5, 24.5]]), 0.3, C.vid);
      // La llama echada en el medio de la hoja.
      llamaEn(D, { x: 10, y: 3.2, alto: 23, pose: "echada", contorno: 0.9, sombra: 1.4 });
      // La flor: pétalos blancos de punta, abierta como copa, con el centro rosado.
      const fx = 41.4, fy = 20.4, s = 1.22;
      [[-9, -48], [-4, -62], [3, -64], [8, -50]].forEach(([dx, g]) => hoja(D, { x0: fx + dx * 0.3 * s, y0: fy, x1: fx + (dx * 0.3 + Math.cos(g * Math.PI / 180) * 6.4 * Math.sign(dx)) * s, y1: fy + Math.sin(g * Math.PI / 180) * 6.4 * s, ancho: 2.6 * s, col: "tarjeta", nervio: null, borde: 0.55, sombra: 0.5 }));
      forma(D, elipse(fx, fy - 1.6 * s, 3.4 * s, 1.4 * s, 28), C.flor, { borde: 0.55, sombra: 0 });
      D.L.add(poli(elipse(fx, fy - 1.9 * s, 1.8 * s, 0.7 * s, 20)), C.florOsc);
      [[-7, -20], [-2.6, -38], [2.6, -142], [7, -160]].forEach(([dx, g]) => hoja(D, { x0: fx + dx * 0.15 * s, y0: fy + 0.8 * s, x1: fx + Math.cos(g * Math.PI / 180) * 5.4 * s, y1: fy + (0.8 + Math.sin(g * Math.PI / 180) * 4.2) * s, ancho: 2.4 * s, col: C.blanqueado, nervio: null, borde: 0.55, sombra: 0.5 }));
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 37, fill: "magenta", tamMax: 8.5 });
    },
  },
  {
    id: "beni-capiguara",
    nombre: "Todo tranqui",
    frase: ["Todo tranqui"],
    nota: "La capiguara, el roedor más grande del mundo, vive tranquila en los humedales del Beni. Hasta los pajaritos se le posan encima.",
    dibujar(D, frase) {
      // La hoja grande que les da sombra, arriba.
      hoja(D, { x0: 48.4, y0: 15, x1: 15, y1: 3.6, ancho: 9.5, curva: 3.4, col: C.hoja, nervio: C.vid, borde: 0.8, sombra: 1.1 });
      // La orilla con el agua.
      bloque(D, { x: 13, y: 27, w: 36.4, h: 4.6, fill: "turquesa", borde: 0.8, sombra: 1, radio: 2.2 });
      D.L.add(rect(37, 28.6, 6, 0.7), C.rioClaro);
      const ll = { x: 0.6, y: 6, alto: 24.5, rot: 8 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      const p = 1.1, cap = espejo(CAPIGUARA), x0 = 20.2, y0 = 15;
      pixeles(D, cap, { x: x0, y: y0, p, col: COL_CAPIGUARA, borde: 0.75, sombra: 1.1 });
      // El pajarito, en la cabeza, delante de la oreja, mirando hacia la llama.
      pixeles(D, PAJARITO, { x: x0 + 0.2 * p, y: y0 + 1.4 * p - 5.6 * 0.88, p: 0.88, col: { y: C.pajarito, n: "naranja", o: C.tajiboOsc }, borde: 0.55, sombra: 0.45 });
      cinta(D, { lineas: frase, cx: 25, y: 31.6, ancho: 42, fill: "turquesa", tamMax: 8.5 });
    },
  },
];

// ───────────────────────── Pando ─────────────────────────
/** La paraba roja en vuelo, chiquita, mirando a la derecha: cuerpo rojo, alas con el amarillo y el azul. */
const PARABA_ROJA = [
  "......TT......",
  ".....TTT......",
  ".....TTa......",
  ".....Taar..rr.",
  "rrr..aarrrrwkx",
  ".rrrrrrrrrrwwx",
  "...rrrrrrrr...",
];

/**
 * Una copa de árbol de bultos redondos, con borde de tinta por fuera y la luz arriba a la izquierda: los círculos se
 * dibujan primero agrandados en tinta (la sombra y el borde de todos juntos) y después rellenos, así queda un solo borde.
 */
function copaBultos(D, bultos, { col = C.selvaCerca, claro = C.copaClaro, borde = 0.85, sombra = 1.1 } = {}) {
  for (const [x, y, r] of bultos) D.L.add(circulo(x + sombra, y + sombra, r + borde), "tinta");
  for (const [x, y, r] of bultos) D.L.add(circulo(x, y, r + borde), "tinta");
  for (const [x, y, r] of bultos) D.L.add(circulo(x, y, r), col);
  for (const [x, y, r] of bultos) D.L.add(circulo(x - r * 0.22, y - r * 0.26, r * 0.7), claro);
  for (const [x, y, r] of bultos) { D.c(x, y, r + borde); D.c(x + sombra, y + sombra, r + borde); }
}

/**
 * El tucán pechiblanco, posado de perfil mirando a la derecha: cuerpo negro con brillo, la piel azul alrededor del ojo,
 * el babero blanco con la franja roja abajo, el pico grande oscuro con la raya amarilla arriba y las plumas rojas bajo
 * la cola. n negro, g brillo, b piel azul, p babero, r rojo, x pico, y raya amarilla, G patas.
 */
const TUCAN = [
  "...nnnn..........",
  "..nnnnnnyyyyyyy..",
  "..nnnbbbyxxxxxxxy",
  "..nnbwkbyxxxxxxxx",
  "..nnbkkbyxxxxxxx.",
  "..nnnbbbyxxxxx...",
  "..nnpppppxxx.....",
  ".nnppppppp.......",
  ".nnppppppp.......",
  ".nnnpppppp.......",
  ".ngnnrrrrr.......",
  ".nggnnnnnn.......",
  ".nggnnnnnn.......",
  "..ggnnnnn........",
  "..ggnnnnn........",
  "...gnnnn.........",
  "...nnnrr.........",
  "...nn.GG.........",
  "...nn............",
  "...nn............",
  "...nn............",
  "....n............",
];
const COL_TUCAN = { n: C.tucan, g: C.tucanBrillo, b: C.tucanOjo, p: C.tucanPecho, r: C.rojoBo, x: C.tucanPico, y: C.amarilloBo, G: C.metal };

/**
 * El coco de la castaña abierto arriba, visto un poco desde arriba: la esfera leñosa con vetas y, en la boca, las
 * semillas apretadas en ronda, cremas con el borde de su piel marrón. Así se lee como un coco lleno de castañas.
 */
function cocoAbierto(D, cx, cy, r) {
  disco(D, cx, cy, r, C.castana, { borde: 0.85, sombra: 1.3 });
  // La boca: una elipse arriba, con el borde de la cáscara y las semillas adentro.
  const bx = cx, by = cy - r * 0.42, rx = r * 0.74, ry = r * 0.34;
  // Las vetas de la madera: meridianos que bajan desde la boca, como en una esfera.
  for (const f of [-0.72, -0.38, 0, 0.38, 0.72]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, y = by + ry * Math.sqrt(1 - f * f) + (cy + r * 0.92 - by - ry * Math.sqrt(1 - f * f)) * t;
      const ancho = Math.sqrt(Math.max(0, r * r - (y - cy) ** 2)) * 0.96;
      pts.push([cx + f * ancho * (1 - 0.25 * t), y]);
    }
    trazo(D, pts.slice(1, -1), 0.34, C.castanaOsc);
  }
  // Una sombra en el costado derecho, para que se vea redondo.
  const media = [];
  for (let i = 0; i <= 20; i++) { const a = -Math.PI * 0.35 + Math.PI * 0.85 * i / 20; media.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  for (let i = 20; i >= 0; i--) { const a = -Math.PI * 0.35 + Math.PI * 0.85 * i / 20; media.push([cx + Math.cos(a) * r * 0.8 - r * 0.06, cy + Math.sin(a) * r * 0.92]); }
  D.L.add(poli(media), C.castanaOsc);
  D.L.add(poli(elipse(bx, by, rx + 0.55, ry + 0.55, 48)), "tinta");
  D.L.add(poli(elipse(bx, by, rx, ry, 48)), C.castanaHueco);
  const n = 7, s = 1.35;
  const semillas = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2 + 0.25, sx = bx + Math.cos(a) * rx * 0.6, sy = by + Math.sin(a) * ry * 0.5;
    semillas.push([sy, sx, a]);
  }
  semillas.push([by - 0.1, bx, null]);
  // De atrás para adelante: las de arriba primero.
  for (const [sy, sx, a] of semillas.sort((p, q) => p[0] - q[0])) {
    const g = a === null ? 0 : (a * 180 / Math.PI) + 90;
    girar(D, g * 0.3, [sx, sy], () => {
      forma(D, [[sx - 1.35 * s, sy + 0.9 * s], [sx - 1.1 * s, sy - 0.8 * s], [sx, sy - 1.5 * s], [sx + 1.1 * s, sy - 0.8 * s], [sx + 1.35 * s, sy + 0.9 * s], [sx, sy + 1.25 * s]], C.castanaClaro, { borde: 0.4, sombra: 0, masa: false });
      D.L.add(poli([[sx - 0.85 * s, sy + 0.55 * s], [sx - 0.7 * s, sy - 0.55 * s], [sx, sy - 1.1 * s], [sx + 0.7 * s, sy - 0.55 * s], [sx + 0.85 * s, sy + 0.55 * s], [sx, sy + 0.85 * s]]), C.semilla);
    });
  }
}

/** Una castaña pelada, la que se come: larga, curva, crema con manchitas de la piel marrón. */
function castanaPelada(D, x, y, giro = 0) {
  girar(D, giro, [x, y], () => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20, a = Math.PI * t; pts.push([x - 3.4 + 6.8 * t, y - Math.sin(a) * 1.9 - 0.2]); }
    for (let i = 20; i >= 0; i--) { const t = i / 20, a = Math.PI * t; pts.push([x - 3.4 + 6.8 * t, y + Math.sin(a) * 0.8]); }
    forma(D, pts, C.semilla, { borde: 0.55, sombra: 0.7 });
    D.L.add(poli(elipse(x - 0.8, y - 0.6, 1.2, 0.45, 16, -8)), C.castanaClaro);
    D.L.add(poli(elipse(x + 1.6, y - 0.2, 0.8, 0.35, 16, 10)), C.castanaClaro);
  });
}

const PANDO = [
  {
    id: "pando-selva",
    nombre: "Postal de Pando",
    frase: ["Tinkazo en", "PANDO"],
    nota: "La selva de Pando, con el castaño que se asoma por encima de todos los árboles, el río y una paraba roja en vuelo.",
    dibujar(D, frase) {
      const copa = () => {
        // La copa ancha del castaño, que se sale del disco por arriba: una sombrilla de bultos de hojas, más ancha que
        // alta, con el tronco que entra al disco.
        D.L.add(poli([[38.2, 8.6], [40.6, 8.6], [40.3, 13], [38.5, 13]]), "tinta");
        D.L.add(poli([[38.7, 8.6], [40.1, 8.6], [39.85, 13.2], [38.95, 13.2]]), C.maderaOsc);
        D.r(38.2, 8.6, 2.4, 4.6);
        copaBultos(D, [[32.4, 7.6, 2.3], [35.4, 5.6, 2.8], [39.2, 4.7, 3], [43.2, 5.2, 2.9], [46.6, 7, 2.3], [37.2, 8, 2.4], [41.4, 8.2, 2.5], [45, 8.4, 2]]);
        // Los cocos de castaña que cuelgan de la copa: así se sabe que es un castaño.
        for (const [x, y] of [[34.6, 10.4], [43.6, 10.8], [46.6, 9.4]]) disco(D, x, y, 1.15, C.castana, { borde: 0.5, sombra: 0.4 });
      };
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "amarillo",
        paisaje(D) {
          // La selva en tres capas, de lejos a cerca, cada una con el borde de copas redondas, y el río abajo.
          const copas = (base, r, desfase) => (x) => { const m = (((x + desfase) % (2 * r)) + 2 * r) % (2 * r) - r; return base - Math.sqrt(Math.max(0, r * r - m * m)) * 0.85; };
          franjaDisco(D, { arriba: copas(17.4, 1.7, 0.6), color: C.selvaLejos, n: 240 });
          franjaDisco(D, { arriba: copas(21, 2.1, 1.4), color: C.selvaMedio, n: 240 });
          D.L.add(poli([[38.6, 9], [40.2, 9], [40.8, 31], [38, 31]]), C.maderaOsc);
          franjaDisco(D, { arriba: copas(24.6, 2.4, 0.2), color: C.selvaCerca, n: 240 });
          franjaDisco(D, { arriba: () => 28.2, color: C.rio });
          for (const [x0, y0, w] of [[28.5, 29.4, 5], [36, 30.4, 3.5]]) D.L.add(rect(x0, y0, w, 0.6), C.rioClaro);
          pixeles(D, PARABA_ROJA, { x: 9.5, y: 6.8, p: 0.92, col: { r: C.rojoBo, a: "amarillo", T: C.parabaOsc, w: C.blanco, x: C.semilla }, borde: 0.5 });
        },
        delante(D) {
          copa();
          hoja(D, { x0: 31.5, y0: 30, x1: 43.6, y1: 21.4, ancho: 5.4, curva: -1.2, col: C.hoja, borde: 0.65, sombra: 0.8 });
        },
      });
    },
  },
  {
    id: "pando-castana",
    nombre: "Castaña de Pando",
    frase: ["Castaña", "de Pando"],
    nota: "El coco de la castaña, duro como la madera, guarda adentro sus semillas apretadas como gajos. Pando es la tierra de la castaña que Bolivia lleva al mundo.",
    dibujar(D, frase) {
      hoja(D, { x0: 33, y0: 14, x1: 47.6, y1: 2.4, ancho: 8.6, curva: 1.4, borde: 0.75, sombra: 1 });
      llama(D, { x: 2.4, y: 2.6, alto: 26, contorno: 0.9, sombra: 1.4, rot: 8 });
      cocoAbierto(D, 30.6, 20.6, 10.6);
      // La tapa, al lado, y una castaña pelada delante.
      forma(D, [...elipse(45.4, 28.6, 3.6, 2.8, 24).filter(([, y]) => y <= 28.7), [41.8, 28.7]], C.castana, { borde: 0.7, sombra: 0.9 });
      D.L.add(poli(elipse(45.4, 26.6, 1.1, 0.5, 12)), C.castanaOsc);
      castanaPelada(D, 40.4, 29.2, -12);
      cinta(D, { lineas: frase, cx: 25, y: 31.6, ancho: 36, fill: "naranja", tamMax: 8.5 });
    },
  },
  {
    id: "pando-asai",
    nombre: "Pausa amazónica",
    frase: ["Pausa", "amazónica"],
    nota: "El jugo de asaí, morado oscuro, de la palmera que crece en la Amazonía de Pando y el Beni. La pausa de la tarde.",
    dibujar(D, frase) {
      palmera(D, { x: 44.6, yBase: 30.6, alto: 18.6, largo: 7.8 });
      llama(D, { x: 1.6, y: 4, alto: 26, contorno: 0.9, sombra: 1.4 });
      // La bombilla, detrás del vaso.
      trazo(D, [[30.8, 14], [34.6, 4.4], [38.6, 2]], 2.3, "tinta", { masa: true });
      trazo(D, [[30.8, 14], [34.6, 4.4], [38.6, 2]], 1.2, "turquesa");
      // El vaso alto con el jugo y la espuma.
      const v = [[24.6, 7.6], [37.4, 7.6], [36.4, 30.4], [25.6, 30.4]];
      forma(D, v, C.vaso, { borde: 0.85, sombra: 1.3 });
      D.L.add(poli([[25.5, 11.6], [36.5, 11.6], [35.7, 29.5], [26.3, 29.5]]), C.asai);
      D.L.add(poli([[25.4, 9.8], [36.6, 9.8], [36.5, 12], [25.5, 12]]), C.asaiEspuma);
      D.L.add(poli([[26.8, 13.4], [27.8, 13.4], [27.6, 27.6], [26.9, 27.6]]), C.uvaClara);
      // El racimo de frutitas de asaí, al pie del vaso, colgando de su ramita.
      const bayas = [[39.6, 23.4], [42.4, 22.6], [45.2, 23.6], [38.8, 26.4], [41.6, 25.8], [44.4, 26.4], [47, 26.2], [40.4, 29], [43.2, 28.8], [46, 28.8]];
      trazo(D, [[38.4, 20.2], [42, 20.8], [45.6, 21.6], [47.6, 23.4]], 1.6, "tinta", { masa: true });
      trazo(D, [[38.4, 20.2], [42, 20.8], [45.6, 21.6], [47.6, 23.4]], 0.7, C.maderaOsc);
      for (const [x, y] of bayas) disco(D, x, y, 1.4, C.asaiFruta, { borde: 0.5, sombra: 0.5 });
      for (const [x, y] of bayas) D.L.add(circulo(x - 0.45, y - 0.48, 0.38), C.uvaClara);
      cinta(D, { lineas: frase, cx: 25, y: 31.4, ancho: 38, fill: "morado", color: "papel", tamMax: 8.5 });
    },
  },
  {
    id: "pando-tucan",
    nombre: "Pando de mi corazón",
    frase: ["Pando de", "mi corazón"],
    nota: "El tucán pechiblanco de la selva de Pando, con su pico enorme y su pecho blanco. La llama lo mira desde abajo, con el corazón contento.",
    dibujar(D, frase) {
      // La rama y sus hojas.
      hoja(D, { x0: 41, y0: 17.6, x1: 49.4, y1: 8.6, ancho: 5.4, curva: 0.8, borde: 0.7, sombra: 0.9 });
      hoja(D, { x0: 42, y0: 18.6, x1: 49.6, y1: 24.6, ancho: 5, curva: -0.8, col: C.cerroVerdeOsc, borde: 0.7, sombra: 0.9 });
      bloque(D, { x: 17.6, y: 17.4, w: 28.6, h: 2.6, fill: C.rama, borde: 0.75, sombra: 1, radio: 1.2 });
      const p = 1.05, t = espejo(TUCAN);
      pixeles(D, t, { x: 21.4, y: 17.6 - 17.6 * p, p, col: COL_TUCAN, borde: 0.75, sombra: 1.1 });
      llama(D, { x: 2, y: 8.4, alto: 22.5, contorno: 0.9, sombra: 1.4, rot: -10 });
      pixeles(D, CORAZON, { x: 14.8, y: -0.2, p: 1.22, col: { r: C.corazon }, borde: 0.7, sombra: 0.9, rot: -8 });
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 39, fill: "magenta", tamMax: 8.5 });
    },
  },
];

// ───────────────────────── Tiernos ─────────────────────────
/** Una kantuta que cuelga de (x, y): el cáliz verde, el tubo amarillo y la boca roja abierta en cinco lóbulos. */
function kantuta(D, x, y, { largo = 11, giro = 0 } = {}) {
  girar(D, giro, [x, y], () => {
    const L = largo;
    forma(D, [[x - 1.05, y + 2], [x + 1.05, y + 2], [x + 1.45, y + L * 0.64], [x - 1.45, y + L * 0.64]], C.kantutaTubo, { borde: 0.55, sombra: 0.5 });
    const boca = [[x - 1.5, y + L * 0.6], [x + 1.5, y + L * 0.6]];
    const lob = 5, ancho = 3.3;
    for (let i = 0; i <= lob * 4; i++) {
      const s = i / (lob * 4), bx = x + ancho * (1 - 2 * s) * 0.98, onda = Math.abs(Math.sin(s * Math.PI * lob));
      boca.push([bx, y + L + 0.15 - 0.9 * (1 - onda) - 0.3 * Math.sin(Math.PI * s)]);
    }
    forma(D, [boca[1], ...boca.slice(2), boca[0]].reverse(), C.kantutaRoja, { borde: 0.55, sombra: 0.55 });
    forma(D, [[x - 1.5, y - 0.2], [x + 1.5, y - 0.2], [x + 1.25, y + 1.4], [x + 0.6, y + 2.6], [x, y + 1.7], [x - 0.6, y + 2.6], [x - 1.25, y + 1.4]], C.kantutaCaliz, { borde: 0.5, sombra: 0.4 });
  });
}
/**
 * El picaflor de los valles, turquesa con la manchita violeta detrás del ojo, en vuelo y de costado: el pico largo y
 * fino hacia la izquierda, las alas levantadas y la cola abierta abajo a la derecha. Al dibujarlo se inclina, así el
 * pico entra en la boca de la flor y sigue siendo una línea derecha. t cuerpo, T alas y cola, l pecho, v la manchita,
 * x pico.
 */
const PICAFLOR = [
  "...........TT...",
  "..........TTT...",
  ".........TTTt...",
  "......ttt.TTt...",
  "xxxxxtwktttTt...",
  ".....tkkvttttT..",
  "......tvttttttTT",
  ".......lllttttTT",
  "........llltt.TT",
  "...........t...T",
];

/** Una bráctea del patujú: un pico rojo que sale del tallo hacia `dir` (1 derecha, -1 izquierda), con la punta amarilla y el borde verde. */
function bractea(D, x, y, dir, largo = 7.5, alto = 3) {
  // Una canoa curva, gruesa en la base y con la punta que sube como una pinza: así no parece un banderín.
  const P = (u, v) => [x + dir * u * largo, y + v * alto];
  const abajo = [P(0, 0.5), P(0.2, 0.78), P(0.45, 0.82), P(0.68, 0.6), P(0.87, 0.12), P(1, -0.85)];
  const arriba = [P(0.84, -0.3), P(0.62, -0.08), P(0.38, -0.14), P(0.16, -0.36), P(0, -0.55)];
  forma(D, [...abajo, ...arriba], C.rojoBo, { borde: 0.6, sombra: 0.7 });
  D.L.add(poli([P(0.7, 0.55), P(0.87, 0.12), P(0.98, -0.72), P(0.84, -0.3), P(0.68, -0.12)]), C.amarilloBo);
  trazo(D, [P(0.12, -0.38), P(0.38, -0.2), P(0.62, -0.14), P(0.82, -0.32)], 0.45, C.verdeBo);
}
/** La ranita verde que asoma entre las brácteas, de frente, con ojos grandes. */
const RANITA = [
  ".ggg....ggg.",
  "gwkkggggwkkg",
  "gkkkggggkkkg",
  "gggggggggggg",
  "ggrgkggkgrgg",
  ".ggggkkgggg.",
  "..gggggggg..",
  ".ggg....ggg.",
  "gg.g....g.gg",
];

/**
 * El jucumari, de frente: pelaje casi negro, las orejas redondas, las manchas claras alrededor de los ojos que bajan al
 * hocico, la nariz, la sonrisa, las mejillas y una manchita en el pecho, con el brazo izquierdo que sube en diagonal
 * para abrazar el cuello de la llama. j pelaje, e adentro de la oreja, c claro, r mejilla.
 */
const JUCUMARI = [
  "........jjj.....jjj.",
  ".......jjejj...jjejj",
  "........jjjjjjjjjjj.",
  "jjj....jjjjjjjjjjjjj",
  "jjjj...jjccjjjjjccjj",
  ".jjjj..jcwkcjjjcwkcj",
  "..jjjj.jckkcjjjckkcj",
  "...jjjjjjccjcccjccjj",
  "....jjjjjrjcckccjrjj",
  ".....jjjjjjckkkcjjj.",
  ".......jjjjjcccjjj..",
  "........jjjjjcjjjjj.",
  ".......jjjjjjjjjjjjj",
  "........jjjjjjjjjjjj",
  "........jjjjjjjjjjjj",
  ".......jjjjjjjjjjjjj",
  ".......jjjcc....ccjj",
  "........jjjj....jjjj",
];

const TIERNOS = [
  {
    id: "tierno-kantuta",
    nombre: "Flor de los Andes",
    frase: ["Flor de", "los Andes"],
    nota: "La kantuta, flor nacional de Bolivia, con el cáliz verde, el tubo amarillo y la boca roja. Un picaflor turquesa la visita.",
    dibujar(D, frase) {
      // La rama que entra desde la izquierda, con sus hojitas, y el ramito colgando de la punta, abierto en abanico.
      const dx = -4.6, rama = [[2.6, 9], [8, 5.6], [14, 3.6], [20, 3], [25.5, 3.4], [30.6, 4.8]].map(([x, y]) => [x + dx, y]);
      trazo(D, rama, 1.8, "tinta", { masa: true });
      trazo(D, rama, 0.8, C.troncoOsc);
      for (const [x, y, g] of [[5.4, 7.2, -150], [10.6, 4.6, -115], [16.4, 3.2, -75], [8.8, 5.4, 115], [22.6, 3, -50], [28.4, 4, -25]]) {
        const a = g * Math.PI / 180;
        hoja(D, { x0: x + dx, y0: y, x1: x + dx + Math.cos(a) * 3.6, y1: y + Math.sin(a) * 3.6, ancho: 1.8, col: C.cerroVerdeOsc, nervio: null, borde: 0.45, sombra: 0.4 });
      }
      for (const [x, y, l, g] of [[14.6, 3.9, 13, 13], [20.2, 3.2, 14.8, 4], [25.8, 3.6, 14.6, -5], [31, 5, 12.6, -17]]) kantuta(D, x + dx, y + 0.6, { largo: l, giro: g });
      // El picaflor se dibuja de costado y se inclina sobre la punta del pico, que queda en la boca de la última flor.
      const p = 1.12, pico = [31 + dx + 12.6 * Math.sin(17 * Math.PI / 180) + 0.3, 5.6 + 12.6 * Math.cos(17 * Math.PI / 180) + 0.6];
      pixeles(D, PICAFLOR, { x: pico[0] - 0.5 * p, y: pico[1] - 4.5 * p, p, col: { t: C.picaflor, T: C.picaflorOsc, v: C.oreja, l: C.picaflorClaro, x: "tinta" }, borde: 0.6, sombra: 0.7, rot: 24, rc: pico });
      cinta(D, { lineas: frase, cx: 22, y: 30.6, ancho: 36, fill: "amarillo", tamMax: 8.5 });
    },
  },
  {
    id: "tierno-patuju",
    nombre: "Colores de mi tierra",
    frase: ["Colores de", "mi tierra"],
    nota: "El patujú, flor nacional de Bolivia junto a la kantuta, con sus brácteas rojas, amarillas y verdes que cuelgan en zigzag. Entre ellas asoma una ranita.",
    dibujar(D, frase) {
      hoja(D, { x0: 18, y0: 31, x1: 2, y1: 4, ancho: 9, curva: -2.4, borde: 0.8, sombra: 1.1 });
      hoja(D, { x0: 31, y0: 31, x1: 47.5, y1: 7, ancho: 9, curva: 2.4, col: C.cerroVerdeOsc, borde: 0.8, sombra: 1.1 });
      // El tallo que cuelga en zigzag, rojo como las brácteas, y las brácteas alternadas, más grandes arriba.
      const zz = [[25, 0.2], [25.4, 3], [23.6, 7.2], [26.2, 11.4], [23.8, 15.6], [26, 19.8], [24.2, 24], [25.4, 27.6]];
      trazo(D, zz, 2.3, "tinta", { masa: true });
      trazo(D, zz, 1.05, C.rojoBo);
      const brac = [[25.6, 3.4, 1, 8.6, 3.4], [23.6, 7.4, -1, 9, 3.4], [26.2, 11.6, 1, 8.8, 3.3], [23.8, 15.8, -1, 8.4, 3.1], [26, 20, 1, 7.6, 2.9], [24.2, 24.2, -1, 6.8, 2.6], [25.4, 27.6, 1, 5.6, 2.3]];
      brac.slice(0, 3).forEach(([x, y, d, l, h]) => bractea(D, x, y, d, l, h));
      // La ranita asoma por detrás de una bráctea.
      pixeles(D, RANITA, { x: 28.4, y: 12.2, p: 1.0, col: { g: C.rana, r: C.mejilla }, borde: 0.7, sombra: 0.7 });
      brac.slice(3).forEach(([x, y, d, l, h]) => bractea(D, x, y, d, l, h));
      cinta(D, { lineas: frase, cx: 25, y: 30.4, ancho: 40, fill: "turquesa", tamMax: 8.5 });
    },
  },
  {
    id: "tierno-jucumari",
    nombre: "Abrazo de jucumari",
    frase: ["Abrazo de", "jucumari"],
    nota: "El jucumari, el oso andino de anteojos, el único oso de Sudamérica, de los bosques de los Yungas y los valles. Un abrazo para la llama.",
    dibujar(D, frase) {
      // Las dos hojas del bosque nublado: un helecho detrás de la llama y una hoja ancha detrás del oso.
      palma(D, { pts: [[6.4, 30.6], [3.6, 24], [2.2, 17], [2.6, 10.6]], largo: 3.6, paso: 1.5, angulo: 58, ancho: 1.3, col: C.helecho, colOsc: C.hoja });
      hoja(D, { x0: 34, y0: 22, x1: 47.6, y1: 9.6, ancho: 6.6, curva: 1.2, col: C.hoja, borde: 0.75, sombra: 1 });
      const ll = { x: 2, y: 1.6, alto: 27 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      // El oso, a la derecha del cuello y debajo de la cabeza de la llama, con el brazo que la rodea por delante.
      pixeles(D, JUCUMARI, { x: 15.6 - 3 * 1.12, y: 9.6, p: 1.12, col: { j: C.jucumari, c: C.antifaz, r: C.mejilla, e: C.capiguaraOsc }, borde: 0.75, sombra: 1.1 });
      // La bromelia roja, a los pies: la roseta de hojas de punta y, en el medio, las brácteas rojas como una estrella.
      const bx = 43.4, by = 30.6;
      for (const [g, l] of [[-165, 5.2], [-135, 6.2], [-105, 6.6], [-75, 6.6], [-45, 6.2], [-15, 5.2]]) {
        const a = g * Math.PI / 180;
        hoja(D, { x0: bx, y0: by, x1: bx + Math.cos(a) * l, y1: by + Math.sin(a) * l, ancho: 1.8, col: g % 30 ? C.cerroVerdeOsc : C.hoja, nervio: null, borde: 0.5, sombra: 0.5 });
      }
      for (const [g, l] of [[-140, 3.6], [-112, 4.4], [-90, 4.8], [-68, 4.4], [-40, 3.6]]) {
        const a = g * Math.PI / 180;
        hoja(D, { x0: bx, y0: by - 1, x1: bx + Math.cos(a) * l, y1: by - 1 + Math.sin(a) * l, ancho: 1.5, col: C.bromelia, nervio: null, borde: 0.45, sombra: 0.3 });
      }
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 38, fill: "naranja", tamMax: 8.5 });
    },
  },
];

export const STICKERS = [...SANTA_CRUZ, ...BENI, ...PANDO, ...TIERNOS];
