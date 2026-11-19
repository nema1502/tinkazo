/**
 * Occidente: La Paz, Oruro y Potosí. Cuatro stickers por departamento: la postal y tres sueltos (STICKERS). Al final, los
 * dos del Tinku (TINKU), con la montera como es: un casco duro con su penacho de plumas de colores. Van en una lista
 * aparte porque bolivia.mjs todavía tiene el tinku-montera de la primera muestra, con la montera textil, y dos stickers
 * con el mismo id frenan al corredor: cuando se saque aquel, estos se suman a la serie con `...TINKU`.
 */
import { rect, circulo, poli } from "../base.mjs";
import { medir } from "../dibujo.mjs";
import { pixeles, llama, llamaEn, disco, bloque, forma, elipse, trazo, brillo, cinta, chispas, girar, dentro, centroLlama, espejo, CORAZON, NOTA } from "../pincel.mjs";
import { C, DISCO, postal, franjaDisco, tiras, chullo } from "./comun.mjs";

/** Los colores propios del occidente (los demás están en C). */
const O = {
  nieveSombra: "#dde2f3", lozaSombra: "#dfe7ec",
  cebraSombra: "#d9dbe6", nariz: "#4a4a55", franjaBlanca: "#f4f1ea",
  totoraClara: "#f2d985", olaClara: "#5fd3c6",
  copaQueñua: "#5b7f45", copaQueñuaClara: "#7d9e5c", ichu: "#e2bf62",
  naranjaOsc: "#d85f0a", amarilloOsc: "#e0a100", magentaOsc: "#b52a78", tallo: "#5e8f4c",
  pelito: "#fff4dc", panza: "#e8d3ad", orejaQuir: "#c98d7a",
  flamencoPata: "#d1416f", lagunaOsc: "#b9382e",
  pastelClaro: "#f9d27a", arenaSombra: "#d6ad6c", piedrita: "#b9a27e", vizcachaClara: "#d8d1c4", vizcachaOsc: "#6f6a62",
  almilla: "#3a3050", bayeta: "#3c3352", boca: "#9e2b3a",
  cimaRica: "#de7a52", cerroLuz: "#c45e3e", veta: "#e9967a", cerroReflejo: "#c4b8f4", horizonte: "#9fd0e6",
};

// ───────────────────────── Lo común del occidente ─────────────────────────
/** Una soga que sigue una curva, partida en tramos de colores como un cordón tejido (la honda), con su borde de tinta. */
function cordon(D, pts, { grosor, colores, largo = 1.6, borde = 0.5, masa = true }) {
  trazo(D, pts, grosor + 2 * borde, "tinta", { masa });
  let acum = 0, color = 0, tramo = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    acum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    tramo.push(pts[i]);
    if (acum >= largo || i === pts.length - 1) {
      trazo(D, tramo, grosor, colores[color++ % colores.length]);
      acum = 0; tramo = [pts[i]];
    }
  }
}

/**
 * Poses de la llama que no están en pincel.mjs, en su cuadrícula de 22 por 26 (la cabeza en el mismo lugar que la del
 * logo, así los sombreros le quedan): de paso, con una mano bien arriba y doblada, de baile y en el aire.
 */
const CUERPO = [[2, 13, 16, 7], [15, 5, 4, 10], [14, 2, 8, 4], [20, 0, 2, 3], [0, 11, 3, 4]];
const POSE = {
  paso: [...CUERPO, [2.4, 20, 2.5, 3.2], [1.2, 22.4, 2.5, 3.6], [8, 20, 2.5, 6], [12.5, 20, 2.5, 6], [16, 20, 2.5, 2.6], [16.9, 21.6, 3.4, 1.9]],
  manoArriba: [...CUERPO, [3, 20, 2.5, 6], [8, 20, 2.5, 6], [12.5, 20, 2.5, 6], [16, 17.4, 5.8, 2.4], [19.4, 17.4, 2.4, 3.4]],
  baile: [...CUERPO, [2.4, 20, 2.5, 3.2], [1.2, 22.4, 2.5, 3.6], [8, 20, 2.5, 6], [12.5, 20, 2.5, 6], [16, 18.6, 4.4, 2.3], [18.0, 18.6, 2.3, 4.2]],
  salto: [...CUERPO, [2.6, 19.4, 2.6, 2.6], [1.2, 21.2, 2.8, 2.2], [7.6, 19.4, 2.5, 3.6], [12.6, 19.4, 2.5, 3.6], [16, 19.4, 2.6, 2.6], [17.6, 21.0, 2.8, 2.2]],
};

/**
 * La postal de comun.mjs con la llama en otra pose (bailando, en Oruro). Es la misma: disco, paisaje recortado, la llama
 * delante, lo que va pegado a ella y las dos cintas con las mismas medidas; solo cambia `llamaEn` con su `pose`.
 */
function postalEnPose(D, { nombre, colorNombre, de = "Tinkazo en", cielo = C.cielo, paisaje, llama: ll, pose, sombrero, delante }) {
  disco(D, DISCO.cx, DISCO.cy, DISCO.r, cielo, { borde: 0.9, sombra: 1.4 });
  if (paisaje) dentro(D, DISCO, () => paisaje(D, DISCO));
  llamaEn(D, { ...ll, pose, contorno: 0.9, sombra: 1.4 });
  if (sombrero) sombrero(D, ll);
  if (delante) delante(D);
  const anchoDe = Math.max(35, medir(de, 5.33) + 3.4);
  const a = cinta(D, { lineas: [de], cx: 21 + (anchoDe - 35) / 2, y: 30.6, ancho: anchoDe, fill: "tarjeta", color: "tinta", rot: -3, tamMax: 6 });
  cinta(D, { lineas: [nombre], cx: 25, y: a.y1 + 0.6, ancho: Math.min(47, Math.max(40, medir(nombre, 5.6) + 3.4)), fill: colorNombre, color: "sobre", rot: -3, tamMax: 11 });
}

/** Olas planas: una franja ondulada con borde (el agua debajo de la balsa). */
function olas(D, { x0, x1, y, alto = 2.2, n = 4, color = "turquesa", claro = O.olaClara, borde = 0.75, sombra = 1 }) {
  const arriba = [], abajo = [];
  const paso = (x1 - x0) / (n * 8);
  for (let x = x0; x <= x1 + 1e-9; x += paso) {
    const t = (x - x0) / (x1 - x0) * n * 2 * Math.PI;
    arriba.push([x, y - 0.9 * Math.sin(t)]);
    abajo.push([x, y + alto - 0.5 * Math.sin(t + 0.6)]);
  }
  forma(D, [...arriba, ...abajo.reverse()], color, { borde, sombra });
  // Las crestas, un poco más claras.
  for (let k = 0; k < n; k++) {
    const xc = x0 + (k + 0.25) / n * (x1 - x0);
    D.L.add(poli([[xc - 1.6, y - 0.55], [xc + 1.6, y - 0.55], [xc + 1.0, y + 0.25], [xc - 1.0, y + 0.25]]), claro);
  }
}

// ───────────────────────── La Paz ─────────────────────────
/**
 * El Illimani: el macizo ancho y nevado de tres cumbres, con la más alta (el pico Sur) a la derecha, como se ve desde la
 * ciudad. La central queda detrás de la cabeza de la llama. El sol sale por detrás, como a la mañana.
 */
function illimani(D) {
  D.L.add(circulo(13.6, 8.6, 2.6), C.sol);
  // La cresta, de izquierda a derecha: un hombro, el pico Norte, el Central y el Sur, con sus abras.
  const cresta = [[3, 25], [9.4, 16.4], [12.4, 13.0], [15.0, 14.0], [18.4, 8.8], [21.6, 11.0], [25.0, 8.2], [28.8, 10.6], [35.2, 6.4], [38.8, 9.8], [41.4, 9.4], [46.5, 17], [47.5, 31]];
  D.L.add(poli([...cresta, [3, 31]]), C.cerro);
  const altura = (x) => {
    for (let i = 0; i < cresta.length - 1; i++) {
      const [ax, ay] = cresta[i], [bx, by] = cresta[i + 1];
      if (x >= ax && x <= bx) return ay + (by - ay) * (x - ax) / (bx - ax);
    }
    return 31;
  };
  // Las caras en sombra: de cada cumbre hacia la abra de su derecha, cortadas derecho para abajo.
  const caras = [[12.4, 15.0], [18.4, 21.6], [25.0, 28.8], [35.2, 47.5]];
  for (const [a, b] of caras) tiras(D, { x0: a, x1: b, arriba: altura, abajo: () => 31, color: C.cerroOsc });
  // La nieve hasta una línea pareja con lenguas que bajan: gruesa en las cumbres, fina en las abras.
  const linea = (x) => 14.6 + 1.5 * Math.abs(((x / 1.55) % 2) - 1) - (x > 30 ? 0.8 : 0);
  tiras(D, { x0: 6, x1: 46, arriba: altura, abajo: linea, color: C.nieve });
  for (const [a, b] of caras) tiras(D, { x0: a, x1: b, arriba: altura, abajo: linea, color: O.nieveSombra });
}

