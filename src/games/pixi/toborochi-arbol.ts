import { acotar, hashDe } from "./kit/azar";
import type { Caja } from "./kit/tipos";

/**
 * El árbol del Toborochi, puro: dónde está cada flor y dónde cae.
 *
 * Dos capas. La primera es **unitaria** y no sabe de pantallas: de cuánta gente hay
 * sale cuántas ramas tiene la copa y el lugar de cada flor en una copa de 1 de
 * ancho por 1 de alto (`disposicion`). La segunda baja eso a una pantalla
 * (`geoDe`): el tronco, la copa, el tamaño de la flor, la alfombra donde cae y
 * la rejilla donde se leen los nombres de las que cayeron. Se prueba en Node a
 * 390, 720 y 1080 de ancho (`toborochi-arbol.test.ts`).
 *
 * Nada de acá decide quién gana ni usa `Math.random`: las posiciones salen de la
 * cantidad de gente y de `hashDe`.
 */

/** El tamaño de la pantalla y la franja libre entre la barra de arriba y el relator. */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

/** Una flor en la copa unitaria: `u` de -1 a 1 (izquierda a derecha), `v` de 0 (pie de la copa) a 1 (arriba). */
export interface Lugar {
  u: number;
  v: number;
  rama: number;
}

export interface Disposicion {
  /** Cuántas ramas tiene la copa. */
  ramas: number;
  lugares: Lugar[];
  /** Por rama: hacia dónde sale (ángulo desde la vertical, en radianes) y hasta dónde llega (distancia al pie, unitaria). */
  ramaAng: number[];
  ramaLargo: number[];
}

/** Cinco flores por rama, como mucho ocho ramas y nunca menos de dos: con 30, seis ramas de cinco. */
export const ramasPara = (n: number): number => acotar(Math.ceil(n / 5), 2, 8);

/** El pie de las ramas, en la copa unitaria: un poco por debajo de la flor más baja. */
const ORIGEN_V = -0.04;
/** El óvalo de la copa en la unidad: centro, y cuánto sale para cada lado. */
const COPA = { cv: 0.53, rv: 0.45, ru: 0.95 } as const;

/**
 * Las `n` flores repartidas en el óvalo de la copa como las semillas de un girasol (separación pareja sin amontonar)
 * y las ramas por sectores: se ordena por ángulo desde el pie y se corta en tantos grupos como ramas, así una rama
 * es un abanico de flores vecinas y ninguna cruza a otra.
 */
export function disposicion(n: number): Disposicion {
  const total = Math.max(1, Math.floor(n));
  const ramas = Math.min(ramasPara(total), total);
  const raw = Array.from({ length: total }, (_, k) => {
    const r = Math.sqrt((k + 0.5) / total);
    const a = k * 2.399963229728653;
    // Un temblor chico: la copa no es una rejilla.
    const j = 0.045 / Math.sqrt(total);
    return { u: COPA.ru * r * Math.cos(a) + (hashDe(k, 11) - 0.5) * j * 2, v: COPA.cv + COPA.rv * r * Math.sin(a) + (hashDe(k, 12) - 0.5) * j * 2 };
  });
  const ang = (p: { u: number; v: number }): number => Math.atan2(p.u, p.v - ORIGEN_V);
  const orden = raw.map((_, i) => i).sort((a, b) => ang(raw[a] as { u: number; v: number }) - ang(raw[b] as { u: number; v: number }) || a - b);
  const lugares: Lugar[] = new Array(total);
  const grupos: number[][] = Array.from({ length: ramas }, () => []);
  orden.forEach((i, pos) => {
    const g = Math.min(ramas - 1, Math.floor((pos * ramas) / total));
    (grupos[g] as number[]).push(i);
    lugares[i] = { ...(raw[i] as { u: number; v: number }), rama: g };
  });
  const ramaAng = grupos.map((g) => g.reduce((s, i) => s + ang(raw[i] as { u: number; v: number }), 0) / Math.max(1, g.length));
  const ramaLargo = grupos.map((g, r) => {
    // Hasta la flor que más lejos llega siguiendo el rumbo de la rama, sin pasarse.
    const a = ramaAng[r] as number;
    const dir = { u: Math.sin(a), v: Math.cos(a) };
    return Math.max(0.25, ...g.map((i) => ((raw[i] as { u: number }).u * dir.u + ((raw[i] as { v: number }).v - ORIGEN_V) * dir.v) * 0.97));
  });
  return { ramas, lugares, ramaAng, ramaLargo };
}

/** Cuántas flores tiene cada rama. */
export const poblacionDeRamas = (d: Disposicion): number[] => {
  const c = new Array<number>(d.ramas).fill(0);
  for (const l of d.lugares) c[l.rama] = (c[l.rama] as number) + 1;
  return c;
};

/* --------------------------------------------------------------- la pantalla */

export interface Rejilla {
  cols: number;
  rows: number;
  cap: number;
  /** El ancho y el alto de cada casilla. */
  colW: number;
  rowH: number;
  /** La esquina de arriba a la izquierda de la rejilla. */
  x: number;
  y: number;
}

