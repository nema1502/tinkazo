/**
 * El fondo del Trompo (`games/pixi/trompo.ts`, `tres/trompo-3d.ts`): el patio
 * de tierra de noche, con la pared de adobe, banderines y el ruedo de tiza.
 * En el medio baila el trompo de madera con sus franjas de colores, con los
 * arcos del giro y el polvo en la púa; desde la izquierda lo embiste otro y el
 * choque revienta en una estrella amarilla con chispas.
 *
 * Los dos trompos y el choque van en la ventana libre de la foto del juego
 * (y = 250–540); abajo, detrás de los paneles y del QR, sigue el ruedo, con la
 * piola tirada y un trompo caído que asoman a la derecha del nombre.
 */

import { type Pincel, type Punto, ANCHO, ALTO, TINTA, CREMA, AMARILLO, franja, poligono, caja, linea, ovalo, sembrado, oscuro, estrellas, banderines } from "./lapiz";

/** La madera del trompo, la tapa más clara y la púa de metal. */
const MADERA = "#c98a4b";
const TAPA = "#e3b277";
const PUA = "#9aa1ad";
/** La tierra del patio, las piedritas, el polvo y la tiza. */
const TIERRA = "#3a2a1f";
const PIEDRA = "#5b4636";
const POLVO = "#9a846c";
const TIZA = "#f1ece2";

/** El perfil del trompo: medio ancho a cada altura, de la punta de la madera (-0.22) a la tapa (-0.92). */
const PERFIL: ReadonlyArray<readonly [number, number]> = [[0.16, -0.22], [0.3, -0.34], [0.42, -0.5], [0.49, -0.66], [0.5, -0.8], [0.47, -0.92]];
function medio(ly: number): number {
  for (let i = 1; i < PERFIL.length; i++) {
    const [w0, y0] = PERFIL[i - 1] as readonly [number, number], [w1, y1] = PERFIL[i] as readonly [number, number];
    if (ly >= y1) return w0 + ((ly - y0) / (y1 - y0)) * (w1 - w0);
  }
  return 0.47;
}

/** Un trompo parado en su púa (`x`, `y`), de alto `u`, inclinado `ang` (positivo: la cabeza va a la derecha). */
interface Trompo {
  x: number;
  y: number;
  u: number;
  ang: number;
  franjas: readonly string[];
}

/** De las unidades del trompo a la foto: (0, 0) es la punta, arriba es negativo. */
function enTrompo(t: Trompo): (lx: number, ly: number) => Punto {
  const c = Math.cos(t.ang), s = Math.sin(t.ang);
  return (lx, ly) => [t.x + (lx * c - ly * s) * t.u, t.y + (lx * s + ly * c) * t.u];
}

/** El borde de una franja a la altura `ly`: la curva de adelante, de `a` a `b` del ancho (-1 a 1). */
function curva(ly: number, a: number, b: number): Array<readonly [number, number]> {
  const w = medio(ly), n = 8, pts: Array<readonly [number, number]> = [];
  for (let k = 0; k <= n; k++) {
    const t = a + ((b - a) * k) / n;
    pts.push([t * w, ly + 0.11 * w * Math.sqrt(Math.max(0, 1 - t * t))]);
  }
  return pts;
}

