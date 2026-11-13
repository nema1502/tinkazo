/**
 * Los pinceles de los fondos de la foto del juego: colores de la marca, contornos de tinta, sombras duras, estrellas,
 * confeti, banderines y papel picado. Los usan `foto-fondos.ts` y cada fondo de `fondos/`.
 */
export type Ctx = CanvasRenderingContext2D;
export type Punto = readonly [number, number];

export const ANCHO = 1080;
export const ALTO = 1350;
export const NOCHE = "#171126";
export const TINTA = "#191919";
export const SOMBRA = "#0b0814";
export const CREMA = "#f6efe2";
export const AMARILLO = "#ffc629";
export const FRANJA = ["#ff5cb3", "#ff8b3d", "#ffd24d", "#17c3b2", "#9b7bff"] as const;
export const franja = (i: number): string => FRANJA[((i % 5) + 5) % 5] as string;

/** El lienzo y la escala del diseño de 1080 × 1350 al tamaño de verdad. */
export interface Pincel {
  c: Ctx;
  fx: number;
  fy: number;
}

/* ------------------------------------------------------------- piezas */

export const acotar = (v: number, max: number): number => Math.min(max, Math.max(0, v));

/** El camino cerrado de un polígono, sin salirse de la foto. */
export function trazar(p: Pincel, pts: readonly Punto[], cerrar = true): void {
  p.c.beginPath();
  pts.forEach(([x, y], i) => {
    const X = acotar(x, ANCHO) * p.fx;
    const Y = acotar(y, ALTO) * p.fy;
    if (i === 0) p.c.moveTo(X, Y);
    else p.c.lineTo(X, Y);
  });
  if (cerrar) p.c.closePath();
}

export function bordear(p: Pincel, ancho: number, color = TINTA): void {
  if (ancho <= 0) return;
  p.c.lineWidth = ancho * Math.min(p.fx, p.fy);
  p.c.strokeStyle = color;
  p.c.stroke();
}

export function rellenar(p: Pincel, color: string): void {
  p.c.fillStyle = color;
  p.c.fill();
}

/** Un polígono plano, con su borde de tinta y, si se pide, la sombra dura corrida abajo a la derecha. */
export function poligono(p: Pincel, pts: readonly Punto[], color: string, borde = 0, sombra = 0): void {
  if (sombra > 0) {
    trazar(p, pts.map(([x, y]) => [x + sombra, y + sombra] as const));
    rellenar(p, SOMBRA);
  }
  trazar(p, pts);
  rellenar(p, color);
  bordear(p, borde);
}

export function caja(p: Pincel, x: number, y: number, w: number, h: number, color: string, borde = 0, sombra = 0): void {
  poligono(p, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color, borde, sombra);
}

/** Una línea abierta, de un color y un ancho. */
export function linea(p: Pincel, pts: readonly Punto[], color: string, ancho: number): void {
  trazar(p, pts, false);
  bordear(p, ancho, color);
}

export function elipse(p: Pincel, x: number, y: number, rx: number, ry: number): void {
  p.c.beginPath();
  p.c.ellipse(x * p.fx, y * p.fy, rx * p.fx, ry * p.fy, 0, 0, Math.PI * 2);
}

export function ovalo(p: Pincel, x: number, y: number, rx: number, ry: number, color: string, borde = 0, sombra = 0): void {
  if (sombra > 0) {
    elipse(p, x + sombra, y + sombra, rx, ry);
    rellenar(p, SOMBRA);
  }
  elipse(p, x, y, rx, ry);
  rellenar(p, color);
  bordear(p, borde);
}

/** Un aro (la argolla del sapo): el trazo de color con su borde de tinta por fuera y por dentro. */
export function aro(p: Pincel, x: number, y: number, rx: number, ry: number, color: string, grueso: number): void {
  elipse(p, x, y, rx, ry);
  bordear(p, grueso + 8);
  bordear(p, grueso, color);
}

/** Un azar sembrado (mulberry32, el de `games/pixi/stage.ts`): el mismo dibujo en cada corrida. */
export function sembrado(semilla: number): () => number {
  let s = semilla | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** Oscurece un color #rrggbb, para el lado de atrás (las patas de lejos). */
export function oscuro(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const canal = (s: number): string => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, "0");
  return `#${canal(16)}${canal(8)}${canal(0)}`;
}

