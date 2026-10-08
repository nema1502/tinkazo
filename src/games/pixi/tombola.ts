import { Container, Graphics, GraphicsContext, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, params, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { musicHold } from "../../music";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, shorten, winnersLabel } from "../overlay";
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
 *
 * Desde el 29 de septiembre de 2026 las bolas chocan como bolas: tres pasadas
 * de separación por paso de física (con una sola se veían encimadas cuando la
 * paleta las empujaba contra otras), rebote entre ellas y giro que sale del
 * roce con la pared. Afuera, la ganadora rueda de verdad por una canaleta de
 * rieles: el número gira según lo que avanza, pega un saltito en cada curva y
 * cae al vaso rebotando. Con `?auditar=fisica` el juego anota lo encimadas que
 * quedan y si alguna se escapó del bombo, para `scripts/audit-fisica.mjs`.
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
  /** Lo que gira por segundo: sale del roce con la pared y con las otras. */
  spin: number;
  born: number;
  view?: Container;
  shine?: Container;
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

  // Con más de cien, bolas un poco más chicas: el bombo iba tan lleno que la
  // paleta cortaba el montón como un cuchillo y las encimaba.
  const rb = clamp(Math.sqrt((n > 100 ? 0.26 : 0.34) / Math.max(1, n)), 0.03, 0.17);
  // Pasadas de separación por paso de física: el montón de abajo, apretado
  // por la gravedad y empujado por las paletas, necesita más cuanto más alto es.
  const PASSES = n > 100 ? 40 : n > 40 ? 16 : 8;
  const order = names.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const balls: Ball[] = order.map((idx, k) => ({
    idx, x: (rng() - 0.5) * 0.3, y: -0.9 + rb, vx: (rng() - 0.5) * 0.6, vy: 0.5, rot: rng() * TAU, spin: 0,
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
  // `?auditar=fisica`: lo encimadas que quedan después de cada paso y si alguna
  // se sale del bombo, para `scripts/audit-fisica.mjs`.
  const audit = params.get("auditar") === "fisica"
    ? { juego: "tombola", n, maxOverlap: 0, maxAt: 0, escapes: 0, pasos: 0, done: false }
    : null;
  if (audit) (window as unknown as { __fisica: typeof audit }).__fisica = audit;

  let tSim = 0, acc = 0, hits = 0;
  /** La pared del bombo: la contiene, rebota y la hace rodar con el giro. */
  function wallOf(b: Ball, w: number): void {
    const d = Math.hypot(b.x, b.y);
    const lim = 1 - rb;
    if (d <= lim || d === 0) return;
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
    // Rueda contra la pared: el giro sigue a lo que se desliza.
    b.spin += ((b.vx * tx + b.vy * ty) / rb - b.spin) * 0.3;
  }
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
      b.spin *= 0.995;
      b.rot += b.spin * dt;
    }
    // Las paletas empujan y levantan.
    for (const b of inside) {
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
      wallOf(b, w);
      b.vx *= 0.998;
      b.vy *= 0.998;
    }
    // La boca de la compuerta queda libre para la ganadora: las demás se
    // apartan. Va antes de los choques, que después las acomodan sin encimarse.
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
    // Los choques entre bolas: varias pasadas, como un solver de juego. La
    // primera rebota; en todas se separa y se vuelve a meter en el bombo,
    // porque separar un par empuja a una contra otra o contra la pared.
    const min = rb * 2;
    for (let pass = 0; pass < PASSES; pass++) {
      const act = inside.slice().sort((a, b) => a.x - b.x || a.idx - b.idx);
      for (let i = 0; i < act.length; i++) {
        const p = act[i] as Ball;
        for (let j = i + 1; j < act.length; j++) {
          const q = act[j] as Ball;
          if (q.x - p.x >= min) break;
          const dx = q.x - p.x, dy = q.y - p.y;
          if (Math.abs(dy) >= min) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const push = (min - d) / 2;
          p.x -= nx * push; p.y -= ny * push;
          q.x += nx * push; q.y += ny * push;
          if (pass > 0) continue;
          const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          if (rel < 0) {
            // Dos bolas iguales con un rebote seco, como las de plástico duro.
            const imp = (-rel * (1 + 0.55)) / 2;
            p.vx -= nx * imp; p.vy -= ny * imp;
            q.vx += nx * imp; q.vy += ny * imp;
            // El roce las hace girar.
            const vt = (q.vx - p.vx) * -ny + (q.vy - p.vy) * nx;
            p.spin -= (vt / rb) * 0.15;
            q.spin -= (vt / rb) * 0.15;
            if (-rel > 0.9) hits++;
          }
        }
      }
      for (const b of inside) wallOf(b, 0);
    }
    if (audit) {
      audit.pasos++;
      for (let i = 0; i < inside.length; i++) {
        const p = inside[i] as Ball;
        if (Math.hypot(p.x, p.y) > 1 - rb + 0.01) audit.escapes++;
        for (let j = i + 1; j < inside.length; j++) {
          const q = inside[j] as Ball;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < min && (min - d) / min > audit.maxOverlap) {
            audit.maxOverlap = (min - d) / min;
            audit.maxAt = Math.round(tSim * 100) / 100;
          }
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
    // Frena, pero sin arrastrarse: con la curva cúbica el último 6% del tramo
    // ocupaba 2,2 s reales con la bola casi quieta.
    if (x < tLip) {
      const q = (x - tOut) / (tLip - tOut);
      return 0.94 * (1 - (1 - q) * (1 - q));
    }
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
  /** Las chispitas del vaso cuando cae la bola. */
  let sparkles!: Graphics;
  let numChip!: Container;
  let nameChip!: Container;
  let rivalView: Container | null = null;
  let winView!: Container;
  /** El radio con que se arma la bola de afuera: después solo se escala. */
  let bigR = 34;
  let hudCount!: Text;
  /** La leyenda de quién tiene qué bola, mientras gira el bombo. */
  let legend!: Container;
  let legendTitle!: Text;
  let legendPages: Container[] = [];
  let legendRange: string[] = [];
  /** Dónde empieza la leyenda, para que la cámara no la pise con el bombo: a la derecha en una pantalla ancha, abajo en un celular. */
  let legendX0 = 0;
  let legendTop = 0;

  /** Una bola: sombra, color, borde y, si entra, el número en un disco. */
  const ballCtx = new Map<number, GraphicsContext>();
  /** El brillo de cada bola: la luz viene siempre de arriba a la izquierda, así que no gira con ella. */
  const shines = new WeakMap<Container, Container>();
  const shineOf = (v: Container): void => {
    const sh = shines.get(v);
    if (sh) sh.rotation = -v.rotation;
  };
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
    const shine = new Container();
    shine.addChild(new Graphics()
      // La sombra del lado de abajo a la derecha, y el reflejo arriba a la izquierda.
      .moveTo(Math.cos(-0.25) * r * 0.8, Math.sin(-0.25) * r * 0.8).arc(0, 0, r * 0.8, -0.25, 1.85).stroke({ width: r * 0.18, color: 0x000000, alpha: 0.2, cap: "round" })
      .ellipse(-r * 0.4, -r * 0.46, r * 0.26, r * 0.15).fill({ color: 0xffffff, alpha: 0.6 })
      .circle(-r * 0.62, -r * 0.2, r * 0.07).fill({ color: 0xffffff, alpha: 0.45 }));
    c.addChild(shine);
    shines.set(c, shine);
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
    // La canaleta: postes al piso, el canal con su borde y los travesaños.
    const chute = new Graphics();
    const floor = cup.y + 74 * k;
    for (const p of path.slice(1, -1)) {
      chute.rect(p.x - 4 * k, p.y, 8 * k, Math.max(0, floor - p.y)).fill(INK)
        .rect(p.x - 2 * k, p.y, 4 * k, Math.max(0, floor - p.y)).fill(S.dark ? 0x6b6480 : 0x8a82a3);
    }
    const trace = (): void => path.forEach((p, i) => (i === 0 ? chute.moveTo(p.x, p.y) : chute.lineTo(p.x, p.y)));
    trace();
    chute.stroke({ width: 30 * k, color: INK, cap: "round", join: "round" });
    trace();
    chute.stroke({ width: 22 * k, color: S.dark ? 0x7a5a3a : 0x9a7048, cap: "round", join: "round" });
    // El fondo del canal, más oscuro, donde rueda la bola.
    trace();
    chute.stroke({ width: 9 * k, color: S.dark ? 0x4a3422 : 0x6b4a2c, cap: "round", join: "round" });
    // Los travesaños, cada tanto, y un clavo en cada curva.
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i] as { x: number; y: number }, b = path[i + 1] as { x: number; y: number };
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / (L || 1), uy = (b.y - a.y) / (L || 1);
      for (let d = 22 * k; d < L - 10 * k; d += 34 * k) {
        const x = a.x + ux * d, y = a.y + uy * d;
        chute.moveTo(x - uy * 13 * k, y + ux * 13 * k).lineTo(x + uy * 13 * k, y - ux * 13 * k).stroke({ width: 3 * k, color: INK, alpha: 0.6 });
      }
      if (i > 0) chute.circle(a.x, a.y, 5 * k).fill(INK).circle(a.x, a.y, 2.5 * k).fill(YELLOW);
    }
    S.scene.addChild(chute);
    const top = 124 * k, bot = 84 * k, hh = 74 * k;
    const cupPts = [cup.x - top / 2, cup.y, cup.x + top / 2, cup.y, cup.x + bot / 2, cup.y + hh, cup.x - bot / 2, cup.y + hh];
    // El vaso de vidrio, por detrás: su sombra, el vidrio y el borde de atrás.
    S.scene.addChild(new Graphics()
      .ellipse(cup.x + 8 * k, cup.y + hh + 4 * k, bot * 0.7, 8 * k).fill({ color: 0x000000, alpha: 0.35 })
      .poly(cupPts).fill({ color: CREAM, alpha: S.dark ? 0.1 : 0.16 })
      .ellipse(cup.x, cup.y, top / 2, 10 * k).fill({ color: 0x000000, alpha: 0.25 }).stroke({ width: 3 * k, color: INK }));
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
    // El número va sin cara: el chip de siempre dibuja la cara del texto que
    // lleva, y "N.º 4" salía con una cara que no era de nadie.
    numChip = (() => {
      const kk = k * 1.4;
      const c = new Container();
      const tx = S.text(`${t("cTomNum")} ${num}`, { fontSize: 12 * kk, fontWeight: "900", fill: INK });
      tx.position.set(9 * kk, 3.5 * kk);
      const w = tx.width + 18 * kk;
      c.addChild(new Graphics().roundRect(3 * kk, 3 * kk, w, 22 * kk, 5 * kk).fill(INK).roundRect(0, 0, w, 22 * kk, 5 * kk).fill(YELLOW).stroke({ width: 2 * kk, color: INK }), tx);
      c.pivot.set(0, 11 * kk);
      return c;
    })();
    nameChip = S.chip(names[winnerIdx] ?? "", 1.5);
    for (const v of [rivalView, winView, numChip, nameChip]) {
      if (!v) continue;
      v.visible = false;
      outLayer.addChild(v);
    }
    /** Medio borde de una elipse, como puntos: `arc` solo hace círculos. */
    const rim = (x: number, y: number, rx: number, ry: number, a0: number, a1: number): number[] => {
      const pts: number[] = [];
      for (let i = 0; i <= 16; i++) {
        const a = a0 + ((a1 - a0) * i) / 16;
        pts.push(x + Math.cos(a) * rx, y + Math.sin(a) * ry);
      }
      return pts;
    };
    // El vaso por delante: el vidrio que deja ver la bola, dos reflejos, el
    // borde de adelante y el pie.
    cupFront = new Graphics();
    const clipTop = cup.y + hh * 0.38;
    cupFront.poly([cup.x - top / 2 + (top - bot) / 2 * 0.38, clipTop, cup.x + top / 2 - (top - bot) / 2 * 0.38, clipTop, cup.x + bot / 2, cup.y + hh, cup.x - bot / 2, cup.y + hh]).fill({ color: CREAM, alpha: 0.22 })
      .poly([cup.x - top * 0.36, cup.y + hh * 0.12, cup.x - top * 0.26, cup.y + hh * 0.12, cup.x - bot * 0.3, cup.y + hh * 0.88, cup.x - bot * 0.4, cup.y + hh * 0.88]).fill({ color: 0xffffff, alpha: 0.45 })
      .poly([cup.x + top * 0.2, cup.y + hh * 0.2, cup.x + top * 0.25, cup.y + hh * 0.2, cup.x + bot * 0.22, cup.y + hh * 0.8, cup.x + bot * 0.17, cup.y + hh * 0.8]).fill({ color: 0xffffff, alpha: 0.3 })
      .poly(cupPts).stroke({ width: 4 * k, color: INK, join: "round" })
      .poly(rim(cup.x, cup.y, top / 2, 10 * k, 0, Math.PI), false).stroke({ width: 4 * k, color: INK })
      .poly(rim(cup.x, cup.y + 1 * k, top / 2 - 4 * k, 7 * k, 0.35, Math.PI - 0.35), false).stroke({ width: 2 * k, color: 0xffffff, alpha: 0.5 })
      .roundRect(cup.x - bot / 2 - 8 * k, cup.y + hh - 3 * k, bot + 16 * k, 10 * k, 4 * k).fill(INK)
      .roundRect(cup.x - bot / 2 - 5 * k, cup.y + hh - 1 * k, bot + 10 * k, 5 * k, 2 * k).fill(YELLOW);
    S.scene.addChild(cupFront);
    sparkles = new Graphics();
    S.scene.addChild(sparkles);
    // El contador de bolas, arriba a la derecha.
    const lab = S.text(t("cTomBalls"), { fontSize: 14 * k, fontWeight: "800", fill: CREAM });
    lab.anchor.set(1, 0);
    lab.position.set(W - 22 * k, S.top() + 40 * k);
    lab.alpha = 0.8;
    hudCount = S.text("0", { fontSize: 48 * k, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 6 * k } });
    hudCount.anchor.set(1, 0);
    hudCount.position.set(W - 22 * k, S.top() + 58 * k);
    // La ronda ya está arriba, en la barra del estadio: no se repite abajo.
    S.hud.addChild(lab, hudCount);
    buildLegend();
  }

  /**
   * La leyenda de las bolas, mientras gira el bombo: cada nombre con su bola y
   * su número, en orden alfabético para encontrarse rápido. Antes el número de
   * la ganadora salía tres segundos y medio antes que su nombre y nadie sabía
   * de quién era (lo pidió Nicolás el 4 de octubre de 2026). Con mucha gente
   * pasa en páginas, y se va antes de que se abra la compuerta: la canaleta y
   * el vaso quedan libres para la bola.
   */
  function buildLegend(): void {
    const { vertical } = G;
    // En un celular, la letra a la medida de la pantalla: con la escala del
    // bombo los nombres quedaban de ocho píxeles.
    const k = vertical ? S.u() : G.k;
    const W = S.sw(), H = S.sh();
    legend = new Container();
    legendPages = [];
    legendRange = [];
    const x0 = vertical ? 14 * k : W * 0.55;
    const x1 = W - 14 * k;
    const y1 = H - S.bottom() - 10 * k;
    // En una pantalla ancha va a la derecha, debajo del contador; en un
    // celular, abajo, en la mitad de abajo como mucho, y la cámara sube el bombo.
    const techo = vertical ? S.top() + (y1 - S.top()) * 0.5 : S.top() + 116 * G.k;
    const head = 32 * k, rowH = 28 * k;
    const cols = vertical ? 2 : Math.max(1, Math.min(3, Math.floor((x1 - x0) / (170 * k))));
    const colW = (x1 - x0) / cols;
    const rows = Math.max(1, Math.floor((y1 - techo - head - 14 * k) / rowH));
    const per = cols * rows;
    // Orden natural: "Ana 2" antes que "Ana 10".
    const orden = names.map((nm, i) => ({ nm, i })).sort((a, b) => a.nm.localeCompare(b.nm, "es", { numeric: true }));
    const pages = Math.max(1, Math.ceil(orden.length / per));
    const filas = Math.min(rows, Math.ceil(Math.min(per, orden.length) / cols));
    const y0 = vertical ? y1 - (head + filas * rowH + 14 * k) + 8 * k : techo;
    legendX0 = vertical ? 0 : x0;
    legendTop = vertical ? y0 - 8 * k : 0;
    legend.addChild(new Graphics()
      .roundRect(x0 - 10 * k, y0 - 8 * k, x1 - x0 + 20 * k, head + filas * rowH + 14 * k, 10 * k)
      .fill({ color: INK, alpha: 0.84 })
      .stroke({ width: 2 * k, color: CREAM, alpha: 0.25 }));
    legendTitle = S.text("", { fontFamily: MONO, fontSize: 13 * k, fontWeight: "800", fill: YELLOW, letterSpacing: 2 * k });
    legendTitle.position.set(x0, y0);
    legend.addChild(legendTitle);
    const chars = Math.max(8, Math.floor((colW - 40 * k) / (8.2 * k)));
    for (let p = 0; p < pages; p++) {
      const page = new Container();
      const chunk = orden.slice(p * per, (p + 1) * per);
      const alto = Math.ceil(chunk.length / cols);
      chunk.forEach((e, j) => {
        const x = x0 + Math.floor(j / alto) * colW, y = y0 + head + (j % alto) * rowH + rowH / 2;
        const lab = String(e.i + 1);
        const disc = new Graphics()
          .circle(x + 12 * k, y, 12 * k).fill(S.color(e.i)).stroke({ width: 2 * k, color: INK })
          .circle(x + 12 * k, y, 8.6 * k).fill(CREAM);
        const nt = S.text(lab, { fontSize: (lab.length > 2 ? 9 : 11) * k, fontWeight: "900", fill: INK });
        nt.anchor.set(0.5);
        nt.position.set(x + 12 * k, y);
        const nm = S.text(shorten(e.nm, chars), { fontSize: 14 * k, fontWeight: "800", fill: CREAM });
        nm.anchor.set(0, 0.5);
        nm.position.set(x + 30 * k, y);
        page.addChild(disc, nt, nm);
      });
      const ini = (s: string | undefined): string => (s ?? "").trim().charAt(0).toUpperCase();
      legendRange.push(`${ini(chunk[0]?.nm)}–${ini(chunk[chunk.length - 1]?.nm)}`);
      page.visible = p === 0;
      legend.addChild(page);
      legendPages.push(page);
    }
    S.hud.addChild(legend);
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);
  cam.cut(G.cx, G.cy - G.R * 0.6, 1.8);

  /* ---------------------------------------------------------------- estado */
  let tAll = 0, tHold = 0, silent = false, didCrown = false;
  let lastHum = -1, dropTicks = 0, crankN = -1, clatterAt = -9, beat = -1, lastSaid = -99;
  /** El último travesaño de la canaleta que sonó, y cuándo. */
  let slatN = -1, slatAt = -9;
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
    // Mientras frena el bombo, la banda se calla del todo y vuelve en el uno
    // con la compuerta: antes seguía sonando debajo del "Se frena…", y el
    // único silencio era el medio segundo de la compuerta.
    once("calla", tAll >= T_S3 - 0.1, () => {
      if (!silent) musicHold(true);
    });
    once("door", tAll >= T_STOP, () => {
      musicHold(false);
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
      // Responde al "¿Cae o no cae?", que seguía en pantalla con la bola ya en el vaso.
      sayNow(t("cTomIn"), 0.97);
      if (!silent) {
        // Más baja que el revelado, para que el cartel sea el golpe más fuerte:
        // con el seno a 0,1 la caída sonaba igual de fuerte que el ganador.
        beep(note(0), 0.3, "triangle", 0.07);
        setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
        setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
        cam.punch(0.1).shake(12 * G.k);
      }
    });
    S.breath(tAll, tCrown);
    if (tAll >= tCrown) crowned();
    if (tAll > tOut + 1 && tAll < tLip && tAll - lastSaid > 2.2) sayNow(t("cTomRoll"), 0.55);
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
        // Sube con la velocidad: la última vuelta se oye más rápida.
        beepFor(note(2 + Math.round(w * 3)), 0.36, "sawtooth", 0.022 + 0.016 * w);
      }
    }
    if (hits > 3 && tAll - clatterAt > 0.125 && tAll < T_STOP) {
      clatterAt = tAll;
      beep(note(12 + (hits % 4)), 0.035, "triangle", 0.022);
    }
    hits = 0;
    if (tAll >= tLip - 0.4 && tAll < tLand) {
      // El latido del borde, en triángulo y cada vez más fuerte y seguido: el
      // seno de 131 Hz que había no sale por el parlante de un proyector.
      const b = Math.floor((tAll - (tLip - 0.4)) / 0.3);
      if (b !== beat) {
        beat = b;
        beep(note(0), 0.12, "triangle", 0.06 + 0.006 * b);
        beep(note(5), 0.08, "triangle", 0.035);
      }
    }
    const roll = rollAt(tAll);
    const seg = along(G.path, roll).seg;
    once(`seg${seg}`, tAll > tOut && tAll < tLip, () => beep(note(12 - seg * 2), 0.09, "triangle", 0.045));
    // La bola traquetea en cada travesaño de la canaleta y se frena con ella:
    // antes bajaba tres segundos y medio sin un solo sonido propio.
    if (tAll > tOut && tAll < tLip) {
      const slat = Math.floor((roll * pathLens(G.path).total) / (34 * G.k));
      if (slat !== slatN && tAll - slatAt >= 0.05) {
        if (slatN >= 0) beep(note(slat % 2 ? 13 : 14), 0.035, "triangle", 0.028);
        slatN = slat;
        slatAt = tAll;
      }
    }
  }

  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    S.say(T[lang].cWin(winnersLabel(names, winners), winners.length > 1), 1);
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

  /** Lo que mide la canaleta, y dónde cae cada curva. */
  function pathLens(path: { x: number; y: number }[]): { total: number; at: number[] } {
    const at = [0];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as { x: number; y: number }, b = path[i] as { x: number; y: number };
      at.push((at[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return { total: at[at.length - 1] as number, at };
  }

  /** Dónde va la bola ganadora afuera, de qué tamaño, cuánto giró y cuánto se aplasta. */
  function winnerOut(): { x: number; y: number; r: number; rot: number; squash: number } {
    const { cx, cy, R, path, cup, k } = G;
    const r0 = rb * R;
    if (tAll < tOut) {
      const q = ease.inOutCubic((tAll - tOutStart) / (tOut - tOutStart));
      const sx = rivalBall ? cx + winBall.x * R : cx + Math.cos(EXIT) * (1 - rb * 1.2) * R;
      const sy = rivalBall ? cy + winBall.y * R : cy + Math.sin(EXIT) * (1 - rb * 1.2) * R;
      return { x: sx + ((path[0] as { x: number }).x - sx) * q, y: sy + ((path[0] as { y: number }).y - sy) * q, r: r0, rot: winBall.rot, squash: 0 };
    }
    const f = rollAt(tAll);
    const p = along(path, f);
    const wob = tAll > tLip && tAll < tLand ? Math.sin((tAll - tLip) * 30) * 5 * k : 0;
    const r = r0 + (Math.max(r0, 34 * k) - r0) * ease.outCubic(clamp((tAll - tOut) / 1.2, 0, 1));
    // Rueda: gira lo que avanza dividido por su radio, como una bola de verdad.
    const lens = pathLens(path);
    const sDone = f * lens.total;
    let rot = winBall.rot + sDone / Math.max(r, 1);
    // En cada curva pega un saltito, más chico cada vez.
    let hop = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const d = sDone - (lens.at[i] as number);
      const H = r * 3;
      if (d >= 0 && d < H) hop = Math.max(hop, Math.sin((Math.PI * d) / H) * r * (0.55 - 0.15 * i));
    }
    let x = p.x + wob;
    let y = p.y - r - 8 * k - hop;
    let squash = 0;
    if (tAll >= tLand) {
      const q2 = clamp((tAll - tLand) / 0.25, 0, 1);
      x += (cup.x - x) * ease.inOutCubic(q2);
      y += (cup.y + 22 * k - r * 0.4 - y) * ease.inOutCubic(q2);
      // Cae al vaso y rebota dos veces, cada vez más bajo, y se aplasta al tocar.
      const b = tAll - tLand - 0.25;
      if (b > 0) {
        const bounce = Math.abs(Math.sin(b * 11)) * r * 0.45 * Math.exp(-b * 4.5);
        y -= bounce;
        squash = Math.max(0, 1 - Math.abs(Math.sin(b * 11)) * 6) * Math.exp(-b * 4.5) * 0.18;
        rot += Math.exp(-b * 3) * 0.4 * Math.sin(b * 11);
      }
    }
    return { x, y, r, rot, squash };
  }

  /** La cámara: la boca al llenar, el bombo al girar, la compuerta, la bola, el vaso. */
  function direct(): void {
    const { cx, cy, R, door: dp, cup, vertical } = G;
    const midX = S.sw() / 2;
    if (tAll < T_FILL) {
      const p = tAll / T_FILL;
      cam.lookAt(cx + (midX - cx) * p * 0.2, cy - R * 0.6 * (1 - p), 1.8 - 0.55 * p, 3);
    } else if (tAll < T_S3) {
      const w = omega(tAll);
      // La última vuelta se nota: la cámara se sigue acercando y tiembla con
      // el bombo. Antes las tres vueltas eran trece segundos del mismo encuadre.
      const z = 1.2 + 0.12 * w + (tAll > T_S2 ? (0.15 * (tAll - T_S2)) / (T_S3 - T_S2) : 0);
      if (tAll > T_S2) cam.shake(2 * w * G.k);
      let tx = cx + (midX - cx) * 0.25;
      if (vertical && legendTop > 0) {
        // En un celular, el bombo sube a la mitad de arriba, y se achica si no entra.
        const ys = (S.top() + legendTop) / 2;
        const zz = Math.max(0.6, Math.min(z, ((legendTop - S.top()) / 2 - 10 * G.k) / R));
        cam.lookAt(cx, cy - (ys - S.sh() / 2) / zz, zz, 2);
      } else {
        // Con la leyenda a la derecha, el bombo se corre a la izquierda para no pisarla.
        if (legendX0 > 0) tx = Math.max(tx, cx + (S.sw() / 2 + R * z - legendX0 + 26 * G.k) / z);
        cam.lookAt(tx, cy, z, 2);
      }
    } else if (tAll < tOutStart) {
      cam.lookAt(dp.x, dp.y, vertical ? 2 : 2.3, tAll < T_STOP ? 2 : 4);
    } else if (tAll < tLip) {
      const o = winnerOut();
      // Se acerca a la bola mientras baja, y llega al borde ya encima.
      const near = 0.4 * clamp((tAll - tOut) / (tLip - tOut), 0, 1);
      cam.lookAt(o.x + (vertical ? 0 : 60 * G.k), o.y, (vertical ? 1.5 : 1.7) + near, 3.5);
    } else if (tAll < tCrown) {
      cam.lookAt(cup.x, cup.y - 20 * G.k, vertical ? 2 : 2.4, 4);
    } else {
      // La corona queda en el vaso, sin desenfoque y con la bola debajo del
      // cartel: abrirse a toda la escena era un tirón de 2,4 a 1 que la dejaba
      // borrosa y la bola ganadora chica en una esquina.
      cam.noBlur();
      cam.lookAt(cup.x - (vertical ? 0 : 120 * G.k), cup.y - (S.sh() * 0.18) / 1.5, 1.5, 2);
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
      shineOf(v);
    }
    bars.rotation = ang;
    // La compuerta, que gira con el bombo y se abre al pararse.
    const da = doorStart + ang;
    const open = clamp((tAll - T_STOP) / 0.3, 0, 1);
    const span = 0.2;
    // Cada arco arranca con su moveTo: sin él, PixiJS lo une con una línea desde el centro.
    const d0x = Math.cos(da - span) * R, d0y = Math.sin(da - span) * R;
    door.clear().moveTo(d0x, d0y).arc(0, 0, R, da - span, da + span).stroke({ width: 14 * k, color: INK });
    door.moveTo(d0x, d0y).arc(0, 0, R, da - span, da + span).stroke({ width: 8 * k, color: open > 0 ? 0x1b1426 : YELLOW });
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
      rivalView.rotation = rivalBall.rot;
      shineOf(rivalView);
    }
    sparkles.clear();
    if (tAll >= tOutStart) {
      const o = winnerOut();
      winView.visible = true;
      winView.scale.set((o.r / bigR) * (1 + o.squash), (o.r / bigR) * (1 - o.squash));
      winView.position.set(o.x, o.y + o.r * o.squash);
      winView.rotation = o.rot;
      shineOf(winView);
      // Las chispitas del vaso: suben desde el borde cuando cae la bola.
      const a = tAll - tLand - 0.25;
      if (a > 0 && a < 1.1) {
        for (let i = 0; i < 10; i++) {
          const h1 = ((i * 7919) % 97) / 97, h2 = ((i * 104729) % 89) / 89;
          const x = G.cup.x + (h1 - 0.5) * 124 * k;
          const y = G.cup.y - (20 + h2 * 70) * k * ease.outCubic(clamp(a / 0.8, 0, 1));
          const sz = (7 + 5 * h2) * k * (1 - a / 1.1);
          if (sz <= 0.5) continue;
          sparkles.poly([x, y - sz, x + sz * 0.3, y - sz * 0.3, x + sz, y, x + sz * 0.3, y + sz * 0.3, x, y + sz, x - sz * 0.3, y + sz * 0.3, x - sz, y, x - sz * 0.3, y - sz * 0.3])
            .fill({ color: i % 3 ? YELLOW : 0xffffff, alpha: 1 - a / 1.1 });
        }
      }
      // En el vaso, el nombre reemplaza al número, y va arriba de la bola: los
      // dos juntos se pisaban y el nombre tapaba el número.
      if (tAll > tOut + 0.3 && tAll < tLand) {
        numChip.visible = true;
        numChip.position.set(o.x + o.r + 10 * k, o.y - o.r - 6 * k);
      }
      if (tAll >= tLand && tAll < tCrown) {
        nameChip.visible = true;
        // Centrado sobre el vaso: corrido a la derecha, en un celular la
        // cámara cerca lo dejaba cortado por el borde.
        nameChip.position.set(G.cup.x - nameChip.width / 2, G.cup.y - 115 * k);
        nameChip.alpha = clamp((tAll - tLand) / 0.2, 0, 1);
      }
    }
    hudCount.text = String(balls.filter((b) => tAll >= b.born).length);
    // La leyenda: desde que terminan de caer las bolas hasta la última vuelta.
    const L0 = T_FILL - 0.3, L1 = T_S3 - 0.2;
    legend.visible = tAll >= L0 && tAll < L1 + 0.4;
    if (legend.visible) {
      legend.alpha = clamp((tAll - L0) / 0.35, 0, 1) * clamp((L1 + 0.4 - tAll) / 0.4, 0, 1);
      const np = legendPages.length;
      const pi = np > 1 ? Math.min(np - 1, Math.floor(((tAll - L0) / (L1 - L0)) * np)) : 0;
      legendPages.forEach((pg, i) => (pg.visible = i === pi));
      legendTitle.text = np > 1 ? `${t("cTomWho")} · ${legendRange[pi] ?? ""} · ${pi + 1}/${np}` : t("cTomWho");
    }
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
    if (tHold >= WINNER_HOLD) {
      if (audit) audit.done = true;
      S.cleanup();
    }
  });
}
