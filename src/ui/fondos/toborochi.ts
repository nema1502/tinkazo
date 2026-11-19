/**
 * El fondo del Toborochi para la foto del juego: una noche tibia de Santa Cruz
 * con el toborochi florido en medio del campo (`games/pixi/toborochi*.ts`,
 * `games/tres/toborochi-3d.ts`): el tronco panzón de botella, verde y con
 * espinas, las ramas gruesas abiertas como paraguas y la copa cargada de flores
 * rosadas de cinco pétalos. Un colibrí llega a la copa, caen flores y el pasto
 * queda alfombrado de rosa.
 *
 * El árbol entero y el colibrí van en la ventana libre de la foto
 * (y = 250 a 540); el campo con flores caídas y flores del monte sigue detrás de
 * los paneles y asoma a la derecha del nombre y abajo.
 */

import {
  type Pincel,
  type Punto,
  ANCHO,
  ALTO,
  TINTA,
  SOMBRA,
  CREMA,
  franja,
  caja,
  poligono,
  ovalo,
  linea,
  sembrado,
  estrellas,
} from "./lapiz";

/* La paleta de la noche tibia y del árbol (`games/tres/toborochi-3d.ts`). */
const CIELO = ["#1f1838", "#2a2048", "#382658", "#4a2e66"] as const;
const CERRO_LEJOS = "#4e3a6c";
const CERRO_CERCA = "#3b2c58";
const PASTO = "#2c4a30";
const PASTO_CLARO = "#36583a";
const CORTEZA = "#7f8f6a";
const CORTEZA_SOMBRA = "#586848";
const ESPINA = "#d9d3b8";
const ROSA = "#ff5cb3";
const ROSAS = [ROSA, "#ff80b8", "#f56aab"] as const;
const COPA = "#a8336b";
const COPA_HOJAS = "#2f5a3a";
const CENTRO = "#fff4d6";
const ESTAMBRE = "#ffd24d";

/** Un óvalo solo si cabe entero en la foto (los de las orillas se quedan afuera). */
function ovaloDentro(p: Pincel, x: number, y: number, rx: number, ry: number, color: string, borde = 0): void {
  if (x - rx >= 0 && y - ry >= 0 && x + rx <= ANCHO && y + ry <= ALTO) ovalo(p, x, y, rx, ry, color, borde);
}

/** La flor del toborochi: cinco pétalos rosados con su borde de tinta y el centro crema con estambres. */
function flor(p: Pincel, x: number, y: number, r: number, color: string, giro: number): void {
  for (let k = 0; k < 5; k++) {
    const a = giro + (k / 5) * Math.PI * 2;
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const en = (u: number, n: number): Punto => [x + (ux * u + nx * n) * r, y + (uy * u + ny * n) * r];
    poligono(p, [en(0.1, 0), en(0.45, 0.4), en(0.85, 0.32), en(1, 0), en(0.85, -0.32), en(0.45, -0.4)], color, 2.5);
  }
  ovaloDentro(p, x, y, r * 0.24, r * 0.24, CENTRO, 2);
  ovaloDentro(p, x, y, r * 0.1, r * 0.1, ESTAMBRE);
}

/** Una flor del monte, chica y redonda, en un color de la franja. */
function florcita(p: Pincel, x: number, y: number, r: number, color: string): void {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    ovaloDentro(p, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.55, r * 0.55, color, 2.5);
  }
  ovaloDentro(p, x, y, r * 0.38, r * 0.38, ESTAMBRE, 2);
}

/** La luna tibia, con dos cráteres. */
function luna(p: Pincel, x: number, y: number, r: number): void {
  ovalo(p, x, y, r, r, "#ffe9bf", 5, 8);
  ovalo(p, x - r * 0.3, y - r * 0.2, r * 0.18, r * 0.18, "#f0d49a");
  ovalo(p, x + r * 0.32, y + r * 0.28, r * 0.12, r * 0.12, "#f0d49a");
}

/** Una loma de borde a borde, suave. */
function loma(p: Pincel, base: number, picos: readonly Punto[], color: string): void {
  poligono(p, [[0, base], ...picos, [ANCHO, base]], color, 4);
}

