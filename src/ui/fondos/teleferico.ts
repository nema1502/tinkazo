/**
 * El fondo del Teleférico (`games/pixi/cablecar.ts`, `tres/teleferico-3d.ts`):
 * La Paz de noche, con el Illimani nevado detrás, el borde de El Alto lleno de
 * luces y la hoyada de casitas de ladrillo. Por el cielo cruzan dos líneas de
 * cable con sus cabinas de colores; la del medio, la ganadora, va prendida.
 *
 * Las cabinas y los cables van en la ventana libre de la foto del juego
 * (y = 250–540); abajo, detrás de los paneles y del QR, siguen las casitas y la
 * torre, que asoman a la derecha del nombre y en la tira de abajo.
 */

import { type Pincel, type Punto, ANCHO, ALTO, TINTA, SOMBRA, CREMA, AMARILLO, franja, poligono, caja, linea, ovalo, sembrado, oscuro, estrellas } from "./lapiz";

/** El acero de las torres, los cables y las mordazas. */
const ACERO = "#9aa1ad";
/** La ventana apagada de las cabinas y la prendida de la ganadora. */
const VIDRIO = "#3a3450";
const LUZ = "#fff1c4";
/** Las luces cálidas de las casas. */
const LUCES = ["#ffd38a", "#ffb35c", AMARILLO] as const;
/** El ladrillo visto de las casas de La Paz, de noche. */
const LADRILLOS = ["#7a3e2c", "#8f4a33", "#6a3527", "#9c5a3c", "#5c2f24"] as const;

/** Una línea de cable: de dónde a dónde cruza la foto. */
interface Linea {
  a: Punto;
  b: Punto;
}
/** La altura del cable en cada x. */
const sobre = (l: Linea, x: number): number => l.a[1] + ((x - l.a[0]) / (l.b[0] - l.a[0])) * (l.b[1] - l.a[1]);

/** La línea de adelante, la de la cabina ganadora, y la de atrás, más chica. */
const ADELANTE: Linea = { a: [0, 262], b: [ANCHO, 392] };
const ATRAS: Linea = { a: [0, 430], b: [ANCHO, 272] };

/** La luna llena arriba a la derecha, al lado del panel del título. */
function lunaPacena(p: Pincel): void {
  ovalo(p, 668, 92, 40, 40, "#f4ecd8", 5, 8);
  ovalo(p, 655, 81, 8, 8, "#ddd2bb");
  ovalo(p, 681, 106, 5, 5, "#ddd2bb");
}

/** La nieve de un pico, con el borde de abajo en zigzag. */
function nevado(p: Pincel, a: Punto, pico: Punto, b: Punto, k: number): void {
  const en = (q: Punto, f: number): Punto => [pico[0] + (q[0] - pico[0]) * f, pico[1] + (q[1] - pico[1]) * f];
  const i = en(a, k), d = en(b, k);
  const medio: Punto = [(i[0] + d[0]) / 2, (i[1] + d[1]) / 2 - 8];
  poligono(p, [pico, d, [(d[0] + medio[0]) / 2, (d[1] + medio[1]) / 2 + 14], medio, [(i[0] + medio[0]) / 2, (i[1] + medio[1]) / 2 + 14], i], CREMA, 3);
}

/** El Illimani: la mole de tres cumbres nevadas, a la derecha, y la cordillera baja que sigue. */
function illimani(p: Pincel): void {
  poligono(p, [[0, 520], [0, 372], [110, 344], [220, 366], [330, 330], [450, 362], [540, 352], [640, 520]], "#2e2a52", 4);
  const picos: Punto[] = [[470, 520], [560, 330], [640, 262], [700, 240], [760, 178], [820, 214], [880, 150], [940, 196], [1000, 168], [1050, 214], [1080, 232], [1080, 520]];
  poligono(p, picos, "#3b3563", 4);
  for (const i of [2, 4, 6, 8]) {
    const a = picos[i - 1], pico = picos[i], b = picos[i + 1];
    if (a && pico && b) nevado(p, a, pico, b, i === 2 ? 0.32 : 0.62);
  }
}

