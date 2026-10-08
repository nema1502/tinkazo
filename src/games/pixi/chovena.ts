import { Container, Graphics, type Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { CHO_BPM, musicHold, musicTempo } from "../../music";
import { avatarColor } from "../../avatar";
import { enOrden, writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, shorten, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Chovena.
 *
 * La chovena es el baile chiquitano de Santa Cruz: en dos por cuatro, con
 * flauta de caña, caja y bombo, y la gente tomada de la mano en ruedas y
 * filas. El juego es esa rueda, en una plaza de tierra colorada. Arranca como
 * la coreografía, con las mujeres en una fila y los hombres en otra, que se
 * toman de la mano y forman el círculo. La rueda gira al ritmo, para un lado y
 * después del corte para el otro, y cuando el conjunto corta la música todos
 * se quedan quietos sin soltarse. El que estaba a mitad de un paso trastabilla,
 * se suelta y se va a sentar al borde de la plaza, y la rueda se vuelve a
 * cerrar con los que quedan. Gana el último que queda bailando.
 *
 * Es el único juego donde la sala se mueve al ritmo: aplaude con la música y
 * se congela con el corte (auditoría de los juegos, sección 7.4). Por eso el
 * corte se ve aunque no se oiga: el cajero levanta los palillos, el aviso de
 * arriba se pone rojo y la pantalla dice "¡QUIETOS!". Que la música se corte
 * es del juego, no de la tradición.
 *
 * Quién sale en cada corte no depende de dónde baila: el orden está sembrado
 * con la ronda y la ganadora va última. Los arcos del director:
 *
 * - **susto**: en el último corte la ganadora trastabilla y aguanta.
 * - **remontada**: en el corte falso se había soltado, y vuelve a la rueda.
 * - **duelo**: la final trae un amague, un corte que no saca a nadie.
 * - **tapada**: nadie la nombra hasta el final.
 *
 * Y en los cortes de los demás arcos, a veces trastabilla alguien que no sale:
 * tambalearse no delata a nadie. Con varios premios, los premiados salen
 * últimos y "con premio", y la última que queda se lleva el primero.
 *
 * Los bailarines pisan en el tiempo de la música: el paso sale del mismo
 * número de golpes por minuto que usa `src/music.ts`, contado en el tiempo
 * del juego, así que la misma ronda dibuja los mismos cuadros aunque la
 * música no suene. Cómo van vestidos y cómo es la plaza, con sus fuentes, está
 * en docs/juegos/chovena.md.
 */

/** La presentación: las dos filas, la rueda que se arma y la lista. */
const T_INTRO = 2.6;
/** Cuándo empiezan a tomarse de la mano, y lo que tardan en formar la rueda. */
const T_JOIN = 1.25;
const JOIN = 0.95;
/** Lo que tardan en quedarse quietos cuando se corta la música. */
const FREEZE = 0.22;
/** El tambaleo de los que no alcanzaron a frenar el paso. */
const WOBBLE = 0.62;
/** Lo que tardan en soltarse y salir. */
const EXIT = 0.65;
/** El corte falso: la música se calla y vuelve. */
const FAKE = 0.72;
/** La rueda que se cierra con los que quedan. */
const CLOSE = 0.6;
/** La vuelta de la rueda, en radianes por segundo de juego. */
const SPIN = 0.42;
/** La final: entran los dos, bailan más rápido, y el último corte. */
const FINAL_IN = 0.9;
const FINAL_DANCE = 2.3;
const FINAL_WOBBLE = 0.95;
const FINAL_EXIT = 0.6;
const FINAL_TEMPO = 1.14;
/** El amague de la final. */
const FINAL_FAKE = 0.75;
/** Cuánto dura cada tanda de nombres mientras se baila. */
const TANDA = 1.7;

/** El tipoy y la ropa de los hombres son blancos: el color de cada uno va en las cintas. */
const WHITE = 0xfbf8f1;
const STRAW = 0xe2c27c;
const SKINS = [0xc68a5c, 0xa86f45, 0xd9a273, 0x8f5a36];
const HAIRS = [0x2b1d14, 0x3d2817, 0x151515, 0x4a2f1c];
const FLOWERS = [0xff5fa2, 0xff7a1a, 0xffffff, 0xe93d9c];
const FLAGS = [0xe93d9c, YELLOW, 0x00a896, 0xff7a1a, 0x4361ee, 0xffffff];

/**
 * Quién va de tipoy y quién de camisa y sombrero sale del nombre, no del
 * lugar en la rueda: con la ropa repartida por puesto, "Carlos" bailaba de
 * tipoy y "Elena" de sombrero, y en ropa indígena tradicional eso se lee como
 * burla (lo encontró el agente evaluador, 5 de octubre de 2026). Una lista de
 * nombres comunes y la terminación; los que no se pueden clasificar completan
 * la rueda para que siga alternada. Es solo dibujo: no toca quién gana.
 */
const MUJERES = new Set(("maria ana lucia elena sofia valeria camila paola daniela carmen rosa juana patricia laura andrea " +
  "gabriela carla fernanda isabel veronica claudia monica silvia sandra natalia alejandra adriana beatriz lorena cecilia " +
  "teresa martha marta julia raquel ruth rut noemi miriam lourdes ines pilar rocio consuelo amparo mercedes dolores " +
  "soledad luz gladys nelly jazmin abigail ximena jimena mariela marisol yesenia wendy evelyn ingrid karen kelly nicole " +
  "michelle stephanie estefania milagros belen carolina catalina florencia agustina antonella valentina martina renata " +
  "emilia isabella guadalupe maribel noelia roxana tatiana vanessa viviana zulema esther edith judith elizabeth " +
  "lizeth jhoselin yovana susana silvana tania rosario margarita cristina angela erika diana fabiola liliana yolanda " +
  "cielo socorro charo").split(" "));
const HOMBRES = new Set(("jorge carlos diego pablo rodrigo miguel andres franco oscar juan jose luis pedro mario fernando " +
  "ricardo roberto sergio javier alejandro daniel david eduardo gustavo hugo ivan jaime julio marco marcos mauricio nicolas " +
  "raul rene victor wilson freddy jhonny edwin edgar alvaro boris cristian christian gonzalo gerardo hector ignacio " +
  "joaquin kevin leonardo manuel martin matias orlando rafael ramiro ruben samuel santiago sebastian tomas vladimir " +
  "walter william willy adrian antonio armando arturo benjamin bruno cesar emilio enrique esteban felipe francisco gabriel " +
  "guillermo jesus jonathan josue marcelo mateo omar patricio rolando teodoro vicente elias isaac moises noel alex " +
  "alexander angel dario efrain eloy ernesto fabian fidel grover henry jhon johnny lucas luca nestor ronald rudy simon " +
  "yerko limbert nelson wilfredo alfredo alberto").split(" "));
const generoDe = (nombre: string): "f" | "m" | null => {
  const primero = (nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/)[0] ?? "").replace(/[^a-z]/g, "");
  if (MUJERES.has(primero)) return "f";
  if (HOMBRES.has(primero)) return "m";
  if (primero.length > 2 && primero.endsWith("a")) return "f";
  if (primero.length > 2 && primero.endsWith("o")) return "m";
  return null;
};

type Kind = "stop" | "fake";

/** Un corte de la música. */
interface Ev {
  kind: Kind;
  /** Empieza el baile, se corta la música, empiezan a tambalearse, se sueltan, vuelve la música. */
  d0: number; s0: number; w0: number; x0: number; s1: number;
  victims: number[];
  /** En un corte, los que se tambalean y aguantan; en el falso, los que se soltaron antes de tiempo. */
  holders: number[];
}

/** Un tramo con música: la rueda gira y se baila en el tiempo. `spin` lleva el sentido. */
interface Seg { a: number; b: number; spin: number; tempo: number; reset: boolean; p0: number; s0: number }

/** Dónde baila cada uno mientras la rueda tiene a los mismos. */
interface Slot { rho: number; base: number; dir: number }
interface Epoch { at: number; members: number[]; rings: number[][]; slot: Map<number, Slot>; rhoOut: number; gap: number }

interface Polar { rho: number; th: number }
interface Pt { x: number; y: number }

interface Dancer {
  idx: number;
  tipoy: boolean;
  /** Su color: el de su cara en los chips, para que la cinta y el nombre coincidan. */
  col: number;
  /** Cuándo se soltó, o -1. */
  outAt: number;
  from: Polar;
  seat: Polar;
  /** Sale hacia la sala (adelante) en vez de sentarse al borde de la plaza. */
  away: boolean;
  /** Su lugar en las filas del arranque, en la plaza (u a lo ancho, v a lo hondo). */
  row: { u: number; v: number };
  view?: View;
  chip?: Container;
}

interface View {
  root: Container; body: Container; head: Container;
  armL: Container; armR: Container; legL: Graphics; legR: Graphics; lap: Graphics;
  face: Graphics; back: Graphics; buttons: Graphics; alert: Graphics;
}

interface Band { root: Container; flute: Graphics; sticks: Graphics; mallet: Container; drum: Graphics; bodies: Container[] }

export async function chovenaPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn(), { music: "chovena" });
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  // Sin el desenfoque de los acercamientos: la cámara se acerca a la pareja
  // final y a la ganadora, y ahí los nombres tienen que verse nítidos.
  cam.noBlur();
  const n = names.length;
  const winnerIdx = clamp(winners[0] ?? 0, 0, Math.max(0, n - 1));
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  S.mark("arco", story.arc);
  const pocos = n <= 3;

  /* ------------------------------------------------------------------ plan */
  // Los otros premiados, en el orden de los premios.
  const co = winners.slice(1).filter((w, i, a) => w !== winnerIdx && w >= 0 && w < n && a.indexOf(w) === i);
  const prized = new Set<number>([winnerIdx, ...co]);
  // La rival de la final: la segunda premiada, o la que elige el director.
  let rivalIdx = -1;
  if (n >= 2) rivalIdx = co[0] ?? (story.rival % n === winnerIdx ? (winnerIdx + 1) % n : story.rival % n);
  const shuffle = (xs: number[]): number[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j] as number, xs[i] as number];
    }
    return xs;
  };
  // Salen primero los que no ganan nada, sembrados; después los premiados, del
  // último premio al segundo. La rival sale en la final.
  const losers = shuffle(names.map((_, i) => i).filter((i) => !prized.has(i) && i !== rivalIdx));
  const regular = [...losers, ...co.slice(1).reverse()];
  const R0 = n <= 2 ? 0 : n === 3 ? 1 : n <= 12 ? 2 : n <= 40 ? 3 : n <= 90 ? 4 : 5;
  const R = Math.min(R0, regular.length);
  // El reparto: más al principio, y al menos uno por corte.
  const shares = Array.from({ length: R }, (_, c) => Math.pow(R - c, 1.4));
  const stops: number[][] = [];
  let given = 0;
  for (let c = 0; c < R; c++) {
    const left = regular.length - given;
    const rest = shares.slice(c).reduce((a, b) => a + b, 0);
    let want = c === R - 1 ? left : Math.round(((shares[c] ?? 0) / rest) * left);
    want = clamp(want, 1, left - (R - 1 - c));
    stops.push(regular.slice(given, given + want));
    given += want;
  }
  // El corte falso: nunca antes del primero de verdad, para que la sala ya
  // sepa que el corte saca gente. En el duelo, no justo antes de la final,
  // que ya trae su amague. Con dos o tres hay uno más, al principio: si no,
  // pasaban doce segundos sin que pasara nada.
  const plan: { kind: Kind; victims: number[] }[] = stops.map((v) => ({ kind: "stop", victims: v }));
  {
    const lo = R >= 1 ? 1 : 0;
    const hi = story.arc === "duelo" && R >= 2 ? plan.length - 1 : plan.length;
    const at = lo + Math.floor(rng() * Math.max(1, hi - lo + 1));
    plan.splice(Math.min(at, plan.length), 0, { kind: "fake", victims: [] });
    if (pocos) plan.unshift({ kind: "fake", victims: [] });
  }
  const lastStop = plan.map((p) => p.kind).lastIndexOf("stop");
  const sustoInStop = story.arc === "susto" && lastStop >= 0;

  // La línea de tiempo.
  const alive = new Set(names.map((_, i) => i));
  const evs: Ev[] = [];
  let tt = T_INTRO;
  let remontadaUsada = false;
  plan.forEach((p, c) => {
    let dance = clamp(2.55 - 0.14 * c, 1.75, 2.55) + (rng() - 0.5) * 0.7;
    if (c === 0) dance += pocos ? -0.4 : 0.35;
    const d0 = tt, s0 = d0 + dance, w0 = s0 + FREEZE;
    const pool = [...alive].filter((i) => i !== winnerIdx && !p.victims.includes(i));
    if (p.kind === "fake") {
      // Los que se soltaron antes de tiempo y vuelven. En la remontada, la ganadora (una vez).
      const holders: number[] = [];
      if (story.arc === "remontada" && !remontadaUsada && c > 0) {
        holders.push(winnerIdx);
        remontadaUsada = true;
      }
      for (const i of shuffle(pool.slice()).slice(0, Math.min(pool.length, n >= 12 ? 2 : 1))) holders.push(i);
      const x0 = s0 + FAKE;
      evs.push({ kind: "fake", d0, s0, w0, x0, s1: x0, victims: [], holders });
      tt = x0;
      return;
    }
    let holders: number[] = [];
    let hold = 0;
    if (sustoInStop && c === lastStop) {
      holders = [winnerIdx];
      hold = 0.6;
    } else if (pool.length && rng() < 0.55) {
      holders = [pool[Math.floor(rng() * pool.length)] as number];
    }
    const x0 = w0 + WOBBLE + hold;
    const s1 = x0 + EXIT;
    evs.push({ kind: "stop", d0, s0, w0, x0, s1, victims: p.victims, holders });
    for (const v of p.victims) alive.delete(v);
    tt = s1;
  });
  const fakeFinal = n >= 2 && (story.arc === "duelo" || pocos);
  const F0 = tt;
  const FD0 = F0 + FINAL_IN;
  const FK0 = fakeFinal ? FD0 + 1.1 : -1;
  const FK1 = fakeFinal ? FK0 + FINAL_FAKE : -1;
  const FS0 = FD0 + FINAL_DANCE + (fakeFinal ? FINAL_FAKE + 0.5 : 0);
  const FW0 = FS0 + FREEZE + 0.05;
  const FX0 = FW0 + FINAL_WOBBLE + (story.arc === "susto" && !sustoInStop ? 0.35 : 0);
  const T_CROWN = n >= 2 ? FX0 + FINAL_EXIT : FD0 + 1.6;
  setGameLength(T_CROWN, WINNER_HOLD);
  const pace = paceFactor();
  /** Golpes de la música por segundo de juego, al tempo de siempre. */
  const BPS = (CHO_BPM / 60) * pace;

  // Los tramos con música, para la vuelta de la rueda y el paso de cada uno.
  // Después de cada corte la rueda gira para el otro lado, como en la
  // coreografía: primero de izquierda a derecha y después al revés.
  const segs: Seg[] = [];
  const pushSeg = (a: number, b: number, spin: number, tempo: number, reset: boolean): void => {
    if (b <= a) return;
    const prev = segs[segs.length - 1];
    const p0 = reset || !prev ? 0 : prev.p0 + (prev.b - prev.a) * BPS * prev.tempo;
    const s0 = prev ? prev.s0 + (prev.b - prev.a) * prev.spin : 0;
    segs.push({ a, b, spin, tempo, reset, p0, s0 });
  };
  {
    let a = 0;
    let reset = false;
    let sign = 1;
    for (const e of evs) {
      if (a < T_INTRO) {
        pushSeg(a, Math.min(T_INTRO, e.s0), SPIN * 0.45 * sign, 1, reset);
        pushSeg(T_INTRO, e.s0, SPIN * sign, 1, false);
      } else pushSeg(a, e.s0, SPIN * sign, 1, reset);
      a = e.kind === "fake" ? e.x0 : e.s1;
      reset = true;
      sign = -sign;
    }
    if (a < T_INTRO) {
      pushSeg(a, T_INTRO, SPIN * 0.45 * sign, 1, reset);
      reset = false;
      a = T_INTRO;
    }
    pushSeg(a, FD0, SPIN * sign, 1, reset);
    if (fakeFinal) {
      pushSeg(FD0, FK0, SPIN * 1.35 * sign, FINAL_TEMPO, false);
      pushSeg(FK1, FS0, -SPIN * 1.35 * sign, FINAL_TEMPO, true);
    } else pushSeg(FD0, FS0, SPIN * 1.35 * sign, FINAL_TEMPO, false);
  }
  const segAt = (x: number): Seg | null => {
    let g: Seg | null = null;
    for (const s of segs) {
      if (s.a > x) break;
      g = s;
    }
    return g;
  };
  /** Cuánto giró la rueda hasta `x`. */
  const spinAt = (x: number): number => {
    const g = segAt(x);
    return g ? g.s0 + (Math.min(x, g.b) - g.a) * g.spin : 0;
  };
  /** El paso, en golpes: quieto entre tramos, a mitad del paso en que se cortó. */
  const beatAt = (x: number): number => {
    const g = segAt(x);
    return g ? g.p0 + (Math.min(x, g.b) - g.a) * BPS * g.tempo : 0;
  };
  const dancingAt = (x: number): boolean => {
    const g = segAt(x);
    return !!g && x < g.b;
  };
  /**
   * Los golpes bailados desde el principio, sin volver a cero después de cada
   * corte: para lo que no puede saltar de lugar cuando vuelve la música.
   */
  const beatsDanced = (x: number): number => {
    let b = 0;
    for (const s of segs) {
      if (s.a > x) break;
      b += (Math.min(x, s.b) - s.a) * BPS * s.tempo;
    }
    return b;
  };
  /** Para que la hamaca de la final vaya al compás de la música en la última vuelta. */
  const swayOff = beatAt(FD0) - beatsDanced(FD0);

  // La ropa, del nombre; y la rueda alternada, en un orden sembrado.
  const genero = names.map(generoDe);
  {
    let nf = genero.filter((g) => g === "f").length, nmm = genero.filter((g) => g === "m").length;
    genero.forEach((g, i) => {
      if (g !== null) return;
      if (nf <= nmm) {
        genero[i] = "f";
        nf++;
      } else {
        genero[i] = "m";
        nmm++;
      }
    });
  }
  const mujeres = shuffle(names.map((_, i) => i).filter((i) => genero[i] === "f"));
  const hombres = shuffle(names.map((_, i) => i).filter((i) => genero[i] === "m"));
  /** La rueda alternada, con la lista de los hombres corrida `c` lugares. */
  const tejer = (c: number): number[] => {
    const out: number[] = [];
    const nm = hombres.length;
    for (let i = 0; i < Math.max(mujeres.length, nm); i++) {
      if (i < mujeres.length) out.push(mujeres[i] as number);
      if (i < nm) out.push(hombres[(i + c) % nm] as number);
    }
    return out;
  };
  const order: number[] = tejer(0);
  /** El largo de rueda de cada bailarín, en radios de la plaza. */
  const ARC = clamp(15 / Math.max(1, n), 0.075, 0.25);
  const RING_GAP = clamp(ARC * 1.15, 0.12, 0.28);
  /** Los dos de la final, frente a frente: a un largo de brazos. */
  const PAIR = 0.62 * ARC;
  const ringsFor = (m: number): number[] => {
    const single = (m * ARC) / (2 * Math.PI);
    if (m === 2) return [PAIR];
    // De tres a seis, la rueda un poco más abierta que de la mano justa: si
    // no, uno quedaba detrás del otro y su nombre tapaba al de adelante.
    // Medido en largos de rueda, no en la plaza: con doscientos, los
    // bailarines son chicos y una rueda fija de 0,28 dejaba la cadena como un
    // palo entre las manos.
    if (single <= 1) return [Math.max(m <= 6 ? 0.9 * ARC : 0.14, single)];
    let best: number[] = [1];
    for (let q = 2; q <= 7; q++) {
      const radii = Array.from({ length: q }, (_, r) => 1 - r * RING_GAP);
      if ((radii[q - 1] as number) < 0.14) break;
      best = radii;
      if (radii.reduce((a, r) => a + (2 * Math.PI * r) / ARC, 0) >= m) break;
    }
    return best;
  };

  // Las filas del arranque: las mujeres atrás y los hombres adelante, de a
  // dieciséis por fila. Con cuatro o menos, una sola fila, lado a lado.
  // Cada fila va en el mismo sentido de giro que la rueda que van a formar: la
  // de atrás de izquierda a derecha y la de adelante al revés. Con las dos en
  // el mismo sentido, los hombres se cruzaban entre ellos camino a la rueda y
  // se amontonaban en un costado (lo vio el agente evaluador).
  const rowOf = (i: number): { u: number; v: number } => {
    if (n <= 4) {
      const j = order.indexOf(i);
      const span = Math.min(1.2, n * ARC * 1.1);
      return { u: span / 2 - (span * (j + 0.5)) / Math.max(1, n), v: 0.12 };
    }
    const woman = genero[i] === "f";
    const grupo = woman ? mujeres : hombres;
    const k = grupo.indexOf(i);
    const count = grupo.length;
    const per = Math.max(1, Math.min(16, count));
    const r = Math.floor(k / per);
    const inRow = Math.max(1, Math.min(per, count - r * per));
    const span = Math.min(1.7, inRow * ARC * 1.05);
    const rows = Math.ceil(count / per);
    // La primera fila de cada grupo va más lejos del medio: son los que van a
    // la rueda de afuera, así nadie cruza por encima de otra fila.
    const v = rows <= 1 ? 0.4 : 0.95 - (0.65 * r) / (rows - 1);
    const pos = woman ? k % per : inRow - 1 - (k % per);
    return { u: -span / 2 + (span * (pos + 0.5)) / inRow, v: woman ? -v : v };
  };
  const rowPolar = (i: number): Polar => {
    const p = rowOf(i);
    return { rho: Math.hypot(p.u, p.v), th: Math.atan2(p.v, p.u) };
  };

  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  function makeEpoch(at: number, members: number[], prev: Epoch | null): Epoch {
    const m = members.length;
    const radii = ringsFor(m);
    const q = radii.length;
    const tot = radii.reduce((a, b) => a + b, 0);
    const caps = radii.map((r) => Math.max(1, Math.round((m * r) / tot)));
    let diff = m - caps.reduce((a, b) => a + b, 0);
    for (let r = 0; diff !== 0; r = (r + 1) % q) {
      if (diff > 0) {
        caps[r] = (caps[r] as number) + 1;
        diff--;
      } else if ((caps[r] as number) > 1) {
        caps[r] = (caps[r] as number) - 1;
        diff++;
      }
    }
    const slot = new Map<number, Slot>();
    const rings: number[][] = [];
    const sp = spinAt(at);
    let i0 = 0;
    for (let r = 0; r < q; r++) {
      const ring = members.slice(i0, i0 + (caps[r] as number));
      rings.push(ring);
      i0 += caps[r] as number;
      const dir = r % 2 === 0 ? 1 : -1;
      const step = (2 * Math.PI) / Math.max(1, ring.length);
      // La rueda nueva arranca donde quedó la vieja (o donde estaban las
      // filas): el ángulo que menos mueve a todos.
      let base = 0;
      if (m !== 2) {
        let sx = 0, sy = 0;
        ring.forEach((idx, j) => {
          const p = prev ? polarIn(prev, idx, at) : rowPolar(idx);
          if (!p) return;
          const a = p.th - dir * sp - j * step;
          sx += Math.cos(a);
          sy += Math.sin(a);
        });
        base = sx || sy ? Math.atan2(sy, sx) : 0;
      }
      ring.forEach((idx, j) => slot.set(idx, { rho: radii[r] as number, base: base + j * step, dir }));
    }
    const rhoOut = radii[0] as number;
    return { at, members, rings, slot, rhoOut, gap: (2 * Math.PI * rhoOut) / Math.max(1, caps[0] as number) };
  }
  function polarIn(e: Epoch, idx: number, x: number): Polar | null {
    const s = e.slot.get(idx);
    if (!s) return null;
    // Los dos de la final, frente a frente y de las dos manos: se hamacan de un
    // lado al otro en vez de dar la vuelta, que los dejaba uno detrás del otro.
    // Una hamaca entera cada cuatro tiempos, al compás: con la vuelta de la
    // rueda tardaba unos ocho segundos y en "¡La última vuelta!" nadie se
    // movía. Con los golpes bailados y no con los del tramo, que vuelven a
    // cero en cada corte: si no, la pareja saltaba de lugar al volver la música.
    if (e.members.length === 2) return { rho: s.rho, th: s.base + 0.32 * Math.sin((Math.PI * (beatsDanced(x) + swayOff)) / 2) };
    return { rho: s.rho, th: s.dir * spinAt(x) + s.base };
  }
  // Con quién va de la mano cada uno: la lista de los hombres se corre hasta
  // que las dos filas se abren parejas, cada una hacia los dos costados, con
  // el menor viaje. Sin correrla, la mujer de una punta quedaba al lado del
  // hombre de la otra punta, y las dos puntas daban media vuelta por el mismo
  // costado: se amontonaban ahí (lo vio el agente evaluador).
  if (n > 4 && hombres.length > 1) {
    const nm = hombres.length, paso = Math.max(1, Math.floor(nm / 64));
    let mejor = 0, menor = Infinity;
    for (let c = 0; c < nm; c += paso) {
      const e = makeEpoch(0, tejer(c), null);
      let viaje = 0;
      for (const idx of e.members) viaje += Math.abs(wrap((polarIn(e, idx, T_JOIN) as Polar).th - rowPolar(idx).th));
      if (viaje < menor) {
        menor = viaje;
        mejor = c;
      }
    }
    order.splice(0, order.length, ...tejer(mejor));
  }
  const epochs: Epoch[] = [makeEpoch(0, order, null)];
  {
    const inRing = new Set(order);
    for (const e of evs) {
      if (e.kind !== "stop") continue;
      for (const v of e.victims) inRing.delete(v);
      epochs.push(makeEpoch(e.x0 + 0.15, order.filter((i) => inRing.has(i)), epochs[epochs.length - 1] as Epoch));
    }
  }
  /**
   * De las filas a la rueda, cuánto gira cada uno. Los de una misma fila y una
   * misma rueda giran para el mismo lado: con el giro más corto de cada uno por
   * separado, a uno le tocaba un lado y a su vecino el otro, y se cruzaban.
   */
  const e0 = epochs[0] as Epoch;
  const joinFrom = names.map((_, i) => (polarIn(e0, i, T_JOIN) as Polar).th);
  const joinTurn: number[] = (() => {
    const raw = names.map((_, i) => wrap((joinFrom[i] as number) - rowPolar(i).th));
    const out = raw.slice();
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${(e0.slot.get(i) as Slot).rho}:${rowOf(i).v > 0 ? 1 : 0}`;
      const g = groups.get(key) ?? [];
      g.push(i);
      groups.set(key, g);
    }
    for (const ids of groups.values()) {
      let sx = 0, sy = 0;
      for (const i of ids) {
        sx += Math.cos(raw[i] as number);
        sy += Math.sin(raw[i] as number);
      }
      const ref = Math.atan2(sy, sx);
      for (const i of ids) out[i] = ref + wrap((raw[i] as number) - ref);
    }
    return out;
  })();
  const epochAt = (x: number): number => {
    let k = 0;
    for (let i = 0; i < epochs.length; i++) if ((epochs[i] as Epoch).at <= x) k = i;
    return k;
  };
  /** Los dos vecinos de cada uno en su rueda, por época. */
  const nbrs = epochs.map((ep) => {
    const m = new Map<number, [number, number]>();
    for (const ring of ep.rings) {
      const L = ring.length;
      if (L < 2) continue;
      ring.forEach((idx, j) => m.set(idx, [ring[(j - 1 + L) % L] as number, ring[(j + 1) % L] as number]));
    }
    return m;
  });

  const colOf = (i: number): number => parseInt((avatarColor(names[i] ?? "") || "#ffc629").replace("#", ""), 16);
  const dancers: Dancer[] = names.map((_, i) => ({
    idx: i, tipoy: genero[i] === "f", col: colOf(i), outAt: -1, from: { rho: 0, th: 0 }, seat: { rho: 0, th: 0 }, away: false, row: rowOf(i),
  }));
  // Dónde termina cada uno que se suelta: sentado al borde de la plaza, o
  // yéndose hacia la sala si bailaba adelante. Lejos del conjunto.
  const leave = (d: Dancer, at: number, e: Epoch): void => {
    const p = polarIn(e, d.idx, at) ?? { rho: 0.5, th: Math.PI / 2 };
    d.outAt = at;
    d.from = p;
    d.away = Math.sin(p.th) > 0.3;
    let th = p.th;
    const off = wrap(th + Math.PI / 2);
    if (Math.abs(off) < 0.34) th = -Math.PI / 2 + (off < 0 ? -0.34 : 0.34);
    d.seat = { rho: d.away ? 2.5 : 1.2 + 0.13 * hash(d.idx, 31), th };
    // La rival de la final se sienta a unos pasos, a la vista: con la cámara
    // cerca, irse al borde de la plaza la sacaba de cuadro en un instante.
    if (d.idx === rivalIdx && at === FX0) {
      d.away = false;
      d.seat = { rho: p.rho + Math.min(0.4, 3 * PAIR), th: p.th };
    }
  };
  {
    let ei = 0;
    for (const e of evs) {
      if (e.kind !== "stop") continue;
      for (const v of e.victims) leave(dancers[v] as Dancer, e.x0, epochs[ei] as Epoch);
      ei++;
    }
    if (rivalIdx >= 0) leave(dancers[rivalIdx] as Dancer, FX0, epochs[epochs.length - 1] as Epoch);
  }
  const win = dancers[winnerIdx] as Dancer;
  const finalDuo = rivalIdx >= 0;
  const remainingAt = (x: number): number => dancers.filter((d) => d.outAt < 0 || d.outAt > x).length;
  /** Hasta dónde llegan las filas del arranque, para encuadrarlas. */
  const rowsRho = Math.max(0.12, ...dancers.map((d) => Math.hypot(d.row.u, d.row.v * 1.4)));
  /** La fila de más adelante del arranque: ahí el nombre va debajo de los pies. */
  const frontV = Math.max(...dancers.map((d) => d.row.v));

  /* ------------------------------------------------------------ el relator */
  let tAll = 0, tHold = 0;
  /** Cuándo fue el último corte: el fogonazo, el cartel y el tambaleo cuentan desde ahí. */
  let stopAt = -9;
  let crowned = false, dead = false;
  const said = new Set<string>();
  let sayAt = -9;
  let pending: { msg: string; heat: number } | null = null;
  function say(msg: string, heat = 0): void {
    if (tAll - sayAt >= 0.35) {
      S.say(msg, heat);
      sayAt = tAll;
      pending = null;
    } else if (!pending || heat >= pending.heat) pending = { msg, heat };
  }
  function sayPending(): void {
    if (pending && tAll - sayAt >= 0.35) {
      S.say(pending.msg, pending.heat);
      sayAt = tAll;
      pending = null;
    }
  }
  const once = (key: string, fn: () => void): void => {
    if (said.has(key)) return;
    said.add(key);
    fn();
  };
  const L = (): (typeof T)["es"] => T[getLang()];
  const nm = (i: number): string => names[i] ?? "";

  function crown(): void {
    if (crowned) return;
    crowned = true;
    say(L().cWin(winnersLabel(names, winners), winners.length > 1), 1);
    beep(note(0), 0.7, "sine", 0.09);
    // La octava de arriba, con armónicos: es la que el oído usa para
    // reconstruir el grave en el parlante de una laptop o un proyector.
    beep(note(5), 0.6, "sawtooth", 0.04);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.045), 700);
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    tAll = Math.max(tAll, T_CROWN);
    crown();
  };

  /** Lo que se dice y lo que suena en cada momento. */
  let lastBeat = -1;
  function script(): void {
    const x = tAll;
    once("intro", () => {
      say(t("cChoIntro"), 0.1);
      // La llamada del conjunto: tres notas que suben.
      beep(note(5), 0.12, "triangle", 0.05);
      setTimeout(() => beep(note(7), 0.12, "triangle", 0.05), 140);
      setTimeout(() => beep(note(9), 0.16, "triangle", 0.05), 280);
    });
    if (x >= 1.1) once("count", () => say(L().cChoCount(n), 0.15));
    if (x >= T_INTRO) once("clap", () => say(t("cChoClap"), 0.22));
    // Los pasos: un golpecito en cada tiempo mientras se baila.
    if (dancingAt(x) && x < T_CROWN) {
      const b = Math.floor(beatAt(x));
      if (b !== lastBeat) {
        lastBeat = b;
        beep(note(3 + (b % 2)), 0.06, "sine", 0.022);
      }
    } else lastBeat = -1;

    evs.forEach((e, c) => {
      const k = `${c}`;
      if (x >= e.s0) once(`s${k}`, () => {
        musicHold(true);
        say(t("cChoStop"), 0.5 + 0.05 * c);
        beep(note(14), 0.08, "square", 0.05);
        setTimeout(() => beep(note(2), 0.22, "sine", 0.07), 70);
        beepFor(note(1), (e.kind === "fake" ? FAKE : e.s1 - e.s0) * 0.9, "sawtooth", 0.022);
        cam.punch(0.05).shake(4 * S.u());
        stopAt = e.s0;
      });
      if (e.kind === "fake") {
        if (x >= e.w0) once(`w${k}`, () => e.holders.forEach((_, i) => setTimeout(() => beep(note(11 - i), 0.1, "square", 0.045), i * 110)));
        if (x >= e.x0) once(`r${k}`, () => {
          musicHold(false);
          const back = story.arc === "remontada" && e.holders.includes(winnerIdx);
          if (back) say(L().cChoBack(nm(winnerIdx)), 0.6);
          else say(t("cChoFake"), 0.45);
          beep(note(7), 0.09, "triangle", 0.05);
          setTimeout(() => beep(note(9), 0.09, "triangle", 0.05), 90);
          setTimeout(() => beep(note(12), 0.14, "triangle", 0.05), 180);
        });
        return;
      }
      if (x >= e.w0) once(`w${k}`, () => {
        const shaky = [...e.victims.slice(0, 3), ...e.holders];
        shaky.forEach((_, i) => setTimeout(() => beep(note(13 - (i % 4)), 0.1, "square", 0.045), i * 120));
        const h = e.holders[0];
        if (h !== undefined && (story.arc !== "tapada" || h !== winnerIdx)) say(L().cChoWobble(nm(h)), h === winnerIdx ? 0.85 : 0.62);
      });
      if (x >= e.x0) once(`x${k}`, () => {
        const v = e.victims;
        const prize = v.filter((i) => prized.has(i));
        if (v.length === 1) say(prized.has(v[0] as number) ? L().cChoPrize(nm(v[0] as number)) : L().cChoOut(nm(v[0] as number)), 0.55 + 0.25 * (1 - remainingAt(x) / n));
        else if (prize.length === 1 && v.length <= 3) say(L().cChoPrize(nm(prize[0] as number)), 0.7);
        else if (v.length <= 3) say(L().cChoOutN(v.map(nm)), 0.6);
        else say(L().cChoMany(v.length), 0.6);
        beep(note(5), 0.12, "triangle", 0.05);
        setTimeout(() => beep(note(2), 0.18, "triangle", 0.045), 90);
        cam.shake(5 * S.u());
      });
      const h = e.holders[0];
      if (h !== undefined && x >= e.x0 + 0.45) once(`h${k}`, () => {
        if (story.arc !== "tapada" || h !== winnerIdx) say(L().cChoHold(nm(h)), h === winnerIdx ? 0.9 : 0.66);
        beep(note(10), 0.14, "triangle", 0.05);
      });
      if (x >= e.s1) once(`g${k}`, () => {
        musicHold(false);
        say(t("cChoGo"), 0.3 + 0.07 * c);
        beep(note(9), 0.1, "triangle", 0.05);
        setTimeout(() => beep(note(12), 0.14, "triangle", 0.05), 90);
      });
    });

    if (!finalDuo) return;
    if (x >= F0 + 0.15) once("duo", () => {
      if (story.arc === "tapada") say(t("cChoDuoAnon"), 0.78);
      else if (n === 2) say(L().cChoPair(...enOrden(nm(winnerIdx), nm(rivalIdx))), 0.8);
      else say(L().cChoDuo(...enOrden(nm(winnerIdx), nm(rivalIdx))), 0.8);
      beep(note(12), 0.12, "triangle", 0.05);
      setTimeout(() => beep(note(14), 0.16, "triangle", 0.05), 110);
    });
    if (x >= FD0) once("faster", () => {
      musicTempo(FINAL_TEMPO);
      say(t("cChoFinal"), 0.85);
    });
    if (fakeFinal && x >= FK0) once("fk0", () => {
      musicHold(true);
      say(t("cChoStop"), 0.86);
      beep(note(14), 0.08, "square", 0.055);
      setTimeout(() => beep(note(2), 0.22, "sine", 0.07), 70);
      beepFor(note(1), FINAL_FAKE * 0.9, "sawtooth", 0.022);
      cam.punch(0.05);
      stopAt = FK0;
    });
    if (fakeFinal && x >= FK1) once("fk1", () => {
      musicHold(false);
      say(t("cChoFake"), 0.88);
      beep(note(7), 0.09, "triangle", 0.05);
      setTimeout(() => beep(note(9), 0.09, "triangle", 0.05), 90);
      setTimeout(() => beep(note(12), 0.14, "triangle", 0.05), 180);
    });
    if (x >= FS0) once("fs", () => {
      musicHold(true);
      say(t("cChoStop"), 0.92);
      beep(note(15), 0.1, "square", 0.06);
      // Un golpe de caja seco que marca el silencio: el seno solo en el piso
      // del registro no pasaba por un parlante chico.
      setTimeout(() => {
        beep(note(2), 0.26, "triangle", 0.06);
        beep(note(7), 0.06, "square", 0.05);
      }, 80);
      beepFor(note(1), (FX0 - FS0) * 0.95, "sawtooth", 0.024);
      cam.punch(0.07).shake(6 * S.u());
      stopAt = FS0;
    });
    if (x >= FW0) once("fw", () => {
      beep(note(13), 0.1, "square", 0.045);
      setTimeout(() => beep(note(12), 0.1, "square", 0.045), 160);
      if (story.arc === "susto" && !sustoInStop) say(L().cChoWobble(nm(winnerIdx)), 0.9);
    });
    if (x >= FX0) once("fx", () => {
      say(prized.has(rivalIdx) ? L().cChoPrize(nm(rivalIdx)) : L().cChoOut(nm(rivalIdx)), 0.95);
      beep(note(5), 0.12, "triangle", 0.055);
      setTimeout(() => beep(note(2), 0.2, "triangle", 0.05), 90);
      cam.shake(6 * S.u());
    });
  }

  /* ------------------------------------------------------------- la escena */
  interface Geo {
    W: number; H: number; k: number; cx: number; cy: number; rx: number; ry: number;
    /** Donde termina la plaza y empiezan las casas, y el alto de las casas. */
    yB: number; hs: number;
    /** El alto de un bailarín parado, y cuánto crece adelante y se achica atrás. */
    dh: number; dk: number;
    portrait: boolean; avail: number;
  }
  const geo = (): Geo => {
    const W = S.sw(), H = S.sh(), k = S.u(), portrait = S.portrait();
    const top = S.top(), bot = S.bottom();
    const avail = H - top - bot;
    // En el celular la plaza se ve más desde arriba y un poco más abajo: así la
    // rueda usa el alto de la pantalla y no queda tierra vacía.
    const rx = portrait ? W * 0.47 : Math.min(W * 0.34, avail * 0.95);
    const ry = rx * (portrait ? 0.78 : 0.36);
    const cy = top + avail * (portrait ? 0.68 : 0.64);
    // Que se toquen las manos con el de al lado, y nunca más que un séptimo de
    // la pantalla. Vistos desde más arriba, en el celular pueden ser más altos.
    const dh = clamp((ARC * rx) / (portrait ? 0.62 : 0.82), H * 0.045, H * (portrait ? 0.1 : 0.15));
    const yB = cy - ry * 1.5;
    const hs = Math.min(dh * 1.05, (yB - top) / 1.2, H * 0.14);
    return { W, H, k, cx: W / 2, cy, rx, ry, yB, hs, dh, dk: portrait ? 0.22 : 0.18, portrait, avail };
  };
  let G = geo();
  /** Lo que separa a los dos de la final: un largo de brazos, y nunca menos que un cuerpo. */
  const pairRho = (): number => Math.max(PAIR, (0.55 * G.dh) / G.rx);
  /** De la plaza a la pantalla: dónde quedan los pies y de qué tamaño se ve. */
  const project = (p: Polar): { x: number; y: number; s: number } => {
    const v = p.rho * Math.sin(p.th);
    return { x: G.cx + G.rx * p.rho * Math.cos(p.th), y: G.cy + G.ry * v, s: G.dh * (1 + G.dk * clamp(v, -1.4, 1.4)) };
  };

  let sky!: Graphics;
  let back!: Graphics;
  let flags!: Graphics;
  let ground!: Graphics;
  let chain!: Graphics;
  let notes!: Graphics;
  let people!: Container;
  let band!: Band;
  let tint!: Graphics;
  let badge!: Graphics;
  let big!: Text;
  let chips!: Container;
  let leaders!: Graphics;
  let panel!: Container;
  let panelFor = -1;
  /** Dónde va el cartel del corte que está pasando: se decide una vez, en el cuadro del corte. */
  let bigFor = -9, bigX = 0, bigY = 0, bigS = 0, bigPop = 0;
  let counter!: Text;
  let counterBox!: Graphics;
  let counterRoot!: Container;

  function makeDancer(d: Dancer): View {
    const root = new Container();
    const col = d.col;
    const skin = SKINS[Math.floor(hash(d.idx, 42) * SKINS.length)] as number;
    const hair = HAIRS[Math.floor(hash(d.idx, 43) * HAIRS.length)] as number;
    const line = { width: 0.02, color: INK };
    root.addChild(new Graphics().ellipse(0, 0, 0.2, 0.045).fill({ color: 0x000000, alpha: 0.28 }));
    // Las piernas: el pantalón blanco hasta el tobillo y las abarcas, o los
    // tobillos y las ojotas debajo del tipoy.
    const leg = (x: number): Graphics => {
      const g = new Graphics();
      if (d.tipoy) g.roundRect(x - 0.022, -0.12, 0.044, 0.11, 0.02).fill(skin).ellipse(x, -0.012, 0.045, 0.02).fill(0x6b4a2e);
      else g.roundRect(x - 0.04, -0.44, 0.08, 0.42, 0.03).fill(WHITE).stroke(line).ellipse(x, -0.014, 0.055, 0.024).fill(0x5a3a22);
      return g;
    };
    const legL = leg(-0.055), legR = leg(0.055);
    // Sentados al borde de la plaza: las piernas cruzadas.
    const lap = new Graphics().ellipse(0, -0.07, 0.17, 0.065).fill(WHITE).stroke(line);
    if (d.tipoy) lap.rect(-0.16, -0.06, 0.32, 0.03).fill(col);
    lap.visible = false;
    root.addChild(legL, legR, lap);
    const body = new Container();
    body.position.set(0, -0.44);
    body.sortableChildren = true;
    const torso = new Graphics();
    torso.zIndex = 1;
    if (d.tipoy) {
      // El tipoy: blanco, hasta los tobillos, sin cuello ni mangas, con la
      // cinta del color de la persona en el escote y en el ruedo.
      torso.poly([-0.11, -0.34, 0.11, -0.34, 0.2, 0.33, -0.2, 0.33]).fill(WHITE).stroke({ ...line, join: "round" })
        .poly([-0.181, 0.22, 0.181, 0.22, 0.194, 0.3, -0.194, 0.3]).fill(col)
        .rect(-0.09, -0.34, 0.18, 0.055).fill(col)
        .poly([-0.11, -0.34, 0.11, -0.34, 0.2, 0.33, -0.2, 0.33]).stroke({ ...line, join: "round" });
    } else {
      // La camisa blanca, con el pantalón del mismo lienzo.
      torso.roundRect(-0.12, -0.34, 0.24, 0.37, 0.04).fill(WHITE).stroke(line);
    }
    // Lo que solo se ve de frente: el collar de cuentas, o la línea de botones.
    const buttons = new Graphics();
    buttons.zIndex = 1.5;
    if (d.tipoy) for (let i = 0; i < 5; i++) buttons.circle(-0.05 + i * 0.025, -0.27 + Math.abs(i - 2) * -0.008, 0.011).fill(i % 2 ? YELLOW : 0xd7263d);
    else buttons.moveTo(0, -0.33).lineTo(0, -0.05).stroke({ width: 0.012, color: INK, alpha: 0.35 });
    // El brazo y la mano por separado: el brazo se estira hasta el vecino
    // cuando la rueda es chica, y la mano no se deforma.
    const arm = (x: number): Container => {
      const a = new Container();
      a.position.set(x, -0.31);
      const hand = new Graphics().circle(0, 0, 0.035).fill(skin).stroke({ width: 0.015, color: INK });
      hand.y = 0.29;
      a.addChild(new Graphics().roundRect(-0.03, 0, 0.06, 0.27, 0.03).fill(d.tipoy ? skin : WHITE).stroke({ width: 0.018, color: INK }), hand);
      return a;
    };
    const armL = arm(-0.11), armR = arm(0.11);
    const head = new Container();
    head.position.set(0, -0.43);
    head.zIndex = 3;
    // De frente (los de atrás de la rueda miran al centro, o sea a la sala) y de espaldas.
    const face = new Graphics().circle(0, 0, 0.085).fill(skin).stroke(line)
      .circle(-0.03, -0.004, 0.011).fill(INK).circle(0.03, -0.004, 0.011).fill(INK)
      .roundRect(-0.022, 0.03, 0.044, 0.012, 0.006).fill(0x8c2f2f);
    const backHead = new Graphics();
    if (d.tipoy) {
      // El pelo partido en dos trenzas, con cintas y una flor.
      const fl = FLOWERS[Math.floor(hash(d.idx, 44) * FLOWERS.length)] as number;
      face.arc(0, 0, 0.087, Math.PI * 1.02, Math.PI * 1.98).fill(hair);
      backHead.circle(0, 0, 0.085).fill(hair).stroke(line);
      for (const g of [face, backHead]) {
        g.roundRect(-0.105, -0.01, 0.04, 0.2, 0.02).fill(hair).stroke({ width: 0.012, color: INK })
          .roundRect(0.065, -0.01, 0.04, 0.2, 0.02).fill(hair).stroke({ width: 0.012, color: INK })
          .rect(-0.107, 0.15, 0.044, 0.025).fill(col).rect(0.063, 0.15, 0.044, 0.025).fill(col)
          .circle(0.07, -0.06, 0.03).fill(fl).stroke({ width: 0.012, color: INK }).circle(0.07, -0.06, 0.011).fill(YELLOW);
      }
    } else {
      // De espaldas: la nuca y el cuello de piel, el pelo corto arriba, debajo
      // del ala. Una cabeza toda de pelo se leía como una cara negra.
      backHead.circle(0, 0, 0.085).fill(skin).stroke(line)
        .arc(0, 0, 0.087, Math.PI * 1.05, Math.PI * 1.95).fill(hair)
        .rect(-0.03, 0.07, 0.06, 0.05).fill(skin);
      // El sombrero de saó, con la cinta del color de la persona.
      for (const g of [face, backHead]) {
        g.ellipse(0, -0.055, 0.18, 0.036).fill(STRAW).stroke({ width: 0.015, color: INK })
          .roundRect(-0.075, -0.145, 0.15, 0.095, 0.03).fill(STRAW).stroke({ width: 0.015, color: INK })
          .rect(-0.076, -0.085, 0.152, 0.032).fill(col);
      }
    }
    head.addChild(face, backHead);
    // El "¡!" del que trastabilla.
    const alert = new Graphics()
      .roundRect(-0.028, -0.32, 0.056, 0.14, 0.02).fill(YELLOW).stroke({ width: 0.016, color: INK })
      .circle(0, -0.14, 0.028).fill(YELLOW).stroke({ width: 0.016, color: INK });
    alert.visible = false;
    head.addChild(alert);
    body.addChild(armL, armR, torso, buttons, head);
    root.addChild(body);
    return { root, body, head, armL, armR, legL, legR, lap, face, back: backHead, buttons, alert };
  }

  /** Un músico del conjunto: camisa y pantalón blancos, sombrero de saó. */
  function musician(x: number, col: number, skin: number): Container {
    const c = new Container();
    c.position.set(x, 0);
    const line = { width: 0.02, color: INK };
    c.addChild(new Graphics()
      .roundRect(-0.095, -0.44, 0.08, 0.42, 0.03).fill(WHITE).stroke(line)
      .roundRect(0.015, -0.44, 0.08, 0.42, 0.03).fill(WHITE).stroke(line)
      .roundRect(-0.12, -0.78, 0.24, 0.37, 0.04).fill(WHITE).stroke(line)
      .circle(0, -0.87, 0.085).fill(skin).stroke(line)
      .circle(-0.03, -0.874, 0.011).fill(INK).circle(0.03, -0.874, 0.011).fill(INK)
      .ellipse(0, -0.925, 0.18, 0.036).fill(STRAW).stroke({ width: 0.015, color: INK })
      .roundRect(-0.075, -1.015, 0.15, 0.095, 0.03).fill(STRAW).stroke({ width: 0.015, color: INK })
      .rect(-0.076, -0.955, 0.152, 0.03).fill(col));
    return c;
  }

  function build(): void {
    G = geo();
    const { W, H, k, cx, cy, rx, ry, yB, hs } = G;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    sky = new Graphics();
    S.bg.addChild(sky);
    back = new Graphics();
    flags = new Graphics();
    ground = new Graphics();
    chain = new Graphics();
    notes = new Graphics();
    people = new Container();
    people.sortableChildren = true;

    // El cerro de granito redondo en el horizonte, detrás de las casas.
    back.ellipse(cx + W * 0.24, yB - hs * 0.55, W * 0.2, hs * 1.15).fill(S.dark ? 0x3a3150 : 0x9c8a8f);
    back.ellipse(cx - W * 0.42, yB - hs * 0.4, W * 0.16, hs * 0.8).fill(S.dark ? 0x342b48 : 0xa8969a);
    // El suelo de la plaza: la tierra colorada, y la rueda apisonada.
    const earth = S.dark ? 0x6e3424 : 0xc4623a;
    ground.rect(-W, yB, W * 3, H * 2).fill(earth);
    for (let i = 0; i < 70; i++) {
      const gx = -W * 0.5 + hash(i, 61) * W * 2, gy = yB + hash(i, 62) * (H - yB) * 1.3;
      const inside = ((gx - cx) / (rx * 1.15)) ** 2 + ((gy - cy) / (ry * 1.15)) ** 2 < 1;
      if (inside) continue;
      ground.moveTo(gx, gy).lineTo(gx - 3 * k, gy - 7 * k).moveTo(gx, gy).lineTo(gx + 3 * k, gy - 6 * k)
        .stroke({ width: 2 * k, color: S.dark ? 0x3f6b35 : 0x5e9a46, alpha: 0.8 });
    }
    ground.ellipse(cx, cy, rx * 1.12, ry * 1.12).fill({ color: S.dark ? 0x8a4a33 : 0xd98a5f, alpha: 0.9 });
    ground.ellipse(cx, cy, rx * 1.12, ry * 1.12).stroke({ width: 3 * k, color: S.dark ? 0x9c5a40 : 0xe8a77f, alpha: 0.7 });
    ground.ellipse(cx, cy, rx * 0.6, ry * 0.6).stroke({ width: 2 * k, color: S.dark ? 0x9c5a40 : 0xe8a77f, alpha: 0.35 });

    // Las casas de adobe del fondo, en ocre y café, con su corredor de
    // horcones y el techo de teja.
    const walls = S.dark ? [0xc9a66b, 0xb88f5a, 0xd2b383] : [0xe9c27f, 0xd9a866, 0xf0d6a2];
    const trims = S.dark ? 0x6b4527 : 0x8a5a33;
    let hx = cx - W * 1.1;
    let hi = 0;
    while (hx < cx + W * 1.1) {
      const hw = hs * (1.6 + hash(hi, 71) * 1.1);
      const wallH = hs * (0.72 + hash(hi, 72) * 0.12);
      const top = yB - wallH;
      back.rect(hx, top, hw, wallH).fill(walls[hi % walls.length] as number).stroke({ width: 2 * k, color: INK, alpha: 0.6 });
      back.rect(hx, yB - wallH * 0.14, hw, wallH * 0.14).fill(trims);
      // La puerta y las ventanas, con luz adentro de noche.
      const win = S.dark ? 0xffc65a : 0x3a2a1e;
      back.rect(hx + hw * 0.42, yB - wallH * 0.62, hw * 0.16, wallH * 0.62).fill(0x5a3a22);
      back.rect(hx + hw * 0.13, yB - wallH * 0.62, hw * 0.16, wallH * 0.3).fill(win)
        .rect(hx + hw * 0.71, yB - wallH * 0.62, hw * 0.16, wallH * 0.3).fill(win);
      // El techo de teja, que sale hacia adelante y se apoya en los horcones.
      const roof = S.dark ? 0x7a3420 : 0xb5532f;
      back.poly([hx - hs * 0.12, top + hs * 0.1, hx + hw + hs * 0.12, top + hs * 0.1, hx + hw + hs * 0.02, top - hs * 0.32, hx - hs * 0.02, top - hs * 0.32])
        .fill(roof).stroke({ width: 2 * k, color: INK, alpha: 0.7 });
      for (let tl = 1; tl < 4; tl++) back.moveTo(hx - hs * 0.1 + tl * 0.02 * hs, top + hs * 0.1 - tl * hs * 0.105).lineTo(hx + hw + hs * 0.1 - tl * 0.02 * hs, top + hs * 0.1 - tl * hs * 0.105).stroke({ width: 1.5 * k, color: INK, alpha: 0.25 });
      back.rect(hx - hs * 0.12, top + hs * 0.06, hw + hs * 0.24, hs * 0.09).fill(S.dark ? 0x5c2716 : 0x8f3f22);
      for (let px = hx; px <= hx + hw + 1; px += hw / Math.max(2, Math.round(hw / (hs * 0.55)))) {
        back.rect(px - hs * 0.035, top + hs * 0.13, hs * 0.07, wallH - hs * 0.13).fill(0x5a3a22).stroke({ width: 1.5 * k, color: INK, alpha: 0.6 });
      }
      hx += hw + hs * 0.35;
      hi++;
    }
    // El toborochi, a la derecha: el tronco de botella y la copa rosada.
    const tbx = cx + rx * 1.18, tby = yB + hs * 0.25;
    back.poly([tbx - hs * 0.12, tby, tbx - hs * 0.2, tby - hs * 0.35, tbx - hs * 0.1, tby - hs * 0.75, tbx - hs * 0.05, tby - hs * 1.05,
      tbx + hs * 0.05, tby - hs * 1.05, tbx + hs * 0.1, tby - hs * 0.75, tbx + hs * 0.2, tby - hs * 0.35, tbx + hs * 0.12, tby])
      .fill(S.dark ? 0x5f7046 : 0x8aa36b).stroke({ width: 2 * k, color: INK, alpha: 0.7 });
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * (0.1 + 0.8 * hash(i, 81));
      const r = hs * (0.35 + 0.35 * hash(i, 82));
      back.circle(tbx + Math.cos(a) * r * 1.4, tby - hs * 1.15 + Math.sin(a) * r * 0.7, hs * (0.14 + 0.08 * hash(i, 83)))
        .fill(i % 3 === 0 ? 0xff9ccc : i % 3 === 1 ? 0xff7eb6 : 0xe93d9c);
    }
    // Una palmera, a la izquierda.
    const pmx = cx - rx * 1.2, pmy = yB + hs * 0.3;
    back.moveTo(pmx, pmy).quadraticCurveTo(pmx + hs * 0.1, pmy - hs * 0.9, pmx - hs * 0.05, pmy - hs * 1.6).stroke({ width: hs * 0.09, color: 0x7a5a3a });
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (1.05 + i * 0.15);
      back.moveTo(pmx - hs * 0.05, pmy - hs * 1.6).quadraticCurveTo(pmx - hs * 0.05 + Math.cos(a) * hs * 0.5, pmy - hs * 1.85 + Math.sin(a) * hs * 0.2,
        pmx - hs * 0.05 + Math.cos(a) * hs * 0.85, pmy - hs * 1.45 + Math.sin(a + 0.6) * hs * 0.3).stroke({ width: 5 * k, color: S.dark ? 0x2f5c2a : 0x3f7d3a, cap: "round" });
    }

    // El conjunto, en su tarima al fondo: el pífano, la caja y el bombo.
    const bandRoot = new Container();
    bandRoot.position.set(cx, cy - ry * 1.3);
    bandRoot.scale.set(G.dh * 0.86);
    bandRoot.addChild(new Graphics().rect(-0.62, -0.06, 1.24, 0.1).fill(0x7a5a3a).stroke({ width: 0.02, color: INK }));
    const b1 = musician(-0.38, 0xe93d9c, 0xc68a5c);
    const b2 = musician(0, 0x00a896, 0xa86f45);
    const b3 = musician(0.38, 0xff7a1a, 0xd9a273);
    const flute = new Graphics();
    const sticks = new Graphics();
    const drum = new Graphics();
    const mallet = new Container();
    mallet.position.set(0.48, -0.62);
    mallet.addChild(new Graphics().roundRect(-0.015, 0, 0.03, 0.26, 0.015).fill(0x5a3a22).circle(0, 0.27, 0.04).fill(CREAM).stroke({ width: 0.012, color: INK }));
    bandRoot.addChild(b1, b2, b3, flute, sticks, drum, mallet);
    band = { root: bandRoot, flute, sticks, mallet, drum, bodies: [b1, b2, b3] };

    S.scene.addChild(back, flags, ground, bandRoot, notes, chain, people);
    for (const d of dancers) {
      d.view?.root.destroy({ children: true });
      d.view = makeDancer(d);
      people.addChild(d.view.root);
      d.chip = undefined;
    }

    // La interfaz.
    tint = new Graphics();
    badge = new Graphics();
    big = S.text(t("cChoBig"), { fontSize: 64 * k, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 9 * k }, letterSpacing: 2 * k });
    big.anchor.set(0.5);
    big.visible = false;
    chips = new Container();
    leaders = new Graphics();
    panel = new Container();
    panelFor = -1;
    bigFor = -9;
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    counterRoot = new Container();
    counterRoot.addChild(counterBox, counter);
    counterRoot.position.set(22 * k, S.top() + 10 * k);
    S.hud.addChild(tint, big, leaders, chips, panel, counterRoot, badge);
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  cam.cut(G.W / 2, G.H / 2, 1);

  /* ---------------------------------------------------------- los bailarines */
  /** Cuánto se soltó alguien en el corte falso, de 0 a 1. */
  function fakeOut(d: Dancer, x: number): number {
    for (const e of evs) {
      if (e.kind !== "fake" || !e.holders.includes(d.idx)) continue;
      const out = clamp((x - e.w0) / 0.22, 0, 1) * (1 - clamp((x - e.x0) / 0.3, 0, 1));
      if (out > 0) return out;
    }
    return 0;
  }

  /** Dónde está cada uno, de qué tamaño, y qué tan sentado. */
  function where(d: Dancer, x: number): { p: Polar; alpha: number; seated: number; rows: number } {
    if (d.outAt >= 0 && x >= d.outAt) {
      const lenta = d.idx === rivalIdx && d.outAt === FX0;
      const dur = lenta ? 1.3 : d.away ? EXIT * 1.9 : EXIT;
      const f = clamp((x - d.outAt) / dur, 0, 1);
      const e = lenta ? ease.inOutCubic(f) : ease.outCubic(f);
      // La rival sale de donde se la veía, que nunca está encimada al ganador.
      const r0 = lenta ? Math.max(d.from.rho, pairRho()) : d.from.rho;
      const r1 = lenta ? Math.max(d.seat.rho, r0 + Math.min(0.4, 3 * PAIR)) : d.seat.rho;
      const p = { rho: r0 + (r1 - r0) * e, th: d.from.th + wrap(d.seat.th - d.from.th) * e };
      // Los que se van hacia la sala salen de la pantalla enteros: con
      // transparencia se veía un brazo a través del cuerpo.
      return { p, alpha: d.away && f >= 1 ? 0 : 1, seated: d.away ? 0 : clamp((f - 0.7) / 0.3, 0, 1), rows: 0 };
    }
    const ei = epochAt(x);
    const ep = epochs[ei] as Epoch;
    let p = polarIn(ep, d.idx, x) ?? { rho: 0, th: 0 };
    // Los dos de la final, nunca encimados: con doscientos en el celular el
    // largo de brazos era más chico que un cuerpo.
    if (ep.members.length === 2) p = { rho: Math.max(p.rho, pairRho()), th: p.th };
    // La rueda se cierra: del lugar que tenía al nuevo.
    if (ei > 0 && x - ep.at < CLOSE) {
      const old = polarIn(epochs[ei - 1] as Epoch, d.idx, ep.at);
      if (old) {
        const e = ease.inOutCubic(clamp((x - ep.at) / CLOSE, 0, 1));
        p = { rho: old.rho + (p.rho - old.rho) * e, th: old.th + wrap(p.th - old.th) * e };
      }
    }
    // Se juntan y se separan como un abanico, cada dos compases.
    if (x >= T_JOIN + JOIN && ep.members.length > 2) p = { rho: p.rho * (1 + 0.045 * Math.sin((Math.PI * beatAt(x)) / 2)), th: p.th };
    // El corte falso: los que se soltaron dan un paso afuera y vuelven. El
    // paso arranca cuando ya soltaron las manos (antes, la cadena se estiraba
    // como un palo), y con dos es más corto: la cámara está encima.
    const fo = fakeOut(d, x);
    if (fo > 0.3) p = { rho: p.rho + (ep.members.length <= 2 ? 0.1 : 0.25) * ease.outCubic((fo - 0.3) / 0.7), th: p.th };
    // La ganadora, coronada, va al medio.
    if (d === win && x >= T_CROWN) {
      const e = ease.inOutCubic(clamp((x - T_CROWN) / 0.8, 0, 1));
      p = { rho: p.rho * (1 - e), th: p.th };
    }
    // El arranque: de las dos filas a la rueda, por el costado y no por el
    // medio (en ángulo y en radio).
    let rows = 0;
    if (x < T_JOIN + JOIN) {
      rows = 1 - ease.inOutCubic(clamp((x - T_JOIN) / JOIN, 0, 1));
      const r = rowPolar(d.idx);
      // Lo que giró la rueda desde que arrancaron, más el giro de cada uno.
      const giro = (joinTurn[d.idx] as number) + wrap(p.th - (joinFrom[d.idx] as number));
      // Los de adelante pasan por afuera y los de atrás por adentro: así se
      // cruzan sin chocarse.
      const f = Math.sin(Math.PI * (1 - rows));
      const bombeo = d.row.v > 0 ? 1 + 0.2 * f : 1 - 0.12 * f;
      p = { rho: (r.rho + (p.rho - r.rho) * (1 - rows)) * bombeo, th: r.th + giro * (1 - rows) };
    }
    return { p, alpha: 1, seated: 0, rows };
  }

  /** El tambaleo de alguien en este momento, de 0 a ~0,25. */
  function wobbleOf(d: Dancer, x: number): number {
    for (const e of evs) {
      if (e.kind === "stop") {
        const mine = e.victims.includes(d.idx) || e.holders.includes(d.idx);
        if (!mine || x < e.w0) continue;
        const span = e.x0 - e.w0;
        if (x < e.x0) return (0.06 + 0.19 * ease.outCubic((x - e.w0) / span)) * (0.8 + 0.4 * hash(d.idx, 51));
        if (e.holders.includes(d.idx) && x < e.x0 + 0.5) return 0.25 * (1 - (x - e.x0) / 0.5);
      } else if (e.holders.includes(d.idx) && x >= e.w0 && x < e.x0 + 0.3) {
        return 0.12 * (1 - clamp((x - e.x0) / 0.3, 0, 1));
      }
    }
    if (finalDuo && (d.idx === winnerIdx || d.idx === rivalIdx)) {
      if (fakeFinal && x >= FK0 + FREEZE && x < FK1 + 0.3) return 0.1 * (1 - clamp((x - FK1) / 0.3, 0, 1));
      if (x >= FW0 && x < FX0) {
        const amp = d.idx === winnerIdx ? (story.arc === "susto" && !sustoInStop ? 1.3 : 0.8 + 0.4 * hash(winnerIdx, 52)) : 1;
        return (0.07 + 0.17 * ease.outCubic((x - FW0) / (FX0 - FW0))) * amp;
      }
      if (d.idx === winnerIdx && x >= FX0 && x < FX0 + 0.5) return 0.22 * (1 - (x - FX0) / 0.5);
    }
    return 0;
  }

  // Lo que se calcula en cada cuadro para cada uno: dónde está y dónde tiene las manos.
  const wNow: ReturnType<typeof where>[] = dancers.map(() => ({ p: { rho: 0, th: 0 }, alpha: 1, seated: 0, rows: 0 }));
  const pNow: { x: number; y: number; s: number }[] = dancers.map(() => ({ x: 0, y: 0, s: 1 }));
  const handsNow: { L: Pt; R: Pt }[] = dancers.map(() => ({ L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }));
  /** En la rueda, de la mano, en este momento. */
  const inRingNow = (d: Dancer, x: number): boolean => (d.outAt < 0 || x < d.outAt) && !(d === win && x >= T_CROWN);

  function drawPeople(x: number): void {
    const beat = beatAt(x);
    const sb = Math.sin(Math.PI * beat);
    const playing = dancingAt(x) && x < T_CROWN;
    // Los que miran la rueda desde el borde aplauden con la música.
    const clap = playing || x >= T_CROWN ? Math.abs(Math.sin(Math.PI * (x >= T_CROWN ? x * 4.2 : beat))) : 0.3;
    // Primero, dónde está cada uno.
    dancers.forEach((d, i) => {
      wNow[i] = where(d, x);
      pNow[i] = project((wNow[i] as ReturnType<typeof where>).p);
    });
    const nb = nbrs[epochAt(x)] as Map<number, [number, number]>;
    const linked = x >= T_JOIN + JOIN * 0.6;
    for (const d of dancers) {
      const v = d.view as View;
      const w = wNow[d.idx] as ReturnType<typeof where>;
      const pr = pNow[d.idx] as { x: number; y: number; s: number };
      v.root.visible = w.alpha > 0.02;
      if (!v.root.visible) continue;
      v.root.alpha = w.alpha;
      // Los que ya salieron se ven apagados, para que nadie los confunda con
      // los que siguen en la rueda; la ganadora, coronada, con todo su color.
      // Los que salen con premio, en un tono cálido: con el gris de eliminado
      // parecía que perdían.
      const fuera = d.outAt >= 0 && x >= d.outAt;
      v.root.tint = fuera ? (prized.has(d.idx) ? 0xfff0c2 : S.dark ? 0x9a92ad : 0xc2bccb) : 0xffffff;
      v.root.zIndex = pr.y;
      v.root.scale.set(pr.s);
      let y = pr.y;
      // De frente o de espaldas. En las filas del arranque y en la final,
      // todos miran a la sala.
      const final = (n === 2 || (finalDuo && x >= F0)) && (d.idx === winnerIdx || d.idx === rivalIdx);
      const facing = w.rows > 0.3 || final || Math.sin(w.p.th) <= 0.08 || w.p.rho < 0.02;
      v.face.visible = facing;
      v.back.visible = !facing;
      v.buttons.visible = facing;
      const seated = w.seated;
      v.lap.visible = seated > 0.5;
      v.legL.visible = v.legR.visible = seated <= 0.5;
      v.body.y = -0.44 + 0.24 * seated;
      v.legL.y = v.legR.y = 0;
      v.armL.zIndex = v.armR.zIndex = 0;
      /** Cuánto llega cada brazo: 1 es el largo de siempre. */
      let rL = 1, rR = 1;
      const wob = wobbleOf(d, x);
      v.alert.visible = wob > 0.05;
      const shL = { x: pr.x - 0.11 * pr.s, y: pr.y - 0.75 * pr.s }, shR = { x: pr.x + 0.11 * pr.s, y: pr.y - 0.75 * pr.s };
      if (d === win && x >= T_CROWN) {
        // La ganadora salta con los brazos arriba.
        y -= Math.abs(Math.sin(x * 7)) * 0.3 * pr.s;
        v.armL.rotation = 2.7;
        v.armR.rotation = -2.7;
        v.body.rotation = Math.sin(x * 7) * 0.05;
        v.face.visible = v.buttons.visible = true;
        v.back.visible = false;
      } else if (fuera && seated > 0.5) {
        // Sentados al borde: aplauden arriba de la cabeza.
        v.armL.rotation = 2.5 + 0.35 * clap;
        v.armR.rotation = -2.5 - 0.35 * clap;
        v.body.rotation = 0;
      } else if (fuera) {
        // Se soltó: los brazos caen y camina hacia afuera.
        const ph = (x - d.outAt) * 14;
        v.armL.rotation = 0.25 + Math.sin(ph) * 0.3;
        v.armR.rotation = -0.25 + Math.sin(ph) * 0.3;
        v.body.rotation = Math.sin(ph) * 0.05;
        v.legL.y = -Math.max(0, Math.sin(ph)) * 0.05;
        v.legR.y = -Math.max(0, -Math.sin(ph)) * 0.05;
        y -= Math.abs(Math.sin(ph)) * 0.02 * pr.s;
      } else {
        // En la rueda, de la mano: el trote parejo, un pie y el otro sin
        // renguear. Quieto en el corte, a mitad del paso en que lo agarró.
        const lift = 0.04;
        v.legL.y = -Math.max(0, sb) * lift;
        v.legR.y = -Math.max(0, -sb) * lift;
        y -= Math.abs(sb) * 0.03 * pr.s;
        v.body.rotation = 0.06 * sb;
        // Los brazos apuntan a los vecinos: así se ve que van de la mano.
        let aL = 1.15, aR = -1.15;
        const pair = nb.get(d.idx);
        const fo = fakeOut(d, x);
        if (pair && linked && fo < 0.3) {
          const pa = pNow[pair[0]] as { x: number; y: number; s: number }, pb = pNow[pair[1]] as { x: number; y: number; s: number };
          const ta = { x: pa.x, y: pa.y - 0.72 * pa.s }, tb = { x: pb.x, y: pb.y - 0.72 * pb.s };
          const [tl, tr] = pair[0] === pair[1] ? [ta, ta] : ta.x <= tb.x ? [ta, tb] : [tb, ta];
          aL = clamp(Math.atan2(-(tl.x - shL.x), tl.y - shL.y), 0.35, 2.4);
          aR = clamp(Math.atan2(-(tr.x - shR.x), tr.y - shR.y), -2.4, -0.35);
          if (pair[0] === pair[1]) {
            // De las dos manos con la pareja: los dos brazos hacia el otro.
            const toward = Math.atan2(-(ta.x - pr.x), ta.y - (pr.y - 0.75 * pr.s));
            aL = toward + 0.18;
            aR = toward - 0.18;
          }
          // La mano del lado del que se soltó y se va, cae: si no, lo seguía
          // señalando mientras caminaba (en la final, a la rival).
          const suelta = (i: number): number => {
            const o = dancers[i] as Dancer;
            return o.outAt >= 0 ? clamp((x - o.outAt) / 0.25, 0, 1) : 0;
          };
          const [il, ir] = pair[0] === pair[1] || ta.x <= tb.x ? pair : [pair[1], pair[0]];
          aL += (0.3 - aL) * suelta(il);
          aR += (-0.3 - aR) * suelta(ir);
          // Con la rueda chica, cada brazo llega hasta la mitad del camino al
          // vecino, que estira el suyo: sin eso, la cadena hacía de palo.
          const largo = (t: Pt, sh: Pt): number => clamp(Math.hypot(t.x - sh.x, t.y - sh.y) / 2 / (0.3 * pr.s), 1, 2);
          rL = 1 + (largo(tl, shL) - 1) * (1 - suelta(il));
          rR = 1 + (largo(tr, shR) - 1) * (1 - suelta(ir));
          aL += 0.1 * sb;
          aR += 0.1 * sb;
        } else if (fo >= 0.3) {
          // Se soltó antes de tiempo: los brazos caen, con vergüenza.
          aL = 0.3;
          aR = -0.3;
        }
        if (w.rows > 0) {
          // En las filas del arranque: ellas con las manos en la cintura y
          // la cintura que se zarandea; ellos dan palmadas adelante, con los
          // brazos en V que se juntan justo en el medio en cada tiempo. Con
          // más ángulo las manos se pasaban y se leía como brazos cruzados
          // (lo vio el agente evaluador); arriba de la cabeza no se veían.
          const ritmo = Math.sin(Math.PI * beat);
          const junta = 0.15 + 0.24 * Math.abs(ritmo);
          const fL = d.tipoy ? 0.55 : -junta;
          const fR = d.tipoy ? -0.55 : junta;
          aL = fL + (aL - fL) * (1 - w.rows);
          aR = fR + (aR - fR) * (1 - w.rows);
          rL = 1 + (rL - 1) * (1 - w.rows);
          rR = 1 + (rR - 1) * (1 - w.rows);
          if (d.tipoy) v.body.rotation += 0.1 * ritmo * w.rows;
          else if (w.rows > 0.5) v.armL.zIndex = v.armR.zIndex = 2;
        }
        v.armL.rotation = aL;
        v.armR.rotation = aR;
      }
      if (wob > 0) {
        const ph = (x - stopAt) * Math.PI * 2 * 3 + hash(d.idx, 53) * 6;
        v.body.rotation += Math.sin(ph) * wob;
        v.armL.rotation += Math.sin(ph * 1.3) * wob * 3.2;
        v.armR.rotation -= Math.sin(ph * 1.1 + 1) * wob * 3.2;
      }
      reach(v.armL, rL);
      reach(v.armR, rR);
      v.root.position.set(pr.x, y);
      // Dónde quedaron las manos, para la cadena.
      // El hombro gira con el cuerpo alrededor de la cadera: si no, en el
      // tambaleo fuerte la cadena quedaba flotando lejos de las manos.
      const rb = v.body.rotation, hipX = pr.x, hipY = y + v.body.y * pr.s;
      const hand = (sx: number, rot: number, lr: number): Pt => {
        const ox = sx * pr.s, oy = -0.31 * pr.s;
        const shx = hipX + ox * Math.cos(rb) - oy * Math.sin(rb), shy = hipY + ox * Math.sin(rb) + oy * Math.cos(rb);
        const a = rb + rot;
        return { x: shx - Math.sin(a) * 0.3 * lr * pr.s, y: shy + Math.cos(a) * 0.3 * lr * pr.s };
      };
      handsNow[d.idx] = { L: hand(-0.11, v.armL.rotation, rL), R: hand(0.11, v.armR.rotation, rR) };
    }
  }

  /** Cuánto llega el brazo: estira el brazo y corre la mano hasta la punta. */
  function reach(a: Container, s: number): void {
    (a.children[0] as Graphics).scale.y = s;
    (a.children[1] as Graphics).y = 0.29 * s;
  }

  /** Las manos: de la mano de cada uno a la del vecino, mientras siguen en la rueda. */
  function drawChain(x: number): void {
    chain.clear();
    if (x >= T_CROWN || x < T_JOIN + JOIN * 0.7) return;
    const ei = epochAt(x);
    const ep = epochs[ei] as Epoch;
    // Mientras la rueda se cierra, la distancia de antes: con la de la rueda
    // nueva, la cadena cruzaba el hueco como un palo.
    const cerrando = ei > 0 && x - ep.at < CLOSE;
    const prevEp = cerrando ? (epochs[ei - 1] as Epoch) : ep;
    const maxGap = G.rx * Math.min(ep.gap, prevEp.gap) * 1.9 + G.dh;
    const nbPrev = cerrando ? nbrs[ei - 1] : undefined;
    for (const ring of ep.rings) {
      const m = ring.length;
      if (m < 2) continue;
      for (let j = 0; j < m; j++) {
        if (m === 2 && j === 1) break;
        const ia = ring[j] as number, ib = ring[(j + 1) % m] as number;
        const da = dancers[ia] as Dancer, db = dancers[ib] as Dancer;
        if (!inRingNow(da, x) || !inRingNow(db, x)) continue;
        // El que se soltó en el corte falso, suelto.
        if (fakeOut(da, x) >= 0.3 || fakeOut(db, x) >= 0.3) continue;
        const pa = pNow[ia] as { x: number; y: number; s: number }, pb = pNow[ib] as { x: number; y: number; s: number };
        if (m > 3 && Math.hypot(pa.x - pb.x, (pa.y - pb.y) / (G.ry / G.rx)) > maxGap) continue;
        // La mano de cada uno que queda más cerca del otro.
        const ha = handsNow[ia] as { L: Pt; R: Pt }, hb = handsNow[ib] as { L: Pt; R: Pt };
        const near = (h: { L: Pt; R: Pt }, to: Pt): Pt => (Math.hypot(h.L.x - to.x, h.L.y - to.y) <= Math.hypot(h.R.x - to.x, h.R.y - to.y) ? h.L : h.R);
        const a = near(ha, { x: pb.x, y: pb.y - 0.7 * pb.s }), b = near(hb, { x: pa.x, y: pa.y - 0.7 * pa.s });
        // Mientras la rueda se cierra, siguen de la mano los que ya lo estaban;
        // los vecinos nuevos se toman cuando las manos se alcanzan, no por
        // encima del hueco del que salió (lo vio el agente evaluador).
        if (cerrando && !nbPrev?.get(ia)?.includes(ib) && Math.hypot(a.x - b.x, a.y - b.y) > 0.5 * Math.min(pa.s, pb.s)) continue;
        const wdt = 0.05 * Math.min(pa.s, pb.s);
        chain.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: wdt + 2 * G.k, color: INK, cap: "round" });
        chain.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: wdt, color: 0xc68a5c, cap: "round" });
      }
    }
  }

  /** El conjunto: toca con la música, y se congela con el corte. El cajero levanta los palillos. */
  function drawBand(x: number, now: number): void {
    const playing = (dancingAt(x) && x < T_CROWN) || x >= T_CROWN;
    const beat = x >= T_CROWN ? x * 3.4 : beatAt(x);
    const sb = Math.sin(Math.PI * beat);
    const { flute, sticks, drum, mallet, bodies } = band;
    bodies.forEach((b, i) => {
      b.y = playing ? -Math.abs(Math.sin(Math.PI * beat + i)) * 0.02 : 0;
      b.rotation = playing ? Math.sin(Math.PI * beat + i * 1.7) * 0.03 : 0;
    });
    // El pífano, derecho hacia adelante desde la boca.
    const fy = playing ? sb * 0.008 : 0;
    flute.clear().moveTo(-0.38, -0.84 + fy).lineTo(-0.27, -0.55 + fy).stroke({ width: 0.03, color: 0xd9b26a })
      .moveTo(-0.38, -0.84 + fy).lineTo(-0.27, -0.55 + fy).stroke({ width: 0.012, color: INK, alpha: 0.6 })
      .circle(-0.33, -0.7 + fy, 0.022).fill(0xc68a5c).circle(-0.3, -0.62 + fy, 0.022).fill(0xc68a5c);
    // La caja colgada al costado, y los palillos: repiquetean, o arriba en el corte.
    const cx0 = -0.06, cy0 = -0.5;
    sticks.clear()
      .roundRect(cx0 - 0.1, cy0 - 0.05, 0.2, 0.12, 0.02).fill(0xf0e6d2).stroke({ width: 0.014, color: INK })
      .rect(cx0 - 0.1, cy0 - 0.05, 0.2, 0.025).fill(0xd7263d).rect(cx0 - 0.1, cy0 + 0.045, 0.2, 0.025).fill(0xd7263d);
    const hit = playing ? Math.abs(Math.sin(Math.PI * beat * 2)) : 0;
    const stick = (hx: number, side: number): void => {
      if (playing) {
        const tipY = cy0 - 0.06 - 0.1 * (side > 0 ? hit : 1 - hit);
        sticks.moveTo(hx, -0.6).lineTo(cx0 + side * 0.04, tipY).stroke({ width: 0.018, color: 0x5a3a22, cap: "round" });
      } else sticks.moveTo(hx, -0.62).lineTo(hx + side * 0.05, -0.98).stroke({ width: 0.018, color: 0x5a3a22, cap: "round" });
    };
    stick(-0.1, -1);
    stick(0.1, 1);
    // El bombo, que da un destello con cada golpe.
    const hitF = playing ? Math.max(0, Math.cos(Math.PI * beat)) : 0;
    drum.clear()
      .roundRect(0.26, -0.56, 0.3, 0.26, 0.04).fill(0xb5532f).stroke({ width: 0.014, color: INK })
      .ellipse(0.41, -0.56, 0.15, 0.045).fill(hitF > 0.85 ? 0xfff4d6 : CREAM).stroke({ width: 0.014, color: INK });
    mallet.rotation = playing ? -0.4 + Math.max(0, Math.cos(Math.PI * beat)) * 0.7 : -0.2;
    // Las notas que suben mientras suena; con el corte no hay ninguna.
    notes.clear();
    if (!playing) return;
    const { cx, cy, ry, dh, k } = G;
    for (let i = 0; i < 5; i++) {
      const f = (now * 0.55 + i / 5) % 1;
      const nx = cx + (hash(i, 91) - 0.5) * dh * 1.4 + Math.sin(now * 2 + i) * 6 * k;
      const ny = cy - ry * 1.3 - dh * 1.05 - f * dh * 1.1;
      const a = Math.sin(f * Math.PI) * 0.9;
      const r = 5 * k * clamp(dh / 110, 0.5, 1);
      notes.ellipse(nx, ny, r * 1.25, r * 0.9).fill({ color: S.dark ? CREAM : INK, alpha: a })
        .moveTo(nx + r * 1.1, ny).lineTo(nx + r * 1.1, ny - r * 3.6).lineTo(nx + r * 2.6, ny - r * 2.6).stroke({ width: 1.8 * k, color: S.dark ? CREAM : INK, alpha: a });
    }
  }

  /* ---------------------------------------------------------------- cámara */
  /** El acercamiento que deja la rueda entera en pantalla. */
  function fitFor(rho: number): number {
    const { W, rx, ry, dh, avail, portrait } = G;
    const zx = (0.86 * W) / (2 * rho * rx + dh);
    const zy = (0.82 * avail) / (2 * rho * ry + 1.4 * dh);
    // Con bailarines chicos (mucha gente) se puede acercar más; en el
    // celular, si la rueda no entra, alejarse un poco.
    const max = clamp((avail * 0.28) / dh, 1.6, 3);
    return clamp(Math.min(zx, zy), portrait ? 0.85 : 1, max);
  }
  /** Adónde mira la cámara en ese momento del juego, sin moverla. */
  function camTarget(x: number): { tx: number; ty: number; z: number; rate: number } {
    const { W, H, cx, cy, ry, dh, avail } = G;
    const ep = epochs[epochAt(x)] as Epoch;
    let tx = cx, ty: number, z: number, rate = 2;
    const ringY = cy - dh * 0.5;
    if (x >= T_CROWN) {
      z = clamp((avail * 0.36) / dh, 1.4, 5);
      // Más abajo que antes: el cartel le tapaba las manos y el sombrero.
      ty = cy - dh * 1.05;
      rate = 2.2;
      // Con la rival aplaudiendo a la vista.
      if (finalDuo) z = Math.min(z, keepRival(x, tx, ty));
    } else if (finalDuo && x >= F0) {
      // La pareja final, grande aunque haya sido una sala de doscientos. En la
      // última vuelta la cámara se va acercando, hasta el corte.
      z = clamp((avail * (x >= FW0 ? 0.5 : 0.42 + 0.08 * clamp((x - FD0) / (FS0 - FD0), 0, 1))) / dh, 1.5, 6.5);
      // Entera a lo ancho: en el celular el alto daba un acercamiento que la cortaba.
      z = Math.min(z, (0.88 * W) / (2.2 * pairRho() * G.rx + 1.1 * dh));
      ty = cy - dh * 0.6;
      rate = 2.4;
      // Cuando la rival se suelta, la cámara se abre para no perderla.
      if (x >= FX0) z = Math.min(z, keepRival(x, tx, ty));
    } else if (x < T_JOIN + JOIN) {
      // Las filas del arranque, enteras. Con dos o tres, encima de ellos.
      z = fitFor(rowsRho);
      ty = H / 2 + (ringY - H / 2) * clamp((z - 1) / 0.3, 0, 1);
      rate = 3;
    } else {
      z = fitFor(ep.rhoOut);
      ty = H / 2 + (ringY - H / 2) * clamp((z - 1) / 0.3, 0, 1);
      // En el corte, si salen uno o dos, la cámara va hacia ellos.
      const e = evs.find((v) => v.kind === "stop" && x >= v.w0 && x < v.s1);
      if (e && e.victims.length <= 2) {
        let sx = 0, sy = 0;
        for (const v of e.victims) {
          const p = project(where(dancers[v] as Dancer, Math.min(x, e.x0)).p);
          sx += p.x;
          sy += p.y - dh * 0.6;
        }
        const m = e.victims.length;
        z = Math.min(fitFor(0.12), z * 1.12);
        tx = cx + (sx / m - cx) * 0.4;
        ty = ringY + (sy / m - ringY) * 0.35;
        rate = 3;
      }
      // Que el conjunto no quede debajo de la barra de arriba, si la rueda entra igual.
      const bandTop = cy - ry * 1.3 - dh * 0.95;
      // En el celular, también debajo del contador: tapaba al del pífano.
      const maxTy = bandTop + (H / 2 - (S.top() + (G.portrait ? 58 * G.k : 6))) / z;
      const ringBottom = cy + ep.rhoOut * ry + dh * 0.15;
      const minTy = ringBottom - (H / 2 - S.bottom() - 6) / z;
      ty = Math.max(Math.min(ty, maxTy), minTy);
    }
    return { tx, ty, z, rate };
  }
  function direct(x: number): void {
    const t = camTarget(x);
    cam.lookAt(t.tx, t.ty, t.z, t.rate);
  }
  /** El acercamiento más grande que deja a la rival de la final en cuadro, sentada o yéndose. */
  function keepRival(x: number, tx: number, ty: number): number {
    const rv = project(where(dancers[rivalIdx] as Dancer, x).p);
    // Con el cuerpo entero adentro: contando solo los pies quedaba cortada contra el borde.
    const zx = (0.4 * G.W) / Math.max(1, Math.abs(rv.x - tx) + 0.35 * rv.s);
    const zy = (0.4 * G.avail) / Math.max(1, Math.abs(rv.y - rv.s * 0.6 - ty));
    return Math.max(1, Math.min(zx, zy));
  }

  /* -------------------------------------------------------------- interfaz */
  type Rect = { x: number; y: number; w: number; h: number };
  function placeChip(d: Dancer, x: number, placed: Rect[], scale = 1): void {
    const { W, H, k } = G;
    if (!(wNow[d.idx] as ReturnType<typeof where>).alpha) return;
    const p = pNow[d.idx] as { x: number; y: number; s: number };
    // En las filas del arranque, los hombres de adelante llevan el nombre a
    // los pies: arriba tapaba el ruedo de color de las mujeres de atrás.
    const abajo = !d.tipoy && d.row.v >= frontV - 1e-6 && (wNow[d.idx] as ReturnType<typeof where>).rows > 0.5;
    const head = abajo ? cam.toScreen(p.x, p.y + p.s * 0.05, W, H) : cam.toScreen(p.x, p.y - p.s * 1.08, W, H);
    // Si su dueño quedó fuera de cuadro (los que se van, con la cámara cerca),
    // el nombre no va: pegado al borde de la pantalla engañaba.
    if (head.x < -10 * k || head.x > W + 10 * k || head.y < S.top() - 30 * k || head.y > H - S.bottom() + 40 * k) return;
    // Al que se tambalea, el nombre un poco más arriba: si no, el "¡!" lo pinchaba.
    const alto = wobbleOf(d, x) > 0.05 ? 1.54 : 1.22;
    const s = abajo ? head : cam.toScreen(p.x, p.y - p.s * alto, W, H);
    const chip = (d.chip ??= chips.addChild(S.chip(nm(d.idx), G.portrait ? 0.9 : 1)));
    chip.scale.set(scale);
    chip.visible = true;
    const cw = chip.width, ch = 24 * k * scale;
    const lo = S.top() + 14 * k, hi = H - S.bottom() - 16 * k;
    const hits = (cx: number, cy: number): boolean =>
      placed.some((r) => cx < r.x + r.w && cx + cw > r.x && cy - ch / 2 < r.y + r.h / 2 && cy + ch / 2 > r.y - r.h / 2);
    // Primero encima de la cabeza, después a los costados, y recién después apilado.
    const x0 = clamp(s.x - cw / 2, 8 * k, W - cw - 8 * k);
    const y0 = clamp(abajo ? s.y + ch / 2 + 2 * k : s.y - 14 * k, lo, hi);
    const otra = abajo ? ch + 2 * k : -(ch + 2 * k);
    const cands: [number, number][] = [[x0, y0], [x0 - cw * 0.62, y0], [x0 + cw * 0.62, y0], [x0, y0 + otra], [x0 - cw * 0.62, y0 + otra], [x0 + cw * 0.62, y0 + otra]];
    let cx = x0, cy = y0;
    const libre = cands.map(([a, b]) => [clamp(a, 8 * k, W - cw - 8 * k), clamp(b, lo, hi)] as [number, number]).find(([a, b]) => !hits(a, b));
    if (libre) [cx, cy] = libre;
    else {
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.find((r) => cx < r.x + r.w && cx + cw > r.x && cy - ch / 2 < r.y + r.h / 2 && cy + ch / 2 > r.y - r.h / 2);
        if (!hit) break;
        cy = hit.y - (hit.h + ch) / 2 - 2 * k;
        if (cy < lo) {
          cy = hit.y + (hit.h + ch) / 2 + 2 * k;
          cx = clamp(cx + cw * 0.35, 8 * k, W - cw - 8 * k);
        }
      }
    }
    placed.push({ x: cx, y: cy, w: cw, h: ch });
    chip.position.set(cx, cy);
    // Si quedó lejos de su dueño, un hilo hasta la cabeza.
    const ax = clamp(head.x, cx + 6 * k, cx + cw - 6 * k);
    const ay = abajo ? cy - ch / 2 : cy + ch / 2;
    if (Math.hypot(ax - head.x, ay - head.y) > 22 * k) {
      leaders.moveTo(ax, ay).lineTo(head.x, head.y).stroke({ width: 2 * k, color: S.dark ? CREAM : INK, alpha: 0.7 });
      leaders.circle(head.x, head.y, 2.6 * k).fill({ color: S.dark ? CREAM : INK, alpha: 0.8 });
    }
  }

  /** La lista de los que salen, cuando son muchos para ponerles el nombre encima. */
  function buildPanel(e: Ev): void {
    panel.removeChildren().forEach((c) => c.destroy({ children: true }));
    const { W, k, portrait } = G;
    const v = e.victims;
    const MAX = 24;
    const shown = v.length > MAX ? v.slice(0, MAX - 1) : v;
    const extra = v.length - shown.length;
    const cells = shown.map((i) => ({ i, label: shorten(nm(i), 18) }));
    if (extra > 0) cells.push({ i: -1, label: `+${extra}` });
    const rowsMax = 12;
    const rowH = 19 * k;
    const colW = Math.min(196 * k, (W - 40 * k) / 2);
    const makePlate = (part: typeof cells): Container => {
      const c = new Container();
      const head = S.text(`${t("cChoOutT")} · ${v.length}`, { fontFamily: MONO, fontSize: 13 * k, fontWeight: "900", fill: INK, letterSpacing: 2 * k });
      const top = 30 * k;
      const h = top + part.length * rowH + 8 * k;
      c.addChild(new Graphics().roundRect(5 * k, 5 * k, colW, h, 8 * k).fill(INK)
        .roundRect(0, 0, colW, h, 8 * k).fill(S.dark ? CREAM : 0xffffff).stroke({ width: 3 * k, color: INK }));
      head.position.set(12 * k, 8 * k);
      c.addChild(head);
      part.forEach((cell, r) => {
        const y = top + r * rowH;
        const star = cell.i >= 0 && prized.has(cell.i);
        if (cell.i >= 0) c.addChild(new Graphics().circle(18 * k, y + rowH / 2, 5.5 * k).fill((dancers[cell.i] as Dancer).col).stroke({ width: 1.5 * k, color: INK }));
        if (star) c.addChild(new Graphics().star(colW - 18 * k, y + rowH / 2, 5, 7 * k, 3.2 * k).fill(YELLOW).stroke({ width: 1.5 * k, color: INK }));
        const tx = S.text(cell.label, { fontSize: 13.5 * k, fontWeight: "800", fill: INK });
        tx.position.set(30 * k, y + 1 * k);
        const maxW = colW - (star ? 64 : 42) * k;
        if (tx.width > maxW) tx.scale.set(maxW / tx.width);
        c.addChild(tx);
      });
      return c;
    };
    const left = cells.slice(0, rowsMax), right = cells.slice(rowsMax);
    const a = makePlate(left);
    panel.addChild(a);
    const y0 = S.top() + (portrait ? 58 : 62) * k;
    a.position.set(right.length || !portrait ? 14 * k : (W - colW) / 2, y0);
    if (right.length) {
      const b = makePlate(right);
      b.position.set(W - colW - 19 * k, y0);
      panel.addChild(b);
    }
  }

  /**
   * Pasar lista: mientras se baila, los nombres de a tandas de ocho
   * repartidas por la rueda, cada tanda un rato largo, para que cada uno sepa
   * cuál es el suyo también a mitad del juego. Con seis o menos, todos.
   */
  function rollCall(x: number, live: Dancer[], placed: Rect[]): void {
    if (live.length > 64 || x < 0.3) return;
    if (live.length <= 6) {
      // Con cuatro o menos, más grandes: a 12 px no se leían desde el fondo.
      const s = live.length <= 4 ? (G.portrait ? 1.2 : 1.4) : 1;
      for (const d of live) placeChip(d, x, placed, s);
      return;
    }
    const ring = order.filter((i) => live.some((d) => d.idx === i));
    const B = Math.ceil(ring.length / 8);
    const b = Math.floor((x - 0.3) / TANDA) % B;
    ring.forEach((idx, j) => {
      if (j % B === b) placeChip(dancers[idx] as Dancer, x, placed);
    });
  }

  function drawHud(x: number): void {
    const { W, H, k } = G;
    // El corte se ve aunque no se oiga: un fogonazo, la escena un poco más oscura y el cartel.
    const held = !dancingAt(x) && x >= T_INTRO && x < T_CROWN;
    tint.clear();
    if (held) tint.rect(0, 0, W, H).fill({ color: 0x0b0820, alpha: 0.16 });
    const sinceStop = x - stopAt;
    if (sinceStop >= 0 && sinceStop < 0.14) tint.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: 0.22 * (1 - sinceStop / 0.14) });
    big.visible = false;
    if (held && sinceStop < 1.1) {
      // El cartel va donde no tapa a nadie ni a la interfaz, y si no entra,
      // más chico. El lugar se decide una vez, en el cuadro del corte:
      // decidido en cada cuadro, aparecía tarde y saltaba de lugar cuando los
      // que salían se iban (lo vio el agente evaluador). Si no entra en ningún
      // lado, no sale: el subtítulo y el aviso rojo dicen lo mismo.
      if (bigFor !== stopAt) {
        bigFor = stopAt;
        bigS = 0;
        // Dos listas de obstáculos: con el lugar de los nombres de este corte,
        // y sin él, para cuando con todo no entra en ningún lado.
        const obst: Rect[] = [];
        const base: Rect[] = [];
        const caja = (b: { x: number; y: number; width: number; height: number }): void => {
          const r = { x: b.x, y: b.y, w: b.width, h: b.height };
          obst.push(r);
          base.push(r);
        };
        // La cámara todavía se mueve después del corte: cuando empiezan a
        // tambalearse se acerca a los que salen, y en la final se acerca más.
        // Se cuenta adónde va a mirar entonces, no solo adónde mira ahora: si
        // no, un nombre que subía con el acercamiento quedaba arriba del
        // cartel con su hilo cruzándolo (lo vio el agente evaluador).
        const c = cam.snapshot();
        const evCorte = evs.find((e) => e.s0 === stopAt);
        const tFut = evCorte ? evCorte.w0 + 0.05 : finalDuo && stopAt === FS0 ? FW0 + 0.05 : x;
        const fut = camTarget(Math.max(x, tFut));
        const a0 = { x: c.x, y: c.y, z: c.zoom }, a1 = { x: fut.tx, y: fut.ty, z: fut.z };
        const poses = [a0, { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2, z: (a0.z + a1.z) / 2 }, a1, { x: c.tx, y: c.ty, z: c.tz }];
        /**
         * Un rectángulo del mundo en cada pose de la cámara. `nombre` es hasta
         * dónde sube con el nombre encima (en el mundo) y `arriba`, lo que mide
         * el nombre en píxeles: eso va solo a la lista completa.
         */
        const enMundo = (x0: number, y0: number, x1: number, y1: number, nombre = y0, arriba = 0): void => {
          for (const q of poses) {
            const r = { x: W / 2 + (x0 - q.x) * q.z, y: H / 2 + (y0 - q.y) * q.z, w: (x1 - x0) * q.z, h: (y1 - y0) * q.z };
            base.push(r);
            obst.push(nombre === y0 && !arriba ? r : { x: r.x, y: H / 2 + (nombre - q.y) * q.z - arriba, w: r.w, h: (y1 - nombre) * q.z + arriba });
          }
        };
        // Los que van a llevar el nombre encima en este corte: el lugar del
        // nombre también cuenta. Si no, el cartel quedaba entre los nombres y
        // las cabezas, con los hilos cruzándolo.
        const evNow = evs.find((e) => e.s0 === stopAt);
        const conNombre = new Map<number, number>();
        if (finalDuo && x >= F0) for (const i of [winnerIdx, rivalIdx]) conNombre.set(i, G.portrait ? 1.5 : 2);
        else if (evNow) {
          if (evNow.victims.length <= 5) for (const v of evNow.victims) conNombre.set(v, 1.1);
          for (const h of evNow.holders) conNombre.set(h, 1);
        }
        for (const d of dancers) {
          // Los de la rueda, y también los sentados al borde: al probar los
          // costados, el cartel les caía encima.
          if (!((wNow[d.idx] as ReturnType<typeof where>).alpha > 0.02)) continue;
          const p = pNow[d.idx] as { x: number; y: number; s: number };
          const sc = inRingNow(d, x) ? conNombre.get(d.idx) : undefined;
          // Los que van a tambalearse llevan el nombre más arriba (por el "¡!").
          enMundo(p.x - 0.3 * p.s, p.y - 1.2 * p.s, p.x + 0.3 * p.s, p.y, p.y - (sc ? 1.56 : 1.2) * p.s, sc ? (24 * sc + 16) * k : 0);
        }
        // El conjunto (el cajero con los palillos arriba es una señal del corte),
        // el contador, el aviso y, si este corte la tiene, la lista de los que salen.
        const lb = band.root.getLocalBounds(), bs = band.root.scale.x, bp = band.root.position;
        enMundo(bp.x + lb.minX * bs, bp.y + lb.minY * bs, bp.x + lb.maxX * bs, bp.y + lb.maxY * bs);
        caja(counterRoot.getBounds());
        caja({ x: W - 46 * k - 30 * k, y: S.top() + 8 * k, width: 64 * k, height: 64 * k });
        if (evNow && evNow.kind === "stop" && evNow.victims.length > 5) {
          buildPanel(evNow);
          panelFor = evs.indexOf(evNow);
          for (const c of panel.children) caja(c.getBounds());
        }
        const bw0 = big.width / big.scale.x, bh0 = big.height / big.scale.y;
        const fitW = Math.min(1, (W * 0.8) / Math.max(1, bw0));
        // El lugar libre más cercano al medio de la rueda, tal como va a quedar
        // la cámara: se recorre la pantalla de arriba abajo, en el medio y a los
        // costados. Con lugares fijos casi nunca había uno libre con la cámara
        // cerca; con la columna del medio sola, con nueve en la rueda los de
        // atrás y los de adelante se pisaban en alto y el cartel no salía (lo
        // vio el agente evaluador). En el celular, debajo del contador y del aviso.
        const q1 = poses[2] as { x: number; y: number; z: number };
        const cx0 = W / 2 + (G.cx - q1.x) * q1.z, centro = H / 2 + (G.cy - G.dh * 0.35 - q1.y) * q1.z;
        const lo = G.portrait ? S.top() + 74 * k : S.top() + 12 * k, hi = H - S.bottom() - 12 * k;
        const libre = (bx: number, cy: number, tw: number, th: number, en: Rect[] = obst): boolean =>
          !en.some((r) => r.x < bx + tw / 2 && r.x + r.w > bx - tw / 2 && r.y < cy + th / 2 && r.y + r.h > cy - th / 2);
        // Gana el más cercano al medio, pero achicarse cuesta: más chico en el
        // hueco de la rueda le gana a grande en una esquina, sobre las casas.
        const buscar = (lista: Rect[]): { x: number; y: number; sc: number; costo: number } | null => {
          let mejor: { x: number; y: number; sc: number; costo: number } | null = null;
          for (const sc of [1, 0.75, 0.55]) {
            const tw = bw0 * fitW * sc, th = bh0 * fitW * sc;
            for (const f of [0, -0.12, 0.12, -0.22, 0.22, -0.32, 0.32]) {
              const bx = W / 2 + f * W;
              if (bx - tw / 2 < 8 * k || bx + tw / 2 > W - 8 * k) continue;
              // Solo los obstáculos de esta columna: con doscientos son muchos.
              const col = lista.filter((r) => r.x < bx + tw / 2 && r.x + r.w > bx - tw / 2);
              for (let cy = lo + th / 2; cy <= hi - th / 2; cy += 3 * k) {
                const costo = Math.hypot(bx - cx0, cy - centro) + (1 - sc) * 0.9 * H;
                if ((!mejor || costo < mejor.costo) && libre(bx, cy, tw, th, col)) mejor = { x: bx, y: cy, sc, costo };
              }
            }
          }
          return mejor;
        };
        // Si con el lugar de los nombres no entra, entra igual sin él: un
        // nombre que se corre es menos grave que un corte sin cartel.
        const conTodo = buscar(obst);
        const mejor = conTodo ?? buscar(base);
        const usada = conTodo ? obst : base;
        if (mejor) {
          const m = mejor;
          const tw = bw0 * fitW * m.sc, th = bh0 * fitW * m.sc;
          bigX = m.x;
          bigY = m.y;
          bigS = fitW * m.sc;
          // El salto del principio, solo hasta donde no se sale de la
          // pantalla ni pisa a nadie: en el celular cortaba el "¡" y el "!".
          bigPop = [0.35, 0.2, 0.1].find((pp) => m.x - (tw * (1 + pp)) / 2 >= 4 * k && m.x + (tw * (1 + pp)) / 2 <= W - 4 * k && libre(m.x, m.y, tw * (1 + pp), th * (1 + pp), usada)) ?? 0;
        }
      }
      if (bigS > 0) {
        const pop = 1 + bigPop * (1 - ease.outBack(clamp(sinceStop / 0.18, 0, 1)));
        big.scale.set(pop * bigS);
        big.visible = true;
        big.alpha = 1 - clamp((sinceStop - 0.85) / 0.25, 0, 1);
        big.position.set(bigX, bigY);
      }
    }
    // El aviso de la música, arriba a la derecha: la nota que salta con el
    // ritmo, o la nota tachada del corte.
    badge.clear();
    const bx = W - 46 * k, by = S.top() + 38 * k, r = 26 * k;
    const on = !held;
    const pulse = on && x < T_CROWN ? Math.max(0, Math.cos(Math.PI * beatAt(x))) : 0;
    badge.circle(bx + 4 * k, by + 4 * k, r).fill(INK)
      .circle(bx, by, r * (1 + 0.06 * pulse)).fill(on ? (S.dark ? 0x2a2440 : 0xffffff) : 0xd7263d).stroke({ width: 3 * k, color: INK });
    const nx = bx - 4 * k, ny = by + 7 * k - pulse * 3 * k;
    const ink = on ? (S.dark ? CREAM : INK) : 0xffffff;
    badge.ellipse(nx, ny, 7 * k, 5.2 * k).fill(ink)
      .moveTo(nx + 6 * k, ny).lineTo(nx + 6 * k, ny - 19 * k).lineTo(nx + 14 * k, ny - 13 * k).stroke({ width: 3 * k, color: ink });
    if (!on) badge.moveTo(bx - 15 * k, by + 15 * k).lineTo(bx + 15 * k, by - 15 * k).stroke({ width: 4 * k, color: 0xffffff, cap: "round" });

    // Los nombres.
    for (const d of dancers) if (d.chip) d.chip.visible = false;
    leaders.clear();
    // El contador y el aviso de la música, reservados: ningún nombre los tapa.
    const cb = counterRoot.getBounds();
    const placed: Rect[] = [
      { x: cb.x, y: cb.y + cb.height / 2, w: cb.width, h: cb.height },
      { x: bx - r - 4 * k, y: by, w: r * 2 + 8 * k, h: r * 2 + 8 * k },
    ];
    // El conjunto tampoco: los palillos levantados del cajero son la señal del corte.
    const bnd = band.root.getBounds();
    placed.push({ x: bnd.x, y: bnd.y + bnd.height / 2, w: bnd.width, h: bnd.height });
    if (big.visible) {
      const bb = big.getBounds();
      placed.push({ x: bb.x, y: bb.y + bb.height / 2, w: bb.width, h: bb.height });
    }
    // En la corona, el cartel del ganador y el papel picado: sin contador ni aviso encima.
    counterRoot.visible = badge.visible = x < T_CROWN;
    const live = dancers.filter((d) => d.outAt < 0 || x < d.outAt);
    // El corte que está pasando: de verdad o falso.
    const si = evs.findIndex((e, i) => x >= e.w0 && x < (e.kind === "stop" ? e.s1 + 0.9 : e.x0 + 0.6) && (evs[i + 1]?.s0 ?? Infinity) > x);
    const ev = si >= 0 ? (evs[si] as Ev) : null;
    let usePanel = false;
    if (x < T_CROWN) {
      if (finalDuo && x >= F0) {
        for (const d of [win, dancers[rivalIdx] as Dancer]) {
          if (d.outAt >= 0 && x >= d.outAt + 0.9) continue;
          placeChip(d, x, placed, G.portrait ? 1.5 : 2);
        }
      } else if (ev && ev.kind === "stop" && ev.victims.length > 5) {
        usePanel = x >= ev.x0 - 0.15;
        if (usePanel && panelFor !== si) {
          buildPanel(ev);
          panelFor = si;
        }
        if (usePanel) for (const c of panel.children) {
          const b = c.getBounds();
          placed.push({ x: b.x, y: b.y + b.height / 2, w: b.width, h: b.height });
        }
        for (const h of ev.holders) if (x < ev.x0 + 0.6 && (story.arc !== "tapada" || h !== winnerIdx)) placeChip(dancers[h] as Dancer, x, placed);
      } else if (ev) {
        // En el corte, solo los que salen (y los que se tambalean): los demás, después.
        for (const v of ev.victims) {
          const d = dancers[v] as Dancer;
          if (x < d.outAt + EXIT + 0.4) placeChip(d, x, placed, 1.1);
        }
        for (const h of ev.holders) if (x < ev.x0 + 0.6 && (story.arc !== "tapada" || h !== winnerIdx)) placeChip(dancers[h] as Dancer, x, placed);
      } else if (!held) {
        rollCall(x, live, placed);
      }
    }
    panel.visible = usePanel;

    counter.text = `${t("cChoLeft")}  ${remainingAt(x)} / ${n}`;
    const bw2 = counter.width + 40 * k, bh2 = 40 * k;
    counter.position.set(bw2 / 2, bh2 / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw2, bh2).fill(INK).rect(0, 0, bw2, bh2).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
  }

  /* ---------------------------------------------------------------- dibujo */
  function draw(now: number): void {
    const { W, H, k, yB, hs, cx } = G;
    // El cielo de la tarde, o el de la noche con estrellas.
    sky.clear().rect(0, 0, W, H).fill(S.dark ? 0x1b1533 : 0xffb36b);
    sky.rect(0, yB - hs * 2.2, W, hs * 2.2).fill({ color: S.dark ? 0x3b2650 : 0xffd08a, alpha: 0.8 });
    if (S.dark) {
      for (let i = 0; i < 36; i++) {
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(now * 1.3 + i));
        sky.circle(hash(i, 1) * W, hash(i, 2) * yB * 0.8, (0.8 + hash(i, 3) * 1.3) * k).fill({ color: 0xffffff, alpha: 0.55 * tw });
      }
    } else sky.circle(W * 0.16, Math.max(S.top() + 30 * k, yB - hs * 1.6), 30 * k).fill({ color: 0xfff2c4, alpha: 0.9 });
    // Los banderines de papel, cruzados sobre la plaza, que se mecen.
    flags.clear();
    for (let s = 0; s < 2; s++) {
      const y0 = yB - hs * (0.95 + s * 0.22), sag = hs * 0.32;
      const x0 = cx - W * 0.9, x1 = cx + W * 0.9;
      const at = (f: number): { x: number; y: number } => ({ x: x0 + (x1 - x0) * f, y: y0 + sag * 4 * f * (1 - f) + Math.sin(tAll * 1.4 + f * 9 + s) * 2 * k });
      const first = at(0);
      flags.moveTo(first.x, first.y);
      for (let i = 1; i <= 40; i++) {
        const p = at(i / 40);
        flags.lineTo(p.x, p.y);
      }
      flags.stroke({ width: 1.5 * k, color: INK, alpha: 0.7 });
      const nF = 34;
      for (let i = 0; i < nF; i++) {
        const p = at((i + 0.5) / nF), q = at((i + 0.95) / nF);
        const fw = Math.abs(q.x - p.x) * 0.9;
        const sway = Math.sin(tAll * 2.2 + i * 1.7 + s) * fw * 0.15;
        flags.poly([p.x - fw / 2, p.y, p.x + fw / 2, p.y, p.x + sway, p.y + fw * 1.1]).fill(FLAGS[(i + s * 3) % FLAGS.length] as number);
        if (S.dark && i % 3 === 0) flags.circle(p.x, p.y + 2 * k, 2.6 * k).fill({ color: YELLOW, alpha: 0.5 + 0.5 * Math.abs(Math.sin(now * 2 + i)) });
      }
    }
    drawBand(tAll, now);
    drawPeople(tAll);
    drawChain(tAll);
    drawHud(tAll);
    if (tAll >= T_CROWN) crownUI.at(tAll - T_CROWN);
  }

  S.run((dt, now) => {
    if (dead) return;
    tAll += dt;
    if (tAll >= T_CROWN) {
      crown();
      tHold += dt * paceFactor();
    } else {
      script();
      sayPending();
    }
    direct(tAll);
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tHold >= WINNER_HOLD) {
      dead = true;
      S.cleanup();
    }
  });
}
