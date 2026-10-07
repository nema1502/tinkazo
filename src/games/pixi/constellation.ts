import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, mountPixi, type PixiStage } from "./stage";

/**
 * Constelación Stellar, en PixiJS, con el director de cámara.
 *
 * El mismo juego de `constellation.ts`: un pago salta de estrella en estrella
 * (y de rombo en rombo, que son las trustlines) hasta encontrar ruta al
 * ganador, con el roce del susto a mitad de camino y el engaño del último
 * salto, que se apoya en una estrella vecina. El azar se consume en el mismo
 * orden, así que la misma ronda dibuja el mismo cielo y el mismo recorrido.
 * Lo nuevo es la cámara: sigue al paquete desde el primer salto, en los
 * saltos lentos del final queda encima, en el roce y en el engaño pega un
 * golpe, y en la nova se abre para mostrar la constelación entera.
 */

type Phase = "arm" | "hop" | "nova" | "dead";
interface Node { x: number; y: number; kind: "star" | "anchor"; idx: number; r: number; flare: number; seen: number; born: number; g?: Graphics }
interface Hop { from: number; to: number; dur: number; cx: number; cy: number }
const K = 20;
const ARM = 3.0;
function hopDur(i: number): number {
  const p = i / (K - 1);
  if (p < 0.28) return 0.62 - 0.4 * (p / 0.28);
  return 0.22 + 1.95 * Math.pow((p - 0.28) / 0.72, 2.4);
}
const STAR = [
  [1, 0.42], [0.42, 0.42], [0.42, 1], [-0.42, 1], [-0.42, 0.42], [-1, 0.42],
  [-1, -0.42], [-0.42, -0.42], [-0.42, -1], [0.42, -1], [0.42, -0.42], [1, -0.42],
] as const;