/** La ladera de La Paz: la hoyada de tierra con casitas de ladrillo apiladas, ventanas encendidas y techos de calamina. */
function ladera(D) {
  const borde = (x) => 30.5 - ((x - 23) / 19) ** 2 * 13;
  franjaDisco(D, { arriba: borde, color: C.ladera });
  franjaDisco(D, { arriba: (x) => borde(x) + 6.5, color: C.laderaOsc });
  // Las casitas, en filas que siguen la ladera, cada fila un poco corrida.
  const filas = [[0, 1.3], [1, 3.9], [2, 6.5], [3, 9.1]];
  for (const [f, dy] of filas) {
    for (let x = 6 + (f % 2) * 1.7; x < 45; x += 3.4) {
      const xc = x + 1.5, y0 = borde(xc) + dy - 2.2;
      if (y0 < borde(xc) - 1.6) continue;
      const w = 2.7 + ((x * 7 + f * 3) % 5) * 0.12, h = 2.4 + ((x * 3 + f) % 3) * 0.3;
      D.L.add(poli([[x, y0], [x + w, y0], [x + w, y0 + h], [x, y0 + h]]), C.ladrillo);
      D.L.add(poli([[x - 0.2, y0 - 0.5], [x + w + 0.2, y0 - 0.5], [x + w + 0.2, y0 + 0.05], [x - 0.2, y0 + 0.05]]), (Math.round(x * 3) + f) % 3 ? C.calamina : C.ladrilloOsc);
      D.L.add(poli([[x + w - 0.6, y0], [x + w, y0], [x + w, y0 + h], [x + w - 0.6, y0 + h]]), C.ladrilloOsc);
      const ventana = (vx, vy, col) => D.L.add(poli([[vx, vy], [vx + 0.75, vy], [vx + 0.75, vy + 0.75], [vx, vy + 0.75]]), col);
      ventana(x + 0.5, y0 + 0.75, (Math.round(x) + f) % 2 ? "amarillo" : "tinta");
      if (w > 2.9) ventana(x + 1.55, y0 + 0.75, (Math.round(x) + f) % 3 ? "amarillo" : "tinta");
    }
  }
}

/** Un hilo de vapor: una línea blanca ondulada con borde de tinta, que se afina arriba. */
function vapor(D, x, y, alto, fase = 0) {
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([x + 0.85 * Math.sin(t * 2.4 * Math.PI + fase), y + alto * (1 - t)]); }
  trazo(D, pts, 2.0, "tinta", { masa: true });
  trazo(D, pts, 0.8, C.blanco);
}

/** La taza de api: loza blanca con el borde turquesa, el api morado adentro y el asa a la derecha. */
function tazaApi(D, { x, y, w, h }) {
  const asa = [];
  for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + Math.PI * i / 20; asa.push([x + w - 0.6 + Math.cos(a) * 4.4, y + h * 0.42 + Math.sin(a) * 4.6]); }
  for (let i = 20; i >= 0; i--) { const a = -Math.PI / 2 + Math.PI * i / 20; asa.push([x + w - 0.6 + Math.cos(a) * 2.2, y + h * 0.42 + Math.sin(a) * 2.5]); }
  forma(D, asa, C.blanco, { borde: 0.8, sombra: 1.1 });
  // El cuerpo: un poco más ancho arriba, con la base redondeada.
  const cuerpo = [[x, y], [x + w, y], [x + w - 1.2, y + h - 2.2], [x + w - 2.6, y + h], [x + 2.6, y + h], [x + 1.2, y + h - 2.2]];
  forma(D, cuerpo, C.blanco, { borde: 0.85, sombra: 1.3 });
  D.L.add(poli([[x + w - 3.2, y + 1.2], [x + w - 0.6, y + 1.2], [x + w - 1.6, y + h - 2.3], [x + w - 2.9, y + h - 0.6], [x + w - 4.2, y + h - 0.6]]), O.lozaSombra);
  // La boca de la taza: el borde turquesa y el api adentro, con un brillo.
  forma(D, elipse(x + w / 2, y, w / 2, 2.4), "turquesa", { borde: 0.75, masa: false });
  D.L.add(poli(elipse(x + w / 2, y + 0.25, w / 2 - 1.2, 1.55)), C.apiMorado);
  D.L.add(poli(elipse(x + w / 2 - 2.2, y - 0.1, 2.4, 0.5)), C.apiEspuma);
  // Una franja turquesa más abajo, como la de las tazas de mercado.
  D.L.add(poli([[x + 0.55, y + 3.0], [x + w - 0.55, y + 3.0], [x + w - 0.75, y + 4.1], [x + 0.75, y + 4.1]]), "turquesa");
}

/**
 * El pastel de queso: una media luna grande e inflada de masa dorada, con el repulgue a lo largo del borde curvo,
 * ampollas de la fritura y el azúcar impalpable encima. Un poco girado, como servido al lado de la taza.
 */
function pastel(D, { x, y, w, h, giro = -7 }) {
  const cx = x + w / 2, cy = y + h;
  girar(D, giro, [cx, cy - h / 2], () => {
    const pts = [];
    // El borde curvo, festoneado por el repulgue.
    for (let i = 0; i <= 96; i++) {
      const a = Math.PI + Math.PI * i / 96, r = 1 - 0.035 * Math.abs(Math.sin(i / 96 * Math.PI * 13));
      pts.push([cx + Math.cos(a) * w / 2 * r, cy + Math.sin(a) * h * r]);
    }
    // La base, apenas panzona.
    for (let i = 1; i < 16; i++) { const t = i / 16; pts.push([x + w - t * w, cy + Math.sin(Math.PI * t) * 1.0]); }
    forma(D, pts, C.pastel, { borde: 0.85, sombra: 1.3 });
    // El repulgue: una franja más oscura pegada al borde curvo, con sus pliegues.
    for (let i = 1; i < 26; i++) {
      const a = Math.PI + Math.PI * i / 26, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = 0.97, r1 = 0.83;
      D.L.add(poli([[cx + ca * w / 2 * r0, cy + sa * h * r0], [cx + Math.cos(a + 0.05) * w / 2 * r0, cy + Math.sin(a + 0.05) * h * r0], [cx + Math.cos(a + 0.03) * w / 2 * r1, cy + Math.sin(a + 0.03) * h * r1], [cx + Math.cos(a - 0.03) * w / 2 * r1, cy + Math.sin(a - 0.03) * h * r1]]), C.pastelOsc);
    }
    // Las ampollas de la fritura.
    for (const [u, v, r] of [[0.32, 0.55, 1.1], [0.62, 0.68, 0.9], [0.75, 0.5, 0.75], [0.45, 0.78, 0.7]]) D.L.add(poli(elipse(x + u * w, y + v * h, r * 1.3, r)), O.pastelClaro);
    // El azúcar impalpable: una nevada de puntitos, más tupida arriba.
    for (const [u, v] of [[0.36, 0.3], [0.44, 0.24], [0.52, 0.22], [0.6, 0.27], [0.68, 0.33], [0.4, 0.4], [0.48, 0.36], [0.56, 0.38], [0.64, 0.44], [0.3, 0.46], [0.74, 0.42], [0.5, 0.5], [0.58, 0.55], [0.42, 0.56], [0.24, 0.6], [0.8, 0.6], [0.66, 0.6], [0.35, 0.68], [0.52, 0.66]]) {
      D.L.add(rect(x + u * w - 0.42, y + v * h - 0.42, 0.84, 0.84), C.blanco);
    }
  });
}

/**
 * La cebra educadora vial de La Paz, de frente: el traje entero de rayas, la cabeza de cebra con las orejas, la crin y
 * el hocico negro, los ojos con brillo y las mejillas, guantes blancos y zapatos negros. Con una mano abierta muestra el
 * camino; la otra, en alto (CEBRA_MANO, aparte para que no se pegue a la cabeza), frena el tránsito con la palma.
 * k tinta, w blanco, p oreja, r mejilla, n nariz, s sombra del traje.
 */
const CEBRA = [
  "......kk....kk....",
  "......wp.kk.pw....",
  ".....wwpkkkkpww...",
  "....wwwwwkkwwwww..",
  "....wwkwwkkwwkww..",
  "....wkwwwwwwwwkw..",
  "....wwwwwwwwwwww..",
  "....kwwkwwwwwkwk..",
  "....kwkkwwwwkkwk..",
  ".....rwwwwwwwwr...",
  ".....wkkkkkkkkw...",
  ".....kkkkkkkkkk...",
  ".....kknkkkknkk...",
  "......kkkkkkkk....",
  "..wwwwwwwwwwwww...w.w",
  ".....wkkkkkkwwwwwkwwww",
  ".....wwwwwwwwwwwwkwww.",
  ".....wwwkkkkkkkw......",
  ".....wwwwwwwwwws......",
  ".....kkkkkkwwwws......",
  ".....wwwwwwwwwws......",
  ".....wwwkkkkkkkk......",
  "......www..www....",
  "......kkk..kkk....",
  "......www..www....",
  ".....kkkk..kkkk...",
];
/** El brazo en alto de la cebra, con el guante abierto. */
const CEBRA_MANO = ["w.w.", "wwww", "www.", "kk..", "ww..", "ww..", "kk..", "ww..", "ww..", "ww..", "kk..", "ww..", "ww..", "ww..", "kk..", "ww..", "ww.."];

