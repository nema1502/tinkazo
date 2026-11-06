import { acotar } from "./kit/azar";
import { planoEntero, planoSobre } from "./kit/director";
import { marcadorPorSalidas } from "./kit/marcador";
import { PRIORIDAD } from "./kit/guion";
import { wavesAround } from "./qualifier";
import type { Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas, TipoPaso } from "./kit/tipos";

/**
 * Bolillas: el plan, puro.
 *
 * El juego se llama Bolillas porque así se dice en Santa Cruz; la variante es
 * **la troya** (es.wikipedia.org/wiki/Canica): un círculo de tiza en la tierra,
 * las canicas de los que juegan adentro, y una pegadora que tira por turnos;
 * cada canica que cruza la tiza queda eliminada. El resultado ya lo fijó el
 * protocolo: la canica de quien gana es **la última que queda adentro**, y
 * ninguna tirada la saca. El plan solo cuenta esa historia.
 *
 * De la lista y la ronda sale todo: la siembra de las canicas dentro del
 * círculo (espiral sembrada, de a una por persona), la tanda previa cuando no
 * caben todos (`qualifier.ts`), el orden sembrado en que la pegadora saca
 * canicas de a una, la rival de la historia al final, y el **casi** del cierre:
 * la última tirada rozó la canica que gana, que titila en la tiza… y se queda
 * adentro. Cada tiro trae su geometría completa —punto de largada, impacto,
 * salida de la canica golpeada con su rumbo y su fuerza, y la deflectación del
 * tiro— para que la escena 2D (`bolillas.ts`) y la 3D (`tres/`) animen el mismo
 * plan, y ninguna vuelva a tirar por su cuenta.
 *
 * Sin DOM, sin reloj y sin `Math.random`: la misma ronda cuenta lo mismo en
 * cualquier equipo, y se prueba en Node (`bolillas-plan.test.ts`). Todo va en
 * unidades del círculo: el centro de la tierra es (0,0) y la tiza queda a
 * `CIRCULO_R`; los mapas de pantalla (`mapeoDe`) los traduce a mundo.
 *
 * Además de lo que pasa, el plan declara lo que pide la regla del niño (26 de
 * octubre de 2026): cualquier cuadro, sin leer, dice quiénes siguen adentro,
 * hacia dónde se juega, cuánto falta y qué acaba de pasar.
 */

/** Hasta cuántas canicas caben jugando la troya; con más, hay tanda previa (`qualifier.ts`, como en el sapo). */
export const CANICAS_MAX = 12;
/** La tiza, desde el centro de la tierra. */
export const CIRCULO_R = 1;
/** El radio de una canica, en unidades del círculo. */
export const CANICA_R = 0.05;
/** La holgura con que un tramo de tiro pasa junto a una canica que sigue adentro. */
export const MARGEN = 0.02;
/** Desde dónde tira la pegadora: fuera del círculo, a esta distancia del centro. */
export const PEGADORA_DIST = 1.55;
/** Siembra la canica que gana a esta distancia de la tiza: tan cerca que titila. */
const TITILA_R = CIRCULO_R - CANICA_R * 1.1;

/** Los segundos del show: la presentación, las oleadas de la tanda previa y el pulso de los tiros. Publicado para las escenas: es el beat de la intro que ve la sala (S18). */
export const T_INTRO = 3.2;
const Q_WAVE = 2.8;
const CIERRA_CLAS = 1.1;
const ENTRA_CIRC = 0.8;
const PRIMER_TIRO = 2;
const ENTRE_TIROS = 1.6;
const ANTES_CASI = 2.4;
const GOLPE_EN = 3.4;

/** Lo que mide la fuerza de una salida, en unidades del círculo por segundo. */
const FUERZA_MIN = 0.9;
const FUERZA_BANDA = 0.5;

export interface Pun {
  x: number;
  y: number;
}

/** El tamaño de la pantalla y la franja libre entre la barra de arriba y el relator. */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