/** El borde de El Alto y la ladera de atrás: una franja oscura sembrada de lucecitas. */
function alto(p: Pincel): void {
  const borde = (x: number): number => 500 - 70 * ((x - 540) / 540) ** 2;
  const pts: Punto[] = [];
  for (let x = 0; x <= ANCHO; x += 60) pts.push([x, borde(x)]);
  poligono(p, [...pts, [ANCHO, ALTO], [0, ALTO]], "#231f3e", 4);
  const azar = sembrado(0x7e1e);
  for (let i = 0; i < 140; i++) {
    const x = 8 + azar() * (ANCHO - 20);
    const y = borde(x) + 8 + azar() * 70;
    const s = 3 + azar() * 3;
    caja(p, x, y, s, s, LUCES[i % 3] as string);
  }
}

/** Una casita de La Paz: ladrillo, techo plano con parapeto, una o dos ventanas prendidas. */
function casita(p: Pincel, x: number, base: number, w: number, h: number, color: string, azar: () => number): void {
  caja(p, x, base - h, w, h, color, 3);
  caja(p, x - 3, base - h - 6, w + 6, 8, oscuro(color, 0.7), 3);
  const n = w > 60 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const vx = x + ((k + 1) * w) / (n + 1) - 7;
    const prendida = azar() < 0.7;
    caja(p, vx, base - h + 12, 14, 16, prendida ? (LUCES[Math.floor(azar() * 3)] as string) : "#2b2026", 2.5);
  }
  if (h > 52) caja(p, x + w / 2 - 8, base - 22, 16, 22, TINTA);
}

/** La hoyada: filas de casitas que bajan, más altas en las laderas de los costados. */
function hoyada(p: Pincel): void {
  const azar = sembrado(0x1a9a2);
  const ladera = (x: number): number => -80 * ((x - 540) / 540) ** 2;
  for (let fila = 0, base = 586; base < ALTO + 60; fila++, base += 58) {
    const lejos = fila === 0 ? 0.62 : fila === 1 ? 0.8 : 1;
    for (let x = fila % 2 ? -30 : -6; x < ANCHO; ) {
      const w = 46 + Math.floor(azar() * 36);
      const h = 40 + Math.floor(azar() * 26);
      const y = Math.min(ALTO - 2, base + ladera(x + w / 2));
      const color = oscuro(azar() < 0.1 ? franja(Math.floor(azar() * 5)) : (LADRILLOS[Math.floor(azar() * LADRILLOS.length)] as string), lejos);
      const x0 = Math.max(2, x), x1 = Math.min(ANCHO - 2, x + w);
      if (x1 - x0 > 30) casita(p, x0, y, x1 - x0, h, color, azar);
      x += w + 4 + Math.floor(azar() * 10);
    }
  }
}

/** Una torre de reticulado: las dos patas, las cruces, la cruceta amarilla y las poleas arriba. */
function torre(p: Pincel, x: number, arriba: number, base: number, u: number): void {
  const ab = 14 * u, ap = 50 * u;
  poligono(p, [[x - ab, arriba], [x + ab, arriba], [x + ap, base], [x - ap, base]], "#4a4566", 4 * u, 7 * u);
  const tramos = 6;
  for (let k = 0; k < tramos; k++) {
    const y0 = arriba + ((base - arriba) * k) / tramos, y1 = arriba + ((base - arriba) * (k + 1)) / tramos;
    const m0 = ab + (ap - ab) * (k / tramos), m1 = ab + (ap - ab) * ((k + 1) / tramos);
    linea(p, [[x - m0, y0], [x + m1, y1]], ACERO, 3 * u);
    linea(p, [[x + m0, y0], [x - m1, y1]], ACERO, 3 * u);
    linea(p, [[x - m1, y1], [x + m1, y1]], TINTA, 3 * u);
  }
  caja(p, x - 62 * u, arriba - 8 * u, 124 * u, 16 * u, AMARILLO, 4 * u, 5 * u);
  for (const s of [-1, 1]) ovalo(p, x + s * 40 * u, arriba - 10 * u, 11 * u, 11 * u, ACERO, 3 * u);
}

/** Los dos cables de una línea, de acero con su borde de tinta, para que se vean contra el cielo. */
function cables(p: Pincel, l: Linea, u: number): void {
  for (const dy of [0, 14 * u]) {
    const pts: Punto[] = [[l.a[0], l.a[1] + dy], [l.b[0], l.b[1] + dy]];
    linea(p, pts, TINTA, 9 * u);
    linea(p, pts, ACERO, 3.5 * u);
  }
}

/** Una chispa de cuatro puntas. */
function chispa(p: Pincel, x: number, y: number, r: number, color: string): void {
  poligono(p, [[x, y - r], [x + r * 0.28, y - r * 0.28], [x + r, y], [x + r * 0.28, y + r * 0.28], [x, y + r], [x - r * 0.28, y + r * 0.28], [x - r, y], [x - r * 0.28, y - r * 0.28]], color, 2.5);
}

