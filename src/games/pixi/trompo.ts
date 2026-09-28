import { Container, Graphics } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Trompo.
 *
 * El juego de patio de media Latinoamérica: un círculo de tiza en el suelo,
 * cada participante tira su trompo adentro y bailan. Después empiezan los
 * choques, los trompos se sacan del ruedo o se quedan sin cuerda y se caen,
 * hasta que quedan dos en un mano a mano. Gana el último que sigue bailando.
 *
 * Nada de esto decide nada: el orden en que salen está sembrado con la ronda
 * y la ganadora va primera en esa lista, así que nunca la sacan. La rival del
 * director de emoción es la que llega al mano a mano, la que la sala cree que
 * gana. Los arcos se ven así:
 *
 * - **susto**: en el mano a mano el trompo ganador cabecea, casi se cae y se
 *   endereza.
 * - **remontada**: a mitad de los choques la sacan hasta el borde de la tiza y
 *   vuelve.
 * - **duelo**: un choque más en el mano a mano.
 * - **tapada**: baila callada contra el borde y la cámara nunca la busca.
 *
 * Las posiciones viven en el disco unidad del ruedo, así que cambiar el
 * tamaño de la pantalla no cambia la física. El suelo se ve en perspectiva:
 * el ruedo es una elipse.
 */

const DT = 1 / 120;
const T_THROW = 2.2;
const T_FIGHT = 4.6;
const SQUASH = 0.55;

type Phase = "throw" | "dance" | "fight" | "duel" | "crown" | "dead";
interface Top {
  idx: number;
  x: number; y: number; vx: number; vy: number;
  ph: number; rate: number; wob: number; wobPh: number; tilt: number;
  land: number; alive: boolean; out: number; kind: "fall" | "kick"; fallDir: number;
  view?: Container; glint?: Graphics; marks?: Graphics; chip?: Container;
}
interface Hit { at: number; victim: number; hitter: number; kind: "fall" | "kick"; done: boolean }

function lighten(c: number, f: number): number {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number): number => Math.round(v + (255 - v) * f);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

