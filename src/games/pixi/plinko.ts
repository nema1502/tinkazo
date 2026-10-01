import { Container, Graphics, Sprite } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, YELLOW, mountPixi, type PixiStage } from "./stage";
import { assignSlots, ballTrail, boardFor, hopDurations, locateHop, planDrop, type Drop } from "./plinko-plan";

/**
 * Plinko.
 *
 * A triangular peg board, one slot per name at the bottom. The ball drops from
 * the top, bounces left or right at every row and lands in a slot. The game
 * decides nothing: the winner's slot is chosen first and the path is planned
 * backwards from it (see `plinko-plan.ts`, which is pure and tested), so the
 * ball provably lands where the protocol said. This file only draws and
 * narrates that plan.
 *
 * With several winners one ball is dropped per winner, in order, each into its
 * own slot; the last one gets the big moment. The arcs (`drama.ts`) shape the
 * last ball:
 *
 * - **susto / duelo**: a near miss. The ball hangs over a neighbouring slot
 *   in the last rows and swings back; the narrator names the neighbour.
 * - **remontada**: no swerve, but the camera closes in early and stays close.
 * - **tapada**: nobody is named until the ball is in; the camera waits for the
 *   very last fall.
 *
 * Everything is a function of the stage clock (`dt`), never of wall time.
 */

const T_INTRO = 4.5;
const HANG_BIG = 2.0;
const HANG_SMALL = 0.9;
const SETTLE = 0.9;
const SETTLE_LAST = 1.6;

interface Ball {
  /** Participant index. */
  name: number;
  slot: number;
  drop: Drop;
  durs: number[];
  trail: number[];
  /** Total fall time, in game seconds. */
  len: number;
  start: number;
  land: number;
  end: number;
  /** Last segment whose peg hit has been played (-1 = none yet). */
  seg: number;
  announced: boolean;
  landed: boolean;
}

