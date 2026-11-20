/**
 * Valles: Cochabamba, Chuquisaca y Tarija. Cuatro stickers por departamento: la postal y tres sueltos.
 *
 * Cochabamba lleva además el silpancho (Full stack), que según la corrección de la regla de los animales reemplaza a
 * Todo con llajua: los dos quedan dibujados para que las hojas se armen con el que se elija.
 * La llama chapaca de Tarija lleva sombreroChapaco (de comun.mjs), el mismo de la colección impresa, en los cuatro.
 */
import { rect, circulo, poli, rotar, redondeado } from "../base.mjs";
import { pixeles, llama, disco, bloque, forma, elipse, trazo, brillo, cinta, girar, CORAZON, NOTA } from "../pincel.mjs";
import { C, postal, franjaDisco, tiras, sombreroChapaco } from "./comun.mjs";

/** Los colores propios de los valles (los demás están en C). */
const V = {
  rosaOsc: "#9e1a14", papaOsc: "#d9922b", yema: "#ffc629", clara: "#ffffff",
  tomate: "#e5392b", cebolla: "#f3e6f0", perejil: "#3f8f35", arrozSombra: "#e3ddd2", carneOsc: "#a8693a",
  diapason: "#2b2522", cuerda: "#fff6e9", sombraPared: "#cdbf9f", lagoLuz: "#fff0b3",
  muro: "#ffffff", muroSombra: "#e6e0d6", balcon: "#2f6b4a", vidrio: "#9fc9dc",
  blanqueadoSombra: "#eadfca", papelPlata: C.metal,
  choclo: "#f7e7a6", chocloGrano: "#ead07a", llajua: "#d8402a", quirquiña: "#2f6b2a",
  churqui: "#5f7f3a", piedraClara: "#b9bec3", turquesaClaro: "#4fd1c1", amarilloClaro: "#ffe08a",
  quirquiñaVena: "#5aa84a", duraznoRubor: "#ff8a8f", duraznoHendidura: "#d9606a",
  // Los tonos de luz y sombra de los paisajes de las postales.
  cerroLuz: "#9b88ee", lomaLuz: "#ffb47a", maderaClara: "#d99a5b", chocolateLuz: "#a46a46",
  locotoLuz: "#ff7f6e", tomateLuz: "#ff8a7a", blanqueadoBorde: "#e6d3b0",
};

/** Una curva suave que pasa por `pts` (Catmull y Rom), con `n` puntos por tramo: para asas y tallos. */
function curva(pts, n = 8) {
  const salida = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      salida.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  salida.push(pts[pts.length - 1]);
  return salida;
}

/** Un bulto suave (para lomas y cerros redondeados): `h` de alto en `c`, de ancho `w`. */
const bulto = (x, c, w, h) => h * Math.exp(-(((x - c) / w) ** 2));

/** La llama chapaca: la del logo con el sombrero chapaco de la colección. */
function llamaChapaca(D, ll) {
  llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
  sombreroChapaco(D, ll);
}

/** Una nota musical de color, como en la colección. */
const notaColor = (D, x, y, color, p = 0.95) => pixeles(D, NOTA, { x, y, p, borde: 0.45, col: { k: color } });

/** Un locoto: redondito, rojo y de lóbulos suaves, con el cabito verde y un brillo. `g` lo inclina. */
function locoto(D, x, y, r, g = 0) {
  girar(D, g, [x, y], () => {
    const pts = [];
    // Rechoncho y con tres lóbulos, más angosto abajo: un corazón gordito más que un ají largo.
    for (let i = 0; i < 48; i++) { const t = 2 * Math.PI * i / 48, b = 1 + 0.09 * Math.cos(3 * t + Math.PI / 2); pts.push([x + r * b * Math.cos(t) * (1 - 0.2 * Math.max(0, Math.sin(t))), y + r * 1.02 * b * Math.sin(t)]); }
    forma(D, pts, C.locoto, { borde: 0.6, sombra: 0.5 });
    D.L.add(rect(x - r * 0.62, y - r * 0.45, r * 0.32, r * 0.55), V.locotoLuz);
    forma(D, [[x - r * 0.6, y - r * 0.9], [x + r * 0.6, y - r * 0.9], [x + 0.3, y - r * 1.2], [x + 0.75, y - r * 1.85], [x - 0.05, y - r * 1.9], [x - 0.3, y - r * 1.2]], C.hoja, { borde: 0.45, sombra: 0 });
  });
}

/** Una hojita en almendra (en punta en los dos extremos, para que no parezca un grano), de `largo` en la dirección `g`. */
function hojita(D, x, y, largo, ancho, g, col, { borde = 0.45, sombra = 0.35, masa = true } = {}) {
  const pts = [];
  for (let i = 0; i < 36; i++) { const t = 2 * Math.PI * i / 36, s = Math.sin(t); pts.push([(largo / 2) * Math.cos(t), (ancho / 2) * s * Math.sqrt(Math.abs(s))]); }
  const a = g * Math.PI / 180;
  forma(D, pts.map(([px, py]) => [x + px * Math.cos(a) - py * Math.sin(a), y + px * Math.sin(a) + py * Math.cos(a)]), col, { borde, sombra, masa });
}

/** Un tomate: redondo y rojo, con la estrellita verde arriba y un brillo. */
function tomate(D, x, y, r) {
  disco(D, x, y, r, V.tomate, { borde: 0.6, sombra: 0.6 });
  D.L.add(rect(x - r * 0.6, y - r * 0.5, r * 0.3, r * 0.4), V.tomateLuz);
  const estrella = [];
  for (let i = 0; i < 10; i++) { const t = Math.PI * i / 5 - Math.PI / 2, rr = i % 2 ? r * 0.22 : r * 0.62; estrella.push([x + rr * Math.cos(t), y - r * 0.72 + rr * 0.55 * Math.sin(t)]); }
  forma(D, estrella, C.hoja, { borde: 0.4, sombra: 0, masa: false });
}

/**
 * El batán cochabambino: la losa de piedra chata y alargada, vista un poco de arriba, con la llajua a medio moler y
 * la uña (la piedra curva que se mece) apoyada encima a la derecha.
 */
function batan(D, { x, y, w, h }) {
  // La losa: la cara de arriba clara y el canto más oscuro, con los bordes redondeados.
  const P = (t, dy = 0) => [x + w / 2 + (w / 2) * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.55, y + h / 2 + (h / 2) * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.55 + dy];
  const losa = [];
  for (let i = 0; i <= 40; i++) losa.push(P(Math.PI + Math.PI * i / 40));
  for (let i = 0; i <= 40; i++) losa.push(P(Math.PI * i / 40, 2.6));
  forma(D, losa, C.piedraOsc, { borde: 0.85, sombra: 1.3 });
  const cara = [];
  for (let i = 0; i < 80; i++) cara.push(P(2 * Math.PI * i / 80));
  forma(D, cara, C.piedra, { borde: 0.6, sombra: 0, masa: false });
  for (const [px, py, pw] of [[x + 3.2, y + h * 0.7, 2.2], [x + w - 7.5, y + h * 0.78, 1.6], [x + w * 0.42, y + h * 0.84, 1.8]]) D.L.add(rect(px, py, pw, 0.4), V.piedraClara);
  // La llajua: una mancha roja con puntitos verdes de quirquiña y las semillas.
  const salsa = [];
  for (let i = 0; i < 30; i++) { const t = 2 * Math.PI * i / 30, b = 1 + 0.12 * Math.sin(t * 4 + 1); salsa.push([x + w * 0.36 + 6.2 * b * Math.cos(t), y + h * 0.48 + 1.9 * b * Math.sin(t)]); }
  forma(D, salsa, V.llajua, { borde: 0.55, sombra: 0, masa: false });
  for (const [dx, dy, col] of [[-4, -0.6, V.quirquiña], [-1.6, 0.6, V.quirquiña], [1.2, -0.8, V.quirquiña], [3.6, 0.3, V.quirquiña], [-2.8, 0.1, C.florCentro], [0.2, 0.2, C.florCentro], [2.4, 0.9, C.florCentro]]) D.L.add(rect(x + w * 0.36 + dx, y + h * 0.48 + dy, 0.7, 0.55), col);
}

/**
 * La uña del batán: una piedra gruesa en media luna, como un gajo, con la panza curva abajo para mecerse y el lomo
 * casi recto arriba, donde se agarra con las dos manos.
 */
