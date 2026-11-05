/**
 * El fondo dibujado de la foto del juego: una ilustración plana por juego, de
 * borde a borde, debajo de los paneles de tinta del texto y de la tarjeta
 * blanca del QR (`foto.ts`). Sin fotos ni imágenes: todo es Canvas 2D.
 *
 * Sigue el dibujo de la marca (`docs/marca.md`, «Cómo se dibuja»): formas
 * planas en colores macizos, sin degradados, brillos, desenfoque ni
 * transparencias; bordes gruesos de tinta, sombras duras corridas, la franja de
 * cinco colores, banderines y confeti. Las formas y colores salen de los
 * juegos: la llama de la carrera (`games/llamas/llama.ts`, `pixi-race.ts`) y el
 * cajón con la rana de bronce del sapo (`games/pixi/sapo.ts`), en su versión
 * de noche, que combina con el #171126 de la foto.
 *
 * Se diseña a 1080 × 1350 (la foto) y se escala al ancho y alto que lleguen.
 * Sin azar: lo que varía (estrellas, confeti) sale de una semilla fija, así que
 * dos dibujos son el mismo. El estado del lienzo queda como estaba.
 */

import {
  type Ctx,
  type Punto,
  ANCHO,
  ALTO,
  NOCHE,
  TINTA,
  SOMBRA,
  CREMA,
  AMARILLO,
  FRANJA,
  franja,
  type Pincel,
  acotar,
  trazar,
  bordear,
  rellenar,
  poligono,
  caja,
  linea,
  elipse,
  ovalo,
  aro,
  sembrado,
  oscuro,
  estrellas,
  confeti,
  comba,
  banderines,
  papelPicado,
} from "./fondos/lapiz";

function pata(p: Pincel, at: (x: number, y: number) => Punto, u: number, hx: number, a: number, b: number, color: string): void {
  const barra = (x0: number, y0: number, ang: number, largo: number, g: number): Punto => {
    const x1 = x0 + Math.sin(ang) * largo, y1 = y0 + Math.cos(ang) * largo;
    const nx = Math.cos(ang) * g, ny = -Math.sin(ang) * g;
    poligono(p, [at(x0 - nx, y0 - ny), at(x0 + nx, y0 + ny), at(x1 + nx, y1 + ny), at(x1 - nx, y1 - ny)], color, 2 * u);
    return [x1, y1];
  };
  const [kx, ky] = barra(hx, -31, a, 16, 3.4);
  const [fx, fy] = barra(kx, ky, b, 15, 2.8);
  const [px, py] = [Math.sin(b), Math.cos(b)];
  poligono(p, [at(fx - py * 3.6, fy + px * 3.6), at(fx + py * 3.6, fy - px * 3.6), at(fx + py * 3.6 + px * 4, fy - px * 3.6 + py * 4), at(fx - py * 3.6 + px * 4, fy + px * 3.6 + py * 4)], TINTA);
}

interface Corredora {
  /** Dónde pisa, en la foto. */
  x: number;
  y: number;
  /** El tamaño: 1 es la llama del juego (unos 100 px de alto). */
  u: number;
  pelaje: string;
  manta: string;
  /** La fase del galope, para que no corran todas con la misma pata. */
  fase: number;
  lider?: boolean;
}

/**
 * Las rayas de velocidad y el polvo que deja atrás. Van detrás del rabo (desde
 * 40 unidades a la izquierda de las pezuñas) y son cortas, para no llegar a la
 * llama de atrás: se pintan todas antes que las llamas.
 */
function estela(p: Pincel, l: Corredora): void {
  const { x, y, u } = l;
  [[-58, 32], [-44, 26], [-30, 20]].forEach(([dy, largo], i) => {
    caja(p, x - (40 + (largo as number)) * u - i * 6 * u, y + (dy as number) * u, (largo as number) * u, 5 * u, CREMA, 2 * u);
  });
  ovalo(p, x - 30 * u, y - 4 * u, 9 * u, 6 * u, "#8a6a52", 2 * u);
  ovalo(p, x - 44 * u, y - 10 * u, 6 * u, 4.5 * u, "#8a6a52", 2 * u);
}

