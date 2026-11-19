/**
 * El Litoral, el departamento con mar que Bolivia perdió y que sigue en el corazón de todo el país. Dos postales con el
 * mismo disco: el océano Pacífico al atardecer visto desde la orilla, con el sol medio hundido, el acantilado a un
 * costado, dos gaviotas y la llama de pie mirando el mar con su gorra blanca de marinero.
 *
 *   litoral-mar     Volveremos al MAR, el principal
 *   litoral-postal  Tinkazo en el LITORAL, como el décimo departamento de la serie
 *
 * Es cariño por el mar y esperanza: el sello con la bandera de Bolivia arriba, y nada más de banderas, ni mapas, ni nombres de países, ni nada que sea de guerra.
 */
import { rect, circulo, poli } from "../base.mjs";
import { pixeles, forma, girar, centroLlama, brillo, CORAZON } from "../pincel.mjs";
import { C as C0, postal, franjaDisco, tiras } from "./comun.mjs";

/** La paleta de la serie más los tonos del atardecer en el mar y el azul marino de la cinta y la gorra. */
const C = {
  ...C0,
  azulMarino: "#1f3d8c",
  cieloRosa: "#ff9fbf", cieloNaranja: "#ff9a4d", solHalo: "#ffe39a", solMar: "#fff8e1",
  marHondo: "#2457b0", marAzul: "#2f8fd8", ola: "#ffffff",
  arena: "#f0d29a",
  roca: "#94473a", rocaOsc: "#73352c", rocaLuz: "#c9654a",
  gorraSombra: "#d6e0ee",
};

/** La línea del horizonte, donde se hunde el sol. */
const HORIZONTE = 17.4;
/** El sol: medio hundido en el mar, a la derecha de la cabeza de la llama, con su halo. */
const SOL = { cx: 36.8, r: 4.5, halo: 6.0 };

/** Una curva por tramos rectos: la altura en `x` entre los puntos [x, y] dados (afuera, la del extremo). */
function perfil(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (x <= bx) return ay + (by - ay) * (x - ax) / (bx - ax);
    }
    return pts[pts.length - 1][1];
  };
}

/** La gaviota en vuelo, de lejos y contra el sol: la silueta de alas abiertas, en tinta. */
const GAVIOTA = [
  ".kkk.....kkk.",
  "k...kk.kk...k",
  ".....kkk.....",
];

/**
 * El Pacífico al atardecer, visto desde la orilla: el cielo en franjas planas (rosado, naranja y amarillo), el sol medio
 * hundido con su halo, el mar en franjas de azul hondo, azul y turquesa con rayitas de olas y el reflejo del sol en
 * píxeles, la playa donde está parada la llama, el acantilado a la izquierda y las gaviotas. Va adentro del disco: se
 * recorta solo.
 */
function pacifico(D) {
  franjaDisco(D, { arriba: () => 7.4, color: C.cieloNaranja });
  franjaDisco(D, { arriba: () => 11.4, color: "amarillo" });
  // El sol con su halo, y el mar encima que los tapa a medias.
  D.L.add(circulo(SOL.cx, HORIZONTE, SOL.halo), C.solHalo);
  D.L.add(circulo(SOL.cx, HORIZONTE, SOL.r), C.solMar);
  franjaDisco(D, { arriba: () => HORIZONTE, color: C.marHondo });
  franjaDisco(D, { arriba: () => HORIZONTE + 2.4, color: C.marAzul });
  franjaDisco(D, { arriba: () => HORIZONTE + 6.0, color: "turquesa" });
  // El reflejo del sol en el agua: filas de píxeles que se angostan hacia la orilla y titilan, cortadas y corridas.
  const reflejo = [
    [0.7, C.solMar, [[-3.9, 4.6], [1.3, 2.6]]],
    [2.0, "amarillo", [[-2.2, 5.6]]],
    [3.3, C.solMar, [[-2.8, 1.8], [-0.4, 3.0]]],
    [4.7, "amarillo", [[-1.3, 3.4]]],
    [6.2, C.solMar, [[-1.8, 1.3], [0.1, 1.5]]],
    [7.8, "amarillo", [[-0.5, 1.4]]],
  ];
  for (const [dy, col, tramos] of reflejo) for (const [dx, w] of tramos) D.L.add(rect(SOL.cx + dx, HORIZONTE + dy, w, 0.75), col);
  // Las rayitas blancas de las olas.
  for (const [x, y, w] of [[29.6, 19.0, 2.0], [40.0, 20.2, 1.6], [30.4, 22.0, 2.6], [40.4, 23.8, 1.8], [31.2, 25.6, 2.2], [37.6, 27.4, 2.4]]) D.L.add(rect(x, y, w, 0.6), C.ola);
  // La playa: la arena donde pisa la llama y la espuma blanca de la orilla, que baja hacia la derecha.
  const orilla = (x) => 25.2 + Math.max(0, (x - 27.5) / 7.5) ** 2 * 6;
  tiras(D, { x0: 6, x1: 44, arriba: (x) => orilla(x) - 0.9 + 0.3 * Math.sin(x * 1.3), abajo: (x) => orilla(x) + 0.2, color: C.ola });
  franjaDisco(D, { arriba: orilla, color: C.arena });
  // El acantilado de la costa, a la izquierda: la meseta arriba y la pared que baja hasta la playa.
  const roca = perfil([[5, 12.9], [9.0, 12.4], [11.6, 12.8], [13.6, 12.6], [15.0, 13.3], [15.8, 14.6], [16.6, 16.0], [17.4, 17.4], [18.0, 19.2], [19.2, 21.8], [20.2, 25.4], [20.6, 40]]);
  franjaDisco(D, { arriba: roca, color: C.roca, x1: 20.6 });
  // Una capa de la roca y la luz del sol en el borde de la meseta y en la pared que da al mar.
  tiras(D, { x0: 5, x1: 20.6, arriba: (x) => Math.max(roca(x) + 0.4, 15.4), abajo: (x) => 16.0 + 0.25 * Math.sin(x * 0.9), color: C.rocaOsc });
  tiras(D, { x0: 5, x1: 20.6, arriba: roca, abajo: (x) => Math.max(roca(x) + 0.55, roca(x + 1.5)), color: C.rocaLuz });
  // Las dos gaviotas: una grande sobre el mar y otra más lejos, sobre el acantilado.
  pixeles(D, GAVIOTA, { x: 32.8, y: 9.0, p: 0.52, borde: 0 });
  pixeles(D, GAVIOTA, { x: 12.2, y: 9.2, p: 0.44, borde: 0 });
}