// ───────────────────────── Oruro ─────────────────────────
/** Un fuego artificial en píxeles: ocho rayos y una chispa blanca al centro. */
const FUEGO = [
  "....x....",
  ".x..x..x.",
  "..x.x.x..",
  "...xxx...",
  "xxxxwxxxx",
  "...xxx...",
  "..x.x.x..",
  ".x..x..x.",
  "....x....",
];

/**
 * La q'urawa, la honda tejida de la llamerada, puesta al cuello como la llevan los bailarines: una vuelta de soga de
 * franjas de colores que cruza el cuello y dos puntas que vuelan hacia atrás con el baile, cada una con su borla de lana.
 * Gira con la llama.
 */
function honda(D, ll) {
  const { x, y, alto } = ll, k = alto / 26;
  const u = (a) => x + a * k, v = (b) => y + b * k;
  const colores = ["amarillo", "turquesa", "papel", "naranja"];
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    // Las dos puntas, de la nuca hacia atrás, onduladas, con su borla.
    const punta = (pts, borla) => {
      cordon(D, pts.map(([a, b]) => [u(a), v(b)]), { grosor: 1.05 * k, colores, largo: 1.5, borde: 0.5 });
      const [bx, by] = [u(pts[pts.length - 1][0]), v(pts[pts.length - 1][1])];
      for (const [dx, dy] of [[-1.9, -0.4], [-1.9, 0.7], [-1.4, 1.6]]) trazo(D, [[bx, by], [bx + dx, by + dy]], 0.8, "tinta", { masa: true });
      for (const [dx, dy, col] of [[-1.8, -0.4, "magenta"], [-1.8, 0.7, "amarillo"], [-1.3, 1.5, "turquesa"]]) trazo(D, [[bx, by], [bx + dx, by + dy]], 0.42, col);
      disco(D, bx, by, 1.3, borla, { borde: 0.5, sombra: 0.4 });
    };
    const ondas = (y0, sube, amp, fase, largo) => Array.from({ length: 21 }, (_, i) => { const t = i / 20; return [15.0 - t * largo, y0 - t * sube + amp * Math.sin(t * Math.PI * 1.6 + fase)]; });
    punta(ondas(8.8, 6.2, 0.9, 0.2, 11.6), "naranja");
    punta(ondas(10.2, 1.4, 0.8, 1.9, 10.2), "turquesa");
    // La vuelta al cuello: pasa por detrás (asoma a los costados) y por delante cae en una curva.
    cordon(D, [[u(19.2), v(9.6)], [u(19.9), v(8.6)], [u(19.4), v(7.9)]], { grosor: 0.95 * k, colores, largo: 1.0, borde: 0.5 });
    cordon(D, [[u(14.6), v(8.8)], [u(15.6), v(10.2)], [u(17.0), v(10.9)], [u(18.6), v(10.6)], [u(19.6), v(9.4)]], { grosor: 1.05 * k, colores, largo: 1.2, borde: 0.5 });
  });
}

/** Las serpentinas: una cinta ondulada de lado a lado del disco. */
function serpentina(D, { x0, y0, x1, y1, amp, vueltas, color, grosor = 0.85, fase = 0 }) {
  const pts = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t + amp * Math.sin(t * vueltas * 2 * Math.PI + fase);
    pts.push([x, y]);
  }
  trazo(D, pts, grosor, color);
}

/**
 * El quirquincho andino, vivo y redondito, mirando a la izquierda (hacia la llama): el caparazón de bandas con los pelos
 * claros que asoman arriba y le hacen una pollerita abajo, la cabecita con la oreja, el ojo con brillo, la mejilla y el
 * hocico largo con la nariz, cuatro patitas y la cola.
 * b caparazón, d bandas, h pelos, c cara, e oreja, r mejilla, l patas.
 */
const QUIRQUINCHO = espejo([
  "......h..h..h..h..........",
  "......dbbdbbdbbd..........",
  "...hbbdbbdbbdbbdbbh.......",
  "...dbbdbbdbbdbbdbbd.......",
  "..bdbbdbbdbbdbbdbbd.e.....",
  "..bdbbdbbdbbdbbdbbdbbb....",
  "..bdbbdbbdbbdbbdbbdcwkc...",
  "..bdbbdbbdbbdbbdbbdckkcc..",
  "dbbdbbdbbdbbdbbdbbdrccccck",
  "ddbdbbdbbdbbdbbdbbdccc....",
  "d.hhh.h.hh.hh.h.hhh.......",
  "....ll..ll......ll..ll....",
  "....lk..lk......lk..lk....",
]);

/** Las panojas de quinua: racimos tupidos de granitos, con su sombra. x color, X sombra. */
const PANOJA = [
  "..x.x..",
  ".xxxxx.",
  "xxXxXxx",
  ".xxxxx.",
  "xXxxxXx",
  "xxxXxxx",
  ".xXxxx.",
  "xxxxXxx",
  "x.xxxxx",
  "xXxXxx.",
  ".xxxxx.",
  "..xXx..",
  "...x...",
];
const PANOJA_CHICA = ["..x..", ".xxx.", "xXxXx", ".xxx.", "xxXxx", "xXxxx", ".xxX.", "xxxxx", ".xXx.", "..x.."];
const CORONA = ["a.a.a", "a.a.a", "aaaaa", "aaaaa", "aaaaa"];

// ───────────────────────── Potosí ─────────────────────────
/**
 * El Cerro Rico en pixel art: un cono ancho y solo, de cima apenas truncada y más rojiza, la cara de la derecha en sombra,
 * manchas ocres y grises del mineral y vetas claras que bajan. R rojizo, D sombra, C cima, v veta, O ocre, g y o gris.
 */
function cerroRico() {
  const W = 38, H = 19, c = 19;
  const g = Array.from({ length: H }, () => Array(W).fill("."));
  for (let r = 0; r < H; r++) {
    const hw = (r < 2 ? 3.2 + r * 0.6 : 3.6 + (r - 2) * 0.86) + (r % 5 === 3 ? 0.5 : 0);
    for (let x = Math.ceil(c - hw); x < Math.floor(c + hw); x++) g[r][x] = x >= c + 1 + r * 0.12 ? "D" : r < 3 ? "C" : "R";
  }
  const pon = (r, x, ch) => { if (g[r]?.[x] && g[r][x] !== ".") g[r][x] = ch; };
  for (const [r0, x0, w, h, ch] of [[6, 12, 3, 2, "O"], [11, 8, 4, 2, "g"], [14, 15, 3, 2, "O"], [9, 16, 2, 1, "g"], [8, 24, 3, 2, "o"], [13, 28, 3, 2, "o"], [16, 22, 2, 1, "o"]]) {
    for (let r = r0; r < r0 + h; r++) for (let x = x0; x < x0 + w; x++) pon(r, x, ch);
  }
  for (let r = 4; r < 18; r++) pon(r, Math.round(17 - (r - 4) * 0.5), "v");
  for (let r = 7; r < 18; r++) pon(r, Math.round(13 - (r - 7) * 0.6), "v");
  return g.map((f) => f.join(""));
}

/**
 * El flamenco de la Laguna Colorada, parado en una pata y mirando a la derecha: cuello en curva, ojo con brillo, pico
 * amarillo con la punta negra, el ala oscura con la punta negra, una pata derecha y la otra doblada.
 * f cuerpo, o ala, l pata, a pico.
 */
const FLAMENCO = [
  "....fff......",
  "...ffffaa....",
  "...fwffaaa...",
  "...fkff..aa..",
  "....ff....k..",
  "....f........",
  "...f.........",
  "...f.........",
  "...f.........",
  "....f........",
  ".....f.......",
  "......f......",
  "..fffff......",
  ".ffffffff....",
  "ffoooooff....",
  "kfooooooff...",
  "kkoooooooff..",
  ".kkkfffff....",
  "....l........",
  "....l.l......",
  "....lll......",
  "....l........",
  "....l........",
  "....l........",
  "....l........",
  "...ll........",
];

/** La llama echada y tranquila: el cuerpo largo, el cuello más corto y las patas dobladas debajo (en la cuadrícula de 22 por 26). */
const ECHADA_RELAJADA = [[2, 14, 17, 6.4], [15.5, 8, 4, 8], [14.5, 5, 8, 4], [20.5, 3, 2, 3], [3, 20.2, 4, 1.6], [9, 20.2, 4, 1.6], [14.6, 20.2, 4.2, 1.6], [0, 12.4, 3, 3.6]];

/**
 * La vizcacha de las rocas, de perfil y sentada al sol con el ojo cerrado de gusto: las orejas largas, la nariz, la
 * panza más clara y la cola larga enrulada hacia arriba con la punta oscura. Mira a la izquierda.
 * g pelaje, c claro, o oscuro, e oreja, r nariz.
 */