/** Una llama de la carrera al galope, de perfil y mirando a la derecha, como la del juego (`llama.ts`). */
function llama(p: Pincel, l: Corredora): void {
  const { x, y, u, pelaje } = l;
  const at = (lx: number, ly: number): Punto => [x + lx * u, y + ly * u];
  const o = (lx: number, ly: number, rx: number, ry: number, color: string, borde = 2.2): void =>
    ovalo(p, x + lx * u, y + ly * u, rx * u, ry * u, color, borde * u);
  const lejos = oscuro(pelaje, 0.72);
  const s = Math.sin(l.fase), t = Math.sin(l.fase + 0.9);
  pata(p, at, u, -12, -0.55 * s, -0.55 * s + 0.3, lejos);
  pata(p, at, u, 15, 0.6 * t, 0.6 * t - 0.5, lejos);
  o(-27, -42, 6, 5, pelaje);
  for (let i = 0; i < 6; i++) o(-17 + i * 7, -44 + Math.sin(i * 1.7) * 1.5, 5.5, 5.5, pelaje, 0);
  o(0, -36, 24, 13, pelaje);
  poligono(p, [at(-15, -48), at(15, -48), at(15, -31), at(-15, -31)], l.manta, 2 * u);
  poligono(p, [at(-15, -43), at(15, -43), at(15, -40.6), at(-15, -40.6)], AMARILLO);
  poligono(p, [at(-15, -38.5), at(15, -38.5), at(15, -36.1), at(-15, -36.1)], "#2f9e44");
  pata(p, at, u, -16, 0.55 * s, 0.55 * s + 0.3, pelaje);
  pata(p, at, u, 11, -0.6 * t + 0.2, -0.6 * t - 0.3, pelaje);
  poligono(p, [at(10, -37), at(23, -41), at(30, -78), at(17, -78)], pelaje, 2.2 * u);
  poligono(p, [at(25, -84), at(28, -98), at(31, -84)], oscuro(pelaje, 0.85), 1.8 * u);
  o(25, -81, 11, 8, pelaje);
  poligono(p, [at(19, -85), at(21, -97), at(24, -85)], pelaje, 1.8 * u);
  o(33, -79, 5.5, 4.5, oscuro(pelaje, 0.8), 1.6);
  o(25, -83, 1.8, 1.8, TINTA, 0);
  if (l.lider) o(23, -96, 5, 5, AMARILLO, 2);
}

/** La luna llena, con dos cráteres. */
function luna(p: Pincel, x: number, y: number, r: number): void {
  ovalo(p, x, y, r, r, "#f4ecd8", 5, 8);
  ovalo(p, x - r * 0.3, y - r * 0.2, r * 0.18, r * 0.18, "#ddd2bb");
  ovalo(p, x + r * 0.32, y + r * 0.28, r * 0.12, r * 0.12, "#ddd2bb");
}

/** La nieve de un pico: el pico y un poco de cada ladera, con el borde de abajo en zigzag. */
function nieve(p: Pincel, a: Punto, pico: Punto, b: Punto, k: number): void {
  const en = (q: Punto, f: number): Punto => [pico[0] + (q[0] - pico[0]) * f, pico[1] + (q[1] - pico[1]) * f];
  const i = en(a, k), d = en(b, k);
  const medio: Punto = [(i[0] + d[0]) / 2, (i[1] + d[1]) / 2 - 10];
  poligono(p, [pico, d, [(d[0] + medio[0]) / 2, (d[1] + medio[1]) / 2 + 14], medio, [(i[0] + medio[0]) / 2, (i[1] + medio[1]) / 2 + 14], i], CREMA, 3);
}

/** Una cordillera de borde a borde, con nieve en los picos pedidos. */
function cordillera(p: Pincel, base: number, picos: readonly Punto[], color: string, nevados: readonly number[] = []): void {
  poligono(p, [[0, base], ...picos, [ANCHO, base]], color, 4);
  for (const i of nevados) {
    const a = picos[i - 1], pico = picos[i], b = picos[i + 1];
    if (a && pico && b) nieve(p, a, pico, b, 0.3);
  }
}

/** Dónde arranca la pista: la baranda, justo debajo de las cordilleras. */
const BARANDA = 446;

/** Los Andes de noche: tres cordilleras, la del fondo con nieve (la del Illimani en el medio). */
function andes(p: Pincel): void {
  cordillera(p, BARANDA, [[0, 330], [90, 300], [170, 325], [300, 262], [400, 318], [470, 296], [560, 330], [690, 244], [770, 290], [830, 272], [930, 322], [1000, 300], [1080, 326]], "#3b3563", [3, 7, 9]);
  cordillera(p, BARANDA, [[0, 392], [140, 352], [260, 392], [420, 362], [600, 400], [760, 356], [900, 390], [1080, 360]], "#2a2848");
  cordillera(p, BARANDA, [[0, 430], [200, 412], [380, 436], [560, 418], [760, 440], [940, 420], [1080, 434]], "#201d36");
}

