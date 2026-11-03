import { normalGuajojo, POR_TANDA, T_AMANECER, T_CANTO, T_CRAC, T_LLAMADA, T_POR_TANDA, T_ULTIMO, TOPE_NORMAL, FIJOS, TARJETA, LISTA_MAX, silencioDe, silenciosPara } from "./guajojo-duracion";
import { acotar } from "./kit/azar";
import { planoEntero, planoSobre } from "./kit/director";
import { PRIORIDAD } from "./kit/guion";
import { lugarDe, type Lugar } from "./kit/respuestas";
import type { Arc, Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas, TipoPaso } from "./kit/tipos";

/**
 * Guajojó: el plan, puro.
 *
 * Un sendero del monte de noche. Todos caminan mientras canta el guajojó; cuando
 * calla, quedan quietos. Se abren sus dos ojos amarillos, la mirada barre el
 * sendero, y al que no le alcanza el freno pisa una ramita (¡crac!) y se sienta
 * en la hinchada. Gana quien llega de pie al amanecer.
 *
 * Esto es lo único que sabe lo que va a pasar y cuándo. El ganador llega dado
 * (`ctx.ganadores`) y el plan solo lo cuenta: nunca se sienta, y la última quieta
 * es la elegida, pero la sala no lo sabe porque la mirada, los tambaleos y el
 * orden en que cae cada uno salen del azar de la ronda, no de quién gana. Sin
 * DOM, sin reloj y sin `Math.random`: se prueba en Node.
 *
 * Los lugares son del sendero, no de la pantalla: `x` de -1 a 1 a lo ancho y `z`
 * de 0 (la largada, cerca) a 1 (el palo, lejos). La escena los proyecta con
 * `proyectar`, y la cámara del kit encuadra esa proyección.
 *
 * Los giros de los cuatro arcos:
 * - **susto**: en el penúltimo silencio la mirada se detiene en la ganadora, que
 *   tambalea y aguanta.
 * - **remontada**: sale última y en el último canto pasa a todos.
 * - **duelo**: un silencio más, con la rival adelante hasta el final.
 * - **tapada**: el canto corto (dos notas) y cae una tanda grande.
 */

/* ------------------------------------------------------------- las medidas */
// Los tiempos viven en `guajojo-duracion.ts`, sin dependencias: el selector necesita saber cuánto dura antes de jugarlo.
export { POR_TANDA, T_AMANECER, T_CANTO, T_CRAC, T_LLAMADA, T_POR_TANDA, T_ULTIMO, silenciosPara };
/** El canto corto de la tapada. */
export const T_CANTO_CORTO = 1.7;
/** El palo (donde está el guajojó), al fondo del sendero. */
export const Z_PALO = 1.06;
/** Adonde llega la ganadora al amanecer, a los pies del palo. */
export const Z_META = 0.97;
/** Dónde esperan los dos últimos, a cada lado del palo. */
export const Z_ULTIMOS = 0.74;
/** Cuánto sigue arrastrando los pies el que no alcanza a frenar. */
const ARRASTRE = 0.028;
/** Cuánto lleva sentarse. */
export const T_SIENTA = 0.28;

/* ------------------------------------------------------------------- tipos */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

export interface Tramo {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}

export interface Tambaleo {
  quien: number;
  t0: number;
  t1: number;
  /** `true` si no aguanta: es el que cae en el crac de este silencio. */
  cae: boolean;
}

export interface Ciclo {
  c: number;
  /** El último silencio: quedan la ganadora y la rival, y solo cae la rival. */
  ultimo: boolean;
  /** Un silencio de práctica: nadie se sienta. */
  practica: boolean;
  /** La tapada: el canto se corta antes. */
  corto: boolean;
  /** Empieza el canto, empieza el silencio, empieza el crac y termina. */
  t0: number;
  tSil0: number;
  tCrac0: number;
  t1: number;
  /** Quienes caen en este crac, en el orden en que pisan la ramita, y la hora de cada uno. */
  victimas: number[];
  tCae: number[];
  /** Las notas que baja el canto (de tres a cinco). */
  notas: number;
  mirada: Tramo[];
  tambaleos: Tambaleo[];
  /** Quién tambalea y aguanta a la vista de todos en este silencio (el que cuenta el relator), y cuándo. */
  destacado?: { quien: number; t: number };
  /** En el último silencio: a quién mira primero. */
  primero?: number;
}

export interface Datos {
  n: number;
  ganador: number;
  rival: number;
  ganadores: readonly number[];
  arco: Arc;
  ciclos: Ciclo[];
  tLista0: number;
  tLista1: number;
  tAmanecer0: number;
  /** Cuándo se sienta cada uno (Infinity si nunca), y en qué ciclo. */
  sienta: number[];
  cicloDe: number[];
  /** Dónde largan y hacia dónde van, por persona. */
  x0: number[];
  z0: number[];
  /** Hasta dónde llega cada uno al final de cada canto. */
  meta: number[][];
  /** A qué lado de la hinchada va cada uno cuando se sienta. */
  xHinchada: number[];
  /** Los tambaleos de cada persona. */
  tamb: Tambaleo[][];
  /** De a ocho, el orden en que se muestran en la lista. */
  orden: number[];
  /** Los dos últimos: sus lugares a cada lado del palo. */
  xGanador: number;
  xRival: number;
}

