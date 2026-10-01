import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, YELLOW, mountPixi, type PixiStage } from "./stage";
import { assignSlots } from "./plinko-plan";
import { HAND, arcPoint, holeLayout, optsForArc, planThrows, throwTime, type Point, type Throw } from "./sapo-plan";

/**
 * Sapo (frog toss).
 *
 * A table seen from above, tilted a little, with a big frog in the middle and
 * one hole per name around it. A token is tossed again and again: some throws
 * miss (they hit the bare table, clink and roll off), some nearly drop in (they
 * wobble on the rim of a neighbouring hole and pop out) and the final throw of
 * each winner drops into that winner's hole. The game decides nothing: the
 * holes of the winners are known first and the throws are planned from them
 * (see `sapo-plan.ts`, which is pure and tested), so the token provably ends
 * where the protocol said. This file only draws and narrates that plan.
 *
 * With several winners there is a short toss sequence per winner, in the order
 * of `winners`, each ending in its own hole; the last winner gets the big
 * moment. The arcs (`drama.ts`) shape the last winner's tosses:
 *
 * - **susto / duelo**: more misses and two near misses; the narrator names the
 *   neighbour whose rim the token danced on.
 * - **remontada**: many misses, and the camera follows the last winner's tosses
 *   closely from the start.
 * - **tapada**: nobody is named before the token is in; the camera waits for
 *   the very last flight.
 *
 * Everything is a function of the stage clock (`dt`), never of wall time.
 */

const T_INTRO = 4.5;
const HANG_FIRST = 2.0;
const HANG_FINAL = 1.8;
const HANG_SMALL = 0.5;
/** Seconds after landing before the next hang: bounce and roll-off, wobble and pop, or the sink into the hole. */
const AFTER_MISS = 0.8;
const AFTER_NEAR = 1.3;
const AFTER_HIT = 1.0;
const AFTER_FINAL = 2.0;
/** Part of AFTER_NEAR spent wobbling on the rim before the token pops out. */
const WOBBLE = 0.8;
const SINK = 0.5;
/** Table tilt: vertical squash of the top-down view. */
const TILT = 0.62;

interface Toss {
  th: Throw;
  /** Position in the whole sequence. */
  i: number;
  /** Winner participant index this turn is for. */
  name: number;
  slot: number;
  grand: boolean;
  final: boolean;
  start: number;
  land: number;
  end: number;
  flight: number;
  announced: boolean;
  thrown: boolean;
  landed: boolean;
}