/**
 * Un tiro de la pegadora: todo lo que las escenas necesitan para animarlo, en
 * unidades del círculo. El impacto cae sobre la canica que sale; su salida va
 * hasta la tiza (`tiza`, donde la cruza); el tiro se desvía y se frena en
 * `deflexion.hasta`.
 */
export interface Tiro {
  /** La persona que saca, por su puesto en la lista. */
  diana: number;
  /** La canica que sale, por su asiento en `posiciones` y en `canicas`. */
  slot: number;
  /** El segundo de juego del impacto. */
  t: number;
  /** Dónde larga la pegadora su canica: siempre afuera de la tiza. */
  desde: Pun;
  /** El impacto: cayo sobre la canica que saca (su lugar de la siembra). */
  impacto: Pun;
  /** La salida de la canica golpeada: rumbo unitario, dónde cruza la tiza, la fuerza y lo que vuela. */
  salida: { dir: Pun; tiza: Pun; fuerza: number; vuelo: number };
  /** La deflectación del tiro: su rumbo nuevo y dónde queda frenado. */
  deflexion: { dir: Pun; hasta: Pun };
}

/** El casi del cierre: la última tirada roza a la canica que gana, que titila en la tiza y se queda. */
export interface Casi {
  /** El segundo de juego del roce. */
  t: number;
  /** Quien gana el primer premio: es la canica que titila. */
  ganador: number;
  /** Su canica, por su asiento. */
  slot: number;
  /** Dónde estaba cuando la rozan (su lugar de la siembra). */
  desde: Pun;
  /** El rumbo del rodado, en unidades del círculo. */
  dir: Pun;
  /** Dónde titila: casi tocando la tiza, todavía adentro. */
  titila: Pun;
}

/** La tanda previa: los que cruzan en una oleada, cruzados todos en el mismo segundo. */
export interface Oleada {
  t: number;
  /** Los que cruzan, por su puesto en la lista. */
  gente: number[];
}

export interface Datos {
  n: number;
  /** Quien gana el primer premio: su puesto en la lista. Su canica es la última adentro. */
  ganador: number;
  /** Todos los premios: sus canicas también se quedan adentro hasta el final. */
  ganadores: number[];
  /** La rival de la historia: su canica sale en el último tiro de la troya. */
  rival: number;
  /** La canica de cada asiento: el puesto en la lista de la persona que la lleva. */
  canicas: number[];
  /** La siembra: dónde queda cada canica dentro del círculo, por su asiento. */
  posiciones: Pun[];
  /** Qué canica sale detrás de qué: los puestos que saca la pegadora, la rival al final. */
  orden: number[];
  /** La tanda previa, si sobra gente para el círculo: vacío cuando juegan todos. */
  oleadas: Oleada[];
  /** Cuándo arranca la troya: los finalistas tienen sus canicas en el círculo. */
  tTroya: number;
  /** Los tiros de la pegadora, en orden. */
  tiros: Tiro[];
  /** El casi del cierre, sobre la canica que gana. */
  casi: Casi;
  /** El segundo del golpe: con el cartel, la canica que titila gana. */
  duracion: number;
}

/* ------------------------------------------------------------------ mapas */

/** Cómo el círculo cae en el mundo: su centro en pantalla y cuánto mide una unidad del círculo. */
export interface Mapeo {
  cx: number;
  cy: number;
  e: number;
}

/** Cuánto del ancho de la pantalla mide de radio el círculo (S16): el encuadre de cerca que pidió la sala. */
const ENCUADRE_ANCHO = 0.47;
/** Cuánto de la franja libre, en alto: siempre inscripto, con aire, móvil primero. */
const ENCUADRE_ALTO = 0.45;

/** La tierra cabe entera en la franja libre, centrada, y de cerca: el círculo llena la pantalla sin tocarse los bordes (S16). */
export function mapeoDe(p: Pant): Mapeo {
  const zona = p.bottom - p.top;
  return { cx: p.w / 2, cy: (p.top + p.bottom) / 2, e: Math.min(p.w * ENCUADRE_ANCHO, zona * ENCUADRE_ALTO) };
}