/**
 * La punta de una cinta que flamea, de `desde` a `hasta` y de `ancho`, con una onda que crece hacia el extremo. Devuelve
 * el polígono, con el corte en punta de golondrina al final.
 */
function puntaCinta(desde, hasta, ancho, onda = 0.4, fase = 0) {
  const n = 12, medio = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    medio.push([desde[0] + (hasta[0] - desde[0]) * t, desde[1] + (hasta[1] - desde[1]) * t + Math.sin(t * Math.PI * 1.5 + fase) * onda * t]);
  }
  const izq = [], der = [];
  medio.forEach((p, i) => {
    const q = medio[Math.min(i + 1, n)], o = medio[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1;
    izq.push([p[0] - dy / L * ancho / 2, p[1] + dx / L * ancho / 2]);
    der.push([p[0] + dy / L * ancho / 2, p[1] - dx / L * ancho / 2]);
  });
  // La punta de golondrina: un piquito hacia adentro en el extremo.
  const fin = medio[n], antes = medio[n - 1], dx = fin[0] - antes[0], dy = fin[1] - antes[1], L = Math.hypot(dx, dy) || 1;
  const muesca = [fin[0] - dx / L * ancho * 0.7, fin[1] - dy / L * ancho * 0.7];
  return [...izq, muesca, ...der.reverse()];
}

/**
 * La gorra blanca de marinero de la llama, sin visera: la copa redonda y ancha, más ancha que la cinta, la cinta azul
 * marino alrededor de la cabeza y sus dos puntas, que flamean hacia atrás con la brisa del mar. Como los demás sombreros
 * de la serie, se pone sobre la llama `ll` y gira con ella. `escala` la agranda desde la frente e `inclinada` la echa un
 * poco hacia atrás, como se lleva.
 */
function gorraMarinera(D, ll, { escala = 1.1, inclinada = -6 } = {}) {
  const { x, y, alto } = ll, k = alto / 26;
  const u = (a) => x + (18.2 + (a - 18.2) * escala) * k, v = (b) => y + (2 + (b - 2) * escala) * k, ke = k * escala;
  const P = (pts) => pts.map(([a, b]) => [u(a), v(b)]);
  girar(D, ll.rot ?? 0, centroLlama(ll), () => girar(D, inclinada, [u(18.3), v(2.2)], () => {
    // Las dos puntas de la cinta, detrás de todo: salen de la nuca y flamean hacia atrás.
    forma(D, puntaCinta([u(14.8), v(0.9)], [u(9.6), v(2.4)], 1.1 * ke, 0.55, 0.3), C.azulMarino, { borde: 0.55, sombra: 0.3 });
    forma(D, puntaCinta([u(14.8), v(1.6)], [u(10.4), v(4.4)], 1.1 * ke, 0.5, 1.6), C.azulMarino, { borde: 0.55, sombra: 0.3 });
    // La cinta azul alrededor de la cabeza.
    forma(D, P([[14.1, 0.2], [22.4, 0.2], [22.4, 2.3], [14.1, 2.3]]), C.azulMarino, { borde: 0.6, sombra: 0.4 });
    // La copa: redonda y ancha, más ancha que la cinta y angosta abajo, donde se apoya. Blanca arriba y con la sombra
    // de la parte de abajo, la que cae sobre la cinta.
    const copa = P([[14.3, 0.6], [13.2, 0.25], [12.7, -0.45], [12.8, -1.2], [13.5, -1.9], [15.0, -2.55], [17.0, -2.9], [19.6, -2.95], [21.8, -2.65], [23.3, -1.95], [24.0, -1.15], [23.9, -0.4], [23.3, 0.25], [22.2, 0.6]]);
    forma(D, copa, C.gorraSombra, { borde: 0.6, sombra: 0.4 });
    D.L.add(poli(P([[12.75, -0.55], [12.8, -1.2], [13.5, -1.9], [15.0, -2.55], [17.0, -2.9], [19.6, -2.95], [21.8, -2.65], [23.3, -1.95], [24.0, -1.15], [23.95, -0.55]])), C.blanco);
  }));
}