function uña(D, { cx, base, w, h, g = 0 }) {
  girar(D, g, [cx, base], () => {
    const pts = [];
    for (let i = 0; i <= 32; i++) { const t = Math.PI * i / 32; pts.push([cx - (w / 2) * Math.cos(t), base - h * 0.55 + h * 0.55 * Math.sin(t)]); }
    for (let i = 0; i <= 16; i++) { const t = Math.PI * i / 16; pts.push([cx + (w / 2) * Math.cos(t), base - h * 0.55 - h * 0.45 * Math.sin(t) ** 0.35]); }
    forma(D, pts, C.piedra, { borde: 0.75, sombra: 1.0 });
    // Piedra maciza y pareja: la luz arriba en el lomo y unas pintitas de roca, sin cortes que la hagan ver como fiambre.
    D.L.add(rect(cx - w * 0.3, base - h - 0.05, w * 0.5, 0.6), V.piedraClara);
    for (const [dx, dy] of [[-0.3, 0.55], [-0.05, 0.4], [0.12, 0.62], [-0.2, 0.25], [0.22, 0.35], [0.33, 0.55], [-0.38, 0.3]]) D.L.add(rect(cx + dx * w, base - h + dy * h, 0.5, 0.5), C.piedraOsc);
  });
}

// ───────────────────────── Cochabamba ─────────────────────────

/**
 * La cordillera del Tunari detrás del valle, de tarde: un lomo largo de cumbres redondeadas, con la más alta un poco a la
 * derecha (sin nieve: en noviembre no tiene), y adelante las faldas en sombra.
 */
function tunari(D) {
  D.L.add(circulo(14.8, 12.6, 3.5), C.sol);
  const lomo = (x) => 16 - bulto(x, 9, 4, 3.4) - bulto(x, 17, 3.5, 2.8) - bulto(x, 25, 4, 4.0) - bulto(x, 35.4, 6.0, 8.6) - bulto(x, 45, 3.4, 4.6);
  franjaDisco(D, { arriba: lomo, color: C.cerro });
  // Las caras en sombra de cada cumbre, del lado de la derecha, y las faldas de adelante.
  for (const [c, w] of [[9, 4], [25, 4], [35.4, 6.0], [45, 3.4]]) tiras(D, { x0: c, x1: c + w * 1.6, arriba: lomo, abajo: (x) => lomo(x) + 0.6 + (x - c) * 0.9, color: C.cerroOsc });
  franjaDisco(D, { arriba: (x) => 19.2 - bulto(x, 12, 4, 1.4) - bulto(x, 31, 5, 1.8) - bulto(x, 42, 3.6, 1.2), color: C.cerroOsc });
}

/** El valle verde: dos franjas de chacras con sus surcos y florcitas sueltas (la eterna primavera). */
function valleCocha(D) {
  const v1 = (x) => 20.6 + 1.0 * Math.sin((x - 16) / 5.2);
  franjaDisco(D, { arriba: v1, color: C.cerroVerde });
  // Las chacras: divisiones y surcos en diagonal en una sí y una no.
  const lindes = [9.5, 14.5, 20.5, 27.5, 32.5, 37.0, 41.5];
  lindes.forEach((x, i) => {
    D.L.add(poli([[x, v1(x) + 0.2], [x + 0.35, v1(x) + 0.2], [x - 1.1, 26.5], [x - 1.45, 26.5]]), C.cerroVerdeOsc);
    if (i % 2 === 0) {
      const x2 = lindes[i + 1] ?? 46;
      for (let s = x + 0.9; s < x2 - 0.4; s += 1.15) D.L.add(poli([[s, v1(s) + 0.6], [s + 0.32, v1(s) + 0.6], [s - 0.75, 26.4], [s - 1.07, 26.4]]), C.troncoClaro);
    }
  });
  const v2 = (x) => 26.0 - 0.8 * Math.sin((x - 30) / 6);
  franjaDisco(D, { arriba: v2, color: C.cerroVerdeOsc });
  for (let k = 0; k < 3; k++) for (let x = 6 + k * 0.9; x < 46; x += 2.4) {
    const y = v2(x) + 1.3 + k * 1.7;
    D.L.add(rect(x, y, 1.3, 0.55), C.vid);
  }
  // Florcitas rosadas y amarillas: cruces de cinco píxeles.
  const flores = [[30.0, 22.6, C.flor], [35.4, 23.4, "amarillo"], [40.2, 21.9, C.flor], [32.4, 27.6, "amarillo"], [37.8, 28.4, C.flor], [42.2, 26.0, "amarillo"], [29.4, 25.4, C.flor], [38.0, 25.2, C.flor], [8.6, 22.6, "amarillo"], [9.2, 27.4, C.flor]];
  for (const [x, y, col] of flores) {
    const p = 0.68;
    D.L.add([...rect(x - p * 1.5, y - p / 2, p * 3, p), ...rect(x - p / 2, y - p * 1.5, p, p * 3)], col);
    D.L.add(rect(x - p / 2, y - p / 2, p, p), C.florCentro);
  }
}

/**
 * Un charango de madera visto de frente, de abajo hacia arriba en la dirección `ang` (grados), con la punta de abajo en
 * (x0, y0) y `s` de escala (1 mide 38,6 de largo).
 */
function charango(D, { x0, y0, ang, s = 1 }) {
  const a = ang * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
  const P = (u, v) => [x0 + (d[0] * u + n[0] * v) * s, y0 + (d[1] * u + n[1] * v) * s];
  const lob = (u, c, l, w) => (Math.abs(u - c) < l ? w * Math.sqrt(1 - ((u - c) / l) ** 2) : 0);
  const media = (u) => Math.max(lob(u, 5.6, 5.6, 6.0), lob(u, 13.0, 4.2, 4.8));
  const caja = (insetU, insetV) => {
    const pts = [];
    for (let i = 0; i <= 64; i++) { const u = insetU + (17.2 - 2 * insetU) * i / 64; pts.push(P(u, Math.max(0, media(u) - insetV))); }
    for (let i = 64; i >= 0; i--) { const u = insetU + (17.2 - 2 * insetU) * i / 64; pts.push(P(u, -Math.max(0, media(u) - insetV))); }
    return pts;
  };
  // El mástil corto y el clavijero, detrás de la caja, con sus diez clavijas (cinco por lado) asomando a los costados.
  forma(D, [P(15.5, -1.45), P(28.8, -1.3), P(28.8, 1.3), P(15.5, 1.45)], C.madera, { borde: 0.7, sombra: 0.9 });
  forma(D, [P(28.6, -2.15), P(35.9, -2.0), P(36.6, -1.2), P(36.6, 1.2), P(35.9, 2.0), P(28.6, 2.15)], C.maderaOsc, { borde: 0.7, sombra: 0.9 });
  for (let i = 0; i < 5; i++) {
    const u = 29.9 + i * 1.25;
    for (const sg of [-1, 1]) forma(D, [P(u - 0.42, sg * 2.0), P(u + 0.42, sg * 2.0), P(u + 0.42, sg * 3.7), P(u - 0.42, sg * 3.7)], C.fantasma, { borde: 0.45, sombra: 0 });
  }
  // La caja en ocho: los aros de madera y la tapa clara.
  forma(D, caja(0, 0), C.madera, { borde: 0.85, sombra: 1.3 });
  D.L.add(poli(caja(0.75, 0.75)), C.tapaCharango);
  // La boca redonda con su roseta, y el puente abajo.
  D.L.add(circulo(...P(12.6, 0), 2.35 * s), C.maderaOsc);
  D.L.add(circulo(...P(12.6, 0), 1.75 * s), "tinta");
  D.L.add(poli([P(3.9, -2.6), P(5.0, -2.6), P(5.0, 2.6), P(3.9, 2.6)]), C.maderaOsc);
  // El diapasón oscuro, del clavijero hasta cerca de la boca.
  D.L.add(poli([P(14.9, -1.15), P(28.9, -1.05), P(28.9, 1.05), P(14.9, 1.15)]), V.diapason);
  // Diez cuerdas en cinco pares, del puente al clavijero.
  for (let i = 0; i < 5; i++) for (const e of [-0.14, 0.14]) {
    const v = (i - 2) * 0.5 + e;
    D.L.add(poli([P(4.4, v - 0.1), P(29.2, v * 0.85 - 0.1), P(29.2, v * 0.85 + 0.1), P(4.4, v + 0.1)]), V.cuerda);
  }
}

/** Una correa tejida de colores que pasa por `pts`: borde de tinta, el fondo y una franja al medio. */
function correa(D, pts, ancho, { fondo = "turquesa", franja = "amarillo" } = {}) {
  trazo(D, pts, ancho + 1.1, "tinta", { masa: true });
  trazo(D, pts, ancho, fondo);
  trazo(D, pts, ancho * 0.36, franja);
}

/**
 * Una losa chata vista un poco de arriba: la cara de arriba de `arriba` y el canto de `canto`. `r(t)` agranda el radio
 * según el ángulo (para bordes ondulados, como la carne).
 */
function losa(D, { cx, cy, rx, ry, alto, arriba, canto, r = () => 1, borde = 0.7, sombra = 0.9, n = 56 }) {
  const P = (t, dy = 0) => [cx + rx * r(t) * Math.cos(t), cy + ry * r(t) * Math.sin(t) + dy];
  const contorno = [];
  for (let i = 0; i <= n; i++) contorno.push(P(Math.PI + Math.PI * i / n));
  for (let i = 0; i <= n; i++) contorno.push(P(Math.PI * i / n, alto));
  forma(D, contorno, canto, { borde, sombra });
  const cara = [];
  for (let i = 0; i < 2 * n; i++) cara.push(P(Math.PI * i / n));
  forma(D, cara, arriba, { borde: borde * 0.75, sombra: 0, masa: false });
}

