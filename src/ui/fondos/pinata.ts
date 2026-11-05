/**
 * El fondo de la piñata para la foto del juego: la estrella de siete picos de
 * `games/pixi/pinata.ts`, colgada de una soga en un patio de fiesta de noche,
 * con papel picado arriba, globos, el palo que le pega y los caramelos que
 * salen volando por la rajadura y se apilan en el piso.
 *
 * La piñata entera (la olla, los picos y sus flecos), el golpe y los caramelos
 * en el aire van en la ventana libre de la foto, y = 250–540. Detrás del panel
 * del nombre quedan el chico con los ojos vendados y el palo; a la derecha de
 * ese panel asoman los caramelos que caen y el montón del piso.
 */

import { type Pincel, type Punto, ANCHO, ALTO, TINTA, SOMBRA, CREMA, AMARILLO, franja, caja, poligono, ovalo, linea, sembrado, oscuro, estrellas, confeti, papelPicado } from "./lapiz";

const PARED = "#2a1d33";
const PISO = 700;
/** La piñata: el centro de la olla y su radio. Los picos llegan a 1,75 radios y los flecos cuelgan 0,35 más. */
const OLLA = { x: 700, y: 386, r: 76 } as const;
const PALO = "#a0703f";
const PIEL = "#c68a5c";
const VENDA = "#d7263d";

/** Un óvalo girado, como polígono (los de `ovalo` no giran). */
function ovaloGirado(cx: number, cy: number, rx: number, ry: number, ang: number, n = 18): Punto[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    return [cx + x * c - y * s, cy + x * s + y * c] as const;
  });
}

/** Un caramelo envuelto: el cuerpo ovalado y las dos puntas retorcidas del papel (`drawCandy`). */
function caramelo(p: Pincel, x: number, y: number, s: number, ang: number, color: string): void {
  const c = Math.cos(ang), sn = Math.sin(ang);
  const P = (px: number, py: number): Punto => [x + px * c - py * sn, y + px * sn + py * c];
  const borde = Math.max(2.5, s * 0.16);
  for (const k of [-1, 1]) poligono(p, [P(k * s * 0.95, 0), P(k * s * 1.65, -s * 0.5), P(k * s * 1.65, s * 0.5)], oscuro(color, 0.82), borde);
  poligono(p, ovaloGirado(x, y, s * 1.1, s * 0.72, ang), color, borde, 4);
  poligono(p, ovaloGirado(x - s * 0.38 * c + s * 0.25 * sn, y - s * 0.38 * sn - s * 0.25 * c, s * 0.3, s * 0.14, ang, 10), CREMA);
}

/** El patio: la pared de adobe con sus ladrillos y el piso de baldosas de barro, de noche. */
function patio(p: Pincel): void {
  const muro = 236;
  caja(p, 0, muro, ANCHO, PISO - muro, PARED);
  for (let fila = 0, y = muro + 18; y + 30 <= PISO; fila++, y += 36) {
    for (let x = fila % 2 ? -56 : 0; x < ANCHO; x += 112) {
      const x0 = Math.max(0, x + 3), x1 = Math.min(ANCHO, x + 109);
      caja(p, x0, y, x1 - x0, 30, "#33233f");
    }
  }
  caja(p, 0, muro, ANCHO, 14, "#4a3355", 4);
  caja(p, 0, PISO, ANCHO, ALTO - PISO, "#3b2630");
  for (let fila = 0, y = PISO + 8; y < ALTO; fila++, y += 70) {
    for (let x = fila % 2 ? -40 : 4; x < ANCHO; x += 84) {
      const x0 = Math.max(0, x), x1 = Math.min(ANCHO, x + 78);
      if (x1 > x0) caja(p, x0, y, x1 - x0, Math.min(62, ALTO - y), "#46303a");
    }
  }
  caja(p, 0, PISO - 4, ANCHO, 9, TINTA);
}

/** La soga en V que sostiene la piñata (la tiran de las dos paredes) y el cordel hasta el pico de arriba. */
function soga(p: Pincel): Punto {
  const nudo: Punto = [OLLA.x, 196];
  const cuerda = "#c9a36b";
  for (const [ancho, color] of [[11, TINTA], [5, cuerda]] as const) {
    linea(p, [[0, 92], nudo, [ANCHO, 74]], color, ancho);
    linea(p, [nudo, [OLLA.x, OLLA.y - OLLA.r * 1.6]], color, ancho);
  }
  ovalo(p, nudo[0], nudo[1], 9, 9, cuerda, 4);
  return nudo;
}

