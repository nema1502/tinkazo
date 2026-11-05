/**
 * El fondo del Guajojó para la foto del juego: el monte de noche del oriente,
 * con la luna llena detrás del guajojó (el pájaro de los ojos amarillos que se
 * hace pasar por un palo, `games/pixi/guajojo.ts`) parado derecho en la punta
 * de un tronco quebrado. Hojas grandes de selva a los costados, una palmera,
 * luciérnagas, el sendero con sus farolitos y flores de la franja.
 *
 * El guajojó y la luna van en la ventana libre de la foto (y = 250–540); el
 * tronco, el sendero y los farolitos bajan detrás de los paneles y asoman a la
 * derecha del nombre y abajo.
 */

import {
  type Pincel,
  type Punto,
  ANCHO,
  ALTO,
  TINTA,
  CREMA,
  AMARILLO,
  franja,
  caja,
  poligono,
  ovalo,
  linea,
  sembrado,
  estrellas,
} from "./lapiz";

/* La paleta del monte de noche y del pájaro (`games/pixi/guajojo.ts`, `games/tres/guajojo-3d.ts`). */
const MONTE_LEJOS = "#102a2a";
const MONTE = "#123a28";
const SUELO = "#16301f";
const SUELO_CLARO = "#1c3a26";
const HOJA = ["#1f6b3a", "#2f8a4a", "#17543a"] as const;
const CORTEZA = "#5b4a3c";
const CORTEZA_OSCURA = "#3a2e26";
const CORTEZA_CLARA = "#7a6650";
const PLUMA = "#8a7660";
const PLUMA_OSCURA = "#5b4a3c";
const PLUMA_CLARA = "#b8a488";
const OJO = "#ffd23a";
const LUCIERNAGA = "#eaff9a";
const FAROL = "#ffc65a";

/** Una hoja de selva: un huso de la base a la punta, con su nervio. */
function hoja(p: Pincel, base: Punto, punta: Punto, ancho: number, color: string, sombra = 6): void {
  const [bx, by] = base, [tx, ty] = punta;
  const dx = tx - bx, dy = ty - by;
  const largo = Math.hypot(dx, dy) || 1;
  const nx = -dy / largo, ny = dx / largo;
  const lado = (s: number): Punto[] =>
    Array.from({ length: 7 }, (_, i) => {
      const t = (i + 1) / 8;
      const w = ancho * Math.sin(Math.PI * t ** 0.8) * s;
      return [bx + dx * t + nx * w, by + dy * t + ny * w] as const;
    });
  poligono(p, [base, ...lado(1), punta, ...lado(-1).reverse()], color, 4, sombra);
  linea(p, [base, [bx + dx * 0.85, by + dy * 0.85]], TINTA, 3);
}

/** Un óvalo solo si cabe entero en la foto (los de las orillas se quedan afuera). */
function ovaloDentro(p: Pincel, x: number, y: number, rx: number, ry: number, color: string, borde = 0): void {
  if (x - rx >= 0 && y - ry >= 0 && x + rx <= ANCHO && y + ry <= ALTO) ovalo(p, x, y, rx, ry, color, borde);
}

/** Una flor chica de cinco pétalos, en un color de la franja. */
function florcita(p: Pincel, x: number, y: number, r: number, color: string): void {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    ovaloDentro(p, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, r * 0.55, color, 2.5);
  }
  ovaloDentro(p, x, y, r * 0.38, r * 0.38, AMARILLO, 2);
}

/** La luna llena, grande, detrás del pájaro. */
function luna(p: Pincel, x: number, y: number, r: number): void {
  ovalo(p, x, y, r, r, "#f4ecd8", 5, 10);
  ovalo(p, x - r * 0.42, y - r * 0.3, r * 0.16, r * 0.16, "#ddd2bb");
  ovalo(p, x + r * 0.5, y + r * 0.1, r * 0.11, r * 0.11, "#ddd2bb");
  ovalo(p, x - r * 0.25, y + r * 0.55, r * 0.09, r * 0.09, "#ddd2bb");
}

/** El monte de lejos: una línea de copas redondas de borde a borde. */
function monte(p: Pincel, base: number, alto: number, paso: number, color: string, semilla: number): void {
  const azar = sembrado(semilla);
  const pts: Punto[] = [[0, base]];
  for (let x = 0; x <= ANCHO + paso; x += paso) {
    const top = base - alto * (0.55 + azar() * 0.45);
    for (let k = 0; k <= 6; k++) {
      const a = Math.PI * (k / 6);
      pts.push([x - paso / 2 + (paso / 2) * (1 - Math.cos(a)), top + (alto * 0.35) * (1 - Math.sin(a))]);
    }
  }
  pts.push([ANCHO, base]);
  poligono(p, pts, color, 4);
}

