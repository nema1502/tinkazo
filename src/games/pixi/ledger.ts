import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, shorten, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Cierre de Libro, en PixiJS, con el director de cámara.
 *
 * El mismo juego de `ledger.ts`: las tarjetas caen, las barridas del cierre
 * eliminan a las de más abajo del orden sembrado, la ganadora nunca cae, y en
 * la mesa final se sellan de a una. El susto (la barrida que casi se la lleva)
 * y el sello que duda también son los mismos. Lo nuevo es la cámara: sigue a
 * la barra en cada barrida, se mete en la tarjeta del susto, se acerca a la
 * mesa final, pega un golpe con cada sello y queda encima de la ganadora
 * mientras el sello duda.
 */

type Phase = "fall" | "sweep" | "stamp" | "seal" | "dead";
interface Card {
  idx: number; x: number; y: number; tx: number; ty: number; w: number; h: number; tw: number; th: number;
  in: number; alive: boolean; killed: number; bits: { x: number; y: number; vx: number; vy: number; r: number }[];
  stamp: number; susto: number; stampAt?: number; view?: Container; big?: Container; small?: Graphics; stampG?: Graphics; scare?: Graphics;
}

function sweepPlan(n: number, final: number): { from: "top" | "bottom"; cut: number }[] {
  const room = Math.max(0, n - final);
  const count = room >= 24 ? 6 : room >= 14 ? 5 : room >= 9 ? 4 : room >= 4 ? 3 : room >= 2 ? 2 : 1;
  const cuts = [[1], [0.55, 1], [0.5, 0.6, 1], [0.45, 0.55, 0.6, 1], [0.4, 0.45, 0.5, 0.6, 1], [0.35, 0.4, 0.45, 0.5, 0.6, 1]][count - 1] as number[];
  return cuts.map((cut, i) => ({ from: i % 2 === 0 ? "top" : "bottom", cut } as const));
}
const sweepDur = (n: number): number => clamp(1.8 + n / 80, 1.8, 3.2);
const HOLD = 2.0;
const STAMP_GAP = 0.7;
const FALL = 1.4;
/** El tamaño de referencia de una tarjeta: se arma así y se escala. */
const REF_W = 260;
const REF_H = REF_W * 0.36;