export async function plinkoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const board = boardFor(n);
  const R = board.rows;
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("plinko", `${R}x${board.slots}`);
  const plan = assignSlots(n, prizes, rng);
  const wantNear = story.arc === "susto" || story.arc === "duelo";

  /* ---------------------------------------------------------------- the plan */
  const balls: Ball[] = prizes.map((w, i) => {
    const slot = plan.winnerSlots[i] as number;
    const drop = planDrop(board, slot, rng, i === last && wantNear);
    const durs = hopDurations(R, i === last);
    return {
      name: w, slot, drop, durs, trail: ballTrail(drop.steps), len: durs.reduce((a, b) => a + b, 0),
      start: 0, land: 0, end: 0, seg: -1, announced: false, landed: false,
    };
  });
  let tt = T_INTRO;
  balls.forEach((b, i) => {
    tt += i === 0 || i === last ? HANG_BIG : HANG_SMALL;
    b.start = tt;
    b.land = tt + b.len;
    tt = b.land + (i === last ? SETTLE_LAST : SETTLE);
    b.end = tt;
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);
  const grand = balls[last] as Ball;
  const nameOfSlot = (s: number): string => names[plan.nameAt[s] as number] ?? "";

  /* ---------------------------------------------------------------- geometry */
  const G = (): {
    w: number; h: number; k: number; cx: number; topY: number; rowH: number; sp: number; pegTop: number;
    pr: number; br: number; boardW: number; x0: number; binTop: number; binH: number; slotW: number;
  } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const topY = S.top() + 10 * k, botY = h - S.bottom() - 4 * k;
    const binH = 46 * k, labelH = 30 * k;
    const rowH = (botY - topY - labelH - binH) / (R + 1.6);
    const sp = Math.min((w * 0.94) / (R + 1), rowH * 1.3);
    const pegTop = topY + rowH * 1.6;
    const boardW = sp * (R + 1);
    return {
      w, h, k, cx: w / 2, topY, rowH, sp, pegTop, boardW, x0: w / 2 - boardW / 2, binH, slotW: sp * board.perSlot,
      pr: clamp(sp * 0.09, 2.2 * k, 5 * k), br: clamp(sp * 0.26, 5 * k, 12 * k),
      binTop: pegTop + (R - 1) * rowH + rowH * 0.9,
    };
  };
  let g = G();
  const slotX = (s: number): number => g.x0 + (s + 0.5) * g.slotW;
  const slotAt = (x: number): number => clamp(Math.floor((x - g.x0) / g.slotW), 0, board.slots - 1);

  /** Where the ball is `lt` game seconds after it was dropped. A hop is a parabola between pegs. */
  const posAt = (b: Ball, lt: number): { x: number; y: number } => {
    const { seg, f } = locateHop(b.durs, lt);
    const contact = (j: number): { x: number; y: number } => ({ x: g.cx + (b.trail[j] as number) * g.sp, y: g.pegTop + j * g.rowH - g.pr - g.br });
    if (seg === 0) {
      const c = contact(0);
      return { x: c.x, y: g.pegTop - 1.5 * g.rowH + (c.y - (g.pegTop - 1.5 * g.rowH)) * f * f };
    }
    const a = contact(seg - 1);
    const z = seg === R ? { x: g.cx + (b.trail[R] as number) * g.sp, y: g.binTop + g.binH * 0.55 } : contact(seg);
    const bump = (seg === R ? 0.8 : 0.5) * g.rowH * 4 * f * (1 - f);
    return { x: a.x + (z.x - a.x) * f, y: a.y + (z.y - a.y) * f - bump };
  };

  /* ------------------------------------------------------------------ layers */
  const sky = new Graphics();
  S.bg.addChild(sky);
  const boardG = new Graphics();
  const binLayer = new Container();
  const fx = new Graphics();
  const ballG = new Graphics();
  S.scene.addChild(boardG, binLayer, fx, ballG);
  const chipLayer = new Container();
  S.hud.addChild(chipLayer);
  const chipOf = new Map<number, Container>();
  let avatars: Sprite[] = [];
  let drawnRows = -1;
  let drawnBins = -1;

  const build = (): void => {
    g = G();
    sky.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1f1636 : 0xffe9b8);
    binLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    avatars = [];
    for (let s = 0; s < board.slots; s++) {
      const av = new Sprite(S.face(nameOfSlot(s)));
      av.anchor.set(0.5);
      av.position.set(slotX(s), g.binTop + g.binH * 0.5);
      av.alpha = 0;
      avatars.push(av);
      binLayer.addChild(av);
    }
    chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    chipOf.clear();
    drawnRows = -1;
    drawnBins = -1;
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  const binReveal = (s: number): number => 1.4 + (s * 2.2) / board.slots;

  /** The static board: panel, bins that already appeared and the pegs of the rows that already went up. */
  const drawBoard = (rows: number, bins: number): void => {
    const ink = S.dark ? CREAM : INK;
    boardG.clear();
    const top = { x: g.cx, y: g.pegTop - g.rowH * 0.8 };
    boardG
      .poly([top.x, top.y, g.x0 - g.sp * 0.1, g.binTop, g.x0 + g.boardW + g.sp * 0.1, g.binTop])
      .fill({ color: ink, alpha: 0.07 })
      .stroke({ width: 2 * g.k, color: ink, alpha: 0.35 });
    for (let s = 0; s < bins; s++) {
      boardG.rect(g.x0 + s * g.slotW, g.binTop, g.slotW, g.binH).fill({ color: S.color(s), alpha: 0.38 }).stroke({ width: 2.5 * g.k, color: INK });
    }
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i <= r; i++) boardG.circle(g.cx + (i - r / 2) * g.sp, g.pegTop + r * g.rowH, g.pr).fill(ink);
    }
  };

  /* ------------------------------------------------------------------ script */
  let tAll = 0, tHold = 0, saidUpTo = -1, crowned = false, dead = false;

  const crownUI = S.crown(names, winners);
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.08).shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    for (const b of balls) {
      b.landed = true;
      b.announced = true;
      b.seg = R + 1;
    }
    tAll = T_CROWN;
    crown();
  };

  const onSeg = (b: Ball, i: number, seg: number): void => {
    const big = i === last;
    const left = R - seg;
    if (seg === 0) {
      beep(note(7), 0.1, "triangle", big ? 0.045 : 0.03);
      if (big || total === 1) S.say(t("cPlkDrop"), 0.3);
      return;
    }
    // A peg: the pitch climbs with the row, so the last rows are the highest.
    beep(note(5 + Math.min(9, seg)), big ? 0.07 : 0.045, "triangle", (big ? 0.04 : 0.028) + (big ? 0.02 * (seg / R) : 0));
    if (!big) return;
    if (seg === Math.floor(R * 0.4)) S.say(t("cPlkBounce"), 0.5);
    else if (left === 4) S.say(t("cPlkLate"), 0.7);
    else if (left === 2 && b.drop.swerve !== 0 && story.arc !== "tapada") {
      S.say(T[getLang()].cPlkNear(nameOfSlot(clamp(b.slot + b.drop.swerve, 0, board.slots - 1))), 0.85);
      beep(note(14), 0.1, "square", 0.05);
    } else if (left === 1) {
      S.say(t("cPlkLast"), 0.9);
      cam.punch(0.05);
    }
    if (left <= 3) cam.shake(3 * g.k);
  };

  const onLand = (b: Ball, i: number): void => {
    b.landed = true;
    beep(note(i === last ? 0 : 3), i === last ? 0.4 : 0.2, "triangle", i === last ? 0.07 : 0.05);
    cam.punch(i === last ? 0.1 : 0.05).shake((i === last ? 12 : 6) * g.k);
    if (i !== last) S.say(T[getLang()].cPlkDone(nameOfSlot(b.slot)), 0.55);
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.1, () => {
        S.say(t("cPlkHang"), 0.1);
        [5, 7, 9].forEach((d, i) => setTimeout(() => beep(note(d), 0.12, "triangle", 0.04), 120 + i * 140));
      }],
      [1.7, () => {
        S.say(T[getLang()].cPlkCount(board.slots), 0.15);
        for (let i = 0; i < 5; i++) setTimeout(() => beep(note(10 + (i % 3)), 0.04, "square", 0.025), 200 + i * 90);
      }],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    balls.forEach((b, i) => {
      if (!b.announced && tAll >= b.start - (i === last ? 1.6 : 0.8)) {
        b.announced = true;
        if (total > 1) {
          S.say(T[getLang()].cPlkNext(i + 1, total), 0.3 + 0.5 * (i / Math.max(1, last)));
          beep(note(8 + (i % 4)), 0.12, "sine", 0.04);
        }
      }
      if (tAll >= b.start && !b.landed) {
        const { seg } = locateHop(b.durs, Math.min(tAll - b.start, b.len));
        while (b.seg < seg) onSeg(b, i, ++b.seg);
        if (tAll >= b.land) onLand(b, i);
      }
    });
  }

  /* -------------------------------------------------------------------- draw */
  const nameChip = (s: number): Container => {
    let ch = chipOf.get(s);
    if (!ch) {
      ch = S.chip(nameOfSlot(s));
      chipOf.set(s, ch);
      chipLayer.addChild(ch);
    }
    return ch;
  };

  function aim(): void {
    const cur = balls.find((b) => tAll >= b.start && tAll < b.end);
    let x = g.w / 2, y = g.h / 2, z = 1, rate = 2;
    if (cur && tAll < T_CROWN) {
      const isGrand = cur === grand;
      const lt = Math.min(tAll - cur.start, cur.len);
      const left = R - locateHop(cur.durs, lt).seg;
      const p = posAt(cur, lt);
      if (cur.landed && isGrand) {
        z = 1.9;
        x = slotX(cur.slot);
        y = g.binTop;
        rate = 3;
      } else if (!cur.landed && isGrand) {
        // Remontada closes in early, tapada waits for the very last fall.
        const near = story.arc === "remontada" ? 6 : story.arc === "tapada" ? 1 : 3;
        z = left <= 1 ? 2.3 : left <= near ? 1.8 : left <= 5 ? 1.25 : 1;
        rate = left <= 3 ? 4 : 2.5;
        if (z > 1.01) {
          x = p.x;
          y = p.y;
        }
      }
    }
    // Keep the view inside the world: no dead space beyond the screen.
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, rate);
  }

  function draw(): void {
    const rows = clamp(Math.floor((tAll - 0.15) / 0.12) + 1, 0, R);
    let bins = 0;
    while (bins < board.slots && tAll >= binReveal(bins)) bins++;
    if (rows !== drawnRows || bins !== drawnBins) {
      drawnRows = rows;
      drawnBins = bins;
      drawBoard(rows, bins);
    }
    avatars.forEach((av, s) => {
      const f = clamp((tAll - binReveal(s)) / 0.35, 0, 1);
      const size = Math.min(g.slotW * 0.74, g.binH * 0.78) * ease.outBack(f);
      av.alpha = f > 0 ? 1 : 0;
      av.width = av.height = Math.max(0.01, size);
    });

    fx.clear();
    ballG.clear();
    const focus = new Set<number>();
    balls.forEach((b, i) => {
      const lt = tAll - b.start;
      if (lt < 0) {
        // Hanging at the top, waiting to be dropped (only the next one).
        if (b.start - tAll < (i === last ? HANG_BIG : HANG_SMALL) && (i === 0 || (balls[i - 1] as Ball).landed)) {
          drawBall(b, g.cx, g.pegTop - 1.5 * g.rowH, 1, false);
        }
        return;
      }
      const flying = lt < b.len;
      const p = posAt(b, Math.min(lt, b.len));
      if (flying) {
        const { seg } = locateHop(b.durs, lt);
        const left = R - seg;
        // The peg it just hit rings, and a short trail follows the ball.
        if (seg >= 1) {
          const row = seg - 1;
          const age = (lt - b.durs.slice(0, seg).reduce((a, d) => a + d, 0)) * 3;
          if (age < 1) {
            const pegX = g.cx + (b.trail[row] as number) * g.sp;
            fx.circle(pegX, g.pegTop + row * g.rowH, g.pr * (1 + 4 * age)).stroke({ width: 2 * g.k, color: YELLOW, alpha: 1 - age });
          }
        }
        for (let q = 6; q >= 1; q--) {
          const pt = posAt(b, Math.max(0, lt - q * 0.035));
          fx.circle(pt.x, pt.y, g.br * (1 - q * 0.1)).fill({ color: YELLOW, alpha: 0.05 + 0.04 * (6 - q) });
        }
        drawBall(b, p.x, p.y, 1, i === last && left <= 3);
        if (i === last && left <= 3 && story.arc !== "tapada") {
          const s0 = slotAt(p.x);
          for (const s of [s0 - 1, s0, s0 + 1]) if (s >= 0 && s < board.slots) focus.add(s);
        }
      } else {
        // Landed: it bounces a little and rests in the bin.
        const age = lt - b.len;
        const bounce = g.k * 10 * Math.exp(-age * 5) * Math.abs(Math.sin(age * 14));
        drawBall(b, p.x, p.y - bounce, 1, false);
        if (i === last || age < 1.6) focus.add(b.slot);
        if (i === last) {
          const pulse = 0.25 + 0.2 * Math.sin(age * 7);
          fx.rect(g.x0 + b.slot * g.slotW, g.binTop, g.slotW, g.binH).fill({ color: YELLOW, alpha: pulse }).stroke({ width: 3 * g.k, color: YELLOW });
        }
      }
    });

    for (const ch of chipOf.values()) ch.visible = false;
    for (const s of focus) {
      const ch = nameChip(s);
      const q = cam.toScreen(slotX(s), g.binTop + g.binH + 16 * g.k, g.w, g.h);
      ch.visible = true;
      ch.position.set(clamp(q.x - ch.width / 2, 4, Math.max(4, g.w - ch.width - 4)), q.y);
    }
  }

  function drawBall(b: Ball, x: number, y: number, s: number, glow: boolean): void {
    if (glow) ballG.circle(x, y, g.br * 2.6).fill({ color: YELLOW, alpha: 0.22 });
    ballG.circle(x + g.k, y + g.k * 1.5, g.br * s).fill({ color: INK, alpha: 0.4 });
    ballG.circle(x, y, g.br * s).fill(b === grand ? YELLOW : S.color(b.slot)).stroke({ width: 2 * g.k, color: INK });
    ballG.circle(x - g.br * 0.3, y - g.br * 0.3, g.br * 0.25).fill({ color: 0xffffff, alpha: 0.8 });
  }

  S.run((dt, now) => {
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
    if (tHold >= WINNER_HOLD) {
      dead = true;
      S.cleanup();
    }
  });
}