/** Un trompo de madera: la púa, el cuerpo con franjas (la mitad derecha en sombra), la tapa y la cabeza. */
function trompo(p: Pincel, t: Trompo): void {
  const at = enTrompo(t);
  const g = 4.5 * (t.u / 270) + 1.5;
  poligono(p, [at(-0.08, -0.22), at(0.08, -0.22), at(0.025, -0.03), at(0, 0), at(-0.025, -0.03)], PUA, g);
  // El cuerpo, de abajo hacia arriba en tramos: madera y franjas, cada uno con su lado de sombra.
  const cortes = [-0.22, -0.34, -0.42, -0.52, -0.6, -0.7, -0.78, -0.92];
  for (let i = 0; i + 1 < cortes.length; i++) {
    const a = cortes[i] as number, b = cortes[i + 1] as number;
    const color = i % 2 ? (t.franjas[(i - 1) / 2 % t.franjas.length] as string) : MADERA;
    const tramo = (d0: number, d1: number, c: string): void => {
      const abajo = curva(a, d0, d1), arriba = curva(b, d1, d0);
      poligono(p, [...abajo, ...arriba].map(([lx, ly]) => at(lx, ly)), c);
    };
    tramo(-1, 0.35, color);
    tramo(0.35, 1, oscuro(color, 0.72));
  }
  const silueta: Array<readonly [number, number]> = [...PERFIL.map(([w, ly]) => [-w, ly] as const).reverse(), ...curva(-0.22, -1, 1).slice(1, -1), ...PERFIL.map(([w, ly]) => [w, ly] as const)];
  linea(p, [...silueta, silueta[0] as readonly [number, number]].map(([lx, ly]) => at(lx, ly)), TINTA, g);
  // La tapa, vista desde arriba, y la cabeza.
  const tapa: Punto[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    tapa.push(at(Math.cos(a) * 0.47, -0.92 + Math.sin(a) * 0.13));
  }
  poligono(p, tapa, TAPA, g);
  poligono(p, [at(-0.1, -0.9), at(0.1, -0.9), at(0.08, -1.05), at(-0.08, -1.05)], oscuro(MADERA, 0.6), g);
  poligono(p, [at(-0.08, -1.05), at(0, -1.08), at(0.08, -1.05), at(0, -1.02)], TINTA);
}