/**
 * Una cabina colgada del cable en `x`: la mordaza, el brazo, el cuerpo de
 * color con las esquinas cortadas, la ventana y la franja crema. La ganadora
 * lleva la ventana prendida con gente adentro, un contorno amarillo y chispas.
 */
function cabina(p: Pincel, l: Linea, x: number, u: number, color: string, ganadora = false): void {
  const yc = sobre(l, x);
  const w = 100 * u, h = 84 * u, e = 12 * u;
  const y0 = yc + 30 * u;
  const cuerpo = (m: number): Punto[] => [
    [x - w / 2 - m + e, y0 - m], [x + w / 2 + m - e, y0 - m], [x + w / 2 + m, y0 - m + e], [x + w / 2 + m, y0 + h + m - e],
    [x + w / 2 + m - e, y0 + h + m], [x - w / 2 - m + e, y0 + h + m], [x - w / 2 - m, y0 + h + m - e], [x - w / 2 - m, y0 - m + e],
  ];
  if (ganadora) poligono(p, cuerpo(13 * u), AMARILLO, 4 * u, 8 * u);
  linea(p, [[x, yc], [x, y0 - 6 * u]], TINTA, 6 * u);
  caja(p, x - 12 * u, yc - 8 * u, 24 * u, 15 * u, ACERO, 3 * u);
  caja(p, x - 30 * u, y0 - 10 * u, 60 * u, 12 * u, oscuro(color, 0.65), 3 * u);
  poligono(p, cuerpo(0), color, 4 * u, ganadora ? 0 : 8 * u);
  const vx = x - w / 2 + 10 * u, vy = y0 + 12 * u, vw = w - 20 * u, vh = 40 * u;
  caja(p, vx, vy, vw, vh, ganadora ? LUZ : VIDRIO, 3 * u);
  if (ganadora) {
    for (const [dx, r] of [[0.22, 8], [0.5, 9.5], [0.78, 8]] as const) {
      const cx = vx + vw * dx;
      poligono(p, [[cx - r * 1.5 * u, vy + vh], [cx - r * 1.1 * u, vy + vh - r * 1.4 * u], [cx + r * 1.1 * u, vy + vh - r * 1.4 * u], [cx + r * 1.5 * u, vy + vh]], TINTA);
      ovalo(p, cx, vy + vh - r * 2.3 * u, r * u, r * u, TINTA);
    }
  } else {
    caja(p, vx + vw - 16 * u, vy + 6 * u, 8 * u, 8 * u, "#ffd38a");
  }
  linea(p, [[x, vy], [x, vy + vh]], TINTA, 3 * u);
  caja(p, x - w / 2, y0 + 60 * u, w, 9 * u, CREMA, 3 * u);
  if (ganadora) {
    chispa(p, x - w / 2 - 34 * u, y0 + 6 * u, 15 * u, AMARILLO);
    chispa(p, x + w / 2 + 32 * u, y0 + 30 * u, 13 * u, CREMA);
    chispa(p, x + w / 2 + 22 * u, y0 - 18 * u, 9 * u, AMARILLO);
    chispa(p, x - w / 2 - 22 * u, y0 + h, 9 * u, CREMA);
  }
}

/**
 * Teleférico: el Illimani y la hoyada de La Paz de noche, dos líneas de cable
 * que se cruzan en el cielo y tres cabinas en la de adelante; la del medio, la
 * ganadora, prendida. Todo eso cabe en y = 250–540.
 */
export function fondoTeleferico(p: Pincel): void {
  estrellas(p, 0x7e1ef, 44, 24, 300);
  lunaPacena(p);
  illimani(p);
  alto(p);
  torre(p, 250, sobre(ATRAS, 250), 600, 0.7);
  cables(p, ATRAS, 0.7);
  cabina(p, ATRAS, 330, 0.62, franja(1));
  cabina(p, ATRAS, 900, 0.62, franja(2));
  hoyada(p);
  torre(p, 760, sobre(ADELANTE, 760), 840, 1);
  cables(p, ADELANTE, 1);
  cabina(p, ADELANTE, 160, 1.1, franja(3));
  cabina(p, ADELANTE, 520, 1.4, franja(0), true);
  cabina(p, ADELANTE, 965, 1.1, franja(4));
}
