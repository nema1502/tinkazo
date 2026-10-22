import { writeStory, type Arc, type Story } from "../drama";
import { COLORES, GRUPOS, cuantosGrupos, grupoDe } from "../grupos";

/**
 * El plan de La Entrada (puro: sin Pixi ni DOM). Sección 7.8 del plan de
 * juegos: el Carnaval de Oruro, contado por fraternidades.
 *
 * Cada grupo automático de la lista (`grupos.ts`, el mismo reparto del
 * teleférico: las Parabas son Parabas en los dos juegos) es una fraternidad,
 * con el color de su grupo y un baile de la entrada. El desfile tiene cinco
 * partes:
 *
 * 1. **La presentación.** Las fraternidades pasan de a una frente al palco, en
 *    el orden del desfile, y mientras pasa cada una se leen los nombres de
 *    todos sus integrantes. Así se ven todos al principio.
 * 2. **Las cuadras.** En cada arco se queda una fraternidad entera, que terminó
 *    su recorrido y saluda desde la vereda.
 * 3. **La última fraternidad.** Adentro de ella se quedan de a varios, en sus
 *    propios arcos, hasta que quedan dos.
 * 4. **El contrapunto.** Los dos saltan alternados frente al Socavón, y en
 *    cualquier salto cualquiera de los dos puede trastabillar. El último salto
 *    de uno de ellos termina en el piso.
 * 5. **La llegada,** con campanas y cohetillos.
 *
 * Es presentación: el ganador viene del número público antes de que arranque
 * esto. El azar que se consume acá sale de la semilla de la ronda y no cambia
 * el resultado, y nada de lo que se ve depende de quién gana más que por azar:
 * el lugar de su fraternidad en el desfile, su lugar adentro de ella, de qué
 * lado salta y quién salta primero se sortean parejo (sección 7.8, "que no se
 * aprenda").
 */

export type Dance = "diablada" | "morenada" | "caporales" | "tinkus" | "llamerada";
/** Los cinco bailes de la entrada que se dibujan, los cinco que nombra la auditoría. */
export const DANCES: readonly Dance[] = ["diablada", "morenada", "caporales", "tinkus", "llamerada"];

export interface Frat {
  /** El grupo, de 0 a F-1: su nombre en `GRUPOS` y su color en `COLORES`. */
  g: number;
  name: string;
  article: string;
  /** El color del grupo, en número (0xRRGGBB). */
  color: number;
  dance: Dance;
  /** Sus integrantes, en el orden de su formación: el primero va adelante, a la derecha. */
  members: number[];
}

/** Lo que pasa en un arco: se queda una fraternidad entera, o algunos de la última. */
export interface Exit {
  kind: "frat" | "members";
  /** La fraternidad de los que se quedan. */
  g: number;
  ids: number[];
  /** Cuántos de los que se quedan tienen premio: se dice el número, nunca el nombre. */
  prizes: number;
}

export interface Arch {
  /** El número de la cuadra, de 1 a A. */
  k: number;
  /** Cuándo llega la cabeza de la comparsa al arco, en segundos de juego. */
  t: number;
  /** Cuándo salen a la vereda los que se quedan. */
  tExit: number;
  exit: Exit;
}

/** Cómo cae un salto del contrapunto. */
export type Stumble = "none" | "small" | "big" | "fall";

export interface Jump {
  t: number;
  /** Quién salta: un índice de la lista. */
  who: number;
  stumble: Stumble;
  /** El salto final del que gana, el que lo deja en la puerta del Socavón. */
  final: boolean;
}

/** Los giros de cada arco del director de emoción. Siempre pasa algo, nunca lo mismo. */
export interface Twists {
  /**
   * Remontada: en un arco, una fraternidad (o uno de la última) arranca para la
   * vereda como si se quedara, y vuelve a la comparsa. Se sortea entre los que
   * siguen, así que no dice nada de quién gana.
   */
  fake: { arch: number; t0: number; t1: number; g: number; ids: number[] } | null;
  /** Tapada: la banda se calla de golpe, la comparsa se congela y la sala con ella. */
  freeze: { t0: number; t1: number } | null;
  /** Susto: casi se le cae la máscara (o el sombrero) a alguien, sorteado entre los que bailan. */
  scare: { t: number; who: number } | null;
}