/** La pista de tierra con sus carriles y la baranda de arriba; las rayas de los carriles, debajo de las llamas. */
function pista(p: Pincel): void {
  const arriba = BARANDA + 10, primera = 570;
  caja(p, 0, arriba, ANCHO, ALTO - arriba, "#3d2b22");
  const carril = (ALTO - primera) / 5;
  for (let k = 0; k < 5; k++) if (k % 2) caja(p, 0, primera + k * carril, ANCHO, carril, "#47332a");
  for (let k = 0; k < 5; k++) for (let x = 10; x + 40 <= ANCHO; x += 84) caja(p, x, primera - 2 + k * carril, 40, 5, CREMA);
  caja(p, 0, BARANDA - 4, ANCHO, 14, CREMA, 4);
  for (let i = 0, x = 30; x <= ANCHO - 30; i++, x += 88) ovalo(p, x, BARANDA + 3, 8, 8, i % 2 ? "#ff8b3d" : CREMA, 3);
}

/** La línea de meta: una tira a cuadros de tinta y crema que baja por la pista. */
function meta(p: Pincel, x: number): void {
  const lado = 20, y0 = BARANDA + 10;
  for (let r = 0, y = y0; y < ALTO; r++, y += lado) for (let k = 0; k < 2; k++) caja(p, x + k * lado, y, lado, Math.min(lado, ALTO - y), (r + k) % 2 ? TINTA : CREMA);
  linea(p, [[x, y0], [x, ALTO], [x + 2 * lado, ALTO], [x + 2 * lado, y0], [x, y0]], TINTA, 4);
}

/** La bandera a cuadros flameando, en su mástil. */
function bandera(p: Pincel, mastil: number, arriba: number): void {
  caja(p, mastil - 7, arriba, 14, BARANDA + 30 - arriba, CREMA, 4, 6);
  ovalo(p, mastil, arriba - 8, 12, 12, AMARILLO, 4);
  const cols = 5, filas = 3, lado = 34;
  const borde = (j: number): number => mastil - 7 - (cols - j) * lado;
  const ola = (j: number): number => Math.sin(j * 1.15) * 12;
  const y = (j: number, f: number): number => arriba + 8 + f * lado + ola(j);
  const contorno: Punto[] = [];
  for (let j = 0; j <= cols; j++) contorno.push([borde(j), y(j, 0)]);
  for (let j = cols; j >= 0; j--) contorno.push([borde(j), y(j, filas)]);
  poligono(p, contorno.map(([a, b]) => [a + 8, b + 8] as const), SOMBRA);
  for (let j = 0; j < cols; j++) {
    for (let f = 0; f < filas; f++) {
      poligono(p, [[borde(j), y(j, f)], [borde(j + 1), y(j + 1, f)], [borde(j + 1), y(j + 1, f + 1)], [borde(j), y(j, f + 1)]], (j + f) % 2 ? TINTA : CREMA);
    }
  }
  linea(p, [...contorno, contorno[0] as Punto], TINTA, 4);
}

/**
 * Carrera de llamas: la pista en el altiplano de noche, cuatro llamas al galope
 * y la meta a la derecha. La carrera entera (llamas, luna, bandera) va en la
 * franja libre de la foto del juego, y = 236–540, entre el panel de arriba y el
 * del nombre; abajo, detrás de los paneles y del QR, sigue la pista.
 */
function fondoCarrera(p: Pincel): void {
  estrellas(p, 0x11a3a, 46, 30, 330);
  luna(p, 486, 290, 40);
  andes(p);
  banderines(p, 24, 48);
  pista(p);
  meta(p, 992);
  const pelajes = ["#f3ead8", "#a0683a", "#e4c99a", "#c2bab0"];
  const corredoras: Corredora[] = [[130, 532], [350, 518], [570, 534], [790, 520]].map(([x, y], i) => ({
    x: x as number, y: y as number, u: 1.95, pelaje: pelajes[i] as string, manta: franja(i * 2 + 1), fase: i * 1.9, lider: i === 3,
  }));
  for (const l of corredoras) estela(p, l);
  for (const l of corredoras) llama(p, l);
  bandera(p, 1052, 272);
  confeti(p, 0x77c0f, 22, 560, 246, 860, 330);
}