/** Una palmera de motacú: el tallo curvo y un abanico de hojas. */
function palmera(p: Pincel, pie: Punto, copa: Punto): void {
  const [px, py] = pie, [cx, cy] = copa;
  const tallo: Punto[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = px + (cx - px) * t + Math.sin(t * Math.PI) * 26;
    tallo.push([x, py + (cy - py) * t]);
  }
  const ancho = (t: number): number => 16 - t * 6;
  poligono(p, [...tallo.map(([x, y], i) => [x - ancho(i / 8), y] as const), ...tallo.map(([x, y], i) => [x + ancho(i / 8), y] as const).reverse()], "#4a3d30", 4, 6);
  for (let i = 1; i < 8; i++) {
    const [x, y] = tallo[i] as Punto;
    linea(p, [[x - ancho(i / 8), y], [x + ancho(i / 8), y - 6]], TINTA, 3);
  }
  const hojas: Array<[number, number, number]> = [[-150, 40, 0], [-120, -60, 1], [-40, -110, 2], [60, -100, 0], [140, -40, 1], [150, 50, 2], [10, 90, 1]];
  for (const [dx, dy, c] of hojas) hoja(p, copa, [cx + dx, cy + dy], 22, HOJA[c] as string, 5);
  ovalo(p, cx, cy, 16, 14, "#4a3d30", 4);
}

/** El tronco quebrado donde se para el guajojó: de la punta astillada hasta el pie de la foto, con una rama rota. */
function tronco(p: Pincel, x: number, punta: number): void {
  const izq = (y: number): number => x - 42 - (y - punta) * 0.03;
  const der = (y: number): number => x + 46 + (y - punta) * 0.035;
  const astillas: Punto[] = [[izq(punta) + 2, punta + 10], [x - 22, punta - 6], [x - 8, punta + 6], [x + 10, punta - 10], [x + 26, punta + 4], [der(punta) - 2, punta - 2]];
  const cuerpo: Punto[] = [...astillas, [der(ALTO), ALTO], [izq(ALTO), ALTO]];
  // La rama rota que sale a la derecha, hacia el claro al lado del nombre.
  const rama: Punto[] = [[der(640) - 10, 650], [1000, 572], [1012, 590], [1004, 600], [der(700) - 6, 700]];
  poligono(p, rama, CORTEZA, 5, 8);
  linea(p, [[958, 600], [1010, 556]], TINTA, 4);
  linea(p, [[958, 600], [1006, 558]], CORTEZA_CLARA, 2);
  poligono(p, cuerpo, CORTEZA, 5, 10);
  // Las vetas y la cara de la luna sobre la corteza.
  poligono(p, [[der(punta) - 18, punta + 8], [der(punta) - 2, punta], [der(ALTO), ALTO], [der(ALTO) - 30, ALTO]], CORTEZA_OSCURA);
  const azar = sembrado(0x7a110);
  for (let i = 0; i < 9; i++) {
    const y0 = punta + 40 + i * 92 + azar() * 30;
    const xx = x - 24 + azar() * 40;
    linea(p, [[xx, y0], [xx + 4, y0 + 40], [xx - 2, y0 + 70]], CORTEZA_OSCURA, 4);
  }
  ovalo(p, x - 6, 760, 14, 22, CORTEZA_OSCURA, 4);
  ovalo(p, x - 6, 760, 6, 10, TINTA);
  linea(p, [[izq(punta) + 6, punta + 30], [izq(punta) + 10, punta + 90]], CORTEZA_CLARA, 4);
  linea(p, cuerpo.concat([cuerpo[0] as Punto]), TINTA, 5);
}

/**
 * El guajojó parado derecho, como si fuera la punta del palo: el cuerpo largo y
 * flaco de plumaje de corteza, la cabeza chata con los ojos amarillos enormes
 * que sobresalen, la boca ancha de lado a lado con el piquito y la cola larga
 * que cuelga por delante del tronco.
 */