/** Un huevo frito visto un poco de arriba: la clara ondulada y la yema corrida con su brillo. */
function huevo(D, x, y, rx, { yx = 0, yy = 0, fase = 0 } = {}) {
  const clara = [];
  for (let i = 0; i < 40; i++) { const t = 2 * Math.PI * i / 40, ola = 1 + 0.1 * Math.sin(t * 5 + fase) + 0.05 * Math.sin(t * 3 + fase * 2); clara.push([x + rx * ola * Math.cos(t), y + rx * 0.46 * ola * Math.sin(t)]); }
  forma(D, clara, V.clara, { borde: 0.6, sombra: 0.5 });
  forma(D, elipse(x + yx, y + yy - 0.25, rx * 0.42, rx * 0.29, 28), V.yema, { borde: 0.5, sombra: 0, masa: false });
  D.L.add(rect(x + yx - rx * 0.2, y + yy - rx * 0.23, rx * 0.19, rx * 0.12), C.blanco);
}

/**
 * El silpancho como se sirve, un plato visto un poco de arriba, que ya es una pila: el arroz que asoma atrás, las papas
 * doradas adelante, la carne apanada finita y enorme que tapa el plato y se sale del borde, dos huevos fritos encima y
 * la ensalada de tomate, cebolla y locoto a un costado.
 */
function silpancho(D, { cx, cy }) {
  // El plato blanco con su borde turquesa.
  losa(D, { cx, cy, rx: 15.8, ry: 6.4, alto: 1.4, arriba: C.blanco, canto: V.muroSombra });
  D.L.add([...poli(elipse(cx, cy, 15.0, 6.0, 56)), ...poli(elipse(cx, cy, 13.7, 5.35, 56).reverse())], "turquesa");
  // El arroz, un montecito atrás a la izquierda que asoma por detrás de la carne, con granitos.
  const arroz = [];
  for (let i = 0; i <= 40; i++) { const t = Math.PI * i / 40, b = 1 + 0.06 * Math.abs(Math.sin(t * 6)); arroz.push([cx - 8.0 - 6.4 * b * Math.cos(t), cy - 2.4 - 3.6 * b * Math.sin(t)]); }
  forma(D, arroz, C.blanco, { borde: 0.6, sombra: 0.4 });
  for (const [gx, gy, g] of [[-12.0, -3.6, -20], [-9.6, -5.0, 25], [-6.8, -5.2, -10], [-4.4, -4.0, 30], [-10.8, -2.8, 35], [-8.0, -3.2, -30], [-5.6, -2.8, 15]]) D.L.add(rotar(rect(cx + gx - 0.5, cy + gy - 0.22, 1.0, 0.44), g, cx + gx, cy + gy), V.arrozSombra);
  // Las papas doradas en rodajas, a la derecha, entre la carne y el borde del plato.
  for (const [dx, dy] of [[12.6, -2.8], [13.6, -0.2], [12.8, 2.6]]) losa(D, { cx: cx + dx, cy: cy + dy, rx: 2.3, ry: 1.25, alto: 0.6, arriba: C.pastel, canto: V.papaOsc, borde: 0.55, sombra: 0.4, n: 24 });
  // La carne apanada: finita, enorme y de borde irregular, que se sale del plato adelante a la izquierda.
  const mx = cx - 1.0, my = cy + 0.7;
  losa(D, { cx: mx, cy: my, rx: 12.4, ry: 4.5, alto: 0.5, arriba: C.madera, canto: V.carneOsc, r: (t) => 1 + 0.045 * Math.sin(t * 5 + 0.6) + 0.17 * Math.exp(-(((t - 2.4) / 0.42) ** 2)), n: 80 });
  for (let i = 0; i < 28; i++) {
    const t = i * 2.39996, rr = Math.sqrt((i + 0.5) / 28) * 0.86;
    D.L.add(rect(mx + 11.4 * rr * Math.cos(t) - 0.3, my + 4.1 * rr * Math.sin(t) - 0.22, 0.6, 0.44), V.carneOsc);
  }
  // Dos huevos fritos, uno adelante y otro atrás, con las yemas corridas: no arman una cara.
  huevo(D, mx + 3.0, my - 1.8, 3.6, { yx: 0.8, fase: 2.2 });
  huevo(D, mx - 4.0, my + 0.4, 4.3, { yx: -0.6, yy: 0.2, fase: 0.4 });
  // La ensalada a un costado: un montoncito de tomate con cebolla, locoto y perejil picados.
  const sx = mx + 8.2, sy = my + 0.9;
  const monte = [];
  for (let i = 0; i <= 24; i++) { const t = Math.PI * i / 24; monte.push([sx - 3.6 * Math.cos(t), sy + 1.2 - 2.8 * Math.sin(t) - 0.3 * Math.sin(t * 6)]); }
  forma(D, monte, V.tomate, { borde: 0.55, sombra: 0.5 });
  for (const [bx, by, col] of [[-2.2, 0.2, V.cebolla], [-1.0, -0.9, V.perejil], [0.4, -0.1, V.cebolla], [1.6, -0.9, C.locoto], [2.4, 0.3, V.perejil], [-0.3, -1.8, V.cebolla], [1.0, 0.6, V.perejil]]) {
    D.L.add(redondeado(sx + bx - 0.62, sy + by - 0.52, 1.24, 1.04, 0.3), "tinta");
    D.L.add(redondeado(sx + bx - 0.44, sy + by - 0.34, 0.88, 0.68, 0.22), col);
  }
}

// ───────────────────────── Chuquisaca ─────────────────────────

/** Una casa de Sucre: pared blanca, techo de teja roja con alero, balcón de madera arriba y puerta en arco abajo. */
function casaSucre(D, { x, w, techo, pisos = 1, base = 34 }) {
  D.L.add(rect(x - 0.35, techo - 0.35, w + 0.7, base - techo + 0.7), "tinta");
  D.L.add(rect(x, techo, w, base - techo), V.muro);
  D.L.add(rect(x + w - 0.8, techo, 0.8, base - techo), V.muroSombra);
  // El techo de teja: un alero más ancho que la pared, con las tejas marcadas.
  const t0 = techo - 2.1;
  D.L.add(poli([[x - 1.35, techo + 0.4], [x + w + 1.35, techo + 0.4], [x + w + 0.55, t0 - 0.4], [x - 0.55, t0 - 0.4]]), "tinta");
  D.L.add(poli([[x - 1.0, techo], [x + w + 1.0, techo], [x + w + 0.25, t0], [x - 0.25, t0]]), C.ladrillo);
  for (let tx = x - 0.5; tx < x + w + 0.7; tx += 0.95) D.L.add(rect(tx, t0 + 0.25, 0.32, 1.85), C.ladrilloOsc);
  D.L.add(rect(x - 1.0, techo - 0.45, w + 2.0, 0.45), C.ladrilloOsc);
  // La puerta en arco.
  const pisoAlto = techo + 6.4, px = x + w * 0.5 - 1.5, py = pisos > 1 ? pisoAlto + 1.6 : techo + 2.2;
  const arcoPuerta = (dx, dy, ww, hh, col) => {
    const pts = [[dx, dy + hh], [dx, dy + ww / 2]];
    for (let i = 0; i <= 12; i++) { const t = Math.PI + Math.PI * i / 12; pts.push([dx + ww / 2 + ww / 2 * Math.cos(t), dy + ww / 2 + ww / 2 * Math.sin(t)]); }
    pts.push([dx + ww, dy + hh]);
    D.L.add(poli(pts), col);
  };
  arcoPuerta(px - 0.35, py - 0.35, 3.7, 9, "tinta");
  arcoPuerta(px, py, 3.0, 9, C.maderaOsc);
  D.L.add(rect(px + 1.35, py + 1.8, 0.3, 7), C.madera);
  // El balcón de madera del piso alto, con su techito y sus barrotes.
  if (pisos > 1) {
    // El balcón de madera, con su techito, la ventana detrás y los barrotes.
    const bw = Math.min(w - 1.4, 6.6), bx = x + (w - bw) / 2, by = techo + 1.5;
    D.L.add(rect(bx - 0.35, by - 0.35, bw + 0.7, 4.9), "tinta");
    D.L.add(rect(bx, by, bw, 4.2), V.vidrio);
    D.L.add(rect(bx + bw / 2 - 0.25, by, 0.5, 2.2), C.maderaOsc);
    D.L.add(rect(bx, by + 2.2, bw, 2.0), C.madera);
    for (let s = bx + 0.45; s < bx + bw - 0.3; s += 0.9) D.L.add(rect(s, by + 2.45, 0.4, 1.75), C.maderaOsc);
    D.L.add(rect(bx - 0.8, by - 0.95, bw + 1.6, 0.95), C.maderaOsc);
    D.L.add(rect(bx - 0.8, by - 1.25, bw + 1.6, 0.3), "tinta");
    D.L.add(rect(bx - 0.6, by + 1.95, bw + 1.2, 0.45), "tinta");
    // El piso del balcón, que sale de la pared, con sus dos ménsulas debajo.
    D.L.add(rect(bx - 1.0, by + 4.0, bw + 2.0, 0.95), "tinta");
    D.L.add(rect(bx - 0.75, by + 4.2, bw + 1.5, 0.5), C.maderaOsc);
    for (const mx of [bx + 0.3, bx + bw - 1.5]) {
      D.L.add(poli([[mx - 0.3, by + 4.9], [mx + 1.5, by + 4.9], [mx + 0.6, by + 6.4]]), "tinta");
      D.L.add(poli([[mx, by + 4.95], [mx + 1.2, by + 4.95], [mx + 0.6, by + 5.9]]), C.maderaOsc);
    }
  }
}

