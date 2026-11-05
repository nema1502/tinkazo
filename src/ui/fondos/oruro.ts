/**
 * El fondo de La Entrada (el Carnaval de Oruro) en la foto del juego: la
 * máscara de la diablada, grande, con los cuernos anillados, los ojos
 * saltones, la culebra en la frente y los dientes de espejo
 * (`games/pixi/entrada-bailes.ts`). A la derecha, un arco de la ruta con sus
 * discos de plata y, detrás, el Santuario del Socavón al final de la entrada
 * (`games/pixi/oruro.ts`). Atrás, las fachadas coloniales con las ventanas
 * encendidas y la gradería con el público; arriba, los cohetillos; abajo, la
 * calle de adoquines con serpentinas y confeti.
 *
 * La máscara entera va en la ventana sin paneles de la foto del juego
 * (y = 250–540); lo demás llena los bordes que se asoman entre los paneles.
 */

import {
  type Pincel,
  type Punto,
  ANCHO,
  ALTO,
  TINTA,
  AMARILLO,
  franja,
  poligono,
  caja,
  linea,
  ovalo,
  sembrado,
  oscuro,
  estrellas,
  confeti,
} from "./lapiz";

/** Los colores de la máscara: solo ella los lleva. */
const ROJO = "#c62a1f";
const ORO = "#f2b632";
const ORO_OSCURO = "#b9832a";
const CULEBRA = "#2f9e44";
const OJO = "#fbf8f1";
const ESPEJO = "#dfe6ee";
const PLATA = "#c9ccd6";
const ARCO = "#d52b1e";

/** Donde empieza la calle: el pie de la gradería. */
const CALLE = 478;

/* ------------------------------------------------------------- el cielo */

/** Un cohetillo reventando: rayos finos de colores alrededor de un punto amarillo. */
function cohetillo(p: Pincel, x: number, y: number, r: number, de: number): void {
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n + de;
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy * 3.5, ny = ux * 3.5;
    const r0 = r * 0.32, r1 = i % 2 ? r * 0.8 : r;
    const m = (r0 + r1) / 2;
    poligono(p, [[x + ux * r0, y + uy * r0], [x + ux * m + nx, y + uy * m + ny], [x + ux * r1, y + uy * r1], [x + ux * m - nx, y + uy * m - ny]], franja(i + Math.round(de * 10)), 2);
  }
  ovalo(p, x, y, r * 0.16, r * 0.16, AMARILLO, 2.5);
}

/* ------------------------------------------------------------- la calle */

/** Las fachadas coloniales, de noche: colores pastel apagados, ventanas encendidas y balcones. */
function fachadas(p: Pincel): void {
  const pastel = ["#e9b8a5", "#a9d1c4", "#f3d37c", "#b9a6e0", "#f0a3b6", "#9ec3e6"];
  const azar = sembrado(0x0a00);
  for (let x = 0, i = 0; x < ANCHO; i++) {
    const w = Math.min(ANCHO - x, 130 + azar() * 80), alto = 150 + azar() * 40;
    const arriba = CALLE - 40 - alto;
    caja(p, x, arriba, w, alto + 40, oscuro(pastel[i % 6] as string, 0.62), 3);
    caja(p, x, arriba, w, 10, oscuro(pastel[i % 6] as string, 0.45));
    for (let wy = arriba + 24; wy + 30 < CALLE - 50; wy += 48) {
      for (let wx = x + 16; wx + 18 <= x + w - 12; wx += 36) caja(p, wx, wy, 18, 26, azar() < 0.62 ? "#ffd27a" : "#3a2f55", 2);
      caja(p, x + 8, wy + 30, Math.max(0, w - 16), 5, TINTA);
    }
    x += w;
  }
}