export interface EntradaPlan {
  n: number;
  winner: number;
  /** El otro del contrapunto: -1 con una sola persona. */
  rival: number;
  winners: readonly number[];
  story: Story;
  arc: Arc;
  /** Las fraternidades, por número de grupo. */
  frats: Frat[];
  /** El orden del desfile: números de grupo, la cabeza primero. */
  order: number[];
  /** La fraternidad del ganador. */
  winG: number;
  /** La presentación: cuándo pasa cada fraternidad frente al palco, en el orden del desfile. */
  pres: { g: number; t0: number; t1: number }[];
  T_INTRO: number;
  /** Termina la presentación y la comparsa arranca hacia el primer arco. */
  T_GO: number;
  arches: Arch[];
  /** Cuántas de las cuadras son de fraternidades enteras; las otras son de la última. */
  fratArches: number;
  /** Llega al Socavón: empieza el contrapunto. */
  T_SOCAVON: number;
  /** De qué lado del contrapunto queda el que gana: -1 a la izquierda, 1 a la derecha. */
  side: -1 | 1;
  jumps: Jump[];
  /** El salto final: el que gana llega a la puerta. */
  T_ARRIVE: number;
  T_CROWN: number;
  twists: Twists;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Cuánto dura cada parte, en segundos de juego. */
export const T_INTRO = 0.7;
/** Después de la presentación, hasta el primer arco: la cámara se abre a la comparsa entera. */
export const WALK_FIRST = 0.9;
/** Entre que la cabeza llega al arco y los que se quedan salen a la vereda. */
export const EXIT_DELAY = 0.25;
/** Del último arco al Socavón. */
export const WALK_SOCAVON = 2.2;
/** Después de la última fraternidad entera, un respiro: "¡solo quedan los Tojos!". */
export const ONLY_TIME = 0.9;
/** Lo que se lleva el amague de la remontada y el silencio de la banda en la tapada. */
export const FAKE_TIME = 1.0;
export const FREEZE_TIME = 1.2;

/** Cuánto pasa cada fraternidad frente al palco: menos con más fraternidades, nunca menos de 0,92 s. */
export function presentationTime(F: number): number {
  return F <= 1 ? 2.6 : clamp(8.6 / F, 0.92, 2.2);
}

/**
 * Cuántos se quedan en cada arco de la última fraternidad, que tiene `s`
 * integrantes contando a los dos del contrapunto: hasta tres arcos, cada uno
 * dejando más o menos la mitad, y en el último quedan dos. Con 20 son 10, 5 y 3.
 */
export function memberRounds(s: number): number[] {
  const remove = s - 2;
  if (remove <= 0) return [];
  const rounds = remove <= 2 ? remove : remove <= 6 ? 2 : 3;
  const out: number[] = [];
  let cur = s;
  for (let r = 0; r < rounds; r++) {
    const target = r === rounds - 1 ? 2 : Math.max(2 + (rounds - 1 - r), Math.ceil(cur / 2));
    out.push(cur - target);
    cur = target;
  }
  return out;
}

const hexColor = (css: string): number => parseInt(css.replace("#", ""), 16) || 0xd52b1e;

/**
 * Escribe el plan. `rng` es el azar sembrado con la ronda; la misma ronda
 * escribe el mismo plan.
 */
export function planEntrada(n: number, winners: readonly number[], rng: () => number): EntradaPlan {
  const winner = Math.min(Math.max(0, winners[0] ?? 0), Math.max(0, n - 1));
  const prizeSet = new Set(winners.slice(1));
  const story = writeStory(rng, Math.max(2, n), winner % Math.max(2, n));

  /* ------------------------------------------------------- fraternidades */
  const F = Math.max(1, cuantosGrupos(n));
  const dances = shuffled(DANCES, rng);
  const frats: Frat[] = Array.from({ length: F }, (_, g) => {
    const grupo = GRUPOS[g] ?? GRUPOS[0] as (typeof GRUPOS)[number];
    return { g, name: grupo.nombre, article: grupo.articulo, color: hexColor(COLORES[g] ?? "#d52b1e"), dance: dances[g % dances.length] as Dance, members: [] };
  });
  for (let i = 0; i < n; i++) frats[grupoDe(i, n)]?.members.push(i);
  // La formación de cada una, sorteada: el que gana puede ir adelante, atrás o en el medio.
  for (const f of frats) f.members = shuffled(f.members, rng);
  const winG = n > 0 ? grupoDe(winner, n) : 0;
  // El orden del desfile, sorteado parejo: la fraternidad del que gana puede ir a la cabeza.
  const order = shuffled(Array.from({ length: F }, (_, g) => g), rng);

  /* ------------------------------------------------------ quién se queda */
  // Las fraternidades que se quedan, en el orden de los arcos: todas menos la del que gana.
  const stayOrder = shuffled(order.filter((g) => g !== winG), rng);
  const winFrat = frats[winG] as Frat;
  // El otro del contrapunto: de la misma fraternidad, y sin premio si se puede
  // (un co-ganador que pierde el contrapunto sería un ganador narrado como perdedor).
  const pool = winFrat.members.filter((i) => i !== winner);
  const sinPremio = pool.filter((i) => !prizeSet.has(i));
  const rivalPool = sinPremio.length ? sinPremio : pool;
  const rival = rivalPool.length ? (rivalPool[Math.floor(rng() * rivalPool.length)] as number) : -1;
  // Los demás de la última fraternidad se quedan de a varios: primero los sin
  // premio, sorteados, y al final los premiados, del último premio al segundo.
  const resto = winFrat.members.filter((i) => i !== winner && i !== rival);
  const premiados = winners.filter((w) => resto.includes(w)).reverse();
  const leaveOrder = [...shuffled(resto.filter((i) => !prizeSet.has(i)), rng), ...premiados];
  const rounds = memberRounds(winFrat.members.length);
  const memberExits: Exit[] = [];
  {
    let at = 0;
    for (const size of rounds) {
      const ids = leaveOrder.slice(at, at + size);
      at += size;
      memberExits.push({ kind: "members", g: winG, ids, prizes: ids.filter((i) => prizeSet.has(i)).length });
    }
  }
  const exits: Exit[] = [
    ...stayOrder.map((g): Exit => {
      const ids = frats[g]?.members ?? [];
      return { kind: "frat", g, ids, prizes: ids.filter((i) => prizeSet.has(i)).length };
    }),
    ...memberExits,
  ];
  const A = exits.length;
  const fratArches = stayOrder.length;

  /* --------------------------------------------------------------- giros */
  const arc = story.arc;
  // Dónde cae cada giro, antes de los tiempos: el amague y el silencio alargan su arco.
  let fakeArch = -1, fakeG = -1, fakeIds: number[] = [];
  if (arc === "remontada" && A > 0) {
    if (fratArches > 0) {
      fakeArch = Math.floor(rng() * fratArches);
      // Entre las que siguen después de ese arco, también la del que gana.
      const gone = new Set(stayOrder.slice(0, fakeArch + 1));
      const siguen = order.filter((g) => !gone.has(g));
      fakeG = siguen[Math.floor(rng() * siguen.length)] as number;
      fakeIds = frats[fakeG]?.members ?? [];
    } else {
      fakeArch = Math.floor(rng() * A);
      const gone = new Set(exits.slice(0, fakeArch + 1).flatMap((e) => e.ids));
      const siguen = winFrat.members.filter((i) => !gone.has(i));
      fakeG = winG;
      fakeIds = siguen.length ? [siguen[Math.floor(rng() * siguen.length)] as number] : [];
    }
  }
  const freezeArch = arc === "tapada" && A > 0 ? Math.floor(rng() * A) : -1;

  /* -------------------------------------------------------------- tiempos */
  const per = presentationTime(F);
  const pres = order.map((g, i) => ({ g, t0: T_INTRO + i * per, t1: T_INTRO + (i + 1) * per }));
  const T_GO = T_INTRO + F * per;
  const iF = clamp(16 / Math.max(1, A), 1.45, 2.3);
  const iM = iF + 0.15;
  const arches: Arch[] = [];
  let fake: Twists["fake"] = null;
  let freeze: Twists["freeze"] = null;
  let t = T_GO + WALK_FIRST;
  for (let j = 0; j < A; j++) {
    const exit = exits[j] as Exit;
    let delay = EXIT_DELAY;
    if (j === freezeArch) {
      freeze = { t0: t + 0.15, t1: t + 0.15 + FREEZE_TIME };
      delay += FREEZE_TIME + 0.1;
    }
    if (j === fakeArch && fakeIds.length) {
      fake = { arch: j, t0: t + delay, t1: t + delay + FAKE_TIME * 0.85, g: fakeG, ids: fakeIds };
      delay += FAKE_TIME;
    }
    arches.push({ k: j + 1, t, tExit: t + delay, exit });
    t += (exit.kind === "frat" ? iF : iM) + (delay - EXIT_DELAY) + (j === fratArches - 1 && A > fratArches ? ONLY_TIME : 0);
  }
  let T_SOCAVON = (A > 0 ? (arches[A - 1] as Arch).tExit : T_GO) + WALK_SOCAVON;
  if (arc === "tapada" && A === 0) {
    // Sin arcos, la banda se calla en el camino al Socavón.
    freeze = { t0: T_GO + 0.8, t1: T_GO + 0.8 + FREEZE_TIME };
    T_SOCAVON += FREEZE_TIME;
  }

  /* --------------------------------------------------------- el susto */
  let scare: Twists["scare"] = null;
  if (arc === "susto" && rounds.length > 0) {
    // Antes del último arco de la última fraternidad: casi se le cae la máscara
    // a uno de los que siguen bailando, sorteado entre todos ellos.
    const ultimo = arches[A - 1] as Arch;
    const previo = A >= 2 ? (arches[A - 2] as Arch).tExit : T_GO;
    const gone = new Set(exits.slice(0, A - 1).flatMap((e) => e.ids));
    const bailan = winFrat.members.filter((i) => !gone.has(i));
    if (bailan.length >= 3) scare = { t: (previo + ultimo.t) / 2 + 0.2, who: bailan[Math.floor(rng() * bailan.length)] as number };
  }

  /* ---------------------------------------------------------- contrapunto */
  const side: -1 | 1 = rng() < 0.5 ? -1 : 1;
  const jumps: Jump[] = [];
  let T_ARRIVE = T_SOCAVON + 0.8;
  if (rival >= 0) {
    const first = rng() < 0.5 ? winner : rival;
    const other = first === winner ? rival : winner;
    const jumper = (i: number): number => (i % 2 === 0 ? first : other);
    // El salto decisivo es del que pierde; antes, una cantidad que depende de
    // quién arranca, así quien salta primero no dice nada.
    let J = 5 + (arc === "duelo" ? 2 : 0) + (n <= 3 ? 2 : 0);
    if (jumper(J) !== rival) J++;
    let tj = T_SOCAVON + 0.6;
    const times: number[] = [];
    for (let i = 0; i <= J + 1; i++) {
      times.push(tj);
      tj += i === J ? 0.8 : Math.max(0.36, 0.74 * Math.pow(0.9, i));
    }
    // Trastabillar no delata a nadie: le pasa a cualquiera de los dos, parejo.
    const stumbles: Stumble[] = Array.from({ length: J + 1 }, (_, i) => (i >= 1 && i < J && rng() < 0.3 ? "small" : "none"));
    stumbles[J] = "fall";
    // Sin arcos en la última fraternidad, el susto y el amague de la remontada
    // pasan acá: uno de los dos, sorteado, casi se cae y aguanta.
    if ((arc === "susto" && !scare) || (arc === "remontada" && !fake)) {
      const i = rng() < 0.5 ? J - 1 : J - 2;
      if (i >= 1) {
        stumbles[i] = "big";
        if (arc === "susto") scare = { t: times[i] as number, who: jumper(i) };
      }
    }
    for (let i = 0; i <= J; i++) jumps.push({ t: times[i] as number, who: jumper(i), stumble: stumbles[i] as Stumble, final: false });
    T_ARRIVE = times[J + 1] as number;
    jumps.push({ t: T_ARRIVE, who: winner, stumble: "none", final: true });
  }
  const T_CROWN = T_ARRIVE + 1.0;

  return {
    n, winner, rival, winners, story, arc, frats, order, winG, pres, T_INTRO, T_GO, arches, fratArches,
    T_SOCAVON, side, jumps, T_ARRIVE, T_CROWN, twists: { fake, freeze, scare },
  };
}