/** Una casita de las filas de atrás: pared blanca con una puerta o ventana oscura y el techo de teja roja. */
function casita(D, { x, y, w, h, t, puerta }) {
  D.L.add(rect(x - 0.3, y - 0.3, w + 0.6, h + 0.6), "tinta");
  D.L.add(rect(x, y, w, h), V.muro);
  D.L.add(rect(x + w - 0.6, y, 0.6, h), V.muroSombra);
  if (puerta) D.L.add(rect(x + w * 0.3, y + h * 0.4, Math.max(0.8, w * 0.2), h * 0.6), C.maderaOsc);
  else D.L.add(rect(x + w * 0.28, y + h * 0.3, Math.max(0.8, w * 0.24), h * 0.32), V.balcon);
  D.L.add(poli([[x - 0.95, y + 0.3], [x + w + 0.95, y + 0.3], [x + w + 0.25, y - t - 0.3], [x - 0.25, y - t - 0.3]]), "tinta");
  D.L.add(poli([[x - 0.65, y], [x + w + 0.65, y], [x + w, y - t], [x, y - t]]), C.ladrillo);
  for (let tx = x - 0.25; tx < x + w + 0.4; tx += 0.85) D.L.add(rect(tx, y - t + 0.2, 0.28, t - 0.22), C.ladrilloOsc);
}

/**
 * Sucre en la ladera: los cerros verdes detrás, dos filas de casitas blancas con techo de teja que suben, y adelante a la
 * derecha una casa de dos pisos con su balcón de madera. Ninguna torre.
 */
function sucre(D) {
  franjaDisco(D, { arriba: (x) => 13.2 - bulto(x, 13, 5.5, 4.6) - bulto(x, 37.5, 5, 3.6), color: C.cerroVerde });
  franjaDisco(D, { arriba: (x) => 14.6 - bulto(x, 17, 4, 1.6) - bulto(x, 41, 3, 1.2), color: C.cerroVerdeOsc });
  const filas = [[14.2, 4.0, 3.0, 1.35, 0], [18.2, 4.8, 3.6, 1.55, 2.1]];
  filas.forEach(([y, w, h, t, corre], f) => {
    for (let x = 4 + corre, i = 0; x < 46; i++) {
      const ww = w + ((i * 7 + f * 3) % 3) * 0.45, dy = ((i * 5 + f) % 3) * 0.55;
      casita(D, { x, y: y + dy, w: ww, h, t, puerta: (i + f) % 2 === 0 });
      x += ww + 1.55;
    }
  });
  casaSucre(D, { x: 29.6, w: 9.8, techo: 18.8, pisos: 2 });
  casaSucre(D, { x: 40.4, w: 7.0, techo: 22.0, pisos: 1 });
}

/**
 * El saurópodo amable, de costado y mirando a la izquierda (hacia la llama): cabeza chica con ojo y sonrisa, cuello
 * largo, cuerpo con manchitas, panza clara, cola larga y cuatro patas de columna. f piel, d manchas y patas de atrás,
 * l panza, k tinta, w brillo, r mejilla.
 */
const DINO = [
  "..fffff...................",
  ".fffffff..................",
  "fffffwkff.................",
  "fffffkkff.................",
  "ffffkfrrf.................",
  "fkkkfffff.................",
  ".ffffffff.................",
  "....fffff.................",
  ".....ffff.................",
  "......ffff................",
  ".......ffff...............",
  "........ffff..............",
  ".........ffff.............",
  "..........ffffffff........",
  ".........fffffdffffff.....",
  "........ffffffdddffffff...",
  "........ffffffffdfffddffff",
  "........lffffffffffdddffff",
  "........llllffffffffffff..",
  ".........lllllllllfffff...",
  ".........fffddd...fffddd..",
  ".........fffddd...fffddd..",
  ".........fffddd...fffddd..",
  "........ffff.ddd.ffff.ddd.",
];

/**
 * Una huella de tres dedos en tinta, la de los dibujos de dinosaurios: el talón redondo y tres dedos largos y en punta,
 * bien abiertos, que miran hacia donde camina.
 */
function huella(D, x, y, g, s = 1) {
  girar(D, g, [x, y], () => {
    // El talón chico y tres dedos anchos en la base que se afinan hasta una punta roma, bien abiertos: así no se leen
    // ni como pata de gato ni como pájaro.
    const cmds = [...poli(elipse(x, y + 0.55 * s, 1.1 * s, 0.9 * s, 24))];
    for (const [a, largo] of [[-42, 2.6], [0, 3.2], [42, 2.6]]) {
      const r = a * Math.PI / 180, u = [Math.sin(r), -Math.cos(r)], w = [-u[1], u[0]];
      const P = (d, l) => [x + (u[0] * d + w[0] * l) * s, y + (u[1] * d + w[1] * l) * s];
      const punta = 0.36, dedo = [P(0, -0.72), P(largo - punta, -punta)];
      for (let i = 1; i < 8; i++) { const t = -Math.PI / 2 + Math.PI * i / 8; dedo.push(P(largo - punta + punta * Math.cos(t), punta * Math.sin(t))); }
      dedo.push(P(largo - punta, punta), P(0, 0.72));
      cmds.push(...poli(dedo));
    }
    D.L.add(cmds, "tinta");
  });
}

/** La tableta de chocolate parada, con el envoltorio naranja abierto abajo, el papel plateado y una esquina mordida. */
function tableta(D, { x, y, w, h }) {
  // La tableta: el contorno con la esquina de arriba a la derecha mordida (dos bocados redondos seguidos).
  const cuerpo = [[x, y], [x + w - 5.2, y]];
  for (let i = 0; i <= 10; i++) { const t = Math.PI - Math.PI * i / 10; cuerpo.push([x + w - 3.4 + 1.8 * Math.cos(t), y + 1.6 * Math.sin(Math.PI * i / 10)]); }
  for (let i = 0; i <= 10; i++) { const t = Math.PI * 1.1 - Math.PI * 0.75 * i / 10; cuerpo.push([x + w + 2.1 * Math.cos(t), y + 2.4 - 2.1 * Math.sin(t)]); }
  cuerpo.push([x + w, y + h], [x, y + h]);
  forma(D, cuerpo, C.chocolate, { borde: 0.85, sombra: 1.3 });
  // Los cuadritos.
  const cols = 3, filas = 5, m = 0.9, cw = (w - 2 * m) / cols, ch = (h * 0.62 - m) / filas;
  for (let i = 0; i < cols; i++) for (let j = 0; j < filas; j++) {
    const cx0 = x + m + i * cw, cy0 = y + m + j * ch;
    if (i === cols - 1 && j === 0) continue;
    D.L.add(rect(cx0 + 0.35, cy0 + 0.35, cw - 0.7, ch - 0.7), C.chocolateClaro);
    D.L.add(rect(cx0 + 0.35, cy0 + 0.35, cw - 0.7, 0.35), V.chocolateLuz);
  }
  // El papel plateado y el envoltorio naranja abierto, con el borde rasgado.
  const yE = y + h * 0.58;
  const plata = [[x - 0.2, yE + 0.6]];
  for (let i = 0; i <= 10; i++) plata.push([x + w * i / 10, yE - (i % 2 ? 1.0 : 0.1)]);
  plata.push([x + w + 0.2, yE + 0.6], [x + w + 0.2, y + h], [x - 0.2, y + h]);
  forma(D, plata, V.papelPlata, { borde: 0.6, sombra: 0, masa: false });
  const env = [[x - 0.7, yE + 1.6]];
  for (let i = 0; i <= 8; i++) env.push([x - 0.7 + (w + 1.4) * i / 8, yE + 0.9 + (i % 2 ? 0 : 0.9)]);
  env.push([x + w + 0.7, y + h + 0.6], [x - 0.7, y + h + 0.6]);
  forma(D, env, "naranja", { borde: 0.75, sombra: 1.1 });
  // El envoltorio, sin marca: naranja con dos franjas amarillas.
  D.L.add(rect(x - 0.7, yE + 3.2, w + 1.4, 0.9), "amarillo");
  D.L.add(rect(x - 0.7, yE + 5.0, w + 1.4, 0.5), "amarillo");
}

