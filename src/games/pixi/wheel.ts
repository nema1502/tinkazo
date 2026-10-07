import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, shorten, winnersLabel } from "../overlay";
import { FALSA, T_BRAKE, T_CREEP, T_CROWN, T_HOLD, T_LOCK, T_SETTLE, T_SPIN, T_WIND, beatFor, type BeatReason } from "./wheel-beats";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";

/**
 * La ruleta, en PixiJS, con el director de cámara.
 *
 * Es la misma ruleta que `wheel.ts`: la velocidad se integra para que caiga
 * justo en el gajo del ganador, cada persona se lleva varios gajos
 * intercalados, y en el arco "susto" la rueda se para un gajo antes y después
 * avanza uno más. Lo nuevo es cómo se mira: la cámara arranca pegada al cubo,
 * se abre mientras se arma la rueda, y cuando la rueda frena se va acercando
 * al puntero hasta quedar encima en el amague. Con el ganador se abre para que
 * se vean sus gajos encendidos.
 */

const SEGS = 24;
const TAU = Math.PI * 2;
const W0 = 38.4;
const W1 = 5.6;

/** Velocidad en gajos por segundo: la misma curva que `wheel.ts`. */
function omega(tt: number, falsa = false): number {
  if (tt < T_WIND) return 0;
  if (tt < T_SPIN) return W0 * Math.pow((tt - T_WIND) / (T_SPIN - T_WIND), 2.2);
  if (tt < T_BRAKE) return W0;
  if (tt < T_CREEP) return W1 + (W0 - W1) * Math.pow(1 - (tt - T_BRAKE) / (T_CREEP - T_BRAKE), 2);
  if (tt < T_HOLD) return W1 * Math.pow(1 - (tt - T_CREEP) / (T_HOLD - T_CREEP), 1.6);
  if (falsa) {
    const a = T_HOLD + FALSA;
    if (tt < a || tt >= T_LOCK) return 0;
    const d = T_LOCK - a;
    return (Math.PI / (2 * d)) * Math.sin((Math.PI * (tt - a)) / d);
  }
  if (tt < T_SETTLE) return 0.64;
  if (tt >= T_LOCK) return 0;
  return 1.7 * Math.pow(1 - (tt - T_SETTLE) / (T_LOCK - T_SETTLE), 2.2);
}

