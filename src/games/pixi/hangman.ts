import { Container, Graphics, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, YELLOW, mountPixi, type PixiStage } from "./stage";
import { MAX_WRONG, maskName, normalizeName, optsForArc, planRounds, type Guess, type Round } from "./hangman-plan";

/**
 * Ahorcado (hangman).
 *
 * The hidden word is the WINNER'S NAME. On the left a gallows holds a friendly
 * cartoon figure that gets built part by part with every wrong letter (never
 * the sixth: it is never completed); in the middle the masked name, one slot
 * per letter, and the strip of guessed letters (right ones lit, wrong ones
 * crossed); and on the side every candidate as a chip, struck out as the
 * letters rule them out, so the audience watches the field narrow.
 *
 * The game decides nothing. The winners are known first and the whole sequence
 * of guesses is planned backwards from each winner's name (see
 * `hangman-plan.ts`, which is pure and tested): right letters are letters of
 * the name, wrong letters are not in it, and the last guess of every round is
 * a right one that completes the name. This file only draws and narrates it.
 *
 * With several winners there is one round per winner, in the order of
 * `winners`; the figure resets between rounds and each pool leaves out the
 * earlier winners. The last winner gets the big moment. The arcs (`drama.ts`)
 * decide how many wrong letters the last round has (the scare) and the camera:
 *
 * - **susto**: five wrong letters, the figure is one part from complete.
 * - **remontada**: four wrong letters; the camera follows every letter closely.
 * - **duelo**: three wrong letters.
 * - **tapada**: two wrong letters, and the push-in waits for the last second.
 *
 * Everything is a function of the stage clock (`dt`), never of wall time.
 */

const T_INTRO = 4.5;
/** Seconds of the first round before its first letter (after the intro), and between rounds. */
const FIRST_HANG = 1.2;
const ROUND_GAP = 1.2;
/** Hang before the closing letter of the last winner. */
const HANG_FINAL = 2.3;
const AFTER_FINAL = 2.2;
const AFTER_SMALL = 1.8;
/** A part of the figure or a revealed letter pops in over this long. */
const POP = 0.35;
const STRIKE_DELAY = 0.45;
const STRIKE_STAGGER = 0.07;
const STRIKE_TIME = 0.35;
const RED = 0xd23b4e;

interface Ev {
  ri: number;
  i: number;
  g: Guess;
  t: number;
  /** Index among the round's wrong guesses (the figure part it adds), or -1. */
  wrongNo: number;
  /** Candidates this guess strikes out. */
  struck: number[];
  final: boolean;
  grand: boolean;
  fired: boolean;
  followed: boolean;
  announced: boolean;
}