/** Un bombón envuelto en papel brillante: el cuerpo redondeado, las dos puntas retorcidas en abanico y un brillo. */
function bombon(D, x, y, col, claro, g = 0) {
  girar(D, g, [x, y], () => {
    for (const s of [-1, 1]) forma(D, [[x + s * 2.0, y - 0.5], [x + s * 4.2, y - 1.9], [x + s * 3.7, y], [x + s * 4.2, y + 1.9], [x + s * 2.0, y + 0.5]], col, { borde: 0.5, sombra: 0.5 });
    forma(D, elipse(x, y, 2.6, 2.1, 32), col, { borde: 0.6, sombra: 0.7 });
    for (const s of [-1, 1]) D.L.add(rect(x + s * 2.35 - 0.2, y - 0.9, 0.4, 1.8), "tinta");
    D.L.add(rect(x - 1.5, y - 1.3, 1.1, 0.55), claro);
    D.L.add(rect(x - 1.5, y - 0.6, 0.5, 0.5), claro);
  });
}

/**
 * El tejido de Tarabuco a medio hacer: fondo rojo con franjas naranja y tinta, y una banda con figuritas (una llamita,
 * un pajarito y un caballito) en blanco y amarillo. Genérico: no copia un diseño concreto.
 */
const TEJIDO = [
  "kkkkkkkkkkkkkkkkkkkkkk",
  "nnnnnnnnnnnnnnnnnnnnnn",
  "kakakakakakakakakakaka",
  "rrrrrrrrrrrrrrrrrrrrrr",
  "rrrrwrrrarrrrarrrrrrwr",
  "rrrrwwrrrarraanrrrrwww",
  "rwrrwrrraaaaaarrrrwwrr",
  "rwwwwrrrraaaarrwwwwwrr",
  "rrwwwrrrrrnrnrrwrwwwrr",
  "rrwrwrrrrrrrrrrrrwrwrr",
  "rrrrrrrrrrrrrrrrrrrrrr",
  "kakakakakakakakakakaka",
  "nnnnnnnnnnnnnnnnnnnnnn",
  "kkkkkkkkkkkkkkkkkkkkkk",
  "rrrrrrrrrrrrrrrrrrrrrr",
  "rarrrarrrarrrarrrarrra",
  "aaaraaaraaaraaaraaaraa",
  "rarrrarrrarrrarrrarrra",
  "rrrrrrrrrrrrrrrrrrrrrr",
];

// ───────────────────────── Tarija ─────────────────────────

/** El atardecer en el lago de San Jacinto: el sol bajo, los cerros morados y naranjas, y el lago con rayitas de luz. */
function sanJacinto(D) {
  franjaDisco(D, { arriba: () => 12.6, color: C.sol });
  D.L.add(circulo(36.4, 15.4, 3.5), C.luna);
  // Los cerros del fondo, morados, y las lomas de adelante, naranjas, que bajan hasta el agua.
  const lejos = (x) => 17.4 - bulto(x, 10, 4.5, 4.4) - bulto(x, 19, 3.6, 2.6) - bulto(x, 29, 4.2, 3.4) - bulto(x, 44, 4, 3.6);
  franjaDisco(D, { arriba: lejos, color: C.cerro });
  tiras(D, { x0: 6, x1: 46, arriba: lejos, abajo: (x) => lejos(x) + 0.9 + bulto(x, 29, 6, 1.4), color: V.cerroLuz });
  const cerca = (x) => 20.4 - bulto(x, 8, 4.2, 2.4) - bulto(x, 20, 5, 1.5) - bulto(x, 41, 4.6, 2.6);
  franjaDisco(D, { arriba: cerca, color: C.atardecer });
  tiras(D, { x0: 34, x1: 47, arriba: cerca, abajo: (x) => cerca(x) + 1.2, color: V.lomaLuz });
  // Los churquis, matitas espinosas sobre las lomas.
  for (const [x, r] of [[30.6, 0.8], [33.4, 0.6], [38.2, 0.75], [44.2, 0.7], [12.6, 0.7]]) {
    const y = cerca(x) + 1.6;
    D.L.add([...circulo(x, y, r), ...circulo(x + r * 0.95, y + 0.2, r * 0.75)], V.churqui);
  }
  // La orilla verde y el lago, con las rayitas de luz del sol.
  franjaDisco(D, { arriba: () => 21.6, color: C.cerroVerdeOsc });
  franjaDisco(D, { arriba: () => 22.5, color: "turquesa" });
  for (const [x, y, w] of [[33.0, 23.8, 6.8], [34.4, 25.6, 4.0], [35.4, 27.3, 2.0]]) D.L.add(rect(x, y, w, 0.75), V.lagoLuz);
  for (const [x, y, w] of [[11.6, 24.8, 2.2], [19.0, 26.6, 1.8], [40.8, 28.4, 1.8]]) D.L.add(rect(x, y, w, 0.6), V.turquesaClaro);
}

/** Un violín de madera parado, con su voluta, el diapasón oscuro, las cuatro cuerdas y el cordal. */
function violin(D, { cx, y0, rot = 0 }) {
  const ancho = (t) => {
    // t de 0 (abajo) a 14 (arriba del cuerpo): la caja con sus dos curvas y la cintura.
    const abajo = 4.7 * Math.sqrt(Math.max(0, 1 - ((t - 4.4) / 4.6) ** 2));
    const arriba = 3.9 * Math.sqrt(Math.max(0, 1 - ((t - 10.6) / 3.6) ** 2));
    return Math.max(abajo, arriba, t > 5 && t < 10 ? 2.05 : 0);
  };
  girar(D, rot, [cx, y0 - 10], () => {
    const pts = [];
    for (let i = 0; i <= 56; i++) { const t = 14.2 * i / 56; pts.push([cx + ancho(t), y0 - t]); }
    for (let i = 56; i >= 0; i--) { const t = 14.2 * i / 56; pts.push([cx - ancho(t), y0 - t]); }
    // El mástil y la voluta, detrás de la caja.
    forma(D, [[cx - 0.85, y0 - 13.6], [cx + 0.85, y0 - 13.6], [cx + 0.75, y0 - 20.4], [cx - 0.75, y0 - 20.4]], C.madera, { borde: 0.6, sombra: 0.8 });
    forma(D, [[cx - 1.0, y0 - 20.2], [cx + 1.0, y0 - 20.2], [cx + 0.9, y0 - 23.2], [cx - 0.9, y0 - 23.2]], C.maderaOsc, { borde: 0.55, sombra: 0 });
    disco(D, cx + 0.2, y0 - 24.2, 1.35, C.madera, { borde: 0.55, sombra: 0 });
    // La voluta en espiral, como un caracol de madera.
    const voluta = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24 * Math.PI * 3, r = 0.1 + 0.95 * i / 24; voluta.push([cx + 0.2 + r * Math.cos(t), y0 - 24.2 + r * Math.sin(t)]); }
    trazo(D, voluta, 0.32, C.maderaOsc);
    for (const dy of [-21, -22.4]) for (const s of [-1, 1]) forma(D, [[cx + s * 0.95, y0 + dy - 0.35], [cx + s * 2.0, y0 + dy - 0.35], [cx + s * 2.0, y0 + dy + 0.35], [cx + s * 0.95, y0 + dy + 0.35]], C.pelo, { borde: 0.35, sombra: 0 });
    forma(D, pts, C.madera, { borde: 0.85, sombra: 1.3 });
    // El borde oscuro de la caja, las efes y el diapasón.
    const adentro = pts.map(([px, py]) => [cx + (px - cx) * 0.86, y0 - 7.1 + (py - (y0 - 7.1)) * 0.93]);
    D.L.add(poli(adentro), V.maderaClara);
    for (const s of [-1, 1]) {
      D.L.add(rect(cx + s * 2.0 - 0.18, y0 - 8.8, 0.36, 3.2), "tinta");
      D.L.add(circulo(cx + s * 2.0, y0 - 8.8, 0.35), "tinta");
      D.L.add(circulo(cx + s * 2.0, y0 - 5.6, 0.35), "tinta");
    }
    D.L.add(poli([[cx - 0.75, y0 - 9.6], [cx + 0.75, y0 - 9.6], [cx + 0.85, y0 - 20.2], [cx - 0.85, y0 - 20.2]]), V.diapason);
    D.L.add(poli([[cx - 1.1, y0 - 0.6], [cx + 1.1, y0 - 0.6], [cx + 0.75, y0 - 4.2], [cx - 0.75, y0 - 4.2]]), V.diapason);
    // El puente, entre las muescas de las efes.
    D.L.add(rect(cx - 1.6, y0 - 7.5, 3.2, 0.55), C.paja);
    for (const dx of [-0.48, -0.16, 0.16, 0.48]) D.L.add(poli([[cx + dx * 1.3 - 0.06, y0 - 3.9], [cx + dx * 1.3 + 0.06, y0 - 3.9], [cx + dx + 0.06, y0 - 20.3], [cx + dx - 0.06, y0 - 20.3]]), V.cuerda);
  });
}

