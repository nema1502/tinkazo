import { Container, Graphics } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, type PixiStage } from "./stage";

/**
 * Piñata.
 *
 * La de las posadas y los cumpleaños: una estrella de siete picos colgada en
 * el patio, con papel picado arriba. Cada nombre es un caramelo adentro. Con
 * cada palo caen algunos, y los que caen quedan afuera. Al final la piñata se
 * rompe y el último caramelo, el que se quedó adentro hasta el final, es el
 * que gana, y baja despacio.
 *
 * El palo no decide nada: el orden en que caen los caramelos está sembrado
 * con la ronda, y la ganadora va primera en esa lista. Los arcos:
 *
 * - **susto**: en los últimos palos el caramelo ganador se asoma por la
 *   rajadura y vuelve a entrar.
 * - **remontada**: dos palos al aire antes de los últimos.
 * - **duelo**: quedan dos adentro hasta el golpe final, y cae la rival.
 * - **tapada**: nadie la nombra hasta que se rompe.
 *
 * Desde el 29 de septiembre de 2026 cada palo se siente: una estrella donde
 * pega, papelitos que se desprenden, la piñata que se aplasta y rebota, y la
 * estela del palo. Los caramelos son más grandes, rebotan, ruedan y se apilan
 * en un montoncito que crece (antes quedaban todos en el piso, a una altura
 * al azar), y al romperse la olla se parte en pedazos que salen girando.
 */

const DT = 1 / 120;
const T_HANG = 3.0;
const GRAV = 1500;

type Phase = "hang" | "hits" | "break" | "crown" | "dead";
interface Candy {
  idx: number; inside: boolean; x: number; y: number; vx: number; vy: number; rot: number; spin: number; settled: boolean; out: number; drawn: boolean;
}
interface Swing { at: number; miss: boolean; drop: number[]; done: boolean }

