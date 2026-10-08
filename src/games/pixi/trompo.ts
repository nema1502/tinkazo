import { Container, Graphics } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, params, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { enOrden, writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Trompo.
 *
 * El juego de patio de media Latinoamérica: un círculo de tiza en el suelo,
 * cada participante tira su trompo adentro y bailan. Después empiezan los
 * choques, los trompos se sacan del ruedo o se quedan sin cuerda y se caen,
 * hasta que quedan dos en un mano a mano. Gana el último que sigue bailando.
 *
 * Nada de esto decide nada: el orden en que salen está sembrado con la ronda
 * y la ganadora va primera en esa lista, así que nunca la sacan. La rival del
 * director de emoción es la que llega al mano a mano, la que la sala cree que
 * gana. Los arcos se ven así:
 *
 * - **susto**: en el mano a mano el trompo ganador cabecea, casi se cae y se
 *   endereza.
 * - **remontada**: a mitad de los choques le pegan, la mandan contra la tiza y
 *   vuelve.
 * - **duelo**: un choque más en el mano a mano.
 * - **tapada**: baila callada contra el borde y la cámara nunca la busca.
 *
 * **Los choques son de verdad.** Hasta el 29 de septiembre de 2026 el que
 * salía volaba solo, con chispas en la mitad del camino entre dos trompos que a
 * veces ni se tocaban. Ahora cada golpe tiene un trompo que lo da: lo acecha,
 * se echa atrás, embiste, y el golpe pasa cuando los dos se tocan. La física
 * del contacto es la de dos masas con rebote, y el giro desvía el golpe de
 * costado, como pasa con dos trompos de verdad. Encima de eso va lo que hace
 * que un golpe se sienta en una sala: la parada de un instante, el destello, la
 * estrella, la onda en el piso, las chispas que salen de costado, el que sale
 * volando y rebota, el polvo, la estela y, en el último choque del mano a mano,
 * la cámara lenta. `scripts/audit-choques.mjs` comprueba cada toque.
 *
 * Las posiciones viven en el disco unidad del ruedo, así que cambiar el
 * tamaño de la pantalla no cambia la física. El suelo se ve en perspectiva:
 * el ruedo es una elipse.
 */

const DT = 1 / 120;
const T_THROW = 2.2;
const T_FIGHT = 4.6;
const SQUASH = 0.55;
/** El radio de la tiza, en el disco del ruedo. */
const LIM = 0.9;

/*
 * Un golpe, en segundos de juego antes del contacto: el que pega se elige a
 * los 0,8 y acecha, a los 0,34 se echa atrás para tomar impulso y a los 0,24
 * embiste. Si algo se cruza y no llega a tocar en 0,3 s de margen, el golpe se
 * da igual y queda anotado como forzado, para que el auditor lo cuente.
 */
const PLAN = 0.8;
const WIND = 0.34;
const DASH = 0.24;
const GRACE = 0.3;
/** Lo más lento que embiste, en radios del ruedo por segundo. */
const DASH_MIN = 2.4;
/** En el mano a mano los dos se echan atrás a los 0,3 s y embisten a los 0,18. */
const D_WIND = 0.3;
const D_DASH = 0.18;
/** La parada del golpe, el cuadro congelado del animé, en segundos de juego. */
const STOP_KICK = 0.055;
const STOP_CLASH = 0.08;
const STOP_LAST = 0.11;
/** La cámara lenta del último choque: al 30% durante 0,6 s. */
const SLOW = 0.3;
const SLOW_DUR = 0.6;
/** Lo que cabecea el que se quedó sin cuerda antes de acostarse. */
const WOBBLE_T = 0.45;
/** La gravedad del que sale volando, en radios del ruedo por segundo al cuadrado. */
const G = 7;
/** Lo que pesa el que embiste contra uno quieto. */
const M_HIT = 1.6;

type Phase = "throw" | "dance" | "fight" | "duel" | "crown" | "dead";
type OutKind = "kick" | "fall";
/** `kick` lo saca del ruedo, `glance` le pega de refilón y se cae, `spent` se queda sin cuerda solo, `edge` es la remontada. */
type HitKind = "kick" | "glance" | "spent" | "edge";

interface Top {
  idx: number;
  x: number; y: number; vx: number; vy: number;
  ph: number; rate: number; wob: number; wobPh: number; tilt: number;
  land: number; alive: boolean; out: number; kind: OutKind; fallDir: number;
  /** El que sale volando: altura, giro en el aire, piques y cuándo tocó el piso. */
  z: number; vz: number; rot: number; spin: number; bounces: number; groundAt: number;
  /** El último golpe que dio o recibió, en la hora de los efectos, y cuánto se inclina al embestir. */
  hitAt: number; hitPow: number; lean: number;
  /** Cuándo se prendió en blanco: solo en los golpes, no en los roces. */
  flashAt: number;
  /** Las últimas posiciones para la estela, de a tres: x, y, altura. */
  trail: number[];
  gone: boolean;
  /** Si al salir lleva su nombre un rato: así cada uno ve cuándo se va el suyo. */
  tagOut?: boolean;
  view?: Container; glint?: Graphics; marks?: Graphics; flash?: Graphics; chip?: Container; outChip?: Container;
}
interface Hit { at: number; victim: number; kind: HitKind; stop: number; done: boolean }
interface Charge { hit: Hit; hitter: Top; victim: Top; aimX: number; aimY: number }
/** Un golpe para dibujar. `tier`: 0 un roce, 1 un golpe, 2 un golpe con parada, 3 un choque del mano a mano. */
interface Impact { x: number; y: number; at: number; pow: number; nx: number; ny: number; seed: number; tier: 0 | 1 | 2 | 3 }
interface Dust { x: number; y: number; at: number; pow: number; seed: number }
/** Lo que anota cada golpe para `scripts/audit-choques.mjs`. */
interface Choque {
  t: number; tipo: "saca" | "roza" | "borde" | "duelo"; victim: number; hitter: number;
  gap: number; vrel: number; dvV: number; dvH: number; forced: boolean; tier: number; stop: number;
}

function lighten(c: number, f: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number): number => Math.round(v + (255 - v) * f);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

export async function trompoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const n = names.length;
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  S.mark("arco", story.arc);
  const rivalIdx = n >= 2 ? (story.rival === winnerIdx ? (winnerIdx + 1) % n : story.rival % n) : winnerIdx;

  // El orden de salida: la ganadora primera, la rival segunda, el resto sembrado.
  const rest = names.map((_, i) => i).filter((i) => i !== winnerIdx && i !== rivalIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const rank = n >= 2 ? [winnerIdx, rivalIdx, ...rest] : [winnerIdx];
  const fightDur = clamp(2.6 + Math.max(0, n - 2) * 0.32, 2.6, 7.8);
  const T_DUEL = T_FIGHT + fightDur;
  const clashes = story.arc === "duelo" ? [0.7, 1.7, 2.7, 3.7] : [0.8, 1.9, 3.0];
  const duelDur = (clashes.at(-1) as number) + 1.6;
  const T_CROWN = T_DUEL + duelDur;
  const duo = n >= 2 && rivalIdx !== winnerIdx;

  // Los trompos, tirados desde el borde de abajo hacia adentro del ruedo.
  const rn = clamp(Math.sqrt(0.3 / Math.max(2, n)), 0.035, 0.13);
  // Lo más rápido que embiste uno: nunca más de un radio por paso, para que
  // ningún golpe atraviese al otro sin tocarlo.
  const VMAX = Math.min(8, rn * 108);
  const tops: Top[] = names.map((_, i) => {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.72;
    return {
      idx: i, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0,
      ph: rng() * 7, rate: 18 + rng() * 8, wob: 0.03 + rng() * 0.03, wobPh: rng() * 7, tilt: 0,
      land: 0.2 + (i / Math.max(1, n)) * (T_THROW - 0.6), alive: true, out: -1, kind: "fall", fallDir: rng() < 0.5 ? -1 : 1,
      z: 0, vz: 0, rot: 0, spin: 0, bounces: 0, groundAt: -1, hitAt: -9, hitPow: 0, lean: 0, flashAt: -9, trail: [], gone: false,
    };
  });
  const byIdx = new Map(tops.map((q) => [q.idx, q]));
  const win = byIdx.get(winnerIdx) as Top;
  const riv = byIdx.get(rivalIdx) as Top;
  if (story.arc === "tapada") {
    win.x = 0.74;
    win.y = 0.2;
  }

  // Los golpes, sembrados: primero salen muchos, al final de a uno.
  const victims = rank.slice(2).reverse();
  const hits: Hit[] = [];
  const outAt = new Map<number, number>();
  // Lo que la parada y la cámara lenta le suman al juego, para que la duración
  // elegida en el selector se siga cumpliendo.
  let extra = 0;
  let lastBig = -9;
  const T_EDGE = T_FIGHT + fightDur * 0.45;
  const edgeHit = story.arc === "remontada" && duo;
  victims.forEach((v, i) => {
    const f = (i + 1) / (victims.length + 1);
    const at = T_FIGHT + 0.3 + (fightDur - 0.7) * Math.pow(f, 0.8);
    const h = hash(v, 11);
    // Los dos últimos antes del mano a mano salen siempre sacados: es lo que la sala espera ver.
    const kind: HitKind = i >= victims.length - 2 || h < 0.5 ? "kick" : h < 0.8 ? "glance" : "spent";
    // La parada solo cuando quedan pocos y con aire entre una y otra: en la
    // gresca del principio, frenar en cada golpe sería tartamudear.
    let stop = 0;
    if (kind === "kick" && n - i <= 12 && at - lastBig >= 0.5 && !(edgeHit && Math.abs(at - T_EDGE) < 0.5)) {
      stop = STOP_KICK;
      lastBig = at;
      extra += stop;
    }
    hits.push({ at, victim: v, kind, stop, done: false });
    outAt.set(v, at);
  });
  if (edgeHit) {
    hits.push({ at: T_EDGE, victim: winnerIdx, kind: "edge", stop: STOP_KICK, done: false });
    extra += STOP_KICK;
  }
  hits.sort((a, b) => a.at - b.at);
  if (duo) extra += STOP_CLASH * (clashes.length - 1) + STOP_LAST + SLOW_DUR * (1 - SLOW);
  setGameLength(T_CROWN + extra, WINNER_HOLD);

  let phase: Phase = "throw";
  // Dos relojes: el del juego, que se congela en la parada y va lento en la
  // cámara lenta, y el de los efectos, que nunca para. La estrella del golpe
  // tiene que aparecer justo mientras todo lo demás está quieto.
  let tAll = 0, tFx = 0, acc = 0, tHold = 0, landed = 0, saidUpTo = -1, steps = 0;
  let lastTick = -9, lastOutSaid = -9, lastBoom = -9, lastThud = -9, lastSpark = -9, edgeAt = -9;
  let stop = 0, slowUntil = -1, flashAt = -9, flashPow = 0;
  let clashIdx = 0, clashHits = 0;
  let wobbleSaid = false, recoverSaid = false, fewSaid = false, crowned = false;
  /** Las notas del trompo de la rival que se apaga: cuándo suena cada una, en segundos desde que se queda sin cuerda. */
  const APAGA = [0, 0.07, 0.16, 0.27, 0.4];
  let apagado = 0, acostada = false, humTick = -1;
  const impacts: Impact[] = [];
  const dusts: Dust[] = [];
  const hitterOf = new Map<Top, Charge>();
  const victimOf = new Map<Top, Charge>();
  let focus: { x: number; y: number; top: Top | null; until: number; zoom: number } | null = null;
  const alive = (): Top[] => tops.filter((q) => q.alive);

  // El relator con turno: una línea nueva espera si otra recién apareció, y
  // de las que esperan queda la más importante. Los golpes pasan en el
  // contacto, no en el guion, así que un "¡sacaron a fulano!" podía caer un
  // cuadro antes que "¡quedan los mejores!", y la sala leía dos cosas a la vez.
  let sayAt = -9;
  let pending: { msg: string; heat: number } | null = null;
  function say(msg: string, heat = 0): void {
    if (tFx - sayAt >= 0.35) {
      S.say(msg, heat);
      sayAt = tFx;
      pending = null;
    } else if (!pending || heat >= pending.heat) pending = { msg, heat };
  }
  function sayPending(): void {
    if (pending && tFx - sayAt >= 0.35) {
      S.say(pending.msg, pending.heat);
      sayAt = tFx;
      pending = null;
    }
  }

  // `?auditar=choques` deja anotado cada golpe para el auditor de choques.
  const log = params.get("auditar") === "choques"
    ? {
      n, rn, winner: winnerIdx, rival: rivalIdx, arc: story.arc, clashes: clashes.length,
      planned: [...victims, ...(duo ? [rivalIdx] : [])],
      plan: hits.filter((h) => h.kind !== "edge").map((h) => ({ idx: h.victim, at: h.at, kind: h.kind })),
      windows: { wind: WIND, grace: GRACE },
      events: [] as Choque[],
      outs: [] as { idx: number; t: number; tipo: OutKind }[],
      afuera: [] as { idx: number; r: number }[],
      stops: [] as { t: number; dur: number }[],
      maxOverlap: 0, slow: 0, aliveAtCrown: [] as number[], done: false,
    }
    : null;
  if (log) (window as unknown as { __choques: typeof log }).__choques = log;

  /* ---------------------------------------------------------------- sonido */
  /** El golpe en tres capas: el chasquido de la madera, el cuerpo y, si es grande, el retumbe. */
  function boom(pow: number, seed: number, big: boolean): void {
    if (!big && tFx - lastBoom < 0.1) return;
    lastBoom = tFx;
    const v = seed % 3;
    beep(note(14 + v), 0.05, "square", big ? 0.055 : 0.034 + v * 0.004);
    beep(note(big ? (seed % 2) * 2 : 5 + (seed % 2)), big ? 0.24 : 0.12, "sine", big ? 0.085 : 0.042 + 0.006 * pow);
    // El cuerpo del golpe grande, una octava arriba y con armónicos: el seno
    // solo, a 131 y 165 Hz, lo pierde el parlante de un proyector.
    if (big) beep(note(5 + (seed % 2) * 2), 0.18, "triangle", 0.05);
    if (big) setTimeout(() => beep(note(10 + v), 0.18, "triangle", 0.045), 40);
  }
  /** El que se acuesta o pica en el piso. */
  function thud(seed: number): void {
    if (tFx - lastThud < 0.15) return;
    lastThud = tFx;
    beep(note(2 + (seed % 3)), 0.14, "sine", 0.04);
  }
  function puff(x: number, y: number, pow: number, seed: number): void {
    dusts.push({ x, y, at: tFx, pow, seed });
    if (dusts.length > 60) dusts.shift();
  }

  /* ---------------------------------------------------------------- física */
  /** Desde qué lado pega: desde el centro hacia afuera, para que el golpe saque. */
  function aimFor(v: Top, h: Top): { x: number; y: number } {
    const r0 = Math.hypot(v.x, v.y);
    if (r0 > 0.12) return { x: v.x / r0, y: v.y / r0 };
    const dx = v.x - h.x, dy = v.y - h.y, d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  /** El que pega: el más cerca que esté libre y que no esté por salir él mismo. */
  function pickHitter(v: Top): Top | null {
    let best: Top | null = null;
    let bd = Infinity;
    const rv = Math.hypot(v.x, v.y);
    for (const q of tops) {
      if (!q.alive || q === v || tAll < q.land || hitterOf.has(q) || victimOf.has(q)) continue;
      if ((outAt.get(q.idx) ?? Infinity) < tAll + PLAN + 0.4) continue;
      // La ganadora no pega en la tapada (la cámara la buscaría) ni en la remontada (le pegan a ella).
      if (q === win && (story.arc === "tapada" || story.arc === "remontada")) continue;
      // Que venga desde adentro cuenta, y la ganadora pega un poco menos que el resto:
      // si sacara a todos, la sala aprendería a mirarla.
      const score = Math.hypot(q.x - v.x, q.y - v.y) + Math.max(0, Math.hypot(q.x, q.y) - rv) * 0.6 + (q === win ? 0.3 : 0);
      if (score < bd) {
        bd = score;
        best = q;
      }
    }
    return best;
  }

  /** Guía al que pega: acecha, se echa atrás y embiste. */
  function steerHitter(c: Charge, q: Top, dt: number): void {
    const v = c.victim;
    const tHit = c.hit.at;
    const dx = v.x - q.x, dy = v.y - q.y, d = Math.hypot(dx, dy) || 1;
    if (tAll < tHit - WIND) {
      // Acecha: se acomoda del lado de adentro, a unos radios de distancia.
      const hover = Math.max(rn * 4.5, 0.22);
      const ex = v.x - c.aimX * hover - q.x, ey = v.y - c.aimY * hover - q.y, e = Math.hypot(ex, ey);
      const sp = clamp(e * 3, 0, 2.2);
      const k = 1 - Math.exp(-7 * dt);
      q.vx += ((e ? (ex / e) * sp : 0) - q.vx) * k;
      q.vy += ((e ? (ey / e) * sp : 0) - q.vy) * k;
      q.lean *= 1 - k;
      return;
    }
    if (tAll < tHit - DASH) {
      // Se echa atrás, como quien toma impulso.
      const k = 1 - Math.exp(-18 * dt);
      q.vx += (-(dx / d) * 0.6 - q.vx) * k;
      q.vy += (-(dy / d) * 0.6 - q.vy) * k;
      q.lean += (-(dx / d) * 0.28 - q.lean) * k;
      return;
    }
    // Embiste: apunta a un punto ya adentro del contacto, así el toque es
    // seguro, y llega a la hora del golpe o antes. De refilón entra torcido,
    // a unos 30 grados. Nunca embiste despacio: un golpe lento no es un golpe.
    const gl = c.hit.kind === "glance" ? 0.5 : 0;
    const ax = c.aimX * Math.cos(gl) - c.aimY * Math.sin(gl), ay = c.aimY * Math.cos(gl) + c.aimX * Math.sin(gl);
    const ex = v.x - ax * rn * 1.85 - q.x, ey = v.y - ay * rn * 1.85 - q.y;
    const e = Math.hypot(ex, ey) || 1e-6;
    const left = Math.max(DT * 2, tHit - tAll);
    const sp = Math.min(VMAX, Math.max(e / left, DASH_MIN));
    q.vx = (ex / e) * sp + v.vx;
    q.vy = (ey / e) * sp + v.vy;
    q.lean += ((dx / d) * 0.22 - q.lean) * (1 - Math.exp(-20 * dt));
  }

  /** El mano a mano: se miden dando vueltas, se echan atrás y embisten a la hora de cada choque. */
  function steerDuel(q: Top, dt: number): void {
    const o = q === win ? riv : win;
    const mx = (q.x + o.x) / 2, my = (q.y + o.y) / 2;
    let dx = o.x - q.x, dy = o.y - q.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const next = clashIdx < clashes.length ? T_DUEL + (clashes[clashIdx] as number) : Infinity;
    if (tAll >= next - D_WIND && tAll < next - D_DASH) {
      const k = 1 - Math.exp(-16 * dt);
      q.vx += (-dx * 0.7 - q.vx) * k;
      q.vy += (-dy * 0.7 - q.vy) * k;
      q.lean += (-dx * 0.3 - q.lean) * k;
      return;
    }
    if (tAll >= next - D_DASH) {
      const left = Math.max(DT * 2, next - tAll);
      let wx = (mx - dx * rn * 0.95 - q.x) / left, wy = (my - dy * rn * 0.95 - q.y) / left;
      const w = Math.hypot(wx, wy);
      if (w > VMAX) {
        wx *= VMAX / w;
        wy *= VMAX / w;
      }
      q.vx = wx;
      q.vy = wy;
      q.lean += (dx * 0.25 - q.lean) * (1 - Math.exp(-20 * dt));
      return;
    }
    // Se miden: vueltas uno alrededor del otro, y la pareja se corre hacia el centro.
    const want = Math.max(rn * 5, 0.34) / 2;
    const tang = clashIdx >= clashes.length ? 0.25 : 0.6;
    const ux = -dx, uy = -dy;
    const dvx = -uy * tang + ux * (want - d / 2) * 4 - mx * 0.5;
    const dvy = ux * tang + uy * (want - d / 2) * 4 - my * 0.5;
    const k = 1 - Math.exp(-5 * dt);
    q.vx += (dvx - q.vx) * k;
    q.vy += (dvy - q.vy) * k;
    q.lean *= 1 - k;
  }

  /** Lo saca del ruedo. `quiet`: sin relato, para no pisar otra línea del relator. */
  function knockOut(v: Top, kind: OutKind, quiet = false): void {
    if (!v.alive) return;
    v.alive = false;
    v.out = 0;
    v.kind = kind;
    v.groundAt = -1;
    // Si estaba por pegarle a otro, ese golpe queda sin dueño y se vuelve a elegir quién lo da.
    const own = hitterOf.get(v);
    if (own) {
      hitterOf.delete(v);
      victimOf.delete(own.victim);
    }
    log?.outs.push({ idx: v.idx, t: tAll, tipo: kind });
    const left = alive().length;
    // Un co-ganador que sale se nombra siempre, y con su premio: nunca como perdedor.
    const premio = winners.indexOf(v.idx) > 0;
    // Con su nombre encima mientras sale, salvo en la gresca de una sala
    // grande: de 7 a 14 s salían nueve trompos sin que nadie supiera de quién.
    v.tagOut = !quiet && (premio || left <= 40);
    // Los demás se nombran desde que quedan doce (o siempre, en una sala
    // chica), con aire entre uno y otro. El co-ganador, siempre: con más
    // nombres en el relato, el suyo caía pegado a otro y se perdía.
    if (!quiet && (premio || (tAll - lastOutSaid > 1.2 && (left <= 12 || hits.length <= 16)))) {
      lastOutSaid = tAll;
      const nm = names[v.idx] ?? "";
      say(premio ? T[getLang()].cPrizeOut([nm]) : T[getLang()].cTroOut(nm), 0.45 + 0.2 * (1 - left / n) + (premio ? 0.1 : 0));
    }
  }

  /** El golpe guionado, cuando el que pega toca de verdad al otro (o, forzado, cuando se le acabó el margen). */
  function impact(c: Charge, forced: boolean): void {
    const h = c.hitter, v = c.victim, hit = c.hit;
    hitterOf.delete(h);
    victimOf.delete(v);
    hit.done = true;
    let nx = v.x - h.x, ny = v.y - h.y;
    const d = Math.hypot(nx, ny);
    if (d > 1e-6) {
      nx /= d;
      ny /= d;
    } else {
      nx = c.aimX;
      ny = c.aimY;
    }
    const pen = rn * 2 - d;
    if (pen > 0) {
      h.x -= nx * pen * 0.4;
      h.y -= ny * pen * 0.4;
      v.x += nx * pen * 0.6;
      v.y += ny * pen * 0.6;
    }
    // Dos masas con rebote: el que embiste pesa más, así que el otro sale
    // disparado y él sigue un poco, frenado. Si al golpeado lo venía empujando
    // otro, el golpe se suma a lo que ya traía: nunca lo frena.
    const hn = h.vx * nx + h.vy * ny, vn = v.vx * nx + v.vy * ny;
    const vrel = Math.max(0.8, hn - vn);
    const j = ((1 + 0.9) * vrel) / (1 / M_HIT + 1);
    const hb = [h.vx, h.vy] as const, vb = [v.vx, v.vy] as const;
    h.vx -= (nx * j) / M_HIT;
    h.vy -= (ny * j) / M_HIT;
    const lift = Math.max(vn, hn) + j - vn;
    v.vx += nx * lift;
    v.vy += ny * lift;
    const pow = clamp(j / 5, 0.35, 1);
    let tipo: Choque["tipo"] = "saca";
    if (hit.kind === "kick" || hit.kind === "edge") {
      // El giro desvía el golpe hacia afuera, y la fuerza alcanza para llegar a
      // la tiza: cruzarla si lo sacan, rozarla si es la remontada.
      const r0 = Math.hypot(v.x, v.y) || 1;
      let ox = nx + (v.x / r0) * 0.9, oy = ny + (v.y / r0) * 0.9;
      const o = Math.hypot(ox, oy) || 1;
      ox /= o;
      oy /= o;
      const edge = hit.kind === "edge";
      const lim = edge ? 0.97 - rn : LIM;
      const pu = v.x * ox + v.y * oy;
      const s = -pu + Math.sqrt(Math.max(0, pu * pu - (r0 * r0 - lim * lim)));
      // Lo que recorre con el roce del piso: 0,177 por unidad de velocidad
      // afuera, 0,325 adentro, donde el roce es menor.
      const need = edge ? (s + 0.04) / 0.325 : (s + 0.3) / 0.177;
      // Y que salga hacia donde lo empujaron, más rápido de lo que ya iba.
      const along = Math.max(0.1, ox * nx + oy * ny);
      const sp = clamp(Math.max(Math.hypot(v.vx, v.vy), need, (vn + 0.3) / along), 1.2, 12);
      v.vx = ox * sp;
      v.vy = oy * sp;
      if (edge) {
        tipo = "borde";
        edgeAt = tAll;
        say(T[getLang()].cTroEdge(names[winnerIdx] ?? ""), 0.7);
      } else {
        v.vz = 1.2 + pow * 0.9;
        v.spin = (hash(v.idx, 21) < 0.5 ? -1 : 1) * (9 + sp * 1.2);
        v.rot = v.tilt;
        knockOut(v, "kick");
      }
    } else {
      // De refilón: no sale, pero queda cabeceando y se acuesta.
      tipo = "roza";
      const tvx = v.vx - nx * (vn + lift), tvy = v.vy - ny * (vn + lift);
      const keep = vn + lift * 0.6;
      v.vx = nx * keep + tvx * 0.5;
      v.vy = ny * keep + tvy * 0.5;
      knockOut(v, "fall");
    }
    const big = hit.stop > 0;
    h.hitAt = v.hitAt = h.flashAt = v.flashAt = tFx;
    h.hitPow = v.hitPow = pow;
    impacts.push({ x: h.x + nx * rn, y: h.y + ny * rn, at: tFx, pow, nx, ny, seed: (hit.victim * 7 + 3) & 4095, tier: big ? 2 : 1 });
    if (big) {
      stop = Math.max(stop, hit.stop);
      log?.stops.push({ t: tFx, dur: hit.stop });
    }
    boom(pow, hit.victim, big);
    cam.punch(0.02 + 0.04 * pow * (big ? 1.4 : 1)).shake((3 + 7 * pow) * (big ? 1.3 : 1) * S.u());
    // La cámara se mete en los golpes grandes, o en todos cuando quedan pocos,
    // y sigue al que sacan hasta la tiza. En la tapada nunca a la ganadora.
    const hides = story.arc === "tapada" && (v === win || h === win);
    const busy = focus && tFx < focus.until - 0.25;
    if (!hides && !busy && (big || alive().length <= 20 || hit.kind === "edge")) {
      focus = { x: h.x + nx * rn, y: h.y + ny * rn, top: hit.kind === "glance" ? null : v, until: tFx + (hit.kind === "edge" ? 0.7 : 0.5), zoom: big ? 1.6 : 1.4 };
    }
    log?.events.push({
      t: tAll, tipo, victim: v.idx, hitter: h.idx, gap: d / (rn * 2), vrel,
      dvV: (v.vx - vb[0]) * nx + (v.vy - vb[1]) * ny,
      dvH: (h.vx - hb[0]) * nx + (h.vy - hb[1]) * ny,
      forced, tier: big ? 2 : 1, stop: big ? hit.stop : 0,
    });
  }

  /** Un choque del mano a mano, cuando los dos se tocan. */
  function clash(forced: boolean): void {
    const last = clashIdx === clashes.length - 1;
    clashIdx++;
    clashHits++;
    let nx = riv.x - win.x, ny = riv.y - win.y;
    const d = Math.hypot(nx, ny) || 1;
    nx /= d;
    ny /= d;
    const pen = rn * 2 - d;
    if (pen > 0) {
      win.x -= (nx * pen) / 2;
      win.y -= (ny * pen) / 2;
      riv.x += (nx * pen) / 2;
      riv.y += (ny * pen) / 2;
    }
    // Masas iguales y rebote entero, un poco más fuerte para que se vea en la
    // sala, y el giro los manda de costado: después de chocar dan la vuelta.
    const vrel = Math.max(1.2, (win.vx - riv.vx) * nx + (win.vy - riv.vy) * ny);
    const wb = [win.vx, win.vy] as const, rb = [riv.vx, riv.vy] as const;
    const push = vrel * 1.1, s = 0.35 * vrel, tx = -ny, ty = nx;
    win.vx -= nx * push + tx * s;
    win.vy -= ny * push + ty * s;
    riv.vx += nx * push + tx * s;
    riv.vy += ny * push + ty * s;
    const pow = last ? 1 : 0.85;
    win.hitAt = riv.hitAt = win.flashAt = riv.flashAt = tFx;
    win.hitPow = riv.hitPow = pow;
    riv.wob += 0.025;
    impacts.push({ x: win.x + nx * rn, y: win.y + ny * rn, at: tFx, pow, nx, ny, seed: 400 + clashHits * 13, tier: 3 });
    flashAt = tFx;
    flashPow = last ? 0.34 : 0.24;
    const dur = last ? STOP_LAST : STOP_CLASH;
    stop = Math.max(stop, dur);
    log?.stops.push({ t: tFx, dur });
    if (last) {
      // La cámara lenta arranca cuando termina la parada.
      slowUntil = tFx + dur + SLOW_DUR;
      if (log) log.slow = SLOW_DUR;
    }
    boom(pow, 400 + clashHits, true);
    cam.punch(last ? 0.12 : 0.08).shake((last ? 16 : 11) * S.u());
    if (clashHits === 1) say(t("cTroClash"), 0.75);
    log?.events.push({
      t: tAll, tipo: "duelo", victim: riv.idx, hitter: win.idx, gap: d / (rn * 2), vrel,
      dvV: (riv.vx - rb[0]) * nx + (riv.vy - rb[1]) * ny,
      dvH: (win.vx - wb[0]) * nx + (win.vy - wb[1]) * ny,
      forced, tier: 3, stop: dur,
    });
  }

  /** Un roce que no está en el guion: rebote con el giro, y si fue fuerte, chispas y un toque. */
  function touch(p: Top, q: Top, dx: number, dy: number, d: number): void {
    const min = rn * 2;
    const ux = d ? dx / d : 1, uy = d ? dy / d : 0;
    // El que embiste pesa más: se abre paso entre los que se le cruzan.
    const dash = (x: Top): boolean => {
      const c = hitterOf.get(x);
      return !!c && tAll >= c.hit.at - DASH;
    };
    const mp = dash(p) ? 3 : 1, mq = dash(q) ? 3 : 1;
    const pen = min - d;
    p.x -= ux * pen * (mq / (mp + mq));
    p.y -= uy * pen * (mq / (mp + mq));
    q.x += ux * pen * (mp / (mp + mq));
    q.y += uy * pen * (mp / (mp + mq));
    const rel = (q.vx - p.vx) * ux + (q.vy - p.vy) * uy;
    if (rel >= 0) return;
    // Rebote con pérdida, y el roce de dos giros que los desvía de costado.
    const j = (-(1 + 0.75) * rel) / (1 / mp + 1 / mq);
    const tx = -uy, ty = ux, s = 0.22 * -rel;
    p.vx -= (ux * j) / mp + tx * s;
    p.vy -= (uy * j) / mp + ty * s;
    q.vx += (ux * j) / mq + tx * s;
    q.vy += (uy * j) / mq + ty * s;
    // Un roce leve ya suena; las chispas quedan para los fuertes.
    if (-rel > 0.12 && tAll - lastTick > 0.35) {
      lastTick = tAll;
      beep(note(8 + ((p.idx + q.idx) % 4)), 0.045, "triangle", 0.03);
    }
    if (-rel > 0.35 && tFx - lastSpark > 0.05) {
      lastSpark = tFx;
      const pow = clamp(-rel / 2.5, 0.12, 0.6);
      p.hitAt = q.hitAt = tFx;
      p.hitPow = q.hitPow = pow * 0.6;
      impacts.push({ x: p.x + ux * rn, y: p.y + uy * rn, at: tFx, pow, nx: ux, ny: uy, seed: (p.idx * 31 + q.idx) & 4095, tier: 0 });
    }
  }

  /**
   * Los contactos. Tres pasadas por paso, como un solver de física de juego:
   * separar un par empuja a uno contra un tercero, y una sola pasada dejaba
   * trompos encimados hasta un tercio del diámetro en un ruedo lleno. La
   * primera pasada resuelve golpes y rebotes; las otras dos, solo posiciones.
   */
  function collide(list: Top[]): void {
    const min = rn * 2;
    let act = list.filter((q) => tAll >= q.land).sort((a, b) => a.x - b.x || a.idx - b.idx);
    firstPass(act, min);
    // En un ruedo lleno hacen falta más pasadas: 200 trompos chicos se empujan en cadena.
    for (let pass = 0, passes = n > 40 ? 4 : 2; pass < passes; pass++) {
      act = act.filter((q) => q.alive).sort((a, b) => a.x - b.x || a.idx - b.idx);
      for (let i = 0; i < act.length; i++) {
        const p = act[i] as Top;
        for (let j = i + 1; j < act.length; j++) {
          const q = act[j] as Top;
          if (q.x - p.x >= min) break;
          const dx = q.x - p.x, dy = q.y - p.y;
          if (Math.abs(dy) >= min) continue;
          const d = Math.hypot(dx, dy);
          if (d >= min || d === 0) continue;
          const push = (min - d) / 2, ux = dx / d, uy = dy / d;
          p.x -= ux * push;
          p.y -= uy * push;
          q.x += ux * push;
          q.y += uy * push;
        }
      }
    }
    // Para el auditor: cuánto quedan encimados después de separarlos.
    if (log) {
      for (let i = 0; i < act.length; i++) {
        const p = act[i] as Top;
        for (let j = i + 1; j < act.length; j++) {
          const q = act[j] as Top;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < min) log.maxOverlap = Math.max(log.maxOverlap, (min - d) / min);
        }
      }
    }
  }

  function firstPass(act: Top[], min: number): void {
    for (let i = 0; i < act.length; i++) {
      const p = act[i] as Top;
      for (let j = i + 1; j < act.length; j++) {
        const q = act[j] as Top;
        if (q.x - p.x >= min) break;
        if (!p.alive || !q.alive) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        if (Math.abs(dy) >= min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        // ¿Es el golpe del guion? Solo cuenta desde que se echa atrás: antes es un roce.
        const cp = hitterOf.get(p), cq = hitterOf.get(q);
        const c = cp && cp.victim === q ? cp : cq && cq.victim === p ? cq : null;
        if (c && tAll >= c.hit.at - WIND) {
          impact(c, false);
          continue;
        }
        if (duo && phase === "duel" && clashIdx < clashes.length && ((p === win && q === riv) || (p === riv && q === win))
          && tAll >= T_DUEL + (clashes[clashIdx] as number) - D_WIND) {
          clash(false);
          continue;
        }
        touch(p, q, dx, dy, d);
      }
    }
  }

  function step(dt: number): void {
    const list = alive();
    for (const q of list) {
      if (tAll < q.land) continue;
      const c = hitterOf.get(q);
      if (c) steerHitter(c, q, dt);
      else if (duo && phase === "duel" && (q === win || q === riv)) steerDuel(q, dt);
      else {
        // Deambula con un seno propio, y un poco hacia el centro.
        q.vx += (Math.sin(tAll * 1.3 + q.wobPh) * 0.5 - q.x * 0.35) * dt;
        q.vy += (Math.cos(tAll * 1.1 + q.ph) * 0.5 - q.y * 0.35) * dt;
        if (story.arc === "tapada" && q === win && phase !== "duel") {
          q.vx += (0.74 - q.x) * 1.2 * dt;
          q.vy += (0.2 - q.y) * 1.2 * dt;
        }
        // Al que están por golpear se le va la pierna: frena, y el golpe lo agarra quieto.
        const damp = victimOf.has(q) && q !== win ? 0.955 : 0.975;
        q.vx *= damp;
        q.vy *= damp;
        q.lean *= 0.9;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    collide(list);
    // La tiza: nadie sale sin que lo saquen. Rebota solo lo que iba hacia afuera.
    for (const q of list) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x, q.y);
      const lim = (q === win && story.arc === "remontada" ? 0.97 : LIM) - rn;
      if (d > lim) {
        const ux = q.x / d, uy = q.y / d;
        q.x = ux * lim;
        q.y = uy * lim;
        const vr = q.vx * ux + q.vy * uy;
        if (vr > 0) {
          q.vx -= ux * vr * 1.5;
          q.vy -= uy * vr * 1.5;
        }
      }
    }
    // Los que salieron: el sacado vuela, pica y se acuesta; el que se quedó
    // sin cuerda sigue un poco con lo que traía, cabecea y se acuesta.
    for (const q of tops) {
      if (q.alive) continue;
      q.out += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.kind === "kick") {
        const air = q.z > 0 || q.vz > 0;
        const f = air ? 0.994 : 0.955;
        q.vx *= f;
        q.vy *= f;
        q.rot += q.spin * dt;
        q.spin *= air ? 0.995 : 0.9;
        if (air) {
          q.vz -= G * dt;
          q.z += q.vz * dt;
          if (q.z <= 0) {
            q.z = 0;
            if (q.bounces < 2 && q.vz < -0.6) {
              q.vz = -q.vz * 0.38;
              q.bounces++;
              puff(q.x, q.y, 0.6, q.idx * 3 + q.bounces);
              if (q.bounces === 1) thud(q.idx);
            } else {
              // Queda acostado del lado al que venía girando.
              q.vz = 0;
              q.rot = Math.atan2(Math.sin(q.rot), Math.cos(q.rot));
              q.fallDir = q.rot >= 0 ? 1 : -1;
              q.groundAt = q.out;
              puff(q.x, q.y, 0.9, q.idx * 3 + 7);
            }
          }
        }
      } else {
        q.vx *= 0.94;
        q.vy *= 0.94;
        if (q.out >= WOBBLE_T && q.out - dt < WOBBLE_T) {
          puff(q.x, q.y, 0.7, q.idx * 5);
          thud(q.idx);
        }
      }
    }
    // La estela: dos muestras por cuadro de sesenta, las seis últimas.
    if ((steps++ & 1) === 0) {
      for (const q of tops) {
        const flying = !q.alive && q.kind === "kick" && q.groundAt < 0;
        if ((q.alive || flying) && tAll >= q.land && Math.hypot(q.vx, q.vy) > 1.3) {
          q.trail.push(q.x, q.y, q.z);
          if (q.trail.length > 18) q.trail.splice(0, 3);
        } else if (q.trail.length) q.trail.splice(0, 3);
      }
    }
  }

  function crown(): void {
    if (crowned) return;
    crowned = true;
    if (log) log.aliveAtCrown = alive().map((q) => q.idx);
    say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    beep(note(0), 0.7, "sine", 0.09);
    // La octava de arriba, con armónicos: la que reconstruye el grave en un parlante chico.
    beep(note(5), 0.6, "sawtooth", 0.04);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.1).shake(12 * S.u());
  }
  skipFn = (): void => {
    if (phase === "crown" || phase === "dead") return;
    for (const q of tops) if (q !== win && q.alive) {
      q.alive = false;
      q.out = 2;
      q.kind = "fall";
    }
    hitterOf.clear();
    victimOf.clear();
    stop = 0;
    slowUntil = -1;
    tAll = T_CROWN;
    phase = "crown";
    crown();
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.05, () => say(t("cTroThrow"), 0.1)],
      [T_THROW - 0.3, () => say(T[getLang()].cTroCount(n), 0.2)],
      [T_THROW + 1.0, () => say(t("cTroDance"), 0.3)],
      [T_FIGHT, () => say(t(n > 2 ? "cTroFight" : "cTroFeint"), 0.45)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    // Los tiros: cada trompo que cae al ruedo suena y levanta un poco de tierra.
    while (landed < tops.length && tAll >= (tops[landed] as Top).land) {
      const q = tops[landed] as Top;
      if (landed < 24) beep(note(4 + (landed % 5)), 0.05, "triangle", 0.03);
      if (n <= 60) puff(q.x, q.y, 0.45, landed * 7 + 1);
      landed++;
    }
    if (phase === "dance" || phase === "fight") {
      for (const h of hits) {
        if (h.done || tAll < h.at - PLAN) continue;
        const v = byIdx.get(h.victim) as Top;
        if (h.kind === "spent") {
          // Se queda sin cuerda solo: cabecea y se acuesta.
          if (tAll >= h.at) {
            h.done = true;
            knockOut(v, "fall");
            beep(note(2 + (h.victim % 3)), 0.18, "sine", 0.05);
            cam.punch(0.02);
          }
          continue;
        }
        const c = victimOf.get(v);
        if (!c) {
          if (tAll < h.at - WIND) {
            const hitter = pickHitter(v);
            if (hitter) {
              const aim = aimFor(v, hitter);
              const cc: Charge = { hit: h, hitter, victim: v, aimX: aim.x, aimY: aim.y };
              hitterOf.set(hitter, cc);
              victimOf.set(v, cc);
            }
          } else if (tAll >= h.at) {
            // Nadie llegó a tiempo: se queda sin cuerda (la ganadora, en cambio, sigue bailando).
            h.done = true;
            if (h.kind !== "edge") knockOut(v, "fall");
          }
        } else if (tAll >= h.at + GRACE) impact(c, true);
      }
    }
    if (phase === "fight") {
      if (!fewSaid && alive().length <= 4 && n > 4) {
        fewSaid = true;
        say(t("cTroFew"), 0.6);
      }
      // Con dos o tres, amagues: se acercan, se rozan y suena.
      if (n <= 3 && Math.floor((tAll - T_FIGHT) / 1.1) > Math.floor((tAll - T_FIGHT - DT) / 1.1)) {
        const a = win, b = riv;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        a.vx += (dx / d) * 0.5; a.vy += (dy / d) * 0.5;
        b.vx -= (dx / d) * 0.5; b.vy -= (dy / d) * 0.5;
        beep(note(9 + (Math.floor(tAll) % 3)), 0.06, "triangle", 0.035);
      }
    }
    if (phase === "duel" && duo) {
      const td = tAll - T_DUEL;
      // Si algo los separó y no llegaron a tocarse, el choque se da igual y queda anotado.
      if (clashIdx < clashes.length && td >= (clashes[clashIdx] as number) + GRACE) clash(true);
      if (story.arc === "susto" && !wobbleSaid && td >= duelDur * 0.5) {
        wobbleSaid = true;
        say(T[getLang()].cTroWobble(names[winnerIdx] ?? ""), 0.85);
        beep(note(1), 0.12, "square", 0.05);
      }
      if (story.arc === "susto" && wobbleSaid && !recoverSaid && td >= duelDur * 0.5 + 0.9) {
        recoverSaid = true;
        say(t("cTroRecover"), 0.9);
        beep(note(12), 0.12, "triangle", 0.05);
      }
      // Después del último choque la rival se queda sin cuerda: cabecea y se
      // cae. Es el instante que decide, así que se nombra y suena: pasaba sin
      // subtítulo (la caja seguía diciendo "¡Se endereza!") y con un seno grave.
      const lastClash = T_DUEL + (clashes.at(-1) as number);
      if (riv.alive && tAll >= lastClash + 0.7) {
        knockOut(riv, "fall", true);
        const nm = names[rivalIdx] ?? "";
        say(winners.indexOf(riv.idx) > 0 ? T[getLang()].cPrizeOut([nm]) : T[getLang()].cTroSpent(nm), 0.95);
      }
      // El trompo que se apaga: notas que bajan mientras cabecea, y el golpe
      // sordo cuando se acuesta. En la hora del juego, para que caigan con lo
      // que se ve en cualquier duración; cae en el respiro de la música.
      if (!riv.alive) {
        while (apagado < APAGA.length && riv.out >= (APAGA[apagado] as number)) {
          const d = [9, 7, 5, 3, 1][apagado] as number;
          if (riv.out - (APAGA[apagado] as number) < 0.15) beep(note(d), 0.08 + 0.03 * apagado, "triangle", 0.05);
          apagado++;
        }
        if (!acostada && riv.out >= WOBBLE_T + 0.28) {
          acostada = true;
          if (riv.out < WOBBLE_T + 0.45) beep(note(2), 0.14, "square", 0.04);
        }
      }
    }
  }
  /* ---------------------------------------------------------------- escena */
  let ground!: Graphics;
  let chalk!: Graphics;
  let dustG!: Graphics;
  let shadows!: Graphics;
  let trailG!: Graphics;
  let topsLayer!: Container;
  let fxG!: Graphics;
  let linesG!: Graphics;
  let flashG!: Graphics;
  let chips!: Container;
  let counter!: ReturnType<PixiStage["text"]>;
  let counterBox!: Graphics;
  let duelText!: ReturnType<PixiStage["text"]>;

  const R = (): number => Math.min(S.sh() * 0.52, S.sw() * 0.34);
  const center = (): { x: number; y: number } => ({ x: S.sw() / 2, y: S.sh() * 0.54 });
  const toWorld = (x: number, y: number): { x: number; y: number } => {
    const c = center(), r = R();
    return { x: c.x + x * r, y: c.y + y * r * SQUASH };
  };

  function makeTop(q: Top): Container {
    const c = new Container();
    const col = S.color(q.idx);
    const body = new Graphics()
      // La púa.
      .poly([-0.07, -0.2, 0.07, -0.2, 0, 0]).fill(0x9aa1ad).stroke({ width: 0.04, color: INK })
      // El cuerpo, cónico, con la mitad derecha en sombra para que tenga volumen.
      .poly([-0.5, -0.92, 0.5, -0.92, 0.16, -0.22, -0.16, -0.22]).fill(col)
      .poly([0.08, -0.92, 0.5, -0.92, 0.16, -0.22, 0.04, -0.22]).fill({ color: 0x000000, alpha: 0.22 })
      .poly([-0.5, -0.92, 0.5, -0.92, 0.16, -0.22, -0.16, -0.22]).stroke({ width: 0.06, color: INK, join: "round" })
      // La franja de la cuerda.
      .poly([-0.42, -0.72, 0.42, -0.72, 0.35, -0.6, -0.35, -0.6]).fill(lighten(col, 0.55))
      // La tapa, que se ve desde arriba.
      .ellipse(0, -0.92, 0.5, 0.17).fill(lighten(col, 0.3)).stroke({ width: 0.06, color: INK })
      // La cabeza.
      .ellipse(0, -1.02, 0.1, 0.08).fill(INK);
    const marks = new Graphics();
    const glint = new Graphics().ellipse(0, 0, 0.09, 0.05).fill({ color: 0xffffff, alpha: 0.85 });
    glint.y = -0.94;
    // El destello del golpe: la misma silueta en blanco, que se prende un instante.
    const flash = new Graphics()
      .poly([-0.07, -0.2, 0.07, -0.2, 0, 0]).fill(0xffffff)
      .poly([-0.5, -0.92, 0.5, -0.92, 0.16, -0.22, -0.16, -0.22]).fill(0xffffff)
      .ellipse(0, -0.92, 0.5, 0.17).fill(0xffffff);
    flash.alpha = 0;
    c.addChild(body, marks, glint, flash);
    q.glint = glint;
    q.marks = marks;
    q.flash = flash;
    return c;
  }

  function build(): void {
    const k = S.u();
    const W = S.sw(), H = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    // El patio: tierra apisonada, con piedritas sembradas.
    const earth = S.dark ? 0x3a2a1f : 0xe2c29a;
    S.bg.addChild(new Graphics().rect(0, 0, W, H).fill(earth));
    ground = new Graphics();
    chalk = new Graphics();
    dustG = new Graphics();
    shadows = new Graphics();
    trailG = new Graphics();
    topsLayer = new Container();
    topsLayer.sortableChildren = true;
    fxG = new Graphics();
    S.scene.addChild(ground, chalk, dustG, shadows, trailG, topsLayer, fxG);
    for (const q of tops) {
      q.view?.destroy({ children: true });
      q.view = makeTop(q);
      topsLayer.addChild(q.view);
      q.chip?.destroy({ children: true });
      q.chip = undefined;
      q.outChip?.destroy({ children: true });
      q.outChip = undefined;
    }
    // Las piedritas y la rayuela dibujada con tiza en una esquina.
    const pebble = S.dark ? 0x5b4636 : 0xc9a47a;
    for (let i = 0; i < 90; i++) {
      const px = (hash(i, 1) - 0.1) * W * 1.2, py = (hash(i, 2) - 0.1) * H * 1.2;
      ground.ellipse(px, py, (2 + hash(i, 3) * 4) * k, (1.5 + hash(i, 4) * 2.5) * k).fill({ color: pebble, alpha: 0.7 });
    }
    const chalkCol = S.dark ? 0xf1ece2 : 0xffffff;
    const hx = W * 0.07, hy = H * 0.62, hs = 34 * k;
    const cells: [number, number][] = [[0, 3], [0, 2], [-0.5, 1], [0.5, 1], [0, 0], [-0.5, -1], [0.5, -1], [0, -2]];
    cells.forEach(([cx, cy], i) => {
      ground.rect(hx + cx * hs, hy - cy * hs * 0.6, hs, hs * 0.6).stroke({ width: 2.5 * k, color: chalkCol, alpha: 0.55 });
      const num = S.text(String(i + 1), { fontFamily: MONO, fontSize: 13 * k, fontWeight: "700", fill: chalkCol });
      num.alpha = 0.5;
      num.anchor.set(0.5);
      num.position.set(hx + cx * hs + hs / 2, hy - cy * hs * 0.6 + hs * 0.3);
      S.scene.addChildAt(num, 1);
    });
    // Las líneas de velocidad y el destello van debajo de la interfaz, que siempre se lee.
    linesG = new Graphics();
    flashG = new Graphics().rect(0, 0, W, H).fill(0xffffff);
    flashG.alpha = 0;
    S.hud.addChild(linesG, flashG);
    // El contador.
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    S.hud.addChild(box);
    chips = new Container();
    S.hud.addChild(chips);
    duelText = S.text("", { fontFamily: MONO, fontSize: 11 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    duelText.anchor.set(1, 1);
    duelText.alpha = 0.6;
    duelText.position.set(W - 22 * k, H - S.bottom() - 18 * k);
    S.hud.addChild(duelText);
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  {
    const c = center();
    cam.cut(c.x, c.y, 1.25);
  }

  /** La cámara: el ruedo al tirar, los golpes de cerca, el que sacan hasta la tiza, el mano a mano pegado, la ganadora. */
  function direct(): void {
    const c = center();
    const fz = focus && tFx < focus.until ? focus : null;
    const look = (f: NonNullable<typeof focus>): void => {
      // Al sacado lo sigue hasta la tiza y no más allá: afuera del ruedo la
      // cámara mostraba un trompo solo con polvo, y "¡Quedan los mejores!"
      // salía sobre uno que volaba, sin los dos que importan.
      const pr = f.top ? Math.hypot(f.top.x, f.top.y) : 0;
      const s = pr > LIM ? LIM / pr : 1;
      const p = f.top ? toWorld(f.top.x * s, f.top.y * s) : toWorld(f.x, f.y);
      const up = f.top ? f.top.z * R() * s : 0;
      const zoom = f.zoom - (f.zoom - Math.min(f.zoom, 1.25)) * clamp((pr - LIM) / 0.15, 0, 1);
      cam.lookAt(p.x, p.y - up - 20 * S.u(), zoom, 5);
    };
    if (phase === "throw") cam.lookAt(c.x, c.y, 1.25 - 0.2 * ease.inOutCubic(clamp(tAll / T_THROW, 0, 1)), 2);
    else if (phase === "dance") {
      if (fz) look(fz);
      else cam.lookAt(c.x + Math.sin(tAll * 0.5) * 12 * S.u(), c.y, 1.08, 1.5, 0.012 * Math.sin(tAll * 0.7));
    } else if (phase === "fight") {
      // El golpe grande que viene: la cámara llega antes que el golpe, mientras
      // el que pega toma impulso, y el golpe cae en el cuadro. Llegar después
      // es mostrar un trompo que ya se va.
      let next: Charge | null = null;
      for (const ch of hitterOf.values()) {
        if (ch.hit.stop <= 0 || tAll < ch.hit.at - WIND - 0.3) continue;
        if (story.arc === "tapada" && (ch.hitter === win || ch.victim === win)) continue;
        if (!next || ch.hit.at < next.hit.at) next = ch;
      }
      if (story.arc === "remontada" && tAll < edgeAt + 0.8) {
        const w = toWorld(win.x, win.y);
        cam.lookAt(w.x, w.y, 1.7, 5);
      } else if (next) {
        const a = toWorld(next.hitter.x, next.hitter.y), b = toWorld(next.victim.x, next.victim.y);
        cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 - 24 * S.u(), 1.55, 7);
      } else if (fz) look(fz);
      else cam.lookAt(c.x, c.y, 1.0 + 0.3 * (1 - alive().length / n), 2);
    } else if (phase === "duel") {
      const a = toWorld(win.x, win.y), b = toWorld(riv.x, riv.y);
      const wob = story.arc === "susto" && wobbleSaid && !recoverSaid;
      const slow = tFx < slowUntil;
      const next = clashIdx < clashes.length ? T_DUEL + (clashes[clashIdx] as number) : Infinity;
      // Antes de cada choque la cámara se cierra un poco: la sala sabe que viene.
      const tense = tAll >= next - D_WIND;
      // Al empezar el mano a mano, un corte rápido a los dos: la cámara venía
      // siguiendo al último que salió volando, y el "¡mano a mano!" se decía
      // sobre una pantalla vacía (lo encontró el agente evaluador).
      const recien = tAll - T_DUEL < 0.6;
      if (wob) cam.lookAt(a.x, a.y - 30 * S.u(), 2.4, 4);
      else cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 - 20 * S.u(), slow ? 2.5 : tense ? 2.2 : 2.0, recien ? 9 : slow ? 6 : 3);
    } else {
      const a = toWorld(win.x, win.y);
      const z = 1.5;
      // Con varios premios el cartel tiene más renglones: el trompo baja para
      // salir entero debajo.
      cam.lookAt(a.x, a.y - (S.sh() * (winners.length > 1 ? 0.21 : 0.12)) / z, z, 1.6);
    }
  }

  function draw(): void {
    const k = S.u();
    const c = center(), r = R();
    // La tiza del ruedo, apenas temblada, y la cruz del medio.
    chalk.clear();
    const chalkCol = S.dark ? 0xf1ece2 : 0xffffff;
    const pts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const j = 1 + (hash(i % 64, 5) - 0.5) * 0.02;
      pts.push(c.x + Math.cos(a) * r * LIM * j, c.y + Math.sin(a) * r * LIM * SQUASH * j);
    }
    // Adentro del ruedo la tierra está barrida: un poco más clara.
    chalk.ellipse(c.x, c.y, r * LIM, r * LIM * SQUASH).fill({ color: 0xffffff, alpha: S.dark ? 0.05 : 0.14 });
    chalk.poly(pts).stroke({ width: 5 * k, color: chalkCol, alpha: 0.85 });
    chalk.moveTo(c.x - 10 * k, c.y - 6 * k).lineTo(c.x + 10 * k, c.y + 6 * k).moveTo(c.x + 10 * k, c.y - 6 * k).lineTo(c.x - 10 * k, c.y + 6 * k).stroke({ width: 3 * k, color: chalkCol, alpha: 0.6 });

    const size = rn * r * 1.55;
    shadows.clear();
    dustG.clear();
    trailG.clear();
    fxG.clear();

    // El polvo, en el piso.
    const dustCol = S.dark ? 0x9a846c : 0xb08e68;
    for (const p of dusts) {
      const a = tFx - p.at;
      if (a < 0 || a > 0.7) continue;
      const w = toWorld(p.x, p.y);
      const f = a / 0.7;
      for (let i = 0; i < 5; i++) {
        const ang = hash(p.seed, i) * Math.PI * 2;
        const dd = size * (0.25 + 0.55 * ease.outCubic(f)) * (0.6 + 0.4 * p.pow);
        dustG.circle(w.x + Math.cos(ang) * dd, w.y + Math.sin(ang) * dd * SQUASH - size * 0.1 * f, size * (0.12 + 0.16 * f) * (0.7 + 0.5 * hash(p.seed, i + 5)))
          .fill({ color: dustCol, alpha: 0.42 * (1 - f) * (0.5 + 0.5 * p.pow) });
      }
    }

    // La estela: el que va rápido deja imágenes de sí mismo atrás, como en el animé.
    let ghosts = 0;
    for (const q of tops) {
      const m = q.trail.length / 3;
      if (!m || q.gone) continue;
      const col = S.color(q.idx);
      for (let i = 0; i < m && ghosts < 160; i++, ghosts++) {
        const a = (i + 1) / (m + 1);
        const w = toWorld(q.trail[i * 3] as number, q.trail[i * 3 + 1] as number);
        const z = (q.trail[i * 3 + 2] as number) * r;
        trailG.ellipse(w.x, w.y - size * 0.55 - z, size * 0.45 * (0.6 + 0.4 * a), size * 0.38 * (0.6 + 0.4 * a)).fill({ color: col, alpha: 0.24 * a });
      }
    }

    // Los trompos, ordenados por profundidad: el de más abajo va adelante.
    for (const q of tops) {
      const v = q.view as Container;
      v.zIndex = q.y;
      const w = toWorld(q.x, q.y);
      if (tAll < q.land) {
        // Todavía en el aire: viene desde abajo, en arco.
        const p = clamp(1 - (q.land - tAll) / 0.5, 0, 1);
        v.visible = p > 0;
        v.position.set(w.x, w.y - Math.sin(Math.PI * p) * 90 * k - (1 - p) * 60 * k + (1 - p) * S.sh() * 0.4);
        v.scale.set(size);
        v.rotation = (1 - p) * 4;
        continue;
      }
      if (q.gone) {
        v.visible = false;
        continue;
      }
      v.visible = true;
      // El golpe: se aplasta, rebota como goma y se prende en blanco un instante.
      const age = tFx - q.hitAt;
      const hp = age >= 0 && age < 0.4 ? q.hitPow * Math.exp(-age / 0.07) * Math.cos(age * 38) : 0;
      const fa = tFx - q.flashAt;
      (q.flash as Graphics).alpha = fa >= 0 && fa < 0.06 ? 0.9 * (1 - fa / 0.06) : 0;
      let sc = size;
      if (phase === "crown" && q === win) sc = size * (1 + 0.35 * ease.outBack(clamp((tAll - T_CROWN) * 2, 0, 1)));
      v.scale.set(sc * (1 + 0.22 * hp), sc * (1 - 0.18 * hp));
      const upright = q.alive || (q.kind === "fall" && q.out < WOBBLE_T);
      if (upright) {
        // El giro sale de la hora del juego: en la parada, el trompo también se congela.
        const ph = q.ph + q.rate * tAll;
        let wob = q.wob;
        if (phase === "duel" && q === riv) wob += 0.05 * clamp((tAll - T_DUEL) / duelDur, 0, 1);
        if (story.arc === "susto" && q === win && wobbleSaid && !recoverSaid) wob = 0.32;
        // El que se quedó sin cuerda cabecea cada vez más fuerte y más rápido.
        const dying = q.alive ? 0 : q.out / WOBBLE_T;
        wob += 0.55 * dying * dying;
        q.tilt = Math.sin(tAll * (5 + 7 * dying) + q.wobPh) * wob;
        v.rotation = q.tilt + q.lean;
        v.position.set(w.x, w.y);
        (q.glint as Graphics).x = Math.sin(ph) * 0.3;
        const mk = q.marks as Graphics;
        mk.clear();
        if (n <= 40) {
          for (let m = 0; m < 3; m++) {
            const ang = ph + (m * Math.PI * 2) / 3;
            if (Math.cos(ang) < 0) continue;
            const mx = Math.sin(ang) * 0.34;
            mk.rect(mx - 0.025, -0.83, 0.05, 0.2).fill({ color: INK, alpha: 0.55 });
          }
        }
        shadows.ellipse(w.x, w.y + 2 * k, size * 0.42, size * 0.13).fill({ color: 0x000000, alpha: 0.28 });
        // La ganadora, en la coronación: crece un poco y brilla desde abajo.
        if (phase === "crown" && q === win) {
          const g = ease.outBack(clamp((tAll - T_CROWN) * 2, 0, 1));
          shadows.ellipse(w.x, w.y + 2 * k, size * (0.8 + 0.5 * g), size * (0.26 + 0.16 * g)).fill({ color: YELLOW, alpha: 0.35 });
        }
      } else if (q.kind === "kick") {
        // Sacado: vuela girando, pica en el piso y queda acostado. La sombra
        // se queda en el piso y se achica con la altura: así se lee que vuela.
        if (q.groundAt < 0) v.rotation = q.rot;
        else v.rotation = q.rot + (q.fallDir * 1.45 - q.rot) * ease.outCubic(clamp((q.out - q.groundAt) / 0.18, 0, 1));
        v.position.set(w.x, w.y - q.z * r);
        (q.marks as Graphics).clear();
        const s = 1 / (1 + q.z * 6);
        shadows.ellipse(w.x, w.y + 2 * k, size * 0.5 * s, size * 0.14 * s).fill({ color: 0x000000, alpha: 0.22 * s * clamp((2 - q.out) / 0.6, 0, 1) });
      } else {
        // Sin cuerda: se viene abajo acelerando, como cae de verdad, y rebota un poco.
        const p = clamp((q.out - WOBBLE_T) / 0.28, 0, 1);
        const after = q.out - WOBBLE_T - 0.28;
        const b = after > 0 ? Math.abs(Math.sin(after * 16)) * 0.1 * Math.exp(-after * 9) : 0;
        v.rotation = q.tilt * (1 - p) + q.fallDir * (1.45 * p * p - b);
        v.position.set(w.x, w.y);
        (q.marks as Graphics).clear();
        shadows.ellipse(w.x + q.fallDir * size * 0.45 * p, w.y + 2 * k, size * (0.42 + 0.13 * p), size * 0.13).fill({ color: 0x000000, alpha: 0.2 * clamp((2 - q.out) / 0.6, 0, 1) });
      }
      // Los que salieron se apagan antes de los dos segundos: si quedaran
      // tirados, en el mano a mano taparían a los dos que importan.
      v.alpha = q.alive ? 1 : clamp((2 - q.out) / 0.6, 0, 1);
      if (!q.alive && v.alpha <= 0) {
        v.visible = false;
        q.gone = true;
        if (log && q.kind === "kick") log.afuera.push({ idx: q.idx, r: Math.hypot(q.x, q.y) });
      }
    }

    // Los golpes: la estrella, la onda en el piso y las chispas.
    for (const im of impacts) {
      const a = tFx - im.at;
      if (a < 0 || a > 0.6) continue;
      const w = toWorld(im.x, im.y);
      // A media altura de los trompos, que es donde se tocan.
      const cy = w.y - size * 0.5;
      const big = im.tier >= 2;
      if (im.tier >= 1 && a < 0.22) {
        // La estrella aparece de golpe, con un rebote, y se va rápido.
        const s = a < 0.05 ? ease.outBack(a / 0.05) : 1 - ease.inOutCubic((a - 0.05) / 0.17);
        const R0 = size * (0.45 + 0.35 * im.pow) * (im.tier === 3 ? 1.7 : big ? 1.3 : 1) * s;
        if (R0 > 0.5) {
          const star: number[] = [];
          const rot0 = hash(im.seed, 3) * Math.PI;
          for (let i = 0; i < 16; i++) {
            const ang = rot0 + (i / 16) * Math.PI * 2;
            const rr = i % 2 ? R0 * 0.42 : R0 * (0.85 + 0.3 * hash(im.seed, i));
            star.push(w.x + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
          }
          fxG.poly(star).fill(YELLOW).stroke({ width: 2.5 * k, color: INK, join: "round" });
          fxG.circle(w.x, cy, R0 * 0.24).fill(0xffffff);
        }
      }
      if (im.tier >= 1 && a < 0.4) {
        // La onda corre por el piso, en perspectiva como el ruedo.
        const p = a / 0.4;
        const rx = size * (0.4 + (im.tier === 3 ? 3.2 : big ? 2.4 : 1.6) * ease.outCubic(p));
        fxG.ellipse(w.x, w.y, rx, rx * SQUASH).stroke({ width: (4.5 * (1 - p) + 1) * k, color: 0xffffff, alpha: 0.8 * (1 - p) });
      }
      // Las chispas salen sobre todo de costado, como del roce de dos giros, y caen.
      const cnt = im.tier === 3 ? 22 : im.tier === 2 ? 16 : im.tier === 1 ? 10 : 4;
      const base = Math.atan2(im.ny * SQUASH, im.nx);
      for (let i = 0; i < cnt; i++) {
        const h1 = hash(im.seed, i + 11), h2 = hash(im.seed, i + 37), h3 = hash(im.seed, i + 63);
        const L = 0.22 + h3 * 0.28;
        if (a > L) continue;
        const side = i % 4 === 3 ? 0 : i % 2 ? 1 : -1;
        const ang = base + (side * Math.PI) / 2 + (h1 - 0.5) * 1.1;
        const sp = (220 + h2 * 380) * k * (0.55 + im.pow) * (im.tier === 0 ? 0.6 : 1);
        const up = (90 + h3 * 160) * k;
        // La cola de la chispa: lo que recorrió en los últimos 50 ms. Se lee como una raya, no como un punto.
        const ta = Math.max(0, a - (im.tier === 0 ? 0.03 : 0.05));
        const x1 = w.x + Math.cos(ang) * sp * a, y1 = cy + Math.sin(ang) * sp * a - up * a + 900 * k * a * a;
        const x0 = w.x + Math.cos(ang) * sp * ta, y0 = cy + Math.sin(ang) * sp * ta - up * ta + 900 * k * ta * ta;
        const life = 1 - a / L;
        fxG.moveTo(x0, y0).lineTo(x1, y1).stroke({
          width: (1 + 3 * life) * k * (im.tier === 0 ? 0.7 : 1),
          color: a < L * 0.35 ? 0xffffff : h1 > 0.5 ? YELLOW : 0xff8a1f,
          cap: "round",
        });
      }
    }

    // El destello de pantalla, solo en los choques del mano a mano: uno por
    // segundo como mucho, lejos de los tres por segundo que pueden molestar.
    flashG.alpha = tFx >= flashAt && tFx - flashAt < 0.14 ? flashPow * (1 - (tFx - flashAt) / 0.14) : 0;
    // Las líneas de velocidad del animé: en la toma de impulso del último
    // choque y durante la cámara lenta.
    linesG.clear();
    const lastWind = duo && phase === "duel" && clashIdx === clashes.length - 1 && tAll >= T_DUEL + (clashes.at(-1) as number) - D_WIND;
    if (tFx < slowUntil || lastWind) {
      const W = S.sw(), H = S.sh();
      const R1 = Math.hypot(W, H) * 0.55;
      const frame = Math.floor(tFx * 24) % 8;
      for (let i = 0; i < 22; i++) {
        const ang = hash(i, 40 + frame) * Math.PI * 2;
        const r2 = R1 * (0.62 + 0.14 * hash(i, 50 + frame));
        linesG.moveTo(W / 2 + Math.cos(ang) * R1, H / 2 + Math.sin(ang) * R1)
          .lineTo(W / 2 + Math.cos(ang) * r2, H / 2 + Math.sin(ang) * r2)
          .stroke({ width: (2 + 2.5 * hash(i, 60 + frame)) * k, color: S.dark ? 0xffffff : INK, alpha: 0.32 });
      }
    }

    // Pasar lista: mientras bailan, antes del primer choque, los nombres de a
    // tandas encima de cada trompo, para que cada uno sepa cuál es el suyo.
    const roll = phase === "crown" ? [] : S.batch(n, tAll, T_THROW - 0.8, T_FIGHT - 0.05);
    S.tags(names, roll, (i) => {
      const q = byIdx.get(i);
      if (!q || !q.alive || tAll < q.land) return null;
      const w = toWorld(q.x, q.y);
      return cam.toScreen(w.x, w.y - size * 1.15, S.sw(), S.sh());
    });

    // Los nombres: los que siguen, cuando quedan pocos, y los que acaban de salir.
    const live = alive();
    for (const q of tops) {
      if (q.chip) q.chip.visible = false;
      if (q.outChip) q.outChip.visible = false;
    }
    if (!roll.length && phase !== "crown") {
      const vivos = live.length <= 8 ? live.filter((q) => tAll >= q.land) : [];
      // La rival conserva su nombre mientras cae: el chip desaparecía justo
      // en el instante que decide.
      if (phase === "duel" && duo && !riv.alive && !riv.gone) vivos.push(riv);
      // Los que salen llevan su nombre un rato, de a cuatro como mucho (los
      // más recientes), y el co-ganador con su estrella: si no, el relator
      // decía "sale con premio" y nadie sabía cuál era su trompo.
      const OUT_TAG = 1.2;
      const salen = tops.filter((q) => q.tagOut && !q.alive && !q.gone && q.out < OUT_TAG).sort((a, b) => a.out - b.out).slice(0, 4);
      // En el mano a mano, grandes: a 8 px de mayúscula no se leían desde el fondo.
      const grande = live.length <= 2 ? (S.portrait() ? 1.4 : 1.7) : live.length <= 4 ? 1.3 : 1;
      const W = S.sw(), H = S.sh();
      const at = [...vivos.map((q) => ({ q, out: false })), ...salen.map((q) => ({ q, out: true }))]
        .map(({ q, out }) => {
          const w = toWorld(q.x, q.y);
          const up = out && q.kind === "kick" ? q.z * r : 0;
          return { q, out, p: cam.toScreen(w.x + size * 0.35, w.y - up - size * 1.1, W, H) };
        })
        // El nombre de uno que ya salió de cuadro no va: pegado al borde engañaba.
        .filter(({ out, p }) => !out || (p.x > -10 * k && p.x < W + 10 * k && p.y > S.top() && p.y < H - S.bottom()))
        .sort((a, b) => a.p.y - b.p.y);
      // Dónde está el cuerpo de cada uno de los que siguen, en pantalla: un
      // nombre grande no va encima del trompo del otro.
      const cuerpos = vivos.map((q) => {
        const w = toWorld(q.x, q.y);
        const a = cam.toScreen(w.x - size * 0.5, w.y - size * 1.05, W, H), b = cam.toScreen(w.x + size * 0.5, w.y, W, H);
        return { q, x0: a.x, y0: a.y, x1: b.x, y1: b.y };
      });
      let prev = -Infinity, prevS = 1;
      for (const { q, out, p } of at) {
        const nm = names[q.idx] ?? "";
        const chip = out
          ? (q.outChip ??= chips.addChild(S.chip(winners.indexOf(q.idx) > 0 ? `★ ${nm}` : nm, 1, nm)))
          : (q.chip ??= chips.addChild(S.chip(nm)));
        const sc = out ? 1 : grande;
        chip.scale.set(sc);
        chip.alpha = out ? clamp((OUT_TAG - q.out) / 0.5, 0, 1) : 1;
        chip.visible = true;
        const cy = Math.max(p.y, prev + 13 * k * (prevS + sc));
        prev = cy;
        prevS = sc;
        const cw = chip.width, ch = 13 * k * sc;
        const tapa = (x: number): boolean => cuerpos.some((c) => c.q !== q && x < c.x1 && x + cw > c.x0 && cy - ch < c.y1 && cy + ch > c.y0);
        let x = Math.min(p.x + 4 * k, W - cw - 10 * k);
        // Si a la derecha tapa al otro trompo, a la izquierda del suyo.
        if (tapa(x)) {
          const izq = Math.max(10 * k, cam.toScreen(toWorld(q.x, q.y).x - size * 0.35, 0, W, H).x - 4 * k - cw);
          if (!tapa(izq)) x = izq;
        }
        chip.position.set(x, cy);
      }
    }

    // El contador.
    const inRing = phase === "throw" ? Math.min(landed, n) : live.length;
    counter.text = `${t("cTroLeft")}  ${inRing} / ${n}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    duelText.text = phase === "duel" ? `${t("cTroDuelLbl")} ${Math.min(clashHits, clashes.length)}/${clashes.length}` : "";
    if (phase === "crown") crownUI.at(tAll - T_CROWN);
  }

  let duelSaid = false;
  S.run((dt, now) => {
    tFx += dt;
    // La parada congela el juego; la cámara lenta lo lleva al 30%. Los efectos
    // y la cámara siguen con el reloj de siempre.
    let g = dt;
    if (stop > 0) {
      const used = Math.min(stop, g);
      stop -= used;
      g -= used;
    }
    if (g > 0 && tFx < slowUntil) g *= SLOW;
    tAll += g;
    S.breath(tAll, T_CROWN, tFx < slowUntil ? SLOW : 1);
    phase = tAll < T_THROW ? "throw" : tAll < T_FIGHT ? "dance" : tAll < T_DUEL ? "fight" : tAll < T_CROWN ? "duel" : "crown";
    if (phase === "duel" && !duelSaid) {
      duelSaid = true;
      // Los golpes que no llegaron se sueltan, y los que quedaban se caen de
      // golpe: con dos no hay choques de más.
      hitterOf.clear();
      victimOf.clear();
      for (const h of hits) h.done = true;
      for (const q of tops) if (q.alive && q !== win && q !== riv) knockOut(q, "fall", true);
      if (n >= 2) say(T[getLang()].cTroDuel(...enOrden(names[winnerIdx] ?? "", names[rivalIdx] ?? "")), 0.7);
    }
    script();
    sayPending();
    // El zumbido de los trompos: se decía "¡Todos zumbando!" y no sonaba nada
    // continuo. Sube de tono a medida que quedan menos; en el mano a mano, uno
    // por trompo, y cuando la rival cae queda el de la ganadora sola. Termina
    // antes del cartel, para que el respiro de la música se oiga.
    if ((phase === "dance" || phase === "fight" || phase === "duel") && tAll < T_CROWN - 0.5) {
      const tick = Math.floor(tAll / 0.5);
      if (tick !== humTick) {
        humTick = tick;
        const left = alive().length;
        const deg = phase === "duel" && duo ? (riv.alive && tick % 2 ? 8 : 9) : left > 8 ? 7 : left > 2 ? 8 : 9;
        beepFor(note(deg), 0.55, "sawtooth", 0.02);
      }
    }
    acc += g;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    if (phase === "crown") {
      if (riv.alive && riv !== win) {
        riv.alive = false;
        riv.out = 0.5;
        riv.kind = "fall";
      }
      crown();
      tHold += dt * paceFactor();
    }
    while (impacts.length && tFx - (impacts[0] as Impact).at > 0.6) impacts.shift();
    while (dusts.length && tFx - (dusts[0] as Dust).at > 0.7) dusts.shift();
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw();
    if (tHold >= WINNER_HOLD) {
      phase = "dead";
      if (log) log.done = true;
      S.cleanup();
    }
  });
}