/* ---------------------------------------------------------------- utilidades */
const suave = (v: number): number => {
  const x = acotar(v, 0, 1);
  return x * x * (3 - 2 * x);
};
const entre = (a: number, b: number, k: number): number => a + (b - a) * k;

/** La permutación sembrada de una lista. */
function mezclar<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/**
 * Cuántos se sientan en cada silencio de práctica o de verdad (sin contar el último, que es de la rival sola).
 * Más al principio; con la tapada, el primero es una tanda grande; con más de 64, el primero sienta a la mitad.
 * Si hay menos gente que silencios, los de práctica van primero.
 */
export function repartoDe(victimas: number, ciclos: number, arco: Arc, n: number): number[] {
  const m = Math.max(1, ciclos - 1);
  if (victimas <= 0) return Array.from({ length: m }, () => 0);
  if (victimas < m) return Array.from({ length: m }, (_, c) => (c >= m - victimas ? 1 : 0));
  const peso = Array.from({ length: m }, (_, c) => Math.pow(ciclos - c, 1.4) * (c === 0 ? (arco === "tapada" ? 1.7 : n > 64 ? 2.6 : 1) : 1));
  const suma = peso.reduce((a, b) => a + b, 0);
  const crudo = peso.map((p) => (p / suma) * victimas);
  const cuenta = crudo.map((v) => Math.max(1, Math.floor(v)));
  let resto = victimas - cuenta.reduce((a, b) => a + b, 0);
  // Lo que sobra se reparte a quienes más les faltaba; lo que se pasa se saca del más grande.
  const falta = crudo.map((v, c) => ({ c, f: v - (cuenta[c] as number) })).sort((a, b) => b.f - a.f || a.c - b.c);
  for (let i = 0; resto > 0; i = (i + 1) % m) {
    const f = falta[i];
    if (f) cuenta[f.c] = (cuenta[f.c] as number) + 1;
    resto--;
  }
  while (resto < 0) {
    const big = cuenta.indexOf(Math.max(...cuenta));
    cuenta[big] = (cuenta[big] as number) - 1;
    resto++;
  }
  return cuenta;
}

/* ------------------------------------------------------------- la proyección */
export interface Geo {
  yH: number;
  yPie: number;
  mitad: number;
  cuerpo: number;
  cx: number;
  alto: number;
  retrato: boolean;
}

export function geoDe(p: Pant): Geo {
  const alto = p.bottom - p.top;
  const retrato = p.h > p.w * 1.1;
  return {
    yH: p.top + alto * (retrato ? 0.3 : 0.33),
    yPie: p.bottom - alto * 0.05,
    mitad: retrato ? p.w * 0.55 : p.w * 0.46,
    cuerpo: alto * (retrato ? 0.19 : 0.23),
    cx: p.w / 2,
    alto,
    retrato,
  };
}

/** De un lugar del sendero a la pantalla: dónde pisa y cuánto mide ahí un cuerpo (`s`, de 0 a 1). */
export function proyectar(g: Geo, x: number, z: number): { x: number; y: number; s: number } {
  const s = 1 / (1 + 1.8 * z);
  return { x: g.cx + x * g.mitad * s, y: g.yH + (g.yPie - g.yH) * s, s };
}

/** El palo del guajojó: la caja que la cámara guarda en todo cuadro (el palo entero, con los ojos). */
export function cajaDelPalo(g: Geo): Caja {
  const base = proyectar(g, 0, Z_PALO);
  const alto = g.alto * 0.34;
  const ancho = alto * 0.62;
  return { x: g.cx - ancho / 2, y: base.y - alto, w: ancho, h: alto + g.alto * 0.04 };
}

/** La caja de un cuerpo que está en (x, z), con su nombre arriba. */
export function cajaDeCuerpo(g: Geo, x: number, z: number): Caja {
  const q = proyectar(g, x, z);
  const h = g.cuerpo * q.s;
  const w = Math.max(h * 0.55, 70 * Math.min(1, g.alto / 540));
  return { x: q.x - w / 2, y: q.y - h * 1.5, w, h: h * 1.5 + h * 0.1 };
}

/* ---------------------------------------------------------------- el movimiento */
/** Cuánto camina de 0 a 1 en un canto, con arranque y freno. */
const paso = (f: number): number => suave(f);

/** Dónde está la persona `i` a lo largo del sendero en el segundo `t`. */
export function zDe(d: Datos, i: number, t: number): number {
  let z = d.z0[i] as number;
  const cae = d.cicloDe[i] as number;
  for (const c of d.ciclos) {
    if (t <= c.t0) return z;
    const g = (d.meta[i] as number[])[c.c] as number;
    if (t < c.tSil0) return entre(z, g, paso((t - c.t0) / (c.tSil0 - c.t0)));
    z = g;
    if (cae === c.c) {
      // No le alcanzó el freno: arrastra los pies hasta que pisa la ramita.
      const ts = d.sienta[i] as number;
      return z + ARRASTRE * (1 - Math.exp(-3 * (Math.min(t, ts) - c.tSil0)));
    }
  }
  if (i === d.ganador && t > d.tAmanecer0) return entre(z, Z_META, suave((t - d.tAmanecer0) / T_AMANECER));
  return z;
}