export async function ledgerPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const FINAL = Math.min(3, Math.max(1, n - 1));
  const SWEEPS = sweepPlan(n, FINAL);
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  const susto = story.arc === "susto" && n >= 2;
  const duda = story.arc === "duelo" && FINAL >= 2;
  S.mark("arco", story.arc);
  const DUDA = 0.9;
  setGameLength(FALL + SWEEPS.length * sweepDur(n) + HOLD + (FINAL - 1) * STAMP_GAP + 0.8 + (duda ? DUDA : 0), WINNER_HOLD);

  let phase: Phase = "fall";
  let tPhase = 0, sweepI = 0, sweepY = 0, stampI = 0, sealK = 0, fallTicks = 0, killTicks = 0;
  let ledgerBump = false, tHold = 0, heldTicks = 0, saidSusto = false, saidDuda = false;
  const cards: Card[] = names.map((_, i) => ({ idx: i, x: 0, y: 0, tx: 0, ty: 0, w: 0, h: 0, tw: 0, th: 0, in: 0, alive: true, killed: 0, bits: [], stamp: 0, susto: 0 }));
  const rank = cards.map((q) => q.idx).filter((i) => i !== winnerIdx);
  for (let i = rank.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rank[i], rank[j]] = [rank[j] as number, rank[i] as number];
  }
  rank.unshift(winnerIdx);
  const rankOf = new Map(rank.map((idx, pos) => [idx, pos]));

  function layout(m: number, finale = false): void {
    const k = S.u();
    const w = S.sw(), h = S.sh();
    const alive = cards.filter((q) => q.alive);
    const cols = finale ? 1 : Math.max(1, Math.round(Math.sqrt(m * (w / h))) || 1);
    const rows = Math.ceil(m / cols);
    const gap = (finale ? 18 : 8) * k;
    let cw = clamp((w * 0.86) / cols - gap, 34 * k, (finale ? 560 : 260) * k);
    let ch = cw * 0.36;
    const arriba = S.top() + 12 * k;
    const abajo = h - S.bottom() - 12 * k;
    const maxH = Math.min(h * 0.74, abajo - arriba);
    if (rows * (ch + gap) - gap > maxH) {
      ch = (maxH + gap) / rows - gap;
      cw = Math.max(34 * k, ch / 0.36);
    }
    const gw = cols * (cw + gap) - gap;
    const gh = rows * (ch + gap) - gap;
    const x0 = w / 2 - gw / 2;
    const y0 = arriba + (abajo - arriba - gh) / 2;
    alive.forEach((q, i) => {
      q.tx = x0 + (i % cols) * (cw + gap);
      q.ty = y0 + Math.floor(i / cols) * (ch + gap);
      q.tw = cw;
      q.th = ch;
      if (q.w === 0) {
        q.w = cw;
        q.h = ch;
        q.x = q.tx;
        q.y = -ch - rng() * h * 0.5;
      }
    });
  }
  layout(n);

  function kill(q: Card): void {
    q.alive = false;
    q.killed = 0;
    const k = S.u();
    for (let i = 0; i < 4; i++) {
      q.bits.push({ x: q.x + (i % 2) * (q.w / 2), y: q.y + Math.floor(i / 2) * (q.h / 2), vx: (rng() - 0.5) * 220 * k, vy: -rng() * 120 * k, r: (rng() - 0.5) * 6 });
    }
    killTicks++;
    if (killTicks % 3 === 0) beep(note(killTicks % 6 === 0 ? 10 : 12), 0.03, "square", 0.022);
  }
  function startSweep(): void {
    phase = "sweep";
    tPhase = 0;
    setTimeout(() => beepFor(note(sweepI), sweepDur(n) + 0.15, "sawtooth", 0.03), 90);
    const last = sweepI === SWEEPS.length - 1;
    S.say(t(last ? "cLedgerSweep3" : sweepI === 0 ? "cLedgerSweep" : "cLedgerSweep2"), 0.2 + (sweepI / Math.max(1, SWEEPS.length - 1)) * 0.6);
  }
  function survivors(i: number): number {
    const alive = cards.filter((q) => q.alive).length;
    if (i >= SWEEPS.length - 1) return FINAL;
    const cut = SWEEPS[i]?.cut ?? 0.6;
    const left = SWEEPS.length - 1 - i;
    const ceilK = Math.max(FINAL, alive - 1);
    const floorK = Math.min(FINAL + left, ceilK);
    return clamp(Math.round(alive * (1 - cut)), floorK, ceilK);
  }
  function endSweep(): void {
    const keep = survivors(sweepI);
    const alive = cards.filter((q) => q.alive).sort((a, b) => (rankOf.get(a.idx) ?? 0) - (rankOf.get(b.idx) ?? 0));
    alive.slice(keep).forEach(kill);
    layout(keep, sweepI + 1 >= SWEEPS.length);
    beep(note(12), 0.12, "triangle", 0.05);
    cam.punch(0.04).shake(5 * S.u());
    sweepI++;
    if (sweepI >= SWEEPS.length) {
      phase = "stamp";
      tPhase = 0;
      stampI = 0;
      S.say(t("cLedgerFinal"), 0.8);
    } else startSweep();
  }
  function toSeal(): void {
    phase = "seal";
    tPhase = 0;
    sealK = 0;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    setTimeout(() => beep(note(18), 0.12, "triangle", 0.045), 520);
    cam.punch(0.1).shake(12 * S.u());
  }
  skipFn = (): void => {
    if (phase === "seal" || phase === "dead") return;
    cards.forEach((q) => {
      if (q.idx !== winnerIdx && q.alive) kill(q);
    });
    layout(1);
    const win = cards[winnerIdx] as Card;
    win.in = 1;
    win.x = win.tx;
    win.y = win.ty;
    win.w = win.tw;
    sweepI = SWEEPS.length;
    toSeal();
  };

  function update(dt: number): void {
    tPhase += dt;
    for (const q of cards) {
      if (q.alive) {
        q.in = Math.min(1, q.in + dt * 2.2);
        const sp = Math.min(1, dt * 12);
        q.x += (q.tx - q.x) * sp;
        q.y += (q.ty - q.y) * sp;
        q.w += (q.tw - q.w) * sp;
        q.h += (q.th - q.h) * sp;
      } else {
        q.killed += dt;
        for (const b of q.bits) {
          b.vy += 900 * S.u() * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.r += dt * 4;
        }
      }
      if (q.stamp > 0) q.stamp = Math.min(1, q.stamp + dt * 8);
      q.susto = Math.max(0, q.susto - dt * 1.4);
    }
    if (phase === "fall") {
      const want = Math.floor(clamp(tPhase / FALL, 0, 1) * Math.min(24, n));
      while (fallTicks < want) {
        beep(note(fallTicks % 2 === 0 ? 3 : 4), 0.045, "square", 0.028);
        fallTicks++;
      }
      if (tPhase >= FALL) startSweep();
      return;
    }
    if (phase === "sweep") {
      const p = clamp(tPhase / sweepDur(n), 0, 1);
      const dir = SWEEPS[sweepI]?.from ?? "top";
      sweepY = dir === "top" ? p * S.sh() : (1 - p) * S.sh();
      if (susto && !saidSusto && sweepI === SWEEPS.length - 1) {
        const win = cards[winnerIdx] as Card;
        const cy = win.y + win.h / 2;
        if (dir === "top" ? sweepY >= cy : sweepY <= cy) {
          saidSusto = true;
          win.susto = 1;
          S.say(T[getLang()].cLedgerClose(names[winnerIdx] ?? ""), 0.75);
          beep(note(1), 0.1, "square", 0.05);
          setTimeout(() => beep(note(0), 0.14, "sine", 0.045), 90);
          cam.shake(10 * S.u()).punch(0.05);
        }
      }
      if (p >= 1) endSweep();
      return;
    }
    if (phase === "stamp") {
      if (tPhase < HOLD) {
        const late = Math.floor(tPhase / 0.55);
        while (heldTicks < late) {
          heldTicks++;
          beep(note(0), 0.16, "sine", 0.045);
          setTimeout(() => beep(note(0), 0.12, "sine", 0.03), 150);
        }
        return;
      }
      const losers = cards.filter((q) => q.alive && q.idx !== winnerIdx);
      const stampAt = (i: number): number => HOLD + (i + 1) * STAMP_GAP + (duda && i === losers.length - 1 ? DUDA : 0);
      const dudaDesde = stampAt(losers.length - 1) - DUDA;
      if (duda && !saidDuda && tPhase >= dudaDesde) {
        saidDuda = true;
        S.say(T[getLang()].cLedgerHover(names[winnerIdx] ?? ""), 0.85);
      }
      while (stampI < losers.length && tPhase >= stampAt(stampI)) {
        if (duda && stampI === losers.length - 1) S.say(T[getLang()].cLedgerNope(names[(losers[stampI] as Card).idx] ?? ""), 0.9);
        (losers[stampI] as Card).stamp = 0.001;
        (losers[stampI] as Card).stampAt = tPhase;
        beep(note(0), 0.1, "square", 0.07);
        beep(note(5), 0.18, "sine", 0.05);
        cam.punch(0.05).shake(7 * S.u());
        stampI++;
      }
      if (stampI >= losers.length && tPhase >= HOLD + losers.length * STAMP_GAP + 0.8 + (duda ? DUDA : 0)) toSeal();
      return;
    }
    if (phase === "seal") {
      sealK = Math.min(1, sealK + dt * 2.2);
      if (!ledgerBump && sealK >= 0.5) {
        ledgerBump = true;
        beep(note(14), 0.06, "triangle", 0.025);
      }
      tHold += dt * paceFactor();
      if (tHold >= WINNER_HOLD) {
        phase = "dead";
        S.cleanup();
      }
    }
  }

  /* ---------------------------------------------------------------- escena */
  let paper!: Graphics;
  let bitsG!: Graphics;
  let cardsLayer!: Container;
  let sweepG!: Graphics;
  let dudaG!: Graphics;
  let seal!: Container;
  let sealCard!: Graphics;
  let sealName!: Text;
  let sealAv!: Sprite;
  let sealBadge!: Container;
  let hudText!: Text;

  function makeCard(q: Card): void {
    const view = new Container();
    const bg = new Graphics()
      .rect(4, 4, REF_W, REF_H).fill(INK)
      .rect(0, 0, REF_W, REF_H).fill(S.dark ? 0x2d2342 : 0xffffff).stroke({ width: 3, color: INK })
      .rect(5, 5, 6, REF_H - 10).fill(S.color(q.idx));
    const big = new Container();
    const av = new Sprite(S.face(names[q.idx] ?? ""));
    av.width = av.height = 24 * 1.3;
    av.position.set(16, (REF_H - av.height) / 2);
    const name = S.text(names[q.idx] ?? "", { fontSize: Math.min(46, REF_H * 0.34), fontWeight: "700", fill: S.dark ? CREAM : INK });
    name.anchor.set(0, 0.5);
    name.position.set(16 + av.width + 10, REF_H / 2);
    // Primero se achica la letra, hasta un tercio; recién después se recorta.
    const room = REF_W - 12 - name.x;
    if (name.width > room) {
      name.scale.set(Math.max(0.68, room / name.width));
      let cut = (names[q.idx] ?? "").length;
      while (cut > 4 && name.width > room) {
        cut--;
        name.text = shorten(names[q.idx] ?? "", cut);
      }
    }
    big.addChild(av, name);
    const small = new Graphics()
      .rect(16, REF_H * 0.33, REF_W - 26, 3).fill({ color: S.dark ? CREAM : INK, alpha: S.dark ? 0.32 : 0.22 })
      .rect(16, REF_H * 0.58, (REF_W - 26) * 0.55, 3).fill({ color: S.dark ? CREAM : INK, alpha: S.dark ? 0.32 : 0.22 });
    const stampG = new Graphics();
    const scare = new Graphics();
    view.addChild(bg, big, small, stampG, scare);
    q.view = view;
    q.big = big;
    q.small = small;
    q.stampG = stampG;
    q.scare = scare;
    cardsLayer.addChild(view);
  }

  function build(): void {
    const k = S.u();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    S.bg.addChild(new Graphics().rect(0, 0, S.sw(), S.sh()).fill(S.dark ? 0x221a33 : 0xfff6e9));
    paper = new Graphics();
    bitsG = new Graphics();
    cardsLayer = new Container();
    sweepG = new Graphics();
    dudaG = new Graphics();
    S.scene.addChild(paper, bitsG, cardsLayer, dudaG, sweepG);
    for (const q of cards) makeCard(q);
    // La tarjeta sellada: amarilla, grande, con la ganadora y el "sellado".
    seal = new Container();
    sealCard = new Graphics();
    sealAv = new Sprite(S.face(names[winnerIdx] ?? ""));
    sealName = S.text(names[winnerIdx] ?? "", { fontSize: 52 * k, fontWeight: "900", fill: INK });
    sealName.anchor.set(0, 0.5);
    sealBadge = new Container();
    const lab = S.text(t("cLedgerOk"), { fontSize: 34 * k, fontWeight: "900", fill: INK });
    lab.anchor.set(0.5);
    const bw = lab.width + 48 * k, bh = 62 * k;
    sealBadge.addChild(new Graphics().rect(-bw / 2 + 7 * k, -bh / 2 + 7 * k, bw, bh).fill(INK).rect(-bw / 2, -bh / 2, bw, bh).fill(0x00a896).stroke({ width: 5 * k, color: INK }), lab);
    seal.addChild(sealCard, sealAv, sealName, sealBadge);
    seal.visible = false;
    S.hud.addChild(seal);
    hudText = S.text("", { fontFamily: MONO, fontSize: 13 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    hudText.alpha = 0.6;
    hudText.position.set(22 * k, S.sh() - S.bottom() - 16 * k);
    S.hud.addChild(hudText);
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(() => {
    layout(cards.filter((q) => q.alive).length, sweepI >= SWEEPS.length);
    build();
  });
  /**
   * Dónde está la mesa y cuánto se puede acercar la cámara sin cortarla: entra
   * entera entre la barra de arriba y el relator, que tapa el borde de abajo.
   */
  function table(): { x: number; y: number; fit: number } {
    const k = S.u();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of cards) {
      if (!q.alive) continue;
      x0 = Math.min(x0, q.tx);
      y0 = Math.min(y0, q.ty);
      x1 = Math.max(x1, q.tx + q.tw);
      y1 = Math.max(y1, q.ty + q.th);
    }
    if (x1 < x0) return { x: S.sw() / 2, y: S.sh() / 2, fit: 1 };
    const room = S.sh() - S.top() - S.bottom() - 24 * k;
    const fit = Math.min((S.sw() - 40 * k) / (x1 - x0), room / (y1 - y0), 1.9);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, fit };
  }
  /** Mirar a un punto para que caiga en el medio del hueco visible, no de la pantalla. */
  function look(x: number, y: number, zoom: number, rate: number): void {
    const visible = (S.top() + S.sh() - S.bottom()) / 2;
    cam.lookAt(x, y + (S.sh() / 2 - visible) / zoom, zoom, rate);
  }
  {
    const m = table();
    cam.cut(m.x, m.y, m.fit * 1.06);
  }

  /** La cámara: la barra en las barridas, la tarjeta del susto, la mesa, la duda. */
  function direct(): void {
    const m = table();
    const win = cards[winnerIdx] as Card;
    const wc = { x: win.x + win.w / 2, y: win.y + win.h / 2 };
    if (phase === "fall") look(m.x, m.y, m.fit * (1.06 - 0.1 * clamp(tPhase / FALL, 0, 1)), 2);
    else if (phase === "sweep") {
      if (win.susto > 0.2) look(wc.x, wc.y, 1.8, 5);
      else look(m.x, m.y + (sweepY - m.y) * 0.18, m.fit * Math.min(1, 0.94 + 0.02 * sweepI), 2);
    } else if (phase === "stamp") {
      const losers = cards.filter((q) => q.alive && q.idx !== winnerIdx);
      const cae = HOLD + losers.length * STAMP_GAP + DUDA;
      if (duda && tPhase >= cae - DUDA - 0.1 && tPhase < cae + 0.3) look(wc.x, wc.y, Math.max(1.6, m.fit * 1.3), 4);
      else look(m.x, m.y, m.fit * 0.96, 2);
    } else look(S.sw() / 2, S.sh() / 2, 1, 2);
  }

  function draw(now: number): void {
    const k = S.u();
    const W = S.sw(), H = S.sh();
    // Trama de puntos que baja: papel de contador, en movimiento.
    paper.clear();
    const step = 22 * k;
    const off = (now * 6 * k) % step;
    for (let y = -step + off; y < H; y += step) for (let x = 0; x < W; x += step) paper.rect(x, y, 2 * k, 2 * k);
    paper.fill({ color: S.dark ? CREAM : INK, alpha: 0.06 });
    // Las que se van, en pedacitos.
    bitsG.clear();
    for (const q of cards) {
      if (q.alive) continue;
      const a = Math.max(0, 1 - q.killed * 2.6);
      if (a <= 0) continue;
      for (const b of q.bits) {
        const w = (q.w / 2) * a, h = (q.h / 2) * a;
        const c = Math.cos(b.r), s = Math.sin(b.r);
        bitsG.poly([b.x, b.y, b.x + w * c, b.y + w * s, b.x + w * c - h * s, b.y + w * s + h * c, b.x - h * s, b.y + h * c]).fill({ color: S.color(q.idx), alpha: a * 0.7 });
      }
    }
    // Las tarjetas vivas.
    for (const q of cards) {
      const v = q.view as Container;
      v.visible = q.alive && !(phase === "seal" && q.idx === winnerIdx && winners.length === 1);
      if (!v.visible) continue;
      const e = ease.outBack(clamp(q.in, 0, 1));
      const late = phase === "stamp" && q.stamp === 0 ? 1 + 0.045 * Math.exp(-((tPhase % 0.55) * 7)) : 1;
      const w = q.w * (0.94 + 0.06 * e) * late;
      const sc = w / REF_W;
      let x = q.x - (w - q.w) / 2, y = q.y - (q.h * (0.94 + 0.06 * e) * late - q.h) / 2;
      if (q.susto > 0) {
        x += Math.sin(tPhase * 70) * 7 * k * q.susto;
        y += Math.sin(tPhase * 53 + 1) * 3 * k * q.susto;
      }
      // El golpe del sello: al asentarse, la tarjeta se aplasta un instante.
      const since = q.stampAt !== undefined ? tPhase - q.stampAt - 0.125 : -1;
      const thud = since >= 0 && since < 0.35 ? 0.06 * Math.exp(-since * 14) * Math.cos(since * 40) : 0;
      v.position.set(x, y + (q.h * thud) / 2);
      v.scale.set(sc * (1 + thud * 0.5), sc * (1 - thud));
      v.alpha = phase === "seal" ? Math.max(0, 1 - sealK * 1.6) : 1;
      const bigShown = w > 110 * k;
      (q.big as Container).visible = bigShown;
      (q.small as Graphics).visible = !bigShown;
      // El sello en la tarjeta: cae grande y se asienta.
      const sg = q.stampG as Graphics;
      sg.clear();
      if (q.stamp > 0) {
        const es = 2.4 - 1.4 * ease.outCubic(Math.min(1, q.stamp));
        const s = Math.min(REF_W * 0.5, REF_H * 0.78) * es;
        const cx = REF_W - Math.min(REF_W * 0.28, REF_H * 0.5), cy = REF_H / 2;
        const c = Math.cos(-0.14), sn = Math.sin(-0.14);
        const r = (px: number, py: number): number[] => [cx + px * c - py * sn, cy + px * sn + py * c];
        sg.poly([...r(-s / 2, -s / 2), ...r(s / 2, -s / 2), ...r(s / 2, s / 2), ...r(-s / 2, s / 2)]).stroke({ width: 4 / sc * k, color: 0xe93d9c });
        sg.moveTo(...(r(-s * 0.25, -s * 0.25) as [number, number])).lineTo(...(r(s * 0.25, s * 0.25) as [number, number]))
          .moveTo(...(r(s * 0.25, -s * 0.25) as [number, number])).lineTo(...(r(-s * 0.25, s * 0.25) as [number, number]))
          .stroke({ width: 4 / sc * k, color: 0xe93d9c });
        // Las gotitas de tinta que salpica el golpe, y se quedan.
        if (since >= 0) {
          const out = ease.outCubic(Math.min(1, since / 0.12));
          for (let i = 0; i < 7; i++) {
            const a = hash(q.idx, i) * Math.PI * 2;
            const d = (s * 0.55 + hash(q.idx, i + 9) * s * 0.35) * out;
            sg.circle(cx + Math.cos(a) * d, cy + Math.sin(a) * d, ((1.5 + hash(q.idx, i + 17) * 2.5) / sc) * k).fill({ color: 0xe93d9c, alpha: 0.8 });
          }
        }
      }
      const sc2 = q.scare as Graphics;
      sc2.clear();
      if (q.susto > 0) {
        sc2.rect(0, 0, REF_W, REF_H).fill({ color: 0xe93d9c, alpha: 0.4 * q.susto });
        const lejos = (Math.sin(Math.PI * q.susto) * 26 * k) / sc;
        for (let i = 0; i < 6; i++) {
          const a = i * 1.047 + 0.4;
          sc2.rect(REF_W / 2 + Math.cos(a) * (REF_W * 0.4 + lejos), REF_H / 2 + Math.sin(a) * (REF_H * 0.5 + lejos), 8 / sc * k, 8 / sc * k).fill(S.color(q.idx));
        }
      }
    }
    // El sello que duda, flotando sobre la ganadora.
    dudaG.clear();
    if (duda && phase === "stamp") {
      const losers = cards.filter((q) => q.alive && q.idx !== winnerIdx);
      const cae = HOLD + losers.length * STAMP_GAP + DUDA;
      const desde = cae - DUDA;
      if (tPhase >= desde && tPhase < cae && stampI < losers.length) {
        const win = cards[winnerIdx] as Card;
        const f = (tPhase - desde) / DUDA;
        const s = Math.min(win.w * 0.5, win.h * 0.78) * (1.5 + 0.08 * Math.sin(tPhase * 18));
        const cx = win.x + win.w - Math.min(win.w * 0.28, win.h * 0.5) + Math.sin(tPhase * 9) * 6 * k;
        const cy = win.y + win.h / 2 - 30 * k * (1 - f);
        const rot = -0.14 + Math.sin(tPhase * 7) * 0.08;
        const c = Math.cos(rot), sn = Math.sin(rot);
        const r = (px: number, py: number): [number, number] => [cx + px * c - py * sn, cy + px * sn + py * c];
        dudaG.poly([...r(-s / 2, -s / 2), ...r(s / 2, -s / 2), ...r(s / 2, s / 2), ...r(-s / 2, s / 2)]).stroke({ width: 5 * k, color: 0xe93d9c, alpha: 0.75 });
        dudaG.moveTo(...r(-s * 0.25, -s * 0.25)).lineTo(...r(s * 0.25, s * 0.25)).moveTo(...r(s * 0.25, -s * 0.25)).lineTo(...r(-s * 0.25, s * 0.25)).stroke({ width: 5 * k, color: 0xe93d9c, alpha: 0.75 });
      }
    }
    // La barra del cierre.
    sweepG.clear();
    if (phase === "sweep") {
      const dir = SWEEPS[sweepI]?.from ?? "top";
      const grad = 60 * k;
      for (let i = 0; i < 6; i++) {
        const yy = dir === "top" ? sweepY - grad + (i * grad) / 6 : sweepY + grad - ((i + 1) * grad) / 6;
        sweepG.rect(-W, yy, W * 3, grad / 6).fill({ color: 0x00a896, alpha: 0.07 * (i + 1) });
      }
      sweepG.rect(-W, sweepY - 7 * k, W * 3, 14 * k).fill(0x00a896).rect(-W, sweepY - 9 * k, W * 3, 3 * k).fill(INK).rect(-W, sweepY + 7 * k, W * 3, 3 * k).fill(INK);
    }
    hudText.text = `${t("cLedgerNo")} #${beacon.round + (ledgerBump ? 1 : 0)}`;
    // El sello final.
    if (phase === "seal") {
      if (winners.length > 1) crown.at(tPhase);
      else {
        crown.at(tPhase, false);
        seal.visible = true;
        const win = cards[winnerIdx] as Card;
        // Crece desde la tarjeta de la mesa hasta el ancho justo del nombre.
        const e = ease.outBack(Math.min(1, sealK));
        const ch = Math.min(win.h * (1 + 1.4 * e), H * 0.34);
        const av = ch * 0.62;
        const natural = sealName.width / sealName.scale.x;
        let ns = Math.min(1, (ch * 0.5) / (52 * k));
        const lead = 20 * k + av + 14 * k;
        const want = lead + natural * ns + 32 * k;
        const cw = Math.min(W - 56 * k, Math.max(want, win.w * (1 - Math.min(1, e))));
        if (natural * ns > cw - lead - 24 * k) ns = (cw - lead - 24 * k) / natural;
        const cx = W / 2 - cw / 2;
        const cy = Math.max(S.top() + 20 * k, Math.min(H - S.bottom() - ch - 110 * k, win.y + win.h / 2 - ch / 2));
        sealCard.clear().rect(cx + 10 * k, cy + 10 * k, cw, ch).fill(0xe93d9c).rect(cx, cy, cw, ch).fill(YELLOW).stroke({ width: 6 * k, color: INK });
        sealAv.width = sealAv.height = av;
        sealAv.position.set(cx + 20 * k, cy + (ch - av) / 2);
        sealName.scale.set(ns);
        sealName.position.set(cx + lead, cy + ch / 2);
        // El "confirmado" cae de arriba como un sello, un poco después.
        const golpe = clamp((sealK - 0.35) / 0.4, 0, 1);
        sealBadge.position.set(W / 2, cy + ch + 34 * k + 31 * k);
        sealBadge.scale.set(1 + 1.3 * (1 - ease.outCubic(golpe)));
        sealBadge.rotation = -0.06 * (1 - golpe);
        sealBadge.alpha = Math.min(1, golpe * 3);
        // El cartel para el auditor exigente, en píxeles del lienzo.
        const dpr = S.app.renderer.resolution;
        S.view.dataset.cartel = [cx, cy, cw, ch].map((v) => Math.round(v * dpr)).join(",");
      }
    }
  }

  S.run((dt, now) => {
    update(dt);
    if (phase === "dead") return;
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
  });
}
