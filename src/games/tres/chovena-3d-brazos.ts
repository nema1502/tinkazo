import type { ModoBailarin } from "./chovena-3d-tipos";

/**
 * La geometría de un bailarín de la chovena y de sus manos, sin three.js: se prueba en Node.
 *
 * Todo se mide en "bailarines": 1 es lo que mide `dh`, el alto de un bailarín en el 2D. Los pies están en y = 0 y la
 * persona mira hacia +z (la sala) cuando su `yaw` es 0; su izquierda es +x. La cadera es el pivote del cuerpo: el
 * tambaleo inclina el torso, la cabeza y los brazos alrededor de ella, y las piernas se quedan en el piso.
 */

export const CADERA = 0.44;
export const HOMBRO_Y = 0.72;
export const HOMBRO_X = 0.115;
/** Lo que mide un brazo con la mano, en bailarines (en el 2D, 0,27 más la mano). */
export const BRAZO = 0.3;
/** Cuánto se estira un brazo hasta el vecino: el doble de su largo, como el 2D (`ALCANCE`), y un poco más: la pareja de la final queda a más de un cuerpo y se toma de las dos manos. */
export const ALCANCE = 3.2;
/** Cuánto baja el cuerpo al sentarse, en bailarines (el 2D, 0,24). */
export const BAJA_SENTADO = 0.24;

export type V3 = [number, number, number];

/** Dónde está un cuerpo en el mundo 3D y cómo está plantado. */
export interface Cuerpo {
  /** Los pies, en unidades 3D. `fy` ya incluye lo que se levanta del piso. */
  fx: number;
  fy: number;
  fz: number;
  /** Unidades 3D por bailarín. */
  D: number;
  /** Hacia dónde mira, en radianes: 0 mira a +z (la sala), positivo gira hacia +x. */
  yaw: number;
  /** La inclinación alrededor de z, en radianes (positiva hacia la izquierda de la pantalla). */
  lean: number;
  /** Cuánto bajó el cuerpo por sentarse, en bailarines. */
  baja: number;
}

/** De un punto del cuerpo (en bailarines, de pie y sin inclinar) al mundo 3D. */
export function punto(c: Cuerpo, lx: number, ly: number, lz: number, out: V3 = [0, 0, 0]): V3 {
  const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
  const rx = lx * cy + lz * sy;
  const rz = -lx * sy + lz * cy;
  const py = ly - CADERA;
  const sl = Math.sin(c.lean), cl = Math.cos(c.lean);
  out[0] = c.fx + (rx * cl - py * sl) * c.D;
  out[1] = c.fy + (CADERA - c.baja + rx * sl + py * cl) * c.D;
  out[2] = c.fz + rz * c.D;
  return out;
}

const dos = Math.PI * 2;
/** La diferencia de ángulos por el lado corto. */
export const envolver = (a: number): number => {
  let r = a % dos;
  if (r > Math.PI) r -= dos;
  else if (r < -Math.PI) r += dos;
  return r;
};

/** Cuánto se gira hacia donde gira la rueda: 20 grados. */
const GIRO = (20 * Math.PI) / 180;
/** Cuánto se vuelve hacia su pareja la final, mirando a la sala. */
const HACIA_PAREJA = 0.55;

/**
 * Hacia dónde mira alguien. En la rueda, al medio, con 20 grados hacia donde gira; en las filas, la final, la corona y
 * al irse, a la sala (`haciaSala` de 0 a 1 mezcla las dos); en la final, a la sala pero un poco hacia su pareja.
 * `(px, pz)` es donde pisa, `(cx, cz)` el medio de su rueda y `par` dónde pisa su pareja, si hay, todo en el plano del piso 3D.
 */