/** Dónde está de lado a lado. Los dos últimos van a su lugar junto al palo, y los que se sientan van a la hinchada. */
export function xDe(d: Datos, i: number, t: number): number {
  const base = d.x0[i] as number;
  const ult = d.ciclos[d.ciclos.length - 1] as Ciclo;
  const pen = d.ciclos[Math.max(0, d.ciclos.length - 2)] as Ciclo;
  let x = base;
  if (i === d.ganador || i === d.rival) {
    const destino = i === d.ganador ? d.xGanador : d.xRival;
    x = entre(base, destino, suave((t - pen.t0) / Math.max(0.1, ult.tSil0 - pen.t0)));
    if (i === d.ganador && t > d.tAmanecer0) x = entre(x, 0, suave((t - d.tAmanecer0) / T_AMANECER));
  }
  const ts = d.sienta[i] as number;
  if (t > ts) {
    const xs = d.xHinchada[i] as number;
    // Se quedan donde cayeron casi un segundo, para que se vea que se sientan, y recién ahí van a la hinchada.
    x = entre(x, xs, suave((t - ts - 0.9) / 0.7));
  }
  return x;
}

/** Cuánto tambalea, de 0 a 1: sube rápido cuando lo alcanza la mirada, y se afloja al aguantar. */
export function swayDe(d: Datos, i: number, t: number): number {
  let s = 0;
  for (const e of d.tamb[i] ?? []) {
    if (t < e.t0 || t > e.t1 + 0.45) continue;
    const sube = suave((t - e.t0) / 0.18);
    const baja = t > e.t1 ? 1 - suave((t - e.t1) / 0.4) : 1;
    s = Math.max(s, sube * baja);
  }
  // El que no alcanza a frenar viene tambaleando desde que se calló el canto.
  const ts = d.sienta[i] as number;
  const c = d.ciclos[d.cicloDe[i] as number];
  if (c && t >= c.tSil0 && t < ts) s = Math.max(s, 0.35 + 0.4 * suave((t - c.tSil0) / Math.max(0.1, ts - c.tSil0)));
  return s;
}

/** De 0 a 1: cuánto se sentó la persona `i` (0 de pie, 1 sentada). */
export const sentadaDe = (d: Datos, i: number, t: number): number => {
  const ts = d.sienta[i] as number;
  return Number.isFinite(ts) ? suave((t - ts) / T_SIENTA) : 0;
};

/** Cuántos siguen de pie en `t`. */
export function quedanEn(d: Datos, t: number): number {
  let sentados = 0;
  for (let i = 0; i < d.n; i++) if ((d.sienta[i] as number) <= t) sentados++;
  return Math.max(1, d.n - sentados);
}

/** Quiénes siguen de pie en `t`. */
export function enPieEn(d: Datos, t: number): number[] {
  const r: number[] = [];
  for (let i = 0; i < d.n; i++) if ((d.sienta[i] as number) > t) r.push(i);
  return r;
}

/** Dónde está la mirada en `t` y cuánto abiertos tiene los ojos (de 0 a 1), o `null` si están cerrados. */
export function miradaDe(d: Datos, t: number): { x: number; abierto: number } | null {
  for (const c of d.ciclos) {
    const ab = suave((t - (c.tSil0 + 0.05)) / 0.3) * (1 - suave((t - (c.t1 - 0.25)) / 0.25));
    if (t < c.tSil0 + 0.05 || t > c.t1) continue;
    let x = (c.mirada[0] as Tramo).x0;
    for (const tr of c.mirada) {
      if (t >= tr.t0) x = entre(tr.x0, tr.x1, suave((t - tr.t0) / Math.max(0.01, tr.t1 - tr.t0)));
      if (t < tr.t1) break;
    }
    return { x, abierto: ab };
  }
  return null;
}

/** El ciclo que está pasando en `t` y en qué fase está. */
export type FaseJuego = "llamada" | "lista" | "canto" | "silencio" | "crac" | "amanecer";
export function faseDe(d: Datos, t: number): { fase: FaseJuego; ciclo: Ciclo | null } {
  if (t < d.tLista0) return { fase: "llamada", ciclo: null };
  if (t < (d.ciclos[0] as Ciclo).t0) return { fase: "lista", ciclo: null };
  for (const c of d.ciclos) {
    if (t < c.tSil0) return { fase: "canto", ciclo: c };
    if (t < c.tCrac0) return { fase: "silencio", ciclo: c };
    if (t < c.t1) return { fase: "crac", ciclo: c };
  }
  return { fase: "amanecer", ciclo: null };
}

/** Quiénes se ven con su nombre en `t` en la lista: de a ocho, repartidos por la lista, 1,5 s cada tanda. */
export function tandaDeLista(d: Datos, t: number): number[] {
  const m = Math.min(d.n, 64);
  if (d.n > 64 || t < d.tLista0 || t >= d.tLista1) return [];
  const B = Math.max(1, Math.ceil(m / POR_TANDA));
  const b = Math.min(B - 1, Math.floor(((t - d.tLista0) / (d.tLista1 - d.tLista0)) * B));
  return d.orden.filter((_, j) => j % B === b);
}