const VIZCACHA = [
  ".....o.o.......",
  ".....g.g.......",
  ".....e.g.......",
  ".....e.g.......",
  "....gggg.......",
  "...gggggg......",
  "..gkkggggg.....",
  ".ggggggggg...o.",
  "rggggggggg...oo",
  ".cccggggggg...o",
  "..ccgggggggg..g",
  "..cccgggggggg.g",
  "..cccggggggg..g",
  "..ccggggggg..gg",
  "...cggggggg.gg.",
  "...gg.ggggggg..",
];

// ───────────────────────── El Tinku ─────────────────────────
/**
 * La pareja del Tinku, de frente y bailando de la mano, con la otra mano abierta en alto. Él: la montera (el casco con la banda de
 * colores; el penacho se dibuja aparte, con plumas), la camisa blanca, el chaleco bordado, la faja, el pantalón de
 * bayeta hasta la pantorrilla y las abarcas. Ella: el sombrero blanco con plumitas y cintas que cuelgan, las trenzas,
 * la almilla oscura bordada de colores, la faja, el ruedo de franjas y las abarcas.
 * p montera y sombrero, P su sombra, f piel, h pelo, r mejilla, q boca, c chaleco, e bordado, b bayeta, d almilla.
 */
const BAILARIN = [
  ".....pppp.......",
  "....pppppP......",
  "...ppppppPP.....",
  "...mmaattnn.....",
  "..pppppppppp....",
  "...hffffffh.....",
  "...fwffffwf.....",
  "f..fkffffkf.....",
  "ff.rfqffqfr.....",
  ".w..ffqqff......",
  ".ww.wccccw......",
  "..wwcecceccwwwff",
  "....ccecccc...ff",
  "....cecceec.....",
  "....maatnma.....",
  "....bbbbbbb.....",
  "...bbbb.bbbb....",
  "..bbb.....bbb...",
  "..bbb.....bbb...",
  "..ff.......ff...",
  "..ff.......ff...",
  ".kkk.......kkk..",
];
const BAILARINA = [
  "......m.a.t.....",
  ".....pppppp.....",
  ".....mmaatt.....",
  "..pppppppppppp..",
  "..m.hffffffh.t..",
  "..m.hfwffwfh.t..",
  "..a.hfkffkfh.n.f",
  "...ahrqffqrhn.ff",
  "...vhhfqqfhha.d.",
  "....h.ffff.h.dd.",
  "ffdddtaanmddd...",
  "ff.dmddddadd....",
  "...ddtddmddd....",
  "...maatnmatm....",
  "..dddmdddtddd...",
  "..ddaddddddmdd..",
  ".ddddtdddaddddd.",
  ".mmmmmmmmmmmmmm.",
  ".aaaaaaaaaaaaaa.",
  ".....ff..ff.....",
  ".....ff..ff.....",
  "....kkk..kkk....",
];

/**
 * La faja tejida (chumpi) en pixel art: dos franjas a cada lado y una cadena de rombos de colores sobre tinta, con un
 * puntito blanco en el centro de cada uno. Genérica: no copia el diseño de ninguna comunidad.
 */
function chumpi(D, { x, y, rombos = 7, p = 1.05, colores = ["t", "a", "n", "v", "t", "a", "n"] }) {
  const W = rombos * 6 + 1;
  const franja = (c) => c.repeat(W);
  const fila = (f) => Array.from({ length: W }, (_, i) => f(i % 6, Math.floor(i / 6))).join("");
  const filas = [
    franja("m"),
    fila((c) => (c % 2 ? "a" : "m")),
    fila((c, r) => (c === 3 ? colores[r % colores.length] : "k")),
    fila((c, r) => (c >= 2 && c <= 4 ? (c === 3 ? "w" : colores[r % colores.length]) : c === 0 ? "a" : "k")),
    fila((c, r) => (c === 3 ? colores[r % colores.length] : "k")),
    fila((c) => (c % 2 ? "a" : "m")),
    franja("m"),
  ];
  return pixeles(D, filas, { x, y, p, borde: 0.8, sombra: 1.2 });
}

/**
 * Un penacho de plumas de colores que se abre en abanico desde (px, py): plumas largas, angostas en la base y anchas y
 * redondas en la punta, con su cañón. `echada` lo inclina (negativo, hacia atrás) y `ke` es la escala.
 */
function penacho(D, px, py, ke, { plumas = ["turquesa", "amarillo", C.blanco, "magenta", "naranja", C.blanco, "turquesa"], echada = -20, abanico = 15, largo = 9.4, ancho = 0.95, borde = 0.5, sombra = 0.4 } = {}) {
  const n = plumas.length;
  plumas.forEach((col, i) => {
    const m = i - (n - 1) / 2, ang = (echada + m * abanico) * Math.PI / 180;
    const L = (largo - Math.abs(m) * 0.75) * ke, W = ancho * ke, curva = 0.12 * m;
    const lado = (sg) => {
      const q = [];
      for (let j = 0; j <= 20; j++) {
        const t = j / 20, s0 = W * 1.2 * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.45)), 0.7);
        const lx = sg * s0 + curva * L * t * t, ly = -t * L;
        q.push([px + lx * Math.cos(ang) - ly * Math.sin(ang), py + lx * Math.sin(ang) + ly * Math.cos(ang)]);
      }
      return q;
    };
    forma(D, [...lado(-1), ...lado(1).reverse()], col, { borde, sombra });
    const tl = 0.82;
    trazo(D, [[px, py], [px + (curva * L * tl * tl) * Math.cos(ang) + tl * L * Math.sin(ang), py + (curva * L * tl * tl) * Math.sin(ang) - tl * L * Math.cos(ang)]], 0.26, "tinta");
  });
}

/**
 * La montera del Tinku como es: un casco duro de copa alta y redonda, como el casco antiguo que la inspiró, en crema,
 * con una banda de colores alrededor de la copa, el ala angosta levantada en la frente y en la nuca, y arriba un penacho
 * alto de plumas de colores que se abre en abanico y se va hacia atrás con el salto. `escala` la agranda desde la frente.
 */
export function monteraPenacho(D, ll, { escala = 1, ...plumas } = {}) {
  const { x, y, alto } = ll, k = alto / 26;
  const u = (a) => x + (18.2 + (a - 18.2) * escala) * k, v = (b) => y + (2 + (b - 2) * escala) * k, ke = k * escala;
  const cx = 18.2, base = 0.2, rx = 4.5, ry = 4.4;
  girar(D, ll.rot ?? 0, centroLlama(ll), () => {
    // El penacho, detrás de la copa.
    penacho(D, u(cx - 0.3), v(base - ry + 0.6), ke, plumas);
    // La copa: media cúpula alta, crema, con su sombra a la derecha.
    const copa = [];
    for (let i = 0; i <= 28; i++) { const a = Math.PI + Math.PI * i / 28; copa.push([u(cx + Math.cos(a) * rx), v(base + Math.sin(a) * ry)]); }
    forma(D, copa, C.montera, { borde: 0.7, sombra: 0.45 });
    const sombraCopa = [];
    for (let i = 18; i <= 28; i++) { const a = Math.PI + Math.PI * i / 28; sombraCopa.push([u(cx + Math.cos(a) * (rx - 0.05)), v(base + Math.sin(a) * (ry - 0.05))]); }
    sombraCopa.push([u(cx + rx * 0.45), v(base)]);
    D.L.add(poli(sombraCopa), C.monteraOsc);
    // Los adornos de la copa: una fila de lentejuelas de colores.
    [-2.6, -0.9, 0.8, 2.5].forEach((dx, i) => D.L.add(circulo(u(cx + dx), v(base - 3.3 + Math.abs(dx) * 0.12), 0.42 * ke), ["turquesa", "magenta", "amarillo", "naranja"][i]));
    // La banda de colores alrededor de la copa: bloques de la marca sobre tinta.
    const f0 = base - 2.1, f1 = base - 0.8, ancho = (b) => rx * Math.sqrt(1 - ((base - b) / ry) ** 2);
    const xa = cx - ancho(f0), xb = cx + ancho(f0);
    D.L.add(rect(u(xa), v(f0), (xb - xa) * ke, (f1 - f0) * ke), "tinta");
    const cols = ["magenta", "amarillo", "turquesa", "naranja"], m = 7, paso = (xb - xa) / m;
    for (let i = 0; i < m; i++) D.L.add(rect(u(xa + i * paso + 0.15), v(f0 + 0.2), (paso - 0.3) * ke, (f1 - f0 - 0.4) * ke), cols[i % 4]);
    // El ala, delante: angosta y rígida, levantada en la frente y en la nuca, con el borde marcado.
    const ala = [], nA = 24;
    for (let i = 0; i <= nA; i++) { const t = i / nA; ala.push([u(12.4 + 11.6 * t), v(base - 1.4 + 1.3 * Math.sin(Math.PI * t))]); }
    for (let i = nA; i >= 0; i--) { const t = i / nA; ala.push([u(12.4 + 11.6 * t), v(base - 0.6 + 1.6 * Math.sin(Math.PI * t))]); }
    forma(D, ala, C.montera, { borde: 0.65, sombra: 0.3 });
  });
}