/** Los globos de la fiesta, atados a la pared de la izquierda. */
function globos(p: Pincel): void {
  const lugares: Array<[number, number, number]> = [[96, 330, 0], [176, 296, 1], [250, 344, 4], [150, 400, 3]];
  const nudo: Punto = [190, 520];
  for (const [x, y] of lugares) linea(p, [[x, y + 50], [(x + nudo[0]) / 2 + 12, (y + 50 + nudo[1]) / 2], nudo], CREMA, 3);
  for (const [x, y, i] of lugares) {
    ovalo(p, x, y, 40, 48, franja(i), 4, 7);
    poligono(p, [[x - 8, y + 54], [x + 8, y + 54], [x, y + 45]], franja(i), 3);
    ovalo(p, x - 15, y - 18, 7, 12, CREMA);
  }
}

/** Una banda de la olla entre dos alturas, recortada al círculo: el papel de china en franjas. */
function banda(p: Pincel, ya: number, yb: number, color: string): void {
  const { x, y, r } = OLLA;
  const pts: Punto[] = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const yy = ya + ((yb - ya) * i) / n;
    pts.push([x + Math.sqrt(Math.max(0, r * r - (yy - y) ** 2)) * 0.97, yy]);
  }
  for (let i = n; i >= 0; i--) {
    const yy = ya + ((yb - ya) * i) / n;
    pts.push([x - Math.sqrt(Math.max(0, r * r - (yy - y) ** 2)) * 0.97, yy]);
  }
  poligono(p, pts, color);
}

/** La estrella de siete picos: los conos de colores con sus flecos, la olla en franjas y la rajadura. */
function estrella(p: Pincel): void {
  const { x, y, r } = OLLA;
  const picos = Array.from({ length: 7 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const base = r * 0.78, punta = r * 1.75, ancho = r * 0.36;
    return {
      pts: [[x + c * base - s * ancho, y + s * base + c * ancho], [x + c * punta, y + s * punta], [x + c * base + s * ancho, y + s * base - c * ancho]] as Punto[],
      punta: [x + c * punta, y + s * punta] as Punto,
      color: franja(i),
    };
  });
  // Las sombras de todo primero, para que ninguna caiga sobre un pico ya pintado.
  for (const pico of picos) poligono(p, pico.pts.map(([a, b]) => [a + 10, b + 10] as const), SOMBRA);
  ovalo(p, x + 10, y + 10, r, r, SOMBRA);
  for (const [i, pico] of picos.entries()) {
    const [tx, ty] = pico.punta;
    for (let f = 0; f < 3; f++) caja(p, tx - 3 + (f - 1) * 7, ty - 2, 6, r * 0.32, franja(i + f + 1), 2);
    poligono(p, pico.pts, pico.color, 4);
  }
  ovalo(p, x, y, r, r, "#ff8b3d");
}

/** La olla forrada de papel de china en franjas, con su contorno de tinta y la rajadura; devuelve por dónde salen los caramelos. */
function olla(p: Pincel): Punto {
  estrella(p);
  const { x, y, r } = OLLA;
  for (let b = -2; b <= 2; b++) banda(p, y + b * r * 0.38 - r * 0.08, y + b * r * 0.38 + r * 0.08, b % 2 ? "#ffd24d" : "#ff5cb3");
  linea(p, Array.from({ length: 33 }, (_, i) => [x + Math.cos((i / 32) * Math.PI * 2) * r, y + Math.sin((i / 32) * Math.PI * 2) * r] as const), TINTA, 5);
  // La rajadura abajo a la derecha, por donde salen los caramelos: una grieta en zigzag.
  linea(p, [[x + r * 0.2, y + r * 0.86], [x + r * 0.36, y + r * 0.62], [x + r * 0.3, y + r * 0.5], [x + r * 0.5, y + r * 0.36], [x + r * 0.48, y + r * 0.22], [x + r * 0.66, y + r * 0.1]], TINTA, 6);
  return [x + r * 0.86, y + r * 0.4];
}

/** La estrella amarilla del golpe, donde el palo pega. */
function golpe(p: Pincel, x: number, y: number, r: number): void {
  const pts: Punto[] = [];
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  poligono(p, pts, AMARILLO, 4, 6);
  poligono(p, pts.map(([a, b]) => [x + (a - x) * 0.45, y + (b - y) * 0.45] as const), CREMA);
}