/**
 * Una rosa vista de arriba: el borde en cinco pétalos redondeados y adentro la espiral de los pétalos, en dos tonos,
 * con el centro apretado. Así no se confunde con una fruta.
 */
function rosa(D, x, y, r, col, osc, g = 0) {
  const borde = [];
  for (let i = 0; i < 60; i++) { const t = 2 * Math.PI * i / 60 + g, b = 1 + 0.1 * Math.abs(Math.sin(t * 2.5)); borde.push([x + r * b * Math.cos(t), y + r * b * Math.sin(t)]); }
  forma(D, borde, col, { borde: 0.55, sombra: 0.5 });
  const espiral = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40 * Math.PI * 3.4 + g, rr = r * (0.12 + 0.72 * i / 40); espiral.push([x + rr * Math.cos(t), y + rr * Math.sin(t)]); }
  trazo(D, espiral, Math.max(0.42, r * 0.24), osc);
  D.L.add(circulo(x, y, r * 0.2), osc);
}

/** Una ramita de albahaca: el tallo y hojitas en pares. */
function albahaca(D, { x, y, largo, ang, hojas = 3, h = 1.25 }) {
  const a = ang * Math.PI / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
  const P = (u, v) => [x + d[0] * u + n[0] * v, y + d[1] * u + n[1] * v];
  trazo(D, [P(0, 0), P(largo, 0)], 0.6, "tinta", { masa: true });
  trazo(D, [P(0, 0), P(largo, 0)], 0.28, C.vid);
  for (let i = 0; i < hojas; i++) {
    const u = largo * (0.35 + 0.65 * i / Math.max(1, hojas - 1));
    for (const s of [-1, 1]) {
      const c = P(u, s * h * 0.75);
      forma(D, elipse(c[0], c[1], h * 0.95, h * 0.55, 16, ang + s * 35), i % 2 ? C.hoja : C.cerroVerde, { borde: 0.4, sombra: 0 });
    }
  }
  forma(D, elipse(...P(largo + h * 0.6, 0), h * 0.85, h * 0.5, 16, ang), C.cerroVerde, { borde: 0.4, sombra: 0 });
}

/**
 * Una canastita de mimbre: el cuerpo con el tejido en cuadritos, el borde y el asa. (x, y) es la esquina de arriba del
 * cuerpo. Dibuja el asa enseguida y devuelve la función que dibuja el cuerpo: se llama después de lo que va adentro, así
 * la canasta tapa la base de lo que lleva.
 */
function canasta(D, { x, y, w, h, asa = true, conAsa }) {
  if (asa) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = Math.PI * i / 24; pts.push([x + w / 2 - (w / 2 - 1.2) * Math.cos(t), y - (conAsa ?? h * 1.15) * Math.sin(t)]); }
    trazo(D, pts, 2.0, "tinta", { masa: true });
    trazo(D, pts, 1.0, C.madera);
  }
  return () => {
    const cuerpo = [[x, y], [x + w, y], [x + w - 1.6, y + h], [x + 1.6, y + h]];
    forma(D, cuerpo, C.madera, { borde: 0.8, sombra: 1.2 });
    const filas = Math.round(h / 1.3);
    for (let j = 0; j < filas; j++) {
      const yy = y + 1.2 + j * (h - 1.6) / filas, t = (yy - y) / h, xa = x + 1.6 * t + 0.5, xb = x + w - 1.6 * t - 0.5;
      for (let xx = xa + (j % 2) * 0.9; xx < xb - 0.8; xx += 1.8) D.L.add(rect(xx, yy, 0.9, (h - 1.6) / filas * 0.55), C.maderaOsc);
    }
    bloque(D, { x: x - 0.9, y: y - 0.6, w: w + 1.8, h: 1.8, fill: C.maderaOsc, borde: 0.7, sombra: 0.8, radio: 0.9 });
  };
}

/**
 * La empanada blanqueada de Tarija: la media luna gordita de masa dorada, con el repulgue trenzado grueso en el
 * borde curvo, y arriba el blanqueado, una costra blanca, lisa y apenas brillante que deja ver el repulgue.
 */
function blanqueada(D, { cx, base, rx, ry, g = 0 }) {
  girar(D, g, [cx, base], () => {
    // La masa: una media luna más ancha que alta, con el borde curvo en ondas, una por pellizco del repulgue.
    const n = 11, onda = (t) => 1 + 0.075 * Math.abs(Math.sin(t * n)) ** 0.6;
    const contorno = [];
    for (let i = 0; i <= 240; i++) { const t = Math.PI * i / 240, b = onda(t); contorno.push([cx - rx * b * Math.cos(t), base - ry * b * Math.sin(t)]); }
    forma(D, contorno, C.pastel, { borde: 0.85, sombra: 1.3 });
    // El repulgue trenzado: entre pellizco y pellizco, una marca en diagonal.
    for (let k = 1; k < n; k++) {
      const t = Math.PI * k / n;
      trazo(D, [[cx - (rx - 0.1) * Math.cos(t), base - (ry - 0.1) * Math.sin(t)], [cx - (rx - 3.0) * Math.cos(t + 0.11), base - (ry - 3.0) * Math.sin(t + 0.11)]], 0.62, C.pastelOsc);
    }
    // El blanqueado: una costra blanca untada por encima, que sigue la panza inflada y deja ver la masa dorada abajo y
    // el repulgue arriba. El borde es ondulado, con tres gotitas que bajan hacia el repulgue.
    const gotas = [0.33, 0.56, 0.8], y0 = base - 2.4;
    const borde = (t) => 1 + 0.025 * Math.sin(t * 9 + 1) + gotas.reduce((s, g) => s + 0.085 * Math.exp(-(((t / Math.PI - g) / 0.035) ** 2)), 0);
    const costra = [];
    for (let i = 0; i <= 90; i++) { const t = Math.PI * i / 90, w = borde(t); costra.push([cx - (rx - 3.2) * w * Math.cos(t), y0 - (ry - 4.2) * w * Math.sin(t)]); }
    for (let i = 1; i < 40; i++) { const u = 1 - 2 * i / 40; costra.push([cx + (rx - 3.2) * u, y0 + 1.3 * (1 - u * u) + 0.22 * Math.sin(u * 11)]); }
    // Con un borde crema y no de tinta: un borde negro la hace ver como un hueco con relleno, no como una cubierta.
    forma(D, costra, V.blanqueadoBorde, { borde: 0, sombra: 0, masa: false });
    forma(D, costra.map(([px, py]) => [cx + (px - cx) * 0.965, y0 - 0.15 + (py - y0) * 0.94]), C.blanqueado, { borde: 0, sombra: 0, masa: false });
    const luz = [];
    for (let i = 0; i <= 14; i++) { const t = Math.PI * (0.22 + 0.26 * i / 14); luz.push([cx - (rx - 5.4) * Math.cos(t), y0 - (ry - 6.4) * Math.sin(t)]); }
    trazo(D, luz, 0.8, C.blanco);
    trazo(D, [[cx + 3.4, y0 - 5.4], [cx + 5.6, y0 - 4.6]], 0.6, C.blanco);
  });
}