export async function trompoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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

  // El orden de salida: la ganadora primera, la rival segunda, el resto sembrado.
  const rest = names.map((_, i) => i).filter((i) => i !== winnerIdx && i !== rivalIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const rank = n >= 2 ? [winnerIdx, rivalIdx, ...rest] : [winnerIdx];
  const fightDur = clamp(2.6 + Math.max(0, n - 2) * 0.32, 2.6, 7.8);
  const T_DUEL = T_FIGHT + fightDur;
  const clashes = story.arc === "duelo" ? [0.7, 1.7, 2.7, 3.7] : [0.8, 1.9, 3.0];
  const duelDur = (clashes.at(-1) as number) + 1.6;
  const T_CROWN = T_DUEL + duelDur;
  setGameLength(T_CROWN, WINNER_HOLD);

  // Los trompos, tirados desde el borde de abajo hacia adentro del ruedo.
  const rn = clamp(Math.sqrt(0.3 / Math.max(2, n)), 0.035, 0.13);
  const tops: Top[] = names.map((_, i) => {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.72;
    return {
      idx: i, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0,
      ph: rng() * 7, rate: 18 + rng() * 8, wob: 0.03 + rng() * 0.03, wobPh: rng() * 7, tilt: 0,
      land: 0.2 + (i / Math.max(1, n)) * (T_THROW - 0.6), alive: true, out: -1, kind: "fall", fallDir: rng() < 0.5 ? -1 : 1,
    };
  });
  const byIdx = new Map(tops.map((q) => [q.idx, q]));
  const win = byIdx.get(winnerIdx) as Top;
  const riv = byIdx.get(rivalIdx) as Top;
  if (story.arc === "tapada") {
    win.x = 0.74;
    win.y = 0.2;
  }

  // Los choques, sembrados: primero salen muchos, al final de a uno.
  const hits: Hit[] = [];
  const victims = rank.slice(2).reverse();
  victims.forEach((v, i) => {
    const f = (i + 1) / (victims.length + 1);
    hits.push({ at: T_FIGHT + 0.3 + (fightDur - 0.7) * Math.pow(f, 0.8), victim: v, hitter: -1, kind: hash(v, 11) < 0.55 ? "kick" : "fall", done: false });
  });
  const T_EDGE = T_FIGHT + fightDur * 0.45;

  let phase: Phase = "throw";
  let tAll = 0, acc = 0, tHold = 0, landed = 0, saidUpTo = -1, clashDone = 0, lastTick = -9, lastOutSaid = -9;
  let edgeDone = false, wobbleSaid = false, recoverSaid = false, fewSaid = false, crowned = false;
  const sparks: { x: number; y: number; at: number; seed: number }[] = [];
  const pendingClash: number[] = [];
  const alive = (): Top[] => tops.filter((q) => q.alive);

  /* ---------------------------------------------------------------- física */
  function step(dt: number): void {
    const list = alive();
    for (const q of list) {
      if (tAll < q.land) continue;
      // Deambula con un seno propio, y un poco hacia el centro.
      q.vx += (Math.sin(tAll * 1.3 + q.wobPh) * 0.5 - q.x * 0.35) * dt;
      q.vy += (Math.cos(tAll * 1.1 + q.ph) * 0.5 - q.y * 0.35) * dt;
      // En el mano a mano los dos se buscan: dan vueltas cerca uno del otro.
      if (phase === "duel" && (q === win || q === riv)) {
        const o = q === win ? riv : win;
        const dx = o.x - q.x, dy = o.y - q.y, d = Math.hypot(dx, dy) || 1;
        if (d > rn * 3) {
          q.vx += (dx / d) * 0.9 * dt;
          q.vy += (dy / d) * 0.9 * dt;
        }
      }
      if (story.arc === "tapada" && q === win && phase !== "duel") {
        q.vx += (0.74 - q.x) * 1.2 * dt;
        q.vy += (0.2 - q.y) * 1.2 * dt;
      }
      q.vx *= 0.975;
      q.vy *= 0.975;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    // Los choques de verdad entre vecinos: se empujan y suena un toque.
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Top;
      if (tAll < p.land) continue;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j] as Top;
        if (tAll < q.land) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        const min = rn * 2;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        p.x -= ux * push; p.y -= uy * push;
        q.x += ux * push; q.y += uy * push;
        const rel = (q.vx - p.vx) * ux + (q.vy - p.vy) * uy;
        if (rel < 0) {
          p.vx += ux * rel * 0.8; p.vy += uy * rel * 0.8;
          q.vx -= ux * rel * 0.8; q.vy -= uy * rel * 0.8;
          if (tAll - lastTick > 0.35 && -rel > 0.12) {
            lastTick = tAll;
            beep(note(8 + (i % 4)), 0.04, "square", 0.02);
          }
        }
      }
    }
    // La tiza: nadie sale sin que lo saquen.
    for (const q of list) {
      const d = Math.hypot(q.x, q.y);
      const lim = (q === win && story.arc === "remontada" ? 0.97 : 0.9) - rn;
      if (d > lim) {
        q.x *= lim / d;
        q.y *= lim / d;
        q.vx *= -0.5;
        q.vy *= -0.5;
      }
    }
    // Los que salieron: la patada los lleva afuera, la caída los deja ahí.
    for (const q of tops) {
      if (q.alive) continue;
      q.out += dt;
      if (q.kind === "kick") {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vx *= 0.955;
        q.vy *= 0.955;
      }
    }
  }

  function knockOut(h: Hit): void {
    const v = byIdx.get(h.victim) as Top;
    if (!v.alive) return;
    v.alive = false;
    v.out = 0;
    v.kind = h.kind;
    const hitter = alive().filter((q) => tAll >= q.land).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
    if (h.kind === "kick" && hitter) {
      const dx = v.x - hitter.x, dy = v.y - hitter.y;
      const d = Math.hypot(dx, dy) || 1;
      v.vx = (dx / d) * 1.9;
      v.vy = (dy / d) * 1.9;
      hitter.vx -= (dx / d) * 0.4;
      hitter.vy -= (dy / d) * 0.4;
      sparks.push({ x: (v.x + hitter.x) / 2, y: (v.y + hitter.y) / 2, at: tAll, seed: h.victim });
      beep(note(12 + (h.victim % 3)), 0.07, "square", 0.05);
      setTimeout(() => beep(note(5), 0.12, "triangle", 0.035), 70);
      cam.punch(0.04).shake(6 * S.u());
    } else {
      v.kind = "fall";
      beep(note(2 + (h.victim % 3)), 0.18, "sine", 0.05);
      cam.punch(0.02);
    }
    const left = alive().length;
    if (tAll - lastOutSaid > 1.2 && (left <= 8 || hits.length <= 12)) {
      lastOutSaid = tAll;
      S.say(T[getLang()].cTroOut(names[v.idx] ?? ""), 0.45 + 0.2 * (1 - left / n));
    }
  }

  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    cam.punch(0.1).shake(12 * S.u());
  }
  skipFn = (): void => {
    if (phase === "crown" || phase === "dead") return;
    for (const q of tops) if (q !== win && q.alive) {
      q.alive = false;
      q.out = 2;
      q.kind = "fall";
    }
    tAll = T_CROWN;
    phase = "crown";
    crown();
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.05, () => S.say(t("cTroThrow"), 0.1)],
      [T_THROW - 0.3, () => S.say(T[getLang()].cTroCount(n), 0.2)],
      [T_THROW + 1.0, () => S.say(t("cTroDance"), 0.3)],
      [T_FIGHT, () => S.say(t(n > 2 ? "cTroFight" : "cTroFeint"), 0.45)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    // Los tiros: cada trompo que cae al ruedo suena.
    while (landed < tops.length && tAll >= (tops[landed] as Top).land) {
      if (landed < 24) beep(note(4 + (landed % 5)), 0.05, "triangle", 0.03);
      landed++;
    }
    if (phase === "fight") {
      for (const h of hits) if (!h.done && tAll >= h.at) {
        h.done = true;
        knockOut(h);
      }
      if (!fewSaid && alive().length <= 4 && n > 4) {
        fewSaid = true;
        S.say(t("cTroFew"), 0.6);
      }
      if (story.arc === "remontada" && !edgeDone && tAll >= T_EDGE) {
        edgeDone = true;
        win.vx = Math.cos(win.ph) * 1.6;
        win.vy = Math.sin(win.ph) * 1.6;
        S.say(T[getLang()].cTroEdge(names[winnerIdx] ?? ""), 0.7);
        beep(note(14), 0.1, "square", 0.05);
        cam.shake(8 * S.u());
      }
      // Con dos o tres, amagues: se acercan, se rozan y suena.
      if (n <= 3 && Math.floor((tAll - T_FIGHT) / 1.1) > Math.floor((tAll - T_FIGHT - DT) / 1.1)) {
        const a = win, b = riv;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        a.vx += (dx / d) * 0.5; a.vy += (dy / d) * 0.5;
        b.vx -= (dx / d) * 0.5; b.vy -= (dy / d) * 0.5;
        beep(note(9 + (Math.floor(tAll) % 3)), 0.06, "triangle", 0.035);
      }
    }
    if (phase === "duel") {
      const td = tAll - T_DUEL;
      while (clashDone < clashes.length && td >= (clashes[clashDone] as number) - 0.35) {
        // Se buscan un tercio de segundo antes de chocar.
        const dx = riv.x - win.x, dy = riv.y - win.y, d = Math.hypot(dx, dy) || 1;
        win.vx += (dx / d) * 1.1; win.vy += (dy / d) * 1.1;
        riv.vx -= (dx / d) * 1.1; riv.vy -= (dy / d) * 1.1;
        clashDone++;
        const k = clashDone;
        const at = T_DUEL + (clashes[k - 1] as number);
        pendingClash.push(at);
      }
      while (pendingClash.length && tAll >= (pendingClash[0] as number)) {
        pendingClash.shift();
        sparks.push({ x: (win.x + riv.x) / 2, y: (win.y + riv.y) / 2, at: tAll, seed: clashDone * 7 });
        beep(note(14 + (clashDone % 3)), 0.09, "square", 0.06);
        setTimeout(() => beep(note(7 + (clashDone % 2)), 0.14, "triangle", 0.04), 60);
        cam.punch(0.08).shake(10 * S.u());
        if (clashDone === 1) S.say(t("cTroClash"), 0.75);
      }
      if (story.arc === "susto" && !wobbleSaid && td >= duelDur * 0.5) {
        wobbleSaid = true;
        S.say(T[getLang()].cTroWobble(names[winnerIdx] ?? ""), 0.85);
        beep(note(1), 0.12, "square", 0.05);
      }
      if (story.arc === "susto" && wobbleSaid && !recoverSaid && td >= duelDur * 0.5 + 0.9) {
        recoverSaid = true;
        S.say(t("cTroRecover"), 0.9);
        beep(note(12), 0.12, "triangle", 0.05);
      }
      // Después del último choque la rival se queda sin cuerda y se cae.
      const lastClash = T_DUEL + (clashes.at(-1) as number);
      if (riv.alive && tAll >= lastClash + 1.0) {
        riv.alive = false;
        riv.out = 0;
        riv.kind = "fall";
        beep(note(0), 0.3, "sine", 0.06);
      }
    }
  }
  /* ---------------------------------------------------------------- escena */
  let ground!: Graphics;
  let chalk!: Graphics;
  let shadows!: Graphics;
  let topsLayer!: Container;
  let sparkG!: Graphics;
  let chips!: Container;
  let counter!: ReturnType<PixiStage["text"]>;
  let counterBox!: Graphics;
  let duelText!: ReturnType<PixiStage["text"]>;

  const R = (): number => Math.min(S.sh() * 0.52, S.sw() * 0.34);
  const center = (): { x: number; y: number } => ({ x: S.sw() / 2, y: S.sh() * 0.54 });
  const toWorld = (x: number, y: number): { x: number; y: number } => {
    const c = center(), r = R();
    return { x: c.x + x * r, y: c.y + y * r * SQUASH };
  };

  function makeTop(q: Top): Container {
    const c = new Container();
    const col = S.color(q.idx);
    const body = new Graphics()
      // La púa.
      .poly([-0.07, -0.2, 0.07, -0.2, 0, 0]).fill(0x9aa1ad).stroke({ width: 0.04, color: INK })
      // El cuerpo, cónico, con la mitad derecha en sombra para que tenga volumen.
      .poly([-0.5, -0.92, 0.5, -0.92, 0.16, -0.22, -0.16, -0.22]).fill(col)
      .poly([0.08, -0.92, 0.5, -0.92, 0.16, -0.22, 0.04, -0.22]).fill({ color: 0x000000, alpha: 0.22 })
      .poly([-0.5, -0.92, 0.5, -0.92, 0.16, -0.22, -0.16, -0.22]).stroke({ width: 0.06, color: INK, join: "round" })
      // La franja de la cuerda.
      .poly([-0.42, -0.72, 0.42, -0.72, 0.35, -0.6, -0.35, -0.6]).fill(lighten(col, 0.55))
      // La tapa, que se ve desde arriba.
      .ellipse(0, -0.92, 0.5, 0.17).fill(lighten(col, 0.3)).stroke({ width: 0.06, color: INK })
      // La cabeza.
      .ellipse(0, -1.02, 0.1, 0.08).fill(INK);
    const marks = new Graphics();
    const glint = new Graphics().ellipse(0, 0, 0.09, 0.05).fill({ color: 0xffffff, alpha: 0.85 });
    glint.y = -0.94;
    c.addChild(body, marks, glint);
    q.glint = glint;
    q.marks = marks;
    return c;
  }

  function build(): void {
    const k = S.u();
    const W = S.sw(), H = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    // El patio: tierra apisonada, con piedritas sembradas.
    const earth = S.dark ? 0x3a2a1f : 0xe2c29a;
    S.bg.addChild(new Graphics().rect(0, 0, W, H).fill(earth));
    ground = new Graphics();
    chalk = new Graphics();
    shadows = new Graphics();
    topsLayer = new Container();
    topsLayer.sortableChildren = true;
    sparkG = new Graphics();
    S.scene.addChild(ground, chalk, shadows, topsLayer, sparkG);
    for (const q of tops) {
      q.view?.destroy({ children: true });
      q.view = makeTop(q);
      topsLayer.addChild(q.view);
      q.chip?.destroy({ children: true });
      q.chip = undefined;
    }
    // Las piedritas y la rayuela dibujada con tiza en una esquina.
    const pebble = S.dark ? 0x5b4636 : 0xc9a47a;
    for (let i = 0; i < 90; i++) {
      const px = (hash(i, 1) - 0.1) * W * 1.2, py = (hash(i, 2) - 0.1) * H * 1.2;
      ground.ellipse(px, py, (2 + hash(i, 3) * 4) * k, (1.5 + hash(i, 4) * 2.5) * k).fill({ color: pebble, alpha: 0.7 });
    }
    const chalkCol = S.dark ? 0xf1ece2 : 0xffffff;
    const hx = W * 0.07, hy = H * 0.62, hs = 34 * k;
    const cells: [number, number][] = [[0, 3], [0, 2], [-0.5, 1], [0.5, 1], [0, 0], [-0.5, -1], [0.5, -1], [0, -2]];
    cells.forEach(([cx, cy], i) => {
      ground.rect(hx + cx * hs, hy - cy * hs * 0.6, hs, hs * 0.6).stroke({ width: 2.5 * k, color: chalkCol, alpha: 0.55 });
      const num = S.text(String(i + 1), { fontFamily: MONO, fontSize: 13 * k, fontWeight: "700", fill: chalkCol });
      num.alpha = 0.5;
      num.anchor.set(0.5);
      num.position.set(hx + cx * hs + hs / 2, hy - cy * hs * 0.6 + hs * 0.3);
      S.scene.addChildAt(num, 1);
    });
    // El contador.
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    S.hud.addChild(box);
    chips = new Container();
    S.hud.addChild(chips);
    duelText = S.text("", { fontFamily: MONO, fontSize: 11 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    duelText.anchor.set(1, 1);
    duelText.alpha = 0.6;
    duelText.position.set(W - 22 * k, H - S.bottom() - 18 * k);
    S.hud.addChild(duelText);
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  {
    const c = center();
    cam.cut(c.x, c.y, 1.25);
  }

  /** La cámara: el ruedo al tirar, los choques de cerca, el mano a mano pegado, la ganadora. */
  let focusUntil = -1, focusX = 0, focusY = 0;
  function direct(): void {
    const c = center();
    if (phase === "throw") cam.lookAt(c.x, c.y, 1.25 - 0.2 * ease.inOutCubic(clamp(tAll / T_THROW, 0, 1)), 2);
    else if (phase === "dance") cam.lookAt(c.x + Math.sin(tAll * 0.5) * 12 * S.u(), c.y, 1.08, 1.5, 0.012 * Math.sin(tAll * 0.7));
    else if (phase === "fight") {
      const s = sparks.at(-1);
      if (s && s.at > focusUntil - 0.6 && tAll - s.at < 0.05 && story.arc !== "tapada") {
        const w = toWorld(s.x, s.y);
        focusUntil = tAll + 0.55;
        focusX = w.x;
        focusY = w.y;
      }
      if (story.arc === "remontada" && edgeDone && tAll < T_EDGE + 1.2) {
        const w = toWorld(win.x, win.y);
        cam.lookAt(w.x, w.y, 1.7, 5);
      } else if (tAll < focusUntil) cam.lookAt(focusX, focusY, 1.45, 5);
      else cam.lookAt(c.x, c.y, 1.0 + 0.3 * (1 - alive().length / n), 2);
    } else if (phase === "duel") {
      const a = toWorld(win.x, win.y), b = toWorld(riv.x, riv.y);
      const wob = story.arc === "susto" && wobbleSaid && !recoverSaid;
      if (wob) cam.lookAt(a.x, a.y - 30 * S.u(), 2.4, 4);
      else cam.lookAt((a.x + b.x) / 2, (a.y + b.y) / 2 - 20 * S.u(), 2.0, 3);
    } else {
      const a = toWorld(win.x, win.y);
      const z = 1.5;
      cam.lookAt(a.x, a.y - (S.sh() * 0.12) / z, z, 1.6);
    }
  }

  function draw(now: number): void {
    const k = S.u();
    const c = center(), r = R();
    // La tiza del ruedo, apenas temblada, y la cruz del medio.
    chalk.clear();
    const chalkCol = S.dark ? 0xf1ece2 : 0xffffff;
    const pts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const j = 1 + (hash(i % 64, 5) - 0.5) * 0.02;
      pts.push(c.x + Math.cos(a) * r * 0.9 * j, c.y + Math.sin(a) * r * 0.9 * SQUASH * j);
    }
    // Adentro del ruedo la tierra está barrida: un poco más clara.
    chalk.ellipse(c.x, c.y, r * 0.9, r * 0.9 * SQUASH).fill({ color: 0xffffff, alpha: S.dark ? 0.05 : 0.14 });
    chalk.poly(pts).stroke({ width: 5 * k, color: chalkCol, alpha: 0.85 });
    chalk.moveTo(c.x - 10 * k, c.y - 6 * k).lineTo(c.x + 10 * k, c.y + 6 * k).moveTo(c.x + 10 * k, c.y - 6 * k).lineTo(c.x - 10 * k, c.y + 6 * k).stroke({ width: 3 * k, color: chalkCol, alpha: 0.6 });

    // Los trompos, ordenados por profundidad: el de más abajo va adelante.
    shadows.clear();
    const size = rn * r * 1.55;
    for (const q of tops) {
      const v = q.view as Container;
      v.zIndex = q.y;
      const w = toWorld(q.x, q.y);
      if (tAll < q.land) {
        // Todavía en el aire: viene desde abajo, en arco.
        const p = clamp(1 - (q.land - tAll) / 0.5, 0, 1);
        v.visible = p > 0;
        v.position.set(w.x, w.y - Math.sin(Math.PI * p) * 90 * k - (1 - p) * 60 * k + (1 - p) * S.sh() * 0.4);
        v.scale.set(size);
        v.rotation = (1 - p) * 4;
        continue;
      }
      v.visible = true;
      const spinning = q.alive || (q.kind === "kick" && q.out < 0.35);
      if (spinning) {
        // El giro sale de la hora del juego, no de los cuadros.
        const ph = q.ph + q.rate * tAll;
        let wob = q.wob;
        if (phase === "duel" && q === riv) wob += 0.05 * clamp((tAll - T_DUEL) / duelDur, 0, 1);
        if (story.arc === "susto" && q === win && wobbleSaid && !recoverSaid) wob = 0.32;
        q.tilt = Math.sin(now * 5 + q.wobPh) * wob;
        v.rotation = q.tilt;
        v.position.set(w.x, w.y);
        (q.glint as Graphics).x = Math.sin(ph) * 0.3;
        const mk = q.marks as Graphics;
        mk.clear();
        if (n <= 40) {
          for (let m = 0; m < 3; m++) {
            const ang = ph + (m * Math.PI * 2) / 3;
            if (Math.cos(ang) < 0) continue;
            const mx = Math.sin(ang) * 0.34;
            mk.rect(mx - 0.025, -0.83, 0.05, 0.2).fill({ color: INK, alpha: 0.55 });
          }
        }
        shadows.ellipse(w.x, w.y + 2 * k, size * 0.42, size * 0.13).fill({ color: 0x000000, alpha: 0.28 });
        // La ganadora, en la coronación: crece un poco y brilla desde abajo.
        if (phase === "crown" && q === win) {
          const g = ease.outBack(clamp((tAll - T_CROWN) * 2, 0, 1));
          shadows.ellipse(w.x, w.y + 2 * k, size * (0.8 + 0.5 * g), size * (0.26 + 0.16 * g)).fill({ color: YELLOW, alpha: 0.35 });
        }
      } else {
        // Caído: acostado sobre un costado, rodando un poco.
        const p = clamp(q.out / 0.5, 0, 1);
        v.rotation = q.fallDir * (1.45 * ease.outCubic(p)) + Math.sin(q.out * 6) * 0.05 * (1 - p);
        v.position.set(w.x, w.y);
        (q.marks as Graphics).clear();
        shadows.ellipse(w.x + q.fallDir * size * 0.45, w.y + 2 * k, size * 0.55, size * 0.13).fill({ color: 0x000000, alpha: 0.2 * clamp(1.5 - q.out, 0, 1) });
      }
      v.scale.set(phase === "crown" && q === win ? size * (1 + 0.35 * ease.outBack(clamp((tAll - T_CROWN) * 2, 0, 1))) : size);
      // Los que salieron se apagan en un segundo y medio: si quedaran tirados,
      // en el mano a mano taparían a los dos que importan.
      v.alpha = q.alive ? 1 : clamp(1.5 - q.out, 0, 1);
      if (!q.alive && v.alpha <= 0) v.visible = false;
    }

    // Las chispas de cada choque.
    sparkG.clear();
    for (const s of sparks) {
      const age = tAll - s.at;
      if (age > 0.5 || age < 0) continue;
      const w = toWorld(s.x, s.y);
      for (let i = 0; i < 8; i++) {
        const a = hash(s.seed, i) * Math.PI * 2;
        const d = (20 + hash(s.seed, i + 9) * 40) * k * ease.outCubic(age / 0.5);
        sparkG.circle(w.x + Math.cos(a) * d, w.y - size * 0.3 + Math.sin(a) * d * 0.6, (3.2 - age * 5) * k).fill(i % 2 ? 0xffc629 : 0xffffff);
      }
    }

    // Los nombres, cuando quedan pocos.
    const live = alive();
    for (const q of tops) if (q.chip) q.chip.visible = false;
    if (live.length <= 8 && phase !== "crown") {
      const at = live
        .filter((q) => tAll >= q.land)
        .map((q) => {
          const w = toWorld(q.x, q.y);
          return { q, p: cam.toScreen(w.x + size * 0.35, w.y - size * 1.1, S.sw(), S.sh()) };
        })
        .sort((a, b) => a.p.y - b.p.y);
      let prev = -Infinity;
      for (const { q, p } of at) {
        const chip = (q.chip ??= chips.addChild(S.chip(names[q.idx] ?? "")));
        chip.visible = true;
        const cy = Math.max(p.y, prev + 26 * k);
        prev = cy;
        chip.position.set(Math.min(p.x + 4 * k, S.sw() - chip.width - 10 * k), cy);
      }
    }

    // El contador.
    const inRing = phase === "throw" ? Math.min(landed, n) : live.length;
    counter.text = `${t("cTroLeft")}  ${inRing} / ${n}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    duelText.text = phase === "duel" ? `${t("cTroDuelLbl")} ${Math.min(clashDone, clashes.length)}/${clashes.length}` : "";
    if (phase === "crown") crownUI.at(tAll - T_CROWN);
  }

  let duelSaid = false;
  S.run((dt, now) => {
    tAll += dt;
    phase = tAll < T_THROW ? "throw" : tAll < T_FIGHT ? "dance" : tAll < T_DUEL ? "fight" : tAll < T_CROWN ? "duel" : "crown";
    if (phase === "duel" && !duelSaid) {
      duelSaid = true;
      // Los que quedaban se caen de golpe: con dos no hay choques de más.
      for (const q of tops) if (q.alive && q !== win && q !== riv) {
        q.alive = false;
        q.out = 0;
        q.kind = "fall";
      }
      if (n >= 2) S.say(T[getLang()].cTroDuel(names[winnerIdx] ?? "", names[rivalIdx] ?? ""), 0.7);
    }
    script();
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    if (phase === "crown") {
      if (riv.alive && riv !== win) {
        riv.alive = false;
        riv.out = 0.5;
        riv.kind = "fall";
      }
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