export interface Geo {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
  retrato: boolean;
  /** Dónde empieza la alfombra (la línea del suelo). */
  suelo: number;
  alfombra: Caja;
  /** El centro del tronco, el pie y la cima (donde nacen las ramas). */
  cx: number;
  troncoBase: number;
  troncoCima: number;
  troncoAncho: number;
  /** La copa: y del pie (v = 0), ancho y alto en píxeles. */
  copa: { base: number; ancho: number; alto: number };
  /** El radio de una flor, en píxeles. */
  r: number;
}

/** La copa y el tronco, en el rato libre entre la barra y el relator, y la alfombra debajo. `n` es la gente que hay. */
export function geoDe(p: Pant, n: number): Geo {
  const retrato = p.h > p.w * 1.1;
  const zona = Math.max(80, p.bottom - p.top);
  const alfombraH = zona * (retrato ? 0.2 : 0.22);
  const suelo = p.bottom - alfombraH;
  const arbolH = suelo - p.top;
  const troncoH = arbolH * (retrato ? 0.22 : 0.24);
  const base = suelo - troncoH;
  // El radio de la flor depende del tamaño de la copa y la copa se achica para que entre la flor de más arriba y la de más
  // al costado: dos vueltas bastan.
  const medidas = (r0: number): { alto: number; ancho: number; r: number } => {
    const alto = Math.max(40, (base - p.top - 4 * p.k - r0) / 0.99);
    const ancho = Math.max(60, Math.min((p.w * 0.96 - 2 * r0) / 0.96, alto * 2.9));
    const area = (Math.PI / 4) * ancho * alto * COPA.ru * COPA.rv * 4 * 0.8;
    const pack = Math.sqrt(area / (Math.PI * Math.max(1, n)));
    return { alto, ancho, r: acotar(pack * 0.82, 5 * p.k, Math.min(110 * p.k, (base - p.top) * 0.27)) };
  };
  let m = medidas(0);
  m = medidas(m.r);
  m = medidas(m.r);
  const { alto, ancho, r } = m;
  return {
    w: p.w,
    h: p.h,
    k: p.k,
    top: p.top,
    bottom: p.bottom,
    retrato,
    suelo,
    alfombra: { x: 0, y: suelo, w: p.w, h: alfombraH },
    cx: p.w / 2,
    troncoBase: suelo + 4 * p.k,
    troncoCima: base,
    troncoAncho: Math.min(p.w * 0.2, arbolH * 0.38),
    copa: { base, ancho, alto },
    r,
  };
}

/** El punto de la pantalla de un lugar de la copa unitaria. */
export const puntoDe = (g: Geo, l: { u: number; v: number }): { x: number; y: number } => ({
  x: g.cx + l.u * (g.copa.ancho / 2),
  y: g.copa.base - l.v * g.copa.alto,
});

/** La caja de una flor con su nombre pegado arriba, para encuadrarla. */
export const cajaDeFlor = (g: Geo, l: { u: number; v: number }, margen = 1.5): Caja => {
  const q = puntoDe(g, l);
  const m = g.r * margen;
  return { x: q.x - m, y: q.y - m, w: 2 * m, h: 2 * m };
};

/** La caja de la copa entera, con el tronco: lo que se ve en la presentación. */
export const cajaDelArbol = (g: Geo): Caja => ({ x: g.cx - g.copa.ancho / 2 - g.r, y: g.top, w: g.copa.ancho + 2 * g.r, h: g.bottom - g.top });

/**
 * La rejilla de la alfombra, donde se leen los nombres de las que cayeron: tantas casillas como entran en la franja
 * del suelo con el chip más ancho (`chipW`) y el más alto (`chipH`). Siempre hay al menos una.
 */
export function rejillaDe(g: Geo, chipW: number, chipH: number): Rejilla {
  const aire = 4 * g.k;
  const colW = Math.max(40, chipW + aire);
  const rowH = Math.max(20, chipH + aire);
  const anchoUtil = g.w * 0.96;
  // Los nombres van en la parte de arriba de la alfombra y las flores tendidas debajo.
  const altoUtil = g.alfombra.h * 0.62 - 6 * g.k;
  const cols = Math.max(1, Math.floor(anchoUtil / colW));
  const rows = Math.max(1, Math.floor(altoUtil / rowH));
  return { cols, rows, cap: cols * rows, colW, rowH, x: (g.w - cols * colW) / 2, y: g.alfombra.y + 6 * g.k };
}

/** El centro de la casilla `s` (0 es la de arriba a la izquierda, por filas). */
export const casilla = (r: Rejilla, s: number): { x: number; y: number } => ({
  x: r.x + (s % r.cols) * r.colW + r.colW / 2,
  y: r.y + Math.floor(s / r.cols) * r.rowH + r.rowH / 2,
});

/** El ancho de un texto a `px` de letra, a ojo: para elegir el nivel del nombre antes de medirlo de verdad. */
export const anchoAprox = (texto: string, px: number): number => [...texto].length * px * 0.58;
