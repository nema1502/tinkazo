/**
 * El fondo de la Chovena en la foto del juego: la rueda chiquitana en una plaza
 * de tierra colorada, de noche. Las mujeres van de tipoy blanco con la cinta de
 * color, trenzas y una flor; los hombres, de camisa y pantalón blancos con el
 * sombrero de saó, y todos tomados de la mano (`games/pixi/chovena.ts`). Atrás,
 * las casas de adobe con techo de teja y corredor; a la derecha, el toborochi
 * florido; arriba, una guirnalda de faroles; adelante, el conjunto con el
 * pífano, la caja y el bombo.
 *
 * La rueda entera va en la ventana sin paneles de la foto del juego
 * (y = 250–540); lo demás llena los bordes que se asoman entre los paneles.
 * Figuras planas como las del juego, sin caras de verdad: dos puntos de ojos.
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
  poligono,
  caja,
  linea,
  ovalo,
  elipse,
  bordear,
  sembrado,
  oscuro,
  estrellas,
  comba,
} from "./lapiz";

const BLANCO = "#fbf8f1";
const PAJA = "#e2c27c";
const PIELES = ["#c68a5c", "#a86f45", "#d9a273", "#8f5a36"] as const;
const PELOS = ["#2b1d14", "#3d2817", "#151515", "#4a2f1c"] as const;
const FLORES = ["#ff5fa2", "#ff7a1a", "#ffffff", "#e93d9c"] as const;
const TIERRA = "#6e3424";
const RUEDA = "#8a4a33";
const PASTO = "#3f6b35";
const MADERA = "#5a3a22";

/** Dónde empieza la plaza: el pie de las casas. */
const PISO = 345;

/* ------------------------------------------------------------- el cielo */

function luna(p: Pincel, x: number, y: number, r: number): void {
  ovalo(p, x, y, r, r, "#f4ecd8", 5, 8);
  ovalo(p, x - r * 0.3, y - r * 0.2, r * 0.18, r * 0.18, "#ddd2bb");
  ovalo(p, x + r * 0.32, y + r * 0.28, r * 0.12, r * 0.12, "#ddd2bb");
}

/** Un farol de papel: el cuerpo de color con sus costillas, la luz adentro y las tapas de tinta. */
function farol(p: Pincel, x: number, arriba: number, color: string, r: number): void {
  const cy = arriba + r * 1.55;
  linea(p, [[x, arriba], [x, cy - r * 1.2]], TINTA, 3);
  ovalo(p, x, cy, r, r * 1.3, color, 3.5, 5);
  elipse(p, x, cy, r * 0.5, r * 1.3);
  bordear(p, 2.5, oscuro(color, 0.62));
  ovalo(p, x, cy, r * 0.3, r * 0.62, AMARILLO);
  caja(p, x - r * 0.55, cy - r * 1.42, r * 1.1, r * 0.32, TINTA);
  caja(p, x - r * 0.55, cy + r * 1.12, r * 1.1, r * 0.32, TINTA);
  linea(p, [[x, cy + r * 1.44], [x, cy + r * 1.95]], oscuro(color, 0.62), 3);
}

/** La guirnalda de faroles colgada de borde a borde. */
function faroles(p: Pincel, y: number, baja: number): void {
  const hilo = comba(y, baja);
  linea(p, Array.from({ length: 19 }, (_, i) => [(i * ANCHO) / 18, hilo((i * ANCHO) / 18)] as const), TINTA, 4);
  for (let i = 0, x = 50; x + 22 <= ANCHO; i++, x += 90) farol(p, x, hilo(x), franja(i), 19);
}

/* ------------------------------------------------------------- la plaza */

