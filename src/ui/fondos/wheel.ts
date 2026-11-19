/**
 * El fondo de la ruleta para la foto del juego: la rueda de la fortuna de
 * feria de `games/pixi/wheel.ts` (gajos de los cinco colores, rayos de tinta,
 * pernos amarillos, el aro con foquitos, el cubo con la llamita y la flecha
 * arriba), parada en su caballete sobre un tablado, entre dos carpas a rayas,
 * de noche, con banderines.
 *
 * La rueda entera y su flecha van en la ventana libre de la foto, y = 250 a 540.
 * El caballete y el cajón de la base bajan detrás del panel del nombre y
 * asoman a su derecha junto con la carpa de ese lado; abajo sigue el tablado.
 */

import { type Pincel, type Punto, ANCHO, ALTO, TINTA, CREMA, AMARILLO, franja, caja, poligono, ovalo, linea, oscuro, estrellas, confeti, banderines } from "./lapiz";

/** La rueda: el centro y el radio del aro. */
const RUEDA = { x: 640, y: 404, r: 134 } as const;
const GAJOS = 10;
const TABLADO = 720;
const MADERA = "#7a2e1c";

/** Puntos sobre un arco de circunferencia, de `a0` a `a1`. */
function arco(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Punto[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });
}

/** La carpa de feria: el techo en punta con su faldón festoneado, la lona a rayas y el banderín en la punta. */
function carpa(p: Pincel, x0: number, x1: number, punta: number, alero: number, color: string): void {
  const cx = (x0 + x1) / 2, ancho = x1 - x0;
  const rayas = 6;
  caja(p, x0 + 10, alero, ancho - 20, TABLADO - alero, CREMA, 4, 10);
  for (let i = 0; i < rayas; i++) if (i % 2) caja(p, x0 + 10 + ((ancho - 20) * i) / rayas, alero, (ancho - 20) / rayas, TABLADO - alero, color, 0);
  linea(p, [[x0 + 10, alero], [x0 + 10, TABLADO], [x1 - 10, TABLADO], [x1 - 10, alero]], TINTA, 4);
  // La entrada: dos paños recogidos que dejan ver la noche de adentro.
  const ex = cx, eb = TABLADO, ea = alero + (TABLADO - alero) * 0.3;
  poligono(p, [[ex - 46, ea], [ex + 46, ea], [ex + 58, eb], [ex - 58, eb]], "#140f0a", 4);
  poligono(p, [[ex - 46, ea - 6], [ex, ea - 6], [ex - 58, eb]], color, 4);
  poligono(p, [[ex + 46, ea - 6], [ex, ea - 6], [ex + 58, eb]], color, 4);
  // El techo en gajos alternados, con el faldón de ondas.
  const gajos = 6;
  for (let i = 0; i < gajos; i++) {
    const a = x0 + (ancho * i) / gajos, b = x0 + (ancho * (i + 1)) / gajos;
    poligono(p, [[cx, punta], [b, alero], [a, alero]], i % 2 ? color : CREMA, 4, i === gajos - 1 ? 10 : 0);
  }
  for (let i = 0; i < gajos; i++) {
    const a = x0 + (ancho * i) / gajos, b = x0 + (ancho * (i + 1)) / gajos;
    poligono(p, arco((a + b) / 2, alero, (b - a) / 2, 0, Math.PI, 8), i % 2 ? CREMA : color, 3.5);
  }
  caja(p, cx - 4, punta - 46, 8, 48, CREMA, 3);
  poligono(p, [[cx + 4, punta - 46], [cx + 44, punta - 34], [cx + 4, punta - 22]], AMARILLO, 3.5);
}

/** El tablado de la feria: tablones de madera de borde a borde, con las juntas. */
function tablado(p: Pincel): void {
  caja(p, 0, TABLADO, ANCHO, ALTO - TABLADO, "#3a2418");
  for (let fila = 0, y = TABLADO + 10; y < ALTO; fila++, y += 46) {
    for (let x = fila % 2 ? -120 : 0; x < ANCHO; x += 240) {
      const x0 = Math.max(0, x + 4), x1 = Math.min(ANCHO, x + 236);
      if (x1 > x0) caja(p, x0, y, x1 - x0, Math.min(38, ALTO - y), "#46301f");
    }
  }
  caja(p, 0, TABLADO - 4, ANCHO, 10, TINTA);
}

/** El caballete: dos patas en A del cubo al tablado, el travesaño y el cajón pintado de la base. */
function caballete(p: Pincel): void {
  const { x, y } = RUEDA;
  const pie = TABLADO + 30;
  for (const s of [-1, 1]) poligono(p, [[x - 10 + s * 6, y], [x + 10 + s * 6, y], [x + s * 118 + 14, pie], [x + s * 118 - 14, pie]], MADERA, 5, 10);
  caja(p, x - 96, 640, 192, 18, oscuro(MADERA, 0.8), 4);
  caja(p, x - 150, pie - 4, 300, 64, AMARILLO, 5, 12);
  for (let i = 0; i < 5; i++) poligono(p, [[x - 130 + i * 56, pie + 52], [x - 102 + i * 56, pie + 8], [x - 74 + i * 56, pie + 52]], franja(i), 3);
}