/* ------------------------------------------------------------- el sapo */

/** El patio: la pared de adobe y el piso de baldosas, de noche. */
function patio(p: Pincel): void {
  const muro = 250, piso = 640;
  caja(p, 0, muro, ANCHO, piso - muro, "#251c3a");
  for (let fila = 0, y = muro + 4; y + 34 <= piso; fila++, y += 38) {
    for (let x = fila % 2 ? -60 : 0; x < ANCHO; x += 124) {
      const x0 = Math.max(0, x + 3), x1 = Math.min(ANCHO, x + 121);
      caja(p, x0, y, x1 - x0, 34, "#30254a");
    }
  }
  caja(p, 0, muro - 10, ANCHO, 14, "#4a3a66", 4);
  caja(p, 0, piso, ANCHO, ALTO - piso, "#1e1830");
  for (let y = piso + 6; y < ALTO; y += 92) for (let x = 4; x < ANCHO; x += 92) caja(p, x, y, Math.min(84, ANCHO - x), Math.min(84, ALTO - y), "#251d39");
  caja(p, 0, piso - 4, ANCHO, 8, TINTA);
}

/**
 * Un punto de la tapa del cajón: `a` de izquierda a derecha y `b` de atrás hacia
 * adelante, de 0 a 1. El fondo de la tapa, con la rana, queda en la franja libre
 * de la foto del juego (y = 236–540); el resto del cajón baja detrás de los paneles.
 */
const TAPA = { atras: 342, adelante: 780, izq: 250, der: 830, abre: 130 } as const;
function enTapa(a: number, b: number): Punto {
  const izq = TAPA.izq - TAPA.abre * b, der = TAPA.der + TAPA.abre * b;
  return [izq + (der - izq) * a, TAPA.atras + (TAPA.adelante - TAPA.atras) * b];
}

/** La guarda del aguayo en un borde de la tapa: triángulos de los cinco colores. */
function guarda(p: Pincel, b: number, alto: number): void {
  const n = 15;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = enTapa(i / n, b), [x1] = enTapa((i + 1) / n, b);
    poligono(p, [[x0, y0], [(x0 + x1) / 2, y0 + alto], [x1, y0]], franja(i));
  }
}

/** El cajón del sapo: la tapa de madera con vetas y guardas, el frente con los cajoncitos y las patas. */
function cajon(p: Pincel): void {
  const [ai, ad] = [enTapa(0, 0), enTapa(1, 0)];
  const [fi, fd] = [enTapa(0, 1), enTapa(1, 1)];
  const frente = 150;
  for (const x of [fi[0] + 24, fd[0] - 74]) caja(p, x, fi[1] + frente, 50, 170, "#5a2014", 5, 10);
  poligono(p, [ai, ad, fd, [fd[0], fd[1] + frente], [fi[0], fi[1] + frente], fi], SOMBRA, 0, 16);
  caja(p, fi[0], fi[1], fd[0] - fi[0], frente, "#7a2e1c", 6);
  for (let i = 0; i < 5; i++) {
    const cx = fi[0] + ((i + 0.5) * (fd[0] - fi[0])) / 5;
    caja(p, cx - 60, fi[1] + 30, 120, 90, "#5a2014", 4);
    ovalo(p, cx, fi[1] + 75, 9, 9, AMARILLO, 3);
  }
  poligono(p, [ai, ad, fd, fi], "#9a6a3c");
  for (let k = 1; k < 7; k++) linea(p, [enTapa(0.02, k / 7), enTapa(0.98, k / 7)], "#87592f", 3);
  guarda(p, 0, 16);
  guarda(p, 1, -22);
  linea(p, [ai, ad, fd, fi, ai], TINTA, 6);
}

/** Los agujeros de la tapa, cada uno con su aro de color. */
function agujeros(p: Pincel): void {
  const lugares: Punto[] = [[0.12, 0.24], [0.88, 0.24], [0.12, 0.56], [0.37, 0.56], [0.63, 0.56], [0.88, 0.56], [0.14, 0.85], [0.38, 0.85], [0.62, 0.85], [0.86, 0.85]];
  lugares.forEach(([a, b], i) => {
    const [x, y] = enTapa(a, b);
    const rx = 34 + 14 * b;
    ovalo(p, x, y, rx * 1.22, rx * 0.6, franja(i), 3);
    ovalo(p, x, y, rx, rx * 0.46, "#140f0a");
  });
}

