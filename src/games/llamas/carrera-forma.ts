import { medidasMarcador } from "../pixi/kit/marcador";

/**
 * La forma de la carrera en la pantalla, pura: dónde va el grupo, las filas y
 * los carriles. Sin Pixi ni DOM, para probarla en Node con cualquier pantalla.
 *
 * - **El grupo** es una flecha que apunta a la derecha: el primero va adelante
 *   (`dx` 0), el resto se escalona hacia atrás, en filas (en el celular, una
 *   fila por llama o dos). `slot(puesto)` dice dónde va quien va en ese puesto:
 *   cambiar de puesto es cambiar de lugar, así que **x es el puesto**.
 * - **El nombre** va arriba de la llama (proyector) o a su izquierda (celular),
 *   siempre pegado al cuerpo.
 * - **Los carriles** de la final son ocho filas parejas.
 *
 * Medidas en píxeles de pantalla con la cámara en 1 (el mundo se dibuja a la
 * escala de la pantalla, sin otra unidad).
 */

/** Alto del dibujo de la llama (de los pies a la punta de las orejas) y largo (de la cola al hocico), en unidades del dibujo. */
export const LLAMA_ALTO = 92;
export const LLAMA_LARGO = 66;
/** Dónde cae la cola respecto de la cadera (negativo, a la izquierda) y el hocico (positivo). */
export const LLAMA_COLA = -26;
export const LLAMA_HOCICO = 40;
/** Cuánto mide la borla del líder, en unidades del dibujo. */
export const BORLA_RADIO = 15;

/**
 * Echarse dura medio segundo (patas plegadas, cuerpo abajo, gris y polvo) y el
 * cuerpo ya lo muestra a los 0,3 s de la línea del relator: regla 5 de la
 * regla del niño. `plegada(s)` es cuánto va echada a los `s` segundos de
 * empezar (0 de pie, 1 echada).
 */
export const ECHADA_DUR = 0.5;
export const plegada = (s: number): number => Math.max(0, Math.min(1, s / ECHADA_DUR));

export interface Pantalla {
  w: number;
  h: number;
  /** La unidad `u()` del estadio. */
  u: number;
  retrato: boolean;
  /** Debajo de la barra de arriba. */
  top: number;
  /** Encima del relator: hasta donde llega el juego. */
  bottom: number;
}

export interface Hud {
  /** La cinta del camino, arriba. */
  cinta: { x0: number; x1: number; y: number; h: number };
  /** Hasta dónde llega la parte alta (marcador y cinta): debajo empieza la pista. */
  bajo: number;
}

/** Cuánto ocupa el marcador del kit ("QUEDAN 30"), en unidades `u`. */
const ANCHO_MARCADOR = 215;

export function hudDe(p: Pantalla): Hud {
  const k = p.u;
  const marc = medidasMarcador(k);
  const h = Math.max(32, 0.055 * p.h);
  if (!p.retrato) {
    const y = p.top + 10 * k + (marc.alto - h) / 2;
    return { cinta: { x0: (22 + ANCHO_MARCADOR) * k, x1: p.w - 22 * k, y: Math.max(p.top + 4 * k, y), h }, bajo: p.top + 10 * k + Math.max(marc.alto, h) };
  }
  const y = p.top + 10 * k + marc.alto + 8 * k;
  return { cinta: { x0: 12 * k, x1: p.w - 12 * k, y, h }, bajo: y + h };
}

export interface Forma {
  /** El nombre va arriba de la cabeza (proyector) o a la izquierda de la llama (celular). */
  arriba: boolean;
  filas: number;
  columnas: number;
  /** Alto de cada fila y de la llama (sin el nombre), y cuánto hay que escalar el dibujo. */
  altoFila: number;
  alto: number;
  esc: number;
  largo: number;
  /** Lo que ocupa cada columna y cuánto se corre cada puesto hacia atrás dentro de ella. */
  ancho: number;
  escalon: number;
  y0: number;
  y1: number;
  /** Alto del nombre (con aire). */
  altoNombre: number;
  /** Dónde va quien va en el puesto `puesto` (0 es el primero): hacia atrás del frente y en qué fila. */
  slot(puesto: number): { dx: number; fila: number };
  /** Dónde pisa la llama de la fila `fila` (y de los pies). */
  yPie(fila: number): number;
  /** El largo del grupo, del frente a la última, sin el nombre. */
  profundidad: number;
  /** En qué x de la pantalla va el frente del grupo. */
  ancla: number;
}

/** Las filas de un puesto: el primero en el medio y los demás alternando arriba y abajo, así el grupo es una flecha. */
export function ordenDeFilas(filas: number): number[] {
  const medio = Math.floor((filas - 1) / 2);
  const out: number[] = [medio];
  for (let d = 1; out.length < filas; d++) {
    if (medio - d >= 0) out.push(medio - d);
    if (out.length < filas && medio + d < filas) out.push(medio + d);
  }
  return out;
}

