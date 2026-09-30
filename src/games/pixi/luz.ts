import { Container, Graphics, type Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, params, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Luz roja, luz verde.
 *
 * El juego de patio de todo el mundo: con luz verde se corre, con luz roja
 * hay que quedarse quieto, y al que se mueve lo ven y queda afuera. Acá quien
 * mira es el Faro, que es lo que es drand para Tinkazo: el faro de
 * aleatoriedad. Con luz verde está de espaldas y muestra su lámpara verde; con
 * luz roja se da vuelta, prende el ojo rojo y barre la cancha con su haz. Al
 * que el haz agarra moviéndose, "¡te vi!", y se sienta. Gana quien toca el
 * Faro.
 *
 * No es el juego de una serie: no hay muñeca, ni uniformes, ni nada que se
 * apueste. Es el juego de patio, con el Faro de la casa.
 *
 * La física manda lo que se ve: cada corredor frena con su inercia, y al que
 * le toca salir en esa luz roja no le alcanza el freno y sigue arrastrando los
 * pies cuando llega el haz. El orden en que salen está sembrado con la ronda y
 * la ganadora va primera en esa lista, así que nunca la ven. Los arcos:
 *
 * - **susto**: el haz se detiene sobre la ganadora, que se tambalea sin dar un
 *   paso, y sigue de largo.
 * - **remontada**: arranca última y en el último verde pasa a todos.
 * - **duelo**: una luz roja más, con la rival adelante hasta que la ven.
 * - **tapada**: corre en el medio del grupo y nadie la nombra.
 *
 * La cancha se ve en perspectiva: la posición vive en metros (el ancho, y la
 * profundidad hacia el Faro) y se proyecta con una cámara que avanza detrás
 * del grupo. Con `?auditar=fisica` el juego anota a quién agarró el haz y a
 * qué velocidad iba, y si alguien se movió con luz roja sin que lo vieran,
 * para `scripts/audit-fisica.mjs`.
 */

const DT = 1 / 120;
const T_INTRO = 2.4;
/** El Faro se da vuelta: lo que tarda en girar la cabeza. */
const WARN = 0.45;
/** Lo que dura el barrido del haz. */
const RED = 1.9;
/** Lo que tarda en volver a darse vuelta. */
const BACK = 0.35;
/** El último verde, hasta tocar el Faro. */
const FINAL = 2.1;
/** El largo de la cancha, en metros, y el alto de la cámara. */
const LEN = 24;
// A tres metros, como desde una tribuna: a la altura de los ojos todo lo
// lejano quedaba pegado al horizonte y abajo sobraba pasto vacío.
const CAM_H = 3;
/** El ancho del haz, en fracción del medio ancho de la cancha. */
const BEAM = 0.13;
/** Lo más rápido que corre alguien, en fracción de la cancha por segundo. */
const VMAX = 0.36;

type Light = "intro" | "green" | "warn" | "red" | "back" | "final" | "crown" | "dead";

interface Runner {
  idx: number;
  /** Lateral, de -1 a 1; profundidad, de 0 (la largada) a 1 (el Faro). */
  x: number; z: number; v: number;
  pace: number; brake: number; ph: number; hair: number; chullo: boolean;
  /** Cuándo lo vio el haz; -1 si nunca. */
  caught: number;
  /** El tambaleo del que no alcanzó a frenar, de 0 a 1. */
  sway: number;
  view?: Container; legL?: Container; legR?: Container; armL?: Container; armR?: Container;
  torso?: Container; mark?: Graphics; chip?: Container;
}
interface Cycle { g0: number; g1: number; r0: number; r1: number; b1: number; victims: number[]; hold: number }

export async function luzPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const duo = n >= 2 && rivalIdx !== winnerIdx;

  // El orden de salida: la ganadora primera, la rival segunda, el resto sembrado.
  const rest = names.map((_, i) => i).filter((i) => i !== winnerIdx && i !== rivalIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const victims = rest.slice().reverse();

  // Las luces: pocas con poca gente, más con mucha, y una más en el duelo.
  const K = n <= 3 ? 2 : n <= 12 ? 3 : n <= 40 ? 4 : 5;
  const NC = K + (story.arc === "duelo" && duo ? 1 : 0);
  // El reparto: más al principio. La última luz roja es de la rival sola.
  const shares = Array.from({ length: Math.max(1, NC - 1) }, (_, c) => Math.pow(NC - c, 1.4));
  const ssum = shares.reduce((a, b) => a + b, 0);
  const cycles: Cycle[] = [];
  const sustoAt = Math.max(0, NC - 2);
  let tt = T_INTRO, given = 0;
  for (let c = 0; c < NC; c++) {
    const green = clamp(2.3 - c * 0.15, 1.5, 2.3);
    const last = c === NC - 1;
    let take: number[] = [];
    if (!last || NC === 1) {
      const want = c === NC - 2 || NC === 1 ? victims.length - given : Math.round(((shares[c] ?? 0) / ssum) * victims.length);
      take = victims.slice(given, given + Math.max(0, want));
      given += take.length;
    }
    if (last && duo) take = [...take, rivalIdx];
    const hold = story.arc === "susto" && c === sustoAt ? 0.7 : 0;
    const g0 = tt, g1 = tt + green, r0 = g1 + WARN, r1 = r0 + RED + hold, b1 = r1 + BACK;
    cycles.push({ g0, g1, r0, r1, b1, victims: take, hold });
    tt = b1;
  }
  const T_FINAL = tt;
  const T_CROWN = T_FINAL + FINAL;
  setGameLength(T_CROWN, WINNER_HOLD);
  const victimOf = new Map<number, number>();
  cycles.forEach((c, i) => c.victims.forEach((v) => victimOf.set(v, i)));

  // Los corredores, en fila a lo ancho de la largada.
  const runners: Runner[] = names.map((_, i) => ({
    idx: i, x: 0, z: 0, v: 0, pace: 0.78 + 0.18 * hash(i, 5), brake: 1.1 + 0.9 * hash(i, 6),
    ph: hash(i, 7) * 6, hair: [0x2b1d14, 0x3d2817, 0x151515, 0x5a3a22][Math.floor(hash(i, 8) * 4)] as number,
    chullo: hash(i, 9) < 0.4, caught: -1, sway: 0,
  }));
  // Los carriles: la ganadora en el medio del grupo en la tapada.
  const order = runners.map((r) => r.idx).sort((a, b) => hash(a, 3) - hash(b, 3));
  if (story.arc === "tapada") {
    const at = order.indexOf(winnerIdx);
    order.splice(at, 1);
    order.splice(Math.floor(order.length / 2), 0, winnerIdx);
  }
  // La largada en filas escalonadas: una sola fila a lo ancho era una pared de
  // espaldas que tapaba al Faro.
  const rows = n <= 6 ? 1 : n <= 24 ? 3 : 5;
  order.forEach((idx, k) => {
    const r = runners[idx] as Runner;
    // Con pocos, los carriles se juntan hacia el medio: dos corredores en las
    // puntas de la cancha quedaban chiquitos y lejos uno del otro.
    const ancho = Math.min(0.86, 0.2 + 0.11 * n);
    r.x = n === 1 ? 0 : -ancho + (2 * ancho * k) / (n - 1) + (hash(idx, 4) - 0.5) * 0.04;
    r.z = ((k % rows) / Math.max(1, rows)) * 0.06;
  });
  const win = runners[winnerIdx] as Runner;
  const riv = runners[rivalIdx] as Runner;
  if (story.arc === "tapada") win.pace = 0.86;
  else if (story.arc !== "remontada") win.pace = 0.92;
  if (duo) riv.pace = story.arc === "duelo" ? 0.97 : 0.95;

  /** Hasta dónde llega cada uno al final de cada verde. */
  function goal(r: Runner, c: number): number {
    const f = (c + 1) / (NC + 1.1);
    if (r === win && story.arc === "remontada") return 0.9 * Math.pow(f, 1.9);
    return r.pace * f;
  }

  /* ---------------------------------------------------------------- estado */
  let light: Light = "intro";
  let cycleI = 0;
  let tAll = 0, acc = 0, tHold = 0, camZ = -8, lastCatchSnd = -9, lastStep = -9;
  let crowned = false, saidSaved = false, saidWobble = false;
  const said = new Set<string>();
  const alive = (): Runner[] => runners.filter((r) => r.caught < 0);

  // `?auditar=fisica`: a quién agarró el haz y a qué velocidad iba, y lo más
  // rápido que se movió alguien con luz roja sin que lo vieran.
  const audit = params.get("auditar") === "fisica"
    ? {
      juego: "luz", n, maxOverlap: 0, maxAt: 0, escapes: 0, pasos: 0, done: false,
      catches: [] as { t: number; idx: number; v: number; dist: number; cycle: number }[],
      redMove: 0, planned: victimOf.size, winner: winnerIdx,
    }
    : null;
  if (audit) (window as unknown as { __fisica: typeof audit }).__fisica = audit;

  // El relator con turno, como en el trompo: una línea nueva espera si otra
  // recién apareció, y de las que esperan queda la más importante.
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

  /** Dónde está el haz, de -1 a 1, en la luz roja `c`. Con susto, se queda un rato sobre la ganadora. */
  function beamAt(c: Cycle, x: number): number {
    const sweep = RED - 0.2;
    let p = x - c.r0;
    if (c.hold > 0) {
      const f0 = (win.x + 1.05) / 2.1;
      const tStop = f0 * sweep;
      if (p > tStop) p = p < tStop + c.hold ? tStop : p - c.hold;
    }
    return -1.05 + 2.1 * ease.inOutCubic(clamp(p / sweep, 0, 1));
  }

  /* ---------------------------------------------------------------- física */
  function step(dt: number): void {
    const c = cycles[cycleI];
    for (const r of runners) {
      if (r.caught >= 0) continue;
      let goalZ = r.z, until = tAll + 1, running = false;
      if (light === "green" && c) {
        goalZ = goal(r, cycleI);
        until = c.g1;
        running = true;
      } else if (light === "final") {
        goalZ = r === win ? 1 : Math.min(0.96, win.z - 0.04 - hash(r.idx, 12) * 0.08);
        until = T_CROWN - 0.25;
        running = true;
      }
      if (running) {
        // Corre hacia donde tiene que llegar, sin pasarse de su velocidad.
        const vT = clamp((goalZ - r.z) / Math.max(0.2, until - tAll), 0, VMAX);
        r.v += (vT - r.v) * (1 - Math.exp(-6 * dt));
        r.sway *= 0.9;
      } else {
        // Frena con su inercia. Al que le toca salir en esta luz no le alcanza
        // el freno: arrastra los pies hasta que llega el haz.
        const mine = c && (light === "warn" || light === "red") && victimOf.get(r.idx) === cycleI;
        if (mine) {
          r.v = Math.max(0.018, r.v - 0.5 * dt);
          r.sway = Math.min(1, r.sway + dt * 2.5);
        } else {
          r.v = Math.max(0, r.v - r.brake * dt);
          r.sway *= 0.92;
        }
      }
      r.z += r.v * dt;
      r.ph += r.v * 62 * dt;
    }
    // El haz: al que agarra moviéndose, lo vio.
    if (light === "red" && c) {
      const xb = beamAt(c, tAll);
      for (const idx of c.victims) {
        const r = runners[idx] as Runner;
        if (r.caught >= 0) continue;
        const dist = Math.abs(xb - r.x);
        if (dist < BEAM) catchRunner(r, dist);
      }
      if (audit) for (const r of runners) if (r.caught < 0 && victimOf.get(r.idx) !== cycleI) audit.redMove = Math.max(audit.redMove, r.v);
    }
    if (audit) audit.pasos++;
  }

  function catchRunner(r: Runner, dist: number): void {
    audit?.catches.push({ t: Math.round(tAll * 1000) / 1000, idx: r.idx, v: Math.round(r.v * 1e4) / 1e4, dist: Math.round(dist * 1e4) / 1e4, cycle: cycleI });
    r.caught = tAll;
    r.v = 0;
    hitAt = tAll;
    // El que ven: un zumbido grave, y la cámara pega un golpe.
    if (tAll - lastCatchSnd > 0.12) {
      const first = tAll - lastCatchSnd > 0.6;
      lastCatchSnd = tAll;
      beep(note(1 + (r.idx % 3)), 0.2, "square", first ? 0.06 : 0.042);
      cam.punch(first ? 0.05 : 0.02).shake((first ? 7 : 3) * S.u());
    }
    const c = cycles[cycleI] as Cycle;
    const left = c.victims.filter((v) => (runners[v] as Runner).caught < 0).length;
    if (r === riv) say(T[getLang()].cLuzCaught(names[r.idx] ?? ""), 0.9);
    else if (left === 0 && c.victims.length > 3) say(T[getLang()].cLuzMany(c.victims.length), 0.6);
    else if (c.victims.length <= 3) say(T[getLang()].cLuzCaught(names[r.idx] ?? ""), 0.55 + 0.2 * (1 - alive().length / n));
  }

  function crown(): void {
    if (crowned) return;
    crowned = true;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.1).shake(12 * S.u());
  }
  skipFn = (): void => {
    if (light === "crown" || light === "dead") return;
    for (const r of runners) if (r !== win && r.caught < 0) {
      r.caught = 0;
      r.v = 0;
    }
    win.z = 1;
    win.v = 0;
    tAll = T_CROWN;
    light = "crown";
    crown();
  };

  /** Lo que se dice y lo que suena en cada momento. */
  function script(): void {
    once("intro", () => say(t("cLuzIntro"), 0.1));
    if (tAll >= 1.2) once("count", () => say(T[getLang()].cLuzCount(n), 0.15));
    const c = cycles[cycleI];
    if (!c) return;
    const k = `${cycleI}`;
    if (light === "green") {
      once(`g${k}`, () => {
        say(t(cycleI === NC - 1 && NC > 1 ? "cLuzGo" : "cLuzGreen"), 0.3 + 0.1 * cycleI);
        beep(note(9), 0.1, "triangle", 0.05);
        setTimeout(() => beep(note(12), 0.14, "triangle", 0.05), 90);
      });
      // El canto del Faro mientras está de espaldas: seis notas que suben,
      // cada vez más rápido. Cuando termina, se da vuelta.
      const f = (tAll - c.g0) / (c.g1 - c.g0);
      const want = Math.min(6, Math.floor(f * 6.2));
      for (let i = 0; i < want; i++) once(`c${k}-${i}`, () => beep(note([5, 7, 9, 10, 12, 14][i] as number), 0.13, "triangle", 0.045));
      // Pasos: un golpecito cada tanto, más seguido cuanto más corren.
      if (tAll - lastStep > 0.22) {
        lastStep = tAll;
        beep(note(3 + (Math.floor(tAll * 10) % 2)), 0.05, "sine", 0.022);
      }
    } else if (light === "warn") {
      once(`w${k}`, () => {
        say(t("cLuzRed"), 0.6 + 0.08 * cycleI);
        beep(note(14), 0.08, "square", 0.05);
        setTimeout(() => beep(note(2), 0.22, "sine", 0.07), 70);
        cam.punch(0.05);
      });
    } else if (light === "red") {
      once(`r${k}`, () => beepFor(note(1), RED + c.hold, "sawtooth", 0.022));
      if (c.hold > 0 && tAll >= c.r0 + ((win.x + 1.05) / 2.1) * (RED - 0.2) - 0.05) {
        once("wobble", () => {
          saidWobble = true;
          say(T[getLang()].cLuzWobble(names[winnerIdx] ?? ""), 0.85);
          beep(note(13), 0.1, "square", 0.05);
        });
      }
      if (saidWobble && !saidSaved && tAll >= c.r1 - 0.5) {
        saidSaved = true;
        say(T[getLang()].cLuzSaved(names[winnerIdx] ?? ""), 0.9);
        beep(note(10), 0.14, "triangle", 0.05);
      }
    } else if (light === "back" && cycleI === NC - 1) {
      once("final", () => {
        if (duo && n > 2 && story.arc !== "tapada") say(T[getLang()].cLuzLast(names[winnerIdx] ?? "", names[rivalIdx] ?? ""), 0.8);
      });
    }
    if (light === "final") once("finalgo", () => say(t("cLuzGo"), 0.85));
  }

  /* ---------------------------------------------------------------- escena */
  let sky!: Graphics;
  let field!: Graphics;
  let beamG!: Graphics;
  let runLayer!: Container;
  let faro!: Container;
  let faroHead!: Container;
  let headBack!: Container;
  let headFront!: Container;
  let eyeGlow!: Graphics;
  let tint!: Graphics;
  let lamp!: Graphics;
  let chips!: Container;
  let counter!: Text;
  let counterBox!: Graphics;
  let hitAt = -9;

  interface Geo { W: number; H: number; k: number; cx: number; yH: number; f: number; hw: number; back: number }
  const geo = (): Geo => {
    const W = S.sw(), H = S.sh(), k = S.u();
    const portrait = S.portrait();
    // En un celular la cancha es más angosta y la cámara va más cerca.
    const hw = portrait ? 4.2 : 7;
    return { W, H, k, cx: W / 2, yH: H * 0.3, f: (W * 0.55 * 3) / hw, hw, back: portrait ? 4 : 5.2 };
  };
  let G = geo();
  /** De la cancha a la pantalla: la posición, y cuántos píxeles mide un metro ahí. */
  const project = (x: number, z: number): { x: number; y: number; s: number; ok: boolean } => {
    const zc = z * LEN - camZ;
    if (zc < 0.6) return { x: 0, y: 0, s: 0, ok: false };
    return { x: G.cx + (G.f * x * G.hw) / zc, y: G.yH + (G.f * CAM_H) / zc, s: G.f / zc, ok: true };
  };
  const Z_FARO = (LEN + 1.5) / LEN;

  function makeRunner(r: Runner): Container {
    const c = new Container();
    const col = S.color(r.idx);
    c.addChild(new Graphics().ellipse(0, 0, 0.34, 0.08).fill({ color: 0x000000, alpha: 0.3 }));
    // Las piernas, de espaldas: se acortan cuando se levantan hacia atrás.
    const leg = (x: number): Container => {
      const l = new Container();
      l.position.set(x, -0.88);
      l.addChild(new Graphics()
        .roundRect(-0.085, 0, 0.17, 0.84, 0.07).fill(0x2b2d42).stroke({ width: 0.03, color: INK })
        .roundRect(-0.11, 0.76, 0.22, 0.13, 0.05).fill(0xf4f1ea).stroke({ width: 0.03, color: INK }));
      return l;
    };
    const legL = leg(-0.12), legR = leg(0.12);
    c.addChild(legL, legR);
    const torso = new Container();
    torso.position.set(0, -0.86);
    const arm = (x: number): Container => {
      const a = new Container();
      a.position.set(x, -0.52);
      a.addChild(new Graphics()
        .roundRect(-0.065, 0, 0.13, 0.52, 0.06).fill(col).stroke({ width: 0.03, color: INK })
        .circle(0, 0.56, 0.07).fill(0xc68a5c).stroke({ width: 0.025, color: INK }));
      return a;
    };
    const armL = arm(-0.29), armR = arm(0.29);
    const body = new Graphics()
      // La polera con el color de la persona, y el dorsal con su número.
      .roundRect(-0.27, -0.62, 0.54, 0.66, 0.13).fill(col).stroke({ width: 0.035, color: INK })
      .rect(-0.16, -0.5, 0.32, 0.27).fill(0xffffff).stroke({ width: 0.025, color: INK });
    // La cabeza de espaldas: el pelo, las orejas, y a veces un chullo.
    const head = new Graphics().circle(-0.15, -0.8, 0.045).fill(0xc68a5c).circle(0.15, -0.8, 0.045).fill(0xc68a5c).circle(0, -0.8, 0.15).fill(r.hair).stroke({ width: 0.03, color: INK });
    if (r.chullo) {
      const cc = S.color(r.idx + 2);
      head.poly([-0.16, -0.84, -0.15, -1.0, 0, -1.05, 0.15, -1.0, 0.16, -0.84]).fill(cc).stroke({ width: 0.03, color: INK })
        .rect(-0.155, -0.92, 0.31, 0.04).fill(0xffffff)
        .poly([-0.16, -0.84, -0.17, -0.7, -0.12, -0.72]).fill(cc).poly([0.16, -0.84, 0.17, -0.7, 0.12, -0.72]).fill(cc)
        .circle(0, -1.08, 0.05).fill(YELLOW).stroke({ width: 0.02, color: INK });
    }
    torso.addChild(armL, armR, body, head);
    if (n <= 60) {
      const num = S.text(String(r.idx + 1), { fontFamily: MONO, fontSize: 40, fontWeight: "900", fill: INK });
      num.anchor.set(0.5);
      num.scale.set(0.0055);
      num.position.set(0, -0.365);
      torso.addChild(num);
    }
    // La cruz roja del "¡te vi!", sobre el dorsal.
    const mark = new Graphics()
      .moveTo(-0.14, -0.52).lineTo(0.14, -0.2).moveTo(0.14, -0.52).lineTo(-0.14, -0.2).stroke({ width: 0.07, color: 0xd7263d, cap: "round" });
    mark.visible = false;
    torso.addChild(mark);
    c.addChild(torso);
    r.legL = legL;
    r.legR = legR;
    r.armL = armL;
    r.armR = armR;
    r.torso = torso;
    r.mark = mark;
    return c;
  }

  /**
   * El Faro, en metros, con la base en el cero. La cabeza gira: de espaldas
   * muestra la lámpara verde, de frente el ojo rojo.
   */
  function makeFaro(): Container {
    const c = new Container();
    const band = [0xe93d9c, 0x00a896];
    const g = new Graphics()
      .ellipse(0, 0, 2.2, 0.35).fill({ color: 0x000000, alpha: 0.35 })
      .roundRect(-1.5, -1.1, 3, 1.1, 0.2).fill(0x6b6480).stroke({ width: 0.08, color: INK })
      .poly([-1.0, -1.1, 1.0, -1.1, 0.7, -6.2, -0.7, -6.2]).fill(CREAM).stroke({ width: 0.09, color: INK, join: "round" });
    for (let b = 0; b < 3; b++) {
      const y0 = -1.9 - b * 1.45, y1 = y0 - 0.55;
      const w0 = 1.0 - ((1.1 - y0 * -1) / 5.1) * 0.3, w1 = 1.0 - ((1.1 - y1 * -1) / 5.1) * 0.3;
      g.poly([-w0, y0, w0, y0, w1, y1, -w1, y1]).fill(band[b % 2] as number);
    }
    g.rect(-0.18, -2.9, 0.36, 0.55).fill(INK).rect(-0.14, -2.86, 0.28, 0.47).fill(YELLOW)
      // El balcón.
      .rect(-1.05, -6.35, 2.1, 0.22).fill(INK)
      .moveTo(-1.0, -6.35).lineTo(-1.0, -6.85).moveTo(-0.5, -6.35).lineTo(-0.5, -6.85).moveTo(0, -6.35).lineTo(0, -6.85)
      .moveTo(0.5, -6.35).lineTo(0.5, -6.85).moveTo(1.0, -6.35).lineTo(1.0, -6.85).moveTo(-1.05, -6.85).lineTo(1.05, -6.85)
      .stroke({ width: 0.07, color: INK });
    c.addChild(g);
    // La cabeza, que gira sobre el balcón.
    const head = new Container();
    head.position.set(0, -6.4);
    const shell = (): Graphics => new Graphics()
      .roundRect(-0.75, -1.5, 1.5, 1.5, 0.2).fill(0x2a2440).stroke({ width: 0.08, color: INK })
      .poly([-0.95, -1.5, 0.95, -1.5, 0, -2.3]).fill(0xd7263d).stroke({ width: 0.08, color: INK, join: "round" })
      .circle(0, -2.35, 0.14).fill(YELLOW).stroke({ width: 0.05, color: INK });
    const back = new Container();
    back.addChild(shell(), new Graphics()
      // De espaldas: la lámpara verde, redonda.
      .circle(0, -0.75, 0.62).fill({ color: 0x3ddc84, alpha: 0.3 })
      .circle(0, -0.75, 0.46).fill(0x3ddc84).stroke({ width: 0.07, color: INK })
      .circle(-0.15, -0.9, 0.12).fill({ color: 0xffffff, alpha: 0.7 }));
    const front = new Container();
    front.addChild(shell(), new Graphics()
      // De frente: el ojo rojo, con su párpado y su pupila.
      .ellipse(0, -0.75, 0.62, 0.42).fill(0xfff4f0).stroke({ width: 0.08, color: INK })
      .circle(0, -0.75, 0.3).fill(0xd7263d).stroke({ width: 0.05, color: INK })
      .circle(0, -0.75, 0.13).fill(INK)
      .circle(-0.09, -0.84, 0.06).fill(0xffffff)
      .poly([-0.7, -1.12, 0.7, -1.12, 0.5, -1.25, -0.5, -1.25]).fill(0x2a2440));
    front.visible = false;
    const glow = new Graphics();
    head.addChild(glow, back, front);
    c.addChild(head);
    faroHead = head;
    headBack = back;
    headFront = front;
    eyeGlow = glow;
    return c;
  }

  function build(): void {
    G = geo();
    const { W, H, k } = G;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    sky = new Graphics();
    S.bg.addChild(sky);
    field = new Graphics();
    beamG = new Graphics();
    runLayer = new Container();
    runLayer.sortableChildren = true;
    faro = makeFaro();
    S.scene.addChild(field, faro, beamG, runLayer);
    for (const r of runners) {
      r.view?.destroy({ children: true });
      r.view = makeRunner(r);
      runLayer.addChild(r.view);
      r.chip?.destroy({ children: true });
      r.chip = undefined;
    }
    // La interfaz: el tinte de la luz roja, el semáforo y la cuenta.
    tint = new Graphics();
    lamp = new Graphics();
    chips = new Container();
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    S.hud.addChild(tint, lamp, chips, box);
    void W;
    void H;
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  cam.cut(G.cx, G.H / 2, 1);

  /** El Faro de frente (0 de espaldas, 1 de frente), con el giro de la cabeza. */
  function facing(): number {
    const c = cycles[cycleI];
    if (light === "crown") return 1;
    if (!c) return 0;
    if (light === "warn") return ease.inOutCubic(clamp((tAll - c.g1) / WARN, 0, 1));
    if (light === "red") return 1;
    if (light === "back") return 1 - ease.inOutCubic(clamp((tAll - c.r1) / BACK, 0, 1));
    return 0;
  }

  function direct(): void {
    const { cx, H } = G;
    const pf = project(0, Z_FARO);
    const c = cycles[cycleI];
    if (light === "warn" && pf.ok) {
      // Se da vuelta: la cámara va a la cabeza del Faro.
      cam.lookAt(pf.x, pf.y - 7 * pf.s, 1.5, 6);
    } else if (light === "red" && c) {
      // Con el haz: la cámara lo sigue por la cancha, cerca del grupo.
      const xb = beamAt(c, tAll);
      const zs = alive().map((r) => r.z).sort((a, b) => a - b);
      const zm = zs[Math.floor(zs.length / 2)] ?? 0.5;
      const p = project(xb * 0.8, zm);
      const onWin = c.hold > 0 && saidWobble && !saidSaved;
      if (onWin) {
        const pw = project(win.x, win.z);
        cam.lookAt(pw.x, pw.y - 1.2 * pw.s, 1.9, 5);
      } else if (p.ok) cam.lookAt(p.x, p.y - 0.8 * p.s, 1.25, 3);
    } else if (light === "final" || light === "crown") {
      // El último verde, encima de la ganadora: de lejos y chica, con el
      // resultado ya sabido, no pasaba nada.
      const pw = project(win.x, win.z);
      if (pw.ok) cam.lookAt(pw.x, pw.y - 1.4 * pw.s, light === "crown" ? 1.45 : 1.7, 3);
    } else cam.lookAt(cx, H * 0.5, 1, 2);
  }

  function draw(now: number): void {
    const { W, H, k, cx, yH } = G;
    // El cielo al atardecer, con estrellas que aparecen de a poco.
    sky.clear().rect(0, 0, W, H).fill(S.dark ? 0x141026 : 0x2b2250);
    sky.rect(0, yH * 0.55, W, yH * 0.45 + 2).fill({ color: 0xe93d9c, alpha: 0.18 });
    sky.rect(0, yH * 0.8, W, yH * 0.2 + 2).fill({ color: 0xff7a1a, alpha: 0.22 });
    for (let i = 0; i < 40; i++) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(now * 1.3 + i));
      sky.circle(hash(i, 1) * W, hash(i, 2) * yH * 0.7, (0.8 + hash(i, 3) * 1.4) * k).fill({ color: 0xffffff, alpha: 0.6 * tw });
    }
    // La cancha: los cerros en el horizonte, franjas de pasto en
    // perspectiva, las líneas y la tiza. Los cerros van en la escena, con el
    // pasto: si quedaban en el fondo fijo, al acercarse la cámara el borde del
    // pasto bajaba y entre los dos aparecía una franja vacía.
    field.clear();
    const hills: number[] = [-W, yH + 2];
    for (let i = 0; i <= 36; i++) hills.push(-W + (i / 36) * W * 3, yH - (18 + 26 * hash(i, 9)) * k);
    hills.push(W * 2, yH + 2);
    field.poly(hills).fill(S.dark ? 0x241c3a : 0x3a2e63);
    // El pasto sigue más allá de la pantalla: la cámara se corre y se acerca.
    field.rect(-W, yH, W * 3, H * 2).fill(S.dark ? 0x1d5a34 : 0x2f7d45);
    const edge = (z: number): { l: number; r: number; y: number } | null => {
      const a = project(-1, z), b = project(1, z);
      return a.ok ? { l: a.x, r: b.x, y: a.y } : null;
    };
    for (let m = 0; m < LEN + 4; m += 2) {
      const e0 = edge(m / LEN), e1 = edge(Math.min(LEN + 4, m + 2) / LEN);
      if (!e0 || !e1) continue;
      if ((m / 2) % 2 === 0) field.poly([e0.l, e0.y, e0.r, e0.y, e1.r, e1.y, e1.l, e1.y]).fill({ color: 0x000000, alpha: 0.08 });
    }
    const chalk = S.dark ? 0xf1ece2 : 0xffffff;
    const eNear = edge(Math.max(0, (camZ + 0.7) / LEN));
    const eFar = edge((LEN + 4) / LEN);
    if (eNear && eFar) {
      field.moveTo(eNear.l, eNear.y).lineTo(eFar.l, eFar.y).moveTo(eNear.r, eNear.y).lineTo(eFar.r, eFar.y).stroke({ width: 3 * k, color: chalk, alpha: 0.7 });
    }
    const start = edge(0);
    if (start) field.moveTo(start.l, start.y).lineTo(start.r, start.y).stroke({ width: 5 * k, color: chalk, alpha: 0.85 });
    // La meta, a los pies del Faro: una franja de cuadros.
    const m0 = edge(1), m1 = edge(1 + 0.6 / LEN);
    if (m0 && m1) {
      const cols = 16;
      for (let i = 0; i < cols; i++) {
        const f0 = i / cols, f1 = (i + 1) / cols;
        field.poly([m0.l + (m0.r - m0.l) * f0, m0.y, m0.l + (m0.r - m0.l) * f1, m0.y, m1.l + (m1.r - m1.l) * f1, m1.y, m1.l + (m1.r - m1.l) * f0, m1.y])
          .fill(i % 2 ? 0xffffff : INK);
      }
    }

    // El Faro, que gira la cabeza.
    const pf = project(0, Z_FARO);
    faro.visible = pf.ok;
    if (pf.ok) {
      faro.position.set(pf.x, pf.y);
      faro.scale.set(pf.s);
      const fc = facing();
      // Girar es achicarse de costado y volver: de espaldas a de frente en la mitad.
      faroHead.scale.x = Math.max(0.05, Math.abs(Math.cos(fc * Math.PI)));
      headBack.visible = fc < 0.5;
      headFront.visible = fc >= 0.5;
      faroHead.rotation = Math.sin(tAll * 1.2) * 0.02;
      eyeGlow.clear();
      const glowCol = fc >= 0.5 ? 0xd7263d : 0x3ddc84;
      const pulse = light === "intro" ? (Math.floor(tAll * 2.5) % 2 === 0 ? 0.45 : 0.08) : 0.25 + 0.1 * Math.sin(now * 5);
      eyeGlow.circle(0, -0.75, 1.3).fill({ color: glowCol, alpha: pulse }).circle(0, -0.75, 0.95).fill({ color: glowCol, alpha: pulse });
      if (light === "crown") eyeGlow.clear().circle(0, -0.75, 1.5).fill({ color: YELLOW, alpha: 0.4 });
    }

    // El haz de la luz roja: un cono que baja del ojo y barre la cancha.
    beamG.clear();
    const c = cycles[cycleI];
    if (light === "red" && c && pf.ok) {
      const xb = beamAt(c, tAll);
      const ex = pf.x, ey = pf.y - 7.15 * pf.s;
      const zNear = Math.max(0.02, (camZ + 1.2) / LEN);
      const a = project(xb - BEAM * 1.3, zNear), b = project(xb + BEAM * 1.3, zNear);
      if (a.ok && b.ok) {
        beamG.poly([ex - 0.25 * pf.s, ey, ex + 0.25 * pf.s, ey, b.x, b.y, a.x, a.y]).fill({ color: 0xff3b3b, alpha: 0.16 });
        // La mancha en el pasto, donde mira.
        const z0 = Math.max(zNear, 0), steps = 10;
        const pts: number[] = [];
        for (let i = 0; i <= steps; i++) {
          const p = project(xb - BEAM, z0 + ((1 - z0) * i) / steps);
          if (p.ok) pts.push(p.x, p.y);
        }
        for (let i = steps; i >= 0; i--) {
          const p = project(xb + BEAM, z0 + ((1 - z0) * i) / steps);
          if (p.ok) pts.push(p.x, p.y);
        }
        if (pts.length >= 6) beamG.poly(pts).fill({ color: 0xff3b3b, alpha: 0.2 });
      }
    }

    // Los corredores, por profundidad: el más cerca tapa al de atrás.
    const running = light === "green" || light === "final";
    for (const r of runners) {
      const v = r.view as Container;
      const p = project(r.x, r.z);
      v.visible = p.ok;
      if (!p.ok) continue;
      v.zIndex = -r.z;
      v.position.set(p.x, p.y);
      v.scale.set(p.s);
      const legL = r.legL as Container, legR = r.legR as Container, armL = r.armL as Container, armR = r.armR as Container;
      const torso = r.torso as Container;
      if (r.caught >= 0) {
        // Lo vieron: se sienta en el pasto, con la cruz en la espalda.
        const f = r.caught === 0 ? 1 : ease.outCubic(clamp((tAll - r.caught) / 0.35, 0, 1));
        legL.visible = legR.visible = f < 0.5;
        torso.y = -0.86 + 0.62 * f;
        torso.rotation = 0;
        armL.rotation = 0.5 * f;
        armR.rotation = -0.5 * f;
        (r.mark as Graphics).visible = true;
        // Se apagan al rato, y del todo cuando la cámara los pasa: si no, los
        // sentados quedaban enormes adelante y tapaban la carrera.
        const zc = r.z * LEN - camZ;
        v.alpha = (1 - 0.6 * clamp((tAll - r.caught - 0.8) / 0.6, 0, 1)) * clamp((zc - 3) / 2, 0, 1);
        v.visible = v.alpha > 0.02;
        continue;
      }
      legL.visible = legR.visible = true;
      (r.mark as Graphics).visible = false;
      v.alpha = 1;
      // Corriendo: piernas y brazos alternados, y el cuerpo que sube y baja.
      // Quieto: queda como estatua, a mitad del paso en que frenó.
      const g = Math.min(1, r.v / 0.15);
      const lift = (o: number): number => Math.max(0, Math.sin(r.ph + o));
      legL.scale.y = 1 - 0.38 * lift(0) * g;
      legR.scale.y = 1 - 0.38 * lift(Math.PI) * g;
      armL.rotation = Math.sin(r.ph) * 0.5 * g;
      armR.rotation = -Math.sin(r.ph) * 0.5 * g;
      torso.y = -0.86 - Math.abs(Math.sin(r.ph)) * 0.06 * g;
      // El que no alcanzó a frenar se tambalea y agita los brazos.
      const sw = r.sway;
      torso.rotation = (running ? 0 : -0.06 * g) + Math.sin(tAll * 13 + r.idx) * 0.14 * sw;
      if (sw > 0.05) {
        armL.rotation += Math.sin(tAll * 17) * 1.1 * sw;
        armR.rotation -= Math.sin(tAll * 15 + 1) * 1.1 * sw;
      }
      // En la presentación calientan: saltitos en el lugar y los brazos sueltos.
      if (light === "intro") {
        const hop = Math.abs(Math.sin(tAll * 5 + r.idx * 1.3)) * 0.08;
        v.position.set(p.x, p.y - hop * p.s);
        armL.rotation = Math.sin(tAll * 5 + r.idx) * 0.3;
        armR.rotation = -Math.sin(tAll * 5 + r.idx) * 0.3;
      }
      // La ganadora, al tocar el Faro, salta con los brazos arriba.
      if (light === "crown" && r === win) {
        const j = Math.abs(Math.sin(tAll * 7)) * 0.35;
        v.position.set(p.x, p.y - j * p.s);
        armL.rotation = 2.7;
        armR.rotation = -2.7;
      }
    }

    // La interfaz: el semáforo arriba a la derecha y el tinte rojo.
    const red = light === "red" || ((light === "warn" || light === "back") && facing() >= 0.5);
    tint.clear();
    if (light === "red") tint.rect(0, 0, W, H).fill({ color: 0xff0000, alpha: 0.045 + 0.02 * Math.sin(now * 8) });
    const hit = tAll - hitAt;
    if (hit >= 0 && hit < 0.15) tint.rect(0, 0, W, H).fill({ color: 0xff3b3b, alpha: 0.18 * (1 - hit / 0.15) });
    lamp.clear();
    const lx = W - 44 * k, ly = S.top() + 16 * k;
    lamp.roundRect(lx - 22 * k + 4 * k, ly + 4 * k, 44 * k, 84 * k, 12 * k).fill(INK)
      .roundRect(lx - 22 * k, ly, 44 * k, 84 * k, 12 * k).fill(0x221a33).stroke({ width: 3 * k, color: INK })
      .circle(lx, ly + 22 * k, 14 * k).fill(red ? 0xff3b3b : 0x4a2020).stroke({ width: 2.5 * k, color: INK })
      .circle(lx, ly + 62 * k, 14 * k).fill(!red && light !== "intro" ? 0x3ddc84 : 0x1d4a2e).stroke({ width: 2.5 * k, color: INK });
    if (red) lamp.circle(lx, ly + 22 * k, 22 * k).fill({ color: 0xff3b3b, alpha: 0.25 });
    else if (light !== "intro") lamp.circle(lx, ly + 62 * k, 22 * k).fill({ color: 0x3ddc84, alpha: 0.25 });

    // Los nombres, cuando quedan pocos.
    const live = alive();
    for (const r of runners) if (r.chip) r.chip.visible = false;
    if (live.length <= 8 && light !== "crown" && !(story.arc === "tapada" && light !== "final")) {
      const at = live
        .map((r) => {
          const p = project(r.x, r.z);
          return { r, p: cam.toScreen(p.x + 0.3 * p.s, p.y - 2.1 * p.s, W, H), ok: p.ok };
        })
        .filter((a) => a.ok)
        .sort((a, b) => a.p.y - b.p.y);
      let prev = -Infinity;
      for (const { r, p } of at) {
        const chip = (r.chip ??= chips.addChild(S.chip(names[r.idx] ?? "", S.portrait() ? 0.8 : 1)));
        chip.visible = true;
        const cy = Math.max(p.y - 14 * k, prev + (S.portrait() ? 21 : 26) * k);
        prev = cy;
        chip.position.set(Math.min(p.x, W - chip.width - 10 * k), cy);
      }
    }
    counter.text = `${t("cLuzLeft")}  ${live.length} / ${n}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    if (light === "crown") crownUI.at(tAll - T_CROWN);
    void cx;
  }

  S.run((dt, now) => {
    tAll += dt;
    // La luz de ahora, según el plan.
    if (light !== "crown" && light !== "dead") {
      if (tAll < T_INTRO) light = "intro";
      else if (tAll >= T_CROWN) light = "crown";
      else if (tAll >= T_FINAL) light = "final";
      else {
        while (cycleI < NC - 1 && tAll >= (cycles[cycleI] as Cycle).b1) cycleI++;
        const c = cycles[cycleI] as Cycle;
        light = tAll < c.g1 ? "green" : tAll < c.r0 ? "warn" : tAll < c.r1 ? "red" : "back";
        // Si el haz pasó y quedó alguien por agarrar (no debería), se lo ve al terminar.
        if (light === "back") for (const v of c.victims) {
          const r = runners[v] as Runner;
          if (r.caught < 0) catchRunner(r, 1);
        }
      }
    }
    script();
    sayPending();
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    // La cámara avanza detrás del grupo.
    const zs = alive().map((r) => r.z).sort((a, b) => a - b);
    const lead = zs[zs.length - 1] ?? 0;
    const med = zs[Math.floor(zs.length / 2)] ?? 0;
    // En la presentación la cámara entra despacio desde atrás: sin eso, con
    // pocos corredores y el juego estirado, la pantalla quedaba quieta.
    const want = light === "intro" ? -8 + 3.5 * ease.inOutCubic(clamp(tAll / T_INTRO, 0, 1)) : clamp(((med + lead) / 2) * LEN - G.back, -4.5, (Z_FARO * LEN) - 11);
    camZ += (want - camZ) * (1 - Math.exp(-(light === "intro" ? 5 : 1.6) * dt));
    if (light === "crown") {
      crown();
      tHold += dt * paceFactor();
    }
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tHold >= WINNER_HOLD) {
      light = "dead";
      if (audit) audit.done = true;
      S.cleanup();
    }
  });
}
