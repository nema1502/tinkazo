import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { gsap } from "gsap";
import { $ } from "../../dom";
import { T, getLang, setPickSeed, t } from "../../i18n";
import { LCOLORS, drawAvatar, instantMode, paceFactor, setGameLength, type Beacon } from "../../state";
import { audio, beep, beepFor, fanfare, isMuted, note } from "../../sound";
import { tension } from "../drama";
import { registerSkip, WINNER_HOLD, shorten, winnersLabel } from "../overlay";
import { narrate, stopNarrator } from "../../narrator";
import { musicCue, startMusic, stopMusic } from "../../music";
import { planRace, type Plan } from "./plan";

/**
 * La carrera de llamas, en PixiJS y GSAP. Prototipo.
 *
 * Es la misma carrera que `race.ts` (el mismo plan, la misma historia del
 * director, el mismo relato), dibujada con la placa de video: paisaje en
 * capas, una tribuna que salta con la tensión, llamas armadas por partes que
 * galopan de verdad, polvo, líneas de velocidad, un minimapa de la carrera y
 * un podio con papel picado. Se prende con `?motor=pixi` para compararla lado
 * a lado con la de siempre, con la misma ronda.
 *
 * Lo que no cambia: nada decide nada. El ganador llega dado, y todo lo que se
 * ve es función de la ronda y del reloj del juego. Los efectos que parecen
 * partículas sueltas (polvo, papel picado) se calculan desde la hora, no se
 * acumulan: saltar al final dibuja lo mismo que llegar caminando.
 */

const DUR = 15;
const INK = 0x191919;
const CREAM = 0xf6efe2;
const YELLOW = 0xffc629;

const hex = (css: string, fallback = 0xe93d9c): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  return m ? parseInt(m[1] as string, 16) : fallback;
};

/** Un generador sembrado, el mismo de todos los juegos. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un azar que depende solo de sus argumentos: para el polvo y el papel picado. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Colores de lana de llama: blanca, café, crema, oscura, gris. */
const FUR = [0xf3ead8, 0xa0683a, 0xe4c99a, 0x5b3a29, 0xc2bab0, 0x8a5a3c, 0xefe3cc, 0x6e4a36];

interface Llama {
  root: Container;
  body: Container;
  legs: Graphics[];
  neck: Container;
  ears: Graphics[];
  tail: Graphics;
  tag: Container;
  mark: Text;
}

interface Scene {
  sw: number;
  sh: number;
  u: number;
  portrait: boolean;
  X0: number;
  TL: number;
  trackTop: number;
  laneH: number;
  laneY: (k: number) => number;
  laneScale: (k: number) => number;
  world: Container;
  scene: Container;
  far: Container;
  mid: Container;
  near: Container;
  stands: Container;
  crowd: Sprite[];
  crowdBase: { x: number; y: number; ph: number; tier: number }[];
  flags: Graphics;
  clouds: Container;
  sun: Container;
  fx: Graphics;
  llamas: Llama[];
  hud: Container;
  mini: Graphics;
  board: Container;
  rows: Container[];
  count: Text[];
  foto: Container;
  flash: Graphics;
  plate: Container;
  confetti: Graphics;
  kill: () => void;
}