/** Las casas de adobe del fondo, con el techo de teja que sale sobre los horcones y las ventanas encendidas. */
function casas(p: Pincel): void {
  const paredes = ["#b88f5a", "#a3804f", "#c09a64"];
  const azar = sembrado(0xc40a);
  for (let x = 0, i = 0; x < ANCHO; i++) {
    const ancho = 150 + azar() * 70, alto = 66 + azar() * 16;
    const x1 = Math.min(ANCHO, x + ancho);
    const techo = PISO - alto;
    caja(p, x, techo, x1 - x, alto, paredes[i % 3] as string, 3);
    caja(p, x, PISO - 12, x1 - x, 12, "#6b4527");
    const w = x1 - x;
    caja(p, x + w * 0.42, PISO - alto * 0.66, w * 0.16, alto * 0.66, MADERA, 2.5);
    for (const f of [0.13, 0.71]) caja(p, x + w * f, PISO - alto * 0.66, w * 0.16, alto * 0.32, "#ffc65a", 2.5);
    poligono(p, [[x - 6, techo + 8], [x1 + 6, techo + 8], [x1, techo - 26], [x, techo - 26]], "#7a3420", 3);
    for (let k = 1; k < 3; k++) linea(p, [[x + 2, techo + 8 - k * 11], [x1 - 2, techo + 8 - k * 11]], "#5c2716", 2);
    caja(p, x, techo + 5, x1 - x, 7, "#5c2716");
    const postes = Math.max(2, Math.round(w / 60));
    for (let k = 0; k <= postes; k++) caja(p, Math.min(ANCHO - 6, x + (k * w) / postes - 3), techo + 12, 6, alto - 12, MADERA, 2);
    x = x1 + 18;
  }
}

/** El toborochi: el tronco de botella, verde, y la copa de flores rosadas. */
function toborochi(p: Pincel, x: number, base: number): void {
  poligono(p, [[x - 18, base], [x - 40, base - 30], [x - 44, base - 66], [x - 30, base - 100], [x - 11, base - 124], [x - 9, base - 150], [x + 9, base - 150], [x + 11, base - 124], [x + 30, base - 100], [x + 44, base - 66], [x + 40, base - 30], [x + 18, base]], "#5f7046", 4, 7);
  linea(p, [[x - 4, base - 146], [x - 44, base - 196]], "#4d5c38", 9);
  linea(p, [[x + 4, base - 146], [x + 36, base - 200]], "#4d5c38", 9);
  const azar = sembrado(0x70b0);
  const rosas = ["#ff9ccc", "#ff7eb6", "#e93d9c"];
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI * (0.05 + 0.9 * azar());
    const d = 0.35 + 0.65 * azar();
    const r = 18 + azar() * 14;
    const cx = Math.min(ANCHO - r - 2, x + Math.cos(a) * d * 120);
    const cy = base - 196 + Math.sin(a) * d * 62;
    ovalo(p, cx, cy, r, r, rosas[i % 3] as string, 3);
  }
}

/** La tierra de la plaza con la rueda apisonada y matas de pasto alrededor. */
function plaza(p: Pincel): void {
  caja(p, 0, PISO, ANCHO, ALTO - PISO, TIERRA);
  caja(p, 0, PISO - 2, ANCHO, 5, TINTA);
  ovalo(p, 540, 452, 450, 92, RUEDA, 4);
  elipse(p, 540, 452, 270, 52);
  bordear(p, 3, "#9c5a40");
  const azar = sembrado(0x9a57);
  for (let i = 0; i < 90; i++) {
    const x = 12 + azar() * (ANCHO - 24), y = PISO + 14 + azar() * (ALTO - PISO - 24);
    if (((x - 540) / 470) ** 2 + ((y - 452) / 106) ** 2 < 1) continue;
    linea(p, [[x - 7, y - 12], [x, y], [x + 7, y - 13]], PASTO, 4);
    linea(p, [[x, y], [x + 1, y - 15]], PASTO, 4);
  }
  // Flores del toborochi caídas en la tierra.
  for (let i = 0; i < 26; i++) {
    const x = 16 + azar() * (ANCHO - 32), y = 570 + azar() * (ALTO - 590);
    ovalo(p, x, y, 7, 5, i % 2 ? "#ff7eb6" : "#e93d9c", 2);
  }
}

