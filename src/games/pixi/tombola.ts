import { Container, Graphics, GraphicsContext, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";

/**
 * La tómbola, en PixiJS, con el director de cámara.
 *
 * La misma tómbola de `tombola.ts`: física de paso fijo sembrada con la ronda,
 * la bola del ganador que se acerca a la compuerta en la última vuelta, el
 * rebote del susto y el duelo, y el vaso. Lo nuevo es la cámara: arranca en la
 * boca del bombo mientras caen las bolas, se abre para las vueltas, se mete en
 * la compuerta cuando se abre (y en la bola que asoma y vuelve a caer), sigue
 * a la ganadora por la canaleta y se pega al vaso en el amague del borde.
 */

const TAU = Math.PI * 2;
const DT = 1 / 120;
const T_FILL = 1.8;
const T_S1 = 4.2;
const T_S2 = 6.8;
const T_S3 = 10.2;
const T_STOP = 11.0;
const T_OUT = 11.6;
const T_LIP = 14.8;
const T_LAND = 15.4;
const T_CROWN = 16.0;
const VANES = 3;

function omega(tt: number): number {
  const bump = (a: number, b: number, top: number): number => top * Math.sin(Math.PI * clamp((tt - a) / (b - a), 0, 1)) ** 0.6;
  if (tt < T_FILL) return 0;
  if (tt < T_S1) return bump(T_FILL, T_S1, 0.55);
  if (tt < T_S2) return bump(T_S1, T_S2, 0.85);
  if (tt < T_S3) return bump(T_S2, T_S3, 1.25);
  return 0;
}

interface Ball {
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  born: number;
  view?: Container;
}

export async function tombolaPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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
  const lang = getLang();

  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  const rebote = (story.arc === "susto" || story.arc === "duelo") && n >= 2;
  S.mark("arco", story.arc);
  const REBOTE = 0.95;
  const SH = rebote ? REBOTE : 0;
  const tOutStart = T_STOP + SH;
  const tOut = T_OUT + SH;
  const tLip = T_LIP + SH;
  const tLand = T_LAND + SH;
  const tCrown = T_CROWN + SH;
  setGameLength(tCrown, WINNER_HOLD);

  const rb = clamp(Math.sqrt(0.34 / Math.max(1, n)), 0.035, 0.17);
  const order = names.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const balls: Ball[] = order.map((idx, k) => ({
    idx, x: (rng() - 0.5) * 0.3, y: -0.9 + rb, vx: (rng() - 0.5) * 0.6, vy: 0.5, rot: rng() * TAU,
    born: 0.15 + (k / Math.max(1, n)) * (T_FILL - 0.55),
  }));
  const winBall = balls.find((b) => b.idx === winnerIdx) as Ball;
  /** El número de la bola ganadora: su puesto en la lista sellada, contando desde uno. */
  const num = String(winnerIdx + 1);
  const rivalBall = rebote ? balls.find((b) => b.idx === story.rival && b !== winBall) ?? null : null;
  let volvio = false;

  const STEPS = 1600;
  const cumT: number[] = [0];
  const h = T_STOP / STEPS;
  for (let i = 1; i <= STEPS; i++) cumT[i] = (cumT[i - 1] as number) + ((omega((i - 1) * h) + omega(i * h)) / 2) * h;
  const turns = cumT[STEPS] as number;
  const EXIT = S.portrait() ? Math.PI / 2 : Math.PI * 0.2;
  const doorStart = rng() * TAU;
  const want = ((((EXIT - doorStart) / TAU) % 1) + 1) % 1;
  const full = Math.floor(turns);
  const scale = (full + want) / Math.max(turns, 1e-6);
  function drumAngle(x: number): number {
    if (x <= 0) return 0;
    if (x >= T_STOP) return (full + want) * TAU;
    const f = (x / T_STOP) * STEPS;
    const i = Math.floor(f);
    const a = cumT[i] as number;
    return (a + ((cumT[Math.min(STEPS, i + 1)] as number) - a) * (f - i)) * scale * TAU;
  }

  /* ---------------------------------------------------------------- física */
  let tSim = 0, acc = 0, hits = 0;
  function step(dt: number): void {
    tSim += dt;
    const w = omega(tSim) * TAU * scale;
    const ang = drumAngle(tSim);
    const g = 5.2;
    const asomando = rivalBall !== null && tSim >= T_STOP && tSim < tOutStart;
    const inside = balls.filter((b) => tSim >= b.born && !(b === winBall && tSim >= tOutStart) && !(asomando && b === rivalBall));
    if (rivalBall && !volvio && tSim >= tOutStart) {
      volvio = true;
      rivalBall.x = Math.cos(EXIT) * (1 - rb * 1.2);
      rivalBall.y = Math.sin(EXIT) * (1 - rb * 1.2);
      rivalBall.vx = -Math.cos(EXIT) * 1.6;
      rivalBall.vy = -Math.sin(EXIT) * 1.6 - 0.6;
    }
    for (const b of inside) {
      b.vy += g * dt;
      if ((b === winBall || b === rivalBall) && tSim > T_S3 - 1.4 && tSim < T_STOP) {
        const fondo = b === winBall && rivalBall ? 3.5 : 1.2;
        const tx = Math.cos(EXIT) * (1 - rb * fondo), ty = Math.sin(EXIT) * (1 - rb * fondo);
        const pull = tSim > T_S3 ? 26 : 9;
        b.vx += (tx - b.x) * pull * dt;
        b.vy += (ty - b.y) * pull * dt;
        b.vx *= 0.97;
        b.vy *= 0.97;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += (b.vx - b.vy) * dt * 3;
    }
    for (let i = 0; i < inside.length; i++) {
      const p = inside[i] as Ball;
      for (let j = i + 1; j < inside.length; j++) {
        const q = inside[j] as Ball;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        const min = rb * 2;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const push = (min - d) / 2;
        p.x -= nx * push; p.y -= ny * push;
        q.x += nx * push; q.y += ny * push;
        const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.8;
          p.vx -= nx * imp * 0.5; p.vy -= ny * imp * 0.5;
          q.vx += nx * imp * 0.5; q.vy += ny * imp * 0.5;
          if (-rel > 0.9) hits++;
        }
      }
    }
    for (const b of inside) {
      const d = Math.hypot(b.x, b.y);
      const lim = 1 - rb;
      if (d > lim && d > 0) {
        const nx = b.x / d, ny = b.y / d;
        b.x = nx * lim;
        b.y = ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= vn * nx * 1.35;
          b.vy -= vn * ny * 1.35;
          if (vn > 1.1) hits++;
        }
        const tx = -ny, ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        const wall = w * lim;
        b.vx += tx * (wall - vt) * 0.08;
        b.vy += ty * (wall - vt) * 0.08;
      }
      for (let v = 0; v < VANES; v++) {
        const a = ang + (v / VANES) * TAU;
        const ax = Math.cos(a), ay = Math.sin(a);
        const along = b.x * ax + b.y * ay;
        if (along < 0.42 || along > 1) continue;
        const across = -b.x * ay + b.y * ax;
        if (Math.abs(across) >= rb + 0.02) continue;
        const side = across >= 0 ? 1 : -1;
        const nx = -ay * side, ny = ax * side;
        const push = rb + 0.02 - Math.abs(across);
        b.x += nx * push;
        b.y += ny * push;
        const vp = w * along;
        const vn2 = b.vx * nx + b.vy * ny;
        if (vn2 * side < Math.abs(vp)) {
          b.vx += nx * (vp * side - vn2) * 0.5;
          b.vy += ny * (vp * side - vn2) * 0.5;
        }
      }
      b.vx *= 0.998;
      b.vy *= 0.998;
    }
    if (tSim > T_S3) {
      const dx0 = Math.cos(EXIT) * (1 - rb * 1.2), dy0 = Math.sin(EXIT) * (1 - rb * 1.2);
      for (const b of inside) {
        if (b === winBall || b === rivalBall) continue;
        const dx = b.x - dx0, dy = b.y - dy0;
        const d = Math.hypot(dx, dy);
        if (d < rb * 2.4 && d > 0) {
          b.x = dx0 + (dx / d) * rb * 2.4;
          b.y = dy0 + (dy / d) * rb * 2.4;
        }
      }
    }
  }
  function settle(): void {
    const rest = balls.filter((b) => b !== winBall);
    let i = 0;
    for (let row = 0; i < rest.length && row < 60; row++) {
      const y = 1 - rb - row * rb * 1.75;
      const half = Math.sqrt(Math.max(0, 1 - y * y)) - rb;
      const fit = Math.max(1, Math.floor((half * 2) / (rb * 2)) + 1);
      for (let j = 0; j < fit && i < rest.length; j++, i++) {
        const b = rest[i] as Ball;
        b.x = fit === 1 ? 0 : -half + (j * (half * 2)) / (fit - 1) + (row % 2 ? rb * 0.5 : 0);
        b.y = y;
        b.vx = 0;
        b.vy = 0;
        b.born = 0;
      }
    }
  }

  /* ------------------------------------------------------------- geometría */
  interface Geo {
    k: number; R: number; cx: number; cy: number; vertical: boolean;
    door: { x: number; y: number }; cup: { x: number; y: number }; path: { x: number; y: number }[];
  }
  const geo = (): Geo => {
    const W = S.sw(), H = S.sh();
    const vertical = S.portrait();
    const k = Math.min(S.u(), W / 720);
    const top = S.top(), bottom = H - S.bottom();
    if (vertical) {
      const R = Math.min(W * 0.36, (bottom - top) * 0.24);
      const cx = W / 2, cy = top + R + 40 * k;
      const door = { x: cx + Math.cos(EXIT) * R, y: cy + Math.sin(EXIT) * R };
      const cup = { x: W * 0.5, y: bottom - 90 * k };
      return { k, R, cx, cy, vertical, door, cup, path: [door, { x: W * 0.84, y: door.y + (cup.y - door.y) * 0.3 }, { x: W * 0.16, y: door.y + (cup.y - door.y) * 0.62 }, { x: cup.x, y: cup.y - 30 * k }] };
    }
    const R = Math.min((bottom - top) * 0.36, W * 0.2);
    const cx = W * 0.3, cy = top + (bottom - top) * 0.46;
    const door = { x: cx + Math.cos(EXIT) * R, y: cy + Math.sin(EXIT) * R };
    const cup = { x: W * 0.8, y: bottom - 80 * k };
    return { k, R, cx, cy, vertical, door, cup, path: [door, { x: W * 0.62, y: door.y + 24 * k }, { x: W * 0.5, y: door.y + (cup.y - door.y) * 0.55 }, { x: cup.x, y: cup.y - 30 * k }] };
  };
  let G = geo();
  function along(path: { x: number; y: number }[], q: number): { x: number; y: number; seg: number } {
    const lens = path.slice(1).map((p, i) => Math.hypot(p.x - (path[i] as { x: number }).x, p.y - (path[i] as { y: number }).y));
    const total = lens.reduce((a, b) => a + b, 0);
    let d = clamp(q, 0, 1) * total;
    for (let i = 0; i < lens.length; i++) {
      const L = lens[i] as number;
      if (d <= L || i === lens.length - 1) {
        const a = path[i] as { x: number; y: number };
        const b = path[i + 1] as { x: number; y: number };
        const f = L > 0 ? clamp(d / L, 0, 1) : 0;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, seg: i };
      }
      d -= L;
    }
    return { ...(path[path.length - 1] as { x: number; y: number }), seg: lens.length - 1 };
  }
  function rollAt(x: number): number {
    if (x < tOut) return 0;
    if (x < tLip) return 0.94 * ease.outCubic((x - tOut) / (tLip - tOut));
    if (x < tLand) return 0.94 + 0.06 * Math.pow((x - tLip) / (tLand - tLip), 3);
    return 1;
  }

  /* ---------------------------------------------------------------- escena */
  let garlands!: Graphics;
  let drumBack!: Graphics;
  let cage!: Container;
  let bars!: Graphics;
  let door!: Graphics;
  let crank!: Graphics;
  let ballLayer!: Container;
  let outLayer!: Container;
  let cupFront!: Graphics;
  let numChip!: Container;
  let nameChip!: Container;
  let rivalView: Container | null = null;
  let winView!: Container;
  /** El radio con que se arma la bola de afuera: después solo se escala. */
  let bigR = 34;
  let hudCount!: Text;

  /** Una bola: sombra, color, borde y, si entra, el número en un disco. */
  const ballCtx = new Map<number, GraphicsContext>();
  function makeBall(b: Ball, r: number, withNum: boolean): Container {
    const c = new Container();
    const col = S.color(b.idx);
    let ctx = ballCtx.get(col);
    if (!ctx) {
      ctx = new GraphicsContext().circle(0.12, 0.12, 1).fill(INK).circle(0, 0, 1).fill(col).stroke({ width: 0.12, color: INK });
      ballCtx.set(col, ctx);
    }
    const g = new Graphics(ctx);
    g.scale.set(r);
    c.addChild(g);
    if (withNum) {
      const disc = new Graphics().circle(0, 0, r * 0.62).fill(CREAM);
      const label = String(b.idx + 1);
      const tx = S.text(label, { fontSize: r * (label.length > 2 ? 0.52 : 0.7), fontWeight: "900", fill: INK });
      tx.anchor.set(0.5);
      c.addChild(disc, tx);
    }
    return c;
  }

  function build(): void {
    G = geo();
    const { k, R, cx, cy, path, cup } = G;
    const W = S.sw(), H = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    S.bg.addChild(new Graphics().rect(0, 0, W, H).fill(S.dark ? 0x1b1426 : 0x2a1d3f));
    // Luces de kermés al fondo, desenfocadas.
    const lights = new Graphics();
    for (let i = 0; i < 40; i++) {
      const x = ((i * 97) % 100) / 100 * W, y = (((i * 53) % 100) / 100) * H * 0.9;
      lights.circle(x, y, (6 + (i % 5) * 5) * k).fill({ color: S.color(i), alpha: 0.08 });
    }
    S.bg.addChild(lights);
    garlands = new Graphics();
    S.scene.addChild(garlands);
    // El pie del bombo.
    S.scene.addChild(new Graphics()
      .moveTo(cx, cy).lineTo(cx - R * 0.75, cy + R * 1.35).moveTo(cx, cy).lineTo(cx + R * 0.75, cy + R * 1.35)
      .stroke({ width: 10 * k, color: INK, cap: "round" })
      .moveTo(cx, cy).lineTo(cx - R * 0.75, cy + R * 1.35).moveTo(cx, cy).lineTo(cx + R * 0.75, cy + R * 1.35)
      .stroke({ width: 5 * k, color: S.dark ? 0x6b6480 : 0x8a82a3, cap: "round" }));
    // La canaleta y el fondo del vaso.
    const chute = new Graphics();
    path.forEach((p, i) => (i === 0 ? chute.moveTo(p.x, p.y) : chute.lineTo(p.x, p.y)));
    chute.stroke({ width: 26 * k, color: INK, cap: "round", join: "round" });
    path.forEach((p, i) => (i === 0 ? chute.moveTo(p.x, p.y) : chute.lineTo(p.x, p.y)));
    chute.stroke({ width: 18 * k, color: S.dark ? 0x4a4160 : 0x5c5378, cap: "round", join: "round" });
    S.scene.addChild(chute);
    const top = 124 * k, bot = 84 * k, hh = 74 * k;
    const cupPts = [cup.x - top / 2, cup.y, cup.x + top / 2, cup.y, cup.x + bot / 2, cup.y + hh, cup.x - bot / 2, cup.y + hh];
    S.scene.addChild(new Graphics().poly(cupPts.map((v, i) => v + 6 * k * (i % 2 === 0 ? 1 : 1))).fill(INK).poly(cupPts).fill(0xb8860b));
    drumBack = new Graphics();
    S.scene.addChild(drumBack);
    ballLayer = new Container();
    ballLayer.position.set(cx, cy);
    S.scene.addChild(ballLayer);
    for (const b of balls) {
      b.view?.destroy({ children: true });
      b.view = makeBall(b, rb * R, rb * R >= 10 * k);
      ballLayer.addChild(b.view);
    }
    cage = new Container();
    cage.position.set(cx, cy);
    bars = new Graphics();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      bars.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2).lineTo(Math.cos(a) * R, Math.sin(a) * R).stroke({ width: 6 * k, color: INK });
      bars.moveTo(Math.cos(a) * R * 0.2, Math.sin(a) * R * 0.2).lineTo(Math.cos(a) * R, Math.sin(a) * R).stroke({ width: 2.5 * k, color: i % 2 ? YELLOW : 0xe93d9c });
    }
    cage.addChild(bars);
    cage.addChild(new Graphics().circle(0, 0, R).stroke({ width: 12 * k, color: INK }).circle(0, 0, R).stroke({ width: 6 * k, color: 0xff7a1a }));
    door = new Graphics();
    cage.addChild(door);
    crank = new Graphics();
    cage.addChild(crank);
    S.scene.addChild(cage);
    outLayer = new Container();
    S.scene.addChild(outLayer);
    // Las bolas de afuera se arman una vez, al tamaño más grande, y se escalan.
    bigR = Math.max(rb * R, 34 * k);
    rivalView = rivalBall ? makeBall(rivalBall, bigR, true) : null;
    winView = makeBall(winBall, bigR, true);
    numChip = S.chip(`${t("cTomNum")} ${num}`, 1.4);
    nameChip = S.chip(names[winnerIdx] ?? "", 1.5);
    for (const v of [rivalView, winView, numChip, nameChip]) {
      if (!v) continue;
      v.visible = false;
      outLayer.addChild(v);
    }
    cupFront = new Graphics();
    const clipTop = cup.y + hh * 0.38;
    cupFront.poly([cup.x - top / 2 + (top - bot) / 2 * 0.38, clipTop, cup.x + top / 2 - (top - bot) / 2 * 0.38, clipTop, cup.x + bot / 2, cup.y + hh, cup.x - bot / 2, cup.y + hh]).fill(YELLOW)
      .poly(cupPts).stroke({ width: 4 * k, color: INK })
      .rect(cup.x - top / 2 - 6 * k, cup.y - 4 * k, top + 12 * k, 8 * k).fill(INK);
    S.scene.addChild(cupFront);
    // El contador de bolas, arriba a la derecha.
    const lab = S.text(t("cTomBalls"), { fontSize: 14 * k, fontWeight: "800", fill: CREAM });
    lab.anchor.set(1, 0);
    lab.position.set(W - 22 * k, S.top() + 40 * k);
    lab.alpha = 0.8;
    hudCount = S.text("0", { fontSize: 48 * k, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 6 * k } });
    hudCount.anchor.set(1, 0);
    hudCount.position.set(W - 22 * k, S.top() + 58 * k);
    const round = S.text(`${t("cWheelRound")} #${beacon.round}`, { fontFamily: MONO, fontSize: 12 * k, fontWeight: "700", fill: CREAM });
    round.alpha = 0.55;
    round.position.set(22 * k, H - S.bottom() - 16 * k);
    S.hud.addChild(lab, hudCount, round);
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);
  cam.cut(G.cx, G.cy - G.R * 0.6, 1.8);

  /* ---------------------------------------------------------------- estado */
  let tAll = 0, tHold = 0, silent = false, didCrown = false;
  let lastHum = -1, dropTicks = 0, crankN = -1, clatterAt = -9, beat = -1, lastSaid = -99;
  const fired = new Set<string>();
  function once(key: string, due: boolean, fn: () => void): void {
    if (!due || fired.has(key)) return;
    fired.add(key);
    fn();
  }
  const sayNow = (msg: string, heat: number): void => {
    if (silent) return;
    lastSaid = tAll;
    S.say(msg, heat);
  };

  function events(): void {
    once("drop", tAll >= 0.05, () => sayNow(t("cTomDrop"), 0.1));
    once("count", tAll >= 1.0, () => sayNow(T[lang].cTomCount(n), 0.15));
    once("s1", tAll >= T_FILL + 0.1, () => sayNow(t("cTomSpin1"), 0.35));
    once("s2", tAll >= T_S1 + 0.1, () => sayNow(t("cTomSpin2"), 0.5));
    once("s3", tAll >= T_S2 + 0.1, () => sayNow(t("cTomSpin3"), 0.7));
    once("stop", tAll >= T_S3 - 0.2, () => sayNow(t("cTomStop"), 0.75));
    once("door", tAll >= T_STOP, () => {
      sayNow(t("cTomDoor"), 0.85);
      if (!silent) {
        beep(note(5), 0.08, "square", 0.06);
        setTimeout(() => beep(note(10), 0.14, "triangle", 0.05), 70);
        cam.punch(0.06);
      }
    });
    if (rivalBall) {
      const suya = String(rivalBall.idx + 1);
      once("asoma", tAll >= T_STOP + REBOTE * 0.32, () => {
        sayNow(T[lang].cTomFake(suya), 0.9);
        if (!silent) beep(note(10), 0.1, "triangle", 0.045);
      });
      once("vuelve", tAll >= T_STOP + REBOTE * 0.76, () => {
        sayNow(t("cTomBack"), 0.95);
        if (!silent) {
          beep(note(3), 0.08, "square", 0.05);
          setTimeout(() => beep(note(1), 0.1, "sine", 0.05), 80);
          cam.shake(10 * G.k).punch(0.05);
        }
      });
    }
    once("ball", tAll >= tOut + 0.5, () => sayNow(T[lang].cTomBall(num), 0.9));
    once("almost", tAll >= tLip, () => sayNow(t("cTomAlmost"), 0.95));
    once("land", tAll >= tLand, () => {
      if (!silent) {
        beep(note(0), 0.45, "sine", 0.1);
        setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
        setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
        cam.punch(0.1).shake(12 * G.k);
      }
    });
    if (tAll >= tCrown) crowned();
    if (tAll > tOut + 1 && tAll < tLip && tAll - lastSaid > 2.2) sayNow(t("cTomRoll"), 0.85);
  }

  function sounds(): void {
    if (silent) return;
    if (tAll < T_FILL) {
      const wantT = Math.min(22, Math.floor((tAll / T_FILL) * Math.min(22, n + 4)));
      while (dropTicks < wantT) {
        beep(note(8 + (dropTicks % 5)), 0.05, "triangle", 0.03);
        dropTicks++;
      }
    }
    const ang = drumAngle(tAll);
    const cr = Math.floor(ang / (TAU / 8));
    if (tAll >= T_FILL && tAll < T_STOP && cr !== crankN) {
      if (crankN >= 0) beep(note(3), 0.04, "square", 0.034);
      crankN = cr;
    }
    const w = omega(tAll);
    if (w > 0.05) {
      const hb = Math.floor(tAll / 0.3);
      if (hb !== lastHum) {
        lastHum = hb;
        beepFor(note(2 + Math.round(w * 3)), 0.36, "sawtooth", 0.024);
      }
    }
    if (hits > 3 && tAll - clatterAt > 0.125 && tAll < T_STOP) {
      clatterAt = tAll;
      beep(note(12 + (hits % 4)), 0.035, "triangle", 0.022);
    }
    hits = 0;
    if (tAll >= tLip - 0.4 && tAll < tLand) {
      const b = Math.floor((tAll - (tLip - 0.4)) / 0.35);
      if (b !== beat) {
        beat = b;
        beep(note(0), 0.12, "sine", 0.07);
      }
    }
    const seg = along(G.path, rollAt(tAll)).seg;
    once(`seg${seg}`, tAll > tOut && tAll < tLip, () => beep(note(12 - seg * 2), 0.09, "triangle", 0.045));
  }

  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    S.say(T[lang].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  skipFn = (): void => {
    if (tAll >= tCrown) return;
    silent = true;
    tAll = tCrown;
    tSim = T_STOP + 3;
    settle();
    events();
    silent = false;
  };

  /** Dónde va la bola ganadora afuera, y de qué tamaño. */
  function winnerOut(): { x: number; y: number; r: number } {
    const { cx, cy, R, path, cup, k } = G;
    const r0 = rb * R;
    if (tAll < tOut) {
      const q = ease.inOutCubic((tAll - tOutStart) / (tOut - tOutStart));
      const sx = rivalBall ? cx + winBall.x * R : cx + Math.cos(EXIT) * (1 - rb * 1.2) * R;
      const sy = rivalBall ? cy + winBall.y * R : cy + Math.sin(EXIT) * (1 - rb * 1.2) * R;
      return { x: sx + ((path[0] as { x: number }).x - sx) * q, y: sy + ((path[0] as { y: number }).y - sy) * q, r: r0 };
    }
    const p = along(path, rollAt(tAll));
    const wob = tAll > tLip && tAll < tLand ? Math.sin((tAll - tLip) * 30) * 5 * k : 0;
    const r = r0 + (Math.max(r0, 34 * k) - r0) * ease.outCubic(clamp((tAll - tOut) / 1.2, 0, 1));
    let x = p.x + wob;
    let y = p.y - r - 8 * k;
    if (tAll >= tLand) {
      const q2 = clamp((tAll - tLand) / 0.25, 0, 1);
      x += (cup.x - x) * ease.inOutCubic(q2);
      y += (cup.y + 22 * k - r * 0.4 - y) * ease.inOutCubic(q2);
    }
    return { x, y, r };
  }

  /** La cámara: la boca al llenar, el bombo al girar, la compuerta, la bola, el vaso. */
  function direct(): void {
    const { cx, cy, R, door: dp, cup, vertical } = G;
    const midX = S.sw() / 2, midY = S.sh() / 2;
    if (tAll < T_FILL) {
      const p = tAll / T_FILL;
      cam.lookAt(cx + (midX - cx) * p * 0.2, cy - R * 0.6 * (1 - p), 1.8 - 0.55 * p, 3);
    } else if (tAll < T_S3) {
      const w = omega(tAll);
      cam.lookAt(cx + (midX - cx) * 0.25, cy, 1.2 + 0.12 * w, 2);
    } else if (tAll < tOutStart) {
      cam.lookAt(dp.x, dp.y, vertical ? 2 : 2.3, tAll < T_STOP ? 2 : 4);
    } else if (tAll < tLip) {
      const o = winnerOut();
      cam.lookAt(o.x + (vertical ? 0 : 60 * G.k), o.y, vertical ? 1.5 : 1.7, 3.5);
    } else if (tAll < tCrown) {
      cam.lookAt(cup.x, cup.y - 20 * G.k, vertical ? 2 : 2.4, 4);
    } else {
      // Se abre despacio: un tirón de 2,4 a 1 desenfoca toda la escena.
      cam.lookAt(midX, midY, 1.05, 1.1);
    }
  }

  function draw(now: number): void {
    const { k, R, cx, cy } = G;
    const ang = drumAngle(tAll);
    // Las guirnaldas, que se mecen.
    garlands.clear();
    const W = S.sw();
    const y0 = S.top() + 4 * k;
    for (let x = 0; x <= W; x += 20 * k) {
      const y = y0 + Math.sin((x / W) * Math.PI * 3) * 14 * k;
      if (x === 0) garlands.moveTo(x, y);
      else garlands.lineTo(x, y);
    }
    garlands.stroke({ width: 2 * k, color: CREAM, alpha: 0.25 });
    for (let i = 0; i * 46 * k < W; i++) {
      const x = i * 46 * k;
      const y = y0 + Math.sin((x / W) * Math.PI * 3) * 14 * k;
      const sw = Math.sin(now * 1.8 + i * 0.7) * 0.2;
      const c = Math.cos(sw), s = Math.sin(sw);
      const pt = (px: number, py: number): number[] => [x + px * c - py * s, y + px * s + py * c];
      garlands.poly([...pt(-8 * k, 0), ...pt(8 * k, 0), ...pt(0, 15 * k)]).fill(S.color(i));
    }
    // El vidrio y las paletas.
    drumBack.clear().circle(cx, cy, R).fill({ color: CREAM, alpha: S.dark ? 0.07 : 0.1 });
    for (let v = 0; v < VANES; v++) {
      const a = ang + (v / VANES) * TAU;
      drumBack.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42).lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    }
    drumBack.stroke({ width: 4 * k, color: CREAM, alpha: 0.35 });
    // Las bolas.
    for (const b of balls) {
      const v = b.view as Container;
      const inside = tAll >= b.born && !(b === winBall && tAll >= tOutStart) && !(b === rivalBall && tAll >= T_STOP && tAll < tOutStart);
      v.visible = inside;
      if (!inside) continue;
      const fall = clamp((tAll - b.born) / 0.25, 0, 1);
      v.position.set(b.x * R, b.y * R - (1 - fall) * R * 0.5);
      v.rotation = b.rot;
      v.scale.set(1);
    }
    bars.rotation = ang;
    // La compuerta, que gira con el bombo y se abre al pararse.
    const da = doorStart + ang;
    const open = clamp((tAll - T_STOP) / 0.3, 0, 1);
    const span = 0.2;
    door.clear().arc(0, 0, R, da - span, da + span).stroke({ width: 14 * k, color: INK });
    door.arc(0, 0, R, da - span, da + span).stroke({ width: 8 * k, color: open > 0 ? 0x1b1426 : YELLOW });
    if (open > 0) {
      const hx = Math.cos(da - span) * R, hy = Math.sin(da - span) * R;
      const a2 = da - span + Math.PI / 2 + open * 1.1;
      door.moveTo(hx, hy).lineTo(hx + Math.cos(a2) * R * span * 2, hy + Math.sin(a2) * R * span * 2).stroke({ width: 8 * k, color: YELLOW });
    }
    crank.clear().circle(0, 0, 16 * k).fill(INK).circle(0, 0, 9 * k).fill(YELLOW);
    crank.moveTo(0, 0).lineTo(Math.cos(ang) * 40 * k, Math.sin(ang) * 40 * k).stroke({ width: 7 * k, color: INK });
    crank.circle(Math.cos(ang) * 40 * k, Math.sin(ang) * 40 * k, 9 * k).fill(0xe93d9c).stroke({ width: 3 * k, color: INK });

    // Afuera: la que asoma y vuelve, y la ganadora por la canaleta.
    for (const v of outLayer.children) v.visible = false;
    if (rivalBall && rivalView && tAll >= T_STOP && tAll < tOutStart) {
      const q = (tAll - T_STOP) / REBOTE;
      const fuera = q < 0.42 ? ease.outCubic(q / 0.42) : q < 0.63 ? 1 : 1 - ease.inOutCubic((q - 0.63) / 0.37);
      const tiembla = q >= 0.42 && q < 0.63 ? Math.sin(tAll * 40) * 3 * k : 0;
      const d = (1 - rb * 1.2) * R + fuera * rb * 1.4 * R;
      const nx = Math.cos(EXIT), ny = Math.sin(EXIT);
      rivalView.visible = true;
      rivalView.scale.set((rb * R * (1 + 0.25 * fuera)) / bigR);
      rivalView.position.set(cx + nx * d - ny * tiembla, cy + ny * d + nx * tiembla);
    }
    if (tAll >= tOutStart) {
      const o = winnerOut();
      winView.visible = true;
      winView.scale.set(o.r / bigR);
      winView.position.set(o.x, o.y);
      if (tAll > tOut + 0.3 && tAll < tCrown) {
        numChip.visible = true;
        numChip.position.set(o.x + o.r + 10 * k, o.y - o.r - 6 * k);
      }
      if (tAll >= tLand && tAll < tCrown) {
        nameChip.visible = true;
        nameChip.position.set(G.cup.x - 60 * k, G.cup.y - 60 * k);
        nameChip.alpha = clamp((tAll - tLand) / 0.2, 0, 1);
      }
    }
    hudCount.text = String(balls.filter((b) => tAll >= b.born).length);
    if (tAll >= tCrown) crown.at(tAll - tCrown);
  }

  S.run((dt, now) => {
    tAll += dt;
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 40 && tSim < T_STOP + (rebote ? 2.2 : 0.5)) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    events();
    sounds();
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(now);
    if (tAll >= tCrown) tHold += dt * paceFactor();
    if (tHold >= WINNER_HOLD) S.cleanup();
  });
}
