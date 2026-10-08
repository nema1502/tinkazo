import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { enOrden, writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";
import { layoutLabels, type LabelItem } from "./pinata-labels";
import { OUT_HOLD, counterText, estimateTagSize, outTreatment, planRollCall, rollCallAt, selectTags, tagBudget, tagName, type TagCandidate } from "./oruro-tags";

/**
 * Carnaval de Oruro.
 *
 * La entrada: una comparsa de la Diablada baila por las cuadras, entre las
 * graderías llenas, hacia el Santuario del Socavón. En cada arco de cuadra se
 * quedan algunos bailarines, que salen a la vereda y saludan. Los dos últimos
 * hacen un contrapunto frente al Socavón, y el que llega entra con campanas y
 * cohetillos. La UNESCO lo declaró patrimonio en 2001: más de 28.000
 * bailarines y 10.000 músicos.
 *
 * El orden en que se quedan está sembrado con la ronda, y la ganadora va
 * primera en esa lista: nunca se queda. Los arcos del director de emoción:
 *
 * - **susto**: en la última cuadra a la ganadora casi se le cae la máscara.
 * - **remontada**: arranca en la última fila y en cada cuadra avanza.
 * - **duelo**: el contrapunto frente al Socavón dura un paso más.
 * - **tapada**: baila en el medio de la comparsa y nadie la nombra.
 *
 * Desde el 29 de septiembre de 2026 el diablo baila entero: los brazos suben y
 * bajan al ritmo (el derecho con su tridente), las piernas se levantan de a
 * una con la rodilla alta del paso de la Diablada, la pechera brilla con sus
 * lentejuelas y la máscara tiene cuernos anillados y la culebra en la frente.
 * Antes el cuerpo era un solo dibujo quieto que saltaba.
 */

const DT = 1 / 120;
const T_START = 2.2;
const WALK = 2.1;
const STOP = 1.3;
const MASKS = [0xd52b1e, 0xd52b1e, 0x1f7a3a, 0x1c64c8];
/** Longest name on a tag, in characters. */
const TAG_CHARS = 12;
/** Name tags are at least this big on screen (px of text), whatever the screen. */
const TAG_FONT_PX = 14;
/** The tag roll call starts here (s); it may outlast the intro, but never delays the game. */
const ROLL_T0 = 0.25;

type Phase = "intro" | "walk" | "stop" | "duel" | "crown" | "dead";
interface Dancer {
  idx: number; x: number; y: number; slot: number; alive: boolean; left: number; wx: number; wy: number;
  ph: number; view?: Container; mask?: Container; cape?: Graphics; chip?: Container; strike?: Graphics; tagW?: number;
  /** El borde amarillo del chip de un co-ganador que se queda en una cuadra. */
  prize?: Graphics;
  /** Las partes que bailan: brazos, piernas y el brillo de la pechera. */
  armL?: Container; armR?: Container; legL?: Container; legR?: Container; glint?: Graphics;
}

export async function oruroPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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

  // Quién se queda en cada cuadra: primero los del fondo de la lista.
  const rest = names.map((_, i) => i).filter((i) => i !== winnerIdx && i !== rivalIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const leaveOrder = [...rest].reverse();
  const K = n <= 2 ? 1 : n <= 5 ? 2 : n <= 14 ? 3 : n <= 50 ? 4 : 5;
  const survivors = (i: number): number => (i >= K ? Math.min(2, n) : Math.min(n, 2 + Math.round((n - 2) * Math.pow(1 - i / K, 1.5))));
  const leavesAt: number[][] = [];
  {
    let gone = 0;
    for (let i = 1; i <= K; i++) {
      const off = n - survivors(i) - gone;
      leavesAt.push(leaveOrder.slice(gone, gone + Math.max(0, off)));
      gone += Math.max(0, off);
    }
  }
  const arrive = (i: number): number => T_START + i * WALK + (i - 1) * STOP;
  const T_SOCAVON = arrive(K) + STOP + WALK;
  const duelDur = story.arc === "duelo" ? 4.2 : 3.2;
  const T_CROWN = T_SOCAVON + (n >= 2 ? duelDur : 0.6);
  setGameLength(T_CROWN, WINNER_HOLD);
  /**
   * Los saltos del contrapunto, en segundos desde el Socavón: cada uno llega
   * antes que el anterior y salta más alto, hasta la llegada. El último número
   * es cuándo termina el último salto. Antes saltaban cada 0,8 s, siempre a
   * la misma altura, y el clímax eran cinco segundos de lo mismo (auditoría
   * con capturas, 7 de octubre de 2026). Lo usan el sonido y el dibujo.
   */
  const JUMPS = story.arc === "duelo" ? [0, 0.75, 1.45, 2.05, 2.6, 3.05, 3.4] : [0, 0.75, 1.4, 1.95, 2.35, 2.7];
  /** Qué salto va a `td` segundos del Socavón y por dónde va, de 0 a 1; `b` es -1 entre saltos. */
  const jumpAt = (td: number): { b: number; f: number } => {
    for (let i = JUMPS.length - 2; i >= 0; i--) {
      const a = JUMPS[i] as number, e = JUMPS[i + 1] as number;
      if (td >= a) return td < e ? { b: i, f: (td - a) / (e - a) } : { b: -1, f: 0 };
    }
    return { b: -1, f: 0 };
  };
  const T_TRIP = arrive(K) + STOP + WALK * 0.45;

  // La formación: la ganadora en el medio si es tapada, al fondo si remonta.
  const order = names.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const wi = order.indexOf(winnerIdx);
  order.splice(wi, 1);
  if (story.arc === "remontada") order.push(winnerIdx);
  else if (story.arc === "tapada") order.splice(Math.floor(order.length / 2), 0, winnerIdx);
  else order.splice(Math.min(order.length, 1 + Math.floor(rng() * Math.min(4, order.length))), 0, winnerIdx);
  const dancers: Dancer[] = order.map((idx, slot) => ({ idx, x: 0, y: 0, slot, alive: true, left: -1, wx: 0, wy: 0, ph: hash(idx, 7) * 6 }));
  const byIdx = new Map(dancers.map((d) => [d.idx, d]));
  const win = byIdx.get(winnerIdx) as Dancer;
  const riv = byIdx.get(rivalIdx) as Dancer;

  let phase: Phase = "intro";
  let tAll = 0, acc = 0, tHold = 0, saidUpTo = -1, stopsDone = 0, stepTick = 0, crowned = false, tripSaid = false, lastSaid = false, arrived = false;
  /** Cuántos saltos del contrapunto ya sonaron. */
  let jumpsDone = 0;
  /** Los que llevan el nombre entero en su chip: los dos del contrapunto. */
  const fullTag = new Set<number>();
  const alive = (): Dancer[] => dancers.filter((d) => d.alive);

  /* -------------------------------------------------------------- geometría */
  const G = (): { w: number; h: number; k: number; seg: number; streetTop: number; streetBot: number; scale: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const streetTop = h * 0.5, streetBot = h - S.bottom() - 16 * k;
    return { w, h, k, seg: w * 0.95, streetTop, streetBot, scale: clamp(Math.sqrt(40 / Math.max(2, n)), 0.35, 1.25) * k };
  };
  /** Dónde va la cabeza de la comparsa, en x del mundo. */
  function headX(tt: number): number {
    const g = G();
    if (tt < T_START) return 0;
    for (let i = 1; i <= K + 1; i++) {
      const a0 = i === 1 ? T_START : arrive(i - 1) + STOP;
      const a1 = i <= K ? arrive(i) : T_SOCAVON;
      if (tt < a1) return ((i - 1) + ease.inOutCubic(clamp((tt - a0) / (a1 - a0), 0, 1))) * g.seg;
      if (i <= K && tt < arrive(i) + STOP) return i * g.seg;
    }
    return (K + 1) * g.seg;
  }

  function relayout(): void {
    // Los que siguen se reacomodan en filas a lo ancho de la calle.
    const list = alive().sort((a, b) => a.slot - b.slot);
    list.forEach((d, i) => { d.slot = i; });
  }

  function slotPos(d: Dancer, hx: number): { x: number; y: number } {
    const g = G();
    const m = alive().length;
    const depth = clamp(Math.ceil(Math.sqrt(m / 3)), 1, 5);
    const col = Math.floor(d.slot / depth), row = d.slot % depth;
    const dx = 58 * g.scale;
    return { x: hx - col * dx - (row % 2) * dx * 0.5, y: g.streetTop + ((row + 0.5) / depth) * (g.streetBot - g.streetTop) * 0.8 + (g.streetBot - g.streetTop) * 0.1 };
  }

  /* ---------------------------------------------------------------- física */
  function step(dt: number): void {
    const hx = headX(tAll);
    const g = G();
    for (const d of dancers) {
      if (d.alive) {
        let target = slotPos(d, hx);
        if (phase === "duel" || phase === "crown") {
          // El contrapunto: frente al Socavón, cara a cara.
          const sx = (K + 1) * g.seg;
          const my = (g.streetTop + g.streetBot) / 2;
          if (d === win) target = { x: sx - 40 * g.scale, y: my };
          else if (d === riv) target = { x: sx + 70 * g.scale, y: my + 10 * g.scale };
          // Llegó: el que gana camina hasta la puerta del Socavón. Antes la que
          // subía a la puerta era la rival, y con las campanas sonando parecía
          // que entraba la que perdió.
          if (d === win && (arrived || phase === "crown")) target = { x: sx + 170 * g.k, y: g.streetTop + 24 * g.k };
        }
        const sp = Math.min(1, dt * 4);
        d.x += (target.x - d.x) * sp;
        d.y += (target.y - d.y) * sp;
      } else {
        // Los que se quedaron salen a la vereda de arriba y ahí se quedan.
        const sp = Math.min(1, dt * 3);
        d.x += (d.wx - d.x) * sp;
        d.y += (d.wy - d.y) * sp;
      }
    }
  }

  function leave(ids: number[]): void {
    const g = G();
    for (const id of ids) {
      const d = byIdx.get(id) as Dancer;
      if (!d.alive) continue;
      d.alive = false;
      d.left = tAll;
      d.wx = d.x + (hash(id, 3) - 0.5) * 40 * g.k;
      d.wy = g.streetTop - 6 * g.k - hash(id, 4) * 10 * g.k;
      if (id === rivalIdx && tAll >= T_SOCAVON) {
        // Frente al Socavón la vereda es la puerta del santuario, y esa es del
        // que gana: la rival se abre hacia el público, a la derecha.
        d.wx = d.x + 240 * g.k;
        d.wy = g.streetTop + 30 * g.k;
      }
    }
    relayout();
  }

  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    // Las campanas del Socavón, después de la fanfarria: adentro quedaban
    // tapadas por notas que suenan al doble.
    [520, 700, 880, 1060].forEach((ms, i) => setTimeout(() => beep(note(i % 2 ? 12 : 14), 0.4, "triangle", 0.05), ms));
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (phase === "crown" || phase === "dead") return;
    leave(dancers.filter((d) => d.alive && d !== win && d !== riv).map((d) => d.idx));
    for (const d of dancers) if (!d.alive) { d.x = d.wx; d.y = d.wy; }
    tAll = T_CROWN;
    phase = "crown";
    crown();
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.05, () => S.say(t("cOruStart"), 0.1)],
      [1.2, () => S.say(T[getLang()].cOruCount(n), 0.15)],
      [T_START + 0.6, () => S.say(t("cOruDance"), 0.3)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    // El zapateo: un golpe cada medio tiempo mientras la comparsa avanza.
    if (phase === "walk" || phase === "intro") {
      const want = Math.floor(tAll / 0.42);
      while (stepTick < want) {
        stepTick++;
        // Con acento en el uno: dos notas alternadas, siempre igual, eran un tic.
        if (stepTick % 4 === 0) beep(note(0), 0.05, "square", 0.03);
        else beep(note(3), 0.05, "square", 0.02);
      }
    }
    while (stopsDone < K && tAll >= arrive(stopsDone + 1)) {
      stopsDone++;
      const ids = leavesAt[stopsDone - 1] ?? [];
      leave(ids);
      const last = stopsDone === K;
      const left = alive().length;
      // Los bronces de la banda en cada cuadra, cada vez más agudos y más
      // largos, y en la última con una voz más: eran el mismo acorde cuatro veces.
      const up = stopsDone - 1;
      beep(note(5 + 2 * up), 0.3 + 0.1 * up, "sawtooth", 0.035);
      beep(note(9 + 2 * up), 0.3 + 0.1 * up, "sawtooth", 0.028);
      // La de arriba en triángulo: con cinco cuadras llega a 2 kHz, y una sierra ahí chilla.
      if (last) beep(note(12 + 2 * up), 0.3 + 0.1 * up, "triangle", 0.03);
      cam.punch(0.05).shake(5 * S.u());
      // Si en esta cuadra se queda un co-ganador, se lo nombra con su premio.
      const premiados = ids.filter((i) => winners.indexOf(i) > 0);
      if (last && n > 2) S.say(t("cOruLast"), 0.8);
      else if (premiados.length) S.say(T[getLang()].cPrizeOut(premiados.map((i) => names[i] ?? "")), 0.6);
      else if (ids.length === 1) S.say(T[getLang()].cOruStay(names[ids[0] as number] ?? ""), 0.55);
      else S.say(T[getLang()].cOruStop(stopsDone, ids.length, left), 0.45 + 0.3 * (stopsDone / K));
      if (story.arc === "remontada") {
        // Avanza unas filas en cada cuadra.
        win.slot = Math.max(0, win.slot - Math.ceil(alive().length / K));
        const list = alive().filter((d) => d !== win).sort((a, b) => a.slot - b.slot);
        list.splice(Math.min(win.slot, list.length), 0, win);
        list.forEach((d, i) => { d.slot = i; });
      }
    }
    if (story.arc === "susto" && !tripSaid && tAll >= T_TRIP) {
      tripSaid = true;
      S.say(T[getLang()].cOruMask(names[winnerIdx] ?? ""), 0.85);
      beep(note(1), 0.1, "square", 0.05);
      setTimeout(() => beep(note(8), 0.12, "triangle", 0.045), 80);
      cam.shake(8 * S.u());
    }
    if (!lastSaid && tAll >= T_SOCAVON && n >= 2) {
      lastSaid = true;
      // En el contrapunto quedan dos y hay lugar: sus nombres van enteros, no
      // "Carlos Choq…". Los chips se rearman una vez.
      for (const d of [win, riv]) {
        fullTag.add(d.idx);
        d.chip?.destroy({ children: true });
        d.chip = undefined;
        d.strike = undefined;
        d.prize = undefined;
      }
      S.say(T[getLang()].cOruDuel(...enOrden(names[winnerIdx] ?? "", names[rivalIdx] ?? "")), 0.8);
    }
    // El contrapunto: saltan de a uno, alternados, cada salto más arriba y
    // con una nota más aguda, y una pisada.
    if (phase === "duel") {
      const td = tAll - T_SOCAVON;
      while (jumpsDone < JUMPS.length - 1 && td >= (JUMPS[jumpsDone] as number)) {
        const b = jumpsDone++;
        beep(note(b % 2 === 0 ? 7 + b : 9 + b), 0.14, "triangle", 0.05);
        beep(note(0), 0.06, "square", 0.035);
      }
      if (!arrived && td >= duelDur - 0.9) {
        arrived = true;
        leave([rivalIdx]);
        S.say(t("cOruArrive"), 0.95);
        // La campana de la llegada, con cuerpo: una sola nota sonaba a timbre.
        beep(note(12), 0.9, "triangle", 0.06);
        beep(note(17), 0.9, "triangle", 0.04);
        beep(note(19), 0.9, "triangle", 0.03);
      }
    }
  }

  /* ---------------------------------------------------------------- escena */
  let bgLayer!: Container;
  let facades!: Graphics;
  let lights!: Graphics;
  let arches!: Graphics;
  let church!: Graphics;
  let street!: Graphics;
  let crowdLayer!: Container;
  let dancerLayer!: Container;
  let fx!: Graphics;
  let chips!: Container;
  let leaders!: Graphics;
  let moreBox!: Graphics;
  let moreText!: ReturnType<PixiStage["text"]>;
  const shownNow = new Set<number>();
  const shownNext = new Set<number>();
  let lastHi = -1;
  let rollPlan: ReturnType<typeof planRollCall> | null = null;
  let counter!: ReturnType<PixiStage["text"]>;
  let counterBox!: Graphics;
  let blockText!: ReturnType<PixiStage["text"]>;
  const crowd: { sp: Sprite; ph: number; y: number }[] = [];

  function makeDancer(d: Dancer): Container {
    const c = new Container();
    const col = S.color(d.idx);
    const maskCol = MASKS[Math.floor(hash(d.idx, 9) * MASKS.length)] as number;
    // La capa, detrás: bordada con estrellas.
    const cape = new Graphics().poly([-16, -70, 16, -70, 30, -18, -30, -18]).fill(col).stroke({ width: 2.4, color: INK, join: "round" });
    for (let i = 0; i < 4; i++) cape.star(-12 + i * 8, -40 + (i % 2) * 10, 5, 3.2, 1.4).fill(YELLOW);
    c.addChild(cape);
    // Las piernas, cada una con su bota, que se levantan de a una.
    const leg = (x: number): Container => {
      const l = new Container();
      l.position.set(x, -14);
      l.addChild(new Graphics()
        .rect(-3.5, -6, 7, 12).fill(0x5b1a6e).stroke({ width: 1.6, color: INK })
        .roundRect(-5, 4, 11, 8, 2.5).fill(INK)
        .rect(-5, 4, 11, 2).fill(YELLOW));
      return l;
    };
    const legL = leg(-6), legR = leg(6);
    c.addChild(legL, legR);
    const body = new Graphics()
      // El faldellín de paneles, con sus bordes dorados.
      .poly([-15, -42, 15, -42, 20, -12, -20, -12]).fill(0x5b1a6e).stroke({ width: 2, color: INK })
      .moveTo(-7, -42).lineTo(-9, -12).moveTo(7, -42).lineTo(9, -12).stroke({ width: 1.5, color: YELLOW })
      .rect(-20, -15, 40, 3).fill(YELLOW)
      // La pechera dorada, con lentejuelas.
      .rect(-13, -68, 26, 27).fill(0xffc629).stroke({ width: 2, color: INK })
      .circle(-6, -62, 2).fill(0xe93d9c).circle(6, -62, 2).fill(0x00a896).circle(0, -46, 2).fill(0xe93d9c);
    c.addChild(body);
    // Las lentejuelas que brillan: se prenden y se apagan con el baile.
    const glint = new Graphics()
      .star(-8, -50, 4, 3.4, 1).fill(0xffffff)
      .star(8, -56, 4, 2.8, 0.9).fill(0xffffff);
    c.addChild(glint);
    // Los brazos, cada uno desde su hombro; el derecho con el tridente.
    const arm = (x: number, side: number, trident: boolean): Container => {
      const a = new Container();
      a.position.set(x, -66);
      const g = new Graphics()
        .poly([-3 * side, 0, -16 * side, -18, -11 * side, -21, 3 * side, -4]).fill(col).stroke({ width: 1.8, color: INK })
        .circle(-14 * side, -20, 3.4).fill(0xf1c7a0).stroke({ width: 1.4, color: INK });
      if (trident) {
        g.moveTo(-14 * side, -8).lineTo(-14 * side, -44).stroke({ width: 2.4, color: INK })
          .moveTo(-14 * side, -8).lineTo(-14 * side, -44).stroke({ width: 1.2, color: YELLOW })
          .moveTo(-20 * side, -38).lineTo(-20 * side, -48).moveTo(-8 * side, -38).lineTo(-8 * side, -48)
          .moveTo(-20 * side, -38).lineTo(-8 * side, -38).moveTo(-14 * side, -44).lineTo(-14 * side, -52)
          .stroke({ width: 2, color: YELLOW });
      }
      a.addChild(g);
      return a;
    };
    const armL = arm(-12, 1, false), armR = arm(12, -1, true);
    c.addChild(armL, armR);
    d.armL = armL;
    d.armR = armR;
    d.legL = legL;
    d.legR = legR;
    d.glint = glint;
    const av = new Sprite(S.face(names[d.idx] ?? ""));
    av.width = av.height = 14;
    av.anchor.set(0.5);
    av.position.set(0, -55);
    c.addChild(av);
    // La máscara: cara, ojos saltones, dientes y cuernos retorcidos.
    const mask = new Container();
    const m = new Graphics()
      // Los cuernos, retorcidos y con anillos.
      .poly([-12, -90, -26, -106, -34, -128, -22, -114, -8, -96]).fill(0xffc629).stroke({ width: 1.8, color: INK })
      .poly([12, -90, 26, -106, 34, -128, 22, -114, 8, -96]).fill(0xffc629).stroke({ width: 1.8, color: INK })
      .moveTo(-20, -104).lineTo(-15, -108).moveTo(-26, -114).lineTo(-21, -117).moveTo(20, -104).lineTo(15, -108).moveTo(26, -114).lineTo(21, -117)
      .stroke({ width: 1.4, color: 0xb8860b })
      .ellipse(0, -84, 15, 16).fill(maskCol).stroke({ width: 2.4, color: INK })
      // La culebra que baja por la frente, con su cabecita.
      .moveTo(0, -99).bezierCurveTo(-7, -96, 6, -93, 0, -90).stroke({ width: 2.6, color: 0x1f7a3a })
      .circle(0, -90, 2).fill(0x1f7a3a)
      // Los ojos saltones con su reborde de color.
      .circle(-6, -86, 5.6).fill(YELLOW).stroke({ width: 1.2, color: INK }).circle(6, -86, 5.6).fill(YELLOW).stroke({ width: 1.2, color: INK })
      .circle(-6, -86, 4).fill(0xffffff).circle(6, -86, 4).fill(0xffffff)
      .circle(-6, -86, 2.2).fill(0x1f7a3a).circle(6, -86, 2.2).fill(0x1f7a3a)
      .circle(-7, -87, 0.9).fill(0xffffff).circle(5, -87, 0.9).fill(0xffffff)
      .rect(-8, -77, 16, 5).fill(0xffffff).stroke({ width: 1.2, color: INK })
      .moveTo(-4, -77).lineTo(-4, -72).moveTo(0, -77).lineTo(0, -72).moveTo(4, -77).lineTo(4, -72).stroke({ width: 1, color: INK });
    mask.addChild(m);
    c.addChild(mask);
    d.mask = mask;
    d.cape = cape;
    return c;
  }

  function build(): void {
    const g = G();
    const k = g.k;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    crowd.length = 0;
    const len = (K + 1) * g.seg;
    // El cielo de la noche de carnaval.
    S.bg.addChild(new Graphics().rect(0, 0, g.w, g.h).fill(S.dark ? 0x140e2a : 0x2a2056));
    bgLayer = new Container();
    facades = new Graphics();
    lights = new Graphics();
    arches = new Graphics();
    church = new Graphics();
    street = new Graphics();
    crowdLayer = new Container();
    dancerLayer = new Container();
    dancerLayer.sortableChildren = true;
    fx = new Graphics();
    S.scene.addChild(bgLayer, facades, church, lights, crowdLayer, street, arches, dancerLayer, fx);
    // Las fachadas coloniales, con balcones y ventanas encendidas.
    const pastel = [0xe9b8a5, 0xa9d1c4, 0xf3d37c, 0xb9a6e0, 0xf0a3b6, 0x9ec3e6];
    for (let x = -g.w, i = 0; x < len + g.w; i++) {
      const fw = (120 + hash(i, 1) * 90) * k, fh = (150 + hash(i, 2) * 90) * k;
      const top = g.streetTop - 40 * k - fh;
      facades.rect(x, top, fw, fh + 40 * k).fill(pastel[i % pastel.length] as number).stroke({ width: 2 * k, color: INK });
      for (let wy = top + 22 * k; wy < g.streetTop - 60 * k; wy += 46 * k) {
        for (let wx = x + 16 * k; wx < x + fw - 30 * k; wx += 36 * k) {
          facades.rect(wx, wy, 18 * k, 26 * k).fill(hash(Math.round(wx), Math.round(wy)) < 0.6 ? 0xffd27a : 0x3a2f55).stroke({ width: 1.5 * k, color: INK });
        }
        facades.rect(x + 8 * k, wy + 28 * k, fw - 16 * k, 4 * k).fill(INK);
      }
      x += fw;
    }
    // Las graderías con la gente.
    facades.rect(-g.w, g.streetTop - 40 * k, len + g.w * 3, 40 * k).fill(S.dark ? 0x2b2640 : 0x5b5f79);
    for (let tier = 0; tier < 2; tier++) facades.rect(-g.w, g.streetTop - 40 * k + (tier + 1) * 14 * k, len + g.w * 3, 3 * k).fill({ color: 0x000000, alpha: 0.3 });
    const people: Texture[] = [];
    const skin = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
    for (let i = 0; i < 8; i++) {
      const pg = new Graphics();
      const shirt = [0xe93d9c, 0xff7a1a, 0x00a896, 0x6c4ce0, 0xffc629, 0xffffff, 0xd52b1e, 0x1c64c8][i] as number;
      pg.roundRect(-4, -8, 8, 9, 2).fill(shirt).circle(0, -11, 3.4).fill(skin[i % skin.length] as number);
      people.push(S.app.renderer.generateTexture({ target: pg, resolution: 2 * Math.min(window.devicePixelRatio || 1, 2) }));
      pg.destroy();
    }
    for (let tier = 0; tier < 2; tier++) {
      for (let x = -g.w, i = 0; x < len + g.w * 2; x += (10 + hash(i, tier + 20) * 6) * k, i++) {
        const sp = new Sprite(people[Math.floor(hash(i, tier + 30) * 8)] as Texture);
        sp.anchor.set(0.5, 1);
        sp.scale.set(k * (1.2 + tier * 0.12));
        const y = g.streetTop - 40 * k + (tier + 1) * 14 * k;
        sp.position.set(x, y);
        crowdLayer.addChild(sp);
        crowd.push({ sp, ph: hash(i, tier + 40) * 6, y });
      }
    }
    // La calle, con la vereda de adelante.
    street.rect(-g.w, g.streetTop, len + g.w * 3, g.h).fill(S.dark ? 0x3a3346 : 0x6b6478);
    for (let x = -g.w; x < len + g.w * 2; x += 40 * k) street.rect(x, (g.streetTop + g.streetBot) / 2, 20 * k, 2 * k).fill({ color: 0xffffff, alpha: 0.15 });
    street.rect(-g.w, g.streetBot, len + g.w * 3, g.h).fill(S.dark ? 0x241f30 : 0x4a4458);
    // Los arcos de cada cuadra, con discos de plata y banderines.
    for (let i = 1; i <= K; i++) {
      const ax = i * g.seg + 30 * k;
      const ah = g.streetBot - g.streetTop + 150 * k;
      const top = g.streetBot - ah;
      arches.rect(ax - 6 * k, top, 12 * k, ah).fill(0xc9ccd6).stroke({ width: 2 * k, color: INK });
      arches.rect(ax - 70 * k, top - 14 * k, 140 * k, 28 * k).fill(0xd52b1e).stroke({ width: 2.4 * k, color: INK });
      for (let j = 0; j < 7; j++) arches.circle(ax - 60 * k + j * 20 * k, top + 22 * k, 6 * k).fill(0xe6e8ee).stroke({ width: 1.4 * k, color: INK });
      const lab = S.text(`${i}`, { fontFamily: MONO, fontSize: 16 * k, fontWeight: "900", fill: 0xffffff });
      lab.anchor.set(0.5);
      lab.position.set(ax, top);
      S.scene.addChild(lab);
    }
    // El Santuario del Socavón, al final de la entrada.
    const cx = (K + 1) * g.seg + 170 * k, base = g.streetTop;
    church.rect(cx - 110 * k, base - 230 * k, 220 * k, 230 * k).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.rect(cx - 150 * k, base - 300 * k, 60 * k, 300 * k).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.poly([cx - 160 * k, base - 300 * k, cx - 120 * k, base - 360 * k, cx - 80 * k, base - 300 * k]).fill(0xd52b1e).stroke({ width: 3 * k, color: INK });
    church.rect(cx - 124 * k, base - 400 * k, 8 * k, 40 * k).fill(INK).rect(cx - 134 * k, base - 386 * k, 28 * k, 8 * k).fill(INK);
    church.circle(cx - 120 * k, base - 260 * k, 14 * k).fill(0xffc629).stroke({ width: 2 * k, color: INK });
    church.roundRect(cx - 34 * k, base - 120 * k, 68 * k, 120 * k, 34 * k).fill(0x5b3a29).stroke({ width: 3 * k, color: INK });
    church.poly([cx - 120 * k, base - 230 * k, cx, base - 290 * k, cx + 120 * k, base - 230 * k]).fill(0xf4ecd8).stroke({ width: 3 * k, color: INK });
    church.circle(cx, base - 180 * k, 22 * k).fill(0x9ec3e6).stroke({ width: 3 * k, color: INK });
    for (const d of dancers) {
      d.view?.destroy({ children: true });
      d.view = makeDancer(d);
      dancerLayer.addChild(d.view);
      d.chip?.destroy({ children: true });
      d.chip = undefined;
      d.strike = undefined;
      d.prize = undefined;
    }
    shownNow.clear();
    lastHi = -1;
    rollPlan = null;
    // La interfaz.
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    chips = new Container();
    leaders = new Graphics();
    moreBox = new Graphics();
    moreText = S.text("", { fontFamily: MONO, fontSize: TAG_FONT_PX * k, fontWeight: "800", fill: S.dark ? CREAM : INK });
    moreText.anchor.set(0.5);
    moreBox.visible = moreText.visible = false;
    chips.addChild(leaders);
    blockText = S.text("", { fontFamily: MONO, fontSize: 12 * k, fontWeight: "800", fill: CREAM });
    blockText.anchor.set(1, 1);
    blockText.position.set(g.w - 22 * k, g.h - S.bottom() - 18 * k);
    S.hud.addChild(box, chips, moreBox, moreText, blockText);
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  {
    // La formación arranca armada.
    const hx = headX(0);
    for (const d of dancers) {
      const p = slotPos(d, hx);
      d.x = p.x;
      d.y = p.y;
    }
    const g = G();
    cam.cut(hx - 80 * g.k, (g.streetTop + g.streetBot) / 2 - 40 * g.k, 1.3);
  }

  /** La cámara: sigue a la comparsa, se acerca a los que se quedan, abre al Socavón y cierra en el contrapunto. */
  function direct(): void {
    const g = G();
    const live = alive();
    const cx = live.reduce((a, d) => a + d.x, 0) / Math.max(1, live.length);
    const my = (g.streetTop + g.streetBot) / 2 - 30 * g.k;
    if (phase === "intro") cam.lookAt(headX(0) - 60 * g.k, my, 1.3 - 0.15 * clamp(tAll / T_START, 0, 1), 2);
    else if (phase === "stop" && tAll - arrive(stopsDone) < 0.9 && stopsDone > 0 && story.arc !== "tapada") {
      const gone = dancers.filter((d) => !d.alive && Math.abs(d.left - arrive(stopsDone)) < 0.05);
      const gx = gone.length ? gone.reduce((a, d) => a + d.x, 0) / gone.length : cx;
      cam.lookAt(gx, g.streetTop - 20 * g.k, 1.35, 4);
    } else if (story.arc === "susto" && tripSaid && tAll < T_TRIP + 1.1) cam.lookAt(win.x, win.y - 60 * g.scale, 2.0, 5);
    else if (phase === "walk" || phase === "stop") {
      const nearEnd = clamp((tAll - arrive(K)) / (T_SOCAVON - arrive(K)), 0, 1);
      // Mira adonde va a estar la comparsa en medio segundo: la cámara que la
      // perseguía se quedaba unos 400 px atrás, con media pantalla de calle
      // vacía. Con poca gente, más cerca; en un celular no, que ya no entra.
      const lead = headX(tAll + 0.5) - headX(tAll);
      const z = n <= 24 && !S.portrait() ? 1.25 : 1.05;
      cam.lookAt(cx + lead + 40 * g.k + nearEnd * 140 * g.k, my - nearEnd * 60 * g.k, z - 0.2 * nearEnd, 2.5);
    } else if (phase === "duel") {
      const td = tAll - T_SOCAVON;
      // Primero el Socavón entero, que antes no se veía (solo la puerta), y
      // después el contrapunto, cada vez más cerca.
      if (td < 0.9) cam.lookAt((K + 1) * g.seg + 170 * g.k, g.streetTop - 150 * g.k, 0.9, 3);
      else if (!arrived) cam.lookAt((K + 1) * g.seg + 20 * g.k, my - 30 * g.k, 1.5 + 0.4 * clamp(td / duelDur, 0, 1), 2.5);
      // Llegó: la cámara se abre con el que gana mientras camina a la puerta.
      // Con el plano del contrapunto, en un celular le cortaba la cabeza.
      else cam.lookAt(win.x + 60 * g.k, win.y - 60 * g.scale - (g.h * 0.1) / 1.3, 1.3, 2.5);
    } else {
      const z = 1.3;
      cam.lookAt(win.x + 60 * g.k, win.y - 60 * g.scale - (g.h * 0.1) / z, z, 1.5);
    }
  }

  /** One reusable candidate per dancer, so the per-frame selection allocates nothing per devil. */
  const pool: TagCandidate[] = dancers.map((d) => ({ id: d.idx, sx: 0, sy: 0, depth: 0, visible: false, out: false }));
  const poolOf = new Map(dancers.map((d, i) => [d.idx, pool[i] as TagCandidate]));
  const inView: TagCandidate[] = [];

  /** The chip of a devil: built once, then reused (and rebuilt with the scene on resize). */
  function tagOf(d: Dancer, kk: number, scale: number): Container {
    if (d.chip) return d.chip;
    const c = S.chip(tagName(names[d.idx] ?? "", fullTag.has(d.idx) ? 20 : TAG_CHARS), scale, names[d.idx] ?? "");
    const w = c.width;
    d.tagW = w;
    // The colour bar matches the devil's cape, and the dot on its head, so ownership reads at a glance.
    c.addChild(new Graphics().rect(4 * kk, 17.5 * kk, w - 8 * kk, 4 * kk).fill(S.color(d.idx)));
    // La marca de "se quedó", solo mientras recién se queda: una raya roja que
    // tacha el nombre por la mitad. La cruz que había lo tapaba entero, y no
    // se leía quién se quedaba, que es justo el dato del momento.
    const x = new Graphics()
      .moveTo(4 * kk, 11.5 * kk).lineTo(w - 6 * kk, 11.5 * kk)
      .stroke({ width: 2.4 * kk, color: 0xd52b1e, cap: "round" });
    x.visible = false;
    c.addChild(x);
    d.strike = x;
    // Un co-ganador que se queda no va tachado: se queda con premio, y lleva
    // un borde amarillo mientras el relator lo nombra.
    if (winners.includes(d.idx)) {
      const prize = new Graphics().roundRect(-1.5 * kk, -1.5 * kk, w + 3 * kk, 25 * kk, 6 * kk).stroke({ width: 3 * kk, color: YELLOW });
      prize.visible = false;
      c.addChild(prize);
      d.prize = prize;
    }
    // Se guarda: sin esto cada cuadro armaba una etiqueta nueva y la línea que
    // la usa encontraba `d.chip` vacío; Oruro se caía en el primer cuadro y el
    // estadio quedaba colgado (lo encontró el auditor exigente, 2 de octubre).
    d.chip = c;
    chips.addChild(c);
    return c;
  }

  /**
   * Name tags from the very first frame, each tied to ITS devil by the colour of
   * its cape and a short leader line to the head. Which devils get one: see
   * selectTags (front first, just-eliminated ones always); the rest are the "+N".
   */
  function drawTags(g: ReturnType<typeof G>, live: Dancer[], cw: number, ch: number): void {
    const k = g.k;
    for (const d of dancers) if (d.chip) d.chip.visible = false;
    leaders.clear();
    moreBox.visible = moreText.visible = false;
    if (phase === "crown" || phase === "dead") return;
    const scale = clamp(TAG_FONT_PX / (12 * k), 1, 1.8);
    const kk = k * scale;
    const sz = estimateTagSize(kk, TAG_CHARS);
    const top = S.top(), bottom = S.bottom();
    const cap = tagBudget(g.w, g.h, top, bottom, sz.w, sz.h);
    // Roll call: for the first seconds the tags are paged over ALL devils (ordered by
    // hash, so everyone is named once and nothing depends on slot or who wins).
    rollPlan ??= planRollCall(dancers.map((d) => d.idx), cap);
    const roll = rollCallAt(rollPlan, tAll, ROLL_T0);
    const page = roll.page >= 0 ? (rollPlan.pages[roll.page] as number[]) : null;
    inView.length = 0;
    for (const d of dancers) {
      const c = poolOf.get(d.idx) as TagCandidate;
      const age = d.alive ? -1 : tAll - d.left;
      c.visible = false;
      if (!outTreatment(age).visible) continue;
      const p = cam.toScreen(d.x, d.y - 100 * g.scale, g.w, g.h);
      c.sx = p.x;
      c.sy = p.y;
      c.depth = d.y;
      c.out = !d.alive && age < OUT_HOLD;
      c.visible = p.x > 0 && p.x < g.w && p.y > top && p.y < g.h - bottom && (!page || c.out || page.includes(d.idx));
      if (c.visible) inView.push(c);
    }
    const { shown } = selectTags(inView, cap, shownNow);
    const th = 22 * kk;
    const items: LabelItem[] = [];
    for (let i = 0; i < shown.length; i++) {
      const d = byIdx.get(shown[i] as number) as Dancer;
      const c = poolOf.get(d.idx) as TagCandidate;
      tagOf(d, kk, scale);
      const w = (d.tagW ?? sz.w) + 3 * kk;
      items.push({ id: d.idx, x: c.sx - w / 2, y: c.sy - th - 10 * kk, w, h: th + 3 * kk, priority: (c.out ? 1000 : 0) + c.depth });
    }
    // The counter and the "+N" chip are off limits.
    const moreH = 26 * k, moreY = S.top() + 10 * k + ch + 10 * k;
    const blocked = [{ x: 22 * k, y: S.top() + 10 * k, w: cw + 5 * k, h: ch + 5 * k + 10 * k + moreH }];
    const placed = layoutLabels(items, { w: g.w, h: g.h, top, bottom }, blocked);
    const hi = roll.hi;
    shownNext.clear();
    let aliveTagged = 0;
    for (const pl of placed) {
      const d = byIdx.get(pl.id) as Dancer;
      const c = poolOf.get(d.idx) as TagCandidate;
      const chip = d.chip as Container;
      const look = outTreatment(d.alive ? -1 : tAll - d.left);
      const s = look.scale * (pl.id === hi ? 1.25 : 1);
      chip.visible = true;
      chip.scale.set(s);
      chip.alpha = look.alpha;
      chip.position.set(pl.x, pl.y + 11 * kk);
      const premiado = winners.includes(d.idx);
      (d.strike as Graphics).visible = look.struck && !premiado;
      if (d.prize) d.prize.visible = look.struck && premiado && !d.alive && tAll - d.left < OUT_HOLD;
      if (pl.id === hi && pl.id !== lastHi) chips.addChild(chip);
      shownNext.add(pl.id);
      if (d.alive) aliveTagged++;
      // The leader: from the tag down to the head of its own devil.
      const w = (d.tagW ?? sz.w) * s, cx = pl.x + w / 2, by = pl.y + th * s - (s - 1) * 11 * kk;
      const col = S.color(d.idx);
      leaders.moveTo(cx, by).lineTo(c.sx, c.sy).stroke({ width: 5 * kk * 0.5, color: INK, alpha: look.alpha })
        .moveTo(cx, by).lineTo(c.sx, c.sy).stroke({ width: 2.4 * kk * 0.5, color: col, alpha: look.alpha })
        .circle(c.sx, c.sy, 3.2 * kk * 0.6).fill({ color: col, alpha: look.alpha }).stroke({ width: 1.4, color: INK, alpha: look.alpha });
    }
    lastHi = hi;
    shownNow.clear();
    for (const id of shownNext) shownNow.add(id);
    const more = live.length - aliveTagged;
    if (more > 0) {
      const label = `+${more}`;
      if (moreText.text !== label) moreText.text = label;
      const w = moreText.width + 18 * k;
      moreBox.clear().roundRect(22 * k + 2.5 * k, moreY + 2.5 * k, w, moreH, 5 * k).fill(INK)
        .roundRect(22 * k, moreY, w, moreH, 5 * k).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 2 * k, color: INK });
      moreText.position.set(22 * k + w / 2, moreY + moreH / 2);
      moreBox.visible = moreText.visible = true;
    }
  }

  function draw(now: number): void {
    const g = G();
    const k = g.k;
    // La hinchada salta y saluda.
    for (const c of crowd) c.sp.y = c.y - Math.abs(Math.sin(now * 5 + c.ph)) * 3 * k;
    // Las guirnaldas de focos entre las fachadas.
    lights.clear();
    const len = (K + 1) * g.seg;
    for (let x = -g.w, i = 0; x < len + g.w; x += 26 * k, i++) {
      const y = g.streetTop - 190 * k + Math.sin((x / (160 * k)) * Math.PI) * 18 * k;
      const on = 0.55 + 0.45 * Math.sin(now * 3 + i);
      lights.circle(x, y, 4 * k).fill({ color: [0xffc629, 0xe93d9c, 0x00a896, 0xff7a1a][i % 4] as number, alpha: on });
    }
    // Los bailarines: saltan, giran la capa y dan vueltas.
    const beatPh = now * 7;
    for (const d of dancers) {
      const v = d.view as Container;
      v.zIndex = d.y;
      const walking = d.alive && (phase === "walk" || phase === "intro" || phase === "duel");
      let bounce = walking ? Math.abs(Math.sin(beatPh + d.ph)) * 10 : Math.abs(Math.sin(now * 3 + d.ph)) * 3;
      let turn = Math.cos(now * 0.9 + d.ph);
      if (phase === "duel" && (d === win || d === riv)) {
        // Saltan de a uno, alternados, y se miran: cada salto más alto.
        const { b, f } = jumpAt(tAll - T_SOCAVON);
        const mine = b >= 0 && (d === win ? b % 2 === 0 : b % 2 === 1);
        bounce = mine ? Math.sin(Math.PI * f) * Math.min(60, 30 + 6 * b) : 2;
        turn = d === win ? 1 : -1;
      }
      // De frente en la corona y en el susto: con la vuelta quedaba de canto
      // la mitad del tiempo, un palito, y no se le veía la máscara.
      if (phase === "crown" && d === win) {
        bounce = Math.abs(Math.sin(now * 6)) * 24;
        turn = 1;
      }
      if (d === win && story.arc === "susto" && tripSaid && tAll < T_TRIP + 1.1) turn = 1;
      v.position.set(d.x, d.y - bounce * g.scale);
      // La vuelta es un volteo rápido: por debajo de 0,55 de ancho el diablo
      // se volvía un palito (le pasaba a cuatro de cada diez).
      v.scale.set(g.scale * (Math.abs(turn) < 0.55 ? Math.sign(turn || 1) * 0.55 : turn), g.scale);
      v.rotation = d.alive ? Math.sin(beatPh * 0.5 + d.ph) * 0.06 : 0;
      (d.cape as Graphics).skew.x = Math.sin(beatPh + d.ph) * (walking ? 0.2 : 0.1);
      // Los brazos suben y bajan alternados; las piernas se levantan de a una
      // con la rodilla alta. Quietos en la vereda, apenas se mecen.
      const e = walking || (phase === "crown" && d === win) ? 1 : 0.25;
      const b = beatPh + d.ph;
      (d.armL as Container).rotation = (-0.2 + Math.sin(b) * 0.55) * e;
      (d.armR as Container).rotation = (0.2 + Math.sin(b + Math.PI) * 0.55) * e;
      (d.legL as Container).y = -14 - Math.max(0, Math.sin(b)) * 9 * e;
      (d.legR as Container).y = -14 - Math.max(0, Math.sin(b + Math.PI)) * 9 * e;
      (d.legL as Container).rotation = Math.max(0, Math.sin(b)) * 0.35 * e;
      (d.legR as Container).rotation = -Math.max(0, Math.sin(b + Math.PI)) * 0.35 * e;
      (d.glint as Graphics).alpha = Math.max(0, Math.sin(now * 6 + d.ph * 3));
      // El susto: la máscara se le corre y vuelve.
      const mk = d.mask as Container;
      if (d === win && story.arc === "susto" && tripSaid && tAll < T_TRIP + 1.0) {
        const f = Math.sin(Math.PI * ((tAll - T_TRIP) / 1.0));
        mk.position.set(10 * f, 8 * f);
        mk.rotation = 0.5 * f;
        v.rotation = -0.25 * f;
      } else {
        mk.position.set(0, 0);
        mk.rotation = 0;
      }
      v.alpha = d.alive ? 1 : 0.85;
    }
    // Los cohetillos, en la coronación.
    fx.clear();
    if (phase === "crown") {
      const cxx = (K + 1) * g.seg + 170 * k;
      for (let b = 0; b < 6; b++) {
        const t0 = T_CROWN + b * 0.35, age = tAll - t0;
        if (age < 0 || age > 1.4) continue;
        const bx = cxx + (hash(b, 1) - 0.5) * 420 * k, by = g.streetTop - (260 + hash(b, 2) * 160) * k;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const d = age * 120 * k;
          fx.circle(bx + Math.cos(a) * d, by + Math.sin(a) * d + age * age * 40 * k, (3.5 - age * 2) * k).fill({ color: [0xffc629, 0xe93d9c, 0x00a896, 0xffffff][(b + i) % 4] as number, alpha: 1 - age / 1.4 });
        }
      }
    }
    const live = alive();
    counter.text = counterText(t("cOruLeft"), live.length, n);
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    drawTags(g, live, bw, bh);
    blockText.text = phase === "walk" || phase === "stop" ? T[getLang()].cOruBlock(Math.min(K, stopsDone + (phase === "walk" ? 1 : 0)), K) : "";
    if (phase === "crown") crownUI.at(tAll - T_CROWN);
  }

  S.run((dt, now) => {
    tAll += dt;
    const inStop = stopsDone > 0 && stopsDone <= K && tAll < arrive(stopsDone) + STOP;
    phase = tAll < T_START ? "intro" : tAll < T_SOCAVON ? (inStop ? "stop" : "walk") : tAll < T_CROWN ? "duel" : "crown";
    script();
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    S.breath(tAll, T_CROWN);
    if (phase === "crown") {
      if (riv.alive && riv !== win) leave([rivalIdx]);
      crown();
      tHold += dt * paceFactor();
    }
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tHold >= WINNER_HOLD) {
      phase = "dead";
      S.cleanup();
    }
  });
}