/* ------------------------------------------------------------- la gente */

interface Bailarin {
  x: number;
  y: number;
  u: number;
  tipoy: boolean;
  color: string;
  piel: string;
  pelo: string;
  flor: string;
  /** Los de atrás de la rueda miran al centro, o sea a la foto; los de adelante, de espaldas. */
  frente: boolean;
}

/** El sombrero de saó, con la cinta del color de la persona. */
function sombrero(p: Pincel, at: (x: number, y: number) => Punto, u: number, color: string, y: number): void {
  const [bx, by] = at(0, y);
  ovalo(p, bx, by, 24 * u, 5 * u, PAJA, 2.2 * u);
  poligono(p, [at(-11, y - 15), at(11, y - 15), at(11, y), at(-11, y)], PAJA, 2.2 * u);
  poligono(p, [at(-11, y - 7), at(11, y - 7), at(11, y - 3), at(-11, y - 3)], color);
}

/** Un bailarín de pie, con los pies en (x, y): el tipoy o la camisa blanca, sin los brazos (van aparte). */
function bailarin(p: Pincel, b: Bailarin): void {
  const { x, y, u } = b;
  const at = (lx: number, ly: number): Punto => [x + lx * u, y + ly * u];
  const o = (lx: number, ly: number, rx: number, ry: number, color: string, borde = 2.2): void =>
    ovalo(p, x + lx * u, y + ly * u, rx * u, ry * u, color, borde * u);
  for (const s of [-1, 1]) o(s * 7, -3, 7.5, 3.5, MADERA, 1.6);
  if (b.tipoy) {
    for (const s of [-1, 1]) poligono(p, [at(s * 3, -16), at(s * 9, -16), at(s * 9, -4), at(s * 3, -4)], b.piel, 1.8 * u);
    const tipoy = [at(-13, -100), at(13, -100), at(27, -10), at(-27, -10)];
    poligono(p, tipoy, BLANCO);
    poligono(p, [at(-24.2, -27), at(24.2, -27), at(25.6, -17), at(-25.6, -17)], b.color);
    poligono(p, [at(-13, -100), at(13, -100), at(13.8, -94), at(-13.8, -94)], b.color);
    linea(p, [...tipoy, tipoy[0] as Punto], TINTA, 2.8 * u);
    if (b.frente) for (let i = 0; i < 5; i++) o(-5 + i * 2.5, -91 + Math.abs(i - 2) * 0.8, 1.3, 1.3, i % 2 ? AMARILLO : "#d7263d", 0);
    // Las trenzas, con su cinta, y la cabeza.
    for (const s of [-1, 1]) {
      poligono(p, [at(s * 8, -114), at(s * 14, -114), at(s * 14, -86), at(s * 8, -86)], b.pelo, 1.5 * u);
      poligono(p, [at(s * 8, -91), at(s * 14, -91), at(s * 14, -87), at(s * 8, -87)], b.color);
    }
    o(0, -112, 12, 12, b.pelo, 2.2);
    if (b.frente) {
      o(0, -109, 9.5, 9, b.piel, 0);
      o(-3.6, -109, 1.5, 1.5, TINTA, 0);
      o(3.6, -109, 1.5, 1.5, TINTA, 0);
    }
    o(8, -121, 5, 5, b.flor, 1.5);
    o(8, -121, 1.8, 1.8, AMARILLO, 0);
  } else {
    for (const s of [-1, 1]) poligono(p, [at(s * 2, -56), at(s * 13, -56), at(s * 12, -5), at(s * 3, -5)], BLANCO, 2.4 * u);
    poligono(p, [at(-16, -100), at(16, -100), at(17, -50), at(-17, -50)], BLANCO, 2.6 * u);
    if (b.frente) poligono(p, [at(-10, -100), at(10, -100), at(0, -88)], b.color, 1.5 * u);
    else poligono(p, [at(-13, -100), at(13, -100), at(13, -95), at(-13, -95)], b.color);
    o(0, -112, 11.5, 11.5, b.piel, 2.2);
    if (b.frente) {
      o(-3.8, -111, 1.5, 1.5, TINTA, 0);
      o(3.8, -111, 1.5, 1.5, TINTA, 0);
    } else poligono(p, [at(-11, -116), at(11, -116), at(10, -108), at(-10, -108)], b.pelo);
    sombrero(p, at, u, b.color, -119);
  }
}