/** La gradería con el público: filas de cabezas y camisas de colores. */
function graderia(p: Pincel): void {
  caja(p, 0, CALLE - 52, ANCHO, 40, "#2b2640", 3);
  const azar = sembrado(0x9e7e);
  const pieles = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69"];
  const camisas = ["#ff5cb3", "#ff8b3d", "#17c3b2", "#9b7bff", "#ffd24d", "#f6efe2"];
  for (let fila = 0; fila < 2; fila++) {
    const y = CALLE - 30 + fila * 14;
    for (let x = 10 + fila * 11 + azar() * 6; x + 8 < ANCHO; x += 22 + azar() * 6) {
      caja(p, x - 7, y - 8, 14, 12, camisas[Math.floor(azar() * camisas.length)] as string, 1.5);
      ovalo(p, x, y - 13, 5, 5, pieles[Math.floor(azar() * 4)] as string, 1.5);
    }
  }
  caja(p, 0, CALLE - 12, ANCHO, 14, "#4d4760", 3);
}

/** La calle de adoquines, de borde a borde y hasta abajo. */
function calle(p: Pincel): void {
  caja(p, 0, CALLE, ANCHO, ALTO - CALLE, "#3a3346");
  for (let fila = 0, y = CALLE + 8; y < ALTO; fila++, y += 34) {
    for (let x = fila % 2 ? -26 : 0; x < ANCHO; x += 52) {
      const x0 = Math.max(0, x + 3), x1 = Math.min(ANCHO, x + 49);
      caja(p, x0, y, x1 - x0, Math.min(28, ALTO - y), "#433b52");
    }
  }
}

/** Una serpentina: una tira ondulada de color con su borde de tinta. */
function serpentina(p: Pincel, x0: number, y0: number, largo: number, alto: number, vueltas: number, color: string): void {
  const pts: Punto[] = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return [x0 + t * largo, y0 + Math.sin(t * Math.PI * 2 * vueltas) * alto + t * alto * 0.6] as const;
  });
  linea(p, pts, TINTA, 12);
  linea(p, pts, color, 6);
}

/* ------------------------------------------------------------- el Socavón y el arco */

/** El Santuario del Socavón: la nave, la torre de techo rojo con la cruz, la puerta y el rosetón. */
function socavon(p: Pincel, cx: number, base: number, k: number): void {
  const X = (d: number): number => cx + d * k, Y = (d: number): number => base - d * k;
  caja(p, X(-110), Y(230), 220 * k, 230 * k, "#f4ecd8", 3, 8);
  poligono(p, [[X(-120), Y(230)], [X(0), Y(290)], [X(120), Y(230)]], "#f4ecd8", 3, 6);
  caja(p, X(-150), Y(300), 60 * k, 300 * k, "#f4ecd8", 3, 8);
  poligono(p, [[X(-160), Y(300)], [X(-120), Y(360)], [X(-80), Y(300)]], "#d52b1e", 3);
  caja(p, X(-124), Y(400), 8 * k, 40 * k, TINTA);
  caja(p, X(-134), Y(386), 28 * k, 8 * k, TINTA);
  ovalo(p, X(-120), Y(260), 14 * k, 14 * k, AMARILLO, 2.5);
  caja(p, X(-128), Y(200), 16 * k, 30 * k, "#3a2f55", 2);
  ovalo(p, X(0), Y(180), 22 * k, 22 * k, "#9ec3e6", 3);
  poligono(p, [[X(-34), Y(0)], [X(-34), Y(86)], [X(-24), Y(110)], [X(0), Y(120)], [X(24), Y(110)], [X(34), Y(86)], [X(34), Y(0)]], "#5b3a29", 3);
  caja(p, X(-110), Y(10), 220 * k, 10 * k, "#d8cdb6");
}