/** Un arco de una elipse, de `a0` a `a1` (radianes), como camino abierto. */
function arco(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Punto[] {
  const n = 14, pts: Punto[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Una raya de movimiento: crema con su borde de tinta. */
function raya(p: Pincel, pts: readonly Punto[], ancho: number): void {
  linea(p, pts, TINTA, ancho + 6);
  linea(p, pts, CREMA, ancho);
}

/** Los arcos del giro alrededor del cuerpo y el surco en la tierra alrededor de la púa. */
function giro(p: Pincel, t: Trompo): void {
  const at = enTrompo(t);
  const [cx, cy] = at(0, -0.62);
  const rx = t.u * 0.68, ry = t.u * 0.16;
  raya(p, arco(cx, cy, rx, ry, Math.PI * 0.62, Math.PI * 0.98), 7);
  raya(p, arco(cx, cy, rx, ry, Math.PI * 0.02, Math.PI * 0.38), 7);
  const [hx, hy] = at(0, -0.92);
  raya(p, arco(hx, hy, t.u * 0.6, t.u * 0.14, Math.PI * 1.12, Math.PI * 1.36), 5);
  raya(p, arco(hx, hy, t.u * 0.6, t.u * 0.14, Math.PI * 1.64, Math.PI * 1.88), 5);
}

/** El surco y el polvo que levanta la púa al bailar. */
function polvo(p: Pincel, x: number, y: number, k: number): void {
  linea(p, arco(x, y, 70 * k, 15 * k, 0, Math.PI * 2), PIEDRA, 6 * k);
  for (const [dx, dy, r] of [[-62, -6, 15], [-40, 4, 11], [54, -4, 14], [76, 4, 9], [30, 8, 8]] as const) {
    ovalo(p, x + dx * k, y + dy * k, r * k, r * 0.7 * k, POLVO, 3);
  }
}

/** La estrella del choque: dos estrellas de puntas, amarilla y crema, y chispas que salen de costado. */
function choque(p: Pincel, x: number, y: number): void {
  const estrella = (r0: number, r1: number, n: number, giroA: number): Punto[] =>
    Array.from({ length: n * 2 }, (_, k) => {
      const a = giroA + (k / (n * 2)) * Math.PI * 2, r = k % 2 ? r1 : r0;
      return [x + Math.cos(a) * r, y + Math.sin(a) * r] as const;
    });
  poligono(p, estrella(66, 30, 9, 0.2), AMARILLO, 5, 8);
  poligono(p, estrella(34, 16, 7, 0.5), CREMA, 3);
  const azar = sembrado(0xc40e);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.94 + (i / 6) * Math.PI * 0.5 + (azar() - 0.5) * 0.12;
    const d0 = 82 + azar() * 10, d1 = d0 + 22 + azar() * 22;
    linea(p, [[x + Math.cos(a) * d0, y + Math.sin(a) * d0], [x + Math.cos(a) * d1, y + Math.sin(a) * d1]], TINTA, 10);
    linea(p, [[x + Math.cos(a) * d0, y + Math.sin(a) * d0], [x + Math.cos(a) * d1, y + Math.sin(a) * d1]], i % 2 ? AMARILLO : franja(1), 5);
  }
}

/** La pared de adobe del fondo del patio, con su remate. */
function pared(p: Pincel): void {
  const arriba = 196, abajo = 336;
  caja(p, 0, arriba, ANCHO, abajo - arriba, "#3d2a34");
  for (let fila = 0, y = arriba + 6; y + 28 <= abajo; fila++, y += 32) {
    for (let x = fila % 2 ? -56 : 0; x < ANCHO; x += 112) {
      const x0 = Math.max(0, x + 3), x1 = Math.min(ANCHO, x + 109);
      caja(p, x0, y, x1 - x0, 28, "#4a3340");
    }
  }
  caja(p, 0, arriba - 14, ANCHO, 18, "#6b4a52", 4);
}

/** El piso de tierra con piedritas sembradas. */
function patioDeTierra(p: Pincel): void {
  const arriba = 336;
  caja(p, 0, arriba, ANCHO, ALTO - arriba, TIERRA);
  caja(p, 0, arriba - 3, ANCHO, 7, TINTA);
  const azar = sembrado(0x7409);
  for (let i = 0; i < 110; i++) {
    const rx = 3 + azar() * 6, ry = rx * 0.6;
    const x = 12 + azar() * (ANCHO - 24), y = arriba + 16 + azar() * (ALTO - arriba - 30);
    ovalo(p, x, y, rx, ry, i % 4 ? PIEDRA : "#4a382b");
  }
}

/** El ruedo de tiza: una elipse grande hecha de trazos, con huecos donde la tiza se gastó. */
function ruedo(p: Pincel): void {
  const cx = 540, cy = 660, rx = 500, ry = 262;
  ovalo(p, cx, cy, rx - 12, ry - 10, "#45332a");
  const azar = sembrado(0x12ed0);
  const tramos = 26;
  for (let k = 0; k < tramos; k++) {
    const a0 = (k / tramos) * Math.PI * 2 + azar() * 0.04, a1 = ((k + 1) / tramos) * Math.PI * 2 - 0.05 - azar() * 0.08;
    linea(p, arco(cx, cy, rx, ry, a0, a1), TIZA, 9);
  }
}

/** La piola tirada en el suelo, con su vuelta y la chapita en la punta. */
function piola(p: Pincel): void {
  const pts: Punto[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const x = 560 + t * 400 + Math.sin(t * Math.PI * 2) * 40;
    const y = 624 - Math.cos(t * Math.PI * 2) * 34 + t * 40;
    pts.push([x, y]);
  }
  linea(p, pts, TINTA, 12);
  linea(p, pts, "#e8dcc0", 6);
  const [ex, ey] = pts[pts.length - 1] as Punto;
  const corona: Punto[] = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2, r = k % 2 ? 21 : 25;
    return [ex + 20 + Math.cos(a) * r, ey + Math.sin(a) * r * 0.62] as const;
  });
  poligono(p, corona, franja(0), 4, 5);
  ovalo(p, ex + 20, ey, 13, 8, oscuro(franja(0), 0.75), 3);
}

/**
 * Trompo: el patio de noche con el ruedo de tiza; en el medio baila el trompo
 * grande, con los arcos del giro, y el otro lo choca desde la izquierda. Los
 * dos y el choque caben en y = 250–540.
 */
export function fondoTrompo(p: Pincel): void {
  estrellas(p, 0x7a0b0, 36, 24, 180);
  pared(p);
  banderines(p, 24, 40);
  patioDeTierra(p);
  ruedo(p);
  piola(p);
  trompo(p, { x: 700, y: 742, u: 140, ang: 1.42, franjas: [franja(3), AMARILLO, franja(4)] });
  const grande: Trompo = { x: 636, y: 532, u: 250, ang: -0.07, franjas: [franja(0), AMARILLO, franja(3)] };
  const otro: Trompo = { x: 300, y: 520, u: 190, ang: 0.36, franjas: [franja(4), franja(1), CREMA] };
  polvo(p, grande.x, grande.y, 1);
  polvo(p, otro.x, otro.y, 0.75);
  trompo(p, otro);
  trompo(p, grande);
  giro(p, grande);
  choque(p, 482, 372);
}