/** Una rama gruesa: un trapecio de la corteza, de un ancho al otro. */
function rama(p: Pincel, a: Punto, b: Punto, w0: number, w1: number, color = CORTEZA): void {
  const [ax, ay] = a, [bx, by] = b;
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const nx = -(by - ay) / l, ny = (bx - ax) / l;
  poligono(p, [[ax + nx * w0, ay + ny * w0], [bx + nx * w1, by + ny * w1], [bx - nx * w1, by - ny * w1], [ax - nx * w0, ay - ny * w0]], color, 4);
}

/**
 * El toborochi: `x` es el medio del tronco, `pie` donde toca el pasto y `k` el
 * tamaño (1 es el grande, de unos 270 px de alto). El tronco de botella se
 * hincha abajo y se angosta en un cuello largo; arriba se abren las ramas
 * gruesas como un paraguas, con una mata florida en cada punta.
 */
function toborochi(p: Pincel, x: number, pie: number, k: number, semilla: number, porMata: number): void {
  const at = (dx: number, dy: number): Punto => [x + dx * k, pie + dy * k];
  // El perfil del tronco, del cuello al pie: la mitad del ancho a cada altura.
  const perfil: Array<[number, number]> = [
    [-178, 20], [-164, 24], [-148, 32], [-132, 44], [-114, 60], [-96, 74], [-76, 86], [-56, 94], [-38, 96], [-22, 92], [-10, 86], [0, 92],
  ];
  const ancho = (dy: number): number => (perfil.find(([py]) => py >= dy) ?? [0, 60])[1];
  // Las ramas gruesas, abiertas como un paraguas, con su ramita hacia arriba.
  const puntas: Punto[] = [[-252, -206], [-168, -238], [-62, -250], [62, -250], [168, -238], [252, -206]];
  for (const [dx, dy] of puntas) {
    rama(p, at(dx * 0.1, -172), at(dx, dy), 15 * k, 6 * k);
    const mx = dx * 0.6, my = -172 + (dy + 172) * 0.6;
    rama(p, at(mx, my), at(mx + dx * 0.12, dy - 4), 6 * k, 3 * k);
  }
  // El tronco panzón, con su sombra dura, el lado oscuro, los anillos y las espinas.
  const tronco: Punto[] = [...perfil.map(([dy, w]) => at(-w, dy)), ...perfil.map(([dy, w]) => at(w, dy)).reverse()];
  poligono(p, tronco.map(([a, b]) => [a + 10 * k, b + 6 * k] as const), SOMBRA);
  poligono(p, tronco, CORTEZA);
  poligono(p, [...perfil.map(([dy, w]) => at(w * 0.4, dy)), ...perfil.map(([dy, w]) => at(w, dy)).reverse()], CORTEZA_SOMBRA);
  for (const dy of [-110, -74, -40]) {
    const w = ancho(dy) * 0.78;
    linea(p, [at(-w, dy), at(-w * 0.5, dy + 6), at(0, dy + 8), at(w * 0.5, dy + 6), at(w, dy)], CORTEZA_SOMBRA, 3);
  }
  const azar = sembrado(semilla);
  for (let i = 0; i < 18; i++) {
    const dy = -150 + azar() * 140;
    const lado = azar() < 0.5 ? -1 : 1;
    const dx = lado * ancho(dy) * (0.25 + azar() * 0.6);
    poligono(p, [at(dx - 5, dy + 4), at(dx + 5, dy + 4), at(dx + lado * 3, dy - 8)], ESPINA, 2);
  }
  poligono(p, tronco, CORTEZA, 5);
  // Una mata en cada punta de rama: hojas y flores apretadas, y las flores rosadas encima.
  const az = sembrado(semilla + 1);
  puntas.forEach(([dx, dy], i) => {
    const cx = x + dx * k, cy = pie + (dy - 6) * k;
    const rx = 58 * k, ry = 23 * k;
    ovalo(p, cx, cy, rx, ry, i % 3 === 1 ? COPA_HOJAS : COPA, 4, 6 * k);
    for (let j = 0; j < porMata; j++) {
      const a = az() * Math.PI * 2, d = Math.sqrt(az());
      const r = (13 + az() * 5) * k;
      const fy = Math.max(250 + r + 1, cy + Math.sin(a) * d * ry);
      flor(p, cx + Math.cos(a) * d * rx, fy, r, ROSAS[(i + j) % 3] as string, az() * Math.PI);
    }
  });
}