/** El hombro de un bailarín que da hacia un lado (s = -1 izquierda, 1 derecha). */
const hombro = (b: Bailarin, s: number): Punto => [b.x + s * 14 * b.u, b.y - 96 * b.u];

/** Un brazo, del hombro a la mano que toma la del vecino. */
function brazo(p: Pincel, b: Bailarin, s: number, mano: Punto): void {
  const h = hombro(b, s);
  const manga = b.tipoy ? b.piel : BLANCO;
  linea(p, [h, mano], TINTA, 11 * b.u + 3);
  linea(p, [h, mano], manga, 11 * b.u - 2);
}

/** La rueda: dieciséis tomados de la mano, alternando tipoy y camisa, los de atrás primero. */
function rueda(p: Pincel): void {
  const n = 16, cx = 540, cy = 452, rx = 405, ry = 78;
  const ronda: Bailarin[] = Array.from({ length: n }, (_, i) => {
    const a = Math.PI / n + (i * 2 * Math.PI) / n;
    const s = Math.sin(a);
    return {
      x: cx + rx * Math.cos(a),
      y: cy + ry * s,
      u: 0.9 + 0.3 * ((s + 1) / 2),
      tipoy: i % 2 === 0,
      color: franja(i),
      piel: PIELES[(i * 3) % 4] as string,
      pelo: PELOS[(i * 5) % 4] as string,
      flor: FLORES[i % 4] as string,
      frente: s < 0,
    };
  });
  // Las manos: entre cada uno y el que le sigue, un poco más abajo de los hombros.
  const manos: Punto[] = ronda.map((b, i) => {
    const c = ronda[(i + 1) % n] as Bailarin;
    const s = c.x >= b.x ? 1 : -1;
    const [ax, ay] = hombro(b, s), [bx, by] = hombro(c, -s);
    return [(ax + bx) / 2, (ay + by) / 2 + 24 * ((b.u + c.u) / 2)];
  });
  const orden = ronda.map((_, i) => i).sort((a, b) => (ronda[a] as Bailarin).y - (ronda[b] as Bailarin).y);
  for (const i of orden) {
    const b = ronda[i] as Bailarin;
    const antes = ronda[(i + n - 1) % n] as Bailarin;
    const despues = ronda[(i + 1) % n] as Bailarin;
    brazo(p, b, despues.x >= b.x ? 1 : -1, manos[i] as Punto);
    brazo(p, b, antes.x > b.x ? 1 : -1, manos[(i + n - 1) % n] as Punto);
    bailarin(p, b);
    for (const m of [manos[i] as Punto, manos[(i + n - 1) % n] as Punto]) ovalo(p, m[0], m[1], 5.5 * b.u, 5.5 * b.u, b.piel, 2 * b.u);
  }
}