/** El palo forrado de cintas de colores, de las manos del chico a la piñata, con las rayas del golpe. */
function palo(p: Pincel, mano: Punto, punta: Punto): void {
  const [x0, y0] = mano, [x1, y1] = punta;
  const largo = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / largo, uy = (y1 - y0) / largo;
  const g = 9;
  const en = (d: number, s: number): Punto => [x0 + ux * d - uy * g * s, y0 + uy * d + ux * g * s];
  // El aire que corta: tres arcos crema atrás del palo.
  for (const k of [1, 2, 3]) {
    const pts: Punto[] = Array.from({ length: 9 }, (_, i) => {
      const t = -0.1 - (i / 8) * (0.12 + 0.04 * k);
      const d = largo * (0.98 - 0.13 * k);
      const ang = Math.atan2(uy, ux) + t;
      return [x0 + Math.cos(ang) * d, y0 + Math.sin(ang) * d] as const;
    });
    linea(p, pts, TINTA, 11);
    linea(p, pts, CREMA, 5);
  }
  poligono(p, [en(0, -1), en(largo, -1), en(largo, 1), en(0, 1)], PALO, 4, 6);
  for (let i = 0, d = 30; d + 14 < largo; i++, d += 34) poligono(p, [en(d, -1), en(d + 14, -1), en(d + 22, 1), en(d + 8, 1)], franja(i), 2);
}

/** El chico con los ojos vendados (`makeKid`): queda casi todo detrás del panel del nombre; asoman las zapatillas. */
function chico(p: Pincel, x: number, y: number, u: number): Punto {
  const at = (lx: number, ly: number): Punto => [x + lx * u, y + ly * u];
  const box = (lx: number, ly: number, w: number, h: number, color: string): void => caja(p, x + lx * u, y + ly * u, w * u, h * u, color, 2.5 * u);
  box(-20, -44, 11, 44, "#2b2d42");
  box(-6, -44, 11, 44, "#2b2d42");
  box(-24, -5, 16, 7, TINTA);
  box(-8, -5, 16, 7, TINTA);
  box(-24, -92, 34, 52, franja(3));
  const mano = at(20, -66);
  linea(p, [at(-2, -84), mano], TINTA, 10 * u);
  linea(p, [at(-2, -84), mano], franja(3), 6 * u);
  ovalo(p, mano[0], mano[1], 4 * u, 4 * u, PIEL, 1.5 * u);
  ovalo(p, x - 7 * u, y - 108 * u, 17 * u, 17 * u, PIEL, 2.5 * u);
  ovalo(p, x - 7 * u, y - 120 * u, 14 * u, 9 * u, "#2b1d14");
  poligono(p, [at(-24, -112), at(10, -116), at(10, -104), at(-24, -100)], VENDA, 1.5 * u);
  poligono(p, [at(-24, -108), at(-36, -116), at(-34, -102)], VENDA, 1.5 * u);
  return mano;
}

/** Los caramelos: los que salen volando de la rajadura, los que caen y el montón del piso. */
function caramelos(p: Pincel, boca: Punto): void {
  const [bx, by] = boca;
  const vuelan: Array<[number, number, number]> = [[bx + 64, by - 40, 0.4], [bx + 128, by - 92, -0.6], [bx + 186, by - 30, 0.9], [bx + 112, by + 30, -0.2], [bx + 236, by - 104, 0.2], [bx + 262, by + 8, -0.9], [bx + 40, by + 60, 1.2]];
  // La estela de puntos de la salida.
  for (let i = 1; i < 7; i++) ovalo(p, bx + i * 16, by - Math.sin((i / 7) * Math.PI) * 26 - i * 2, 4, 4, CREMA, 2);
  vuelan.forEach(([x, y, a], i) => caramelo(p, x, y, 17, a, franja(i)));
  const caen: Array<[number, number, number]> = [[966, 590, 0.5], [860, 628, -0.4], [1030, 652, 1.1], [610, 600, 0.2]];
  caen.forEach(([x, y, a], i) => caramelo(p, x, y, 15, a, franja(i + 2)));
  const azar = sembrado(0x9a7a);
  for (let fila = 0; fila < 3; fila++) {
    const n = 9 - fila * 3;
    for (let i = 0; i < n; i++) {
      const x = 620 + fila * 70 + i * 52 + azar() * 14;
      const y = PISO + 74 - fila * 22 + azar() * 6;
      caramelo(p, x, y, 15, (azar() - 0.5) * 1.6, franja(i + fila * 2));
    }
  }
}

/**
 * Piñata: la estrella de siete picos colgada en el patio de noche, con papel
 * picado y globos, el palo que le pega por la izquierda y los caramelos que
 * salen volando por la rajadura hacia la derecha y se apilan en el piso.
 */
export function fondoPinata(p: Pincel): void {
  estrellas(p, 0x91a7a, 30, 20, 220);
  patio(p);
  papelPicado(p, 16, 34, PARED);
  globos(p);
  soga(p);
  const mano = chico(p, 408, 806, 1.8);
  const boca = olla(p);
  const pega: Punto = [OLLA.x - OLLA.r * 0.82, OLLA.y + OLLA.r * 0.62];
  palo(p, mano, pega);
  golpe(p, pega[0] - 6, pega[1] + 4, 34);
  caramelos(p, boca);
  confeti(p, 0x91a7, 12, 330, 262, 560, 360);
  confeti(p, 0x91a8, 10, 860, 250, 1060, 330);
}