/** De unidades del círculo a mundo. */
export const aMundo = (m: Mapeo, q: Pun): Pun => ({ x: m.cx + q.x * m.e, y: m.cy + q.y * m.e });

/** Lo que ocupa el círculo de tiza en el mundo, para la cámara. */
export function cajaDelCirculo(p: Pant): Caja {
  const m = mapeoDe(p);
  return { x: m.cx - m.e, y: m.cy - m.e, w: 2 * m.e, h: 2 * m.e };
}

/** Lo que ocupa una canica (con su nombre al lado) en el mundo, para encuadrarla. */
export function cajaDeCanica(p: Pant, q: Pun): Caja {
  const m = mapeoDe(p);
  const c = aMundo(m, q);
  return { x: c.x - 18 * p.k, y: c.y - 18 * p.k, w: 36 * p.k, h: 36 * p.k };
}

/* ------------------------------------------------------------- geometría */

const modulo = (p: Pun): number => Math.hypot(p.x, p.y);
const restar = (a: Pun, b: Pun): Pun => ({ x: a.x - b.x, y: a.y - b.y });
const sumar = (a: Pun, b: Pun): Pun => ({ x: a.x + b.x, y: a.y + b.y });
const escalar = (v: Pun, k: number): Pun => ({ x: v.x * k, y: v.y * k });
const unitario = (v: Pun): Pun => {
  const m = modulo(v) || 1;
  return escalar(v, 1 / m);
};
/** El rumbo unitario de un vector, para las escenas. */
export const unitarioDe = unitario;
const mover = (p: Pun, dir: Pun, largo: number): Pun => sumar(p, escalar(dir, largo));

/** La distancia de un punto al tramo `a`-`b`. */
function distSeg(p: Pun, a: Pun, b: Pun): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const f = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return modulo(restar(p, { x: a.x + f * dx, y: a.y + f * dy }));
}

/** A qué distancia del punto `p` sale un rayo con rumbo `dir` del círculo de radio `r` (el mayor de los dos). */
function cruceDe(p: Pun, dir: Pun, r: number): number {
  const b = p.x * dir.x + p.y * dir.y;
  const resto = b * b - (p.x * p.x + p.y * p.y - r * r);
  const s = Math.sqrt(Math.max(0, resto));
  return Math.max(-b + s, -b - s, -b + Math.abs(s));
}

