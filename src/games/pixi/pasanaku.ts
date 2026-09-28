import { Container, Graphics, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";

/**
 * Pasanaku, en PixiJS, con el director de cámara.
 *
 * El mismo juego de `pasanaku.ts`: los bultos caen sobre el aguayo, se tejen
 * los hilos entre vecinos (las trustlines), la tela se aprieta y los que
 * quedan afuera ya cobraron, hasta que queda uno en el nudo. La física es la
 * misma, a paso fijo y sembrada. Lo nuevo es la cámara: arranca cerca de la
 * tela, se abre cuando caen los bultos, en cada apretón pega un tirón y se
 * acerca un poco más, en el susto va de golpe al bulto que quedó en el filo,
 * y en el nudo se pega al nudo.
 */

const DT = 1 / 120;
const T_DROP = 1.0;
const T_WEAVE = 3.4;
const T_CINCH = 5.4;
const CINCH_DUR = 7.5;
const T_KNOT = T_CINCH + CINCH_DUR;
const T_LIFT = 16.5;
const PAL = [0xe93d9c, 0xff7a1a, 0x00a896, 0x6c4ce0, 0xffc629];

type Phase = "spread" | "drop" | "weave" | "cinch" | "knot" | "lift" | "dead";
interface Bundle {
  idx: number; x: number; y: number; vx: number; vy: number; rot: number; wob: number; ph: number;
  alive: boolean; out: number; slot: number; a: number; b: number; view?: Container; chip?: Container;
}

export async function pasanakuPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const susto = story.arc === "susto" && n >= 3;
  S.mark("arco", story.arc);
  const FINAL = Math.min(3, n);
  const PULLS = n <= 4 ? 1 : n <= 12 ? 2 : 3;
  setGameLength(T_LIFT, WINNER_HOLD);
  const PULL_DUR = CINCH_DUR / PULLS;
  const SUSTO = T_CINCH + CINCH_DUR * 0.72;

  const rank = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = rank.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rank[i], rank[j]] = [rank[j] as number, rank[i] as number];
  }
  rank.unshift(winnerIdx);
  const place = new Map(rank.map((idx, pos) => [idx, pos]));

  let phase: Phase = "spread";
  let tAll = 0, acc = 0, cinchTotal = 0, pulls = 0, collected = 0, dropTicks = 0, weaveTicks = 0, tHold = 0;
  let knotHits = 0, saidSusto = false, saidKnot = false, tugs = 0, lastTug = -99, saidUpTo = -1, lastOut = -999, liftK = 0;
  const bundles: Bundle[] = [];

  const C = (): { x: number; y: number; k: number } => ({ x: S.sw() / 2, y: S.sh() * 0.47, k: S.u() });
  const R0 = (): number => Math.min(S.sh() * 0.46, S.sw() * 0.34);
  const Rc = (): number => R0() * (1 - 0.62 * cinchTotal);
  const rad = (): number => clamp(Math.sqrt((Rc() * Rc() * 0.2) / n), 7 * S.u(), 30 * S.u());
  {
    const { x, y } = C();
    const r0 = R0();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.2;
      const d = 0.3 + rng() * 0.6;
      bundles.push({
        idx: i, x: x + Math.cos(a) * r0 * d, y: y + Math.sin(a) * r0 * d * 0.62, vx: 0, vy: 0,
        rot: rng() * Math.PI, wob: 1.4 + rng() * 2.2, ph: rng() * 7, alive: true, out: 0, slot: 0,
        a: (i + 1) % n, b: (i + n - 1) % n,
      });
    }
  }
  const alive = (): Bundle[] => bundles.filter((q) => q.alive);

  /* --------------------------------------------------------------- física */
  function step(dt: number): void {
    const { x: cx, y: cy, k } = C();
    const list = alive();
    const r = rad();
    for (const q of list) {
      const dx = cx - q.x, dy = (cy - q.y) * 1.6;
      const d = Math.hypot(dx, dy) || 1;
      const g = 220 * k * (0.25 + cinchTotal);
      q.vx += (dx / d) * g * dt;
      q.vy += (dy / d) * g * dt;
      if (susto && q.idx === winnerIdx && tAll >= SUSTO && tAll < SUSTO + 0.6) {
        q.vx -= (dx / d) * 900 * k * dt;
        q.vy -= (dy / d) * 900 * k * dt * 0.62;
      }
      q.vx += Math.sin(tAll * q.wob + q.ph) * 26 * k * dt;
      q.vy += Math.cos(tAll * q.wob * 0.83 + q.ph) * 26 * k * dt;
      q.vx *= 0.965;
      q.vy *= 0.965;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vx * dt * 0.01;
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Bundle;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j] as Bundle;
        const dx = q.x - p.x, dy = (q.y - p.y) / 0.62;
        const d = Math.hypot(dx, dy);
        const min = r * 2;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const ux = dx / d, uy = dy / d;
        p.x -= ux * push; p.y -= uy * push * 0.62;
        q.x += ux * push; q.y += uy * push * 0.62;
      }
    }
    const rr = Rc();
    for (const q of list) {
      const dx = q.x - cx, dy = (q.y - cy) / 0.62;
      const d = Math.hypot(dx, dy);
      const lim = rr - r;
      if (d <= lim || d === 0) continue;
      q.x = cx + (dx / d) * lim;
      q.y = cy + (dy / d) * lim * 0.62;
      q.vx *= -0.42;
      q.vy *= -0.42;
    }
    for (const q of bundles) {
      if (q.alive) continue;
      q.out += dt;
      q.vy += 900 * k * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += dt * 3;
      const rr2 = rad();
      const cols = Math.max(1, Math.floor((S.sw() - 120 * S.u()) / (rr2 * 2.2)));
      const tx = 60 * S.u() + (q.slot % cols) * rr2 * 2.2 + rr2;
      const ty = S.sh() - 56 * S.u() - Math.floor(q.slot / cols) * rr2 * 1.5;
      if (q.out > 0.45) {
        const sp = Math.min(1, dt * 6);
        q.x += (tx - q.x) * sp;
        q.y += (ty - q.y) * sp;
        q.vx *= 0.6;
        q.vy *= 0.6;
      } else if (q.y > ty) {
        q.y = ty;
        q.vy *= -0.25;
        q.vx *= 0.8;
      }
    }
  }
  function evict(keep: number): void {
    const list = alive().sort((a, b) => (place.get(b.idx) ?? 0) - (place.get(a.idx) ?? 0));
    const { x: cx, y: cy, k } = C();
    for (const q of list) {
      if (alive().length <= keep) break;
      q.alive = false;
      q.out = 0;
      q.slot = collected++;
      const a = Math.atan2(q.y - cy, q.x - cx);
      q.vx = Math.cos(a) * 380 * k;
      q.vy = Math.sin(a) * 380 * k - 160 * k;
      if (n <= 40 || collected % 6 === 0) {
        beep(note(7), 0.09, "sine", 0.03);
        setTimeout(() => beep(note(5), 0.09, "sine", 0.026), 60);
      }
      if (tAll - lastOut > 0.5 && alive().length <= 8 && keep > 1) {
        lastOut = tAll;
        S.say(T[getLang()].cPasOut(names[q.idx] ?? ""), 0.5);
      }
    }
  }

  let crowned = false;
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
    cam.punch(0.1).shake(14 * S.u());
  }
  skipFn = (): void => {
    if (phase === "lift" || phase === "dead") return;
    cinchTotal = 1;
    evict(1);
    tAll = T_LIFT;
    phase = "lift";
    crown();
  };

  function script(dt: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => S.say(t("cPasSpread"), 0.1)],
      [T_DROP + 0.1, () => S.say(t("cPasDrop"), 0.2)],
      [T_WEAVE, () => S.say(t("cPasWeave"), 0.3)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    if (phase === "cinch") {
      if (susto && !saidSusto && tAll >= SUSTO + 0.25) {
        saidSusto = true;
        S.say(T[getLang()].cPasClose(names[winnerIdx] ?? ""), 0.8);
        beep(note(1), 0.1, "square", 0.05);
        setTimeout(() => beep(note(8), 0.12, "triangle", 0.045), 80);
        cam.shake(10 * S.u()).punch(0.05);
      }
      const want = Math.min(PULLS, Math.floor((tAll - T_CINCH) / PULL_DUR) + 1);
      while (pulls < want) {
        pulls++;
        S.say(t(pulls === 1 ? "cPasCinch" : pulls === 2 ? "cPasCinch2" : "cPasCinch3"), Math.min(0.75, 0.3 + pulls * 0.15));
        beepFor(note(Math.max(0, 4 - (pulls - 1) * 2)), PULL_DUR + 0.2, "sawtooth", 0.03);
        cam.punch(0.06).shake(8 * S.u());
      }
      const tug = Math.min(1, PULL_DUR / 3);
      const wantTugs = Math.floor((tAll - T_CINCH) / tug);
      while (tugs < wantTugs) {
        tugs++;
        const fase = (tugs * tug) % PULL_DUR;
        if (fase < 0.2 || PULL_DUR - fase < 0.2) continue;
        lastTug = tAll;
        beep(note(3), 0.08, "square", 0.04);
        cam.punch(0.025).shake(3 * S.u());
      }
      const p = clamp((tAll - T_CINCH) / CINCH_DUR, 0, 1);
      cinchTotal = ease.outCubic(p) * 0.86 + 0.035 * Math.exp(-(tAll - lastTug) * 9);
      const target = Math.max(FINAL, Math.round(n * (1 - p) ** 1.5));
      if (alive().length > target) evict(target);
      return;
    }
    if (phase === "knot") {
      cinchTotal = 0.86 + 0.12 * clamp((tAll - T_KNOT) / (T_LIFT - T_KNOT), 0, 1);
      const hits = Math.floor((tAll - T_KNOT) / 0.14);
      while (knotHits < hits) {
        knotHits++;
        if (knotHits % 2 === 0 && tAll < T_LIFT - 0.4) beep(note(15), 0.035, "sine", 0.024);
      }
      if (tAll >= T_LIFT - 0.15 && alive().length > 1) {
        beep(note(1), 0.35, "sine", 0.07);
        evict(1);
      } else if (alive().length > FINAL) evict(FINAL);
      if (knotHits >= 1 && !saidKnot) {
        saidKnot = true;
        S.say(t("cPasKnot"), 0.9);
      }
      return;
    }
    if (phase === "lift") {
      liftK = Math.min(1, liftK + dt * 0.8);
      crown();
    }
  }

  /* --------------------------------------------------------------- escena */
  let cloth!: Graphics;
  let threads!: Graphics;
  let outLayer!: Container;
  let inLayer!: Container;
  let ring!: Graphics;
  let knot!: Graphics;
  let chips!: Container;
  let potText!: Text;
  let coins!: Graphics;
  let cinchText!: Text;

  function makeBundle(q: Bundle): Container {
    const c = new Container();
    const r = 20;
    const col = S.color(q.idx);
    c.addChild(new Graphics()
      .rect(-r + 3, -r + 3, r * 2, r * 2).fill(INK)
      .rect(-r, -r, r * 2, r * 2).fill(col).stroke({ width: 2.5, color: INK })
      .poly([-r * 0.5, -r, -r * 0.15, -r * 1.45, r * 0.15, -r, r * 0.5, -r * 1.4, r * 0.75, -r]).fill(col).stroke({ width: 2.5, color: INK })
      .rect(-r * 0.6, -r * 0.6, r * 0.3, r * 0.3).fill({ color: 0xffffff, alpha: 0.35 }));
    return c;
  }

  function build(): void {
    const k = S.u();
    const W = S.sw(), H = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    S.bg.addChild(new Graphics().rect(0, 0, W, H).fill(S.dark ? 0x1b1224 : 0xf3e6d2));
    cloth = new Graphics();
    threads = new Graphics();
    outLayer = new Container();
    inLayer = new Container();
    ring = new Graphics();
    knot = new Graphics();
    chips = new Container();
    // Los que ya cobraron y los nombres van en la interfaz: con la cámara
    // encima de la tela, la fila de abajo y los chips quedan siempre a la vista
    // y del mismo tamaño.
    S.scene.addChild(cloth, threads, ring, inLayer, knot);
    S.hud.addChild(outLayer, chips);
    for (const q of bundles) {
      q.view?.destroy({ children: true });
      q.view = makeBundle(q);
      (q.alive ? inLayer : outLayer).addChild(q.view);
      q.chip?.destroy({ children: true });
      q.chip = undefined;
    }
    // El pote: la caja con la cuenta y la pila de monedas.
    const pot = new Container();
    potText = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    potText.anchor.set(0.5);
    coins = new Graphics();
    pot.addChild(coins, potText);
    pot.position.set(22 * k, S.top() + 10 * k);
    S.hud.addChild(pot);
    cinchText = S.text("", { fontFamily: MONO, fontSize: 11 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    cinchText.anchor.set(1, 1);
    cinchText.alpha = 0.55;
    cinchText.position.set(W - 22 * k, H - S.bottom() - 18 * k);
    S.hud.addChild(cinchText);
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  cam.cut(C().x, C().y, 1.4);

  /** La cámara: la tela al tenderla, más cerca en cada apretón, el filo en el susto, el nudo. */
  function direct(): void {
    const { x, y } = C();
    const win = bundles.find((b) => b.idx === winnerIdx) as Bundle;
    if (phase === "spread") cam.lookAt(x, y, 1.4, 2);
    else if (phase === "drop") cam.lookAt(x, y, 1.0, 1.5);
    else if (phase === "weave") cam.lookAt(x, y, 1.0 + 0.12 * clamp((tAll - T_WEAVE) / 2, 0, 1), 1.5, 0.015 * Math.sin(tAll * 0.8));
    else if (phase === "cinch") {
      if (susto && tAll >= SUSTO && tAll < SUSTO + 1.3) cam.lookAt(win.x, win.y, 2.2, 5);
      else cam.lookAt(x, y, 1.12 + 0.55 * cinchTotal, 2.5);
    } else if (phase === "knot") cam.lookAt(x, y - Rc() * 0.2, 1.9, 2.5);
    else {
      // El atado queda entre el cartel del ganador y el relator.
      const z = 1.35;
      cam.lookAt(x, y - liftK * 70 * S.u() - (S.sh() * 0.14) / z, z, 1.6);
    }
  }

  function draw(now: number): void {
    const { x, y, k } = C();
    const rr = Rc();
    const lift = liftK * 70 * k;
    const grow = phase === "spread" ? ease.outBack(clamp(tAll / T_DROP, 0, 1)) : 1;
    // El aguayo: franjas en perspectiva, lisas y con rombos.
    cloth.clear();
    const halfB = rr * 1.02, halfT = rr * 0.74;
    const top = y - lift - rr * 0.6 * grow, bot = y - lift + rr * 0.6 * grow;
    const halfAt = (p: number): number => (halfT + (halfB - halfT) * p) * (1 + 0.035 * Math.sin(p * 7 + now * 1.4));
    const bands = 9;
    if (bot - top > 1) {
      for (let b = 0; b < bands; b++) {
        const p0 = b / bands, p1 = (b + 1) / bands;
        const pts: number[] = [];
        for (let i = 0; i <= 3; i++) {
          const p = p0 + ((p1 - p0) * i) / 3;
          pts.push(x + halfAt(p), top + (bot - top) * p);
        }
        for (let i = 3; i >= 0; i--) {
          const p = p0 + ((p1 - p0) * i) / 3;
          pts.push(x - halfAt(p), top + (bot - top) * p);
        }
        const pallay = b % 2 === 1;
        cloth.poly(pts).fill(pallay ? (S.dark ? 0xefe4cf : 0xfbf3e4) : (PAL[Math.floor(b / 2) % PAL.length] as number));
        if (!pallay) continue;
        const yy0 = top + (bot - top) * p0, yy1 = top + (bot - top) * p1;
        const mid = (yy0 + yy1) / 2, sz = (yy1 - yy0) * 0.38;
        const half = halfAt((p0 + p1) / 2) - sz;
        const stp = sz * 2.6;
        if (!(stp > 0.5)) continue;
        for (let px = x - half + stp / 2; px < x + half; px += stp) cloth.poly([px, mid - sz, px + sz, mid, px, mid + sz, px - sz, mid]).fill(INK);
      }
      const outline: number[] = [];
      for (let i = 0; i <= 20; i++) outline.push(x + halfAt(i / 20), top + (bot - top) * (i / 20));
      for (let i = 20; i >= 0; i--) outline.push(x - halfAt(i / 20), top + (bot - top) * (i / 20));
      cloth.poly(outline).stroke({ width: 3 * k, color: INK });
    }
    // Las cuatro puntas, dobladas como se ata un aguayo de verdad: cada punta
    // se da vuelta sobre la tela y deja su hueco; al apretar crece el doblez,
    // y al levantar las cuatro suben a juntarse en el nudo.
    if (bot - top > 1) {
      const kx = x, ky = y - lift - rr * 0.9;
      const g = clamp(cinchTotal * 0.42 + liftK * 0.58, 0, 1);
      const gs = Math.min(1, g * 2.4);
      const ge = ease.inOutCubic(clamp((g - 0.3) / 0.7, 0, 1));
      const fondo = S.dark ? 0x1b1224 : 0xf3e6d2;
      for (let i = 0; i < 4; i++) {
        const sx = i % 2 === 0 ? -1 : 1, abajo = i >= 2;
        const cy0 = abajo ? bot : top;
        const cx0 = x + sx * halfAt(abajo ? 1 : 0);
        const ancho = halfAt(abajo ? 1 : 0) * 0.42 * gs, alto = (bot - top) * 0.4 * gs;
        if (ancho < 2 * k || alto < 2 * k) continue;
        const pb = alto / (bot - top);
        const b1x = cx0 - sx * ancho, b1y = cy0;
        const b2x = x + sx * halfAt(abajo ? 1 - pb : pb), b2y = cy0 + (abajo ? -alto : alto);
        // La punta doblada cae donde la refleja el pliegue, y de ahí sube al nudo.
        const dx = b2x - b1x, dy = b2y - b1y;
        const q = ((cx0 - b1x) * dx + (cy0 - b1y) * dy) / (dx * dx + dy * dy);
        const rx = 2 * (b1x + q * dx) - cx0, ry = 2 * (b1y + q * dy) - cy0;
        const tx = rx + (kx - rx) * ge + Math.sin(now * 2 + i) * 4 * k * ge;
        const ty = ry + (ky - ry) * ge - Math.sin(Math.PI * ge) * 34 * k;
        cloth.poly([b1x, b1y, cx0, cy0, b2x, b2y]).fill(fondo);
        cloth.moveTo(b1x, b1y).lineTo(b2x, b2y).stroke({ width: 2.5 * k, color: INK });
        const col = PAL[(i + 1) % PAL.length] as number;
        cloth.poly([b1x, b1y, b2x, b2y, tx, ty]).fill(col).stroke({ width: 2.5 * k, color: INK, join: "round" });
        // La franja clara con su rombo, como en el resto del aguayo.
        const mx = (b1x + b2x + tx) / 3, my = (b1y + b2y + ty) / 3;
        const f = 0.45;
        cloth.poly([mx + (b1x - mx) * f, my + (b1y - my) * f, mx + (b2x - mx) * f, my + (b2y - my) * f, mx + (tx - mx) * f, my + (ty - my) * f])
          .fill(S.dark ? 0xefe4cf : 0xfbf3e4);
        const d = Math.min(ancho, alto) * 0.12;
        cloth.poly([mx, my - d, mx + d, my, mx, my + d, mx - d, my]).fill(INK);
      }
    }
    // Los hilos entre vecinos: las trustlines.
    threads.clear();
    const byIdx = new Map(bundles.map((q) => [q.idx, q]));
    for (const q of bundles) {
      if (!q.alive) continue;
      for (const other of [q.a, q.b]) {
        const o = byIdx.get(other);
        if (!o || !o.alive || o.idx < q.idx) continue;
        threads.moveTo(q.x, q.y - lift).lineTo(o.x, o.y - lift).stroke({ width: 3 * k, color: S.color(q.idx), alpha: 0.75 });
      }
    }
    // Los bultos. Los que salen vuelan desde donde la cámara los mostraba
    // hasta su lugar en la fila de abajo, que está en la pantalla.
    const r = rad();
    const zoom = cam.zoom;
    for (const q of bundles) {
      const v = q.view as Container;
      v.rotation = q.rot + 0.12 * Math.sin(now * 1.1 + q.ph);
      if (q.alive) {
        v.scale.set(r / 20);
        v.position.set(q.x, q.y - lift);
        continue;
      }
      if (v.parent !== outLayer) outLayer.addChild(v);
      const b = ease.inOutCubic(clamp(q.out / 0.7, 0, 1));
      const p = cam.toScreen(q.x, q.y, S.sw(), S.sh());
      v.position.set(p.x + (q.x - p.x) * b, p.y + (q.y - p.y) * b);
      v.scale.set(((r * 0.8) / 20) * (zoom + (1 - zoom) * b));
    }
    ring.clear();
    const win = byIdx.get(winnerIdx) as Bundle;
    if (susto && tAll >= SUSTO && tAll < SUSTO + 1.1) {
      const f = (tAll - SUSTO) / 1.1;
      ring.circle(win.x, win.y - lift, r * (1.8 + 0.4 * Math.sin(tAll * 18))).stroke({ width: 5 * k, color: 0xe93d9c, alpha: 1 - f });
    }
    // Los nombres, cuando quedan pocos: al lado de cada bulto en la pantalla,
    // y si dos chocan, el de más abajo baja lo que haga falta.
    const live = alive();
    for (const q of bundles) if (q.chip) q.chip.visible = false;
    if (live.length <= 8 && phase !== "lift") {
      const u = S.u();
      const at = live
        .map((q) => ({ q, p: cam.toScreen(q.x + r, q.y - r * 0.6 - lift, S.sw(), S.sh()) }))
        .sort((a, b) => a.p.y - b.p.y);
      let prev = -Infinity;
      for (const { q, p } of at) {
        const chip = (q.chip ??= chips.addChild(S.chip(names[q.idx] ?? "")));
        chip.visible = true;
        const cy = Math.max(p.y, prev + 26 * u);
        prev = cy;
        chip.position.set(Math.min(p.x + 4 * u, S.sw() - chip.width - 10 * u), cy);
      }
    }
    // El nudo con el cordón tricolor, al levantar.
    knot.clear();
    if (phase === "lift") {
      const ky = y - lift - rr * 0.9;
      knot.rect(x - 17 * k, ky - 7 * k, 34 * k, 26 * k).fill(INK)
        .rect(x - 14 * k, ky - 4 * k, 28 * k, 6.7 * k).fill(0xd52b1e)
        .rect(x - 14 * k, ky + 2.7 * k, 28 * k, 6.7 * k).fill(0xf9e300)
        .rect(x - 14 * k, ky + 9.4 * k, 28 * k, 6.6 * k).fill(0x007a33);
      knot.rotation = 0;
    }
    // El pote.
    const put = phase === "spread" ? 0 : Math.min(n, Math.floor(clamp((tAll - T_DROP) / 1.6, 0, 1) * n));
    potText.text = `${t("cPasPot")}  ${Math.max(put, collected ? n : put)} / ${n}`;
    const bw = potText.width + 40 * k, bh = 40 * k;
    potText.position.set(bw / 2, bh / 2);
    coins.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    const nc = Math.min(put, 14);
    const cw = Math.min(82 * k, bw - 40 * k);
    for (let i = 0; i < nc; i++) {
      const off = Math.sin(i * 2.1) * 4 * k;
      const cy = bh + 18 * k + (nc - 1 - i) * 7 * k;
      coins.ellipse(bw / 2 + off, cy + 2 * k, cw / 2 + 2 * k, 5.4 * k).fill(INK).ellipse(bw / 2 + off, cy, cw / 2, 3.6 * k).fill(i % 2 ? YELLOW : 0xff7a1a);
    }
    cinchText.text = phase === "cinch" ? `${t("cPasCinchLbl")} ${pulls}/${PULLS}` : "";
    if (phase === "lift") crownUI.at((tAll - T_LIFT) / 1);
  }

  S.run((dt, now) => {
    tAll += dt;
    phase = tAll < T_DROP ? "spread" : tAll < T_WEAVE ? "drop" : tAll < T_CINCH ? "weave" : tAll < T_KNOT ? "cinch" : tAll < T_LIFT ? "knot" : "lift";
    if (phase === "drop") {
      const want = Math.floor(clamp((tAll - T_DROP) / (T_WEAVE - T_DROP), 0, 1) * Math.min(24, n));
      while (dropTicks < want) {
        beep(note(dropTicks % 2 === 0 ? 5 : 8), 0.06, "triangle", 0.035);
        dropTicks++;
      }
    }
    if (phase === "weave") {
      const want = Math.floor(clamp((tAll - T_WEAVE) / (T_CINCH - T_WEAVE), 0, 1) * 18);
      while (weaveTicks < want) {
        beep(note(10 + (weaveTicks % 5)), 0.14, "sine", 0.025);
        weaveTicks++;
      }
    }
    script(dt);
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (phase === "lift") tHold += dt * paceFactor();
    if (tHold >= WINNER_HOLD) {
      phase = "dead";
      S.cleanup();
    }
  });
}