/** Un arco de la ruta: dos postes de plata, la viga roja con discos de plata y las tiras de aguayo colgando. */
function arco(p: Pincel, x0: number, x1: number, arriba: number, abajo: number): void {
  for (const x of [x0, x1 - 26]) {
    caja(p, x, arriba, 26, abajo - arriba, PLATA, 4, 8);
    for (let y = arriba + 60; y < abajo - 20; y += 56) caja(p, x, y, 26, 8, "#8f93a3");
  }
  caja(p, x0 - 14, arriba, x1 - x0 + 28, 38, ARCO, 4, 8);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const x = x0 + 8 + ((i + 0.5) * (x1 - x0 - 16)) / n;
    ovalo(p, x, arriba + 19, 11, 11, PLATA, 2.5);
    ovalo(p, x, arriba + 19, 4.5, 4.5, "#8f93a3");
  }
  for (let i = 0; i < 12; i++) {
    const a = x0 + 30 + (i * (x1 - x0 - 60)) / 11;
    poligono(p, [[a - 12, arriba + 38], [a + 12, arriba + 38], [a, arriba + 64]], franja(i), 2.5);
  }
}

/* ------------------------------------------------------------- la máscara */

/** Un cuerno anillado, de la sien hacia afuera y arriba (s = -1 izquierda, 1 derecha), a escala `k`. */
function cuerno(p: Pincel, cx: number, cy: number, s: number, k: number): void {
  const a: Punto = [cx + s * 66 * k, cy - 66 * k], c: Punto = [cx + s * 205 * k, cy - 60 * k], b: Punto = [cx + s * 222 * k, cy - 134 * k];
  const en = (t: number): Punto => [
    (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
  ];
  const lado = (t: number, signo: number): Punto => {
    const [x, y] = en(t), [x2, y2] = en(Math.min(1, t + 0.01)), [x1, y1] = en(Math.max(0, t - 0.01));
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
    const g = (38 * (1 - t) + 2) * k;
    return [x - (dy / d) * g * signo, y + (dx / d) * g * signo];
  };
  const pasos = Array.from({ length: 21 }, (_, i) => i / 20);
  poligono(p, [...pasos.map((t) => lado(t, 1)), ...[...pasos].reverse().map((t) => lado(t, -1))], ORO, 4, 8);
  for (let i = 1; i < 8; i++) {
    const t = i / 9;
    linea(p, [lado(t, 0.86), lado(t, -0.86)], ORO_OSCURO, 5);
  }
}

/** Un ojo saltón: el aro de oro, el blanco, la pupila verde y el brillo. */
function ojo(p: Pincel, x: number, y: number, k: number): void {
  ovalo(p, x, y, 36 * k, 34 * k, ORO, 4, 5);
  ovalo(p, x, y, 27 * k, 25 * k, OJO, 3);
  ovalo(p, x + 2 * k, y + 2 * k, 13 * k, 13 * k, "#1f7a3a", 2.5);
  ovalo(p, x + 2 * k, y + 2 * k, 6 * k, 6 * k, TINTA);
  ovalo(p, x - 4 * k, y - 4 * k, 3.5 * k, 3.5 * k, OJO);
}

/** El sol de la fiesta detrás de la máscara: rayos finos y largos de los cinco colores. */
function sol(p: Pincel, cx: number, cy: number, rx: number, ry: number): void {
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n + 0.09, d = 0.06, largo = i % 2 ? 0.82 : 1;
    const punta = (b: number): Punto => [cx + Math.cos(b) * rx * largo, cy + Math.sin(b) * ry * largo];
    poligono(p, [[cx + Math.cos(a) * 60, cy + Math.sin(a) * 50], punta(a - d), punta(a + d)], franja(i), 3.5, 5);
  }
}