/** Las rayas del giro: dos arcos crema con punta de flecha, a los costados de la rueda. */
function giro(p: Pincel): void {
  const { x, y, r } = RUEDA;
  for (const [a0, a1] of [[-2.55, -1.95], [0.35, 0.95]] as const) {
    const pts = arco(x, y, r + 30, a0, a1, 10);
    linea(p, pts, TINTA, 12);
    linea(p, pts, CREMA, 6);
    const [ux, uy] = pts[pts.length - 1] as Punto;
    const t = a1 + Math.PI / 2;
    const [tx, ty] = [Math.cos(t), Math.sin(t)];
    const [nx, ny] = [Math.cos(a1), Math.sin(a1)];
    poligono(p, [[ux + tx * 18, uy + ty * 18], [ux + nx * 13, uy + ny * 13], [ux - nx * 13, uy - ny * 13]], CREMA, 4);
  }
}

/** La rueda: el aro con foquitos, los gajos de colores con sus rayos de tinta, los pernos y el cubo con la llamita. */
function rueda(p: Pincel): void {
  const { x, y, r } = RUEDA;
  ovalo(p, x, y, r, r, "#2b1f4a", 6, 14);
  const ri = r * 0.8;
  const paso = (Math.PI * 2) / GAJOS;
  // Girada medio gajo: la flecha cae justo en el medio de uno, el ganador.
  const a0 = -Math.PI / 2 - paso / 2;
  for (let i = 0; i < GAJOS; i++) poligono(p, [[x, y], ...arco(x, y, ri, a0 + i * paso, a0 + (i + 1) * paso, 6)], franja(i), 3);
  // El gajo ganador, bajo la flecha, con una estrella crema.
  const [gx, gy] = [x, y - ri * 0.62];
  poligono(p, Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + (k / 10) * Math.PI * 2, rr = k % 2 ? 8 : 19;
    return [gx + Math.cos(a) * rr, gy + Math.sin(a) * rr] as const;
  }), CREMA, 2.5);
  for (let i = 0; i < GAJOS; i++) {
    const a = a0 + i * paso;
    linea(p, [[x, y], [x + Math.cos(a) * ri, y + Math.sin(a) * ri]], TINTA, 5);
  }
  linea(p, arco(x, y, ri, 0, Math.PI * 2, 48), TINTA, 5);
  // Los foquitos del aro: crema y amarillo, alternados.
  const focos = 20;
  for (let i = 0; i < focos; i++) {
    const a = -Math.PI / 2 + (i / focos) * Math.PI * 2;
    ovalo(p, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, 7.5, 7.5, i % 2 ? AMARILLO : CREMA, 3);
  }
  // Los pernos amarillos, en cada raya.
  for (let i = 0; i < GAJOS; i++) {
    const a = a0 + i * paso;
    const [px, py] = [x + Math.cos(a) * ri * 0.92, y + Math.sin(a) * ri * 0.92];
    poligono(p, [[px, py - 8], [px + 8, py], [px, py + 8], [px - 8, py]], AMARILLO, 2.5);
  }
  // El cubo, con la llamita rosa de la marca.
  const rh = r * 0.2;
  ovalo(p, x, y, rh, rh, CREMA, 5, 5);
  const sc = (rh * 1.25) / 26;
  const px = (rx: number, ry: number, rw: number, rh2: number): void => caja(p, x + (rx - 11) * sc, y + (ry - 11) * sc, rw * sc, rh2 * sc, "#ff5cb3");
  px(2, 11, 16, 7); px(15, 3, 4, 10); px(14, 0, 8, 4); px(20, -2, 2, 3); px(0, 9, 3, 4);
  px(3, 18, 2.5, 6); px(8, 18, 2.5, 6); px(12.5, 18, 2.5, 6); px(16, 18, 2.5, 6);
}

/** La flecha amarilla arriba, colgada de su perno, pinchando el gajo ganador. */
function flecha(p: Pincel): void {
  const { x, y, r } = RUEDA;
  const arriba = y - r - 18, punta = y - r * 0.7;
  poligono(p, [[x - 28, arriba], [x + 28, arriba], [x, punta]], AMARILLO, 5, 6);
  ovalo(p, x, arriba + 11, 7, 7, TINTA);
}

/**
 * Ruleta: la rueda de la fortuna de feria en su caballete, entre dos carpas a
 * rayas, con banderines arriba y confeti. La rueda y su flecha van enteras en
 * la ventana libre de la foto (y = 250 a 540).
 */
export function fondoRuleta(p: Pincel): void {
  estrellas(p, 0x3e7a1, 40, 30, 300);
  banderines(p, 24, 44);
  carpa(p, 20, 380, 262, 372, franja(0));
  carpa(p, 850, 1070, 286, 372, franja(4));
  tablado(p);
  caballete(p);
  giro(p);
  rueda(p);
  flecha(p);
  confeti(p, 0x3e7a2, 14, 410, 256, 500, 520);
  confeti(p, 0x3e7a3, 8, 790, 470, 850, 540);
}