export async function llamasPixi(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  if (instantMode || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  const ov = $("stadium");
  const base = $<HTMLCanvasElement>("race-canvas");
  const commentEl = $("commentary");
  commentEl.textContent = "";
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;
  ov.style.display = "block";
  document.body.style.overflow = "hidden";

  // El lienzo de siempre queda escondido; PixiJS dibuja en uno propio, porque
  // un lienzo que ya dio un contexto 2D no puede dar uno de WebGL.
  base.style.visibility = "hidden";
  const view = document.createElement("canvas");
  view.id = "pixi-canvas";
  base.after(view);

  // El mismo azar que `race.ts`, consumido en el mismo orden: la misma ronda
  // cuenta la misma historia en los dos motores.
  let s0 = parseInt(beacon.randomness.slice(0, 8), 16) | 0;
  const rng = (): number => {
    s0 = (s0 + 0x6d2b79f5) | 0;
    let q = Math.imul(s0 ^ (s0 >>> 15), 1 | s0);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
  setPickSeed(rng);
  // El decorado sale de otra parte de la ronda, así no le mueve nada al plan.
  const decoSeed = parseInt(beacon.randomness.slice(24, 32), 16);

  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.dataset.theme !== "light"
    : document.documentElement.dataset.theme === "dark";
  const dark = prefersDark;
  const cs = getComputedStyle(document.documentElement);
  const P = LCOLORS.map((v) => hex(cs.getPropertyValue(v)));
  const laneColor = (k: number): number => P[k % P.length] ?? 0xe93d9c;

  setGameLength(DUR, WINNER_HOLD + 3);
  startMusic(parseInt(beacon.randomness.slice(8, 16), 16));

  function say(msg: string, heat = 0): void {
    commentEl.textContent = msg;
    commentEl.animate(
      [{ transform: "translateX(-50%) scale(0.75)" }, { transform: "translateX(-50%) scale(1)" }],
      { duration: 280, easing: "cubic-bezier(.34,1.56,.64,1)" },
    );
    narrate(msg, heat);
    musicCue(heat);
  }

  const plan: Plan = planRace(names, winnerIdx, rng, {
    // Los mismos sorteos que `race.ts` hace para su paisaje: una semilla de
    // paso por corredor, 24 cerros, 18 lomas, 6 nubes y 60 estrellas.
    sceneryDraws: Math.min(8, names.length) + 24 * 2 + 18 * 2 + 6 * 4 + 60 * 3,
    beforePlace: () => say(t("cReady"), 0.1),
  });
  const { story, lanes } = plan;
  // El arco queda anotado, como en la carrera de siempre: lo leen los auditores.
  base.dataset.arco = story.arc;
  const N = lanes.length;
  const nameOf = (k: number): string => names[lanes[k] as number] ?? "";

  const app = new Application();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  await app.init({
    canvas: view,
    width: innerWidth,
    height: innerHeight,
    antialias: true,
    resolution: dpr,
    autoDensity: true,
    backgroundColor: 0x10101c,
    autoStart: false,
    preference: "webgl",
  });

  // Las caras de la lista, dibujadas una vez en un lienzo chico cada una.
  const faces = new Map<string, Texture>();
  const face = (name: string): Texture => {
    let tx = faces.get(name);
    if (!tx) {
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      const cx = c.getContext("2d");
      if (cx) drawAvatar(cx, name, 0, 0, 48);
      tx = Texture.from(c);
      faces.set(name, tx);
    }
    return tx;
  };

  /* ================================================================ escena */

  function gradientTexture(stops: [number, string][], h = 256): Texture {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = h;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createLinearGradient(0, 0, 0, h);
    for (const [at, col] of stops) g.addColorStop(at, col);
    cx.fillStyle = g;
    cx.fillRect(0, 0, 2, h);
    return Texture.from(c);
  }

  function glowTexture(col: string): Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, col);
    g.addColorStop(0.25, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 256, 256);
    return Texture.from(c);
  }

  /** Una llama armada por partes, mirando a la derecha, con los pies en y = 0. */
  function makeLlama(k: number, sc: number): Llama {
    const fur = FUR[(lanes[k] as number) % FUR.length] ?? 0xf3ead8;
    const dim = (c: number, f: number): number => {
      const r = ((c >> 16) & 255) * f, g = ((c >> 8) & 255) * f, b = (c & 255) * f;
      return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    };
    const root = new Container();
    const shadow = new Graphics().ellipse(0, 0, 24, 5).fill({ color: 0x000000, alpha: 0.28 });
    root.addChild(shadow);
    const body = new Container();
    root.addChild(body);
    const leg = (x: number, far: boolean): Graphics => {
      const g = new Graphics()
        .roundRect(-3, 0, 6, 30, 3)
        .fill(far ? dim(fur, 0.72) : fur)
        .stroke({ width: 2, color: INK })
        .roundRect(-3.5, 26, 7, 5, 2)
        .fill(INK);
      g.position.set(x, -30);
      return g;
    };
    const legs = [leg(-12, true), leg(15, true), leg(-16, false), leg(11, false)];
    body.addChild(legs[0] as Graphics, legs[1] as Graphics);
    const tail = new Graphics().ellipse(-3, -2, 6, 5).fill(fur).stroke({ width: 2, color: INK });
    tail.position.set(-24, -40);
    body.addChild(tail);
    // El cuerpo con su lana: un óvalo y unos rulos en el borde de arriba.
    const torso = new Graphics();
    for (let i = 0; i < 6; i++) torso.circle(-17 + i * 7, -44 + Math.sin(i * 1.7) * 1.5, 5.5).fill(fur);
    torso.ellipse(0, -36, 24, 13).fill(fur).stroke({ width: 2.2, color: INK });
    body.addChild(torso);
    // La manta, del color del carril, con franjas de aguayo.
    const col = laneColor(k);
    const blanket = new Graphics()
      .roundRect(-15, -48, 30, 17, 4)
      .fill(col)
      .stroke({ width: 2, color: INK })
      .rect(-15, -43, 30, 2.4)
      .fill(YELLOW)
      .rect(-15, -38.5, 30, 2.4)
      .fill(0x2f9e44);
    body.addChild(blanket);
    const bib = new Text({
      text: String(k + 1),
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 } },
    });
    bib.anchor.set(0.5);
    bib.position.set(0, -40);
    body.addChild(bib);
    body.addChild(legs[2] as Graphics, legs[3] as Graphics);
    // El cuello y la cabeza, que se mueven juntos.
    const neck = new Container();
    neck.position.set(16, -42);
    const neckG = new Graphics()
      .roundRect(-5, -34, 11, 38, 5)
      .fill(fur)
      .stroke({ width: 2.2, color: INK })
      .ellipse(6, -38, 11, 8)
      .fill(fur)
      .stroke({ width: 2.2, color: INK })
      .ellipse(14, -36, 5.5, 4.5)
      .fill(dim(fur, 0.8))
      .stroke({ width: 1.6, color: INK })
      .circle(6, -40, 1.8)
      .fill(INK);
    const earL = new Graphics().poly([-3, 0, 0, -11, 3, 0]).fill(fur).stroke({ width: 1.8, color: INK });
    earL.position.set(1, -44);
    const earR = new Graphics().poly([-3, 0, 0, -12, 3, 0]).fill(dim(fur, 0.85)).stroke({ width: 1.8, color: INK });
    earR.position.set(6, -45);
    neck.addChild(earR, neckG, earL);
    body.addChild(neck);
    const mark = new Text({
      text: "!",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } },
    });
    mark.anchor.set(0.5, 1);
    mark.position.set(20, -98);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);

    // La etiqueta con la cara y el nombre, detrás de la llama.
    const tag = new Container();
    const label = new Text({
      text: shorten(nameOf(k), 18),
      style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fontWeight: "800", fill: INK },
    });
    const pad = 5;
    const av = new Sprite(face(nameOf(k)));
    av.width = av.height = 16;
    av.position.set(pad, 3);
    label.position.set(pad + 20, 3);
    const w = label.width + pad * 2 + 20;
    const bg = new Graphics()
      .roundRect(3, 3, w, 22, 5)
      .fill(INK)
      .roundRect(0, 0, w, 22, 5)
      .fill(dark ? CREAM : 0xffffff)
      .stroke({ width: 2, color: INK });
    tag.addChild(bg, av, label);
    tag.pivot.set(w, 11);
    return { root, body, legs, neck, ears: [earL, earR], tail, tag, mark };
  }

  function build(): Scene {
    const sw = innerWidth, sh = innerHeight;
    const portrait = sh > sw * 1.1;
    const u = portrait ? Math.min(sw / 420, sh / 900) : sh / 720;
    const top = portrait ? 100 : 82;
    const bottom = portrait ? 118 : 106;
    const trackTop = sh * (portrait ? 0.36 : 0.35);
    const trackBot = sh - bottom - 6 * u;
    const laneH = (trackBot - trackTop) / N;
    const X0 = sw * (portrait ? 0.36 : 0.2);
    const TL = 2.4 * Math.max(sw, sh * 0.9);
    const finishX = X0 + TL;
    const standsTop = trackTop - 90 * u;
    const laneY = (k: number): number => trackTop + laneH * (k + 0.82);
    const laneScale = (k: number): number => ((laneH * 2.3) / 86) * (0.88 + 0.24 * (N > 1 ? k / (N - 1) : 1));
    const deco = seeded(decoSeed);

    const stage = app.stage;
    stage.removeChildren();

    // El cielo, que no se mueve.
    const sky = new Sprite(
      gradientTexture(
        dark
          ? [[0, "#0b1230"], [0.55, "#2a1b48"], [1, "#c0603f"]]
          : [[0, "#5aa9e6"], [0.6, "#a8d8f0"], [1, "#ffe0a8"]],
      ),
    );
    sky.width = sw;
    sky.height = standsTop + 40 * u;
    stage.addChild(sky);

    // El sol, o la luna, con su halo.
    const sun = new Container();
    const halo = new Sprite(glowTexture(dark ? "rgba(255,240,200,0.55)" : "rgba(255,245,200,0.9)"));
    halo.anchor.set(0.5);
    halo.width = halo.height = 230 * u;
    const disc = new Graphics().circle(0, 0, 30 * u).fill(dark ? 0xf4ecd8 : 0xfff3c4);
    sun.addChild(halo, disc);
    sun.position.set(sw * 0.78, standsTop * 0.32);
    stage.addChild(sun);

    const clouds = new Container();
    for (let i = 0; i < 7; i++) {
      const g = new Graphics();
      const cx = deco() * sw * 1.4, cy = standsTop * (0.12 + deco() * 0.45), s = (0.6 + deco() * 0.8) * u;
      for (let j = 0; j < 5; j++) g.ellipse(cx + (j - 2) * 26 * s, cy + Math.sin(j * 2.1) * 6 * s, 30 * s, 16 * s);
      g.fill({ color: dark ? 0x3a3060 : 0xffffff, alpha: dark ? 0.55 : 0.85 });
      clouds.addChild(g);
    }
    stage.addChild(clouds);

    // Tres capas de cerros: la cordillera nevada lejos, cerros al medio y
    // lomas cerca. Genéricas, como pide la marca: nada de postales.
    const range = (baseY: number, amp: number, step: number, col: number, snow: boolean, width: number): Graphics => {
      const g = new Graphics();
      const pts: number[] = [0, baseY];
      const peaks: [number, number][] = [];
      for (let x = 0; x <= width; x += step * (0.6 + deco() * 0.8)) {
        const y = baseY - amp * (0.35 + deco() * 0.65);
        pts.push(x, y);
        peaks.push([x, y]);
      }
      pts.push(width, baseY, width, sh, 0, sh);
      g.poly(pts).fill(col);
      if (snow) {
        for (const [x, y] of peaks) {
          if (baseY - y < amp * 0.7) continue;
          g.poly([x - 22 * u, y + 20 * u, x, y, x + 22 * u, y + 20 * u, x + 8 * u, y + 14 * u, x - 6 * u, y + 18 * u]).fill(0xeef0f8);
        }
      }
      return g;
    };
    const far = new Container();
    far.addChild(range(standsTop + 10 * u, 150 * u, 90 * u, dark ? 0x3b3563 : 0x8a9cc0, true, sw + TL * 0.12 + sw));
    const mid = new Container();
    mid.addChild(range(standsTop + 30 * u, 80 * u, 70 * u, dark ? 0x2a2848 : 0x6f8f6a, false, sw + TL * 0.25 + sw));
    const near = new Container();
    near.addChild(range(standsTop + 50 * u, 40 * u, 60 * u, dark ? 0x201d36 : 0xb89a62, false, sw + TL * 0.4 + sw));
    const scene = new Container();
    stage.addChild(scene);
    scene.addChild(far, mid, near);

    // La tribuna, con la hinchada. Cada persona es un sprite de una de ocho
    // figuras prearmadas: mil y pico sprites se dibujan en un solo lote.
    const stands = new Container();
    const standsW = TL * 0.7 + sw * 2;
    const sg = new Graphics()
      .rect(-sw, standsTop, standsW, trackTop - standsTop)
      .fill(dark ? 0x2b2640 : 0x5b5f79);
    for (let tier = 0; tier < 3; tier++) {
      sg.rect(-sw, standsTop + (tier + 1) * 26 * u, standsW, 4 * u).fill({ color: 0x000000, alpha: 0.28 });
    }
    sg.rect(-sw, standsTop - 10 * u, standsW, 10 * u).fill(INK);
    stands.addChild(sg);
    const people: Texture[] = [];
    const skin = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
    for (let i = 0; i < 8; i++) {
      for (const up of [false, true]) {
        const g = new Graphics();
        const shirt = i < 5 ? (P[i % P.length] ?? 0xe93d9c) : [0xffffff, 0x2f9e44, 0x1c64c8][i - 5] ?? 0xffffff;
        g.roundRect(-4, -8, 8, 9, 2).fill(shirt);
        g.circle(0, -11, 3.4).fill(skin[i % skin.length] ?? 0xf1c27d);
        if (up) g.moveTo(-3.5, -7).lineTo(-6, -15).moveTo(3.5, -7).lineTo(6, -15).stroke({ width: 1.6, color: shirt });
        people.push(app.renderer.generateTexture({ target: g, resolution: 2 * dpr }));
        g.destroy();
      }
    }
    const crowd: Sprite[] = [];
    const crowdBase: Scene["crowdBase"] = [];
    for (let tier = 0; tier < 3; tier++) {
      for (let x = -sw; x < standsW - sw; x += (11 + deco() * 7) * u) {
        const kind = Math.floor(deco() * 8);
        const sp = new Sprite(people[kind * 2] as Texture);
        sp.anchor.set(0.5, 1);
        sp.scale.set(u * (1.25 + tier * 0.1));
        // Las gradas de atrás, más en sombra: la tribuna tiene fondo.
        sp.tint = tier === 0 ? 0x9a9ab0 : tier === 1 ? 0xc8c8d6 : 0xffffff;
        const y = standsTop + (tier + 1) * 26 * u;
        sp.position.set(x, y);
        stands.addChild(sp);
        crowd.push(sp);
        crowdBase.push({ x, y, ph: deco() * 6.28, tier });
      }
    }
    // Las texturas con los brazos arriba quedan a mano en `people`.
    (crowd as unknown as { people?: Texture[] }).people = people;
    const flags = new Graphics();
    stands.addChild(flags);
    scene.addChild(stands);

    // La pista: todo lo que está al nivel del suelo se mueve con la cámara.
    const world = new Container();
    scene.addChild(world);
    const ground = new Graphics();
    ground.rect(-sw, trackTop - 6 * u, TL + sw * 3, sh - trackTop + 6 * u).fill(dark ? 0x3d2b22 : 0xb98552);
    for (let k = 0; k < N; k++) {
      ground.rect(-sw, trackTop + k * laneH, TL + sw * 3, laneH).fill({ color: k % 2 ? 0x000000 : 0xffffff, alpha: dark ? 0.05 : 0.06 });
    }
    for (let k = 1; k < N; k++) {
      const y = trackTop + k * laneH;
      for (let x = -sw; x < TL + sw * 2; x += 34 * u) ground.rect(x, y - 1, 18 * u, 2).fill({ color: 0xffffff, alpha: 0.28 });
    }
    // La baranda de arriba.
    ground.rect(-sw, trackTop - 8 * u, TL + sw * 3, 4 * u).fill(CREAM);
    for (let x = -sw; x < TL + sw * 2; x += 60 * u) ground.rect(x, trackTop - 20 * u, 4 * u, 16 * u).fill(CREAM);
    ground.rect(-sw, trackTop - 20 * u, TL + sw * 3, 3 * u).fill(CREAM);
    // Largada y meta.
    ground.rect(X0 - 3 * u, trackTop, 6 * u, trackBot - trackTop).fill({ color: 0xffffff, alpha: 0.85 });
    const cell = 9 * u;
    for (let y = trackTop, r = 0; y < trackBot; y += cell, r++) {
      for (let c = 0; c < 3; c++) ground.rect(finishX + c * cell, y, cell, cell).fill((r + c) % 2 ? INK : 0xffffff);
    }
    world.addChild(ground);
    // Los carteles de distancia, cada diez metros de cien.
    for (let i = 1; i < 10; i++) {
      const x = X0 + TL * (i / 10);
      const post = new Graphics().rect(x - 2 * u, trackTop - 46 * u, 4 * u, 30 * u).fill(CREAM).roundRect(x - 20 * u, trackTop - 62 * u, 40 * u, 20 * u, 4 * u).fill(dark ? 0x2b2640 : 0xffffff).stroke({ width: 2 * u, color: INK });
      const tx = new Text({ text: `${100 - i * 10} m`, style: { fontFamily: "ui-monospace, monospace", fontSize: 11 * u, fontWeight: "800", fill: dark ? CREAM : INK } });
      tx.anchor.set(0.5);
      tx.position.set(x, trackTop - 52 * u);
      world.addChild(post, tx);
    }
    // El arco de la meta.
    const arch = new Graphics()
      .rect(finishX - 4 * u, trackTop - 110 * u, 8 * u, 110 * u)
      .fill(CREAM)
      .stroke({ width: 2 * u, color: INK })
      .roundRect(finishX - 70 * u, trackTop - 138 * u, 140 * u, 34 * u, 6 * u)
      .fill(YELLOW)
      .stroke({ width: 3 * u, color: INK });
    const meta = new Text({ text: getLang() === "es" ? "META" : "FINISH", style: { fontFamily: "system-ui, sans-serif", fontSize: 22 * u, fontWeight: "900", fill: INK } });
    meta.anchor.set(0.5);
    meta.position.set(finishX, trackTop - 121 * u);
    world.addChild(arch, meta);

    // Las llamas, de la más lejana a la más cercana.
    const llamas: Llama[] = [];
    const tagsLayer = new Container();
    const runnersLayer = new Container();
    for (let k = 0; k < N; k++) {
      const l = makeLlama(k, laneScale(k));
      llamas.push(l);
      runnersLayer.addChild(l.root);
      l.tag.scale.set(u * (portrait ? 0.95 : 1));
      tagsLayer.addChild(l.tag);
    }
    const fx = new Graphics();
    world.addChild(tagsLayer, runnersLayer, fx);

    const vig = document.createElement("canvas");
    vig.width = vig.height = 256;
    const vx = vig.getContext("2d") as CanvasRenderingContext2D;
    const vg = vx.createRadialGradient(128, 128, 60, 128, 128, 182);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    vx.fillStyle = vg;
    vx.fillRect(0, 0, 256, 256);
    const vignette = new Sprite(Texture.from(vig));
    vignette.width = sw;
    vignette.height = sh;
    stage.addChild(vignette);

    // La interfaz: minimapa, tabla, cuenta regresiva, foto, cartel.
    const hud = new Container();
    stage.addChild(hud);
    const mini = new Graphics();
    hud.addChild(mini);
    const board = new Container();
    const rows: Container[] = [];
    const rowH = 22 * u;
    for (let k = 0; k < N; k++) {
      const r = new Container();
      const bg = new Graphics().roundRect(0, 0, 168 * u, rowH - 3 * u, 4 * u).fill({ color: INK, alpha: 0.72 });
      const num = new Graphics().roundRect(2 * u, 2 * u, 18 * u, rowH - 7 * u, 3 * u).fill(laneColor(k));
      const pos = new Text({ text: "", style: { fontFamily: "system-ui, sans-serif", fontSize: 11 * u, fontWeight: "900", fill: INK } });
      pos.anchor.set(0.5);
      pos.position.set(11 * u, (rowH - 3 * u) / 2);
      const av = new Sprite(face(nameOf(k)));
      av.width = av.height = 14 * u;
      av.position.set(24 * u, 2.5 * u);
      const nm = new Text({ text: shorten(nameOf(k), 16), style: { fontFamily: "system-ui, sans-serif", fontSize: 11 * u, fontWeight: "700", fill: CREAM } });
      nm.position.set(42 * u, 3.5 * u);
      r.addChild(bg, num, pos, av, nm);
      board.addChild(r);
      rows.push(r);
    }
    board.position.set(12 * u, top + 40 * u);
    if (portrait) board.visible = false;
    hud.addChild(board);

    const count: Text[] = ["3", "2", "1", getLang() === "es" ? "¡YA!" : "GO!"].map((s) => {
      const tx = new Text({ text: s, style: { fontFamily: "system-ui, sans-serif", fontSize: 190 * u, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 18 * u }, dropShadow: { color: INK, distance: 10 * u, angle: Math.PI / 4, blur: 0, alpha: 1 } } });
      tx.anchor.set(0.5);
      tx.position.set(sw / 2, sh * 0.42);
      tx.alpha = 0;
      hud.addChild(tx);
      return tx;
    });

    const foto = new Container();
    const bars = new Graphics().rect(0, 0, sw, sh * 0.1).fill(INK).rect(0, sh * 0.9, sw, sh * 0.1).fill(INK);
    const fotoTx = new Text({ text: getLang() === "es" ? "FOTO" : "PHOTO", style: { fontFamily: "ui-monospace, monospace", fontSize: 26 * u, fontWeight: "900", fill: 0xff4d4d, letterSpacing: 6 * u } });
    fotoTx.position.set(20 * u, sh * 0.1 + 12 * u);
    foto.addChild(bars, fotoTx);
    foto.visible = false;
    hud.addChild(foto);

    const confetti = new Graphics();
    hud.addChild(confetti);
    const flash = new Graphics().rect(0, 0, sw, sh).fill(0xffffff);
    flash.alpha = 0;
    hud.addChild(flash);

    // El cartel del ganador.
    const plate = new Container();
    const wname = winnersLabel(names, winners);
    const pName = new Text({ text: wname, style: { fontFamily: "system-ui, sans-serif", fontSize: 54 * u, fontWeight: "900", fill: INK } });
    const maxW = sw * 0.84 - 130 * u;
    if (pName.width > maxW) pName.scale.set(maxW / pName.width);
    const pLabel = new Text({ text: getLang() === "es" ? "GANA LA CARRERA" : "WINS THE RACE", style: { fontFamily: "ui-monospace, monospace", fontSize: 14 * u, fontWeight: "900", fill: INK, letterSpacing: 3 * u } });
    const pw = Math.max(pName.width, pLabel.width) + 130 * u;
    const ph = 118 * u;
    const pbg = new Graphics()
      .roundRect(-pw / 2 + 10 * u, -ph / 2 + 10 * u, pw, ph, 14 * u)
      .fill(INK)
      .roundRect(-pw / 2, -ph / 2, pw, ph, 14 * u)
      .fill(YELLOW)
      .stroke({ width: 5 * u, color: INK });
    const pAv = new Sprite(face(names[winnerIdx] ?? ""));
    pAv.width = pAv.height = 76 * u;
    pAv.position.set(-pw / 2 + 22 * u, -38 * u);
    const avBorder = new Graphics().rect(-pw / 2 + 20 * u, -40 * u, 80 * u, 80 * u).stroke({ width: 4 * u, color: INK });
    pLabel.position.set(-pw / 2 + 114 * u, -40 * u);
    pName.position.set(-pw / 2 + 112 * u, -18 * u);
    plate.addChild(pbg, pAv, avBorder, pLabel, pName);
    plate.position.set(sw / 2, portrait ? sh * 0.24 : sh * 0.26);
    plate.scale.set(0);
    hud.addChild(plate);

    return {
      sw, sh, u, portrait, X0, TL, trackTop, laneH, laneY, laneScale,
      world, scene, far, mid, near, stands, crowd, crowdBase, flags, clouds, sun, fx, llamas,
      hud, mini, board, rows, count, foto, flash, plate, confetti,
      kill: () => {
        stage.removeChildren().forEach((c) => c.destroy({ children: true }));
        for (const tx of people) tx.destroy(true);
      },
    };
  }

  let S = build();

  /* ======================================================= la coreografía */

  // La cuenta regresiva y el podio son líneas de tiempo de GSAP en pausa: en
  // cada cuadro se llevan a la hora del juego, así que no corren solas y la
  // misma ronda las muestra igual.
  const tlCount = gsap.timeline({ paused: true });
  const tlWin = gsap.timeline({ paused: true });
  function choreograph(): void {
    tlCount.clear();
    S.count.forEach((tx, i) => {
      tlCount
        .fromTo(tx.scale, { x: 2.6, y: 2.6 }, { x: 1, y: 1, duration: 0.45, ease: "back.out(2.2)" }, i)
        .fromTo(tx, { alpha: 0 }, { alpha: 1, duration: 0.08 }, i)
        .to(tx, { alpha: 0, duration: 0.25 }, i + (i === 3 ? 0.55 : 0.75));
    });
    tlWin.clear();
    tlWin
      .fromTo(S.flash, { alpha: 0.95 }, { alpha: 0, duration: 0.5, ease: "power2.out" }, 0)
      .fromTo(S.plate.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.9, ease: "elastic.out(1, 0.55)" }, 0.15)
      .fromTo(S.plate, { rotation: -0.12 }, { rotation: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" }, 0.15);
  }
  choreograph();

  /* ========================================================= el estado */

  let phase: "count" | "race" | "done" | "dead" = "count";
  let tPhase = 0, tRace = 0, tFreeze = 0, camX = 0, lastLeader = -1, saidLast = false, finished = false;
  let lastBeepN = 4;
  let flashRace = 0;
  const rowPos = lanes.map((_, k) => k);
  const winnerLane = story.winner;

  function skip(): void {
    if (finished) return;
    phase = "race";
    tRace = DUR;
    finishNow();
  }
  registerSkip(skip);

  function finishNow(): void {
    finished = true;
    phase = "done";
    tFreeze = 0;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
  }

  // La tribuna suena: ruido de gente que sube con la tensión.
  const roar = crowdNoise();

  /* ---------------------------------------------------------------- relato */
  const fired = new Set<string>();
  let lastSayAt = -99;
  let lastHeat = 0;
  function sayIf(msg: string, heat: number): boolean {
    const now = tRace / paceFactor();
    if (now - lastSayAt < 1.1 && heat < lastHeat + 0.3) return false;
    lastSayAt = now;
    lastHeat = heat;
    say(msg, heat);
    return true;
  }
  let latido = -1;
  function storyBeats(prog: number): void {
    const L_ = T[getLang()];
    const calor = 0.35 + 0.5 * tension(story, prog);
    story.beats.forEach((bt, n) => {
      const id = `b${n}`;
      if (prog < bt.at || fired.has(id)) return;
      fired.add(id);
      const quien = nameOf(bt.actor);
      const suya = bt.actor === story.winner;
      if (bt.kind === "plantada") {
        sayIf((L_.cPlantadaL as (n: string) => string)(quien), calor);
        beep(note(8), 0.12, "triangle", 0.045);
        setTimeout(() => beep(note(3), 0.16, "triangle", 0.04), 120);
      } else if (bt.kind === "tropiezo") {
        sayIf((L_.cTropiezoL as (n: string) => string)(quien), suya ? 0.85 : calor);
        beep(note(1), 0.09, "square", 0.05);
      } else if (bt.kind === "pique") {
        sayIf((L_.cPiqueL as (n: string) => string)(quien), calor);
        [10, 12, 14].forEach((g, i) => setTimeout(() => beep(note(g), 0.08, "triangle", 0.04), i * 60));
      } else if (bt.kind === "escupida" && bt.target !== undefined) {
        const tapada = story.arc === "tapada" && bt.actor === story.rival;
        sayIf((L_.cEscupidaL as (a: string, b: string) => string)(quien, nameOf(bt.target)), tapada ? 0.8 : calor);
        beep(note(16), 0.05, "square", 0.035);
        setTimeout(() => beep(note(11), 0.07, "triangle", 0.035), 50);
      }
    });
    const once = (id: string, at: number, fn: () => void): void => {
      if (prog >= at && !fired.has(id)) {
        fired.add(id);
        fn();
      }
    };
    const ganadora = nameOf(story.winner);
    const rival = nameOf(story.rival);
    if (story.arc === "remontada") once("arco", 0.74, () => sayIf(L_.cRemonta(ganadora), 0.8));
    if (story.arc === "duelo") {
      once("arco", 0.52, () => sayIf(L_.cDuelo(ganadora, rival), 0.7));
      once("foto", plan.foto, () => {
        sayIf(t("cFoto"), 0.95);
        flashRace = 1;
        beep(note(18), 0.03, "square", 0.05);
        setTimeout(() => beep(note(18), 0.03, "square", 0.04), 90);
      });
    }
    if (story.arc === "tapada") once("arco", 0.88, () => sayIf(L_.cCuela(ganadora), 0.9));
    if (story.arc === "duelo" && prog > 0.52 && prog < plan.foto) {
      const b = Math.floor(((prog - 0.52) * DUR) / 0.45);
      if (b !== latido) {
        latido = b;
        beep(note(0), 0.12, "sine", 0.065);
      }
    }
  }

  let hoofIn = 0, hoofStep = 0, droneIn = 0;
  function raceAudio(dt: number, prog: number): void {
    if (prog > 0.975) return;
    hoofIn -= dt;
    if (hoofIn <= 0) {
      hoofIn = prog > 0.8 ? 0.16 : 0.25;
      beep(note(hoofStep % 2 === 0 ? 0 : 3), 0.05, "square", 0.022);
      hoofStep++;
    }
    droneIn -= dt;
    if (droneIn <= 0) {
      droneIn = 0.7;
      beepFor(note(prog > 0.8 ? 4 : prog > 0.45 ? 2 : 0), 0.78, "sawtooth", 0.02);
    }
  }

  /* ---------------------------------------------------------- el cuadro */

  const qNow = (): number => Math.min(1, tRace / DUR);

  function update(dt: number): void {
    if (phase === "count") {
      tPhase += dt * paceFactor();
      const n = 3 - Math.floor(tPhase);
      if (n < lastBeepN && n >= 1) {
        lastBeepN = n;
        beep(note(n === 3 ? 9 : n === 2 ? 10 : 12), 0.18, "triangle", 0.06);
      }
      if (tPhase >= 3) {
        phase = "race";
        say(t("cStart"), 0.35);
        beep(note(14), 0.45, "square", 0.055);
        beep(note(9), 0.45, "square", 0.055);
      }
      return;
    }
    if (phase === "done") {
      tFreeze += dt * paceFactor();
      if (tFreeze > WINNER_HOLD) cleanup();
      return;
    }
    const lenta = tRace / DUR > plan.foto ? 0.4 : 1;
    tRace += dt * lenta;
    const prog = qNow();
    raceAudio(dt, prog);
    storyBeats(prog);
    const xs = lanes.map((_, k) => plan.pos(k, prog));
    let leader = 0;
    xs.forEach((x, k) => { if (x > (xs[leader] as number)) leader = k; });
    if (leader !== lastLeader && tRace > 1 && !saidLast) {
      lastLeader = leader;
      if (sayIf(T[getLang()].cLead(nameOf(leader)), 0.3 + 0.4 * prog)) {
        beep(note(12), 0.12, "triangle", 0.05);
        setTimeout(() => beep(note(15), 0.1, "triangle", 0.04), 70);
      }
    }
    if (!saidLast && prog > 0.8) {
      saidLast = true;
      sayIf(t("cLast"), 0.85);
      beep(note(13), 0.22, "triangle", 0.06);
    }
    const order = xs.map((x, k) => ({ x, k })).sort((a, b) => b.x - a.x);
    order.forEach(({ k }, puesto) => { rowPos[k] = (rowPos[k] as number) + (puesto - (rowPos[k] as number)) * Math.min(1, dt * 10); });
    const leadX = S.X0 + (xs[leader] as number) * S.TL;
    const camTarget = leadX - S.sw * 0.58;
    const camCap = S.X0 + S.TL - S.sw * (prog > 0.8 ? 0.62 : 0.86);
    camX += (Math.max(0, Math.min(camTarget, camCap)) - camX) * Math.min(1, dt * 2.6);
    base.dataset.puesto = String(order.findIndex((o) => o.k === story.winner) + 1);
    if (prog >= 1) finishNow();
  }

  function draw(now: number): void {
    const prog = qNow();
    const { u, sw, sh } = S;
    const tens = phase === "count" ? 0.1 : phase === "done" ? 1 : tension(story, prog);

    // Cámara y paralaje.
    let zoom = 1;
    let focusX = sw / 2, focusY = sh * 0.6;
    if (prog > plan.foto && phase !== "done") zoom = 1 + 0.25 * Math.min(1, (prog - plan.foto) / 0.02);
    if (phase === "done") {
      zoom = 1 + 0.18 * Math.min(1, tFreeze / 0.8);
      const wx = S.X0 + plan.pos(winnerLane, 1) * S.TL - camX;
      focusX = wx;
      focusY = S.laneY(winnerLane);
    }
    S.world.position.set(-camX, 0);
    S.scene.pivot.set(focusX, focusY);
    S.scene.position.set(focusX, focusY);
    S.scene.scale.set(zoom);
    S.far.x = -camX * 0.1;
    S.mid.x = -camX * 0.2;
    S.near.x = -camX * 0.35;
    S.stands.x = -camX * 0.7;
    S.clouds.x = -camX * 0.05 - now * 6 * u;
    S.sun.x = sw * 0.78 - camX * 0.02;

    // La hinchada: salta más cuanto más tensa está la carrera, y con el
    // ganador levanta los brazos.
    const people = (S.crowd as unknown as { people?: Texture[] }).people ?? [];
    const lo = camX * 0.7 - 20 * u, hi = camX * 0.7 + sw + 20 * u;
    S.crowd.forEach((sp, i) => {
      const b = S.crowdBase[i];
      if (!b) return;
      if (b.x < lo || b.x > hi) {
        sp.visible = false;
        return;
      }
      sp.visible = true;
      const jump = Math.max(0, Math.sin(now * (6 + tens * 6) + b.ph)) * (1 + tens * 6) * u;
      sp.y = b.y - jump;
      const up = tens > 0.7 && Math.sin(now * 3 + b.ph) > -0.2;
      const kind = Math.floor(((i * 7) % 16) / 2);
      sp.texture = (people[kind * 2 + (up ? 1 : 0)] ?? sp.texture) as Texture;
    });
    // Banderas en la tribuna, con los colores de los carriles.
    const fl = S.flags;
    fl.clear();
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.5) * (S.TL * 0.7 + sw) / 16 - sw * 0.5;
      if (x < lo - 60 * u || x > hi + 60 * u) continue;
      const y0 = S.trackTop - 90 * u - 10 * u;
      fl.moveTo(x, y0).lineTo(x, y0 - 34 * u).stroke({ width: 2 * u, color: CREAM });
      const pts: number[] = [];
      for (let j = 0; j <= 6; j++) pts.push(x - j * 5 * u, y0 - 34 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      for (let j = 6; j >= 0; j--) pts.push(x - j * 5 * u, y0 - 20 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      fl.poly(pts).fill(laneColor(i)).stroke({ width: 1.5 * u, color: INK });
    }

    // Las llamas.
    const fx = S.fx;
    fx.clear();
    for (let k = 0; k < N; k++) {
      const l = S.llamas[k] as Llama;
      const p = phase === "count" ? 0 : plan.pos(k, prog);
      const pPrev = phase === "count" ? 0 : plan.pos(k, Math.max(0, prog - 0.004));
      const speed = phase === "race" ? (p - pPrev) / 0.004 : 0;
      const x = S.X0 + p * S.TL;
      const y = S.laneY(k);
      l.root.position.set(x - 34 * S.laneScale(k), y);
      // El paso sale de lo caminado: quieta no mueve las patas.
      const ph = p * 95;
      const beat = phase === "race" ? plan.beatOf(k, prog) : null;
      const swing = 0.55;
      let lean = speed > 1.25 ? 0.07 : 0;
      let legA = [Math.sin(ph) * swing, Math.sin(ph + 0.9) * swing, Math.sin(ph + Math.PI) * swing, Math.sin(ph + Math.PI + 0.9) * swing];
      let neckRot = Math.sin(ph * 2) * 0.05;
      l.mark.visible = false;
      if (beat?.kind === "plantada") {
        legA = [0.25, -0.35, 0.25, -0.35];
        lean = -0.1;
        neckRot = -0.25;
        l.mark.visible = true;
        l.mark.text = "!";
      } else if (beat?.kind === "tropiezo") {
        lean = 0.35 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
      } else if (beat?.kind === "escupida") {
        neckRot = -0.35 * Math.sin(Math.PI * beat.p);
      } else if (beat?.kind === "escupido") {
        lean = -0.12 * Math.sin(Math.PI * beat.p * 3);
        l.mark.visible = true;
        l.mark.text = "?!";
      }
      l.legs.forEach((g, i) => { g.rotation = legA[i] ?? 0; });
      l.body.rotation = lean;
      l.body.y = speed > 0.1 ? -Math.abs(Math.sin(ph)) * 4 : 0;
      l.neck.rotation = neckRot;
      l.ears.forEach((e, i) => { e.rotation = Math.sin(ph * 2 + 1 + i) * 0.25; });
      l.tail.rotation = Math.sin(ph * 2) * 0.4;
      // La del ganador salta en el podio.
      if (phase === "done" && k === winnerLane) l.root.y = y - Math.abs(Math.sin(tFreeze * 7)) * 22 * u * Math.max(0, 1 - tFreeze / 2.6);
      l.tag.position.set(x - 40 * S.laneScale(k), y - 30 * S.laneScale(k));
      l.tag.alpha = phase === "done" ? 0.35 : 1;

      // Polvo: sale de lo que corre, y cada grano se calcula desde su hora.
      if (phase !== "count") {
        const every = 0.006;
        for (let e = Math.floor((prog - 0.03) / every); e <= Math.floor(prog / every); e++) {
          if (e < 0) continue;
          const qe = e * every;
          const age = (prog - qe) / 0.03;
          if (age < 0 || age > 1) continue;
          const sp = (plan.pos(k, qe) - plan.pos(k, Math.max(0, qe - 0.004))) / 0.004;
          if (sp < 0.5) continue;
          const px = S.X0 + plan.pos(k, qe) * S.TL - 30 * S.laneScale(k) - age * 26 * u - hash(e, k) * 10 * u;
          const py = y - 3 * u - age * (8 + hash(k, e) * 12) * u;
          fx.circle(px, py, (3 + age * 7) * u * S.laneScale(k)).fill({ color: dark ? 0x8a6a52 : 0xe0c49a, alpha: 0.45 * (1 - age) });
        }
        // Líneas de velocidad en el pique y en la remontada.
        if (speed > 1.3) {
          for (let j = 0; j < 3; j++) {
            const ly = y - (20 + j * 14) * S.laneScale(k);
            const lx = x - (70 + ((now * 900 + j * 37 + k * 11) % 60)) * u;
            fx.moveTo(lx, ly).lineTo(lx - 40 * u, ly).stroke({ width: 2 * u, color: 0xffffff, alpha: 0.6 });
          }
        }
        // La escupida: un arco de gotas hacia el carril de al lado.
        if (beat?.kind === "escupida") {
          const bt = story.beats.find((b) => b.kind === "escupida" && b.actor === k && prog >= b.at && prog < b.at + 0.05);
          if (bt?.target !== undefined) {
            const tx = S.X0 + plan.pos(bt.target, prog) * S.TL;
            const ty = S.laneY(bt.target) - 70 * S.laneScale(bt.target);
            const sx = x + 4 * u, sy = y - 78 * S.laneScale(k);
            for (let j = 0; j < 6; j++) {
              const f = Math.min(1, beat.p * 2) - j * 0.06;
              if (f < 0) continue;
              const gx = sx + (tx - sx) * f, gy = sy + (ty - sy) * f - Math.sin(Math.PI * f) * 40 * u;
              fx.circle(gx, gy, 3.2 * u).fill({ color: 0x9fe3ff, alpha: 0.9 });
            }
          }
        }
      }
    }

    // El minimapa: la carrera entera en una línea, arriba.
    const mini = S.mini;
    mini.clear();
    const mw = S.portrait ? sw - 40 * u : Math.min(sw * 0.46, 560 * u);
    const mx = (sw - mw) / 2, my = (S.portrait ? 100 : 82) + 16 * u;
    mini.roundRect(mx - 10 * u, my - 12 * u, mw + 20 * u, 24 * u, 12 * u).fill({ color: INK, alpha: 0.75 });
    mini.rect(mx, my - 1.5 * u, mw, 3 * u).fill({ color: CREAM, alpha: 0.5 });
    for (let c = 0; c < 4; c++) mini.rect(mx + mw - 6 * u + (c % 2) * 3 * u, my - 7 * u + Math.floor(c / 2) * 7 * u, 3 * u, 7 * u).fill(c % 3 === 0 ? 0xffffff : INK);
    const minis = lanes.map((_, k) => ({ k, p: phase === "count" ? 0 : plan.pos(k, prog) })).sort((a, b) => a.p - b.p);
    for (const { k, p } of minis) {
      const cx = mx + Math.max(0, Math.min(1, p)) * mw;
      const lead = rowPos[k] !== undefined && Math.round(rowPos[k] as number) === 0 && phase !== "count";
      mini.circle(cx, my, (lead ? 7 : 5) * u).fill(laneColor(k)).stroke({ width: 2 * u, color: INK });
    }

    // La tabla: filas que se deslizan a su puesto.
    const rowH = 22 * u;
    S.rows.forEach((r, k) => {
      r.y = (rowPos[k] as number) * rowH;
      const txt = r.children[2] as Text;
      txt.text = String(Math.round(rowPos[k] as number) + 1);
      r.alpha = phase === "done" && k !== winnerLane ? 0.4 : 1;
    });

    // Cuenta, foto, destellos, cartel y papel picado.
    tlCount.time(phase === "count" ? tPhase : 4);
    S.foto.visible = prog > plan.foto && phase === "race";
    flashRace = Math.max(0, flashRace - 0.08);
    if (phase !== "done") S.flash.alpha = flashRace * 0.8;
    tlWin.time(phase === "done" ? tFreeze : 0);
    S.plate.visible = phase === "done";
    const cf = S.confetti;
    cf.clear();
    if (phase === "done") {
      for (let i = 0; i < 180; i++) {
        const t0 = hash(i, 7) * 0.4;
        const tt = tFreeze - t0;
        if (tt < 0) continue;
        const vx = (hash(i, 1) - 0.5) * 900 * u, vy = -(300 + hash(i, 2) * 700) * u;
        const x = sw / 2 + (hash(i, 3) - 0.5) * sw * 0.3 + vx * tt;
        const y = sh * 0.3 + vy * tt + 900 * u * tt * tt;
        if (y > sh + 20) continue;
        const rot = hash(i, 4) * 6 + tt * (4 + hash(i, 5) * 8);
        const w = 9 * u, h = 5 * u * Math.abs(Math.cos(rot));
        cf.rect(x - w / 2, y - h / 2, w, Math.max(1, h)).fill(laneColor(i));
      }
    }

    roar(tens);
    app.renderer.render(app.stage);
  }

  /* ---------------------------------------------------------- el bucle */
  let rafId = 0;
  let prev = 0;
  let start = -1;
  function loop(now: number): void {
    if (phase === "dead") return;
    const pace = paceFactor();
    const dt = prev ? Math.min(0.05, (now - prev) / 1000) / pace : 0;
    prev = now;
    if (start < 0) start = now;
    update(dt);
    // `update` pudo cerrar el estadio.
    if ((phase as string) === "dead") return;
    draw((now - start) / 1000);
    rafId = requestAnimationFrame(loop);
  }

  function onResize(): void {
    app.renderer.resize(innerWidth, innerHeight);
    S.kill();
    S = build();
    choreograph();
  }
  addEventListener("resize", onResize);

  function cleanup(): void {
    if (phase === "dead") return;
    phase = "dead";
    cancelAnimationFrame(rafId);
    removeEventListener("resize", onResize);
    roar.stop();
    tlCount.kill();
    tlWin.kill();
    S.kill();
    for (const tx of faces.values()) tx.destroy(true);
    app.destroy({ removeView: true }, { children: true });
    base.style.visibility = "";
    ov.style.display = "none";
    document.body.style.overflow = "";
    registerSkip(null);
    setPickSeed(null);
    stopNarrator();
    stopMusic();
    $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
    done();
  }

  rafId = requestAnimationFrame(loop);
}

/**
 * El ruido de la tribuna: ruido filtrado en la banda de las voces, con un
 * vaivén lento, que sube con la tensión. No es música ni una nota: es gente.
 */
function crowdNoise(): ((tension: number) => void) & { stop: () => void } {
  const ctx = audio();
  const noop = Object.assign((_: number) => {}, { stop: () => {} });
  if (!ctx || isMuted()) return noop;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    d[i] = ((s >>> 8) / 8388608 - 1) * 0.6;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start();
  let dead = false;
  const set = (tension: number): void => {
    if (dead) return;
    const target = isMuted() ? 0 : 0.012 + 0.05 * tension * tension;
    g.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
    bp.frequency.setTargetAtTime(800 + 500 * tension, ctx.currentTime, 0.4);
  };
  return Object.assign(set, {
    stop: () => {
      dead = true;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => { try { src.stop(); } catch { /* ya parado */ } }, 500);
    },
  });
}
