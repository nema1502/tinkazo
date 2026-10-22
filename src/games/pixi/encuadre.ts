/**
 * El encuadre, sin dibujo: qué tiene que verse entero y en qué parte de la
 * pantalla.
 *
 * La cámara pone un punto del mundo en el medio de la pantalla y lo agranda `z`
 * veces. Un juego dice qué cajas del mundo tienen que verse enteras y en qué
 * zona de la pantalla (debajo del cartel, encima del relator, lejos de los
 * costados), y estas cuentas devuelven la vista: el acercamiento más grande con
 * el que las cajas entran y el centro que las deja ahí. Es aritmética sobre lo
 * que el juego ya decidió: la cámara no decide nada.
 *
 * Nació con la carrera con pocas personas (feedback de Alejandro, 19 de octubre
 * de 2026: "¿probaron esto en mobile?"). Con tres o cuatro llamas, cada una mide
 * más de dos carriles de alto, y al final la ganadora quedaba cortada contra el
 * borde del celular y el cartel tapaba a otra llama.
 *
 * Está aparte de la cámara para poder probarlo sin placa de video.
 */

/** Un rectángulo: del mundo o de la pantalla, según de dónde venga. */
export interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Una zona de la pantalla, en píxeles: de (x0, y0) a (x1, y1). */
export interface Zona {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Lo que mira la cámara: el punto del mundo que va en el medio de la pantalla, y el acercamiento. */
export interface Vista {
  x: number;
  y: number;
  z: number;
}

/** La caja que cubre a todas. Sin cajas, una caja vacía en el origen. */
export function unir(cajas: readonly Caja[]): Caja {
  if (!cajas.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cajas) {
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w);
    y1 = Math.max(y1, c.y + c.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** La caja agrandada `dx` a cada costado y `dy` arriba y abajo. */
export const crecer = (c: Caja, dx: number, dy = dx): Caja => ({ x: c.x - dx, y: c.y - dy, w: c.w + 2 * dx, h: c.h + 2 * dy });

/** Dónde cae una caja del mundo en una pantalla de `sw` por `sh`, mirada con la vista `v`. */
export function enPantalla(c: Caja, v: Vista, sw: number, sh: number): Caja {
  return { x: sw / 2 + (c.x - v.x) * v.z, y: sh / 2 + (c.y - v.y) * v.z, w: c.w * v.z, h: c.h * v.z };
}

/** El acercamiento más grande con el que la caja entra en la zona (infinito si la caja no mide nada). */
export function cabe(c: Caja, zona: Zona): number {
  const zw = Math.max(1, zona.x1 - zona.x0), zh = Math.max(1, zona.y1 - zona.y0);
  return Math.min(c.w > 0 ? zw / c.w : Infinity, c.h > 0 ? zh / c.h : Infinity);
}

/**
 * Un eje de `dentro`: dónde va el centro para que el tramo del mundo [a, b]
 * caiga entre [lo, hi] de la pantalla, moviéndolo lo menos posible.
 */
function eje(a: number, b: number, lo: number, hi: number, medio: number, p: number, z: number): number {
  if (medio + (a - p) * z < lo) return a - (lo - medio) / z;
  if (medio + (b - p) * z > hi) return b - (hi - medio) / z;
  return p;
}

/**
 * La vista más parecida a `v` que deja la caja entera dentro de la zona: si con
 * ese acercamiento no entra, lo baja hasta que entre, y después corre el centro
 * lo justo. Si la caja ya estaba adentro, devuelve la misma vista.
 */
export function dentro(c: Caja, zona: Zona, v: Vista, sw: number, sh: number): Vista {
  const z = Math.min(v.z, cabe(c, zona));
  return {
    x: eje(c.x, c.x + c.w, zona.x0, zona.x1, sw / 2, v.x, z),
    y: eje(c.y, c.y + c.h, zona.y0, zona.y1, sh / 2, v.y, z),
    z,
  };
}

/** La vista que pone el medio de la caja en el medio de la zona, con el acercamiento `z`. */
export function centrar(c: Caja, zona: Zona, sw: number, sh: number, z: number): Vista {
  return {
    x: c.x + c.w / 2 - ((zona.x0 + zona.x1) / 2 - sw / 2) / z,
    y: c.y + c.h / 2 - ((zona.y0 + zona.y1) / 2 - sh / 2) / z,
    z,
  };
}

/** Qué parte de la caja `a` queda debajo de la caja `b`, de 0 a 1, por área de `a`. */
export function tapada(a: Caja, b: Caja): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return a.w > 0 && a.h > 0 ? (ix * iy) / (a.w * a.h) : 0;
}