/** La máscara de la diablada, de frente, con el centro de la cara en (cx, cy) y a escala `k`. */
function mascara(p: Pincel, cx: number, cy: number, k: number): void {
  const at = (dx: number, dy: number): Punto => [cx + dx * k, cy + dy * k];
  const o = (dx: number, dy: number, rx: number, ry: number, color: string, borde = 0, sombra = 0): void =>
    ovalo(p, cx + dx * k, cy + dy * k, rx * k, ry * k, color, borde, sombra);
  cuerno(p, cx, cy, -1, k);
  cuerno(p, cx, cy, 1, k);
  // Las orejas puntudas.
  for (const s of [-1, 1]) poligono(p, [at(s * 112, -46), at(s * 182, -70), at(s * 126, 22)], ROJO, 4, 6);
  o(0, 0, 128, 112, ROJO, 5, 10);
  // Las lentejuelas de oro por el borde de la cara.
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (0.12 + (i * 0.76) / 13);
    o(Math.cos(a) * 112, Math.sin(a) * 96, 5, 5, AMARILLO, 1.8);
  }
  // Las cejas de llama, verdes, sobre los ojos.
  for (const s of [-1, 1]) {
    poligono(p, [at(s * 14, -44), at(s * 34, -74), at(s * 44, -56), at(s * 62, -86), at(s * 72, -62), at(s * 96, -80), at(s * 94, -46), at(s * 54, -52)], CULEBRA, 3.5);
  }
  // La culebra de la frente, que sube haciendo eses hasta su cabeza.
  const cuerpo: Punto[] = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16;
    return at(Math.sin(t * Math.PI * 2) * 16, -30 - t * 70);
  });
  linea(p, cuerpo, TINTA, 22 * k);
  linea(p, cuerpo, CULEBRA, 14 * k);
  for (let i = 2; i < 16; i += 3) {
    const [x, y] = cuerpo[i] as Punto;
    ovalo(p, x, y, 3 * k, 3 * k, AMARILLO);
  }
  o(4, -110, 17, 12, CULEBRA, 3.5);
  o(-3, -113, 3, 3, TINTA);
  o(11, -113, 3, 3, TINTA);
  for (const s of [-1, 1]) ojo(p, cx + s * 56 * k, cy - 14 * k, k);
  // La nariz ganchuda, con las narinas.
  poligono(p, [at(-14, -2), at(14, -2), at(30, 34), at(16, 44), at(-16, 44), at(-30, 34)], "#9e1f17", 3.5, 4);
  for (const s of [-1, 1]) o(s * 11, 36, 6, 4, TINTA);
  // La boca abierta con los dientes de espejo y los colmillos.
  const boca: Punto[] = [at(-82, 52), at(82, 52), at(62, 92), at(-62, 92)];
  poligono(p, boca, TINTA);
  poligono(p, [at(-40, 74), at(40, 74), at(30, 90), at(-30, 90)], "#e0707a");
  for (let i = 0; i < 8; i++) poligono(p, [at(-68 + i * 17, 52), at(-53 + i * 17, 52), at(-53 + i * 17, 66), at(-68 + i * 17, 66)], ESPEJO, 2);
  for (const s of [-1, 1]) poligono(p, [at(s * 82, 52), at(s * 60, 52), at(s * 70, 96)], OJO, 2.5);
  linea(p, [...boca, boca[0] as Punto], TINTA, 4);
  // Los espejitos de las mejillas.
  for (const s of [-1, 1]) o(s * 100, 30, 10, 10, ESPEJO, 2.5);
}

/**
 * La Entrada: la máscara de la diablada en la ventana sin paneles, el arco de
 * la ruta con el Socavón detrás a la derecha, cohetillos en el cielo y la
 * calle de adoquines con serpentinas abajo.
 */
export function fondoOruro(p: Pincel): void {
  estrellas(p, 0x0a0a, 30, 20, 230);
  fachadas(p);
  socavon(p, 850, CALLE - 8, 0.74);
  graderia(p);
  calle(p);
  cohetillo(p, 700, 66, 44, 0);
  cohetillo(p, 880, 50, 34, 0.3);
  cohetillo(p, 1020, 76, 40, 0.1);
  arco(p, 640, 1060, 128, 640);
  sol(p, 370, 405, 290, 150);
  confeti(p, 0x0a0c, 12, 20, 262, 120, 330);
  mascara(p, 370, 405, 1.1);
  confeti(p, 0x0a0d, 26, 520, 660, 1060, 800);
  confeti(p, 0x0a0e, 14, 20, 1290, 1060, 1336);
  serpentina(p, 560, 600, 480, 22, 2.5, franja(0));
  serpentina(p, 540, 730, 500, 18, 3, franja(3));
  serpentina(p, 30, 1300, 1000, 14, 5, franja(4));
}