/** Un músico del conjunto, de frente, en crema, con lo que toca. */
function musico(p: Pincel, x: number, y: number, u: number, color: string, piel: string, toca: "pifano" | "caja" | "bombo"): void {
  const at = (lx: number, ly: number): Punto => [x + lx * u, y + ly * u];
  const o = (lx: number, ly: number, rx: number, ry: number, c: string, borde = 2.4): void =>
    ovalo(p, x + lx * u, y + ly * u, rx * u, ry * u, c, borde * u);
  for (const s of [-1, 1]) o(s * 7, -3, 7.5, 3.5, MADERA, 1.6);
  for (const s of [-1, 1]) poligono(p, [at(s * 2, -56), at(s * 13, -56), at(s * 12, -5), at(s * 3, -5)], CREMA, 2.4 * u);
  poligono(p, [at(-16, -100), at(16, -100), at(17, -50), at(-17, -50)], CREMA, 2.6 * u);
  poligono(p, [at(-10, -100), at(10, -100), at(0, -88)], color, 1.5 * u);
  o(0, -112, 11.5, 11.5, piel);
  o(-3.8, -111, 1.5, 1.5, TINTA, 0);
  o(3.8, -111, 1.5, 1.5, TINTA, 0);
  sombrero(p, at, u, color, -119);
  const mano = (a: Punto, b: Punto): void => {
    linea(p, [a, b], TINTA, 10 * u + 3);
    linea(p, [a, b], CREMA, 10 * u - 2);
    ovalo(p, b[0], b[1], 5 * u, 5 * u, piel, 2 * u);
  };
  if (toca === "pifano") {
    linea(p, [at(-30, -128), at(-4, -104)], TINTA, 7 * u + 3);
    linea(p, [at(-30, -128), at(-4, -104)], "#d9b26a", 7 * u - 2);
    mano(at(-14, -96), at(-20, -118));
    mano(at(14, -96), at(-8, -108));
  } else if (toca === "caja") {
    mano(at(-14, -96), at(-16, -72));
    mano(at(14, -96), at(16, -72));
    caja(p, x - 22 * u, y - 72 * u, 44 * u, 24 * u, "#f0e6d2", 2.4 * u, 4);
    caja(p, x - 22 * u, y - 72 * u, 44 * u, 5 * u, "#d7263d");
    caja(p, x - 22 * u, y - 53 * u, 44 * u, 5 * u, "#d7263d");
    linea(p, [at(-16, -72), at(-8, -86)], MADERA, 3 * u);
    linea(p, [at(16, -72), at(24, -88)], MADERA, 3 * u);
  } else {
    mano(at(-14, -96), at(-10, -74));
    mano(at(14, -96), at(30, -114));
    caja(p, x + 2 * u, y - 86 * u, 40 * u, 40 * u, "#b5532f", 2.6 * u, 5);
    ovalo(p, x + 22 * u, y - 86 * u, 20 * u, 6 * u, CREMA, 2.4 * u);
    linea(p, [at(30, -114), at(26, -94)], MADERA, 3.5 * u);
    ovalo(p, x + 26 * u, y - 92 * u, 4 * u, 4 * u, CREMA, 1.6 * u);
  }
}

/** El conjunto, adelante a la derecha, en su tarima. */
function conjunto(p: Pincel): void {
  caja(p, 560, 770, 490, 30, "#7a5a3a", 4, 8);
  for (let x = 580; x < 1040; x += 70) linea(p, [[x, 772], [x, 798]], "#5f452c", 3);
  musico(p, 650, 772, 1.28, franja(0), PIELES[0], "pifano");
  musico(p, 800, 772, 1.28, franja(3), PIELES[1], "caja");
  musico(p, 950, 772, 1.28, franja(1), PIELES[2], "bombo");
}

/**
 * Chovena: la rueda tomada de la mano en la plaza de tierra colorada, de noche,
 * entre las casas de adobe y el toborochi, con faroles arriba y el conjunto
 * adelante. La rueda entera va en la ventana sin paneles (y = 250–540).
 */
export function fondoChovena(p: Pincel): void {
  estrellas(p, 0xc40e, 34, 20, 220);
  luna(p, 772, 178, 36);
  casas(p);
  plaza(p);
  toborochi(p, 1000, 350);
  faroles(p, 22, 44);
  rueda(p);
  conjunto(p);
}