export function mirada(px: number, pz: number, cx: number, cz: number, sentido: number, haciaSala: number, par: readonly [number, number] | null): number {
  let ux = cx - px, uz = cz - pz;
  const l = Math.hypot(ux, uz);
  let yawC = 0;
  if (l > 1e-6) {
    ux /= l;
    uz /= l;
    // La tangente hacia donde crece el ángulo de la rueda: (uz, -ux).
    const tx = uz, tz = -ux;
    const fx = ux * Math.cos(GIRO) + tx * sentido * Math.sin(GIRO);
    const fz = uz * Math.cos(GIRO) + tz * sentido * Math.sin(GIRO);
    yawC = Math.atan2(fx, fz);
  }
  let yawS = 0;
  if (par) {
    let qx = par[0] - px, qz = par[1] - pz;
    const lp = Math.hypot(qx, qz);
    if (lp > 1e-6) {
      qx /= lp;
      qz /= lp;
      yawS = Math.atan2(qx * Math.sin(HACIA_PAREJA), Math.cos(HACIA_PAREJA) + qz * Math.sin(HACIA_PAREJA));
    }
  }
  const w = Math.max(0, Math.min(1, haciaSala));
  return yawC + w * envolver(yawS - yawC);
}

/** Lo que cambia la posición de las manos sueltas. */
export interface ContextoManos {
  modo: ModoBailarin;
  tipoy: boolean;
  /** Seno del pulso, para las palmadas de las filas. */
  ritmo: number;
  /** El aplauso de los sentados, de 0 a 1. */
  aplauso: number;
  /** Segundos desde que se soltó (el braceo al caminar). */
  salida: number;
}

/** Dónde queda la mano de un lado (`lado` 1: izquierda, -1: derecha) cuando nadie se la toma, en el cuerpo de pie. */
export function manoSuelta(c: ContextoManos, lado: number, out: V3 = [0, 0, 0]): V3 {
  switch (c.modo) {
    case "salta":
      out[0] = lado * 0.15;
      out[1] = 1.2;
      out[2] = 0.02;
      return out;
    case "sentado":
    case "festeja":
      out[0] = lado * (0.2 - 0.13 * c.aplauso);
      out[1] = 1.06 + 0.05 * c.aplauso;
      out[2] = 0.04;
      return out;
    case "camina": {
      const fase = Math.max(0, c.salida) * 14;
      out[0] = lado * 0.16;
      out[1] = 0.47;
      out[2] = 0.07 * Math.sin(fase) * lado;
      return out;
    }
    default:
      out[0] = lado * 0.17;
      out[1] = 0.47;
      out[2] = 0.03;
      return out;
  }
}

/** Las manos de las filas del arranque: ellas en la cintura, ellos dando palmadas adelante. */
export function manoDeFila(c: Pick<ContextoManos, "tipoy" | "ritmo">, lado: number, out: V3 = [0, 0, 0]): V3 {
  if (c.tipoy) {
    out[0] = lado * 0.2;
    out[1] = 0.47;
    out[2] = 0.04;
  } else {
    out[0] = lado * (0.03 + 0.14 * Math.abs(c.ritmo));
    out[1] = 0.64;
    out[2] = 0.24;
  }
  return out;
}

/** Los hombros de cada bailarín en el mundo, para repartir las manos tomadas. */
export interface Hombros {
  n: number;
  /** El medio de los hombros, `3n`. */
  centro: Float32Array;
  /** El hombro izquierdo y el derecho, `3n` cada uno. */
  izq: Float32Array;
  der: Float32Array;
  /** Hacia dónde queda su izquierda en el piso, `2n` (x, z). */
  izqDir: Float32Array;
  /** Unidades 3D por bailarín, `n`. */
  D: Float32Array;
}

export interface ManosTomadas {
  /** Dónde tiene la mano izquierda y la derecha cuando va tomada, `3n`. */
  izq: Float32Array;
  der: Float32Array;
  usaIzq: Uint8Array;
  usaDer: Uint8Array;
}

export const crearHombros = (n: number): Hombros => ({
  n,
  centro: new Float32Array(3 * n),
  izq: new Float32Array(3 * n),
  der: new Float32Array(3 * n),
  izqDir: new Float32Array(2 * n),
  D: new Float32Array(n),
});