function guajojo(p: Pincel, bx: number, pie: number): void {
  const at = (x: number, y: number): Punto => [bx + x, pie + y];
  const silueta: Punto[] = [
    at(-40, -214), at(-34, -230), at(-18, -240), at(0, -243), at(18, -240), at(34, -230), at(40, -214),
    at(50, -184), at(52, -140), at(54, -96), at(48, -46), at(34, -10), at(16, 2), at(12, 38), at(-10, 40), at(-16, 2),
    at(-34, -10), at(-48, -46), at(-54, -96), at(-52, -140), at(-50, -184),
  ];
  poligono(p, silueta.map(([x, y]) => [x + 12, y + 12] as const), "#0b0814");
  poligono(p, silueta, PLUMA);
  // La cola larga, con sus barras.
  poligono(p, [at(-16, 2), at(16, 2), at(12, 38), at(-10, 40)], PLUMA_OSCURA, 3);
  for (const y of [14, 26]) linea(p, [at(-13, y), at(13, y + 2)], TINTA, 2.5);
  // El pecho y la garganta claros, moteados.
  poligono(p, [at(-34, -170), at(34, -170), at(40, -110), at(30, -40), at(0, -20), at(-30, -40), at(-40, -110)], PLUMA_CLARA, 0);
  poligono(p, [at(-30, -150), at(30, -150), at(34, -100), at(26, -46), at(0, -30), at(-26, -46), at(-34, -100)], PLUMA, 0);
  const azar = sembrado(0x60a0);
  for (let i = 0; i < 22; i++) {
    const x = -30 + azar() * 60, y = -150 + azar() * 120;
    const l = 12 + azar() * 16;
    poligono(p, [at(x, y), at(x + 3, y + l * 0.5), at(x, y + l), at(x - 3, y + l * 0.5)], i % 3 ? PLUMA_OSCURA : TINTA);
  }
  // Las alas plegadas a los costados, con las barras de las plumas.
  for (const s of [-1, 1]) {
    poligono(p, [at(s * 52, -150), at(s * 36, -136), at(s * 28, -40), at(s * 34, -8), at(s * 50, -40), at(s * 56, -100)], "#6e5c48", 4);
    for (let k = 0; k < 4; k++) linea(p, [at(s * 52, -120 + k * 24), at(s * 32, -110 + k * 24)], TINTA, 2.5);
  }
  // La gorra con rayitas.
  for (let k = -2; k <= 2; k++) linea(p, [at(k * 9, -236), at(k * 10, -222)], PLUMA_OSCURA, 3);
  // La boca ancha de lado a lado, el piquito y la barba clara de abajo.
  poligono(p, [at(-46, -176), at(0, -164), at(46, -176), at(30, -156), at(0, -148), at(-30, -156)], PLUMA_CLARA, 3);
  linea(p, [at(-48, -178), at(-24, -168), at(0, -164), at(24, -168), at(48, -178)], TINTA, 4);
  poligono(p, [at(-7, -184), at(7, -184), at(0, -166)], TINTA);
  // Los ojos amarillos enormes, que sobresalen de la cabeza.
  for (const s of [-1, 1]) {
    ovalo(p, bx + s * 25, pie - 208, 24, 24, OJO, 5);
    ovalo(p, bx + s * 25, pie - 206, 9, 13, TINTA);
    ovalo(p, bx + s * 25 - 6, pie - 214, 4, 4, CREMA);
  }
  // Las garras sobre la punta del tronco.
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) linea(p, [at(s * (10 + k * 7), -2), at(s * (12 + k * 7), 8)], TINTA, 4);
  linea(p, silueta.concat([silueta[0] as Punto]), TINTA, 5);
}

/** Un farolito del sendero, en su palo. */
function farolito(p: Pincel, x: number, y: number): void {
  caja(p, x - 4, y - 70, 8, 70, CORTEZA_OSCURA, 3, 5);
  linea(p, [[x, y - 70], [x + 18, y - 78], [x + 18, y - 70]], TINTA, 4);
  caja(p, x + 8, y - 70, 22, 28, FAROL, 4, 5);
  caja(p, x + 6, y - 74, 26, 6, TINTA);
  caja(p, x + 14, y - 64, 10, 14, CREMA);
}

/** Una mata del suelo: un abanico de hojas y, si toca, flores de la franja. */
function mata(p: Pincel, x: number, y: number, alto: number, color: number, flores: number, i0: number): void {
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.42;
    hoja(p, [x, y], [x + Math.cos(a) * alto, y + Math.sin(a) * alto * 0.9], alto * 0.16, HOJA[(color + k) % 3] as string, 5);
  }
  for (let k = 0; k < flores; k++) {
    const a = -Math.PI / 2 + (k - (flores - 1) / 2) * 0.7;
    florcita(p, x + Math.cos(a) * alto * 0.7, y + Math.sin(a) * alto * 0.62, 13, franja(i0 + k));
  }
}