export const STICKERS = [
  // ── Cochabamba ──
  {
    id: "cochabamba-tunari",
    nombre: "Postal de Cochabamba",
    frase: ["Tinkazo en", "COCHABAMBA"],
    nota: "La cordillera del Tunari, que cuida la ciudad desde el norte, y el valle verde de la eterna primavera.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "amarillo", cielo: C.cieloTarde,
        paisaje(D) { tunari(D); valleCocha(D); },
        delante(D) { brillo(D, 43, 2.5, 0.65, "turquesa"); },
      });
    },
  },
  {
    id: "cochabamba-charango",
    nombre: "Charango de Aiquile",
    frase: ["Charango", "de Aiquile"],
    nota: "Aiquile, en Cochabamba, es la capital del charango: cada año celebra su feria y su festival. Este es de madera y de diez cuerdas.",
    dibujar(D, frase) {
      const ll = { x: 1, y: 4, alto: 26 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      // La correa tejida: sale del talón del mástil y rodea el cuello de la llama.
      correa(D, curva([[24.4, 19.8], [21.6, 14.6], [18.4, 12.4], [15.4, 11.6]], 6), 1.5);
      charango(D, { x0: 16.6, y0: 30.8, ang: -56, s: 0.86 });
      notaColor(D, 28.4, 20.2, "naranja");
      notaColor(D, 34.0, 14.6, "turquesa");
      notaColor(D, 40.0, 19.4, "morado");
      cinta(D, { lineas: frase, cx: 25, y: 30.4, ancho: 38, fill: "naranja", tamMax: 8.5 });
    },
  },
  {
    id: "cochabamba-silpancho",
    nombre: "Full stack",
    frase: ["Full stack"],
    nota: "El silpancho de Cochabamba es una pila: arroz, papa, carne apanada, dos huevos y la ensalada de tomate, cebolla y locoto.",
    dibujar(D, frase) {
      // La llama detrás del plato, con la nariz hacia la comida.
      llama(D, { x: 0.6, y: 4.6, alto: 25, contorno: 0.9, sombra: 1.4, rot: 6 });
      silpancho(D, { cx: 32.4, cy: 22.4 });
      brillo(D, 40.6, 11.8, 0.6, "amarillo");
      brillo(D, 24.0, 12.6, 0.55, "turquesa");
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 38, fill: "amarillo", tamMax: 8.5 });
    },
  },
  {
    id: "cochabamba-llajua",
    nombre: "Todo con llajua",
    frase: ["Todo con", "llajua"],
    nota: "La llajua de Cochabamba se muele en batán con locoto, tomate y quirquiña. En Cochabamba casi no hay mesa sin ella.",
    dibujar(D, frase) {
      llama(D, { x: 0.6, y: 3.6, alto: 25, contorno: 0.9, sombra: 1.4, rot: 6 });
      // Lo que se va a moler, atrás sobre la losa: dos locotos enteros y un tomate.
      locoto(D, 22.6, 18.8, 2.3, -16);
      locoto(D, 27.6, 18.0, 2.2, 10);
      tomate(D, 33.0, 19.0, 2.5);
      batan(D, { x: 16.4, y: 20.2, w: 31.2, h: 6.4 });
      uña(D, { cx: 40.4, base: 24.6, w: 12.6, h: 5.6, g: -14 });
      // Una ramita de quirquiña con tres hojas, adelante.
      const tallo = curva([[19.0, 28.2], [20.8, 26.6], [22.0, 24.2]], 6);
      trazo(D, tallo, 0.75, "tinta");
      trazo(D, tallo, 0.35, C.vid);
      hojita(D, 23.2, 22.8, 3.4, 1.7, -60, C.hoja);
      hojita(D, 18.8, 25.4, 3.2, 1.6, -150, V.quirquiñaVena);
      hojita(D, 23.4, 26.2, 3.2, 1.6, -10, V.quirquiñaVena);
      cinta(D, { lineas: frase, cx: 25, y: 30.8, ancho: 36, fill: "turquesa", tamMax: 8.5 });
    },
  },
  {
    id: "cochabamba-llajta",
    nombre: "Mi Llajta querida",
    frase: ["Mi Llajta", "querida"],
    nota: "Llajta es como le dice el cochabambino a su tierra. La canasta trae lo del valle: choclos, duraznos, un locoto y flores.",
    dibujar(D, frase) {
      const ll = { x: 1.8, y: 2.5, alto: 27 };
      llama(D, { ...ll, contorno: 0.9, sombra: 1.4 });
      // El asa de la canasta cruza por delante del cuello de la llama, bien arriba: la canasta le cuelga al costado.
      const asa = curva([[17.6, 21.6], [17.4, 15.4], [19.4, 10.6], [23.8, 9.6], [29.6, 11.0], [34.6, 15.0], [36.2, 21.4]]);
      trazo(D, asa, 2.0, "tinta", { masa: true });
      trazo(D, asa, 1.0, C.madera);
      const cerrar = canasta(D, { x: 16.4, y: 21.2, w: 21.4, h: 8.6, asa: false });
      // Lo del valle que asoma de la canasta.
      // Los choclos del valle: claros y de granos grandes.
      for (const [cx, cy, g] of [[25.2, 15.8, -12], [33.0, 15.4, 16]]) {
        forma(D, elipse(cx, cy, 2.2, 5.0, 28, g), V.chocloGrano, { borde: 0.6, sombra: 0.5 });
        girar(D, g, [cx, cy], () => {
          // Los granos grandes y redondos, en hileras corridas.
          for (let j = -4; j <= 4; j++) for (const dx of [-1.05, 0, 1.05]) {
            const dy = j * 1.08 + (dx === 0 ? 0.54 : 0), media = 2.2 * Math.sqrt(Math.max(0, 1 - (dy / 5) ** 2));
            if (Math.abs(dx) + 0.55 < media) D.L.add(circulo(cx + dx, cy + dy, 0.5), V.choclo);
          }
          forma(D, [[cx - 2.5, cy + 5.4], [cx - 2.7, cy + 1.0], [cx - 0.6, cy + 3.6], [cx, cy + 5.6]], C.hoja, { borde: 0.5, sombra: 0 });
          forma(D, [[cx + 2.5, cy + 5.4], [cx + 2.8, cy + 0.6], [cx + 0.6, cy + 3.6], [cx, cy + 5.6]], C.cerroVerde, { borde: 0.5, sombra: 0 });
        });
      }
      // Los duraznos: el rubor rosado grande y la hendidura que los distingue de una naranja.
      for (const [cx, cy, r] of [[20.4, 19.2, 2.7], [29.4, 19.2, 2.8]]) {
        disco(D, cx, cy, r, C.durazno, { borde: 0.6, sombra: 0.6 });
        D.L.add(circulo(cx + r * 0.22, cy + r * 0.2, r * 0.68), V.duraznoRubor);
        const hendidura = [];
        for (let i = 0; i <= 10; i++) { const t = -1.25 + 1.6 * i / 10; hendidura.push([cx + r * 0.95 * Math.cos(t) - r * 0.55, cy + r * 0.95 * Math.sin(t) + r * 0.05]); }
        trazo(D, hendidura, 0.42, V.duraznoHendidura);
        D.L.add(rect(cx - r * 0.62, cy - r * 0.55, r * 0.32, r * 0.32), C.blanco);
        forma(D, [[cx, cy - r], [cx + 1.6, cy - r - 1.6], [cx + 2.6, cy - r - 0.6], [cx + 0.8, cy - r + 0.4]], C.hoja, { borde: 0.45, sombra: 0 });
      }
      locoto(D, 37.8, 18.6, 2.3, 18);
      for (const [fx, fy, col, cen] of [[29.4, 7.4, C.flor, C.florCentro], [42.0, 11.0, "amarillo", "naranja"]]) {
        trazo(D, [[fx, fy + 1.4], [fx - 0.6, fy + 7]], 0.5, C.vid, { masa: true });
        for (let i = 0; i < 5; i++) { const t = i / 5 * Math.PI * 2 - Math.PI / 2; disco(D, fx + Math.cos(t) * 1.15, fy + Math.sin(t) * 1.15, 0.95, col, { borde: 0.4, sombra: 0 }); }
        D.L.add(circulo(fx, fy, 0.75), cen);
      }
      cerrar();
      brillo(D, 43.2, 4.4, 0.6, "amarillo");
      brillo(D, 11.8, 4.6, 0.55, "turquesa");
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 37, fill: "magenta", tamMax: 8.5 });
    },
  },
  // ── Chuquisaca ──
  {
    id: "chuquisaca-sucre",
    nombre: "Postal de Chuquisaca",
    frase: ["Tinkazo en", "CHUQUISACA"],
    nota: "Las casas blancas de Sucre, con techos de teja roja y balcones de madera: el centro histórico es Patrimonio de la Humanidad.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "morado", letras: "papel",
        paisaje(D) { sucre(D); },
        delante(D) { brillo(D, 43, 2.5, 0.65, "amarillo"); },
      });
    },
  },
  {
    id: "chuquisaca-dino",
    nombre: "Cuellos largos",
    frase: ["Cuellos largos"],
    nota: "Los dinosaurios dejaron miles de huellas en la pared de Cal Orck'o, en Sucre. La llama y el saurópodo, cuello con cuello.",
    dibujar(D, frase) {
      // La pared de Cal Orck'o: un farallón de caliza casi vertical detrás del saurópodo, con un camino de huellas que
      // sube en diagonal y unas grietas.
      // Sale del suelo: la base queda detrás de la cinta.
      forma(D, [[31.0, 1.8], [34.8, 0.6], [38.6, 1.2], [42.4, -0.6], [46.4, 0.0], [48.4, 3.4], [49.4, 9.6], [49.8, 18.0], [50.0, 29.6], [32.8, 29.6], [32.6, 19.4], [32.2, 11.8]], C.pared, { borde: 0.8, sombra: 1.2 });
      for (const [x, y] of [[32.4, 8.2], [33.0, 14.8], [33.4, 21.6]]) D.L.add(rotar(rect(x, y, 16.4, 0.5), -9, x, y), V.sombraPared);
      for (const pts of [[[37.6, 1.6], [38.4, 3.6], [37.8, 5.2]], [[47.6, 9.0], [46.6, 11.4], [47.4, 13.2]]]) trazo(D, pts, 0.4, V.sombraPared);
      // Un pie y el otro: el camino sube en diagonal y cada huella se corre un poco a su lado.
      for (const [hx, hy] of [[35.4, 13.4], [41.0, 9.4], [44.4, 3.6]]) huella(D, hx, hy, 42, 1.0);
      llama(D, { x: 0.8, y: 4.4, alto: 24, contorno: 0.9, sombra: 1.4 });
      pixeles(D, DINO, { x: 22.4, y: 5.3, p: 0.92, col: { f: C.dino, d: C.dinoOsc, l: C.florCentro, r: C.mejilla }, borde: 0.7, sombra: 1.0 });
      cinta(D, { lineas: frase, cx: 25, y: 29.4, ancho: 41, fill: "amarillo", tamMax: 8.5 });
    },
  },
  {
    id: "chuquisaca-chocolate",
    nombre: "Dulce como Sucre",
    frase: ["Dulce como", "Sucre"],
    nota: "Quien va a Sucre vuelve con chocolates: es una tradición de la ciudad. La llama abraza su tableta.",
    dibujar(D, frase) {
      // La llama detrás de la tableta, con la cabeza apoyada arriba e inclinada hacia ella: la abraza con el cuello.
      llama(D, { x: 2.2, y: 3.4, alto: 27, contorno: 0.9, sombra: 1.4, rot: 6 });
      girar(D, -10, [26.9, 22.2], () => tableta(D, { x: 19.4, y: 12.8, w: 15, h: 18.8 }));
      // Dos bombones envueltos en papel brillante de colores, con las puntas retorcidas.
      bombon(D, 11.6, 28.4, "turquesa", V.turquesaClaro, -12);
      bombon(D, 41.4, 27.0, "amarillo", V.amarilloClaro, 10);
      pixeles(D, CORAZON, { x: 37.4, y: 1.8, p: 1.25, col: { r: C.corazon }, borde: 0.6, sombra: 0.8, rot: 10 });
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 37, fill: "magenta", tamMax: 8.5 });
    },
  },
  {
    id: "chuquisaca-tarabuco",
    nombre: "Colores de Tarabuco",
    frase: ["Colores de", "Tarabuco"],
    nota: "Los tejidos de Tarabuco, en Chuquisaca, cuentan su mundo en colores: personas, caballos, aves y llamas. La llama mira cómo crece el suyo.",
    dibujar(D, frase) {
      // El telar: dos estacas, el palo de arriba con la urdimbre y el de abajo con el tejido.
      const x0 = 22.4, x1 = 46.6;
      for (const x of [x0, x1]) forma(D, [[x - 0.85, 1.4], [x + 0.85, 1.4], [x + 0.85, 28.4], [x, 30.0], [x - 0.85, 28.4]], C.maderaOsc, { borde: 0.7, sombra: 1.0 });
      for (let x = x0 + 2.0; x < x1 - 1.4; x += 1.05) D.L.add(rect(x, 4.6, 0.32, 8.6), C.fantasma);
      bloque(D, { x: x0 - 1.8, y: 7.6, w: x1 - x0 + 3.6, h: 1.1, fill: C.madera, borde: 0.5, sombra: 0, radio: 0.5 });
      pixeles(D, TEJIDO, { x: x0 + 1.5, y: 12.6, p: 0.98, col: { r: C.tejidoRojo, w: C.blanco }, borde: 0.55, sombra: 0.8 });
      bloque(D, { x: x0 - 2.0, y: 2.6, w: x1 - x0 + 4.0, h: 2.0, fill: C.madera, borde: 0.75, sombra: 1.0, radio: 1.0 });
      llama(D, { x: 0.6, y: 7.2, alto: 23, contorno: 0.9, sombra: 1.3 });
      cinta(D, { lineas: frase, cx: 25, y: 31.4, ancho: 38, fill: "naranja", tamMax: 8.5 });
    },
  },
  // ── Tarija ──
  {
    id: "tarija-sanjacinto",
    nombre: "Postal de Tarija",
    frase: ["Tinkazo en", "TARIJA"],
    nota: "La llama chapaca a la orilla del lago de San Jacinto, cerca de la ciudad de Tarija, a la hora del atardecer.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "magenta", cielo: C.cieloTarde,
        paisaje(D) { sanJacinto(D); },
        sombrero: sombreroChapaco,
        delante(D) { brillo(D, 43, 2.5, 0.65, "amarillo"); },
      });
    },
  },
  {
    id: "tarija-violin",
    nombre: "Música chapaca",
    frase: ["Música", "chapaca"],
    nota: "El violín es protagonista de la música chapaca, en el valle de Tarija. La llama chapaca lo tiene listo, con el arco cruzado.",
    dibujar(D, frase) {
      const ll = { x: 1.0, y: 5.6, alto: 25 };
      llamaChapaca(D, ll);
      // El violín, apoyado en el pecho de la llama, con la voluta despegada del ala del sombrero.
      violin(D, { cx: 31.0, y0: 32.0, rot: -9 });
      // El arco, cruzado delante del violín.
      trazo(D, [[19.8, 27.2], [41.6, 11.2]], 1.2, "tinta", { masa: true });
      trazo(D, [[20.1, 27.0], [41.3, 11.4]], 0.48, C.maderaOsc);
      trazo(D, [[20.6, 27.9], [41.9, 12.3]], 0.3, V.cuerda);
      bloque(D, { x: 18.6, y: 26.6, w: 2.4, h: 1.6, fill: C.pelo, borde: 0.4, sombra: 0, rot: -36 });
      notaColor(D, 38.2, 14.2, "magenta");
      notaColor(D, 43.8, 8.8, "naranja");
      notaColor(D, 43.4, 19.6, "morado", 0.85);
      for (const [fx, fy, col] of [[38.4, 28.8, C.flor], [46.0, 26.6, "amarillo"]]) {
        for (let i = 0; i < 5; i++) { const t = i / 5 * Math.PI * 2 - Math.PI / 2; disco(D, fx + Math.cos(t) * 1.1, fy + Math.sin(t) * 1.1, 0.9, col, { borde: 0.4, sombra: 0 }); }
        D.L.add(circulo(fx, fy, 0.7), col === "amarillo" ? "naranja" : C.florCentro);
      }
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 36, fill: "turquesa", tamMax: 8.5 });
    },
  },
  {
    id: "tarija-churo",
    nombre: "¡Qué churo!",
    frase: ["¡Qué churo!"],
    nota: "Churo quiere decir lindo en el habla chapaca. La llama lleva albahaca en el sombrero y una canastita de rosas.",
    dibujar(D, frase) {
      const ll = { x: 1.0, y: 5.0, alto: 26 };
      // La ramita de albahaca, prendida en la cinta del sombrero, detrás de la copa.
      const k = ll.alto / 26;
      albahaca(D, { x: ll.x + 15.6 * k, y: ll.y + 0.6 * k, largo: 6.2, ang: -128, hojas: 3, h: 1.3 });
      llamaChapaca(D, ll);
      const cerrar = canasta(D, { x: 26.8, y: 21.2, w: 19.2, h: 8.4, conAsa: 14.4 });
      // El ramo, suelto y desparejo: ramitas de albahaca que asoman, hojas y rosas rojas y rosadas de varios tamaños.
      for (const [x, y, ang] of [[28.4, 19.8, -152], [45.2, 19.0, -26], [33.8, 12.6, -112]]) albahaca(D, { x, y, largo: 5.6, ang, hojas: 3, h: 1.1 });
      for (const [x, y, g] of [[28.8, 15.6, -40], [44.4, 15.6, 30], [39.6, 9.8, 55], [31.0, 12.4, -70], [42.2, 12.2, 80], [26.8, 19.6, -5]]) hojita(D, x, y, 4.6, 2.0, g, C.hoja, { sombra: 0 });
      for (const [x, y, r, col, osc, g] of [[37.4, 12.0, 2.3, C.rojoBo, V.rosaOsc, 0.4], [32.6, 15.6, 2.3, C.flor, C.florOsc, 1.1], [41.6, 16.2, 2.5, C.rojoBo, V.rosaOsc, 2.0], [30.0, 18.8, 2.3, C.rojoBo, V.rosaOsc, 0.8], [36.6, 17.4, 2.7, C.flor, C.florOsc, 2.6], [43.8, 19.6, 1.9, C.flor, C.florOsc, 1.7]]) rosa(D, x, y, r, col, osc, g);
      cerrar();
      brillo(D, 46.4, 5.4, 0.65, "amarillo");
      brillo(D, 24.4, 2.0, 0.55, "turquesa");
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 40, fill: "amarillo", tamMax: 8.5 });
    },
  },
  {
    id: "tarija-blanqueada",
    nombre: "Tarija me endulza",
    frase: ["Tarija me", "endulza"],
    nota: "La empanada blanqueada, famosa en toda Tarija: masa dorada rellena de dulce de lacayote y cubierta de clara de huevo batida.",
    dibujar(D, frase) {
      llamaChapaca(D, { x: 0.8, y: 5.6, alto: 25 });
      blanqueada(D, { cx: 34.0, base: 28.6, rx: 14.2, ry: 10.8, g: -5 });
      brillo(D, 45.0, 12.0, 0.65, "amarillo");
      brillo(D, 24.4, 11.6, 0.55, "turquesa");
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 36, fill: "morado", color: "papel", tamMax: 8.5 });
    },
  },
];