export async function wheelPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const falsa = story.arc === "susto" && n >= 2;
  S.mark("arco", story.arc);
  const rep = n <= 12 ? Math.max(1, Math.round(SEGS / n)) : 1;
  const segs = n * rep;
  const A = TAU / segs;
  const personOf = (k: number): number => ((k % n) + n) % n;
  setGameLength(T_CROWN, WINNER_HOLD);

  const startSeg = rng() * segs;
  const winSeg = winnerIdx + n * Math.floor(rng() * rep);
  const landing = winSeg + 0.5;
  const STEPS = 1200;
  const cumT: number[] = new Array(STEPS + 1);
  cumT[0] = 0;
  const h = T_LOCK / STEPS;
  for (let i = 1; i <= STEPS; i++) cumT[i] = (cumT[i - 1] as number) + ((omega((i - 1) * h, falsa) + omega(i * h, falsa)) / 2) * h;
  const BUDGET = cumT[STEPS] as number;
  let total = BUDGET - ((((BUDGET - (landing - startSeg)) % segs) + segs) % segs);
  if (total < BUDGET - segs / 2) total += segs;
  const scale = total / BUDGET;
  function cum(tt: number): number {
    if (tt <= 0) return 0;
    if (tt >= T_LOCK) return BUDGET;
    const x = (tt / T_LOCK) * STEPS;
    const i = Math.floor(x);
    const a = cumT[i] as number;
    return a + ((cumT[Math.min(STEPS, i + 1)] as number) - a) * (x - i);
  }

  /* ============================================================ escena */
  interface Geo { R: number; cx: number; cy: number; u: number; alto: boolean; wide: boolean }
  const geo = (): Geo => {
    const sw = S.sw(), sh = S.sh(), u = S.u();
    const alto = S.portrait();
    if (alto) return { R: Math.min(sw * 0.4, sh * 0.28), cx: sw / 2, cy: sh * 0.38, u, alto, wide: false };
    const wide43 = sw / sh < 1.5;
    const R = Math.min(sh * (wide43 ? 0.34 : 0.395), sw * (wide43 ? 0.26 : 0.3));
    const cx = Math.max(sw * 0.56, sw - R - 110 * u);
    return { R, cx, cy: sh * 0.5, u, alto, wide: cx - R - 70 * u > 260 * u };
  };
  let G = geo();

  let rays!: Graphics;
  let wheel!: Container;
  let ghosts: Container[] = [];
  let segG: Graphics[] = [];
  let digits: Text[] = [];
  let stripes!: Graphics;
  let pointer!: Graphics;
  let hub!: Container;
  let rows: Container[] = [];
  let bigPlate!: Container;
  let bigName!: Text;
  let bigAv!: Sprite;
  let bigBar!: Graphics;

  const rimChars = beacon.randomness.slice(0, 64).split("");

  function discGraphics(R: number, u: number, withNames: boolean): Container {
    const c = new Container();
    const Rd = R * 0.86;
    for (let j = 0; j < segs; j++) {
      const a0 = j * A - Math.PI / 2;
      const g = new Graphics().moveTo(0, 0).arc(0, 0, Rd, a0, a0 + A).closePath().fill(S.color(personOf(j))).stroke({ width: 2.5 * u, color: INK });
      c.addChild(g);
      if (withNames && n <= 12) {
        // El nombre en su gajo, escrito hacia afuera: con la rueda quieta se
        // lee de quién es cada pedazo sin mirar la columna.
        const nm = S.text(shorten(names[personOf(j)] ?? "", n <= 4 ? 12 : 9), { fontSize: Math.min(18 * u, A * Rd * 0.9 * 0.42), fontWeight: "900", fill: INK });
        nm.anchor.set(1, 0.5);
        if (nm.width > Rd * 0.55) nm.scale.set((Rd * 0.55) / nm.width);
        const mid = a0 + A / 2;
        nm.rotation = mid;
        nm.position.set(Math.cos(mid) * Rd * 0.9, Math.sin(mid) * Rd * 0.9);
        nm.alpha = 0.85;
        c.addChild(nm);
      }
    }
    return c;
  }

  function build(): void {
    G = geo();
    const { R, u } = G;
    const sw = S.sw(), sh = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));

    S.bg.addChild(new Graphics().rect(0, 0, sw, sh).fill(S.dark ? 0x191226 : 0x241a3c));
    rays = new Graphics();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      rays.poly([0, 0, Math.cos(a - 0.1) * 1600 * u, Math.sin(a - 0.1) * 1600 * u, Math.cos(a + 0.1) * 1600 * u, Math.sin(a + 0.1) * 1600 * u]);
    }
    rays.fill({ color: YELLOW, alpha: 0.06 });
    S.scene.addChild(rays);

    // La rueda vive en el origen del mundo: la cámara decide dónde se ve.
    S.scene.addChild(new Graphics().circle(10 * u, 12 * u, R).fill(INK));
    wheel = new Container();
    ghosts = [0, 1].map(() => {
      const gc = discGraphics(R, u, false);
      gc.alpha = 0.3;
      S.scene.addChild(gc);
      return gc;
    });
    const disc = discGraphics(R, u, true);
    segG = disc.children.filter((c): c is Graphics => c instanceof Graphics);
    wheel.addChild(disc);
    // Sombra radial: sin esto, veinticuatro gajos planos son papilla.
    const shade = new Graphics();
    for (let i = 0; i < 6; i++) shade.circle(0, 0, R * 0.86 * (1 - i * 0.12)).fill({ color: 0x000000, alpha: 0.03 });
    wheel.addChild(shade);
    // El aro: un anillo, con el agujero cortado (en PixiJS 8 dos círculos
    // rellenos no hacen un anillo, hacen un disco que tapa los gajos).
    const rim = new Graphics().circle(0, 0, R).fill(S.dark ? 0x120d22 : 0x2b1f4a).circle(0, 0, R * 0.88).cut();
    rim.circle(0, 0, R).stroke({ width: 3 * u, color: INK }).circle(0, 0, R * 0.88).stroke({ width: 3 * u, color: INK });
    wheel.addChild(rim);
    stripes = new Graphics();
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU;
      stripes.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88).lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    stripes.stroke({ width: 2 * u, color: CREAM, alpha: 0.3 });
    wheel.addChild(stripes);
    digits = rimChars.map((ch) => {
      const tx = S.text(ch, { fontFamily: MONO, fontSize: 15 * u, fontWeight: "700", fill: CREAM });
      tx.anchor.set(0.5);
      tx.alpha = 0.72;
      wheel.addChild(tx);
      return tx;
    });
    const pegs = new Graphics();
    const rr = R * 0.875;
    for (let j = 0; j < segs; j++) {
      const a = j * A - Math.PI / 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, s = 8 * u;
      pegs.poly([x, y - s, x + s, y, x, y + s, x - s, y]).fill(YELLOW).stroke({ width: 2 * u, color: INK });
    }
    // El perno cero, con las tres barritas: marca la vuelta.
    pegs.rect(-9 * u, -rr - 22 * u, 18 * u, 16 * u).fill(INK)
      .rect(-7.5 * u, -rr - 20.5 * u, 15 * u, 4.3 * u).fill(0xd52b1e)
      .rect(-7.5 * u, -rr - 16.2 * u, 15 * u, 4.3 * u).fill(0xf9e300)
      .rect(-7.5 * u, -rr - 11.9 * u, 15 * u, 4.3 * u).fill(0x007a33);
    wheel.addChild(pegs);
    S.scene.addChild(wheel);

    hub = new Container();
    const rh = R * 0.2;
    hub.addChild(new Graphics().circle(0, 0, rh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 4 * u, color: INK }));
    const sc = (rh * 1.25) / 26;
    const llama = new Graphics();
    const r = (rx: number, ry: number, rw: number, rh2: number): void => { llama.rect((rx - 11) * sc, (ry - 11) * sc, rw * sc, rh2 * sc); };
    r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
    r(3, 18, 2.5, 6); r(8, 18, 2.5, 6); r(12.5, 18, 2.5, 6); r(16, 18, 2.5, 6);
    llama.fill(0xe93d9c);
    hub.addChild(llama);
    S.scene.addChild(hub);

    pointer = new Graphics().poly([-17 * u, 0, 17 * u, 0, 0, 34 * u]).fill(YELLOW).stroke({ width: 4 * u, color: INK });
    const post = new Graphics().rect(-6 * u, -R - 54 * u, 12 * u, 30 * u).fill(INK);
    S.scene.addChild(post, pointer);
    pointer.position.set(0, -R - 26 * u);

    // La columna de nombres (o una placa grande), fija en la pantalla.
    rows = [];
    const k = u;
    if (!G.alto && G.wide && n <= 14) {
      const colW = G.cx - R - 90 * k;
      const cnt = Math.min(n, 9);
      const gap = 10 * k;
      const hgt = Math.min(64 * k, (sh * 0.72 - gap * cnt) / cnt);
      const y0 = G.cy - (cnt * (hgt + gap) - gap) / 2;
      for (let i = 0; i < cnt; i++) {
        const row = new Container();
        const av = Math.min(hgt * 0.62, 44 * k);
        const bgr = new Graphics().rect(5 * k, 5 * k, colW, hgt).fill(INK).rect(0, 0, colW, hgt).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
        const bar = new Graphics().rect(0, 0, 10 * k, hgt).fill(S.color(i));
        const sp = new Sprite(S.face(names[i] ?? ""));
        sp.width = sp.height = av;
        sp.position.set(36 * k, (hgt - av) / 2);
        const nm = S.text(shorten(names[i] ?? "", 22), { fontSize: Math.min(26 * k, hgt * 0.36), fontWeight: "800", fill: S.dark ? CREAM : INK });
        nm.anchor.set(0, 0.5);
        nm.position.set(36 * k + av + 12 * k, hgt / 2);
        const maxW = colW - (36 * k + av + 26 * k);
        if (nm.width > maxW) nm.scale.set(maxW / nm.width);
        row.addChild(bgr, bar, sp, nm);
        row.position.set(40 * k, y0 + i * (hgt + gap));
        S.hud.addChild(row);
        rows.push(row);
      }
    }
    bigPlate = new Container();
    const pw = G.alto ? Math.min(sw - 60 * k, 520 * k) : Math.max(240 * k, G.cx - R - 90 * k);
    const ph = (G.alto ? 92 : 96) * k;
    bigBar = new Graphics();
    bigPlate.addChild(new Graphics().rect(6 * k, 6 * k, pw, ph).fill(INK).rect(0, 0, pw, ph).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 4 * k, color: YELLOW }), bigBar);
    bigAv = new Sprite(S.face(names[0] ?? ""));
    bigAv.width = bigAv.height = 56 * k;
    bigAv.position.set(38 * k, (ph - 56 * k) / 2);
    bigName = S.text("", { fontSize: 30 * k, fontWeight: "900", fill: S.dark ? CREAM : INK });
    bigName.anchor.set(0, 0.5);
    bigName.position.set(38 * k + 68 * k, ph / 2);
    bigPlate.addChild(bigAv, bigName);
    (bigPlate as Container & { pw?: number }).pw = pw;
    bigPlate.position.set(G.alto ? (sw - pw) / 2 : 40 * k, G.alto ? Math.min(sh - S.bottom() - ph - 20 * k, G.cy + R + 40 * k) : G.cy - ph / 2);
    bigPlate.visible = rows.length === 0;
    S.hud.addChild(bigPlate);
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);

  /** El mundo se mira de modo que la rueda quede donde manda la disposición. */
  const restView = (): { x: number; y: number } => ({ x: S.sw() / 2 - G.cx, y: S.sh() / 2 - G.cy });
  cam.cut(0, 0, 1.9);

  /* ============================================================ estado */
  let tAll = 0, tHold = 0;
  let rot = -startSeg * A;
  let lastClick = Math.floor(startSeg), lastLap = -1, lastHum = -1, lastSaid = -999, saidUpTo = -1;
  let pegHits = 0, buildTick = 0;
  let cur = personOf(Math.floor(startSeg));
  let flash = 0, didLock = false, saidPeg = false, saidLast = false, didCrown = false;

  const segUnder = (): number => Math.floor((((-rot / A) % segs) + segs) % segs) % segs;
  /**
   * La lengüeta es un resorte amortiguado. El clavo que pasa la empuja hasta
   * donde la dobla (`flapper`); cuando la suelta, vuelve sola, se pasa un poco
   * para el otro lado y tiembla, como la de una ruleta de feria. Hasta el 29 de
   * septiembre de 2026 seguía al clavo sin física y se enderezaba de golpe.
   * Corre a paso fijo de 1/240 s, así la misma ronda tiembla igual.
   */
  let flapA = 0, flapV = 0, flapAcc = 0;
  function flapStep(dt: number, w: number): void {
    const h = 1 / 240;
    flapAcc += dt;
    while (flapAcc >= h) {
      flapAcc -= h;
      flapV += (-900 * flapA - 11 * flapV) * h;
      flapA += flapV * h;
    }
    const contact = flapper(w);
    if (flapA < contact) {
      flapV = Math.max(flapV, dt > 0 ? (contact - flapA) / dt : 0);
      flapA = contact;
    }
  }
  function flapper(w: number): number {
    const s = (((-rot / A) % segs) + segs) % segs;
    const frac = s - Math.floor(s);
    const bend = Math.max(0, Math.min(1, 1 - (Math.min(frac, 1 - frac) * 2) / 0.22));
    return 0.42 * Math.max(bend, Math.max(0, Math.min(0.75, w / 24)));
  }

  skipFn = (): void => {
    if (tAll >= T_CROWN) return;
    tAll = T_CROWN;
    rot = -(startSeg + BUDGET * scale) * A;
    crowned();
  };
  /** Aplica un beat de cámara de la agenda pura (wheel-beats.ts): una sola sacudida, en la coronación. */
  function camBeat(reason: BeatReason): void {
    const b = beatFor(falsa, reason);
    if (!b) return;
    if (b.kind === "shake") cam.shake(b.strength * G.u);
    else if (b.kind === "punch" || b.kind === "push") cam.punch(b.strength);
  }
  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    cur = winnerIdx;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
    cam.punch(0.1);
    camBeat("crown");
  }

  function tickAudio(w: number): void {
    if (tAll >= T_SPIN && tAll < T_BRAKE) {
      const lap = Math.floor((cum(tAll) * scale) / segs);
      if (lap !== lastLap) {
        lastLap = lap;
        beep(note(15), 0.05, "sine", 0.03);
      }
    }
    if (tAll >= T_SPIN && w > 16) {
      const hum = Math.floor(tAll / 0.3);
      if (hum !== lastHum) {
        lastHum = hum;
        beepFor(note(Math.round((w / W0) * 4)), 0.36, "sawtooth", 0.026);
      }
      return;
    }
    if (w > 16 || w <= 0) return;
    const s = Math.floor((((-rot / A) % segs) + segs) % segs);
    if (s === lastClick) return;
    lastClick = s;
    if (n <= 4) {
      beep(note([5, 8, 10, 12][personOf(s)] ?? 5), 0.05, "triangle", 0.03);
      return;
    }
    beep(note(8), 0.03, "square", 0.034);
  }

  function sayIfDue(w: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => S.say(t("cWheelBuild"), 0.1)],
      [0.7, () => S.say(T[getLang()].cWheelSplit(segs, rep), 0.15)],
      [T_WIND, () => S.say(t("cWheelCharge"), 0.3)],
      [T_SPIN, () => S.say(t("cWheelGo"), 0.45)],
      [3.4, () => S.say(t("cWheelFast"), 0.5)],
      [6.4, () => S.say(t("cWheelSlow"), 0.65)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
      lastSaid = tAll;
    }
    if (tAll >= T_CREEP && tAll < T_HOLD && w < 3 && tAll - lastSaid > 0.45) {
      lastSaid = tAll;
      S.say(T[getLang()].cWheelOn(names[cur] ?? ""), 0.55);
    }
    if (tAll >= T_HOLD && !saidPeg) {
      saidPeg = true;
      lastSaid = tAll;
      S.say(falsa ? T[getLang()].cWheelFalse(names[cur] ?? "") : t("cWheelPeg"), 0.9);
      cam.punch(0.06);
    }
    if (tAll >= (falsa ? T_HOLD + FALSA : T_SETTLE) && !saidLast) {
      saidLast = true;
      lastSaid = tAll;
      S.say(t(falsa ? "cWheelMoved" : "cWheelLast"), 0.95);
      if (falsa) {
        beep(note(3), 0.08, "square", 0.06);
        setTimeout(() => beep(note(10), 0.12, "triangle", 0.05), 60);
        camBeat("tease");
      }
    }
  }

  /** La cámara: pegada al cubo al armar, abierta al girar, encima del puntero al frenar. */
  function direct(): void {
    const rest = restView();
    const R = G.R;
    const ptr = { x: 0, y: -R * 0.78 };
    if (tAll < T_WIND) {
      const p = tAll / T_WIND;
      cam.lookAt(rest.x * p, rest.y * p, 1.9 - 0.9 * p, 3);
    } else if (tAll < T_BRAKE) {
      cam.lookAt(rest.x, rest.y, 1, 2.5, -0.02 * Math.sin(tAll * 1.3));
    } else if (tAll < T_CREEP) {
      const p = (tAll - T_BRAKE) / (T_CREEP - T_BRAKE);
      const e = p * p;
      cam.lookAt(rest.x * (1 - e) + ptr.x * e * 0.6, rest.y * (1 - e) + ptr.y * e * 0.6, 1 + 0.45 * e, 2);
    } else if (tAll < T_CROWN) {
      const close = G.alto ? 1.9 : 2.3;
      cam.lookAt(ptr.x, ptr.y, tAll >= T_HOLD ? close : 1.6 + (close - 1.6) * ((tAll - T_CREEP) / (T_HOLD - T_CREEP)), 3.5);
    } else {
      cam.lookAt(rest.x, rest.y, 0.96, 2.2);
    }
  }

  function draw(w: number, now: number, dt: number): void {
    const u = G.u;
    rays.rotation = -now * 0.04;
    wheel.rotation = rot;
    ghosts.forEach((g, i) => {
      g.rotation = rot - w * A * 0.012 * (i + 1);
      g.visible = w > 6;
    });
    const shown = Math.min(64, Math.floor(Math.max(0, Math.min(1, tAll / 0.7)) * 64));
    const R = G.R;
    const rm = (R + R * 0.88) / 2;
    stripes.visible = w > 12;
    digits.forEach((d, i) => {
      d.visible = w <= 12 && i < shown;
      if (!d.visible) return;
      const a = (i / 64) * TAU - Math.PI / 2;
      const world = a + rot;
      const upside = Math.cos(world) < 0;
      d.position.set(Math.cos(a) * rm, Math.sin(a) * rm);
      d.rotation = a + Math.PI / 2 + (upside ? Math.PI : 0);
      d.style.fill = tAll >= T_CROWN ? YELLOW : CREAM;
    });
    hub.rotation = Math.max(-1.2, Math.min(1.2, -rot * 0.25)) * (w > 0 ? 1 : 0);
    flapStep(dt, w);
    pointer.rotation = flapA;
    // Al trabarse, la lengüeta pega un golpe: crece y vuelve.
    pointer.scale.set(1 + flash * 2.5);
    // Con el ganador, sus gajos salen hacia afuera y los demás se apagan.
    if (tAll >= T_CROWN) {
      const e = Math.min(1, (tAll - T_CROWN) * 2);
      segG.forEach((g, j) => {
        const mine = personOf(j) === winnerIdx;
        const mid = j * A - Math.PI / 2 + A / 2;
        g.position.set(mine ? Math.cos(mid) * 16 * u * e : 0, mine ? Math.sin(mid) * 16 * u * e : 0);
        g.alpha = mine ? 1 : 1 - 0.55 * e;
      });
    }
    // La columna: la fila del puntero se enciende; en el acercamiento, placa grande.
    const close = tAll >= T_CREEP && tAll < T_CROWN + 10;
    rows.forEach((r, i) => {
      const on = i === cur;
      r.x = 40 * u + (on ? 12 * u : 0);
      r.scale.set(on ? 1.06 : 1);
      r.alpha = close ? Math.max(0, 1 - (tAll - T_CREEP) * 2) : 1;
    });
    bigPlate.visible = rows.length === 0 || close;
    bigPlate.alpha = tAll >= T_CROWN ? Math.max(0, 1 - (tAll - T_CROWN) * 3) : 1;
    const pname = names[cur] ?? "";
    if (bigName.text !== pname) {
      bigName.text = pname;
      bigAv.texture = S.face(pname);
      const pw = (bigPlate as Container & { pw?: number }).pw ?? 300;
      const maxW = pw - 130 * u;
      bigName.scale.set(1);
      if (bigName.width > maxW) bigName.scale.set(maxW / bigName.width);
      bigBar.clear().rect(0, 0, 26 * u, 96 * u).fill(S.color(cur));
    }
    if (tAll >= T_CROWN) crown.at(tAll - T_CROWN);
  }

  S.run((dt, now) => {
    tAll += dt;
    S.breath(tAll, T_CROWN);
    const w = omega(tAll, falsa);
    rot = -(startSeg + cum(tAll) * scale) * A;
    if (tAll < 1.1) {
      const want = Math.floor((tAll / 1.1) * 24);
      while (buildTick < want) {
        beep(note(5 + Math.floor(buildTick / 2)), 0.05, "square", 0.03);
        buildTick++;
      }
    }
    if (!falsa && tAll >= T_HOLD && tAll < T_SETTLE) {
      const hits = Math.floor(Math.pow((tAll - T_HOLD) / (T_SETTLE - T_HOLD), 0.62) * 7);
      while (pegHits < hits) {
        pegHits++;
        const q = pegHits / 7;
        beep(note(Math.max(0, 2 - Math.round(q * 2))), 0.06, "square", 0.062 - q * 0.028);
      }
    }
    if (tAll >= T_LOCK && !didLock) {
      didLock = true;
      flash = 0.12;
      beep(note(0), 0.45, "sine", 0.1);
      setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
      setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
      camBeat("lock");
    }
    flash = Math.max(0, flash - dt);
    if (tAll >= T_CROWN) crowned();
    else cur = personOf(segUnder());
    tickAudio(w);
    sayIfDue(w);
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(w, now, dt);
    if (tAll >= T_CROWN) tHold += dt * paceFactor();
    if (tHold >= WINNER_HOLD) S.cleanup();
  });
}