/** La rana de bronce sentada al fondo de la tapa, con la boca abierta para la argolla (`sapo.ts`). */
function rana(p: Pincel, cx: number, cy: number, fr: number): void {
  const bronce = "#b98a3e", oscuroB = "#7d5a22";
  ovalo(p, cx + 12, cy + fr * 0.62, fr * 1.15, fr * 0.4, "#6b4a2a");
  for (const s of [-1, 1]) ovalo(p, cx + s * fr * 0.78, cy + fr * 0.38, fr * 0.42, fr * 0.3, oscuroB, 4);
  ovalo(p, cx, cy + fr * 0.1, fr * 0.95, fr * 0.72, bronce, 5, 10);
  for (const s of [-1, 1]) ovalo(p, cx + s * fr * 0.42, cy + fr * 0.74, fr * 0.22, fr * 0.1, oscuroB, 3);
  ovalo(p, cx, cy + fr * 0.36, fr * 0.6, fr * 0.3, "#d8b06a");
  for (const s of [-1, 1]) {
    ovalo(p, cx + s * fr * 0.5, cy - fr * 0.5, fr * 0.28, fr * 0.28, bronce, 4);
    ovalo(p, cx + s * fr * 0.5, cy - fr * 0.52, fr * 0.13, fr * 0.13, TINTA);
  }
  ovalo(p, cx - fr * 0.42, cy - fr * 0.12, fr * 0.2, fr * 0.08, "#fff1c4");
  const mx = fr * 0.55, my = fr * 0.34;
  ovalo(p, cx, cy + fr * 0.06, mx, my, TINTA);
  ovalo(p, cx, cy + fr * 0.06 + my * 0.35, mx * 0.5, my * 0.42, "#e0707a");
}

/** Las argollas en el aire hacia la boca, con la estela de puntos, y dos que ya cayeron en la tapa. */
function argollas(p: Pincel, boca: Punto): void {
  const desde: Punto = [1036, 520], cima: Punto = [860, 236];
  const en = (t: number): Punto => [
    (1 - t) ** 2 * desde[0] + 2 * (1 - t) * t * cima[0] + t * t * boca[0],
    (1 - t) ** 2 * desde[1] + 2 * (1 - t) * t * cima[1] + t * t * boca[1],
  ];
  for (let i = 1; i < 12; i++) {
    const [x, y] = en(i / 12);
    ovalo(p, x, y, 5, 5, CREMA, 2);
  }
  for (const [t, r] of [[0.3, 32], [0.66, 30]] as const) {
    const [x, y] = en(t);
    aro(p, x, y, r, r * 0.55, AMARILLO, 10);
  }
  aro(p, boca[0], boca[1] - 8, 26, 12, AMARILLO, 9);
  for (const [a, b] of [[0.26, 0.7], [0.74, 0.74]] as const) {
    const [x, y] = enTapa(a, b);
    aro(p, x, y, 28, 11, AMARILLO, 8);
  }
}

/** Sapo: el cajón con la rana de bronce en un patio de noche, papel picado arriba y argollas volando a la boca. */
function fondoSapo(p: Pincel): void {
  estrellas(p, 0x5a90, 26, 30, 236);
  patio(p);
  papelPicado(p, 26, 40, NOCHE);
  papelPicado(p, 232, 18, "#251c3a");
  cajon(p);
  agujeros(p);
  const [cx, cy] = enTapa(0.5, 0.18);
  rana(p, cx, cy, 110);
  confeti(p, 0x5a905, 14, 30, 380, 190, 540);
  argollas(p, [cx, cy + 110 * 0.06]);
}

/* ------------------------------------------------------------- la entrada */

const FONDOS = new Map<string, (p: Pincel) => void>([
  ["race", fondoCarrera],
  ["sapo", fondoSapo],
]);

/**
 * Pinta el fondo ilustrado del juego sobre todo el lienzo de `w` × `h` y
 * devuelve true. Un juego que todavía no tiene su ilustración no pinta nada y
 * devuelve false: la foto queda como siempre.
 */
export function pintarFondoJuego(c: CanvasRenderingContext2D, juego: string, w: number, h: number): boolean {
  const fondo = FONDOS.get(juego);
  if (!fondo) return false;
  c.save();
  c.lineJoin = "round";
  c.lineCap = "round";
  c.fillStyle = NOCHE;
  c.fillRect(0, 0, w, h);
  fondo({ c, fx: w / ANCHO, fy: h / ALTO });
  c.restore();
  return true;
}