/** Las luciérnagas: puntos amarillo verdoso con su borde de tinta, lejos del pájaro. */
function luciernagas(p: Pincel, semilla: number, n: number, x0: number, y0: number, x1: number, y1: number, libre: (x: number, y: number) => boolean): void {
  const azar = sembrado(semilla);
  for (let i = 0; i < n; i++) {
    const x = x0 + azar() * (x1 - x0), y = y0 + azar() * (y1 - y0), r = 4 + azar() * 3;
    if (libre(x, y)) ovaloDentro(p, x, y, r, r, LUCIERNAGA, 2);
  }
}

/** Un árbol alto del monte, de lejos: el tallo y la copa de bolas, en un solo color oscuro. */
function arbolLejos(p: Pincel, x: number, base: number, alto: number, color: string): void {
  caja(p, x - 7, base - alto, 14, alto, color, 4);
  for (const [dx, dy, r] of [[-34, 6, 30], [34, 0, 32], [0, -22, 38], [-14, 20, 26], [18, 22, 26]] as const) {
    ovalo(p, x + dx, base - alto + dy, r, r * 0.8, color, 4);
  }
  for (const [dx, dy, r] of [[-34, 6, 30], [34, 0, 32], [0, -22, 38], [-14, 20, 26], [18, 22, 26]] as const) {
    ovalo(p, x + dx, base - alto + dy, r - 4, r * 0.8 - 4, color);
  }
}

/** Matas de pasto: abanicos chicos de hojas finas, sembrados en una franja. */
function pasto(p: Pincel, semilla: number, n: number, x0: number, y0: number, x1: number, y1: number): void {
  const azar = sembrado(semilla);
  for (let i = 0; i < n; i++) {
    const x = x0 + azar() * (x1 - x0), y = y0 + azar() * (y1 - y0), h = 18 + azar() * 16;
    poligono(p, [[x - 14, y], [x - 12, y - h * 0.7], [x - 5, y - 4], [x, y - h], [x + 5, y - 4], [x + 12, y - h * 0.7], [x + 14, y]], SUELO_CLARO, 3);
  }
}

/**
 * Guajojó: la luna llena detrás del guajojó, parado en la punta de un tronco
 * quebrado, todo en la ventana libre de la foto (y = 250–540). La selva lo
 * enmarca y abajo siguen el tronco, las matas floridas y los farolitos.
 */
export function fondoGuajojo(p: Pincel): void {
  const bx = 800, pie = 500;
  estrellas(p, 0x6a10, 40, 24, 300);
  luna(p, bx, 344, 124);
  arbolLejos(p, 420, 600, 230, MONTE_LEJOS);
  arbolLejos(p, 590, 600, 170, MONTE_LEJOS);
  monte(p, 600, 120, 120, MONTE_LEJOS, 0x6a11);
  monte(p, 620, 80, 90, MONTE, 0x6a12);
  caja(p, 0, 560, ANCHO, ALTO - 560, SUELO, 4);
  pasto(p, 0x6a14, 70, 0, 600, ANCHO, ALTO);
  palmera(p, [150, 600], [130, 300]);
  tronco(p, bx, pie);
  guajojo(p, bx, pie);
  // Las hojas grandes que enmarcan la ventana, a los dos lados.
  hoja(p, [0, 560], [250, 420], 46, HOJA[0], 8);
  hoja(p, [0, 520], [190, 300], 40, HOJA[1], 8);
  hoja(p, [40, 600], [330, 520], 40, HOJA[2], 8);
  hoja(p, [ANCHO, 540], [960, 330], 40, HOJA[1], 8);
  hoja(p, [ANCHO, 600], [970, 470], 36, HOJA[0], 8);
  // Las enredaderas que cuelgan de arriba a la derecha, con flores.
  linea(p, [[1040, 0], [1030, 80], [1046, 160], [1036, 230]], "#2f6b3a", 6);
  for (const [x, y, c] of [[1030, 80, 0], [1046, 160, 1], [1036, 230, 2]] as const) hoja(p, [x, y], [x - 50, y + 30], 14, HOJA[c], 4);
  florcita(p, 1036, 232, 15, franja(0));
  // Las matas floridas del suelo, que asoman al lado del nombre y abajo.
  mata(p, 580, 690, 120, 0, 3, 1);
  mata(p, 1040, 790, 130, 1, 2, 3);
  mata(p, 690, 850, 100, 2, 2, 4);
  mata(p, 30, 1350, 150, 2, 3, 2);
  mata(p, 530, 1350, 110, 0, 2, 4);
  mata(p, 1060, 1350, 130, 1, 2, 0);
  farolito(p, 600, 800);
  farolito(p, 940, 700);
  luciernagas(p, 0x6a13, 40, 200, 260, 1060, 840, (x, y) => (x < bx - 170 || x > bx + 170 || y > 560) && !(x < 600 && y < 250) && Math.abs(x - bx) > 60);
}
