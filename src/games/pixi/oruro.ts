import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

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
 */

const DT = 1 / 120;
const T_START = 2.2;
const WALK = 2.1;
const STOP = 1.3;
const MASKS = [0xd52b1e, 0xd52b1e, 0x1f7a3a, 0x1c64c8];

type Phase = "intro" | "walk" | "stop" | "duel" | "crown" | "dead";
interface Dancer {
  idx: number; x: number; y: number; slot: number; alive: boolean; left: number; wx: number; wy: number;
  ph: number; view?: Container; mask?: Container; cape?: Graphics; chip?: Container;
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
          if (d === win) target = { x: sx - 40 * g.scale * (phase === "crown" ? 0 : 1), y: my };
          else if (d === riv) target = { x: sx + 70 * g.scale, y: my + 10 * g.scale };
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
    }
    relayout();
  }

  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    // Las campanas del Socavón.
    [0, 180, 360, 540].forEach((ms, i) => setTimeout(() => beep(note(i % 2 ? 12 : 14), 0.4, "triangle", 0.05), ms));
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
        beep(note(stepTick % 2 ? 0 : 3), 0.05, "square", 0.02);
      }
    }
    while (stopsDone < K && tAll >= arrive(stopsDone + 1)) {
      stopsDone++;
      const ids = leavesAt[stopsDone - 1] ?? [];
      leave(ids);
      const last = stopsDone === K;
      const left = alive().length;
      // Los bronces de la banda en cada cuadra.
      beep(note(5), 0.3, "sawtooth", 0.035);
      beep(note(9), 0.3, "sawtooth", 0.028);
      cam.punch(0.05).shake(5 * S.u());
      if (last && n > 2) S.say(t("cOruLast"), 0.8);
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
      S.say(T[getLang()].cOruDuel(names[winnerIdx] ?? "", names[rivalIdx] ?? ""), 0.8);
    }
    // El contrapunto: saltan de a uno, alternados.
    if (phase === "duel") {
      const td = tAll - T_SOCAVON;
      const beat = Math.floor(td / 0.8);
      if (beat > Math.floor((td - DT) / 0.8)) beep(note(beat % 2 ? 7 : 10), 0.12, "triangle", 0.045);
      if (!arrived && td >= duelDur - 0.9) {
        arrived = true;
        leave([rivalIdx]);
        S.say(t("cOruArrive"), 0.95);
        beep(note(12), 0.5, "triangle", 0.06);
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
    const body = new Graphics()
      // Las botas y el faldellín de paneles.
      .rect(-10, -8, 8, 8).fill(INK).rect(2, -8, 8, 8).fill(INK)
      .poly([-15, -42, 15, -42, 20, -10, -20, -10]).fill(0x5b1a6e).stroke({ width: 2, color: INK })
      .moveTo(-7, -42).lineTo(-9, -10).moveTo(7, -42).lineTo(9, -10).stroke({ width: 1.5, color: YELLOW })
      // La pechera dorada.
      .rect(-13, -68, 26, 27).fill(0xffc629).stroke({ width: 2, color: INK })
      // Los brazos, arriba en el paso.
      .poly([-13, -66, -26, -84, -21, -87, -9, -70]).fill(col).stroke({ width: 1.8, color: INK })
      .poly([13, -66, 26, -84, 21, -87, 9, -70]).fill(col).stroke({ width: 1.8, color: INK });
    c.addChild(body);
    const av = new Sprite(S.face(names[d.idx] ?? ""));
    av.width = av.height = 14;
    av.anchor.set(0.5);
    av.position.set(0, -55);
    c.addChild(av);
    // La máscara: cara, ojos saltones, dientes y cuernos retorcidos.
    const mask = new Container();
    const m = new Graphics()
      .poly([-14, -86, -26, -104, -30, -122, -20, -110, -10, -94]).fill(0xffc629).stroke({ width: 1.8, color: INK })
      .poly([14, -86, 26, -104, 30, -122, 20, -110, 10, -94]).fill(0xffc629).stroke({ width: 1.8, color: INK })
      .ellipse(0, -84, 15, 16).fill(maskCol).stroke({ width: 2.4, color: INK })
      .circle(-6, -88, 5).fill(0xffffff).stroke({ width: 1.4, color: INK }).circle(6, -88, 5).fill(0xffffff).stroke({ width: 1.4, color: INK })
      .circle(-6, -88, 2.2).fill(0x1f7a3a).circle(6, -88, 2.2).fill(0x1f7a3a)
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
    }
    // La interfaz.
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    chips = new Container();
    blockText = S.text("", { fontFamily: MONO, fontSize: 12 * k, fontWeight: "800", fill: CREAM });
    blockText.anchor.set(1, 1);
    blockText.position.set(g.w - 22 * k, g.h - S.bottom() - 18 * k);
    S.hud.addChild(box, chips, blockText);
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
      cam.lookAt(cx + 40 * g.k + nearEnd * 140 * g.k, my - nearEnd * 60 * g.k, 1.05 - 0.2 * nearEnd, 2);
    } else if (phase === "duel") cam.lookAt((K + 1) * g.seg + 20 * g.k, my - 30 * g.k, 1.7, 2.5);
    else {
      const z = 1.3;
      cam.lookAt(win.x + 60 * g.k, win.y - 60 * g.scale - (g.h * 0.1) / z, z, 1.5);
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
        // Saltan de a uno, alternados, y se miran.
        const td = tAll - T_SOCAVON;
        const mine = d === win ? Math.floor(td / 0.8) % 2 === 0 : Math.floor(td / 0.8) % 2 === 1;
        bounce = mine ? Math.sin(Math.PI * ((td % 0.8) / 0.8)) * 36 : 2;
        turn = d === win ? 1 : -1;
      }
      if (phase === "crown" && d === win) {
        bounce = Math.abs(Math.sin(now * 6)) * 24;
        turn = Math.cos(now * 2);
      }
      v.position.set(d.x, d.y - bounce * g.scale);
      v.scale.set(g.scale * (Math.abs(turn) < 0.3 ? Math.sign(turn || 1) * 0.3 : turn), g.scale);
      v.rotation = d.alive ? Math.sin(beatPh * 0.5 + d.ph) * 0.06 : 0;
      (d.cape as Graphics).skew.x = Math.sin(beatPh + d.ph) * 0.12;
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
    // Los nombres de los que quedan, cuando son pocos.
    const live = alive();
    for (const d of dancers) if (d.chip) d.chip.visible = false;
    if (live.length <= 8 && phase !== "crown") {
      const at = live.map((d) => ({ d, p: cam.toScreen(d.x + 20 * g.scale, d.y - 125 * g.scale, g.w, g.h) })).sort((a, b) => a.p.y - b.p.y);
      let prev = -Infinity;
      for (const { d, p } of at) {
        const chip = (d.chip ??= chips.addChild(S.chip(names[d.idx] ?? "")));
        chip.visible = true;
        const cy = Math.max(p.y, prev + 26 * k);
        prev = cy;
        chip.position.set(Math.min(p.x, g.w - chip.width - 10 * k), cy);
      }
    }
    counter.text = `${t("cOruLeft")}  ${live.length} / ${n}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
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