/** Los puntos de un círculo, para dibujarlo con su borde y su sombra. */
function circuloPts(cx, cy, r, n = 40) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
}

/** La franja de un círculo entre las alturas `y0` y `y1`: la cuerda de arriba, el arco del costado y la de abajo. */
function franjaCirculo(cx, cy, r, y0, y1, n = 16) {
  const lado = (y) => Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));
  const izq = [], der = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    izq.push([cx - lado(y), y]);
    der.push([cx + lado(y), y]);
  }
  return [...izq, ...der.reverse()];
}

/**
 * El sello de la bandera de Bolivia: un disco con las tres franjas, roja, amarilla y verde, de igual alto, con el borde de
 * tinta, la sombra dura de la serie y un brillo. Va arriba a la izquierda, saliendo un poco del disco, como el corazón o
 * el brillo del otro lado.
 */
function selloBolivia(D, { cx = 9.4, cy = 5.2, r = 4.4 } = {}) {
  forma(D, circuloPts(cx, cy, r), C.rojoBo, { borde: 0.7, sombra: 0.8 });
  const tercio = (2 * r) / 3;
  D.L.add(poli(franjaCirculo(cx, cy, r, cy - r + tercio, cy - r + 2 * tercio)), C.amarilloBo);
  D.L.add(poli(franjaCirculo(cx, cy, r, cy - r + 2 * tercio, cy + r)), C.verdeBo);
  D.L.add(rect(cx - r * 0.55, cy - r * 0.62, r * 0.32, 0.5), C.blanco);
}

/** El disco de las dos postales del Litoral, con la llama marinera. `de` y `nombre` van en las cintas. */
function postalLitoral(D, { de, nombre, tamNombre, delante }) {
  postal(D, {
    de, nombre, colorNombre: C.azulMarino, letras: "papel", cielo: C.cieloRosa, tamNombre,
    paisaje(D) { pacifico(D); },
    sombrero: gorraMarinera,
    delante,
  });
}

/**
 * La hoja A4 del Litoral, aparte de las del plan: seis de cada uno en damero, del tamaño mayor que entra (6 cm o más,
 * como las demás A4), con el mismo troquel, sangrado y capa de corte.
 */
export const HOJA = {
  ancho: 210, alto: 297, cols: 3, cm: 6, fijo: true,
  ids: Array.from({ length: 12 }, (_, i) => ((Math.floor(i / 3) + (i % 3)) % 2 ? "litoral-postal" : "litoral-mar")),
};

export const STICKERS = [
  {
    id: "litoral-mar",
    nombre: "Volveremos al mar",
    frase: ["Volveremos al", "MAR"],
    nota: "El Litoral fue el departamento con mar de Bolivia, y el mar sigue en el corazón de todo el país. La llama marinera lo mira al atardecer, con cariño y esperanza.",
    dibujar(D, frase) {
      postalLitoral(D, {
        de: frase[0], nombre: frase[1], tamNombre: 13,
        delante(D) { pixeles(D, CORAZON, { x: 39.2, y: 1.2, p: 1.0, col: { r: C.corazon }, borde: 0.6, sombra: 0.8 }); selloBolivia(D); },
      });
    },
  },
  {
    id: "litoral-postal",
    nombre: "Postal del Litoral",
    frase: ["Tinkazo en el", "LITORAL"],
    nota: "La postal del Litoral, el departamento con mar de Bolivia: el océano Pacífico al atardecer, visto desde la orilla. La llama lleva su gorra de marinero.",
    dibujar(D, frase) {
      postalLitoral(D, {
        de: frase[0], nombre: frase[1],
        delante(D) { brillo(D, 43, 2.5, 0.65, "amarillo"); selloBolivia(D); },
      });
    },
  },
];