/** El colibrí que llega a la copa: verde con la garganta roja, el pico largo y las alas abiertas. */
function colibri(p: Pincel, x: number, y: number): void {
  poligono(p, [[x - 30, y - 6], [x - 62, y + 8], [x - 58, y + 18], [x - 26, y + 10]], "#127a5a", 3, 4);
  poligono(p, [[x - 6, y - 4], [x - 40, y - 52], [x - 20, y - 54], [x + 8, y - 8]], "#dff7ff", 3, 4);
  ovalo(p, x - 6, y + 2, 32, 14, "#1fa67a", 4, 4);
  ovalo(p, x + 26, y - 6, 15, 14, franja(3), 4);
  ovalo(p, x + 22, y + 6, 8, 6, "#e0364f", 2);
  linea(p, [[x + 40, y - 6], [x + 76, y - 2]], TINTA, 4);
  ovalo(p, x + 30, y - 9, 3.5, 3.5, TINTA);
  poligono(p, [[x - 2, y - 2], [x + 22, y - 54], [x + 40, y - 48], [x + 10, y - 2]], "#dff7ff", 3);
}

/**
 * Toborochi: el árbol florido en medio de una noche tibia, con el colibrí, todo
 * en la ventana libre de la foto (y = 250 a 540); abajo, el campo alfombrado de
 * flores caídas, que asoma al lado del nombre y entre los paneles.
 */
export function fondoToborochi(p: Pincel): void {
  // El cielo de noche tibia, en bandas planas hacia el horizonte.
  caja(p, 0, 300, ANCHO, 80, CIELO[0]);
  caja(p, 0, 380, ANCHO, 60, CIELO[1]);
  caja(p, 0, 440, ANCHO, 40, CIELO[2]);
  caja(p, 0, 480, ANCHO, 60, CIELO[3]);
  estrellas(p, 0x70b0, 44, 24, 300);
  luna(p, 930, 150, 62);
  loma(p, 540, [[0, 470], [160, 440], [330, 470], [520, 452], [700, 476], [880, 438], [1080, 462]], CERRO_LEJOS);
  loma(p, 540, [[0, 500], [220, 486], [420, 506], [640, 494], [860, 508], [1080, 490]], CERRO_CERCA);
  caja(p, 0, 530, ANCHO, ALTO - 530, PASTO, 4);
  // El pasto, con matitas sembradas y la alfombra rosada debajo del árbol.
  const azar = sembrado(0x70b1);
  for (let i = 0; i < 80; i++) {
    const x = azar() * ANCHO, y = 560 + azar() * (ALTO - 580), h = 14 + azar() * 12;
    poligono(p, [[x - 12, y], [x - 9, y - h * 0.7], [x - 3, y - 3], [x, y - h], [x + 3, y - 3], [x + 9, y - h * 0.7], [x + 12, y]], PASTO_CLARO, 3);
  }
  ovalo(p, 720, 552, 300, 22, "#8a3468", 4);
  // Un toborochi chico, lejos a la izquierda, y el grande en el medio.
  toborochi(p, 150, 530, 0.46, 0x70b2, 4);
  toborochi(p, 740, 532, 1, 0x70b3, 13);
  colibri(p, 380, 326);
  // Las flores que caen y las que ya quedaron en el pasto.
  const cae = sembrado(0x70b4);
  for (let i = 0; i < 9; i++) {
    const x = 420 + cae() * 640, y = 360 + cae() * 150;
    if (Math.abs(x - 740) > 130) flor(p, x, y, 11 + cae() * 4, ROSAS[i % 3] as string, cae() * Math.PI);
  }
  const suelo = sembrado(0x70b5);
  for (let i = 0; i < 46; i++) {
    const x = 20 + suelo() * (ANCHO - 40), y = 548 + suelo() * (ALTO - 570);
    flor(p, x, y, 10 + suelo() * 6, ROSAS[i % 3] as string, suelo() * Math.PI);
  }
  // Flores del monte, en los cinco colores, que asoman entre los paneles.
  const monte: Array<[number, number]> = [[560, 640], [640, 760], [900, 610], [1030, 720], [760, 790], [30, 1300], [300, 1300], [560, 1310], [1040, 1300], [20, 620]];
  monte.forEach(([x, y], i) => florcita(p, x, y, 14, franja(i)));
}