/* ------------------------------------------------------- piezas de la marca */

/** Estrellas de cuatro puntas, chicas, en una franja del cielo. */
export function estrellas(p: Pincel, semilla: number, n: number, y0: number, y1: number): void {
  const azar = sembrado(semilla);
  for (let i = 0; i < n; i++) {
    const x = 14 + azar() * (ANCHO - 28);
    const y = y0 + azar() * (y1 - y0);
    const r = 3 + azar() * 5;
    const color = azar() < 0.3 ? AMARILLO : CREMA;
    poligono(p, [[x, y - r * 2], [x + r * 0.6, y - r * 0.6], [x + r * 2, y], [x + r * 0.6, y + r * 0.6], [x, y + r * 2], [x - r * 0.6, y + r * 0.6], [x - r * 2, y], [x - r * 0.6, y - r * 0.6]], color);
  }
}

/** Confeti: tiras chicas giradas, en los cinco colores, dentro de un recuadro. */
export function confeti(p: Pincel, semilla: number, n: number, x0: number, y0: number, x1: number, y1: number): void {
  const azar = sembrado(semilla);
  for (let i = 0; i < n; i++) {
    const x = x0 + azar() * (x1 - x0);
    const y = y0 + azar() * (y1 - y0);
    const a = azar() * Math.PI;
    const largo = 10 + azar() * 6, ancho = 4 + azar() * 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    poligono(p, [
      [x - ux * largo - uy * ancho, y - uy * largo + ux * ancho],
      [x + ux * largo - uy * ancho, y + uy * largo + ux * ancho],
      [x + ux * largo + uy * ancho, y + uy * largo - ux * ancho],
      [x - ux * largo + uy * ancho, y - uy * largo - ux * ancho],
    ], franja(i), 2.5);
  }
}

/** El hilo que cuelga de borde a borde, con su comba: la altura en cada x. */
export const comba = (y: number, baja: number) => (x: number): number => y + baja * (1 - ((x - ANCHO / 2) / (ANCHO / 2)) ** 2);

/** Banderines triangulares colgados de un hilo, en los cinco colores. */
export function banderines(p: Pincel, y: number, baja: number): void {
  const hilo = comba(y, baja);
  linea(p, Array.from({ length: 19 }, (_, i) => [(i * ANCHO) / 18, hilo((i * ANCHO) / 18)] as const), TINTA, 4);
  for (let i = 0, x = 40; x + 26 <= ANCHO; i++, x += 74) {
    poligono(p, [[x - 26, hilo(x - 26)], [x + 26, hilo(x + 26)], [x, hilo(x) + 58]], franja(i), 3.5, 5);
  }
}

/** Papel picado: banderas de papel con el borde de abajo picado y un rombo calado. */
export function papelPicado(p: Pincel, y: number, baja: number, calado: string): void {
  const hilo = comba(y, baja);
  linea(p, Array.from({ length: 19 }, (_, i) => [(i * ANCHO) / 18, hilo((i * ANCHO) / 18)] as const), TINTA, 4);
  for (let i = 0, x = 50; x + 34 <= ANCHO; i++, x += 92) {
    const top = hilo(x);
    const alto = 84;
    const abajo: Punto[] = [];
    for (let k = 4; k >= 0; k--) abajo.push([x - 34 + k * 17, top + alto - (k % 2 ? 10 : 0)]);
    poligono(p, [[x - 34, top - 2], [x + 34, top - 2], ...abajo], franja(i), 3.5, 5);
    const cy = top + alto * 0.45;
    poligono(p, [[x, cy - 15], [x + 11, cy], [x, cy + 15], [x - 11, cy]], calado);
    caja(p, x - 24, top + 12, 7, 7, calado);
    caja(p, x + 17, top + 12, 7, 7, calado);
  }
}

/* ------------------------------------------------------------- la carrera */

/** La pata de la llama en dos partes, con la rodilla: `a` es el ángulo del muslo y `b` el de la caña. */