interface RoundPlan {
  round: Round;
  ri: number;
  grand: boolean;
  /** From here on this round is what the screen shows. */
  start: number;
  end: number;
  events: Ev[];
  letterAt: Map<string, number>;
  struckAt: Map<number, number>;
  partAt: number[];
  solveAt: number;
  earlier: number[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NameCell {
  ch: string;
  slot: boolean;
  letters: string[];
  x: number;
  y: number;
  text: Text | null;
}

interface Tile {
  text: Text;
  x: number;
  y: number;
}

export async function hangmanPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const n = names.length;
  const prizes = winners.length ? [...winners] : [0];
  const total = prizes.length;
  const last = total - 1;
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("ahorcado", `${n}x${total}`);
  let rounds: Round[];
  try {
    rounds = planRounds(names, prizes, rng, optsForArc(story.arc));
  } catch {
    // An impossible draw (a name too short, a repeated winner): never leave it hanging.
    // `cleanup` also calls `done`.
    S.cleanup();
    return;
  }

  /* ---------------------------------------------------------------- the script */
  const plans: RoundPlan[] = [];
  let tt = 0;
  rounds.forEach((round, ri) => {
    const grand = ri === last;
    const len = round.guesses.length;
    const gap = grand ? clamp(15 / len, 0.8, 1.5) : clamp(6 / len, 0.5, 0.9);
    const start = tt;
    tt = ri === 0 ? T_INTRO + FIRST_HANG : tt + ROUND_GAP;
    const events: Ev[] = [];
    const letterAt = new Map<string, number>();
    const struckAt = new Map<number, number>();
    const partAt: number[] = [];
    let prev = round.pool;
    let wrongSeen = 0;
    round.guesses.forEach((gs, i) => {
      const final = i === len - 1;
      if (i > 0) tt += final ? (grand ? HANG_FINAL : gap * 1.3) : gap + (!gs.correct && wrongSeen >= 3 ? 0.25 : 0);
      const struck = prev.filter((c) => !gs.remaining.includes(c));
      struck.forEach((c, k) => struckAt.set(c, tt + STRIKE_DELAY + k * STRIKE_STAGGER));
      prev = gs.remaining;
      const wrongNo = gs.correct ? -1 : wrongSeen++;
      if (!gs.correct) partAt[wrongNo] = tt;
      letterAt.set(gs.letter, tt);
      events.push({ ri, i, g: gs, t: tt, wrongNo, struck, final, grand, fired: false, followed: false, announced: false });
    });
    const solveAt = tt;
    tt += grand ? AFTER_FINAL : AFTER_SMALL;
    plans.push({
      round, ri, grand, start, end: tt, events, letterAt, struckAt, partAt, solveAt,
      earlier: prizes.slice(0, ri),
    });
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);
  const allEvents = plans.flatMap((p) => p.events);
  const ruleText = t(total > 1 ? "cHngRuleMany" : "cHngRuleOne");

  /* ---------------------------------------------------------------- geometry */
  const G = (): {
    w: number; h: number; k: number; gal: Rect; nameR: Rect; strip: Rect; chipsR: Rect; cols: number;
  } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const topY = S.top() + 22 * k, botY = h - S.bottom() - 4 * k;
    const H = Math.max(40, botY - topY);
    if (S.portrait()) {
      return {
        w, h, k, cols: 2,
        gal: { x: 0.02 * w, y: topY, w: 0.42 * w, h: 0.3 * H },
        strip: { x: 0.46 * w, y: topY, w: 0.52 * w, h: 0.3 * H },
        nameR: { x: 0.03 * w, y: topY + 0.33 * H, w: 0.94 * w, h: 0.2 * H },
        chipsR: { x: 0.03 * w, y: topY + 0.57 * H, w: 0.94 * w, h: 0.43 * H },
      };
    }
    return {
      w, h, k, cols: 1,
      gal: { x: 0.03 * w, y: topY, w: 0.27 * w, h: H },
      nameR: { x: 0.31 * w, y: topY + 0.12 * H, w: 0.38 * w, h: 0.3 * H },
      strip: { x: 0.31 * w, y: topY + 0.5 * H, w: 0.38 * w, h: 0.45 * H },
      chipsR: { x: 0.71 * w, y: topY, w: 0.27 * w, h: H },
    };
  };
  let g = G();

  /* ------------------------------------------------------------------ layers */
  const sky = new Graphics();
  S.bg.addChild(sky);
  const galG = new Graphics();
  const nameG = new Graphics();
  const nameLayer = new Container();
  const stripG = new Graphics();
  const stripLayer = new Container();
  const chipLayer = new Container();
  const fx = new Graphics();
  const badgeLayer = new Container();
  S.scene.addChild(galG, nameG, nameLayer, stripG, stripLayer, chipLayer, fx, badgeLayer);
  const caption = S.text("", { fontSize: 15, fontWeight: "800", fill: INK, align: "center" });
  caption.anchor.set(0.5, 0);
  caption.alpha = 0;
  S.hud.addChild(caption);

  const chips = new Map<number, Container>();
  const chipBox = new Map<number, Rect>();
  const badges = new Map<number, Text>();
  let cells: NameCell[] = [];
  let cellSize = 20;
  let tiles: Tile[] = [];
  let tileSize = 20;
  let viewRi = -1;

  const layoutChips = (): void => {
    chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    badgeLayer.removeChildren().forEach((c) => c.destroy());
    chips.clear();
    chipBox.clear();
    badges.clear();
    const R = g.chipsR;
    const rows = Math.ceil(n / g.cols);
    const colW = R.w / g.cols;
    let scale = clamp(R.h / rows / (31 * g.k), 0.45, 1.1);
    const make = (sc: number): number => {
      chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      chips.clear();
      let widest = 0;
      for (let i = 0; i < n; i++) {
        const ch = S.chip(names[i] as string, sc);
        chips.set(i, ch);
        chipLayer.addChild(ch);
        widest = Math.max(widest, ch.width);
      }
      return widest;
    };
    const widest = make(scale);
    if (widest > colW - 6 * g.k) {
      scale = Math.max(0.35, scale * ((colW - 6 * g.k) / widest));
      make(scale);
    }
    const rowH = R.h / rows;
    for (let i = 0; i < n; i++) {
      const ch = chips.get(i) as Container;
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = R.x + col * colW;
      const cy = R.y + rowH * (row + 0.5);
      ch.position.set(x, cy);
      chipBox.set(i, { x, y: cy - ch.height * 0.5, w: ch.width - 3 * g.k * scale, h: 22 * g.k * scale });
    }
    // One badge per winner, shown on the chip once its round is over.
    prizes.forEach((wi, r) => {
      const b = S.text(total > 1 ? `${r + 1}` : "", { fontSize: 11 * g.k, fontWeight: "900", fill: INK });
      b.anchor.set(0.5);
      b.alpha = 0;
      badges.set(wi, b);
      badgeLayer.addChild(b);
    });
  };

  /** Lays the name out in the middle: one line when it fits, otherwise two split at a separator. */
  const layoutName = (name: string): void => {
    nameLayer.removeChildren().forEach((c) => c.destroy());
    const mc = maskName(name, new Set());
    const R = g.nameR;
    let lines: typeof mc[] = [mc];
    if (mc.length > 8 && R.w / mc.length < 22 * g.k) {
      const mid = mc.length / 2;
      let cut = -1;
      mc.forEach((c, i) => {
        if (!c.slot && c.ch.trim() === "" && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
      });
      if (cut < 0) cut = Math.ceil(mid) - 1;
      lines = [mc.slice(0, cut + 1), mc.slice(cut + 1)].filter((l) => l.length > 0);
    }
    const longest = Math.max(...lines.map((l) => l.length));
    cellSize = clamp(Math.min(R.w / longest, R.h / (lines.length * 1.3)), 12 * g.k, 42 * g.k);
    cells = [];
    lines.forEach((line, li) => {
      const x0 = R.x + (R.w - line.length * cellSize) / 2;
      const y0 = R.y + (R.h - lines.length * cellSize * 1.3) / 2 + li * cellSize * 1.3;
      line.forEach((c, ci) => {
        const isBlank = !c.slot && c.ch.trim() === "";
        let text: Text | null = null;
        if (!isBlank) {
          text = S.text(c.ch.toLocaleUpperCase(), { fontSize: cellSize * 0.74, fontWeight: "900", fill: INK });
          text.anchor.set(0.5);
          nameLayer.addChild(text);
        }
        cells.push({
          ch: c.ch, slot: c.slot, letters: [...normalizeName(c.ch)],
          x: x0 + ci * cellSize, y: y0, text,
        });
      });
    });
  };

  /** The tiles of the strip of guessed letters. */
  const layoutStrip = (guesses: readonly Guess[]): void => {
    stripLayer.removeChildren().forEach((c) => c.destroy());
    tiles = [];
    const R = g.strip;
    const cnt = guesses.length;
    let ts = 30 * g.k;
    while (ts > 12 * g.k && Math.floor(R.w / (ts * 1.12)) * Math.floor(R.h / (ts * 1.12)) < cnt) ts -= 2 * g.k;
    tileSize = ts;
    const cols = Math.max(1, Math.min(cnt, Math.floor(R.w / (ts * 1.12))));
    const rows = Math.ceil(cnt / cols);
    guesses.forEach((gs, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, cnt - row * cols);
      const x0 = R.x + (R.w - inRow * ts * 1.12) / 2;
      const y0 = R.y + (R.h - rows * ts * 1.12) / 2;
      const text = S.text(gs.letter, { fontSize: ts * 0.7, fontWeight: "900", fill: INK });
      text.anchor.set(0.5);
      text.alpha = 0;
      stripLayer.addChild(text);
      tiles.push({ text, x: x0 + (i % cols) * ts * 1.12, y: y0 + row * ts * 1.12 });
    });
  };

  const showRound = (ri: number): void => {
    viewRi = ri;
    const p = plans[ri] as RoundPlan;
    layoutName(names[p.round.winner] as string);
    layoutStrip(p.round.guesses);
  };

  const build = (): void => {
    g = G();
    sky.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x241f3a : 0xffe9b8);
    caption.style.fontSize = 15 * g.k;
    caption.style.wordWrap = true;
    caption.style.wordWrapWidth = g.w * 0.9;
    layoutChips();
    showRound(Math.max(0, viewRi));
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  try {
    build();
  } catch {
    S.cleanup();
    return;
  }
  S.onResize(build);

  /* ------------------------------------------------------------------ script */
  let tAll = 0, tHold = 0, crowned = false, dead = false, introSaid = 0;

  const crownUI = S.crown(names, winners);
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    for (const e of allEvents) e.fired = e.followed = e.announced = true;
    introSaid = 99;
    tAll = T_CROWN;
    crown();
  };

