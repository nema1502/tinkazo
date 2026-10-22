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

/**
 * Como `dentro`, pero sin tocar el acercamiento: en cada eje, si la caja entra
 * en la zona, queda entera adentro; si no entra, la cubre de punta a punta, sin
 * dejar un costado vacío mientras el otro se corta. Para los primeros planos:
 * en el sapo, la cámara se acercaba al agujero y mostraba piso de un lado
 * mientras dejaba agujeros afuera del otro (revisión visual, 21 de octubre de 2026).
 */
export function encuadrar(c: Caja, zona: Zona, v: Vista, sw: number, sh: number): Vista {
  const ax = (a: number, b: number, lo: number, hi: number, medio: number, p: number): number => {
    if ((b - a) * v.z <= hi - lo) return eje(a, b, lo, hi, medio, p, v.z);
    if (medio + (a - p) * v.z > lo) return a - (lo - medio) / v.z;
    if (medio + (b - p) * v.z < hi) return b - (hi - medio) / v.z;
    return p;
  };
  return { x: ax(c.x, c.x + c.w, zona.x0, zona.x1, sw / 2, v.x), y: ax(c.y, c.y + c.h, zona.y0, zona.y1, sh / 2, v.y), z: v.z };
}

/** La vista que pone el medio de la caja en el medio de la zona, con el acercamiento `z`. */
export function centrar(c: Caja, zona: Zona, sw: number, sh: number, z: number): Vista {
  return {
    x: c.x + c.w / 2 - ((zona.x0 + zona.x1) / 2 - sw / 2) / z,
    y: c.y + c.h / 2 - ((zona.y0 + zona.y1) / 2 - sh / 2) / z,
    z,
  };
}

/**
 * La guardia de los nombres: cuánto hay que correr un rectángulo de la pantalla
 * para que quede entero en la zona, y a qué escala, si no entra ni de ancho ni
 * de alto. Con la escala, el corrimiento es el de la caja achicada desde su
 * esquina de arriba a la izquierda: quien la achica de otra forma la vuelve a
 * medir y pregunta de nuevo.
 *
 * Null si ya está entera adentro, o si no toca la zona: lo que está entero
 * afuera no se ve, y no se trae de lejos.
 *
 * Nació con un nombre cortado contra el borde del celular en el sapo y en la
 * carrera (revisión visual del 21 de octubre de 2026): cada juego acomoda sus
 * nombres, y esta es la última palabra, la misma para todos.
 */
export function meter(c: Caja, zona: Zona): { dx: number; dy: number; s: number } | null {
  if (!(c.w > 0 && c.h > 0)) return null;
  if (!(c.x < zona.x1 && c.x + c.w > zona.x0 && c.y < zona.y1 && c.y + c.h > zona.y0)) return null;
  const s = Math.min(1, Math.max(1, zona.x1 - zona.x0) / c.w, Math.max(1, zona.y1 - zona.y0) / c.h);
  const tramo = (a: number, l: number, lo: number, hi: number): number => (a < lo ? lo - a : a + l > hi ? hi - (a + l) : 0);
  const dx = tramo(c.x, c.w * s, zona.x0, zona.x1);
  const dy = tramo(c.y, c.h * s, zona.y0, zona.y1);
  return dx === 0 && dy === 0 && s === 1 ? null : { dx, dy, s };
}

/** Lo que hace la guardia con un nombre en un cuadro: nada, correrlo lo justo, o no dibujarlo. */
export type Guardia = { tipo: "nada" } | { tipo: "tapar" } | { tipo: "correr"; dx: number; dy: number; s: number };

/**
 * La regla de los nombres: un nombre se ve entero o no se ve. `c` es el chip en
 * la pantalla de `sw` por `sh`, y `zona` lo que se ve de verdad (sin la barra de
 * arriba ni la caja del relator).
 *
 * - Entero adentro de la zona, o entero fuera de la pantalla: nada.
 * - En la pantalla pero sin tocar la zona (detrás de la barra o del relator,
 *   asomando por los costados de la caja): no se dibuja.
 * - Cortado: se corre lo justo para quedar entero, si para eso no tiene que
 *   irse más de `max` de su ancho (o de su alto) de donde lo puso el juego. Más
 *   lejos ya no estaría al lado de su dueño, que seguramente quedó fuera de
 *   cuadro: no se dibuja. "Pegado al borde engañaba" (el trompo, 16 de octubre).
 */
export function guardiaNombre(c: Caja, zona: Zona, sw: number, sh: number, max = 0.5): Guardia {
  if (!(c.w > 0 && c.h > 0)) return { tipo: "nada" };
  if (c.x >= sw || c.x + c.w <= 0 || c.y >= sh || c.y + c.h <= 0) return { tipo: "nada" };
  const toca = c.x < zona.x1 && c.x + c.w > zona.x0 && c.y < zona.y1 && c.y + c.h > zona.y0;
  if (!toca) return { tipo: "tapar" };
  const m = meter(c, zona);
  if (!m) return { tipo: "nada" };
  const lejos = Math.max(Math.abs(m.dx) / (c.w * m.s), Math.abs(m.dy) / (c.h * m.s));
  return lejos > max ? { tipo: "tapar" } : { tipo: "correr", ...m };
}

/** Qué parte de la caja `a` queda debajo de la caja `b`, de 0 a 1, por área de `a`. */
export function tapada(a: Caja, b: Caja): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return a.w > 0 && a.h > 0 ? (ix * iy) / (a.w * a.h) : 0;
}