/* ------------------------------------------------------------------ el plan */
type Evento = { desde: number; tipo: TipoPaso; quien?: number };

export function planGuajojo(ctx: Contexto): Plan<Datos> {
  const n = ctx.nombres.length;
  const ganador = ctx.ganadores[0] ?? 0;
  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  // El plan la pide acá, antes de gastar el azar en otra cosa: así el orden es siempre el mismo.
  const historia = ctx.historia(Math.max(2, n), ganador % Math.max(2, n));
  const arco = historia.arc;
  const rng = ctx.rng;

  // La rival: con varios premios, la segunda premiada (se sienta con premio); si no, la de la historia.
  const rival = n < 2 ? ganador : ctx.ganadores[1] !== undefined ? ctx.ganadores[1] : historia.rival === ganador ? (ganador + 1) % n : historia.rival % n;

  /* ------------------------------------------------- quién cae y cuándo */
  const resto = mezclar(
    Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador && i !== rival),
    rng,
  );
  const NC = silenciosPara(n) + (arco === "duelo" && n > 2 ? 1 : 0);
  const reparto = repartoDe(resto.length, NC, arco, n);
  const lista = n <= LISTA_MAX;
  const tandas = lista ? Math.ceil(n / POR_TANDA) : 0;
  const tLista0 = T_LLAMADA;
  const tLista1 = tLista0 + tandas * T_POR_TANDA;

  const sienta: number[] = Array.from({ length: n }, () => Infinity);
  const cicloDe: number[] = Array.from({ length: n }, () => -1);
  const tamb: Tambaleo[][] = Array.from({ length: n }, () => []);

  // Los lugares de la largada: la ganadora en el medio del grupo con la tapada.
  const orden = Array.from({ length: n }, (_, i) => i).sort((a, b) => ctx.azar(`orden:${a}`) - ctx.azar(`orden:${b}`));
  if (arco === "tapada" && n > 2) {
    orden.splice(orden.indexOf(ganador), 1);
    orden.splice(Math.floor(orden.length / 2), 0, ganador);
  }
  const filas = n <= 6 ? 1 : n <= 24 ? 3 : n <= 60 ? 5 : 9;
  const x0 = Array.from({ length: n }, () => 0);
  const z0 = Array.from({ length: n }, () => 0);
  const ancho = Math.min(0.84, 0.18 + 0.12 * n);
  orden.forEach((idx, k) => {
    x0[idx] = n === 1 ? 0 : -ancho + (2 * ancho * k) / (n - 1) + (ctx.azar(`x:${idx}`) - 0.5) * 0.03;
    z0[idx] = ((k % filas) / Math.max(1, filas)) * 0.08;
  });
  // La ganadora y la rival, al final, quedan a cada lado del palo; de qué lado, lo sortea la ronda.
  const ladoG = ctx.azar("lado") < 0.5 ? -1 : 1;
  const xGanador = 0.4 * ladoG;
  const xRival = -0.4 * ladoG;

  /* ----------------------------------------------------------- los ciclos */
  const ciclos: Ciclo[] = [];
  let t = tLista1;
  let dado = 0;
  const hacia = (c: number): number => (ctx.azar(`dir:${c}`) < 0.5 ? -1 : 1);
  for (let c = 0; c < NC; c++) {
    const ultimo = c === NC - 1;
    const corto = arco === "tapada" && c === 0 && NC > 2;
    const canto = corto ? T_CANTO_CORTO : T_CANTO;
    const sil = ultimo ? T_ULTIMO : silencioDe(c);
    const t0 = t;
    const tSil0 = t0 + canto;
    const tCrac0 = tSil0 + sil;
    const t1 = tCrac0 + T_CRAC;
    const quienes = ultimo ? [rival] : resto.slice(dado, dado + (reparto[c] as number));
    if (!ultimo) dado += reparto[c] as number;
    ciclos.push({
      c, ultimo, practica: !ultimo && quienes.length === 0, corto, t0, tSil0, tCrac0, t1,
      victimas: quienes, tCae: [], notas: corto ? 2 : 3 + Math.floor(ctx.azar(`notas:${c}`) * 3), mirada: [], tambaleos: [],
    });
    t = t1;
  }
  const tAmanecer0 = t;
  const duracion = tAmanecer0 + T_AMANECER;

  /* ------------------------------------------------ hasta dónde llega cada uno */
  const pace = Array.from({ length: n }, (_, i) => 0.76 + 0.18 * ctx.azar(`pace:${i}`));
  const meta = Array.from({ length: n }, () => [] as number[]);
  // Quién va adelante cuando quedan dos lo sortea la ronda, en todos los arcos: si la remontada dejara siempre atrás a la
  // ganadora y el duelo adelante a la rival, el que va atrás ganaría en la mitad de las rondas (lo mide `audit-delatores`).
  const delante = ctx.azar("delante") < 0.5 ? ganador : rival;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < NC; c++) {
      // Desde el primer canto el grupo se acerca al palo: lo que falta se ve en el sendero, no solo en el contador.
      const f = 0.28 + (0.72 * (c + 1)) / (NC + 1.1);
      let g = (pace[i] as number) * f;
      if (i === ganador || i === rival) {
        const comun = arco === "remontada" ? 0.9 * Math.pow(f, 1.9) : arco === "duelo" ? 0.97 * f : 0.92 * f;
        g = Math.min(comun * (i === delante ? 1.05 : 0.95), Z_ULTIMOS - 0.03);
      }
      // Los dos últimos llegan juntos a sus lugares junto al palo.
      if ((i === ganador || i === rival) && c === NC - 1) g = Z_ULTIMOS;
      (meta[i] as number[]).push(Math.max(g, (z0[i] as number) + 0.02));
    }
  }
  // Un solo valor a la mitad del sendero para los que quedan: ni el más adelantado ni el último delata.
  const xHinchada = Array.from({ length: n }, (_, i) => {
    const lado = (x0[i] as number) < 0 ? -1 : 1;
    return lado * (1.25 + 0.55 * ctx.azar(`hin:${i}`));
  });

  /* ----------------------------------- la mirada, los tambaleos y los cracs */
  const datos: Datos = {
    n, ganador, rival, ganadores: ctx.ganadores, arco, ciclos, tLista0, tLista1, tAmanecer0, sienta, cicloDe, x0, z0, meta, xHinchada,
    tamb, orden: orden.slice(0, Math.min(n, 64)), xGanador, xRival,
  };
  const eventos: Evento[] = [{ desde: 0, tipo: "empezo" }];
  const sustoEn = Math.max(0, NC - 2);

  for (const ci of ciclos) {
    const dir = hacia(ci.c);
    const vivos: number[] = [];
    for (let i = 0; i < n; i++) if ((sienta[i] as number) > ci.tSil0) vivos.push(i);
    // El barrido: de un borde del sendero al otro, entre que se abren los ojos y el crac.
    const b0 = ci.tSil0 + 0.45;
    const b1 = ci.tCrac0 - 0.1;
    const xAt = (i: number): number => xDe(datos, i, ci.tSil0);

    if (ci.ultimo) {
      // Los dos últimos, quietos junto al palo: la mirada va a uno, después al otro, y cae la rival.
      // A quién mira primero lo sortea la ronda en todos los arcos: si el susto empezara siempre por la ganadora, el último que se nombra solo sería ella.
      const empieza = ctx.azar("primero") < 0.5 ? ganador : rival;
      ci.primero = empieza;
      const xg = xGanador, xr = xRival;
      const s = ci.tSil0;
      const aGanador = (a: number, b: number, hold: number): Tambaleo => ({ quien: ganador, t0: s + a, t1: s + b + hold, cae: false });
      if (empieza === ganador) {
        ci.mirada = [
          { t0: s + 0.05, t1: s + 0.55, x0: 0, x1: xg },
          { t0: s + 0.55, t1: s + 1.9, x0: xg, x1: xg },
          { t0: s + 1.9, t1: s + 2.5, x0: xg, x1: xr },
          { t0: s + 2.5, t1: ci.t1, x0: xr, x1: xr },
        ];
        ci.tambaleos = [aGanador(0.8, 1.7, 0), { quien: rival, t0: s + 2.55, t1: ci.tCrac0 + 0.1, cae: true }];
        ci.destacado = { quien: ganador, t: s + 0.9 };
      } else {
        ci.mirada = [
          { t0: s + 0.05, t1: s + 0.5, x0: 0, x1: xr },
          { t0: s + 0.5, t1: s + 1.4, x0: xr, x1: xr },
          { t0: s + 1.4, t1: s + 1.9, x0: xr, x1: xg },
          { t0: s + 1.9, t1: s + 2.7, x0: xg, x1: xg },
          { t0: s + 2.7, t1: s + 3.2, x0: xg, x1: xr },
          { t0: s + 3.2, t1: ci.t1, x0: xr, x1: xr },
        ];
        ci.tambaleos = [
          { quien: rival, t0: s + 0.8, t1: s + 1.4, cae: false },
          aGanador(2.0, 2.6, 0),
          { quien: rival, t0: s + 3.25, t1: ci.tCrac0 + 0.1, cae: true },
        ];
        ci.destacado = { quien: rival, t: s + 0.9 };
      }
      ci.tCae = [ci.tCrac0 + 0.1];
    } else {
      // El barrido pasa por cada lugar del sendero; el que cae se tambalea cuando lo alcanza y pisa la ramita en el crac.
      const x0b = -1.1 * dir;
      const x1b = 1.1 * dir;
      const llega = (x: number): number => b0 + ((x - x0b) / (x1b - x0b)) * (b1 - b0);
      const vict = [...ci.victimas].sort((a, b) => (xAt(a) - xAt(b)) * dir);
      // Con la ganadora en vilo (el susto) la mirada se detiene en ella, tambalea y sigue.
      const conSusto = arco === "susto" && ci.c === sustoEn && !ci.practica;
      const hold = 0.75;
      const xw = xAt(ganador);
      // Cuándo llega la mirada a un lugar: lo que está más allá de la ganadora la alcanza después de que se detuvo en ella.
      const llegaCon = (x: number): number => llega(x) + (conSusto && (x - xw) * dir > 0 ? hold : 0);
      if (conSusto) {
        const tw = llega(xw);
        ci.mirada = [
          { t0: b0, t1: tw, x0: x0b, x1: xw },
          { t0: tw, t1: tw + hold, x0: xw, x1: xw },
          { t0: tw + hold, t1: b1 + hold, x0: xw, x1: x1b },
        ];
        ci.tambaleos.push({ quien: ganador, t0: tw, t1: tw + hold, cae: false });
        ci.destacado = { quien: ganador, t: tw + 0.1 };
      } else ci.mirada = [{ t0: b0, t1: b1, x0: x0b, x1: x1b }];
      // Cuándo cae cada uno: en el orden de la mirada, apilados al principio del crac.
      const sep = Math.min(0.12, 0.55 / Math.max(1, vict.length - 1));
      vict.forEach((i, j) => {
        const tc = ci.tCrac0 + 0.04 + j * sep;
        ci.tCae.push(tc);
        ci.tambaleos.push({ quien: i, t0: Math.min(tc - 0.25, llegaCon(xAt(i))), t1: tc, cae: true });
      });
      ci.victimas = vict;
      // Algunos de los que se salvan también tambalean: así tambalear no delata a quien cae, ni a quien gana.
      const salvos = vivos.filter((i) => !vict.includes(i) && i !== ganador);
      const quiere = Math.min(salvos.length, n <= 8 ? 1 : Math.min(6, Math.round(vivos.length * 0.35)));
      const elegidos = mezclar(salvos, rng).slice(0, quiere);
      // La ganadora tambalea con la misma chance que los demás que se salvan.
      if (!conSusto && vivos.includes(ganador) && rng() < quiere / Math.max(1, salvos.length + 1)) elegidos.push(ganador);
      for (const i of elegidos) {
        const ta = llegaCon(xAt(i));
        ci.tambaleos.push({ quien: i, t0: ta, t1: ta + 0.6, cae: false });
      }
      if (!ci.destacado) {
        const d = ci.tambaleos.filter((e) => !e.cae).sort((a, b) => a.t0 - b.t0)[0];
        if (d && !ci.practica) ci.destacado = { quien: d.quien, t: d.t0 + 0.1 };
        else if (d) ci.destacado = { quien: d.quien, t: d.t0 + 0.1 };
      }
      // La práctica: la mirada pasa, todos aguantan y nadie se sienta; sin tambaleos no habría nada que mirar.
      if (ci.practica && ci.tambaleos.length === 0 && vivos.length > 0) {
        const i = vivos.find((v) => v !== ganador) ?? (vivos[0] as number);
        const ta = llegaCon(xAt(i));
        ci.tambaleos.push({ quien: i, t0: ta, t1: ta + 0.7, cae: false });
        ci.destacado = { quien: i, t: ta + 0.1 };
      }
    }
    for (const e of ci.tambaleos) (tamb[e.quien] as Tambaleo[]).push(e);
    ci.victimas.forEach((i, j) => {
      sienta[i] = ci.tCae[j] as number;
      cicloDe[i] = ci.c;
    });
    // Un solo hecho por silencio le cuenta al niño qué pasó: el que se sienta (el primero), o el que aguanta.
    if (ci.destacado && (ci.victimas.length === 0 || ci.destacado.t < (ci.tCae[0] as number) - 0.4)) {
      eventos.push({ desde: ci.destacado.t, tipo: "casi", quien: ci.destacado.quien });
    }
    if (ci.victimas.length) eventos.push({ desde: ci.tCae[0] as number, tipo: "salio", quien: ci.victimas[0] });
  }
  eventos.push({ desde: duracion, tipo: "gano", quien: ganador });
  eventos.sort((a, b) => a.desde - b.desde);

  /* ------------------------------------------------------------- el guion */
  const nom = (i: number): string => ctx.nombres[i] ?? "";
  const guion: LineaGuion[] = [];
  const decir = (tt: number, clave: string, o: Partial<LineaGuion> = {}, ...args: unknown[]): void => {
    guion.push({ t: tt, texto: ctx.txt(clave, ...args), ...o });
  };
  decir(0.3, "intro", { calor: 0.1 });
  decir(tLista0 + 0.1, "lista", { calor: 0.15 });
  // En la lista, cada tres segundos una frase: la sala nunca espera cuatro sin que le digan algo.
  for (let tt = tLista0 + 2.9; tt < tLista1 - 0.4; tt += 2.9) decir(tt, "busquen", { calor: 0.15 });
  // La llamada: cae el sol, el silbo del guajojó de lejos (tres notas que bajan) y los grillos, que siguen mientras se pasa lista.
  guion.push({ t: 0.2, hacer: (k) => k.sonido.tono(14, "evento", { dur: 0.55, timbre: "sine", vol: 0.05 }) });
  [12, 9, 5].forEach((grado, j) => guion.push({ t: 0.95 + j * 0.4, hacer: (k) => k.sonido.tono(grado, "evento", { dur: 0.22, timbre: "sine", vol: 0.04 }) }));
  for (let j = 0; 0.5 + j * 0.8 < tLista1 - 0.2; j++) guion.push({ t: 0.5 + j * 0.8, hacer: (k) => { k.sonido.tono(17 + (j % 2), "fondo", { dur: 0.05, vol: 0.022 }); k.sonido.despues(110, () => k.sonido.tono(17 + (j % 2), "fondo", { dur: 0.05, vol: 0.02 })); } });
  for (let i = 0; i < tandas; i++) guion.push({ t: tLista0 + i * T_POR_TANDA, hacer: (k) => k.sonido.escalera([7, 8, 9], 70) });
  for (const ci of ciclos) {
    const cal = 0.2 + 0.5 * (ci.c / Math.max(1, NC - 1));
    // Del tercer canto en adelante cambian las dos frases: el ciclo 2 no repite lo que ya se dijo en el 1.
    decir(ci.t0 + 0.05, ci.c === 0 ? "canta" : ci.c === 1 ? "cantaOtra" : "cantaMas", { calor: cal });
    // El silbo, y las notas que bajan; la grave es "¡quietos!".
    guion.push({ t: ci.t0 + 0.05, hacer: (k) => k.sonido.tono(14, "evento", { dur: 0.55, timbre: "sine", vol: 0.06 }) });
    for (let j = 0; j < ci.notas; j++) {
      const grado = [12, 11, 9, 7, 5][j] as number;
      const tn = ci.t0 + (ci.corto ? 0.65 : 0.7) + j * (ci.corto ? 0.4 : 0.32);
      guion.push({ t: tn, hacer: (k) => k.sonido.tono(grado, "evento", { dur: 0.22, timbre: "sine", vol: j === ci.notas - 1 ? 0.055 : 0.045 }) });
    }
    // Los pasos: se oyen mientras caminan.
    for (let j = 0; ci.t0 + 0.2 + j * 0.5 < ci.tSil0 - 0.15; j++) guion.push({ t: ci.t0 + 0.2 + j * 0.5, hacer: (k) => k.sonido.tono(3 + (j % 2), "fondo", { dur: 0.06, vol: 0.022 }) });
    // El grito de la sala es «¡Quietos!», no el nombre de quien se sienta después: el cartel grande va aquí.
    decir(ci.tSil0 + 0.02, ci.ultimo ? "ultimos" : ci.c >= 2 ? "callaOtra" : "calla", { calor: cal + 0.1, prioridad: PRIORIDAD.importante, grito: !ci.ultimo });
    guion.push({ t: ci.tSil0 + 0.02, hacer: (k) => { k.sonido.tono(15, "evento", { dur: 0.25, timbre: "sine", vol: 0.05 }); k.sonido.despues(110, () => k.sonido.tono(17, "evento", { dur: 0.25, timbre: "sine", vol: 0.045 })); } });
    // El latido del silencio.
    for (let j = 0; ci.tSil0 + 0.5 + j * 0.75 < ci.tCrac0; j++) guion.push({ t: ci.tSil0 + 0.5 + j * 0.75, hacer: (k) => k.sonido.tono(3, "fondo", { dur: 0.1, timbre: "sine", vol: 0.03 }) });
    if (ci.destacado && (ci.victimas.length === 0 || ci.destacado.t < (ci.tCae[0] as number) - 0.4)) {
      const q = ci.destacado.quien;
      guion.push({
        t: ci.destacado.t,
        // Quien aguanta no se nombra nunca (los nombres están en las etiquetas): el rótulo pasa a quien mira la mirada, y si nombrara
        // a la ganadora, o nunca la nombrara, el último nombrado que sigue de pie la delataría (o delataría a las demás): lo mide `audit-delatores`.
        texto: ci.ultimo ? ctx.txt("alguien") : ctx.txt(ctx.azar(`frase:${ci.c}`) < 0.5 ? "enUnPie" : "aguanta", nom(q)),
        calor: cal + 0.15,
        prioridad: PRIORIDAD.importante,
        hecho: { tipo: "casi", quien: q },
        hacer: (k) => k.sonido.tono(13, "evento", { dur: 0.12, timbre: "square", vol: 0.05 }),
      });
    }
    // El crac: el primero que pisa la ramita, o todos los que caen.
    ci.victimas.forEach((i, j) => {
      const tc = ci.tCae[j] as number;
      if (j === 0) {
        const textos = ci.ultimo && ctx.ganadores.length > 1 ? ctx.txt("conPremio") : ci.victimas.length > 3 ? ctx.txt("varios") : ctx.txt("crac", nom(i));
        guion.push({
          t: tc, texto: textos, calor: cal + 0.3, prioridad: PRIORIDAD.importante, hecho: { tipo: "salio", quien: i },
          hacer: (k) => { k.sonido.tono(8, "evento", { dur: 0.05, timbre: "square", vol: 0.055 }); k.sonido.salida(); },
        });
      } else if (j < 4 || j % 3 === 0) {
        guion.push({ t: tc, hacer: (k) => k.sonido.tono(8 + (j % 3), "evento", { dur: 0.05, timbre: "square", vol: 0.04 }) });
      }
    });
  }
  // El amanecer: la ganadora camina sola al palo.
  guion.push({ t: tAmanecer0 + 0.1, texto: ctx.txt("amanece"), calor: 0.9, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.escalera([5, 7, 9, 12, 14], 180) });
  for (let j = 0; tAmanecer0 + 0.6 + j * 0.6 < duracion - 0.2; j++) guion.push({ t: tAmanecer0 + 0.6 + j * 0.6, hacer: (k) => k.sonido.tic(j) });
  const ultimoCiclo = ciclos[ciclos.length - 1] as Ciclo;

  /* -------------------------------------------------------- el marcador y las respuestas */
  const marcador = (tt: number): number => (tt >= duracion ? 1 : quedanEn(datos, tt));
  const respuestas = (tt: number): Respuestas => {
    const ult = [...eventos].filter((e) => e.desde <= tt).at(-1) ?? (eventos[0] as Evento);
    const vivos = tt >= duracion ? [ganador] : enPieEn(datos, tt);
    // Dónde están los que siguen: su medio en la pantalla de siempre.
    const g = geoDe({ w: 1280, h: 720, k: 1, top: 82, bottom: 614 });
    let sx = 0, sy = 0;
    for (const i of vivos) {
      const q = proyectar(g, xDe(datos, i, tt), zDe(datos, i, tt));
      sx += q.x;
      sy += q.y;
    }
    const lugar: Lugar = lugarDe(sx / Math.max(1, vivos.length), sy / Math.max(1, vivos.length), 1280, 720);
    const vieja = tt - ult.desde > 3 && ult.tipo !== "empezo" && ult.tipo !== "gano";
    return {
      adelante: { quienes: vivos, lugar },
      hacia: "arriba",
      progreso: acotar(tt / duracion, 0, 1),
      paso: { tipo: vieja ? "nada" : ult.tipo, quien: vieja ? undefined : ult.quien, desde: ult.desde },
    };
  };

  /* --------------------------------------------------------------- la cámara */
  const geo = (k: Kit): Geo => geoDe(k.pantalla());
  const elPalo = (k: Kit): Caja => cajaDelPalo(geo(k));
  const enLaCancha = (k: Kit, tt: number): Caja[] => {
    const g = geo(k);
    const vivos = enPieEn(datos, tt);
    const cajas = vivos.length ? vivos.map((i) => cajaDeCuerpo(g, xDe(datos, i, tt), zDe(datos, i, tt))) : [cajaDeCuerpo(g, 0, Z_META)];
    return cajas;
  };
  const mundo = (k: Kit): Caja => {
    const p = k.pantalla();
    return { x: 0, y: p.top, w: p.w, h: p.bottom - p.top };
  };
  // Los planos intermedios: detrás del grupo mientras camina, y a los ojos del palo cuando calla.
  const tomas: { desde: number; toma: ReturnType<typeof planoSobre> }[] = [];
  for (const ci of ciclos) {
    if (ci.ultimo) continue;
    tomas.push({ desde: ci.t0, toma: planoSobre((k, tt) => [...enLaCancha(k, tt), elPalo(k)], { margen: 18, zoomMax: 1.2, ritmo: 2 }) });
    tomas.push({ desde: ci.tSil0 + 0.2, toma: planoSobre((k, tt) => [...enLaCancha(k, tt), elPalo(k)], { margen: 6, zoomMax: 1.4, ritmo: 2.5 }) });
  }
  const momentos: Momentos = {
    presentacion: { hasta: tLista1, toma: planoEntero(mundo) },
    tomas,
    // La tensión mira a los dos últimos y al palo, no a quien gana solo: es lo que se decide.
    tension: {
      // Un rato después de que cae el último de los otros, para que ese crac no quede fuera de cuadro.
      desde: ultimoCiclo.t0 + 0.6,
      toma: planoSobre(
        (k, tt) => {
          const g = geo(k);
          const q = (i: number): Caja => cajaDeCuerpo(g, xDe(datos, i, tt), zDe(datos, i, tt));
          // Hasta que cae la rival, los dos; después, quien llega al palo, con el palo.
          return tt < ultimoCiclo.tCrac0 + 0.3 ? [q(ganador), q(rival), elPalo(k)] : [q(ganador), elPalo(k)];
        },
        { margen: 10, zoomMax: 1.6, ritmo: 2.5 },
      ),
    },
    // El palo está en todo cuadro: ahí se mira y ahí llega quien gana.
    meta: (k) => elPalo(k),
    // Dónde queda quien gana en la pantalla cuando llega al palo.
    foco: (k) => {
      const p = k.pantalla();
      const g = geoDe(p);
      const q = proyectar(g, 0, Z_META);
      const s = k.cam.toScreen(q.x, q.y - g.cuerpo * q.s * 0.55, p.w, p.h);
      const z = Math.max(0.3, k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x);
      return { x: s.x, y: s.y, r: Math.max(36 * p.k, g.cuerpo * q.s * 0.9) * z };
    },
  };

  return {
    duracion,
    arco,
    sentido: "arriba",
    marcador,
    respuestas,
    momentos,
    guion,
    // Lo que promete «Normal» no depende del arco: sale de la cantidad de gente (`guajojo-duracion.ts`), y el estiramiento absorbe el duelo.
    normal: n >= 2 ? normalGuajojo(n) : Math.min(TOPE_NORMAL, Math.round(duracion + FIJOS + TARJETA)),
    marcas: { guajojo: `${n}/${NC}` },
    datos,
  };
}