// ───────────────────────── Los stickers ─────────────────────────
export const STICKERS = [
  {
    id: "lapaz-illimani",
    nombre: "Postal de La Paz",
    frase: ["Tinkazo en", "LA PAZ"],
    nota: "El Illimani, el nevado que cuida la ciudad, y las casitas de ladrillo de las laderas. La llama lleva chullo.",
    dibujar(D, frase) {
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "turquesa",
        paisaje(D) {
          illimani(D);
          ladera(D);
        },
        sombrero: chullo,
        delante(D) { brillo(D, 43, 2.5, 0.65, "amarillo"); },
      });
    },
  },
  {
    id: "lapaz-api",
    nombre: "API con pastel",
    frase: ["API con pastel"],
    nota: "El api morado con pastel, el desayuno de los mercados de La Paz y El Alto.",
    dibujar(D, frase) {
      // El vapor, la taza y el pastel delante, tan altos como la llama.
      vapor(D, 28.6, 2.2, 6.4, 0.4);
      vapor(D, 32.6, 1.0, 7.6, 2.2);
      vapor(D, 36.6, 2.6, 6.0, 1.2);
      tazaApi(D, { x: 24.5, y: 10.2, w: 15.5, h: 14.5 });
      pastel(D, { x: 19.5, y: 19.4, w: 25.5, h: 10.2 });
      llama(D, { x: 1.2, y: 4.2, alto: 26.5, contorno: 0.9, sombra: 1.4 });
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 44, fill: "amarillo", tamMax: 9, colorDe: (i) => (i < 3 ? C.apiMorado : null) });
    },
  },
  {
    id: "lapaz-cebra",
    nombre: "¡Siempre por la cebra!",
    frase: ["¡Siempre por", "la cebra!"],
    nota: "Las cebras educadoras viales de La Paz, que desde 2001 ayudan a cruzar la calle. Son patrimonio de la ciudad.",
    dibujar(D, frase) {
      // El paso de cebra: asfalto con cinco rayas blancas, de borde a borde.
      const y0 = 23.6, h0 = 7.4;
      bloque(D, { x: 0.8, y: y0, w: 48.4, h: h0, fill: C.asfalto, borde: 0.85, sombra: 1.3, radio: 0.8 });
      for (let i = 0; i < 5; i++) { const xa = 3.0 + i * 9.4; D.L.add(poli([[xa + 1.3, y0 + 0.85], [xa + 6.3, y0 + 0.85], [xa + 5.0, y0 + h0 - 0.85], [xa, y0 + h0 - 0.85]]), O.franjaBlanca); }
      // La cebra: primero el brazo en alto, después el cuerpo, así la mano no se pega a la cabeza.
      const p = 1.08, cx0 = 0.4, cy0 = -0.4;
      pixeles(D, CEBRA_MANO, { x: cx0, y: cy0 - 2 * p, p, borde: 0.75, sombra: 0 });
      pixeles(D, CEBRA, { x: cx0, y: cy0, p, col: { p: C.mejilla, r: C.mejilla, n: O.nariz, s: O.cebraSombra }, borde: 0.75, sombra: 1.1 });
      // La llama cruza de perfil, en paso de marcha: la mano de adelante levantada y la de atrás empujando.
      llamaEn(D, { x: 28.4, y: 6.2, alto: 21.5, pose: POSE.paso, contorno: 0.9, sombra: 1.4 });
      cinta(D, { lineas: frase, cx: 25, y: 31.4, ancho: 42, fill: "amarillo", tamMax: 9 });
    },
  },
  {
    id: "lapaz-totora",
    nombre: "¡A navegar!",
    frase: ["¡A navegar!"],
    nota: "Las balsas de totora del lago Titicaca, del lado boliviano, en Huatajata y la isla Suriqui.",
    dibujar(D, frase) {
      disco(D, 41.4, 4.0, 2.7, "amarillo", { borde: 0.7, sombra: 0.8 });
      // El mástil derecho, de la balsa hasta arriba, y la vela de esteras de totora colgada de su verga.
      bloque(D, { x: 9.6, y: 0.4, w: 1.5, h: 22.4, fill: C.maderaOsc, borde: 0.6, sombra: 0.7, radio: 0.5 });
      const vela = [[3.8, 3.2], [16.6, 3.2], [17.2, 11.2], [16.8, 19.4], [4.4, 19.4], [4.9, 11.2]];
      forma(D, vela, C.totora, { borde: 0.8, sombra: 1.1 });
      for (let i = 1; i < 8; i++) { const yy = 3.2 + i * 2.03; D.L.add(rect(4.7, yy - 0.17, 12.2, 0.34), C.totoraOsc); }
      D.L.add(rect(4.4, 3.9, 12.6, 0.9), O.totoraClara);
      bloque(D, { x: 2.6, y: 2.3, w: 15.4, h: 1.3, fill: C.maderaOsc, borde: 0.55, sombra: 0.5, radio: 0.6 });
      bloque(D, { x: 3.4, y: 18.7, w: 14.4, h: 1.2, fill: C.maderaOsc, borde: 0.55, sombra: 0.5, radio: 0.6 });
      olas(D, { x0: 2.5, x1: 47.5, y: 27.4, alto: 2.4, n: 4 });
      // La balsa: dos haces de totora en media luna, con la popa enrulada y la proa alta que termina en una cabeza de puma.
      const yc = (x) => 24.8 - 7.6 * Math.max(0, (x - 38) / 9) ** 1.6 - 6.2 * Math.max(0, (8.5 - x) / 6.5) ** 1.5;
      const grosor = (x) => 2.4 + 2.8 * Math.sin(Math.PI * Math.min(1, Math.max(0, (x - 2.2) / 43.6)));
      const top = [], bot = [], medio = [];
      for (let x = 2.2; x <= 45.8; x += 0.4) {
        top.push([x, yc(x) - grosor(x) * 0.55]); bot.push([x, yc(x) + grosor(x) * 0.55]); medio.push([x, yc(x) + 0.1]);
      }
      forma(D, [...top, ...bot.reverse()], C.totora, { borde: 0.85, sombra: 1.3 });
      // El haz de arriba con luz, la junta entre los dos haces y las ataduras de soga.
      const luz = top.slice(4, -6).map(([x, y]) => [x, y + 0.75]);
      trazo(D, luz, 0.7, O.totoraClara);
      trazo(D, medio.slice(3, -3), 0.4, C.totoraOsc);
      for (let x = 6.6; x <= 43; x += 3.6) {
        const y0 = yc(x) - grosor(x) * 0.55 + 0.25, y1 = yc(x) + grosor(x) * 0.55 - 0.25;
        for (const dx of [-0.35, 0.35]) trazo(D, [[x + dx - 0.25, y0], [x + dx + 0.25, y1]], 0.32, C.totoraOsc);
      }
      // La cabeza de puma en la proa, de perfil: dos orejas en punta, el ojo, la nariz y la boca.
      forma(D, [[44.0, 11.4], [44.6, 8.4], [46.2, 10.6]], C.totoraOsc, { borde: 0.55, sombra: 0 });
      forma(D, [[45.6, 10.8], [46.8, 8.0], [47.8, 10.8]], C.totora, { borde: 0.55, sombra: 0 });
      forma(D, [[43.4, 16.2], [43.4, 12.8], [44.4, 11.0], [46.4, 10.2], [48.0, 10.9], [48.7, 12.2], [49.4, 12.9], [49.4, 14.5], [48.4, 15.2], [47.2, 15.4], [46.2, 17.0], [44.6, 17.6]], C.totora, { borde: 0.75, sombra: 0.9 });
      D.L.add(poli([[48.7, 12.9], [49.4, 13.1], [49.4, 13.9], [48.9, 13.8]]), "tinta");
      D.L.add(poli(elipse(46.8, 12.5, 0.75, 0.42, 16, -12)), "tinta");
      trazo(D, [[47.6, 14.6], [49.0, 14.4]], 0.32, "tinta");
      trazo(D, [[44.2, 13.2], [44.8, 16.2]], 0.3, C.totoraOsc);
      llama(D, { x: 17.6, y: 0.8, alto: 21.4, contorno: 0.9, sombra: 1.3 });
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 38, fill: "naranja", tamMax: 9 });
    },
  },
  {
    id: "oruro-carnaval",
    nombre: "Postal de Oruro",
    frase: ["Tinkazo en", "ORURO"],
    nota: "El Carnaval de Oruro, Obra Maestra del Patrimonio Oral e Inmaterial de la Humanidad. La llama baila la llamerada, la danza de los pastores de llamas, con su honda tejida.",
    dibujar(D, frase) {
      const ll = { x: 8.5, y: 6.2, alto: 26, rot: -7 };
      postalEnPose(D, {
        pose: POSE.baile,
        de: frase[0], nombre: frase[1], colorNombre: "naranja", cielo: C.noche, llama: ll,
        paisaje(D) {
          serpentina(D, { x0: 6, y0: 27, x1: 45, y1: 19, amp: 1.4, vueltas: 2.6, color: "turquesa" });
          serpentina(D, { x0: 6, y0: 9, x1: 44, y1: 29, amp: 1.2, vueltas: 3, color: "amarillo", fase: 1.3 });
          pixeles(D, FUEGO, { x: 14.6, y: 3.6, p: 0.74, borde: 0, col: { x: "amarillo", w: "papel" } });
          pixeles(D, FUEGO, { x: 34.5, y: 9.5, p: 0.78, borde: 0, col: { x: "turquesa", w: "papel" } });
          pixeles(D, FUEGO, { x: 33.5, y: 20.5, p: 0.7, borde: 0, col: { x: "magenta", w: "papel" } });
          chispas(D, { semilla: 21, n: 14, area: [8, 3, 36, 28], evitar: [[16, 4, 18, 30], [10, 6.5, 9, 9], [33.5, 8.5, 9, 9], [32.5, 19.5, 8, 8]], lado: 1.15 });
        },
        sombrero: honda,
        delante(D) { brillo(D, 44, 3.5, 0.6, "amarillo"); },
      });
    },
  },
  {
    id: "oruro-sajama",
    nombre: "SAJAMA 6.542 m",
    frase: ["SAJAMA", "6.542 m"],
    nota: "El Sajama, el nevado más alto de Bolivia, con 6.542 metros, en el Parque Nacional Sajama, con sus bosques de queñua.",
    dibujar(D, frase) {
      // El cono: ancho, de laderas casi rectas que se abren abajo y la cima redondeada. El sol asoma por la derecha.
      const cx = 28.6, top = 3.6, base = 30.2, W = 23.5;
      const mitad = [[0, 0], [1.6, 0.25], [3.2, 1.0], [5, 2.6], [8, 6.6], [12, 12.8], [16, 18.8], [20, 23.6], [23.5, 26.6]];
      const perfil = (x) => {
        const d = Math.min(W, Math.abs(x - cx));
        for (let i = 0; i < mitad.length - 1; i++) {
          const [a0, b0] = mitad[i], [a1, b1] = mitad[i + 1];
          if (d >= a0 && d <= a1) return top + b0 + (b1 - b0) * (d - a0) / (a1 - a0);
        }
        return base;
      };
      disco(D, cx + 9.4, top + 4.6, 2.9, "amarillo", { borde: 0.7, sombra: 0.8 });
      const pts = [];
      for (let x = cx - W; x <= cx + W + 1e-9; x += 0.4) pts.push([x, perfil(x)]);
      forma(D, [...pts, [cx + W, base + 0.6], [cx - W, base + 0.6]], C.cerro, { borde: 0.85, sombra: 1.3 });
      // La cara en sombra, a la derecha de la cima.
      tiras(D, { x0: cx + 0.6, x1: cx + W - 0.3, arriba: perfil, abajo: () => base + 0.5, color: C.cerroOsc });
      // La nieve en la mitad de arriba, con dos lenguas que bajan.
      const linea = (x) => top + 11.2 + 0.9 * Math.sin(x * 1.4) + 5.2 * Math.exp(-(((x - (cx - 6.5)) / 1.5) ** 2)) + 4.4 * Math.exp(-(((x - (cx + 5.8)) / 1.3) ** 2));
      tiras(D, { x0: cx - W, x1: cx + 0.9, arriba: perfil, abajo: linea, color: C.nieve });
      tiras(D, { x0: cx + 0.7, x1: cx + W, arriba: perfil, abajo: linea, color: O.nieveSombra });
      // Las queñuas al pie: tronco retorcido y copa achatada por el viento.
      const queñua = (qx, qy, s) => {
        forma(D, [[qx - 0.8 * s, qy], [qx - 0.3 * s, qy - 2.0 * s], [qx - 1.6 * s, qy - 3.6 * s], [qx - 2.6 * s, qy - 4.0 * s], [qx - 2.2 * s, qy - 4.8 * s], [qx - 0.8 * s, qy - 4.2 * s], [qx + 0.2 * s, qy - 3.0 * s], [qx + 1.0 * s, qy - 4.6 * s], [qx + 2.4 * s, qy - 5.0 * s], [qx + 2.4 * s, qy - 4.2 * s], [qx + 1.3 * s, qy - 3.2 * s], [qx + 0.9 * s, qy - 1.6 * s], [qx + 1.0 * s, qy]], C["queñua"], { borde: 0.6, sombra: 0.7 });
        const copa = [];
        for (let i = 0; i <= 40; i++) { const a = Math.PI + Math.PI * i / 40; copa.push([qx + 0.2 * s + Math.cos(a) * 4.4 * s, qy - 5.0 * s + Math.sin(a) * 2.6 * s * (1 + 0.12 * Math.sin(i * 1.7))]); }
        copa.push([qx + 3.6 * s, qy - 4.3 * s], [qx - 3.2 * s, qy - 4.3 * s]);
        forma(D, copa, O.copaQueñua, { borde: 0.6, sombra: 0.7 });
        for (const [dx, dy, r] of [[-2.0, -6.0, 0.7], [0.0, -6.9, 0.8], [2.0, -6.1, 0.6]]) D.L.add(circulo(qx + dx * s, qy + dy * s, r * s), O.copaQueñuaClara);
      };
      queñua(5.0, 30.0, 1.05);
      queñua(46.0, 30.2, 1.05);
      // El pajonal de ichu al pie: matas de hojas finas, largas y desparejas, que se doblan hacia afuera.
      for (const [ix, iy, s, sem] of [[24.4, 30.8, 1.0, 0], [31.2, 30.6, 0.9, 2], [38.4, 30.4, 1.05, 1]]) {
        const hojas = [[-38, 3.2], [-20, 4.6], [-4, 3.6], [10, 5.0], [27, 3.9], [42, 2.9]].map(([a, L], i) => [a + ((i + sem) % 3) * 4, L * (1 + ((i * 7 + sem) % 3) * 0.08)]);
        const linea = ([a, L]) => {
          const r = a * Math.PI / 180, q = [];
          for (let j = 0; j <= 6; j++) { const t = j / 6, b = r * (0.55 + 0.6 * t); q.push([ix + Math.sin(b) * L * s * t, iy - Math.cos(b) * L * s * t]); }
          return q;
        };
        for (const h of hojas) trazo(D, linea(h), 1.25, "tinta", { masa: true });
        for (const h of hojas) trazo(D, linea(h), 0.45, O.ichu);
      }
      llama(D, { x: 6.8, y: 11.0, alto: 19.5, contorno: 0.9, sombra: 1.3, rot: -8 });
      const a = cinta(D, { lineas: [frase[0]], cx: 25, y: 31.2, ancho: 36, fill: "turquesa", tamMax: 10 });
      cinta(D, { lineas: [frase[1]], cx: 30, y: a.y1 + 0.5, ancho: 26, fill: "tarjeta", color: "tinta", tamMax: 6.5 });
    },
  },
  {
    id: "oruro-quirquincho",
    nombre: "Quirquincho de corazón",
    frase: ["Quirquincho", "de corazón"],
    nota: "A los orureños se les dice quirquinchos, por el quirquincho andino del altiplano. Este está vivo, sano y lo cuidamos.",
    dibujar(D, frase) {
      pixeles(D, QUIRQUINCHO, { x: 22.8, y: 15.6, p: 1.04, col: { b: C.caparazon, d: C.caparazonOsc, h: O.pelito, c: O.panza, e: O.orejaQuir, r: C.mejilla, l: C.caparazonOsc }, borde: 0.75, sombra: 1.1 });
      llama(D, { x: 0.8, y: 4.0, alto: 26, contorno: 0.9, sombra: 1.4, rot: 8 });
      pixeles(D, CORAZON, { x: 30.5, y: 2.4, p: 1.55, col: { r: C.corazon }, borde: 0.75, sombra: 1.0, rot: 8 });
      brillo(D, 42.5, 6.5, 0.6, "amarillo");
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 40, fill: "magenta", tamMax: 9 });
    },
  },
  {
    id: "oruro-quinua",
    nombre: "Quinua real",
    frase: ["Quinua real"],
    nota: "La quinua real del altiplano sur, de Oruro y de Potosí: el grano boliviano que conoce el mundo.",
    dibujar(D, frase) {
      // El tallo con sus dos ramas.
      const tallo = (pts, g) => { trazo(D, pts, g + 1.2, "tinta", { masa: true }); trazo(D, pts, g, O.tallo); };
      tallo([[35.6, 30.6], [35.8, 22], [35.9, 14.5]], 1.0);
      tallo([[35.8, 22.6], [32.6, 20.4], [29.6, 19.6]], 0.7);
      tallo([[35.8, 24.4], [39.4, 21.6], [42.2, 21.0]], 0.7);
      // Las hojas de pata de ganso: romboides, con los dos lóbulos y la punta.
      const hoja = (hx, hy, L, g) => {
        const forma0 = [[0, 0], [0.3, -0.18], [0.42, -0.42], [0.58, -0.3], [1, 0], [0.58, 0.3], [0.42, 0.42], [0.3, 0.18]];
        const pts = forma0.map(([px, py]) => [hx + L * (px * Math.cos(g) - py * Math.sin(g)), hy + L * (px * Math.sin(g) + py * Math.cos(g))]);
        forma(D, pts, C.hoja, { borde: 0.6, sombra: 0.7 });
        trazo(D, [[hx + L * 0.12 * Math.cos(g), hy + L * 0.12 * Math.sin(g)], [hx + L * 0.8 * Math.cos(g), hy + L * 0.8 * Math.sin(g)]], 0.3, C.vid);
      };
      hoja(35.8, 27.6, 6.2, -2.6);
      hoja(35.8, 26.2, 6.0, -0.45);
      hoja(35.9, 18.4, 4.4, -2.75);
      // Las tres panojas: la naranja arriba con su corona, la amarilla y la magenta en las ramas.
      pixeles(D, PANOJA_CHICA, { x: 26.6, y: 10.4, p: 1.08, rot: -10, col: { x: "amarillo", X: O.amarilloOsc }, borde: 0.7, sombra: 0.9 });
      pixeles(D, PANOJA_CHICA, { x: 40.0, y: 11.8, p: 1.08, rot: 10, col: { x: "magenta", X: O.magentaOsc }, borde: 0.7, sombra: 0.9 });
      pixeles(D, PANOJA, { x: 32.0, y: 2.2, p: 1.12, col: { x: "naranja", X: O.naranjaOsc }, borde: 0.75, sombra: 1.0 });
      pixeles(D, CORONA, { x: 33.6, y: -3.4, p: 1.0, rot: -16, borde: 0.6, sombra: 0.6 });
      // Un montoncito de granos de colores al pie.
      [[31.2, 29.6, "amarillo"], [32.6, 28.4, "naranja"], [33.6, 29.8, "magenta"], [38.4, 29.6, "naranja"], [39.6, 28.6, "amarillo"], [40.8, 29.8, "magenta"]].forEach(([gx, gy, col]) => pixeles(D, ["x"], { x: gx, y: gy, p: 1.0, col: { x: col }, borde: 0.45 }));
      llama(D, { x: 1.4, y: 4.4, alto: 26.2, contorno: 0.9, sombra: 1.4 });
      cinta(D, { lineas: frase, cx: 25, y: 31.2, ancho: 40, fill: "turquesa", tamMax: 9 });
    },
  },
  {
    id: "potosi-uyuni",
    nombre: "Postal de Potosí",
    frase: ["Tinkazo en", "POTOSÍ"],
    nota: "El Salar de Uyuni, el más grande del mundo. En época de lluvias se vuelve un espejo y la llama se ve reflejada en el cielo.",
    dibujar(D, frase) {
      const H = 15.4, ll = { x: 13.4, y: H - 17, alto: 17 };
      // Una nube de copos redondos (o su reflejo, dada vuelta).
      const nube = (nx, ny, s, abajo) => {
        const d = abajo ? -1 : 1;
        D.L.add([...circulo(nx - 2.6 * s, ny, 1.9 * s), ...circulo(nx, ny - 1.1 * s * d, 2.6 * s), ...circulo(nx + 2.7 * s, ny, 1.8 * s), ...rect(nx - 2.6 * s, abajo ? ny - 1.9 * s : ny, 5.3 * s, 1.9 * s)], C.blanco);
      };
      // El Tunupa, achatado en el horizonte, y su reflejo.
      const tunupa = [[28.6, 0], [31.6, -2.0], [34.6, -4.4], [37.0, -5.8], [39.2, -5.4], [41.8, -3.4], [45, 0]];
      postal(D, {
        de: frase[0], nombre: frase[1], colorNombre: "magenta", cielo: C.cielo, llama: ll,
        paisaje(D) {
          franjaDisco(D, { arriba: () => H, color: C.salar });
          nube(33.2, 6.4, 0.82, false);
          nube(33.2, 2 * H - 6.4, 0.82, true);
          D.L.add(poli(tunupa.map(([x, y]) => [x, H + y])), C.cerro);
          D.L.add(poli(tunupa.map(([x, y]) => [x, H - y]).reverse()), O.cerroReflejo);
          D.L.add(poli([[37.0, H - 5.8], [39.2, H - 5.4], [40.5, H - 4.4], [38.6, H - 4.5], [36.4, H - 4.6], [35.6, H - 5.0]]), C.nieve);
          llamaEn(D, { x: ll.x, y: H, alto: ll.alto, reflejo: true, contorno: 0, sombra: 0, color: C.reflejo });
          // La línea del horizonte, apenas marcada, y los brillos del agua.
          D.L.add(rect(6, H - 0.12, 38, 0.24), O.horizonte);
          for (const [rx, ry, w] of [[7.6, 22.6, 3.2], [32.2, 24.6, 4.4], [39.4, 26.6, 3], [9.6, 26.4, 2.4], [14.6, 24.2, 4.2], [21.4, 26.6, 5.2], [17.2, 28.6, 3.6]]) D.L.add(rect(rx, ry, w, 0.5), C.blanco);
        },
        delante(D) { brillo(D, 43, 3.2, 0.62, "amarillo"); },
      });
    },
  },
  {
    id: "potosi-flamencos",
    nombre: "Equilibrio de altura",
    frase: ["Equilibrio", "de altura"],
    nota: "Los flamencos de la Laguna Colorada, en la Reserva Eduardo Avaroa, al sur de Potosí. La llama los imita y levanta una pata.",
    dibujar(D, frase) {
      // Las lomas ocres al fondo, la orilla de bórax y la laguna roja.
      forma(D, [[4, 22], [9, 16.6], [14, 14.6], [19, 16.4], [24, 21], [24, 22.5], [4, 22.5]], C.ocre, { borde: 0.7, sombra: 0.8 });
      forma(D, [[25, 21.5], [31, 15.8], [36, 14.4], [41, 16.8], [46, 22], [46, 22.5], [25, 22.5]], C.ocre, { borde: 0.7, sombra: 0.8 });
      const laguna = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40; laguna.push([1.2 + 47.6 * t, 21.2 + 0.5 * Math.sin(t * Math.PI * 3)]); }
      for (let i = 0; i <= 40; i++) { const t = 1 - i / 40; laguna.push([1.2 + 47.6 * t, 30.4 + 1.1 * Math.sin(t * Math.PI)]); }
      forma(D, laguna, C.lagunaRoja, { borde: 0.85, sombra: 1.3 });
      // La orilla de bórax al fondo, en tramos sueltos, y los reflejos de los tres en el agua.
      for (const [x0, x1] of [[3.0, 9.6], [21.0, 29.0], [38.6, 46.8]]) {
        const q = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; q.push([x0 + (x1 - x0) * t, 22.0 + 0.3 * Math.sin(t * Math.PI * 2 + x0)]); }
        trazo(D, q, 0.9, "papel");
      }
      for (const [rx, w] of [[5.4, 1.3], [41.2, 1.3], [19.4, 2.6], [24.4, 2.6]]) D.L.add(rect(rx, 23.4, w, 4.6), O.lagunaOsc);
      // Las ondas del agua: tildes claras en filas, como el agua de los mapas.
      for (const [ox, oy] of [[3.2, 25.0], [11.6, 25.4], [29.8, 25.2], [37.4, 25.0], [44.0, 25.6], [7.0, 28.0], [15.2, 28.6], [33.8, 28.2], [40.6, 28.4]]) {
        const q = [];
        for (let i = 0; i <= 10; i++) { const t = i / 10; q.push([ox + 3.4 * t, oy - 0.45 * Math.sin(t * Math.PI * 2)]); }
        trazo(D, q, 0.62, C.lagunaOnda);
      }
      const col = { f: C.flamenco, o: C.flamencoOsc, l: O.flamencoPata, a: "amarillo" };
      pixeles(D, FLAMENCO, { x: 0.6, y: 3.0, p: 1.02, col, borde: 0.7, sombra: 0.9 });
      pixeles(D, espejo(FLAMENCO), { x: 36.2, y: 3.0, p: 1.02, col, borde: 0.7, sombra: 0.9 });
      llamaEn(D, { x: 14.6, y: 7.0, alto: 21.5, pose: POSE.manoArriba, rot: -3, contorno: 0.9, sombra: 1.3 });
      cinta(D, { lineas: frase, cx: 25, y: 30.4, ancho: 40, fill: "amarillo", tamMax: 9 });
    },
  },
  {
    id: "potosi-vales",
    nombre: "Vales un Potosí",
    frase: ["Vales un", "Potosí"],
    nota: "Vale un Potosí: el dicho que nació con la riqueza del Cerro Rico y que hasta Cervantes usó en El Quijote. Para regalárselo a quien vale muchísimo.",
    dibujar(D, frase) {
      // El Cerro Rico, y el corazón grande sobre la cima, con tres brillos alrededor.
      const p = 0.95, x0 = 12.6, y0 = 12.6, cx = x0 + 19 * p;
      pixeles(D, cerroRico(), { x: x0, y: y0, p, col: { R: O.cerroLuz, D: C.cerroRicoOsc, C: O.cimaRica, O: C.ocre, o: C.piedra, v: O.veta, g: C.piedra }, borde: 0.85, sombra: 1.3 });
      // El corazón grande sobre la cima, con tres brillos alrededor.
      pixeles(D, CORAZON, { x: cx - 3.5 * 1.85, y: 1.2, p: 1.85, col: { r: C.corazon }, borde: 0.8, sombra: 1.1 });
      brillo(D, cx - 7.8, 0.2, 0.6, "amarillo"); brillo(D, cx + 9.2, 1.0, 0.7, "amarillo"); brillo(D, cx + 11.2, 9.0, 0.55, "amarillo");
      llamaEn(D, { x: 1.2, y: 6.4, alto: 24, contorno: 0.9, sombra: 1.4, rot: -8 });
      cinta(D, { lineas: frase, cx: 25, y: 31.4, ancho: 38, fill: "magenta", tamMax: 9 });
    },
  },
  {
    id: "potosi-arbol",
    nombre: "Un ratito nomás",
    frase: ["Un ratito", "nomás"],
    nota: "El Árbol de Piedra del desierto de Siloli, en Sud Lípez, con una vizcacha tomando sol. Abajo, la llama descansa a la sombra.",
    dibujar(D, frase) {
      // El suelo de arena del desierto, con la sombra de la roca y dos piedras.
      forma(D, [[1.2, 31.4], [1.2, 28.6], [5, 27.4], [13, 26.9], [24, 27.2], [33, 26.7], [41, 27.0], [48.8, 28.4], [48.8, 31.4]], C.arena, { borde: 0.85, sombra: 1.3 });
      D.L.add(poli(elipse(22.5, 28.4, 13, 1.2)), O.arenaSombra);
      forma(D, [[4.6, 29.4], [5.4, 27.9], [7.2, 27.6], [8.4, 28.6], [7.8, 29.6]], O.piedrita, { borde: 0.5, sombra: 0.4 });
      forma(D, [[42.6, 29.2], [43.2, 28.0], [44.8, 27.8], [45.6, 29.0]], O.piedrita, { borde: 0.5, sombra: 0.4 });
      // El Árbol de Piedra: un cuello finito que se abre de golpe en una copa de roca abultada y de capas, con una
      // muesca arriba a la derecha donde se sienta la vizcacha.
      forma(D, [[32.0, 27.8], [32.9, 25.6], [33.3, 22.8], [32.6, 19.2], [36.0, 19.2], [35.4, 22.8], [35.6, 25.6], [36.8, 27.8]], C.ocre, { borde: 0.85, sombra: 1.2 });
      D.L.add(poli([[34.6, 19.8], [35.5, 19.8], [35.0, 22.8], [35.2, 25.6], [36.0, 27.4], [35.0, 27.4], [34.4, 25.6], [34.5, 22.8]]), C.ocreOsc);
      const copa = [[21.0, 14.8], [21.6, 12.6], [23.6, 11.4], [23.8, 9.2], [25.8, 7.4], [28.4, 5.8], [31.2, 5.0], [33.8, 5.4], [35.2, 7.2], [36.2, 9.4], [39.2, 9.8], [42.6, 9.6], [44.8, 10.4], [46.2, 12.2], [45.6, 14.2], [43.2, 15.2], [41.8, 17.4], [38.6, 18.8], [35.6, 19.8], [32.4, 19.6], [29.4, 18.0], [25.8, 16.8], [22.4, 16.2]];
      forma(D, copa, C.ocre, { borde: 0.85, sombra: 1.3 });
      // La panza en sombra y las capas de la roca.
      D.L.add(poli([[22.0, 15.4], [26.0, 15.6], [29.6, 16.8], [32.6, 18.2], [35.6, 18.4], [38.6, 17.2], [41.4, 15.8], [43.4, 14.0], [45.8, 13.4], [45.6, 14.2], [43.2, 15.2], [41.8, 17.4], [38.6, 18.8], [35.6, 19.8], [32.4, 19.6], [29.4, 18.0], [25.8, 16.8], [22.4, 16.2]]), C.ocreOsc);
      trazo(D, [[24.4, 10.2], [27.2, 9.6], [30.6, 9.0], [33.6, 9.4], [35.6, 10.8], [39.4, 11.4], [43.0, 11.4], [45.2, 12.0]], 0.42, C.ocreOsc);
      trazo(D, [[22.4, 13.2], [26.4, 12.6], [30.4, 13.2], [34.0, 13.6], [38.2, 14.0], [42.0, 13.4]], 0.42, C.ocreOsc);
      trazo(D, [[27.0, 7.4], [30.0, 6.8], [32.8, 7.0]], 0.38, C.ocreOsc);
      // La vizcacha en la muesca, al sol.
      pixeles(D, VIZCACHA, { x: 34.8, y: -1.9, p: 0.76, col: { g: C.vizcacha, c: O.vizcachaClara, o: O.vizcachaOsc, e: C.mejilla, r: C.mejilla }, borde: 0.55, sombra: 0.6 });
      // La llama, echada a la sombra de la roca, con el cuello relajado y las patas dobladas debajo.
      llamaEn(D, { x: 0.2, y: 10.2, alto: 21.6, pose: ECHADA_RELAJADA, contorno: 0.9, sombra: 1.3 });
      cinta(D, { lineas: frase, cx: 25, y: 31.0, ancho: 36, fill: "naranja", tamMax: 9 });
    },
  },
];