/** Un rumbo sembrado que barre alrededor de `base` en pasos fijos: 0, +1, -1, +2, -2... */
function barrido(base: number, paso: number, i: number): number {
  return base + (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * paso;
}

/** Ningún punto de `quienes` roza el tramo `a`-`b`, con su holgura. */
const tramoLibre = (a: Pun, b: Pun, quienes: readonly Pun[], h: number): boolean => quienes.every((q) => distSeg(q, a, b) >= h);

const HOLGURA = CANICA_R * 2 + MARGEN;

/** Dónde larga la pegadora: fuera del círculo, barriendo ángulos y distancias hasta que el tramo entra libre. */
function largadaDe(impacto: Pun, quieta: readonly Pun[], rng: () => number): Pun {
  const base = Math.atan2(impacto.y, impacto.x) + (rng() - 0.5) * 0.7;
  const distancias = [PEGADORA_DIST, 1.85, 1.7, 2.05];
  for (let i = 0; i < 48; i++) {
    const a = barrido(base, (2 * Math.PI) / 48, i);
    for (const d of distancias) {
      const p = { x: d * Math.cos(a), y: d * Math.sin(a) };
      if (quieta.every((q) => distSeg(q, p, impacto) >= HOLGURA)) return p;
    }
  }
  // Sin largada del todo libre (círculo lleno, tanda de a doce): la de siempre, sobre el radial del impacto.
  const a = Math.atan2(impacto.y, impacto.x);
  return { x: PEGADORA_DIST * Math.cos(a), y: PEGADORA_DIST * Math.sin(a) };
}

/**
 * El rumbo de salida de una canica golpeada: hacia afuera, barriendo alrededor del radial. El tramo desde
 * su lugar hasta la tiza tiene que quedar libre para las canicas que siguen adentro (las de los premios
 * incluidas, que son las que el plan más cuida): si ninguna dirección sale libre, gana la que más aire
 * dejo, siempre sin rozar a un premio.
 */
function rumboSalida(d: Pun, quieta: readonly Pun[], rng: () => number): { dir: Pun; tiza: Pun; holgura: number } {
  const base = Math.atan2(d.y, d.x) + (rng() - 0.5) * 0.5;
  const radial = unitario(d);
  let mejor: { dir: Pun; tiza: Pun; holgura: number } | null = null;
  for (let i = 0; i < 36; i++) {
    const a = barrido(base, (2 * Math.PI) / 36, i);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    if (dir.x * radial.x + dir.y * radial.y < 0.06) continue;
    const tiza = mover(d, dir, cruceDe(d, dir, CIRCULO_R));
    const h = Math.min(...quieta.map((q) => distSeg(q, d, tiza)), 9);
    if (!mejor || h > mejor.holgura) mejor = { dir, tiza, holgura: h };
    if (mejor && mejor.holgura >= HOLGURA) return mejor;
  }
  // Sin salida libre, la que más aire dejó: la narración respeta el plan, y el plan a quien gana.
  return (mejor ?? { dir: radial, tiza: mover(d, radial, cruceDe(d, radial, CIRCULO_R)), holgura: 0 }) as { dir: Pun; tiza: Pun; holgura: number };
}

/** La deflectación del tiro: se corre del rumbo de ida y se frena en el primer lugar libre que encuentra. */
function deflexionDe(de: Pun, impacto: Pun, quieta: readonly Pun[], rng: () => number): { dir: Pun; hasta: Pun } {
  const ida = unitario(restar(impacto, de));
  const vuelta = rng() < 0.5 ? 1 : -1;
  const base = Math.atan2(ida.y, ida.x) + vuelta * (0.35 + rng() * 0.3);
  for (let i = 0; i < 24; i++) {
    const a = barrido(base, (2 * Math.PI) / 24, i);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const s = Math.min(0.5, cruceDe(impacto, dir, CIRCULO_R));
    const hasta = mover(impacto, dir, s);
    if (quieta.every((q) => distSeg(q, impacto, hasta) >= HOLGURA && modulo(restar(q, hasta)) >= HOLGURA)) return { dir, hasta };
  }
  // Sin salida libre: el tiro se frena seco en el impacto, que acaba de quedar vacío.
  return { dir: { ...ida }, hasta: { ...impacto } };
}

/** El casi: la canica que gana rueda hacia la tiza, la titila a `TITILA_R`, y su tramo no roza a ningún premio. */
function titilaDe(d: Pun, quieta: readonly Pun[], rng: () => number): { dir: Pun; titila: Pun } {
  const r = modulo(d);
  const base = Math.atan2(d.y, d.x) + (rng() - 0.5) * 0.4;
  const radial = unitario(d);
  let mejor: { dir: Pun; titila: Pun; holgura: number } | null = null;
  for (let i = 0; i < 32; i++) {
    const a = barrido(base, Math.PI / 32, i);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    if (dir.x * radial.x + dir.y * radial.y < 0.1) continue;
    const titila = mover(d, dir, Math.max(0.01, cruceDe(d, dir, TITILA_R) - r));
    const h = Math.min(...quieta.map((q) => distSeg(q, d, titila)), 9);
    if (!mejor || h > mejor.holgura) {
      mejor = { dir, titila, holgura: h };
      if (h >= HOLGURA) return { dir: mejor.dir, titila: mejor.titila };
    }
  }
  return { dir: radial, titila: mover(d, radial, Math.max(0.01, TITILA_R - r)) };
}

/** Mezcla en el lugar con el azar de la ronda (Fisher-Yates). */
function mezclar<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** La siembra: espiral sembrada de la ronda, con un aire que ninguna canica pisa. */
function siembra(m: number, rng: () => number): Pun[] {
  const DORADO = 2.39996;
  return Array.from({ length: m }, (_, j) => {
    const r = acotar(0.86 * Math.sqrt((j + 0.5) / m) + (rng() - 0.5) * 0.04, 0.2, CIRCULO_R - CANICA_R * 1.2);
    const a = j * DORADO + (rng() - 0.5) * 0.24;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

// ------------------------------------------------------------ la historia

export function planBolillas(ctx: Contexto): Plan<Datos> {
  const n = ctx.nombres.length;
  const ganador = ctx.ganadores[0] ?? 0;
  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  // El plan la pide acá, antes de gastar el azar en otra cosa: así el orden es siempre el mismo.
  const historia = ctx.historia(Math.max(2, n), ganador % Math.max(2, n));
  const ganadores = ctx.ganadores.filter((g) => g >= 0 && g < n).slice(0, Math.max(1, Math.min(ctx.ganadores.length, CANICAS_MAX)));
  const ganados = new Set(ganadores);

  /** La rival: un puesto que no gana; si la historia cayó en un premio, el que sigue con el azar de la ronda. */
  let rival = n > 1 ? historia.rival % n : -1;
  if (rival >= 0 && (ganados.has(rival) || rival === ganador)) {
    const otros = mezclar(
      Array.from({ length: n }, (_, i) => i).filter((i) => !ganados.has(i)),
      ctx.rng,
    );
    rival = (otros[0] ?? -1) as number;
  }

  // Los que juegan la troya: los premios, la rival y el resto con el azar de la ronda, hasta caber en el círculo.
  const juegan = new Set<number>(ganadores);
  if (rival >= 0) juegan.add(rival);
  if (n <= CANICAS_MAX) Array.from({ length: n }, (_, i) => i).forEach((i) => juegan.add(i));
  else {
    const otros = mezclar(
      Array.from({ length: n }, (_, i) => i).filter((i) => !juegan.has(i)),
      ctx.rng,
    );
    for (const i of otros) {
      if (juegan.size >= CANICAS_MAX) break;
      juegan.add(i);
    }
  }
  // Cada asiento del círculo lleva una canica de una persona, en orden mezclado: a quien gana no lo delata su lugar.
  const canicas = mezclar([...juegan].sort((a, b) => a - b), ctx.rng);
  const posiciones = siembra(canicas.length, ctx.rng);
  const asientoDe = (i: number): number => canicas.indexOf(i);

  // La tanda previa: los que sobran para el círculo cruzan en oleadas (qualifier.ts), como en el sapo.
  const oleadas: Oleada[] =
    n <= CANICAS_MAX
      ? []
      : (wavesAround(n, [...juegan].sort((a, b) => a - b), ctx.rng) as number[][]).map((gente, wi) => ({
          t: T_INTRO + wi * Q_WAVE,
          gente,
        }));

  // La troya: los que saca la pegadora, de a una por tiro, en el orden sembrado; la rival al final, el cierre con la
  // canica que gana titilando sobre la tiza. Los premios no son de la tanda: nunca salen.
  const enJuego = [...new Set(canicas.filter((i) => !ganados.has(i)))];
  const orden = mezclar(enJuego, ctx.rng);
  const j = orden.indexOf(rival);
  if (rival >= 0 && j >= 0 && j !== orden.length - 1) {
    const ultima = orden.pop() as number;
    orden[j] = ultima;
    orden.push(rival);
  }

  const tUltimaOleada = oleadas.length ? (oleadas.at(-1) as Oleada).t : T_INTRO - Q_WAVE;
  const tTroya = n <= CANICAS_MAX ? T_INTRO : tUltimaOleada + CIERRA_CLAS + ENTRA_CIRC;

  const tiros: Tiro[] = orden.map((quien, k) => {
    const slot = asientoDe(quien);
    const impacto = posiciones[slot] as Pun;
    const t = tTroya + PRIMER_TIRO + k * ENTRE_TIROS;
    // Quieta: cada canica que sigue adentro a partir de este tiro, la de la persona que gana incluida.
    const fueraHasta = new Set(orden.slice(0, k));
    const quieta = canicas
      .map((i, s) => ({ i, s }))
      .filter(({ i }) => !fueraHasta.has(i) && i !== quien)
      .map(({ s }) => posiciones[s] as Pun);
    const desde = largadaDe(impacto, quieta, ctx.rng);
    const sal = rumboSalida(impacto, quieta, ctx.rng);
    const fuerza = FUERZA_MIN + ctx.rng() * FUERZA_BANDA;
    const defo = deflexionDe(desde, impacto, quieta, ctx.rng);
    return {
      diana: quien,
      slot,
      t,
      desde,
      impacto,
      salida: { dir: sal.dir, tiza: sal.tiza, fuerza, vuelo: modulo(restar(sal.tiza, impacto)) / fuerza },
      deflexion: defo,
    };
  });

  // El casi del cierre: sobre la canica que gana, cuando ya solo quedan los premios adentro.
  const casi: Casi = (() => {
    const slot = asientoDe(ganador);
    const desde = posiciones[slot] as Pun;
    const premios = canicas.filter((i) => ganados.has(i) && i !== ganador).map((i) => posiciones[asientoDe(i)] as Pun);
    const r = titilaDe(desde, premios, ctx.rng);
    return { t: (tiros.at(-1)?.t ?? tTroya + PRIMER_TIRO - ENTRE_TIROS) + ANTES_CASI, ganador, slot, desde, dir: r.dir, titila: r.titila };
  })();
  const duracion = casi.t + GOLPE_EN;

  /* ------------------------------------------------------------- el show */

  // Lo que dice el relator: seis palabras o menos, ningún nombre (los nombres van junto a las canicas) y ningún número.
  const guion: LineaGuion[] = [
    { t: 0.3, texto: ctx.txt("intro"), calor: 0.15 },
    { t: 1.1, texto: ctx.txt("canicas"), calor: 0.25 },
  ];
  for (const o of oleadas) {
    guion.push({
      t: o.t,
      texto: ctx.txt("tanda"),
      calor: 0.3,
      prioridad: PRIORIDAD.importante,
      hecho: { tipo: "salio", quien: o.gente[0] },
      hacer: (k) => k.sonido.salida(),
    });
  }
  guion.push({ t: tTroya - 1.2, texto: ctx.txt("troya"), calor: 0.4, prioridad: PRIORIDAD.importante });
  tiros.forEach((t, k) => {
    guion.push({
      t: t.t,
      texto: ctx.txt("fuera"),
      calor: 0.4 + (0.45 * k) / Math.max(1, tiros.length - 1),
      prioridad: PRIORIDAD.importante,
      hecho: { tipo: "salio", quien: t.diana },
      hacer: (k2) => k2.sonido.salida(),
    });
  });
  guion.push({
    t: casi.t,
    texto: ctx.txt("casi"),
    calor: 0.8,
    prioridad: PRIORIDAD.importante,
    hecho: { tipo: "casi", quien: ganador },
    hacer: (k) => k.sonido.tono(14, "evento"),
  });
  guion.push({ t: duracion - 1.6, texto: ctx.txt("ultima"), calor: 0.95 });
  // La bulla del círculo, cada segundo y medio: la sala nunca espera cuatro segundos en silencio.
  for (let f = 0.9; f < duracion - 0.3; f += 1.5) guion.push({ t: f, hacer: (k) => k.sonido.tono(4 + (Math.floor(f / 1.5) % 2), "fondo") });
  guion.sort((a, b) => a.t - b.t);

  // El único contador, arriba a la izquierda (lo dibuja el kit): baja con las oleadas y con cada canica, y llega a 1.
  const salidas = [
    ...oleadas.flatMap((o) => o.gente.map(() => o.t)),
    ...tiros.map((t) => t.t),
  ];
  const marcador = marcadorPorSalidas(n, salidas, duracion);

  // Lo que pasó, para la prueba del niño: empezó, cruzó una oleada, entró la troya, salió una canica,
  // la última titila sobre la tiza y con el golpe gana.
  const eventos: { desde: number; tipo: TipoPaso; quien?: number }[] = [
    { desde: 0, tipo: "empezo" },
    ...oleadas.map((o) => ({ desde: o.t, tipo: "salio" as const, quien: o.gente[0] })),
    { desde: tTroya, tipo: "empezo" },
    ...tiros.map((t) => ({ desde: t.t, tipo: "salio" as const, quien: t.diana })),
    { desde: casi.t, tipo: "casi" as const, quien: ganador },
    { desde: duracion, tipo: "gano" as const, quien: ganador },
  ];
  eventos.sort((a, b) => a.desde - b.desde);

  const respuestas = (t: number): Respuestas => {
    const ult = eventos.filter((e) => e.desde <= t).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    return {
      adelante: { quienes: adentro({ n, oleadas, tiros }, t), lugar: "centro" },
      hacia: "centro",
      progreso: acotar(t / duracion, 0, 1),
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  const momentos: Momentos = {
    // Plano entero mientras cada uno se busca y se tachan las oleadas.
    presentacion: { hasta: T_INTRO, toma: planoEntero((k) => {
      const p = k.pantalla();
      return { x: 0, y: p.top, w: p.w, h: p.bottom - p.top };
    }) },
    // Desde que hay juego: el círculo de tiza entero a la vista, y de cerca el tramo del tiro en curso.
    tomas: [
      { desde: T_INTRO, toma: planoSobre((k) => [cajaDelCirculo(k.pantalla())], { margen: 30, zoomMax: 1.35 }) },
      {
        desde: tTroya,
        toma: planoSobre(
          (k, tt) => {
            const p = k.pantalla();
            // El tramo del tiro en curso: el impacto y la salida de la canica que se va.
            const tiro = tiros.find((x) => tt >= x.t - 0.6 && tt < x.t + ENTRE_TIROS * 0.6) ?? tiros.find((x) => tt < x.t);
            if (!tiro) return [cajaDelCirculo(p)];
            const cajas = [cajaDeCanica(p, tiro.impacto), cajaDeCanica(p, tiro.salida.tiza)];
            const x0 = Math.min(...cajas.map((c) => c.x));
            const y0 = Math.min(...cajas.map((c) => c.y));
            return [
              { x: x0, y: y0, w: Math.max(...cajas.map((c) => c.x + c.w)) - x0, h: Math.max(...cajas.map((c) => c.y + c.h)) - y0 },
            ];
          },
          { margen: 46, zoomMax: 1.5 },
        ),
      },
    ],
    // La tensión mira al círculo entero: la última canica titila sobre la tiza y la sala lo ve sin leer nada.
    tension: {
      desde: casi.t - 2.2,
      toma: planoSobre((k) => [cajaDelCirculo(k.pantalla())], { margen: 22, zoomMax: 1.6 }),
    },
    // La meta de este juego es el círculo: ninguna toma la suelta.
    meta: (k) => cajaDelCirculo(k.pantalla()),
    // Dónde está la canica que gana en la pantalla (en su titileo de la orilla): el foco se enciende ahí.
    foco: (k) => {
      const p = k.pantalla();
      const t = Number.isFinite(k.t) ? k.t : duracion;
      const c = trayectoriaDe({ posiciones, tiros, casi, duracion }, asientoDe(ganador), t).p;
      const m = mapeoDe(p);
      const s = aMundo(m, c);
      const z = Math.max(0.3, k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x);
      return { x: s.x, y: s.y, r: 40 * p.k * z };
    },
  };

  const datos: Datos = { n, ganador, ganadores, rival, canicas, posiciones, orden, oleadas, tTroya, tiros, casi, duracion };

  return {
    duracion,
    arco: historia.arc,
    sentido: "centro",
    marcador,
    respuestas,
    momentos,
    guion,
    marcas: { bolillas: `${n}/${canicas.length}` },
    datos,
  };
}

/* --------------------------------------------------- para las escenas */

/** En qué segundo sale del juego la persona `i`: su oleada, su tiro, o `null` si gana (se queda adentro). */
export function salidaDe(d: Pick<Datos, "oleadas" | "tiros">, i: number): number | null {
  for (const o of d.oleadas) if (o.gente.includes(i)) return o.t;
  for (const t of d.tiros) if (t.diana === i) return t.t;
  return null;
}

/** Quiénes siguen adentro en el segundo `t`, en el orden de la lista. */
export function adentro(d: Pick<Datos, "n" | "oleadas" | "tiros">, t: number): number[] {
  return Array.from({ length: d.n }, (_, i) => i).filter((i) => {
    const s = salidaDe(d, i);
    return s === null || t < s;
  });
}

/**
 * Los finalistas del segundo `t` (S15): los que siguen adentro cuando ya quedan tres o menos — los
 * nombres solo se muestran para ellos, con la ganadora incluida. Antes de ese momento, nadie: la
 * troya se juega sin fichas sobre el círculo.
 */
export function finalistasDe(d: Pick<Datos, "n" | "oleadas" | "tiros">, t: number): number[] {
  const dentro = adentro(d, t);
  return dentro.length <= 3 ? dentro : [];
}

/**
 * Quiénes llevan ficha de nombre en el segundo `t` (S18): durante la beat de la intro (`T_INTRO`, el
 * mismo tiempo que dura la presentación del kit), todas las canicas del círculo — así la sala ve quiénes
 * juegan apenas arranca—; a partir de ahí, solo los finalistas de S15 (`finalistasDe`), siempre cortado
 * a los que tienen canica en el círculo (los de la tanda previa no llevan ficha sobre la troya).
 * Pura: misma hora, mismos nombres, en la 2D y en la 3D (que consume el mismo chip del 2D).
 */
export function fichasDe(d: Pick<Datos, "canicas" | "n" | "oleadas" | "tiros">, t: number): number[] {
  if (t < T_INTRO) return [...d.canicas];
  return finalistasDe(d, t).filter((i) => d.canicas.includes(i));
}

export type EstadoCanica = "dentro" | "vuela" | "afuera" | "titila";

/** Dónde está la canica de un asiento en el segundo `t`, y qué le pasa: para la 2D y la 3D por igual. */
export function trayectoriaDe(
  d: Pick<Datos, "posiciones" | "tiros" | "casi" | "duracion">,
  slot: number,
  t: number,
): { p: Pun; estado: EstadoCanica } {
  const pos = d.posiciones[slot] ?? { x: 0, y: 0 };
  const tiro = d.tiros.find((x) => x.slot === slot);
  if (tiro) {
    if (t < tiro.t) return { p: pos, estado: "dentro" };
    const f = tiro.salida.vuelo > 1e-9 ? Math.min(1, (t - tiro.t) / tiro.salida.vuelo) : 1;
    const largo = modulo(restar(tiro.salida.tiza, tiro.impacto));
    return { p: mover(tiro.impacto, tiro.salida.dir, f * largo), estado: f >= 1 ? "afuera" : "vuela" };
  }
  if (d.casi.slot === slot && t >= d.casi.t) {
    const f = acotar((t - d.casi.t) / 2, 0, 1);
    const suave = f * f * (3 - 2 * f);
    return { p: { x: d.casi.desde.x + (d.casi.titila.x - d.casi.desde.x) * suave, y: d.casi.desde.y + (d.casi.titila.y - d.casi.desde.y) * suave }, estado: "titila" };
  }
  return { p: pos, estado: "dentro" };
}