export function formaDe(p: Pantalla, vivos: number, nombrePx: number, nombreW: number): Forma {
  const k = p.u;
  const hud = hudDe(p);
  const y0 = hud.bajo + 8 * k;
  const y1 = Math.max(y0 + 60, p.bottom - 4 * k);
  const banda = y1 - y0;
  const arriba = !p.retrato;
  const altoNombre = nombrePx * 1.32;
  const m = Math.max(1, vivos);
  /** Las medidas con `columnas` por `filas`, y si el grupo entra en el plano sin salirse por atrás. */
  const armar = (columnas: number, filas: number) => {
    const altoFila = banda / filas;
    const alto = arriba ? Math.max(30 * k, Math.min(altoFila - altoNombre - 2 * k, 0.17 * p.h)) : Math.max(22 * k, Math.min(altoFila * 0.94, 0.12 * p.h));
    const esc = alto / LLAMA_ALTO;
    const largo = LLAMA_LARGO * esc;
    const ancho = arriba ? Math.max(nombreW + 22 * k, largo + 26 * k) : largo + nombreW + 14 * k;
    const sobra = arriba ? nombreW / 2 + largo / 2 : nombreW + largo;
    // Lo que el grupo puede ocupar hacia atrás del frente: el frente va a 0,8 del ancho como mucho.
    const libre = 0.77 * p.w - sobra;
    const base = (columnas - 1) * ancho;
    // El escalón no suma más que lo que sobra: con muchas filas (celular) la flecha se aplana en vez de irse de la pantalla.
    const escalon = Math.max(1.5 * k, Math.min(ancho * 0.12, filas > 1 ? (libre - base) / (filas - 1) : ancho * 0.12));
    return { altoFila, alto, esc, largo, ancho, sobra, base, escalon, cabe: base + (filas - 1) * 1.5 * k <= libre };
  };
  let filas: number;
  let columnas: number;
  if (arriba) {
    const rMax = Math.max(2, Math.floor(banda / (altoNombre + 44 * k)));
    filas = Math.min(rMax, m, Math.max(3, Math.round(Math.sqrt(m * 1.7))));
    columnas = Math.ceil(m / filas);
    while (columnas > 1 && !armar(columnas, filas).cabe) {
      filas++;
      columnas = Math.ceil(m / filas);
    }
  } else {
    const rMax = Math.max(2, Math.floor(banda / (altoNombre * 1.05)));
    const colMin = nombreW + 36 * k + 8 * k;
    const cMax = Math.max(1, Math.floor((p.w * 0.94) / colMin));
    columnas = Math.min(cMax, Math.max(1, Math.ceil(m / rMax)));
    filas = Math.ceil(m / columnas);
    while (columnas > 1 && !armar(columnas, filas).cabe) {
      columnas--;
      filas = Math.ceil(m / columnas);
    }
  }
  const f = armar(columnas, filas);
  const orden = ordenDeFilas(filas);
  const profundidad = f.base + (filas - 1) * f.escalon;
  const ancla = Math.max(0.5 * p.w, Math.min(0.8 * p.w, profundidad + f.sobra + 0.03 * p.w));
  return {
    arriba, filas, columnas, altoFila: f.altoFila, alto: f.alto, esc: f.esc, largo: f.largo, ancho: f.ancho, escalon: f.escalon, y0, y1, altoNombre, profundidad, ancla,
    slot(puesto) {
      const col = Math.floor(puesto / filas);
      const r = puesto % filas;
      return { dx: col * f.ancho + r * f.escalon, fila: orden[r] ?? 0 };
    },
    yPie: (fila) => y0 + (fila + 1) * f.altoFila - 2 * k,
  };
}

export interface Carriles {
  arriba: boolean;
  n: number;
  altoFila: number;
  alto: number;
  esc: number;
  largo: number;
  y0: number;
  y1: number;
  altoNombre: number;
  yPie(carril: number): number;
}

/** Los carriles de la final: `n` filas parejas, de arriba a abajo. */
export function carrilesDe(p: Pantalla, n: number, nombrePx: number): Carriles {
  const k = p.u;
  const hud = hudDe(p);
  const y0 = hud.bajo + 8 * k;
  const y1 = Math.max(y0 + 60, p.bottom - 4 * k);
  const altoNombre = nombrePx * 1.32;
  const arriba = !p.retrato && (y1 - y0) / Math.max(1, n) >= altoNombre + 40 * k;
  const altoFila = (y1 - y0) / Math.max(1, n);
  const alto = arriba ? Math.max(30 * k, Math.min(altoFila - altoNombre - 2 * k, 0.17 * p.h)) : Math.max(22 * k, Math.min(altoFila * 0.94, 0.12 * p.h));
  const esc = alto / LLAMA_ALTO;
  return { arriba, n, altoFila, alto, esc, largo: LLAMA_LARGO * esc, y0, y1, altoNombre, yPie: (c) => y0 + (c + 1) * altoFila - 2 * k };
}