/**
 * Los dos del Tinku. Van aparte porque la serie ya tiene un tinku-montera (el de la primera muestra, con la montera
 * textil) en bolivia.mjs: dos con el mismo id frenan al corredor. Al sacar aquel, estos entran con `...TINKU`.
 */
export const TINKU = [
  {
    id: "tinku-montera",
    nombre: "Tinku es encuentro",
    frase: ["Tinku es", "encuentro"],
    nota: "Tinku quiere decir encuentro en quechua. Es la danza del norte de Potosí que se baila en las entradas de toda Bolivia: acá, la llama salta con su montera de plumas de colores.",
    dibujar(D, frase) {
      const yb = 28.4;
      chumpi(D, { x: 0.9, y: yb, p: 1.12 });
      const ll = { x: 14.6, y: 7.4, alto: 21.5, rot: -11 };
      llamaEn(D, { ...ll, pose: POSE.salto, contorno: 0.9, sombra: 1.4 });
      monteraPenacho(D, ll, { escala: 1.5, echada: -26, abanico: 14, largo: 8.8 });
      chispas(D, { semilla: 33, n: 13, area: [0, -4, 50, 32], evitar: [[10, -8, 30, 37]], lado: 1.6 });
      // La cinta tapa la parte de abajo de la faja: la faja queda como un chumpi detrás del cartel.
      cinta(D, { lineas: frase, cx: 25, y: yb + 4.6, ancho: 40, fill: "naranja", tamMax: 8 });
    },
  },
  {
    id: "tinku-pareja",
    nombre: "Nos encontramos bailando",
    frase: ["Nos", "encontramos", "bailando"],
    nota: "La pareja del Tinku en la entrada: él con su montera de plumas y el chaleco bordado, ella con su sombrero de cintas y la almilla bordada de flores. Bailan juntos, de la mano.",
    dibujar(D, frase) {
      const p = 1.08, y0 = 5.4;
      const col = { p: C.montera, P: C.monteraOsc, f: C.piel4, h: C.pelo, r: C.mejilla, q: O.boca, c: "turquesa", e: "amarillo", b: O.bayeta, d: O.almilla };
      // Él, a la izquierda, con el penacho de plumas sobre la montera; ella a la derecha. Van de la mano y los dos se
      // inclinan hacia el mismo lado, como cuando avanzan en la entrada.
      const xa = 6.0, xb = xa + 14 * p;
      girar(D, 3, [25, 18], () => {
        penacho(D, xa + 6.6 * p, y0 + 0.6 * p, 0.95, { echada: -6, abanico: 17, largo: 8.2, ancho: 1.0 });
        pixeles(D, BAILARIN, { x: xa, y: y0, p, col: { ...col, f: C.piel1 }, borde: 0.7, sombra: 1.0 });
        pixeles(D, BAILARINA, { x: xb, y: y0 + p, p, col: { ...col, f: C.piel4 }, borde: 0.7, sombra: 1.0 });
      });
      // Las notas de colores entre los dos.
      pixeles(D, NOTA, { x: 21.4, y: 1.0, p: 0.95, borde: 0.45, col: { k: "magenta" } });
      pixeles(D, NOTA, { x: 41.0, y: 3.4, p: 0.8, borde: 0.4, col: { k: "turquesa" } });
      cinta(D, { lineas: frase, cx: 25, y: 29.2, ancho: 43, fill: "magenta", tamMax: 8.5 });
    },
  },
];