export async function sapoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const L = holeLayout(n);
  const holes = L.holes.length;
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("sapo", `${holes}`);
  const plan = assignSlots(n, prizes, rng);
  let throws: Throw[];
  try {
    throws = planThrows(n, plan.winnerSlots, rng, optsForArc(story.arc));
  } catch {
    // An impossible plan (repeated or out-of-range winner): never leave the draw hanging.
    S.cleanup();
    return;
  }
  const nameOfSlot = (s: number): string => names[plan.nameAt[s] as number] ?? "";

  /* ---------------------------------------------------------------- the script */
  const tosses: Toss[] = [];
  let tt = T_INTRO;
  throws.forEach((th, i) => {
    const final = i === throws.length - 1;
    const grand = th.turn === last;
    tt += i === 0 ? HANG_FIRST : final ? HANG_FINAL : HANG_SMALL;
    const flight = throwTime(th.kind, grand);
    const after = th.kind === "miss" ? AFTER_MISS : th.kind === "near" ? AFTER_NEAR : final ? AFTER_FINAL : AFTER_HIT;
    const start = tt;
    tosses.push({
      th, i, name: prizes[th.turn] as number, slot: plan.winnerSlots[th.turn] as number, grand, final,
      start, land: start + flight, end: start + flight + after, flight,
      announced: false, thrown: false, landed: false,
    });
    tt = start + flight + after;
  });
  const T_CROWN = tt;
  setGameLength(T_CROWN, WINNER_HOLD);

  /* ---------------------------------------------------------------- geometry */
  const G = (): { w: number; h: number; k: number; cx: number; cy: number; sc: number; br: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const topY = S.top() + 8 * k, botY = h - S.bottom() - 4 * k;
    // Floored: a tiny viewport must not give a zero or negative scale.
    const sc = Math.max(8, Math.min((w * 0.47) / L.tableR, (botY - topY - 26 * k) / ((L.tableR + HAND.y) * TILT)));
    const mid = (topY + botY) / 2;
    const cy = mid - ((HAND.y - L.tableR) / 2) * TILT * sc;
    return { w, h, k, cx: w / 2, cy, sc, br: clamp(sc * 0.085, 5 * k, 13 * k) };
  };
  let g = G();
  const P = (p: Point): Point => ({ x: g.cx + p.x * g.sc, y: g.cy + p.y * g.sc * TILT });
  const outward = (s: number): Point => {
    const h = L.holes[s] as Point;
    const d = Math.hypot(h.x, h.y) || 1;
    return { x: h.x + (h.x / d) * L.holeR * 2, y: h.y + (h.y / d) * L.holeR * 2 };
  };

  /* ------------------------------------------------------------------ layers */
  const sky = new Graphics();
  S.bg.addChild(sky);
  const tableG = new Graphics();
  const frogG = new Graphics();
  const avLayer = new Container();
  const fx = new Graphics();
  const tokG = new Graphics();
  S.scene.addChild(tableG, avLayer, frogG, fx, tokG);
  const chipLayer = new Container();
  S.hud.addChild(chipLayer);
  // On-screen rule line, then the "Winner k of n" counter (several winners only).
  const caption = S.text("", { fontSize: 15, fontWeight: "800", fill: INK, align: "center" });
  caption.anchor.set(0.5, 0);
  caption.alpha = 0;
  S.hud.addChild(caption);
  const ruleText = t(total > 1 ? "cSapRuleMany" : "cSapRuleOne");
  // Persistent "taken" badges over winners' holes, and the "Almost!" label (scene space).
  const badgeLayer = new Container();
  const badgeOf = new Map<number, Text>();
  const almost = S.text("", { fontSize: 14, fontWeight: "900", fill: INK, stroke: { color: CREAM, width: 4 } });
  almost.anchor.set(0.5, 1);
  almost.alpha = 0;
  S.scene.addChild(badgeLayer, almost);
  const chipOf = new Map<number, Container>();
  let avatars: Sprite[] = [];

  const build = (): void => {
    g = G();
    sky.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1d2a26 : 0xffe9b8);
    avLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    avatars = [];
    for (let s = 0; s < holes; s++) {
      const av = new Sprite(S.face(nameOfSlot(s)));
      av.anchor.set(0.5);
      const q = P(outward(s));
      av.position.set(q.x, q.y);
      av.alpha = 0;
      avatars.push(av);
      avLayer.addChild(av);
    }
    chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    chipOf.clear();
    badgeLayer.removeChildren().forEach((c) => c.destroy());
    badgeOf.clear();
    caption.style.fontSize = 15 * g.k;
    caption.style.wordWrap = true;
    caption.style.wordWrapWidth = g.w * 0.9;
    almost.style.fontSize = 15 * g.k;
    almost.text = t("cSapAlmost");
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  const holeReveal = (s: number): number => 1.4 + (s * 2.2) / holes;

  /* ------------------------------------------------------------------ motion */
  interface Tok { x: number; y: number; ground: Point; scale: number; alpha: number; height: number }

  /** Where the token is at time `t` (screen space), including its table-space ground point. */
  const tokenAt = (o: Toss, t: number): Tok => {
    const hand = P(HAND);
    const land = P(o.th.landing);
    if (t < o.land) {
      const f = clamp((t - o.start) / o.flight, 0, 1);
      const apex = g.sc * (o.final ? 0.95 : 0.7);
      const q = arcPoint(hand, land, f, apex);
      const ground = { x: HAND.x + (o.th.landing.x - HAND.x) * f, y: HAND.y + (o.th.landing.y - HAND.y) * f };
      return { x: q.x, y: q.y, ground, scale: 1, alpha: 1, height: 4 * apex * f * (1 - f) };
    }
    const age = t - o.land;
    if (o.th.kind === "hit") {
      const u = clamp(age / SINK, 0, 1);
      return { x: land.x, y: land.y + g.br * 0.8 * u, ground: o.th.landing, scale: 1 - 0.85 * ease.outCubic(u), alpha: u >= 1 ? 0 : 1, height: 0 };
    }
    let gp: Point;
    let hop: number;
    if (o.th.kind === "near" && age < WOBBLE) {
      const u = age / WOBBLE;
      const w = 0.03 * (1 - u);
      gp = { x: o.th.landing.x + w * Math.sin(age * 26), y: o.th.landing.y + w * Math.cos(age * 19) };
      hop = g.br * 0.9 * (1 - u) * Math.abs(Math.sin(age * 15));
    } else {
      const base = o.th.kind === "near" ? WOBBLE : 0;
      const span = (o.th.kind === "near" ? AFTER_NEAR : AFTER_MISS) - base;
      const u = clamp((age - base) / span, 0, 1);
      const e = ease.outCubic(u);
      gp = { x: o.th.landing.x + (o.th.exit.x - o.th.landing.x) * e, y: o.th.landing.y + (o.th.exit.y - o.th.landing.y) * e };
      hop = g.br * 2.6 * (1 - u) * Math.abs(Math.sin(u * Math.PI * 3));
    }
    const q = P(gp);
    const off = clamp((Math.hypot(gp.x, gp.y) - L.tableR) / 0.6, 0, 1);
    return { x: q.x, y: q.y - hop, ground: gp, scale: 1, alpha: 1 - off, height: hop };
  };

  /* ------------------------------------------------------------------ script */
  let tAll = 0, tHold = 0, crowned = false, dead = false, introSaid = 0;

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
    for (const o of tosses) {
      o.announced = o.thrown = o.landed = true;
    }
    tAll = T_CROWN;
    crown();
  };

  const onLand = (o: Toss): void => {
    o.landed = true;
    const big = o.grand;
    const k = g.k;
    if (o.th.kind === "miss") {
      beep(note(4), 0.08, "square", big ? 0.05 : 0.03);
      cam.punch(big ? 0.04 : 0.02).shake((big ? 4 : 2) * k);
      if (big) S.say(t("cSapMiss"), 0.5);
    } else if (o.th.kind === "near") {
      beep(note(12), 0.09, "triangle", big ? 0.055 : 0.035);
      [0, 1, 2].forEach((d) => setTimeout(() => beep(note(11 - d), 0.05, "square", 0.025), 110 + d * 130));
      cam.punch(big ? 0.06 : 0.03).shake((big ? 6 : 3) * k);
      if (big) {
        if (story.arc === "tapada") S.say(t("cSapRim"), 0.7);
        else S.say(T[getLang()].cSapNear(nameOfSlot(o.th.rimSlot as number)), 0.85);
      }
    } else {
      beep(note(o.final ? 0 : 3), o.final ? 0.4 : 0.2, "triangle", o.final ? 0.07 : 0.05);
      beep(note(o.final ? -5 : -2), 0.16, "sawtooth", 0.035);
      cam.punch(o.final ? 0.1 : 0.05).shake((o.final ? 12 : 6) * k);
      if (o.final) S.say(t("cSapCroak"), 1);
      else S.say(T[getLang()].cSapDone(nameOfSlot(o.slot)), 0.55);
    }
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.1, () => {
        S.say(t("cSapHang"), 0.1);
        [5, 7, 9].forEach((d, i) => setTimeout(() => beep(note(d), 0.12, "triangle", 0.04), 120 + i * 140));
      }],
      [1.7, () => {
        S.say(T[getLang()].cSapCount(holes), 0.15);
        for (let i = 0; i < 5; i++) setTimeout(() => beep(note(10 + (i % 3)), 0.04, "square", 0.025), 200 + i * 90);
      }],
      [3.3, () => {
        S.say(ruleText, 0.2);
        beep(note(12), 0.08, "triangle", 0.03);
      }],
    ];
    while (introSaid < cues.length && tAll >= (cues[introSaid] as [number, () => void])[0]) (cues[introSaid++] as [number, () => void])[1]();
    for (const o of tosses) {
      const firstOfTurn = o.i === 0 || (tosses[o.i - 1] as Toss).th.turn !== o.th.turn;
      if (!o.announced && tAll >= o.start - 0.7) {
        o.announced = true;
        if (firstOfTurn && total > 1) {
          S.say(T[getLang()].cSapNext(o.th.turn + 1, total), 0.3 + 0.5 * (o.th.turn / Math.max(1, last)));
          beep(note(8 + (o.th.turn % 4)), 0.12, "sine", 0.04);
        }
        if (o.final) S.say(t("cSapLast"), 0.9);
      }
      if (!o.thrown && tAll >= o.start) {
        o.thrown = true;
        beep(note(7), 0.1, "triangle", o.grand ? 0.045 : 0.03);
        if (o.i === 0 || (o.grand && o.th.kind === "miss" && firstOfTurn)) S.say(t("cSapThrow"), 0.3);
      }
      if (!o.landed && tAll >= o.land) onLand(o);
    }
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

  const current = (): Toss | undefined => tosses.find((o) => tAll >= o.start - 0.4 && tAll < o.end);

  function aim(): void {
    const cur = current();
    let x = g.w / 2, y = g.h / 2, z = 1, rate = 2;
    if (cur && cur.grand && tAll < T_CROWN) {
      const tok = tokenAt(cur, clamp(tAll, cur.start, cur.end));
      const close = story.arc === "remontada";
      if (tAll < cur.start) {
        z = close ? 1.3 : 1;
      } else if (cur.final) {
        if (tAll < cur.land) {
          // A slow push-in over the whole last flight; tapada waits for its second half.
          const f = clamp((tAll - cur.start) / cur.flight, 0, 1);
          z = story.arc === "tapada" ? 1 + 1.3 * Math.max(0, f - 0.5) * 2 : 1 + 1.2 * f * f;
          x = tok.x;
          y = tok.y;
          rate = 3 + 2 * f;
        } else {
          const q = P(cur.th.landing);
          z = 2.3;
          x = q.x;
          y = q.y;
          rate = 3;
        }
      } else {
        // Follow the token, and punch in on the rim of a near miss.
        z = close ? 1.6 : cur.th.kind === "near" && tAll >= cur.land ? 1.8 : 1.25;
        x = tok.x;
        y = tok.y;
        rate = 2.5;
      }
    }
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    cam.lookAt(x, y, z, rate);
  }

  const croakAt = (): number => {
    let c = 0.12 + 0.05 * Math.sin(tAll * 3);
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land) continue;
      const age = tAll - o.land;
      c = Math.max(c, o.final ? clamp(1 - age / 2.2, 0, 1) * (0.75 + 0.25 * Math.sin(age * 16)) : clamp(1 - age / 0.9, 0, 1));
    }
    return clamp(c, 0, 1);
  };

  function draw(): void {
    const ink = S.dark ? CREAM : INK;
    const R = L.tableR * g.sc;
    tableG.clear();
    tableG.ellipse(g.cx, g.cy + 10 * g.k, R, R * TILT).fill({ color: INK, alpha: 0.35 });
    tableG.ellipse(g.cx, g.cy, R, R * TILT).fill(S.dark ? 0x5a3d2a : 0xa8743f).stroke({ width: 3 * g.k, color: INK });
    tableG.ellipse(g.cx, g.cy, R * 0.92, R * 0.92 * TILT).fill(S.dark ? 0x2f4a3a : 0x5f9a5a).stroke({ width: 1.5 * g.k, color: ink, alpha: 0.4 });
    fx.clear();
    tokG.clear();

    const lit = new Map<number, number>();
    for (const o of tosses) if (o.th.kind === "hit" && tAll >= o.land) lit.set(o.slot, o.final ? 1 : 0.6);
    for (let s = 0; s < holes; s++) {
      const f = clamp((tAll - holeReveal(s)) / 0.35, 0, 1);
      const c = P(L.holes[s] as Point);
      const rx = L.holeR * g.sc * ease.outBack(f), ry = rx * TILT;
      if (f > 0) {
        tableG.ellipse(c.x, c.y, Math.max(0.01, rx), Math.max(0.01, ry)).fill(INK).stroke({ width: 3 * g.k, color: S.color(s) });
        const glow = lit.get(s);
        if (glow !== undefined) {
          const pulse = glow === 1 ? 0.35 + 0.2 * Math.sin(tAll * 7) : 0.3;
          fx.ellipse(c.x, c.y, rx * 1.25, ry * 1.25).fill({ color: YELLOW, alpha: pulse }).stroke({ width: 3 * g.k, color: YELLOW });
        }
      }
      const av = avatars[s] as Sprite;
      const size = Math.min(L.holeR * g.sc * 1.9, 46 * g.k) * ease.outBack(f);
      av.alpha = f > 0 ? 1 : 0;
      av.width = av.height = Math.max(0.01, size);
    }

    // The frog: body, eyes and a mouth that opens with each croak.
    const c0 = P({ x: 0, y: 0 });
    const fr = L.frogR * g.sc;
    const open = croakAt();
    frogG.clear();
    frogG.ellipse(c0.x, c0.y + fr * 0.2, fr * 1.05, fr * 0.8).fill({ color: INK, alpha: 0.3 });
    frogG.ellipse(c0.x, c0.y, fr, fr * 0.85).fill(0x6fbf4a).stroke({ width: 2.5 * g.k, color: INK });
    for (const dx of [-0.55, 0.55]) {
      frogG.circle(c0.x + dx * fr, c0.y - fr * 0.78, fr * 0.26).fill(CREAM).stroke({ width: 2 * g.k, color: INK });
      frogG.circle(c0.x + dx * fr, c0.y - fr * 0.74, fr * 0.1).fill(INK);
    }
    const mx = fr * 0.62 * (0.7 + 0.3 * open), my = fr * (0.08 + 0.34 * open);
    frogG.ellipse(c0.x, c0.y + fr * 0.28, mx, my).fill(INK);
    if (open > 0.55) frogG.ellipse(c0.x, c0.y + fr * 0.28 + my * 0.3, mx * 0.5, my * 0.45).fill(0xe0707a);

    const focus = new Set<number>();
    for (const o of tosses) {
      if (tAll < o.start - HANG_FIRST) continue;
      const prevDone = o.i === 0 || (tosses[o.i - 1] as Toss).landed || tAll >= (tosses[o.i - 1] as Toss).end - 0.2;
      if (tAll < o.start) {
        // Waiting in the hand: only the next toss, with a small bob.
        if (prevDone && o.start - tAll < (o.final ? HANG_FINAL : o.i === 0 ? HANG_FIRST : HANG_SMALL)) {
          const hp = P(HAND);
          drawToken(o, hp.x, hp.y + g.br * 0.5 * Math.sin(tAll * 4), 1, false);
        }
        continue;
      }
      if (tAll >= o.end && !(o.final && o.th.kind === "hit")) continue;
      const tk = tokenAt(o, Math.min(tAll, o.end));
      const flying = tAll < o.land;
      if (flying) {
        const sh = P(tk.ground);
        const sz = g.br * (1 - clamp(tk.height / (g.sc * 2), 0, 0.5));
        fx.ellipse(sh.x, sh.y + g.br * 0.5, sz, sz * TILT).fill({ color: INK, alpha: 0.35 });
        for (let q = 5; q >= 1; q--) {
          const pt = tokenAt(o, Math.max(o.start, tAll - q * 0.03));
          fx.circle(pt.x, pt.y, g.br * (1 - q * 0.1)).fill({ color: YELLOW, alpha: 0.05 + 0.04 * (5 - q) });
        }
        drawToken(o, tk.x, tk.y, tk.scale, o.final);
      } else {
        const age = tAll - o.land;
        if (o.th.kind !== "hit" && age < 0.4) {
          const lp = P(o.th.landing);
          fx.ellipse(lp.x, lp.y, g.br * (1 + 4 * age), g.br * (1 + 4 * age) * TILT).stroke({ width: 2 * g.k, color: YELLOW, alpha: 1 - age / 0.4 });
        }
        if (tk.alpha > 0.01) {
          const sh = P(tk.ground);
          fx.ellipse(sh.x, sh.y + g.br * 0.5, g.br, g.br * TILT).fill({ color: INK, alpha: 0.3 * tk.alpha });
          drawToken(o, tk.x, tk.y, tk.scale, false, tk.alpha);
        }
        if (o.th.kind === "near" && o.grand && story.arc !== "tapada" && age < AFTER_NEAR) focus.add(o.th.rimSlot as number);
        if (o.th.kind === "hit" && (o.final || age < 1.6)) focus.add(o.slot);
      }
    }

    // Caption: the rule until the first toss, then the winner counter (or the rule, with one winner).
    let turn = 0;
    for (const o of tosses) if (tAll >= o.start - 0.7) turn = o.th.turn;
    const started = tAll >= (tosses[0] as Toss).start - 0.7;
    caption.text = started && total > 1 ? T[getLang()].cSapTally(turn + 1, total) : ruleText;
    caption.position.set(g.w / 2, S.top() + 2 * g.k);
    caption.alpha = clamp((tAll - 2.6) / 0.5, 0, 1) * (crowned ? 0 : 1);

    // Persistent badges: a winner's hole stays "taken" with its order number (or a check for one winner).
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land + SINK) continue;
      const c = P(L.holes[o.slot] as Point);
      const br = Math.max(7 * g.k, L.holeR * g.sc * 0.55);
      const bx = c.x + L.holeR * g.sc * 0.95, by = c.y - L.holeR * g.sc * TILT * 1.1;
      fx.circle(bx, by, br).fill(YELLOW).stroke({ width: 2 * g.k, color: INK });
      if (total > 1) {
        let b = badgeOf.get(o.th.turn);
        if (!b) {
          b = S.text(`${o.th.turn + 1}`, { fontSize: br * 1.3, fontWeight: "900", fill: INK });
          b.anchor.set(0.5);
          badgeOf.set(o.th.turn, b);
          badgeLayer.addChild(b);
        }
        b.position.set(bx, by);
      } else {
        fx.moveTo(bx - br * 0.45, by).lineTo(bx - br * 0.1, by + br * 0.35).lineTo(bx + br * 0.5, by - br * 0.35).stroke({ width: 2.5 * g.k, color: INK });
      }
    }

    // "Almost!" next to a near miss, above where it rests.
    almost.alpha = 0;
    for (const o of tosses) {
      if (o.th.kind !== "near" || tAll < o.land || tAll >= o.land + AFTER_NEAR) continue;
      const age = tAll - o.land;
      const lp = P(o.th.landing);
      almost.position.set(lp.x, lp.y - g.br * 2.2 - 6 * g.k * ease.outCubic(clamp(age / 0.3, 0, 1)));
      almost.alpha = clamp(age / 0.15, 0, 1) * clamp((AFTER_NEAR - age) / 0.3, 0, 1);
    }

    for (const ch of chipOf.values()) ch.visible = false;
    for (const s of focus) {
      const ch = nameChip(s);
      const hp = P(L.holes[s] as Point);
      const q = cam.toScreen(hp.x, hp.y + L.holeR * g.sc * TILT + 14 * g.k, g.w, g.h);
      ch.visible = true;
      ch.position.set(clamp(q.x - ch.width / 2, 4, Math.max(4, g.w - ch.width - 4)), q.y);
    }
  }

  function drawToken(o: Toss, x: number, y: number, s: number, glow: boolean, alpha = 1): void {
    const r = g.br * s;
    if (glow) tokG.circle(x, y, g.br * 2.6).fill({ color: YELLOW, alpha: 0.22 * alpha });
    tokG.ellipse(x, y, r, r * 0.85).fill({ color: o.final || o.grand ? YELLOW : S.color(o.slot), alpha }).stroke({ width: 2 * g.k, color: INK, alpha });
    tokG.ellipse(x - r * 0.3, y - r * 0.3, r * 0.25, r * 0.2).fill({ color: 0xffffff, alpha: 0.8 * alpha });
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