export async function pinataPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
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

  // El orden de caída: primero los del fondo de la lista, al final la rival.
  const rest = names.map((_, i) => i).filter((i) => i !== winnerIdx && i !== rivalIdx);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const fallOrder = [...rest.reverse()];

  // Los palos: al principio caen muchos, al final de a uno. La rival se queda
  // adentro hasta la rotura.
  const nHits = clamp(5 + Math.floor(n / 6), 5, 9);
  const swings: Swing[] = [];
  let tH = T_HANG + 0.5;
  const weights = Array.from({ length: nHits }, (_, i) => Math.pow(nHits - i, 1.6));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  for (let i = 0; i < nHits; i++) {
    if (story.arc === "remontada" && i === nHits - 2) {
      swings.push({ at: tH, miss: true, drop: [], done: false });
      tH += 1.0;
      swings.push({ at: tH, miss: true, drop: [], done: false });
      tH += 1.05;
    }
    const want = i === nHits - 1 ? fallOrder.length - given : Math.round(((weights[i] as number) / wsum) * fallOrder.length);
    const take = Math.max(0, Math.min(fallOrder.length - given, want));
    swings.push({ at: tH, miss: false, drop: fallOrder.slice(given, given + take), done: false });
    given += take;
    tH += clamp(1.7 - i * 0.08, 1.1, 1.7);
  }
  const T_BREAK = tH + (story.arc === "duelo" ? 1.2 : 0.6);
  const T_CROWN = T_BREAK + 2.4;
  setGameLength(T_CROWN, WINNER_HOLD);
  const T_PEEK = swings.filter((s) => !s.miss).at(-2)?.at ?? T_BREAK - 1;

  const candies: Candy[] = names.map((_, i) => ({ idx: i, inside: true, x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, settled: false, out: 0, drawn: false }));
  const winC = candies[winnerIdx] as Candy;
  const rivC = candies[rivalIdx] as Candy;

  let phase: Phase = "hang";
  let tAll = 0, acc = 0, tHold = 0, saidUpTo = -1, lastOutSaid = -9, crackLevel = 0;
  let lastCreak = -9, creaks = 0, fallNote = 0, landed = false;
  let theta = 0.34, omega = 0, peekSaid = false, lastSaid2 = false, crowned = false, brokeDone = false, rivalDropped = false;
  const inside = (): Candy[] => candies.filter((c) => c.inside);
  /** Cuándo pegó el último palo y dónde, para la estrella y los papelitos. */
  const blows: { at: number; x: number; y: number; seed: number }[] = [];
  let lastBlow = -9;
  /** El caramelo que acaba de caer, para ponerle su nombre un rato. */
  let fell = { idx: -1, at: -9 };
  let said2At = -9;
  /** El tamaño de un caramelo: más grandes que antes, que se leían como puntitos. */
  const candySize = (): number => clamp(Math.sqrt(1 / n) * 70 * S.u(), 12 * S.u(), 26 * S.u());
  /**
   * El montón del piso, por columnas: cada caramelo que se queda quieto sube
   * su columna y un poco las de al lado, así se apilan como de verdad.
   */
  const heights = new Map<number, number>();
  const colOf = (x: number): number => Math.floor(x / (candySize() * 2.2));
  const hAt = (col: number): number => heights.get(col) ?? 0;

  /* -------------------------------------------------------------- geometría */
  const G = (): { w: number; h: number; k: number; ax: number; ay: number; L: number; floor: number; R: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const R = Math.min(h * 0.13, w * 0.12);
    return { w, h, k, ax: w / 2, ay: S.top() - 10 * k, L: h * 0.3, floor: h - S.bottom() - 58 * k, R };
  };
  const pinPos = (): { x: number; y: number } => {
    const g = G();
    return { x: g.ax + Math.sin(theta) * g.L, y: g.ay + Math.cos(theta) * g.L };
  };

  /* ---------------------------------------------------------------- física */
  function step(dt: number): void {
    const g = G();
    // La piñata es un péndulo que se amortigua; cada palo le da un empujón.
    const antes = theta;
    omega += (-(9.8 / 1.4) * Math.sin(theta) - 0.9 * omega) * dt;
    theta += omega * dt;
    if (Math.sign(antes) !== Math.sign(theta) && Math.abs(omega) > 0.35 && tAll - lastCreak > 0.3 && !brokeDone) {
      lastCreak = tAll;
      creaks++;
      beep(note([2, 4, 3, 5][creaks % 4] as number), 0.07, "triangle", 0.03);
    }
    const sz = candySize();
    for (const c of candies) {
      if (c.inside || c.settled) continue;
      c.out += dt;
      // El caramelo ganador baja despacio, casi flotando.
      c.vy += GRAV * g.k * dt * (c === winC ? 0.22 : 1);
      if (c === winC) c.vy = Math.min(c.vy, 260 * g.k);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.spin * dt;
      // El piso es el montón: la columna donde cae, sin pasar por encima de sus vecinas.
      const col = colOf(c.x);
      const ground = g.floor - sz * 0.62 - (c === winC ? 0 : hAt(col));
      if (c.y >= ground) {
        c.y = ground;
        if (c.vy > 150 * g.k) {
          // Rebota con lo que le queda, y el golpe lo hace girar.
          c.vy *= -0.42;
          c.vx *= 0.75;
          c.spin = c.vx / Math.max(1, sz) + (hash(c.idx, 9) - 0.5) * 6;
        } else {
          c.vy = 0;
          // En la ladera del montón resbala hacia el lado más bajo.
          const slope = hAt(col - 1) - hAt(col + 1);
          c.vx += slope * 6 * dt * g.k;
          c.vx *= 0.9;
          // Rueda: gira lo que avanza.
          c.spin = c.vx / Math.max(1, sz);
          if (Math.abs(c.vx) < 6 * g.k && Math.abs(slope) < sz * 1.4) {
            c.settled = true;
            if (c !== winC) {
              heights.set(col, hAt(col) + sz * 1.05);
              heights.set(col - 1, Math.max(hAt(col - 1), hAt(col) - sz * 1.2));
              heights.set(col + 1, Math.max(hAt(col + 1), hAt(col) - sz * 1.2));
            }
          }
        }
      }
      if (c.x < 20 * g.k || c.x > g.w - 20 * g.k) {
        c.x = clamp(c.x, 20 * g.k, g.w - 20 * g.k);
        c.vx *= -0.6;
      }
    }
  }

  function drop(ids: number[], strong: boolean): void {
    const p = pinPos();
    const g = G();
    for (const id of ids) {
      const c = candies[id] as Candy;
      if (!c.inside) continue;
      c.inside = false;
      c.x = p.x + (hash(id, 1) - 0.5) * g.R * 0.8;
      c.y = p.y + g.R * 0.5;
      c.vx = (hash(id, 2) - 0.5) * (strong ? 900 : 520) * g.k;
      c.vy = -(120 + hash(id, 4) * 260) * g.k;
      c.spin = (hash(id, 5) - 0.5) * 18;
    }
  }

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
    if (phase === "crown" || phase === "dead") return;
    for (const c of candies) if (c !== winC && c.inside) drop([c.idx], true);
    brokeDone = true;
    rivalDropped = true;
    const g = G();
    winC.inside = false;
    winC.x = g.w / 2;
    winC.y = g.floor;
    winC.settled = true;
    tAll = T_CROWN;
    phase = "crown";
    crown();
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.05, () => {
        S.say(t("cPinHang"), 0.1);
        // Arriba la piñata: tres notas que suben mientras la cuelgan.
        [5, 7, 9].forEach((d, i) => setTimeout(() => beep(note(d), 0.12, "triangle", 0.04), 120 + i * 140));
      }],
      [1.3, () => {
        S.say(T[getLang()].cPinCount(n), 0.15);
        // Los caramelos traquetean adentro.
        for (let i = 0; i < 6; i++) setTimeout(() => beep(note(10 + (i % 3)), 0.04, "square", 0.025), 200 + i * 90);
      }],
      [2.3, () => [9, 12].forEach((d, i) => setTimeout(() => beep(note(d), 0.1, "sine", 0.035), i * 120))],
      [T_HANG + 0.2, () => S.say(t("cPinSong"), 0.35)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    for (const s of swings) {
      if (s.done || tAll < s.at) continue;
      s.done = true;
      const g = G();
      if (s.miss) {
        omega += 0.4;
        beep(note(3), 0.16, "sine", 0.03);
        S.say(t("cPinMiss"), 0.55);
        continue;
      }
      // El golpe: un empujón al péndulo, un ruido seco y lo que caiga.
      omega += (hash(Math.round(s.at * 10), 1) < 0.5 ? -1 : 1) * (1.6 + 0.3 * crackLevel);
      crackLevel++;
      {
        // Donde pega el palo: el lado de la olla que mira hacia abajo a la izquierda.
        const pp = pinPos();
        const bx = g.w * 0.14, by = g.floor + 60 * g.k;
        const dx = bx - pp.x, dy = by - pp.y, d = Math.hypot(dx, dy) || 1;
        blows.push({ at: tAll, x: pp.x + (dx / d) * g.R, y: pp.y + (dy / d) * g.R, seed: crackLevel * 13 });
        lastBlow = tAll;
      }
      beep(note(1 + (crackLevel % 3)), 0.12, "square", 0.06);
      setTimeout(() => beep(note(8 + (crackLevel % 4)), 0.06, "triangle", 0.035), 60);
      cam.punch(0.06).shake(8 * g.k);
      drop(s.drop, crackLevel > nHits - 2);
      if (s.drop.length > 0 && s.drop.length <= 3) fell = { idx: s.drop[0] as number, at: tAll };
      for (let i = 0; i < Math.min(8, s.drop.length); i++) setTimeout(() => beep(note(10 + (i % 5)), 0.03, "triangle", 0.02), 90 + i * 40);
      const left = inside().length;
      if (s.drop.length >= 4 && tAll - lastOutSaid > 1.2) {
        lastOutSaid = tAll;
        S.say(t("cPinRain"), 0.45);
      } else if (s.drop.length > 0 && tAll - lastOutSaid > 1.2) {
        lastOutSaid = tAll;
        S.say(T[getLang()].cPinOut(names[s.drop[0] as number] ?? ""), 0.5 + 0.2 * (1 - left / n));
      }
      if (crackLevel === nHits - 1 && tAll - lastOutSaid > 0.8) {
        lastOutSaid = tAll;
        S.say(t("cPinCrack"), 0.7);
      }
    }
    if (story.arc === "susto" && !peekSaid && tAll >= T_PEEK + 0.35) {
      peekSaid = true;
      S.say(T[getLang()].cPinAlmost(names[winnerIdx] ?? ""), 0.8);
      beep(note(14), 0.1, "square", 0.05);
      setTimeout(() => beep(note(9), 0.12, "sine", 0.04), 110);
    }
    if (!lastSaid2 && inside().length === 2 && n > 2 && tAll >= T_HANG) {
      lastSaid2 = true;
      said2At = tAll;
      if (story.arc !== "tapada") S.say(T[getLang()].cPinLast(names[winnerIdx] ?? "", names[rivalIdx] ?? ""), 0.8);
    }
    if (!brokeDone && tAll >= T_BREAK) {
      brokeDone = true;
      S.say(t("cPinBreak"), 0.95);
      beep(note(0), 0.4, "square", 0.07);
      setTimeout(() => beep(note(12), 0.2, "triangle", 0.05), 80);
      cam.punch(0.12).shake(14 * G().k);
      // La rival cae primero, rápido; la ganadora después, despacio.
      if (rivC !== winC && rivC.inside) {
        drop([rivalIdx], true);
        rivalDropped = true;
      }
    }
    if (brokeDone && !winC.inside && !landed) {
      const want = Math.floor((tAll - T_BREAK - 0.5) / 0.3);
      while (fallNote < want && fallNote < 8) {
        beep(note(14 - fallNote), 0.14, "sine", 0.035);
        fallNote++;
      }
      if (winC.settled || (Math.abs(winC.vy) < 1 && winC.y >= G().floor - 1)) {
        landed = true;
        beep(note(0), 0.25, "triangle", 0.06);
        cam.punch(0.04);
      }
    }
    if (brokeDone && winC.inside && tAll >= T_BREAK + 0.5) {
      const p = pinPos();
      winC.inside = false;
      winC.x = p.x;
      winC.y = p.y + G().R * 0.3;
      winC.vx = 0;
      winC.vy = -140 * G().k;
      winC.spin = 2.5;
    }
  }

  /* ---------------------------------------------------------------- escena */
  let fx!: Graphics;
  let flash!: Graphics;
  let wall!: Graphics;
  let garland!: Graphics;
  let rope!: Graphics;
  let pin!: Container;
  let cracks!: Graphics;
  let pieces!: Graphics;
  let stick!: Graphics;
  let candyG!: Graphics;
  let glow!: Graphics;
  let pile!: Graphics;
  let counter!: ReturnType<PixiStage["text"]>;
  let counterBox!: Graphics;
  let chipLayer!: Container;
  const chipOf = new Map<number, Container>();
  const CONE = [0xe93d9c, 0xff7a1a, 0x00a896, 0x6c4ce0, 0xffc629, 0xe93d9c, 0x00a896];

  function makePinata(R: number): Container {
    const c = new Container();
    const g = new Graphics();
    // Los siete picos, con sus flecos.
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
      const bx = Math.cos(a) * R * 0.78, by = Math.sin(a) * R * 0.78;
      const tx = Math.cos(a) * R * 1.75, ty = Math.sin(a) * R * 1.75;
      const px = -Math.sin(a) * R * 0.34, py = Math.cos(a) * R * 0.34;
      g.poly([bx + px, by + py, tx, ty, bx - px, by - py]).fill(CONE[i] as number).stroke({ width: 3, color: INK, join: "round" });
      for (let f = 0; f < 3; f++) g.rect(tx - 2 + (f - 1) * 4, ty, 3, R * 0.35).fill(CONE[(i + f + 1) % 7] as number);
    }
    // El cuerpo, la olla forrada de papel de china en franjas.
    g.circle(0, 0, R).fill(0xff7a1a).stroke({ width: 3.5, color: INK });
    for (let b = -2; b <= 2; b++) g.rect(-R * 0.95, b * R * 0.38 - R * 0.08, R * 1.9, R * 0.16).fill({ color: b % 2 ? 0xffc629 : 0xe93d9c, alpha: 0.9 });
    g.circle(0, 0, R).stroke({ width: 3.5, color: INK });
    c.addChild(g);
    return c;
  }

  function build(): void {
    const g = G();
    const k = g.k;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    chipOf.clear();
    // El patio: la pared, el piso de baldosas y la luz de la fiesta.
    S.bg.addChild(new Graphics().rect(0, 0, g.w, g.h).fill(S.dark ? 0x2a1d33 : 0xf7d9b5));
    wall = new Graphics();
    const tile = S.dark ? 0x3b2630 : 0xd9895e;
    wall.rect(-g.w, g.floor, g.w * 3, g.h).fill(tile);
    for (let x = -g.w, i = 0; x < g.w * 2; x += 48 * k, i++) wall.rect(x, g.floor, 2 * k, g.h).fill({ color: 0x000000, alpha: 0.15 });
    wall.rect(-g.w, g.floor + 26 * k, g.w * 3, 2 * k).fill({ color: 0x000000, alpha: 0.15 });
    wall.rect(-g.w, g.floor - 3 * k, g.w * 3, 5 * k).fill(INK);
    garland = new Graphics();
    rope = new Graphics();
    pieces = new Graphics();
    candyG = new Graphics();
    pile = new Graphics();
    glow = new Graphics();
    stick = new Graphics();
    pin = makePinata(g.R);
    cracks = new Graphics();
    pin.addChild(cracks);
    fx = new Graphics();
    S.scene.addChild(wall, garland, pile, glow, rope, pin, pieces, candyG, stick, fx);
    flash = new Graphics().rect(0, 0, g.w, g.h).fill(0xffffff);
    flash.alpha = 0;
    // El papel picado: tres guirnaldas de banderitas caladas.
    for (let row = 0; row < 3; row++) {
      const y0 = S.top() + (8 + row * 38) * k;
      const sag = (26 + row * 8) * k;
      const flags = 16;
      for (let i = 0; i < flags; i++) {
        const f = (i + 0.5) / flags;
        const x = -g.w * 0.1 + f * g.w * 1.2;
        const y = y0 + Math.sin(f * Math.PI) * sag;
        const col = CONE[(i + row * 2) % 7] as number;
        const fw = 30 * k, fh = 36 * k;
        garland.rect(x - fw / 2, y, fw, fh).fill(col);
        garland.poly([x - fw / 2, y + fh, x - fw / 4, y + fh - 6 * k, x, y + fh, x + fw / 4, y + fh - 6 * k, x + fw / 2, y + fh]).fill(col);
        // Los calados: un rombo y dos puntos del color de la pared.
        const hole = S.dark ? 0x2a1d33 : 0xf7d9b5;
        garland.poly([x, y + 8 * k, x + 6 * k, y + 16 * k, x, y + 24 * k, x - 6 * k, y + 16 * k]).fill(hole);
        garland.circle(x - 9 * k, y + 28 * k, 2.4 * k).fill(hole).circle(x + 9 * k, y + 28 * k, 2.4 * k).fill(hole);
      }
      const pts: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const f = i / 24;
        pts.push(-g.w * 0.1 + f * g.w * 1.2, y0 + Math.sin(f * Math.PI) * sag);
      }
      garland.poly(pts, false).stroke({ width: 2 * k, color: INK });
    }
    // La interfaz: la cuenta y la lista de los que quedan adentro.
    counterBox = new Graphics();
    counter = S.text("", { fontFamily: MONO, fontSize: 14 * k, fontWeight: "700", fill: S.dark ? CREAM : INK });
    counter.anchor.set(0.5);
    const box = new Container();
    box.addChild(counterBox, counter);
    box.position.set(22 * k, S.top() + 10 * k);
    chipLayer = new Container();
    S.hud.addChild(flash, box, chipLayer);
    heights.clear();
    for (const c of candies) c.drawn = false;
  }
  build();
  const crownUI = S.crown(names, winners);
  S.onResize(build);
  {
    const p = pinPos();
    cam.cut(p.x, p.y, 1.35);
  }

  /** La cámara: la piñata de cerca en los palos, más cerca en la rajadura, la rotura abierta y la ganadora. */
  function direct(): void {
    const g = G();
    const p = pinPos();
    if (phase === "hang") cam.lookAt(p.x, p.y + g.R * 0.6, 1.35 - 0.15 * clamp(tAll / T_HANG, 0, 1), 2);
    else if (phase === "hits") {
      const near = story.arc === "susto" && tAll >= T_PEEK && tAll < T_PEEK + 1.4;
      // Cuando quedan dos adentro, la piñata de cerca: antes la cámara encuadraba
      // el papel picado y dejaba la piñata cortada (lo encontró el agente evaluador).
      const dos = tAll - said2At < 1.4;
      cam.lookAt(p.x, p.y + g.R * (near ? 0.4 : dos ? 0.2 : 0.8), near ? 1.9 : dos ? 1.6 : 1.2 + 0.25 * (crackLevel / nHits), near || dos ? 5 : 2.5);
    } else if (phase === "break") {
      if (!winC.inside) cam.lookAt(winC.x, winC.y - g.R * 0.4, 1.5, 2.2);
      else cam.lookAt(p.x, p.y, 1.1, 2.5);
    } else {
      const z = 1.3;
      cam.lookAt(winC.x, winC.y - (g.h * 0.14) / z, z, 1.6);
    }
  }

  function drawCandy(gr: Graphics, x: number, y: number, s: number, rot: number, col: number, alpha: number): void {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const P = (px: number, py: number): number[] => [x + px * c - py * sn, y + px * sn + py * c];
    gr.poly([...P(-s * 1.05, 0), ...P(-s * 1.6, -s * 0.45), ...P(-s * 1.6, s * 0.45)]).fill({ color: col, alpha });
    gr.poly([...P(s * 1.05, 0), ...P(s * 1.6, -s * 0.45), ...P(s * 1.6, s * 0.45)]).fill({ color: col, alpha });
    gr.ellipse(x, y, s * 1.1, s * 0.72).fill({ color: col, alpha }).stroke({ width: Math.max(1, s * 0.18), color: INK, alpha });
    gr.ellipse(x - s * 0.35 * c, y - s * 0.25, s * 0.28, s * 0.14).fill({ color: 0xffffff, alpha: 0.6 * alpha });
  }

  function draw(now: number): void {
    const g = G();
    const k = g.k;
    const p = pinPos();
    // La cuerda y la piñata, colgando y girando un poco con el balanceo.
    rope.clear().moveTo(g.ax, g.ay - 200 * k).lineTo(p.x, p.y - g.R * 0.9).stroke({ width: 3 * k, color: INK });
    const broken = brokeDone;
    pin.visible = !broken;
    pin.position.set(p.x, p.y);
    pin.rotation = theta * 0.6 + Math.sin(tAll * 1.3) * 0.03;
    const ha = tAll - lastBlow;
    const sq = ha >= 0 && ha < 0.6 ? 0.16 * Math.exp(-ha * 7) * Math.cos(ha * 30) : 0;
    pin.scale.set(1 + sq, 1 - sq);
    // La rajadura crece con los golpes.
    cracks.clear();
    for (let i = 0; i < Math.min(crackLevel, 8); i++) {
      const a = hash(i, 17) * Math.PI * 2;
      let cx = Math.cos(a) * g.R * 0.15, cy = Math.sin(a) * g.R * 0.15;
      cracks.moveTo(cx, cy);
      for (let s = 0; s < 3; s++) {
        cx += Math.cos(a + (hash(i, s) - 0.5) * 1.2) * g.R * 0.28;
        cy += Math.sin(a + (hash(i, s) - 0.5) * 1.2) * g.R * 0.28;
        cracks.lineTo(cx, cy);
      }
    }
    cracks.stroke({ width: 2.5, color: INK });
    // Cuando se rompe, los siete picos salen volando.
    pieces.clear();
    if (broken) {
      const age = tAll - T_BREAK;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
        const d = age * 520 * k;
        const x = p.x + Math.cos(a) * (g.R + d), y = p.y + Math.sin(a) * (g.R + d) + 0.5 * GRAV * k * age * age * 0.6;
        const r = a + age * (4 + i);
        const s = g.R * 0.5;
        const c = Math.cos(r), sn = Math.sin(r);
        pieces.poly([x - s * 0.4 * sn, y + s * 0.4 * c, x + s * c, y + s * sn, x + s * 0.4 * sn, y - s * 0.4 * c]).fill(CONE[i] as number).stroke({ width: 2 * k, color: INK });
      }
    }
    if (broken) {
      // La olla se parte en ocho pedazos, con su franja, que salen girando.
      const age = tAll - T_BREAK;
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2, am = (a0 + a1) / 2;
        const v = (260 + hash(i, 61) * 260) * k;
        const x = p.x + Math.cos(am) * (g.R * 0.4 + v * age), y = p.y + Math.sin(am) * (g.R * 0.4 + v * age) - 180 * k * age + 0.5 * GRAV * k * age * age * 0.7;
        const rot = age * (5 + hash(i, 62) * 6) * (i % 2 ? 1 : -1);
        const c = Math.cos(rot), sn = Math.sin(rot);
        const pts: number[] = [];
        const P = (px: number, py: number): void => {
          pts.push(x + px * c - py * sn, y + px * sn + py * c);
        };
        P(-Math.cos(am) * g.R * 0.4, -Math.sin(am) * g.R * 0.4);
        for (let j = 0; j <= 4; j++) {
          const a = a0 + ((a1 - a0) * j) / 4;
          P(Math.cos(a) * g.R - Math.cos(am) * g.R * 0.4, Math.sin(a) * g.R - Math.sin(am) * g.R * 0.4);
        }
        if (y < g.h + g.R) pieces.poly(pts).fill(i % 2 ? 0xff7a1a : 0xe93d9c).stroke({ width: 2.5 * k, color: INK, join: "round" });
      }
    }
    if (broken && tAll - T_BREAK < 2.2) {
      const age = tAll - T_BREAK;
      for (let i = 0; i < 60; i++) {
        const a = hash(i, 51) * Math.PI * 2, v = (180 + hash(i, 52) * 420) * k;
        const x = p.x + Math.cos(a) * v * age, y = p.y + Math.sin(a) * v * age + 0.5 * GRAV * 0.35 * k * age * age;
        const r = hash(i, 53) * 6 + age * (3 + hash(i, 54) * 6);
        const w = 12 * k, h = Math.max(1.5, 5 * k * Math.abs(Math.cos(r)));
        pieces.rect(x - w / 2, y - h / 2, w, h).fill({ color: CONE[i % 7] as number, alpha: 1 - age / 2.2 });
      }
    }
    // El palo: lo sostiene un chico con los ojos vendados, como se juega, y
    // entra en arco en cada golpe. Antes el palo flotaba solo.
    stick.clear();
    const kx = g.w * 0.14, ky = g.floor + 24 * k;
    {
      const kid = S.color(3);
      stick.rect(kx - 20 * k, ky - 44 * k, 11 * k, 44 * k).fill(0x2b2d42).rect(kx - 6 * k, ky - 44 * k, 11 * k, 44 * k).fill(0x2b2d42)
        .roundRect(kx - 22 * k, ky - 5 * k, 15 * k, 7 * k, 3 * k).fill(INK).roundRect(kx - 8 * k, ky - 5 * k, 15 * k, 7 * k, 3 * k).fill(INK)
        .roundRect(kx - 24 * k, ky - 92 * k, 34 * k, 52 * k, 9 * k).fill(kid).stroke({ width: 2.5 * k, color: INK })
        .circle(kx - 7 * k, ky - 108 * k, 17 * k).fill(0xc68a5c).stroke({ width: 2.5 * k, color: INK })
        .poly([kx - 24 * k, ky - 112 * k, kx + 10 * k, ky - 116 * k, kx + 10 * k, ky - 104 * k, kx - 24 * k, ky - 100 * k]).fill(0xd7263d)
        .poly([kx - 24 * k, ky - 108 * k, kx - 36 * k, ky - 116 * k, kx - 34 * k, ky - 102 * k]).fill(0xd7263d)
        .circle(kx - 7 * k, ky - 124 * k, 13 * k).fill(0x2b1d14);
    }
    const sw = swings.find((s) => tAll >= s.at - 0.25 && tAll < s.at + 0.15);
    if (!broken) {
      const f = sw ? clamp((tAll - (sw.at - 0.25)) / 0.4, 0, 1) : 0;
      const bx = kx + 20 * k, by = ky - 66 * k;
      const aim = Math.atan2(p.y - by, p.x - bx) + (sw?.miss ? 0.5 : 0);
      const a = aim - 1.1 + 1.1 * ease.outCubic(f);
      // En reposo el palo es corto, en alto; en el golpe se estira hasta la
      // piñata. Con el largo entero todo el tiempo era una vara que salía de
      // la pantalla.
      const full = Math.hypot(p.x - bx, p.y - by) * 0.98, rest = 120 * k;
      const reach = (x: number): number => rest + (full - rest) * ease.outCubic(x);
      const len = reach(f);
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      // La estela: dos palos fantasma un poco atrás en el arco, solo al pegar.
      for (let gh = 2; gh >= 1 && sw; gh--) {
        const fg = clamp(f - gh * 0.12, 0, 1);
        const ag = aim - 1.1 + 1.1 * ease.outCubic(fg);
        stick.moveTo(bx, by).lineTo(bx + Math.cos(ag) * reach(fg), by + Math.sin(ag) * reach(fg)).stroke({ width: 10 * k, color: 0xffffff, alpha: 0.12 * (3 - gh), cap: "round" });
      }
      stick.moveTo(bx, by).lineTo(ex, ey).stroke({ width: 10 * k, color: 0x7a5230, cap: "round" });
      for (let r = 0.2; r < 0.9; r += 0.14) stick.circle(bx + (ex - bx) * r, by + (ey - by) * r, 5.5 * k).fill(CONE[Math.round(r * 10) % 7] as number);
    } else {
      // Rota la piñata, el chico se queda con el palo en alto: antes se
      // esfumaba en el mismo cuadro del golpe.
      const bx = kx + 20 * k, by = ky - 66 * k, a = -1.25, len = 120 * k;
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      stick.moveTo(bx, by).lineTo(ex, ey).stroke({ width: 10 * k, color: 0x7a5230, cap: "round" });
      for (let r = 0.2; r < 0.9; r += 0.14) stick.circle(bx + (ex - bx) * r, by + (ey - by) * r, 5.5 * k).fill(CONE[Math.round(r * 10) % 7] as number);
    }
    // El golpe: la estrella donde pega y los papelitos que se desprenden.
    fx.clear();
    for (const b of blows) {
      const a = tAll - b.at;
      if (a < 0 || a > 0.9) continue;
      if (a < 0.2) {
        const sc = a < 0.05 ? ease.outBack(a / 0.05) : 1 - ease.inOutCubic((a - 0.05) / 0.15);
        const R0 = g.R * 0.55 * sc;
        if (R0 > 0.5) {
          const star: number[] = [];
          for (let i = 0; i < 16; i++) {
            const ang = hash(b.seed, 3) * Math.PI + (i / 16) * Math.PI * 2;
            const rr = i % 2 ? R0 * 0.42 : R0 * (0.85 + 0.3 * hash(b.seed, i));
            star.push(b.x + Math.cos(ang) * rr, b.y + Math.sin(ang) * rr);
          }
          fx.poly(star).fill(YELLOW).stroke({ width: 2.5 * k, color: INK, join: "round" });
          fx.circle(b.x, b.y, R0 * 0.24).fill(0xffffff);
        }
      }
      for (let i = 0; i < 12; i++) {
        const ang = -Math.PI * 0.2 - hash(b.seed, i + 20) * Math.PI * 1.1;
        const v = (160 + hash(b.seed, i + 40) * 280) * k;
        const x = b.x + Math.cos(ang) * v * a, y = b.y + Math.sin(ang) * v * a + 0.5 * GRAV * 0.45 * k * a * a;
        const r = hash(b.seed, i + 60) * 6 + a * (6 + hash(b.seed, i) * 8);
        const w = 10 * k, h = Math.max(1.5, 6 * k * Math.abs(Math.cos(r)));
        fx.rect(x - w / 2, y - h / 2, w, h).fill({ color: CONE[i % 7] as number, alpha: 1 - a / 0.9 });
      }
    }
    // Al romperse, un destello de pantalla.
    const fa = tAll - T_BREAK;
    flash.alpha = broken && fa >= 0 && fa < 0.18 ? 0.35 * (1 - fa / 0.18) : 0;
    // Los caramelos: los de afuera, cada uno con su color.
    candyG.clear();
    glow.clear();
    const sz = candySize();
    for (const c of candies) {
      if (c.inside || c === winC) continue;
      // Los que ya quedaron quietos se dibujan una vez, en la capa del piso.
      if (c.settled) {
        if (!c.drawn) {
          c.drawn = true;
          drawCandy(pile, c.x, c.y, sz, c.rot, S.color(c.idx), 0.8);
        }
        continue;
      }
      drawCandy(candyG, c.x, c.y, sz, c.rot, S.color(c.idx), 1);
    }
    // El caramelo del susto se asoma por la rajadura y vuelve a entrar.
    if (story.arc === "susto" && winC.inside && tAll >= T_PEEK && tAll < T_PEEK + 1.2) {
      const f = Math.sin(Math.PI * ((tAll - T_PEEK) / 1.2));
      drawCandy(candyG, p.x + g.R * 0.2, p.y + g.R * (0.7 + 0.5 * f), sz * 1.4, 0.3 * Math.sin(now * 12), S.color(winnerIdx), 1);
    }
    if (!winC.inside) {
      const big = sz * (1.8 + (phase === "crown" ? 0.6 * ease.outBack(clamp((tAll - T_CROWN) * 2, 0, 1)) : 0));
      glow.circle(winC.x, winC.y, big * 2.4).fill({ color: YELLOW, alpha: 0.28 }).circle(winC.x, winC.y, big * 1.6).fill({ color: YELLOW, alpha: 0.3 });
      drawCandy(candyG, winC.x, winC.y, big, winC.rot, S.color(winnerIdx), 1);
    }
    // El nombre del caramelo que acaba de caer, un rato, al lado del caramelo.
    for (const ch of chipOf.values()) ch.visible = false;
    const cf = candies[fell.idx];
    if (cf && !cf.inside && tAll - fell.at < 1.2 && cf !== winC) {
      let ch = chipOf.get(-1 - cf.idx);
      if (!ch) {
        ch = S.chip(names[cf.idx] ?? "");
        chipOf.set(-1 - cf.idx, ch);
        chipLayer.addChild(ch);
      }
      const q = cam.toScreen(cf.x + sz * 1.8, cf.y - sz * 1.4, g.w, g.h);
      ch.visible = true;
      ch.position.set(Math.min(q.x, g.w - ch.width - 10 * k), q.y);
    }
    // La lista de los que quedan adentro, cuando son pocos.
    const adentro = inside();
    if (adentro.length <= 6 && adentro.length > 0 && phase !== "crown" && story.arc !== "tapada") {
      const pts = cam.toScreen(p.x + g.R * 2.1, p.y - g.R, g.w, g.h);
      adentro.forEach((c, i) => {
        let ch = chipOf.get(c.idx);
        if (!ch) {
          ch = S.chip(names[c.idx] ?? "");
          chipOf.set(c.idx, ch);
          chipLayer.addChild(ch);
        }
        ch.visible = true;
        ch.position.set(Math.min(pts.x, g.w - ch.width - 10 * k), pts.y + i * 26 * k);
      });
    }
    counter.text = `${t("cPinLeft")}  ${adentro.length} / ${n}`;
    const bw = counter.width + 40 * k, bh = 40 * k;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
    if (phase === "crown") crownUI.at(tAll - T_CROWN);
  }

  S.run((dt, now) => {
    tAll += dt;
    phase = tAll < T_HANG ? "hang" : tAll < T_BREAK ? "hits" : tAll < T_CROWN ? "break" : "crown";
    script();
    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;
    if (phase === "crown") {
      if (!rivalDropped && rivC !== winC && rivC.inside) drop([rivalIdx], true);
      rivalDropped = true;
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