  const nameOf = (p: RoundPlan): string => names[p.round.winner] as string;

  const onGuess = (p: RoundPlan, e: Ev): void => {
    e.fired = true;
    const big = e.grand;
    const k = g.k;
    const L = e.g.letter;
    if (e.final) {
      beep(note(0), big ? 0.4 : 0.2, "triangle", big ? 0.07 : 0.05);
      beep(note(big ? -5 : -2), 0.16, "sawtooth", 0.035);
      cam.punch(big ? 0.1 : 0.05).shake((big ? 12 : 6) * k);
      if (big) S.say(t("cHngSolved"), 1);
      else S.say(T[getLang()].cHngDone(nameOf(p)), 0.55);
    } else if (e.g.correct) {
      beep(note(7 + (e.i % 5)), 0.1, "triangle", big ? 0.05 : 0.035);
      cam.punch(big ? 0.03 : 0.015);
      if (big) S.say(T[getLang()].cHngRight(L), 0.3 + 0.5 * (e.i / Math.max(1, p.round.guesses.length)));
    } else {
      beep(note(-3 - (e.wrongNo % 3)), 0.2, "sawtooth", big ? 0.055 : 0.035);
      cam.punch(big ? 0.05 : 0.025).shake((big ? 6 : 3) * k);
      if (big) {
        if (e.wrongNo >= MAX_WRONG - 2) S.say(t("cHngDanger"), 0.95);
        else S.say(T[getLang()].cHngWrong(L), 0.4 + 0.1 * e.wrongNo);
      }
    }
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.1, () => {
        S.say(t("cHngStart"), 0.1);
        [5, 7, 9].forEach((d, i) => beep(note(d + i), 0.1, "triangle", 0.035));
      }],
      [1.7, () => {
        S.say(T[getLang()].cHngCount(n), 0.15);
        beep(note(10), 0.06, "square", 0.025);
      }],
      [3.2, () => {
        S.say(ruleText, 0.2);
        beep(note(12), 0.08, "triangle", 0.03);
      }],
    ];
    while (introSaid < cues.length && tAll >= (cues[introSaid] as [number, () => void])[0]) (cues[introSaid++] as [number, () => void])[1]();
    for (const p of plans) {
      const first = p.events[0] as Ev;
      if (p.ri > 0 && !first.announced && tAll >= p.start + 0.1) {
        first.announced = true;
        S.say(T[getLang()].cHngNext(p.ri + 1, total), 0.3 + 0.5 * (p.ri / Math.max(1, last)));
        beep(note(8 + (p.ri % 4)), 0.12, "sine", 0.04);
      }
      for (const e of p.events) {
        if (e.final && e.grand && !e.announced && tAll >= e.t - HANG_FINAL + 0.3) {
          e.announced = true;
          S.say(t("cHngLast"), 0.9);
        }
        if (!e.fired && tAll >= e.t) onGuess(p, e);
        // A beat after the letter lands: how many names it just struck out.
        if (!e.followed && tAll >= e.t + 0.6) {
          e.followed = true;
          if (e.struck.length > 0 && !e.final) {
            beep(note(3), 0.05, "square", 0.025);
            if (e.grand) S.say(e.struck.length > 1 || e.g.remaining.length === 1 ? T[getLang()].cHngLeft(e.g.remaining.length) : T[getLang()].cHngStrike(1), 0.5);
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------------- draw */
  const activeRound = (): RoundPlan => {
    let cur = plans[0] as RoundPlan;
    for (const p of plans) if (tAll >= p.start) cur = p;
    return cur;
  };

  const ink = (): number => (S.dark ? CREAM : INK);

  /** Slot centre of the first cell showing `letter`, for the camera. */
  const slotOf = (letter: string): { x: number; y: number } | null => {
    const c = cells.find((x) => x.slot && x.letters.includes(letter));
    return c ? { x: c.x + cellSize / 2, y: c.y + cellSize / 2 } : null;
  };
  const figureScale = (): { sg: number; gx: number; gy: number } => {
    const sg = Math.max(0.2, Math.min(g.gal.w / 200, g.gal.h / 260));
    return { sg, gx: g.gal.x + (g.gal.w - 200 * sg) / 2, gy: g.gal.y + (g.gal.h - 260 * sg) / 2 };
  };

  function aim(): void {
    const p = activeRound();
    let x = g.w / 2, y = g.h / 2, z = 1, rate = 2;
    if (p.grand && tAll < T_CROWN) {
      const centre = { x: g.nameR.x + g.nameR.w / 2, y: g.nameR.y + g.nameR.h / 2 };
      const fin = p.events[p.events.length - 1] as Ev;
      const close = story.arc === "remontada";
      const cur = [...p.events].reverse().find((e) => tAll >= e.t && tAll - e.t < 1.3);
      if (tAll >= fin.t) {
        // The big moment: a close-up of the completed name.
        z = 1.9;
        x = centre.x;
        y = centre.y;
        rate = 3;
      } else if (tAll >= fin.t - HANG_FINAL) {
        // A slow push-in over the last hang; tapada waits for its second half.
        const f = clamp((tAll - (fin.t - HANG_FINAL)) / HANG_FINAL, 0, 1);
        z = story.arc === "tapada" ? 1 + 0.9 * Math.max(0, f - 0.5) * 2 : 1 + 0.8 * f * f;
        x = centre.x;
        y = centre.y;
        rate = 3 + 2 * f;
      } else if (cur) {
        z = close ? 1.5 : cur.g.correct ? 1.25 : 1.35;
        if (cur.g.correct) {
          const s = slotOf(cur.g.letter);
          if (s) {
            x = s.x;
            y = s.y;
          }
        } else {
          const { sg, gx, gy } = figureScale();
          x = gx + 140 * sg;
          y = gy + 110 * sg;
        }
        rate = 2.5;
      } else if (close) {
        z = 1.15;
      }
    }
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, rate);
  }

  function drawGallows(p: RoundPlan): void {
    const { sg, gx, gy } = figureScale();
    const fp = (x: number, y: number): { x: number; y: number } => ({ x: gx + x * sg, y: gy + y * sg });
    const wood = S.dark ? 0xb88c5a : 0x9a6a38;
    galG.clear();
    const bar = (x1: number, y1: number, x2: number, y2: number): void => {
      const a = fp(x1, y1), b = fp(x2, y2);
      galG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 11 * sg, color: INK, cap: "round" });
      galG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 6 * sg, color: wood, cap: "round" });
    };
    bar(14, 250, 110, 250);
    bar(44, 250, 44, 20);
    bar(44, 20, 140, 20);
    bar(44, 62, 86, 20);
    // The rope ends in a loop above the figure's head.
    const r0 = fp(140, 20), r1 = fp(140, 46);
    galG.moveTo(r0.x, r0.y).lineTo(r1.x, r1.y).stroke({ width: 3 * sg, color: ink(), cap: "round" });

    // Wrong guesses add parts: head, body, left arm, right arm, left leg (the sixth never comes).
    const solved = tAll >= p.solveAt + 0.2;
    const up = solved ? ease.outCubic(clamp((tAll - p.solveAt - 0.2) / 0.4, 0, 1)) : 0;
    const hop = solved ? -Math.abs(Math.sin((tAll - p.solveAt - 0.2) * 8)) * 9 * sg * Math.max(0, 1 - (tAll - p.solveAt) / 2.4) : 0;
    const scaleOf = (j: number): number => {
      const at = p.partAt[j];
      return at === undefined || tAll < at ? 0 : ease.outBack(clamp((tAll - at) / POP, 0, 1));
    };
    const shirt = S.color(2);
    const limb = (j: number, ax: number, ay: number, ex: number, ey: number): void => {
      const s = scaleOf(j);
      if (s <= 0.001) return;
      const a = fp(ax, ay + 0), b = fp(ax + (ex - ax) * s, ay + (ey - ay) * s);
      galG.moveTo(a.x, a.y + hop).lineTo(b.x, b.y + hop).stroke({ width: 10 * sg, color: INK, cap: "round" });
      galG.moveTo(a.x, a.y + hop).lineTo(b.x, b.y + hop).stroke({ width: 5.5 * sg, color: shirt, cap: "round" });
    };
    const lerp = (a: number, b: number): number => a + (b - a) * up;
    limb(1, 140, 102, 140, 165);
    limb(2, 140, 116, lerp(112, 106), lerp(144, 88));
    limb(3, 140, 116, lerp(168, 174), lerp(144, 88));
    limb(4, 140, 165, 122, 212);
    const hs = scaleOf(0);
    if (hs > 0.001) {
      const c = fp(140, 80);
      const r = 22 * sg * hs;
      galG.circle(c.x, c.y + hop, r).fill(YELLOW).stroke({ width: 3 * sg, color: INK });
      const ex = 8 * sg * hs;
      galG.circle(c.x - ex, c.y - 4 * sg * hs + hop, 2.6 * sg * hs).fill(INK);
      galG.circle(c.x + ex, c.y - 4 * sg * hs + hop, 2.6 * sg * hs).fill(INK);
      const worried = !solved && p.partAt.filter((v) => v !== undefined && tAll >= v).length >= 4;
      if (worried) {
        galG.ellipse(c.x, c.y + 9 * sg * hs + hop, 3.6 * sg * hs, 4.4 * sg * hs).fill(INK);
      } else {
        const a0 = 0.15 * Math.PI, a1 = 0.85 * Math.PI;
        const mr = (solved ? 11 : 9) * sg * hs;
        const my = c.y + (solved ? 0 : 2) * sg * hs + hop;
        galG.moveTo(c.x + Math.cos(a0) * mr, my + Math.sin(a0) * mr).arc(c.x, my, mr, a0, a1).stroke({ width: 2.4 * sg, color: INK, cap: "round" });
      }
    }
  }

  function drawName(p: RoundPlan): void {
    nameG.clear();
    const guessed = new Set<string>();
    for (const [l, at] of p.letterAt) if (tAll >= at) guessed.add(l);
    const solved = tAll >= p.solveAt;
    for (const c of cells) {
      if (!c.slot) {
        if (c.text) {
          c.text.position.set(c.x + cellSize / 2, c.y + cellSize * 0.5);
          c.text.alpha = 1;
        }
        continue;
      }
      const sz = cellSize * 0.9;
      const cx = c.x + cellSize / 2, cy = c.y + cellSize / 2;
      const at = Math.max(0, ...c.letters.map((l) => p.letterAt.get(l) ?? Infinity));
      const shown = c.letters.every((l) => guessed.has(l));
      const f = shown ? ease.outBack(clamp((tAll - at) / POP, 0, 1)) : 0;
      // The slot: a dim tile with an underline, filled in when its letter is guessed.
      nameG.roundRect(cx - sz / 2, cy - sz / 2, sz, sz, sz * 0.18).fill({ color: ink(), alpha: 0.12 });
      nameG.moveTo(cx - sz * 0.4, cy + sz * 0.38).lineTo(cx + sz * 0.4, cy + sz * 0.38).stroke({ width: 2 * g.k, color: ink(), alpha: 0.6 });
      if (shown) {
        const pulse = solved ? 0.5 + 0.5 * Math.sin(tAll * 6) : 0;
        const w2 = sz * f;
        nameG.roundRect(cx - w2 / 2, cy - w2 / 2, w2, w2, w2 * 0.18).fill(pulse > 0.6 ? 0xfff4c2 : YELLOW).stroke({ width: 2 * g.k, color: INK });
      }
      if (c.text) {
        c.text.position.set(cx, cy);
        c.text.scale.set(Math.max(0.001, f));
        c.text.alpha = shown ? 1 : 0;
      }
    }
  }

  function drawStrip(p: RoundPlan): void {
    stripG.clear();
    p.round.guesses.forEach((gs, i) => {
      const tl = tiles[i];
      if (!tl) return;
      const at = (p.events[i] as Ev).t;
      if (tAll < at) {
        tl.text.alpha = 0;
        return;
      }
      const f = ease.outBack(clamp((tAll - at) / POP, 0, 1));
      const s = tileSize * f;
      const cx = tl.x + tileSize / 2, cy = tl.y + tileSize / 2;
      if (gs.correct) {
        stripG.roundRect(cx - s / 2, cy - s / 2, s, s, s * 0.2).fill(YELLOW).stroke({ width: 2 * g.k, color: INK });
      } else {
        stripG.roundRect(cx - s / 2, cy - s / 2, s, s, s * 0.2).fill({ color: S.color(0), alpha: 0.45 }).stroke({ width: 2 * g.k, color: INK, alpha: 0.6 });
        const q = s * 0.36;
        stripG.moveTo(cx - q, cy - q).lineTo(cx + q, cy + q).moveTo(cx + q, cy - q).lineTo(cx - q, cy + q).stroke({ width: 3 * g.k, color: RED, cap: "round" });
      }
      tl.text.position.set(cx, cy);
      tl.text.scale.set(Math.max(0.001, f));
      tl.text.alpha = gs.correct ? 1 : 0.55;
    });
  }

  function drawChips(p: RoundPlan): void {
    fx.clear();
    const winnerAt = p.solveAt + 0.2;
    for (let i = 0; i < n; i++) {
      const ch = chips.get(i) as Container;
      const box = chipBox.get(i) as Rect;
      const cy = box.y + box.h / 2;
      const taken = p.earlier.includes(i);
      const at = p.struckAt.get(i);
      const prog = at === undefined ? 0 : clamp((tAll - at) / STRIKE_TIME, 0, 1);
      ch.alpha = taken ? 0.6 : 1 - 0.72 * ease.outCubic(prog);
      if (prog > 0 && !taken) {
        fx.moveTo(box.x + 3 * g.k, cy).lineTo(box.x + 3 * g.k + (box.w - 6 * g.k) * ease.outCubic(prog), cy).stroke({ width: 3 * g.k, color: RED, cap: "round" });
      }
      const b = badges.get(i);
      if (b) {
        const show = taken && total > 0;
        b.alpha = show ? 1 : 0;
        if (show) {
          const br = Math.max(7 * g.k, box.h * 0.45);
          const bx = box.x + box.w - br * 0.4, by = box.y;
          fx.circle(bx, by, br).fill(YELLOW).stroke({ width: 2 * g.k, color: INK });
          b.position.set(bx, by);
        }
      }
      if (i === p.round.winner && tAll >= winnerAt) {
        const pulse = 0.55 + 0.45 * Math.sin(tAll * 7);
        fx.roundRect(box.x - 4 * g.k, box.y - 4 * g.k, box.w + 8 * g.k, box.h + 8 * g.k, 8 * g.k).stroke({ width: 3 * g.k, color: YELLOW, alpha: pulse });
      }
    }
  }

  function draw(): void {
    const p = activeRound();
    if (p.ri !== viewRi) showRound(p.ri);
    drawGallows(p);
    drawName(p);
    drawStrip(p);
    drawChips(p);
    // Caption: the rule until the first letter, then the winner counter (or the rule, with one winner).
    const started = tAll >= (plans[0] as RoundPlan).events[0]!.t - 0.7;
    caption.text = started && total > 1 ? T[getLang()].cHngTally(p.ri + 1, total) : ruleText;
    caption.position.set(g.w / 2, S.top() + 2 * g.k);
    caption.alpha = clamp((tAll - 2.6) / 0.5, 0, 1) * (crowned ? 0 : 1);
  }

  S.run((dt, now) => {
    if (dead) return;
    try {
      tAll += dt;
      script();
      if (tAll >= T_CROWN) {
        crown();
        tHold += dt * paceFactor();
      }
      aim();
      cam.update(dt);
      cam.apply(S.scene, S.sw(), S.sh(), now);
      draw();
      if (crowned) crownUI.at(tAll - T_CROWN);
    } catch {
      // A drawing error must never leave the draw hanging: close it (which calls `done`).
      dead = true;
      S.cleanup();
      return;
    }
    if (tHold >= WINNER_HOLD) {
      dead = true;
      S.cleanup();
    }
  });
}