export async function constellationPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const W = (): number => S.sw();
  const H = (): number => S.sh();

  const nodes: Node[] = [];
  let WIN_NODE = 0, DECOY = 0;
  let hops: Hop[] = [];
  const story = writeStory(rng, Math.max(2, names.length), winnerIdx % Math.max(2, names.length));
  const casi = story.arc === "susto" && names.length >= 2;
  const CASI = 13;
  S.mark("arco", story.arc);
  // El paisaje, con el azar en el mismo orden que `constellation.ts`.
  const neb = Array.from({ length: 3 }, (_, k) => ({ x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.7, r: 220 + rng() * 160, ph: rng() * 7, col: k % 2 ? "233,61,156" : "108,76,224" }));
  const layer = (n: number, r: number, v: number): { x: number; y: number; r: number; v: number; ph: number }[] =>
    Array.from({ length: n }, () => ({ x: rng(), y: rng(), r, v, ph: rng() * 7 }));
  const back = [...layer(120, 0.6, 2), ...layer(80, 1, 5), ...layer(50, 1.6, 9)];

  {
    const w = W(), h = H(), k = S.u(), n = names.length;
    const x0 = w * 0.08, x1 = w * 0.94, y0 = h * 0.14, y1 = h * 0.84;
    const cols = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / (y1 - y0))));
    const rows = Math.ceil(n / cols);
    const cw = (x1 - x0) / cols, ch = (y1 - y0) / rows;
    const r = clamp(Math.min(cw, ch) * 0.3, 4 * k, 26 * k);
    for (let i = 0; i < n; i++) {
      const cx = i % cols, cy = Math.floor(i / cols);
      nodes.push({ x: x0 + cw * (cx + 0.5) + (rng() - 0.5) * cw * 0.62, y: y0 + ch * (cy + 0.5) + (rng() - 0.5) * ch * 0.62, kind: "star", idx: i, r, flare: 0, seen: 0, born: 0.6 + (i / n) * 1 });
    }
    const anchors = clamp(22 - n * 2, 8, 20);
    const ar = (n <= 6 ? 11 : 7) * k;
    for (let a = 0; a < anchors; a++) {
      for (let tryI = 0; tryI < 8; tryI++) {
        const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
        if (nodes.some((q) => Math.hypot(q.x - x, q.y - y) < 1.4 * r)) continue;
        nodes.push({ x, y, kind: "anchor", idx: -1, r: ar, flare: 0, seen: 0, born: 0.3 + (a / anchors) * 1.5 });
        break;
      }
    }
    WIN_NODE = Math.max(0, nodes.findIndex((q) => q.idx === winnerIdx));
    const win = nodes[WIN_NODE] as Node;
    const near = nodes.map((q, i) => ({ i, d: Math.hypot(q.x - win.x, q.y - win.y) })).filter((q) => q.i !== WIN_NODE && nodes[q.i]?.kind === "star").sort((a, b) => a.d - b.d).slice(0, 4);
    DECOY = near.length ? (near[Math.floor(rng() * near.length)] as { i: number }).i : WIN_NODE;
    const minD = 0.18 * Math.min(w, h);
    const pool = nodes.map((_, i) => i).filter((i) => i !== WIN_NODE);
    let first = pool[0] ?? 0;
    for (const i of pool) if ((nodes[i] as Node).x < (nodes[first] as Node).x) first = i;
    const seq = [first];
    for (let i = 1; i < K; i++) {
      const prev = seq[i - 1] as number;
      let to = -1;
      for (let a = 0; a < 8 && to < 0; a++) {
        const wantStar = rng() < 0.62;
        const cand = pool.filter((j) => {
          const q = nodes[j] as Node;
          return q.seen < 3 && (a > 3 || (q.kind === "star") === wantStar);
        });
        if (!cand.length) break;
        const j = cand[Math.floor(rng() * cand.length)] as number;
        const q = nodes[j] as Node, p = nodes[prev] as Node;
        if (j !== prev && Math.hypot(q.x - p.x, q.y - p.y) > minD) to = j;
      }
      if (to < 0) to = pool[Math.floor(rng() * pool.length)] ?? prev;
      (nodes[to] as Node).seen++;
      seq.push(to);
    }
    seq.push(WIN_NODE);
    hops = seq.slice(1).map((to, i) => {
      const a = nodes[seq[i] as number] as Node, b = nodes[to] as Node, d = nodes[DECOY] as Node;
      const last = i === K - 1;
      const wn = nodes[WIN_NODE] as Node;
      return {
        from: seq[i] as number, to, dur: hopDur(i),
        cx: last ? d.x * 0.86 + b.x * 0.14 : casi && i === CASI ? wn.x * 1.3 - (a.x + b.x) * 0.15 : (a.x + b.x) / 2,
        cy: last ? d.y * 0.86 + b.y * 0.14 : casi && i === CASI ? wn.y * 1.3 - (a.y + b.y) * 0.15 : (a.y + b.y) / 2,
      };
    });
    setGameLength(ARM + hops.reduce((acc, hp) => acc + hp.dur, 0), WINNER_HOLD);
  }

  let phase: Phase = "arm";
  let tPhase = 0, tAll = 0, hopI = 0, hopT = 0, novaK = 0, tHold = 0, bornTicks = 0, barTick = 0;
  let saidCasi = false, saidNarrow = false, saidReady = false, saidBuild = false, saidDecoy = false;
  const trail: { x: number; y: number }[] = [];
  const links: { a: number; b: number; c: number }[] = [];
  const chipLife = new Map<number, number>();
  /** La estrella de cada persona. */
  const starOf = new Map(nodes.map((nd, i) => [nd.idx, i] as const).filter(([idx]) => idx >= 0));

  function packetPos(): { x: number; y: number } {
    const hp = hops[hopI] as Hop;
    const a = nodes[hp.from] as Node, b = nodes[hp.to] as Node;
    const p = ease.inOutCubic(hopT), q = 1 - p;
    return { x: q * q * a.x + 2 * q * p * hp.cx + p * p * b.x, y: q * q * a.y + 2 * q * p * hp.cy + p * p * b.y };
  }
  function arrive(ni: number): void {
    const nd = nodes[ni] as Node;
    nd.flare = 1;
    links.push({ a: (hops[hopI] as Hop).from, b: ni, c: S.color(hopI) });
    if (nd.idx >= 0) {
      const deg = 5 + Math.round(hopI * 0.53);
      beep(note(deg), 0.16, "triangle", 0.05);
      if (hopI >= 12) beep(note(Math.max(0, deg - 5)), 0.2, "sine", 0.04);
      chipLife.set(ni, 1);
      // Ni en el roce ni en el penúltimo salto: un cuadro después arranca el
      // último con su propia línea, y se pisaban.
      if ((hops[hopI] as Hop).dur > 0.3 && nd.idx !== winnerIdx && !(casi && hopI === CASI) && hopI !== K - 2) {
        S.say(T[getLang()].cConstPass(names[nd.idx] ?? ""), 0.25 + 0.4 * (hopI / K));
      }
      cam.punch(0.015 + 0.03 * (hopI / K));
    } else beep(note(2 + Math.round(hopI * 0.4)), 0.1, "sine", 0.03);
  }
  function toNova(): void {
    phase = "nova";
    tPhase = 0;
    novaK = 0;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    beep(note(0), 0.8, "sine", 0.08);
    setTimeout(() => beep(note(15), 0.14, "triangle", 0.045), 520);
    setTimeout(() => beep(note(18), 0.14, "triangle", 0.035), 700);
    cam.punch(0.12).shake(16 * S.u());
  }
  skipFn = (): void => {
    if (phase === "nova" || phase === "dead") return;
    for (let i = hopI; i < hops.length; i++) {
      const hp = hops[i] as Hop;
      links.push({ a: hp.from, b: hp.to, c: S.color(i) });
    }
    hopI = hops.length - 1;
    hopT = 1;
    (nodes[WIN_NODE] as Node).flare = 1;
    toNova();
  };

  function update(dt: number): void {
    if (phase === "arm") {
      tPhase += dt;
      if (tPhase >= 0.05 && !saidBuild) {
        saidBuild = true;
        S.say(t("cConstBuild"), 0.1);
      }
      const want = Math.floor(clamp((tPhase - 0.6) / 1, 0, 1) * Math.min(18, names.length));
      while (bornTicks < want) {
        beep(note(4 + Math.round(bornTicks * 0.4)), 0.07, "sine", 0.028);
        bornTicks++;
      }
      if (tPhase >= 1.6 && !saidReady) {
        saidReady = true;
        S.say(t("cConstReady"), 0.1);
      }
      const ticks = [1.75, 1.95, 2.15];
      while (barTick < 3 && tPhase >= (ticks[barTick] as number)) {
        beep(note(5 + barTick * 2), 0.12, "triangle", 0.045);
        barTick++;
      }
      if (tPhase >= ARM) {
        phase = "hop";
        hopI = 0;
        hopT = 0;
        S.say(t("cRouteFound"), 0.35);
        beep(note(10), 0.3, "triangle", 0.055);
        beep(note(5), 0.34, "sine", 0.035);
        cam.punch(0.05);
      }
      return;
    }
    if (phase === "hop") {
      const hp = hops[hopI] as Hop;
      if (hopT === 0) beepFor(note(4 + Math.round(hopI * 0.5)), hp.dur * 0.6, "sine", 0.02);
      if (hopT === 0 && hopI === K - 1) {
        S.say(t("cConstLast"), 0.85);
        beepFor(note(0), hp.dur * 0.72, "sawtooth", 0.04);
      } else if (!saidNarrow && hopI === 15 && hopT >= 0.45) {
        S.say(t("cConstNarrow"), 0.6);
        saidNarrow = true;
      }
      hopT += dt / hp.dur;
      if (casi && hopI === CASI && !saidCasi && hopT >= 0.48) {
        saidCasi = true;
        (nodes[WIN_NODE] as Node).flare = 1;
        S.say(T[getLang()].cConstNear(names[winnerIdx] ?? ""), 0.6);
        beep(note(14), 0.1, "triangle", 0.045);
        setTimeout(() => beep(note(9), 0.12, "sine", 0.04), 110);
        cam.punch(0.06).shake(6 * S.u());
      }
      if (hopI === K - 1 && !saidDecoy && hopT >= 0.72) {
        (nodes[DECOY] as Node).flare = 1;
        S.say(t("cConstDecoy"), 0.95);
        beep(note(15), 0.14, "triangle", 0.05);
        setTimeout(() => beep(note(11), 0.12, "sine", 0.04), 120);
        saidDecoy = true;
        cam.shake(8 * S.u());
      }
      if (hopT >= 1) {
        hopT = 0;
        arrive(hp.to);
        hopI++;
        if (hopI >= hops.length) {
          hopI = hops.length - 1;
          toNova();
        }
      }
      return;
    }
    if (phase === "nova") {
      tPhase += dt;
      novaK = Math.min(1, novaK + dt);
      tHold += dt * paceFactor();
      if (tHold >= WINNER_HOLD) {
        phase = "dead";
        S.cleanup();
      }
    }
  }

  /* --------------------------------------------------------------- escena */
  let backG!: Graphics;
  let linksG!: Graphics;
  let wavesG!: Graphics;
  let packetG!: Graphics;
  let novaG!: Graphics;
  let chipsLayer!: Container;
  const chipOf = new Map<number, Container>();
  let bar!: Graphics;
  let barText!: Text;
  let hopText!: Text;
  let nebulae: Sprite[] = [];

  function build(): void {
    const k = S.u();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    chipOf.clear();
    const cv = document.createElement("canvas");
    cv.width = 2;
    cv.height = 256;
    const cx = cv.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, S.dark ? "#070a24" : "#141a4e");
    g.addColorStop(1, S.dark ? "#180d36" : "#2d1a5e");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 2, 256);
    const sky = new Sprite(Texture.from(cv));
    sky.width = W();
    sky.height = H();
    S.bg.addChild(sky);
    nebulae = neb.map((nb) => {
      const c2 = document.createElement("canvas");
      c2.width = c2.height = 128;
      const x2 = c2.getContext("2d") as CanvasRenderingContext2D;
      const g2 = x2.createRadialGradient(64, 64, 0, 64, 64, 64);
      g2.addColorStop(0, `rgba(${nb.col},${S.dark ? 0.1 : 0.16})`);
      g2.addColorStop(1, `rgba(${nb.col},0)`);
      x2.fillStyle = g2;
      x2.fillRect(0, 0, 128, 128);
      const sp = new Sprite(Texture.from(c2));
      sp.anchor.set(0.5);
      sp.width = sp.height = nb.r * k * 2;
      S.bg.addChild(sp);
      return sp;
    });
    backG = new Graphics();
    S.bg.addChild(backG);
    linksG = new Graphics();
    wavesG = new Graphics();
    S.scene.addChild(linksG, wavesG);
    for (const nd of nodes) {
      const gg = new Graphics();
      if (nd.kind === "star") {
        const pts = STAR.flatMap(([px, py]) => [px, py]);
        gg.poly(pts).fill(S.color(nd.idx));
        if (nd.r >= 8 * k) gg.poly(pts).stroke({ width: 0.22, color: INK });
        gg.rect(-0.26, -0.26, 0.52, 0.52).fill(CREAM);
      } else {
        gg.poly([0, -1, 1, 0, 0, 1, -1, 0]).stroke({ width: (2 * k) / nd.r, color: 0x6c4ce0 });
      }
      gg.position.set(nd.x, nd.y);
      nd.g = gg;
      S.scene.addChild(gg);
    }
    packetG = new Graphics();
    novaG = new Graphics();
    chipsLayer = new Container();
    S.scene.addChild(packetG, novaG, chipsLayer);
    bar = new Graphics();
    barText = S.text("", { fontFamily: MONO, fontSize: 13 * k, fontWeight: "700", fill: CREAM });
    barText.anchor.set(0.5, 1);
    hopText = S.text("", { fontFamily: MONO, fontSize: 11 * k, fontWeight: "700", fill: CREAM });
    hopText.alpha = 0.55;
    hopText.position.set(22 * k, S.top() + 12 * k);
    S.hud.addChild(bar, barText, hopText);
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);
  // Las estrellas quedan donde nacieron: la cámara mira siempre ese mismo cielo.
  const mid = { x: W() / 2, y: H() / 2 };
  cam.cut(mid.x, mid.y, names.length <= 6 ? 0.7 : 0.84);

  /** La cámara: se arma el cielo, sigue al paquete, encima en el final, se abre en la nova. */
  function direct(): void {
    if (phase === "arm") {
      const desde = names.length <= 6 ? 0.7 : 0.84;
      cam.lookAt(mid.x, mid.y, desde + (1 - desde) * ease.inOutCubic(clamp(tPhase / ARM, 0, 1)), 2);
    } else if (phase === "hop") {
      const pk = packetPos();
      const focus = 0.25 + 0.75 * ease.inOutCubic(clamp((hopI + hopT - 12) / 4, 0, 1));
      const zoom = 1.05 + 0.08 * (hopI / K) + 0.6 * ease.inOutCubic(clamp((hopI + hopT - 12) / 4, 0, 1));
      cam.lookAt(mid.x + (pk.x - mid.x) * focus, mid.y + (pk.y - mid.y) * focus, zoom, 2.4 + 2 * focus, 0.025 * (hopI / K));
    } else {
      // Se abre, pero con la ganadora a la vista, debajo del cartel.
      const win = nodes[WIN_NODE] as Node;
      const z = 1;
      cam.lookAt(mid.x + (win.x - mid.x) * 0.5, win.y - (H() * 0.12) / z, z, 1.3);
    }
  }

  function draw(now: number): void {
    const k = S.u();
    // El fondo: nebulosas que derivan y tres capas de estrellas.
    neb.forEach((nb, i) => (nebulae[i] as Sprite).position.set(nb.x * W() + Math.sin(now * 0.08 + nb.ph) * 30 * k, nb.y * H()));
    backG.clear();
    const span = W() + 40 * k;
    for (const s of back) {
      const x = ((((s.x * W() - now * s.v * k) % span) + span) % span) - 20 * k;
      backG.rect(x, s.y * H(), s.r * k, s.r * k).fill({ color: S.dark ? CREAM : 0xfff6e9, alpha: (0.55 + 0.45 * Math.sin(now * 2 + s.ph)) * (S.dark ? 0.75 : 0.9) });
    }
    // Las líneas de la constelación: en la nova engordan de golpe.
    linksG.clear();
    const fat = phase === "nova";
    for (const l of links) {
      const a = nodes[l.a] as Node, b = nodes[l.b] as Node;
      linksG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: (fat ? 10 : 7) * k, color: INK, cap: "square" });
      linksG.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: (fat ? 5 : 3) * k, color: l.c, cap: "square" });
    }
    // Estrellas y rombos: nacen, respiran y se encienden al recibir el pago.
    wavesG.clear();
    for (const nd of nodes) {
      const g = nd.g as Graphics;
      if (nd.kind === "star") {
        const grow = clamp((tAll - nd.born) / 0.28, 0, 1);
        g.visible = grow > 0;
        if (!g.visible) continue;
        const pop = grow < 1 ? 1 + 0.15 * Math.sin(grow * Math.PI) : 1;
        const breath = 1 + (phase === "arm" ? 0.09 : 0.035) * Math.sin(tAll * 3.1 + nd.x * 0.013 + nd.y * 0.007);
        // En la nova la ganadora crece, brilla y queda encima de los rayos.
        const hero = phase === "nova" && nd.idx === winnerIdx;
        const boost = hero ? 1 + 1.6 * ease.outBack(clamp(novaK * 1.6, 0, 1)) : 1;
        const r = nd.r * (1 + 0.28 * nd.flare) * grow * pop * breath * boost;
        g.scale.set(r);
        if (hero) {
          wavesG.circle(nd.x, nd.y, r * 2.4).fill({ color: YELLOW, alpha: 0.22 }).circle(nd.x, nd.y, r * 1.6).fill({ color: YELLOW, alpha: 0.3 });
          if (g.parent && g.parent.children[g.parent.children.length - 1] !== g) g.parent.addChild(g);
        }
        if (nd.flare > 0) {
          const col = S.color(nd.idx);
          wavesG.circle(nd.x, nd.y, r * 2.6).fill({ color: col, alpha: 0.35 * nd.flare });
          wavesG.circle(nd.x, nd.y, r * (1.4 + (1 - nd.flare) * 4.2)).stroke({ width: 5 * k * nd.flare, color: col, alpha: nd.flare });
        }
      } else {
        const grow = clamp((tAll - nd.born) / 0.22, 0, 1);
        g.visible = grow > 0;
        if (!g.visible) continue;
        const born = clamp(1 - (tAll - nd.born) / 0.5, 0, 1);
        const wave = Math.max(nd.flare, born);
        if (wave > 0) wavesG.circle(nd.x, nd.y, nd.r * (1.3 + (1 - wave) * 4.5)).stroke({ width: 4 * k * wave, color: 0x8f6cff, alpha: wave });
        const breath = 1 + (phase === "arm" ? 0.12 : 0.05) * Math.sin(tAll * 2.6 + nd.x * 0.017 + nd.y * 0.011);
        g.scale.set(nd.r * grow * breath * (1 + 0.6 * nd.flare));
      }
    }
    // El paquete con su estela.
    packetG.clear();
    if (phase === "hop") {
      trail.forEach((q, i) => {
        const p = i / trail.length;
        const s = (3 + 6 * p) * k;
        packetG.poly([q.x, q.y - s / 1.4, q.x + s / 1.4, q.y, q.x, q.y + s / 1.4, q.x - s / 1.4, q.y]).fill({ color: p > 0.6 ? 0xff7a1a : 0xe93d9c, alpha: 0.1 + 0.55 * p });
      });
      const p = packetPos();
      const s = 19 * k + Math.sin(now * 14) * 1.6 * k;
      packetG.circle(p.x, p.y, s * 1.5).fill({ color: YELLOW, alpha: 0.22 });
      const rot = Math.PI / 4 + now * 1.6;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const r = (px: number, py: number): number[] => [p.x + px * c - py * sn, p.y + px * sn + py * c];
      packetG.poly([...r(-s / 2, -s / 2), ...r(s / 2, -s / 2), ...r(s / 2, s / 2), ...r(-s / 2, s / 2)]).fill(YELLOW).stroke({ width: 3 * k, color: INK });
      packetG.poly([...r(-s / 6, -s / 6), ...r(s / 6, -s / 6), ...r(s / 6, s / 6), ...r(-s / 6, s / 6)]).fill(0xffffff);
    }
    // La nova.
    novaG.clear();
    if (phase === "nova") {
      const nd = nodes[WIN_NODE] as Node;
      const e = 1 - Math.pow(1 - novaK, 2.2);
      for (const off of [0, 0.14, 0.28]) {
        const q = clamp((novaK - off) / (1 - off), 0, 1);
        if (q <= 0) continue;
        const r = 30 * k + q * 560 * k;
        novaG.circle(nd.x, nd.y, r).stroke({ width: (14 - 10 * q) * k, color: INK, alpha: (1 - q) * 0.9 });
        novaG.circle(nd.x, nd.y, r).stroke({ width: (7 - 5 * q) * k, color: off ? 0xff7a1a : YELLOW, alpha: (1 - q) * 0.9 });
      }
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + novaK * 0.4;
        const L = 40 * k + e * 300 * k;
        const wd = 16 * k * (1 - novaK * 0.7);
        const c = Math.cos(a), sn = Math.sin(a);
        novaG.poly([nd.x - (wd / 2) * -sn, nd.y + (wd / 2) * -c, nd.x + L * c, nd.y + L * sn, nd.x + (wd / 2) * -sn, nd.y - (wd / 2) * -c]).fill(YELLOW).stroke({ width: 3 * k, color: INK });
      }
      // Con la hora de la fase, que no tiene tope: con novaK (que llega a 1)
      // la corona se congelaba a los 1,4 s, sin los premios de más ni el papel picado.
      crown.at(tPhase * 1.4);
    }
    // Pasar lista: mientras se arma el cielo y en los primeros saltos, los
    // nombres de a tandas encima de cada estrella, para que cada uno sepa cuál
    // es la suya.
    const roll = phase === "nova" ? [] : S.batch(names.length, tAll, 0.9, ARM + 1.6);
    S.tags(names, roll, (i) => {
      const nd = nodes[starOf.get(i) ?? -1];
      return nd && tAll > nd.born ? cam.toScreen(nd.x, nd.y - nd.r - 16 * k, S.sw(), S.sh()) : null;
    }, barText.text ? [barText.getBounds()] : []);
    // Los nombres: todos si son pocos, si no el que tiene el paquete y los de antes.
    const enMano = (hops[Math.min(hopI, hops.length - 1)] as Hop | undefined)?.to ?? -1;
    for (const c of chipOf.values()) c.visible = false;
    const show = (ni: number, alpha: number, big: boolean): void => {
      const nd = nodes[ni] as Node;
      if (nd.idx < 0) return;
      const key = ni * 2 + (big ? 1 : 0);
      let c = chipOf.get(key);
      if (!c) {
        c = S.chip(names[nd.idx] ?? "", big ? 1.7 : names.length <= 4 ? 1.6 : 1);
        chipOf.set(key, c);
        chipsLayer.addChild(c);
      }
      c.visible = true;
      c.alpha = alpha;
      c.position.set(nd.x + nd.r + 6 * k, nd.y - nd.r - 10 * k);
    };
    if (phase !== "nova" && !roll.length) {
      if (names.length <= 4) nodes.forEach((nd, i) => { if (nd.idx >= 0 && tAll > nd.born) show(i, 1, false); });
      else for (const [ni, a] of chipLife) show(ni, Math.min(1, a * 3), ni === enMano);
    }
    // La barra de "buscando ruta", en el armado.
    bar.clear();
    barText.text = "";
    if (phase === "arm") {
      const p = clamp((tPhase - 1.6) / 0.6, 0, 1);
      const bw = 340 * k, bh = 26 * k, bx = W() / 2 - bw / 2, by = H() * 0.86 - 40 * k;
      bar.rect(bx + 5 * k, by + 5 * k, bw, bh).fill(INK).rect(bx, by, bw, bh).fill(0x241a52).rect(bx, by, bw * p, bh).fill(0xe93d9c).rect(bx, by, bw, bh).stroke({ width: 3 * k, color: INK });
      barText.text = p < 1 ? t("cRoute") : t("cRouteFoundShort");
      barText.position.set(W() / 2, by - 10 * k);
    }
    hopText.text = phase === "hop" ? `${t("cHop")} ${hopI + 1}/${K}` : "";
  }

  S.run((dt, now) => {
    tAll += dt;
    S.breath(tAll, ARM + hops.reduce((acc, hp) => acc + hp.dur, 0));
    update(dt);
    if (phase === "dead") return;
    if (phase === "hop") {
      trail.push(packetPos());
      if (trail.length > 14) trail.shift();
    }
    for (const nd of nodes) nd.flare = Math.max(0, nd.flare - dt * 2.2);
    for (const [ni, a] of chipLife) {
      const na = a - dt * 0.8;
      if (na <= 0) chipLife.delete(ni);
      else chipLife.set(ni, na);
    }
    direct();
    cam.update(dt);
    cam.apply(S.scene, W(), H(), now);
    draw(now);
  });
}