export const crearManos = (n: number): ManosTomadas => ({
  izq: new Float32Array(3 * n),
  der: new Float32Array(3 * n),
  usaIzq: new Uint8Array(n),
  usaDer: new Uint8Array(n),
});

const vistos = new Map<number, number>();

/** Con qué mano toma `i` el punto `(mx, mz)`: la de su lado, y si está ocupada, la otra. */
function lado(h: Hombros, m: ManosTomadas, i: number, mx: number, mz: number): 1 | -1 {
  const dot = (mx - (h.centro[3 * i] as number)) * (h.izqDir[2 * i] as number) + (mz - (h.centro[3 * i + 2] as number)) * (h.izqDir[2 * i + 1] as number);
  const izqLibre = !m.usaIzq[i], derLibre = !m.usaDer[i];
  const quiereIzq = dot >= 0;
  if (quiereIzq ? izqLibre : derLibre) return quiereIzq ? 1 : -1;
  return quiereIzq ? (derLibre ? -1 : 1) : (izqLibre ? 1 : -1);
}

function ponerMano(m: ManosTomadas, i: number, l: number, x: number, y: number, z: number): void {
  const dst = l === 1 ? m.izq : m.der;
  dst[3 * i] = x;
  dst[3 * i + 1] = y;
  dst[3 * i + 2] = z;
  if (l === 1) m.usaIzq[i] = 1;
  else m.usaDer[i] = 1;
}

/**
 * Reparte las manos tomadas. Cada eslabón `[a, b]` junta una mano de `a` con una de `b` en el medio de los dos: las dos
 * manos llegan al mismo punto, así que se tocan de verdad. Cada uno toma con la mano de su lado (si el vecino está a su
 * izquierda, la izquierda), y si ese lado ya está ocupado, con la otra. Si el punto queda más lejos de lo que estira un
 * brazo, el eslabón no se hace y las dos manos quedan sueltas. Devuelve cuántos eslabones se hicieron.
 */
export function tomarManos(h: Hombros, eslabones: ArrayLike<number>, m: ManosTomadas): number {
  m.usaIzq.fill(0);
  m.usaDer.fill(0);
  vistos.clear();
  let hechos = 0;
  for (let k = 0; k + 1 < eslabones.length; k += 2) {
    const a = eslabones[k] as number, b = eslabones[k + 1] as number;
    if (a < 0 || b < 0 || a >= h.n || b >= h.n || a === b) continue;
    const clave = Math.min(a, b) * 65536 + Math.max(a, b);
    const vez = vistos.get(clave) ?? 0;
    vistos.set(clave, vez + 1);
    const da = h.D[a] as number, db = h.D[b] as number;
    const D = (da + db) / 2;
    const mx = ((h.centro[3 * a] as number) + (h.centro[3 * b] as number)) / 2;
    // La mano queda más abajo que los hombros; la segunda mano de la pareja, un poco más abajo todavía.
    const my = ((h.centro[3 * a + 1] as number) + (h.centro[3 * b + 1] as number)) / 2 - (0.17 + 0.08 * vez) * D;
    const mz = ((h.centro[3 * a + 2] as number) + (h.centro[3 * b + 2] as number)) / 2;
    const la = lado(h, m, a, mx, mz), lb = lado(h, m, b, mx, mz);
    if ((la === 1 ? m.usaIzq[a] : m.usaDer[a]) || (lb === 1 ? m.usaIzq[b] : m.usaDer[b])) continue;
    const sa = la === 1 ? h.izq : h.der, sb = lb === 1 ? h.izq : h.der;
    const largoA = Math.hypot(mx - (sa[3 * a] as number), my - (sa[3 * a + 1] as number), mz - (sa[3 * a + 2] as number));
    const largoB = Math.hypot(mx - (sb[3 * b] as number), my - (sb[3 * b + 1] as number), mz - (sb[3 * b + 2] as number));
    if (largoA > ALCANCE * BRAZO * da || largoB > ALCANCE * BRAZO * db) continue;
    ponerMano(m, a, la, mx, my, mz);
    ponerMano(m, b, lb, mx, my, mz);
    hechos++;
  }
  return hechos;
}
