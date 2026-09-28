import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { gsap } from "gsap";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, isMuted, audio, note } from "../../sound";
import { tension } from "../drama";
import { WINNER_HOLD, shorten, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, YELLOW, hash, mountPixi, seeded, type PixiStage } from "../pixi/stage";
import { planRace, type Plan } from "./plan";

/**
 * La carrera en PixiJS y GSAP, con el director de cámara. Dos pieles: llamas
 * por la cordillera y cohetes por el espacio.
 *
 * Es la misma carrera que `race.ts`: el mismo plan, la misma historia del
 * director de emoción y el mismo relato, con la misma ronda. Lo que cambia es
 * cómo se mira. La cámara arranca pegada a la largada, sigue a la punta, se
 * mete en cada momento de la historia (el tropiezo, la plantada, la escupida),
 * se cierra sobre las de adelante en la recta final, va en cámara lenta a la
 * meta en la foto, y pega un golpe cuando cruza la ganadora.
 *
 * Nada de eso decide nada: la cámara mira lo que el plan ya decidió.
 */

const DUR = 15;
type Skin = "andes" | "stellar";

/** Colores de lana de llama: blanca, café, crema, oscura, gris. */
const FUR = [0xf3ead8, 0xa0683a, 0xe4c99a, 0x5b3a29, 0xc2bab0, 0x8a5a3c, 0xefe3cc, 0x6e4a36];

interface Runner {
  root: Container;
  tag: Container;
  mark: Text;
  /** Pone la postura: `ph` es la fase del paso, `speed` 1 es ir al ritmo de la carrera. */
  pose(ph: number, speed: number, beat: { kind: string; p: number } | null, now: number): void;
}

const dim = (c: number, f: number): number => {
  const r = ((c >> 16) & 255) * f, g = ((c >> 8) & 255) * f, b = (c & 255) * f;
  return (Math.round(Math.min(255, r)) << 16) | (Math.round(Math.min(255, g)) << 8) | Math.round(Math.min(255, b));
};

export async function llamasPixi(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
  skin: Skin = "andes",
): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  const space = skin === "stellar";
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const dark = space || S.dark;
  const voice = space ? "R" : "L";

  setGameLength(DUR, WINNER_HOLD + 3);

  // El mismo azar que `race.ts`, consumido en el mismo orden: la misma ronda
  // cuenta la misma historia en los dos motores. `race.ts` siembra su paisaje
  // entre los carriles y la historia: una semilla de paso por corredor, 24
  // cerros, 18 lomas, 6 nubes, y 60 estrellas (150 en el espacio).
  const stars = space ? 150 : 60;
  const plan: Plan = planRace(names, winnerIdx, rng, {
    sceneryDraws: Math.min(8, names.length) + 24 * 2 + 18 * 2 + 6 * 4 + stars * 3,
    beforePlace: () => S.say(t(space ? "cReadyStellar" : "cReady"), 0.1),
  });
  const { story, lanes } = plan;
  S.mark("arco", story.arc);
  const N = lanes.length;
  const nameOf = (k: number): string => names[lanes[k] as number] ?? "";
  const deco = seeded(parseInt(beacon.randomness.slice(24, 32), 16));

  /* ============================================================ geometría */
  interface Geo {
    sw: number; sh: number; u: number; portrait: boolean;
    X0: number; TL: number; trackTop: number; trackBot: number; laneH: number;
    laneY: (k: number) => number; laneScale: (k: number) => number; midY: number;
  }
  const geo = (): Geo => {
    const sw = S.sw(), sh = S.sh(), u = S.u(), portrait = S.portrait();
    const trackTop = sh * (portrait ? 0.36 : 0.35);
    const trackBot = sh - S.bottom() - 6 * u;
    const laneH = (trackBot - trackTop) / N;
    return {
      sw, sh, u, portrait, trackTop, trackBot, laneH,
      X0: sw * (portrait ? 0.36 : 0.2),
      TL: 2.4 * Math.max(sw, sh * 0.9),
      laneY: (k) => trackTop + laneH * (k + 0.82),
      laneScale: (k) => ((laneH * 2.3) / 86) * (0.88 + 0.24 * (N > 1 ? k / (N - 1) : 1)),
      midY: (trackTop + trackBot) / 2,
    };
  };
  let G = geo();

  /* =============================================================== escena */
  interface Layers {
    far: Container; mid: Container; near: Container; stands: Container; world: Container;
    crowd: Sprite[]; crowdBase: { x: number; y: number; ph: number }[]; people: Texture[];
    flags: Graphics; fx: Graphics; runners: Runner[]; clouds: Container; sun: Container;
    mini: Graphics; rows: Container[]; count: Text[]; foto: Container;
  }

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
  function makeLlama(k: number, sc: number): Runner {
    const fur = FUR[(lanes[k] as number) % FUR.length] ?? 0xf3ead8;
    const root = new Container();
    root.addChild(new Graphics().ellipse(0, 0, 24, 5).fill({ color: 0x000000, alpha: 0.28 }));
    const body = new Container();
    root.addChild(body);
    const leg = (x: number, far: boolean): Graphics => {
      const g = new Graphics()
        .roundRect(-3, 0, 6, 30, 3).fill(far ? dim(fur, 0.72) : fur).stroke({ width: 2, color: INK })
        .roundRect(-3.5, 26, 7, 5, 2).fill(INK);
      g.position.set(x, -30);
      return g;
    };
    const legs = [leg(-12, true), leg(15, true), leg(-16, false), leg(11, false)];
    body.addChild(legs[0] as Graphics, legs[1] as Graphics);
    const tail = new Graphics().ellipse(-3, -2, 6, 5).fill(fur).stroke({ width: 2, color: INK });
    tail.position.set(-24, -40);
    body.addChild(tail);
    const torso = new Graphics();
    for (let i = 0; i < 6; i++) torso.circle(-17 + i * 7, -44 + Math.sin(i * 1.7) * 1.5, 5.5).fill(fur);
    torso.ellipse(0, -36, 24, 13).fill(fur).stroke({ width: 2.2, color: INK });
    body.addChild(torso);
    const blanket = new Graphics()
      .roundRect(-15, -48, 30, 17, 4).fill(S.color(k)).stroke({ width: 2, color: INK })
      .rect(-15, -43, 30, 2.4).fill(YELLOW)
      .rect(-15, -38.5, 30, 2.4).fill(0x2f9e44);
    body.addChild(blanket);
    const bib = S.text(String(k + 1), { fontSize: 11, fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 } });
    bib.anchor.set(0.5);
    bib.position.set(0, -40);
    body.addChild(bib, legs[2] as Graphics, legs[3] as Graphics);
    const neck = new Container();
    neck.position.set(16, -42);
    const neckG = new Graphics()
      .roundRect(-5, -34, 11, 38, 5).fill(fur).stroke({ width: 2.2, color: INK })
      .ellipse(6, -38, 11, 8).fill(fur).stroke({ width: 2.2, color: INK })
      .ellipse(14, -36, 5.5, 4.5).fill(dim(fur, 0.8)).stroke({ width: 1.6, color: INK })
      .circle(6, -40, 1.8).fill(INK);
    const earL = new Graphics().poly([-3, 0, 0, -11, 3, 0]).fill(fur).stroke({ width: 1.8, color: INK });
    earL.position.set(1, -44);
    const earR = new Graphics().poly([-3, 0, 0, -12, 3, 0]).fill(dim(fur, 0.85)).stroke({ width: 1.8, color: INK });
    earR.position.set(6, -45);
    neck.addChild(earR, neckG, earL);
    body.addChild(neck);
    const mark = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
    mark.anchor.set(0.5, 1);
    mark.position.set(20, -98);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);
    return {
      root, mark, tag: S.chip(nameOf(k)),
      pose(ph, speed, beat) {
        const sw = 0.55;
        let lean = speed > 1.25 ? 0.07 : 0;
        let legA = [Math.sin(ph) * sw, Math.sin(ph + 0.9) * sw, Math.sin(ph + Math.PI) * sw, Math.sin(ph + Math.PI + 0.9) * sw];
        let neckRot = Math.sin(ph * 2) * 0.05;
        mark.visible = false;
        if (beat?.kind === "plantada") {
          legA = [0.25, -0.35, 0.25, -0.35];
          lean = -0.1;
          neckRot = -0.25;
          mark.visible = true;
          mark.text = "!";
        } else if (beat?.kind === "tropiezo") lean = 0.35 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
        else if (beat?.kind === "escupida") neckRot = -0.35 * Math.sin(Math.PI * beat.p);
        else if (beat?.kind === "escupido") {
          lean = -0.12 * Math.sin(Math.PI * beat.p * 3);
          mark.visible = true;
          mark.text = "?!";
        }
        legs.forEach((g, i) => { g.rotation = legA[i] ?? 0; });
        body.rotation = lean;
        body.y = speed > 0.1 ? -Math.abs(Math.sin(ph)) * 4 : 0;
        neck.rotation = neckRot;
        earL.rotation = Math.sin(ph * 2 + 1) * 0.25;
        earR.rotation = Math.sin(ph * 2 + 2) * 0.25;
        tail.rotation = Math.sin(ph * 2) * 0.4;
      },
    };
  }

  /** Un cohete, mirando a la derecha, con la cara de su piloto en la ventanilla. */
  function makeRocket(k: number, sc: number): Runner {
    const root = new Container();
    const body = new Container();
    root.addChild(body);
    const flame = new Graphics();
    body.addChild(flame);
    const col = S.color(k);
    const hull = new Graphics()
      .poly([-30, -46, -44, -60, -38, -46]).fill(col).stroke({ width: 2, color: INK })
      .poly([-30, -26, -44, -12, -38, -26]).fill(col).stroke({ width: 2, color: INK })
      .roundRect(-36, -50, 58, 28, 13).fill(0xeef0f8).stroke({ width: 2.4, color: INK })
      .poly([20, -50, 44, -36, 20, -22]).fill(col).stroke({ width: 2.4, color: INK })
      .rect(-22, -50, 6, 28).fill(col)
      .circle(4, -36, 10).fill(0x1d2336).stroke({ width: 2.4, color: INK });
    body.addChild(hull);
    const av = new Sprite(S.face(nameOf(k)));
    av.width = av.height = 14;
    av.anchor.set(0.5);
    av.position.set(4, -36);
    body.addChild(av);
    const bib = S.text(String(k + 1), { fontSize: 10, fontWeight: "900", fill: INK });
    bib.anchor.set(0.5);
    bib.position.set(-8, -36);
    body.addChild(bib);
    const mark = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
    mark.anchor.set(0.5, 1);
    mark.position.set(0, -66);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);
    return {
      root, mark, tag: S.chip(nameOf(k)),
      pose(ph, speed, beat, now) {
        // La llama del motor: larga cuando acelera, corta y roja cuando se apaga.
        const off = beat?.kind === "plantada";
        const len = off ? 4 : 14 + Math.min(2, speed) * 16 + Math.sin(now * 40 + k) * 4;
        flame.clear()
          .poly([-40, -44, -40 - len, -36, -40, -28]).fill(off ? 0xd7263d : 0xff9f1c)
          .poly([-40, -40, -40 - len * 0.6, -36, -40, -32]).fill(0xfff3c4);
        let rot = speed > 1.25 ? -0.04 : Math.sin(ph * 0.5) * 0.02;
        mark.visible = false;
        if (off) {
          mark.visible = true;
          mark.text = "!";
          rot = 0.08 * Math.sin(now * 30);
        } else if (beat?.kind === "tropiezo") rot = 0.4 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
        else if (beat?.kind === "escupido") {
          rot = 0.1 * Math.sin(Math.PI * beat.p * 3);
          mark.visible = true;
          mark.text = "?!";
        }
        body.rotation = rot;
        body.y = Math.sin(ph * 0.7 + k) * 2;
      },
    };
  }

  let L!: Layers;

  function build(): void {
    G = geo();
    const { sw, sh, u, X0, TL, trackTop, trackBot, laneH } = G;
    const finishX = X0 + TL;
    const standsTop = trackTop - 90 * u;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));

    // El cielo, quieto detrás de todo.
    const sky = new Sprite(
      gradientTexture(
        space ? [[0, "#05071c"], [0.6, "#140b33"], [1, "#2a1250"]]
          : dark ? [[0, "#0b1230"], [0.55, "#2a1b48"], [1, "#c0603f"]]
            : [[0, "#5aa9e6"], [0.6, "#a8d8f0"], [1, "#ffe0a8"]],
      ),
    );
    sky.width = sw;
    sky.height = space ? sh : standsTop + 60 * u;
    S.bg.addChild(sky);
    if (space) {
      const sg = new Graphics();
      for (let i = 0; i < 220; i++) sg.circle(deco() * sw, deco() * sh, (0.4 + deco() * 1.4) * u).fill({ color: 0xffffff, alpha: 0.4 + deco() * 0.6 });
      S.bg.addChild(sg);
    }
    const sun = new Container();
    const halo = new Sprite(glowTexture(space ? "rgba(150,110,255,0.55)" : dark ? "rgba(255,240,200,0.55)" : "rgba(255,245,200,0.9)"));
    halo.anchor.set(0.5);
    halo.width = halo.height = (space ? 360 : 230) * u;
    const disc = new Graphics().circle(0, 0, (space ? 58 : 30) * u).fill(space ? 0x7b61ff : dark ? 0xf4ecd8 : 0xfff3c4);
    if (space) disc.ellipse(0, 0, 100 * u, 16 * u).stroke({ width: 5 * u, color: 0xc9b8ff, alpha: 0.8 });
    sun.addChild(halo, disc);
    sun.position.set(sw * 0.78, (space ? sh * 0.2 : standsTop * 0.32));
    S.bg.addChild(sun);
    const clouds = new Container();
    for (let i = 0; i < 7; i++) {
      const g = new Graphics();
      const cx = deco() * sw * 1.4, cy = standsTop * (0.12 + deco() * 0.45), s = (0.6 + deco() * 0.8) * u;
      for (let j = 0; j < 5; j++) g.ellipse(cx + (j - 2) * 26 * s, cy + Math.sin(j * 2.1) * 6 * s, 30 * s, 16 * s);
      g.fill({ color: space ? 0x6a3fb0 : dark ? 0x3a3060 : 0xffffff, alpha: space ? 0.18 : dark ? 0.55 : 0.85 });
      clouds.addChild(g);
    }
    S.bg.addChild(clouds);

    // Lo que mira la cámara: capas con paralaje y la pista.
    const range = (baseY: number, amp: number, step: number, col: number, snow: boolean, width: number): Graphics => {
      const g = new Graphics();
      const pts: number[] = [-sw, baseY];
      const peaks: [number, number][] = [];
      for (let x = -sw; x <= width; x += step * (0.6 + deco() * 0.8)) {
        const y = baseY - amp * (0.35 + deco() * 0.65);
        if (space) {
          // En el espacio no hay cordillera: hay cúpulas de una base lunar.
          pts.push(x, baseY - amp * 0.2);
        } else pts.push(x, y);
        peaks.push([x, y]);
      }
      pts.push(width, baseY, width, sh * 2, -sw, sh * 2);
      g.poly(pts).fill(col);
      if (space) for (const [x, y] of peaks) g.circle(x, baseY - amp * 0.2, (baseY - y) * 0.45).fill(dim(col, 1.3));
      if (snow && !space) {
        for (const [x, y] of peaks) {
          if (baseY - y < amp * 0.7) continue;
          g.poly([x - 22 * u, y + 20 * u, x, y, x + 22 * u, y + 20 * u, x + 8 * u, y + 14 * u, x - 6 * u, y + 18 * u]).fill(0xeef0f8);
        }
      }
      return g;
    };
    const far = new Container();
    far.addChild(range(standsTop + 10 * u, 150 * u, 90 * u, space ? 0x241a52 : dark ? 0x3b3563 : 0x8a9cc0, true, sw * 3 + TL * 0.2));
    const mid = new Container();
    mid.addChild(range(standsTop + 30 * u, 80 * u, 70 * u, space ? 0x1c1442 : dark ? 0x2a2848 : 0x6f8f6a, false, sw * 3 + TL * 0.35));
    const near = new Container();
    near.addChild(range(standsTop + 50 * u, 40 * u, 60 * u, space ? 0x150f33 : dark ? 0x201d36 : 0xb89a62, false, sw * 3 + TL * 0.5));
    S.scene.addChild(far, mid, near);

    // La tribuna con la hinchada (en el espacio, la sala de control).
    const stands = new Container();
    const standsW = TL * 0.75 + sw * 3;
    const sg = new Graphics().rect(-sw, standsTop, standsW, trackTop - standsTop + 4 * u).fill(space ? 0x1a1640 : dark ? 0x2b2640 : 0x5b5f79);
    for (let tier = 0; tier < 3; tier++) sg.rect(-sw, standsTop + (tier + 1) * 26 * u, standsW, 4 * u).fill({ color: 0x000000, alpha: 0.28 });
    sg.rect(-sw, standsTop - 10 * u, standsW, 10 * u).fill(INK);
    stands.addChild(sg);
    const people: Texture[] = [];
    const skinTones = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
    for (let i = 0; i < 8; i++) {
      for (const up of [false, true]) {
        const g = new Graphics();
        const shirt = i < 5 ? S.color(i) : ([0xffffff, 0x2f9e44, 0x1c64c8][i - 5] ?? 0xffffff);
        g.roundRect(-4, -8, 8, 9, 2).fill(shirt);
        g.circle(0, -11, 3.4).fill(skinTones[i % skinTones.length] ?? 0xf1c27d);
        if (up) g.moveTo(-3.5, -7).lineTo(-6, -15).moveTo(3.5, -7).lineTo(6, -15).stroke({ width: 1.6, color: shirt });
        people.push(S.app.renderer.generateTexture({ target: g, resolution: 2 * Math.min(window.devicePixelRatio || 1, 2) }));
        g.destroy();
      }
    }
    const crowd: Sprite[] = [];
    const crowdBase: Layers["crowdBase"] = [];
    for (let tier = 0; tier < 3; tier++) {
      for (let x = -sw; x < standsW - sw; x += (11 + deco() * 7) * u) {
        const sp = new Sprite(people[Math.floor(deco() * 8) * 2] as Texture);
        sp.anchor.set(0.5, 1);
        sp.scale.set(u * (1.25 + tier * 0.1));
        sp.tint = tier === 0 ? 0x9a9ab0 : tier === 1 ? 0xc8c8d6 : 0xffffff;
        const y = standsTop + (tier + 1) * 26 * u;
        sp.position.set(x, y);
        stands.addChild(sp);
        crowd.push(sp);
        crowdBase.push({ x, y, ph: deco() * 6.28 });
      }
    }
    const flags = new Graphics();
    stands.addChild(flags);
    S.scene.addChild(stands);

    const world = new Container();
    S.scene.addChild(world);
    const ground = new Graphics();
    ground.rect(-sw * 2, trackTop - 6 * u, TL + sw * 5, sh * 2).fill(space ? 0x221a4e : dark ? 0x3d2b22 : 0xb98552);
    for (let k = 0; k < N; k++) {
      ground.rect(-sw * 2, trackTop + k * laneH, TL + sw * 5, laneH).fill({ color: k % 2 ? 0x000000 : 0xffffff, alpha: dark ? 0.05 : 0.06 });
    }
    for (let k = 1; k < N; k++) {
      const y = trackTop + k * laneH;
      for (let x = -sw * 2; x < TL + sw * 3; x += 34 * u) ground.rect(x, y - 1, 18 * u, 2).fill({ color: space ? 0x9fe3ff : 0xffffff, alpha: space ? 0.4 : 0.28 });
    }
    ground.rect(-sw * 2, trackTop - 8 * u, TL + sw * 5, 4 * u).fill(space ? 0x9fe3ff : CREAM);
    for (let x = -sw * 2; x < TL + sw * 3; x += 60 * u) ground.rect(x, trackTop - 20 * u, 4 * u, 16 * u).fill(space ? 0x9fe3ff : CREAM);
    ground.rect(-sw * 2, trackTop - 20 * u, TL + sw * 5, 3 * u).fill(space ? 0x9fe3ff : CREAM);
    ground.rect(X0 - 3 * u, trackTop, 6 * u, trackBot - trackTop).fill({ color: 0xffffff, alpha: 0.85 });
    const cell = 9 * u;
    for (let y = trackTop, r = 0; y < trackBot; y += cell, r++) {
      for (let c = 0; c < 3; c++) ground.rect(finishX + c * cell, y, cell, cell).fill((r + c) % 2 ? INK : 0xffffff);
    }
    world.addChild(ground);
    for (let i = 1; i < 10; i++) {
      const x = X0 + TL * (i / 10);
      const post = new Graphics()
        .rect(x - 2 * u, trackTop - 46 * u, 4 * u, 30 * u).fill(CREAM)
        .roundRect(x - 20 * u, trackTop - 62 * u, 40 * u, 20 * u, 4 * u).fill(dark ? 0x2b2640 : 0xffffff).stroke({ width: 2 * u, color: INK });
      const tx = S.text(space ? `${(10 - i) * 1000} km` : `${100 - i * 10} m`, { fontFamily: MONO, fontSize: 11 * u, fontWeight: "800", fill: dark ? CREAM : INK });
      tx.anchor.set(0.5);
      tx.position.set(x, trackTop - 52 * u);
      world.addChild(post, tx);
    }
    const arch = new Graphics()
      .rect(finishX - 4 * u, trackTop - 110 * u, 8 * u, 110 * u).fill(CREAM).stroke({ width: 2 * u, color: INK })
      .roundRect(finishX - 70 * u, trackTop - 138 * u, 140 * u, 34 * u, 6 * u).fill(YELLOW).stroke({ width: 3 * u, color: INK });
    const meta = S.text(getLang() === "es" ? "META" : "FINISH", { fontSize: 22 * u, fontWeight: "900", fill: INK });
    meta.anchor.set(0.5);
    meta.position.set(finishX, trackTop - 121 * u);
    world.addChild(arch, meta);

    const runners: Runner[] = [];
    const tagsLayer = new Container();
    const runnersLayer = new Container();
    for (let k = 0; k < N; k++) {
      const r = space ? makeRocket(k, G.laneScale(k)) : makeLlama(k, G.laneScale(k));
      runners.push(r);
      runnersLayer.addChild(r.root);
      tagsLayer.addChild(r.tag);
    }
    const fx = new Graphics();
    // En el espacio el nombre va encima: la llama del motor sale de atrás del
    // chip en vez de taparlo.
    if (space) world.addChild(runnersLayer, tagsLayer, fx);
    else world.addChild(tagsLayer, runnersLayer, fx);

    // La interfaz: viñeta, minimapa, tabla, cuenta y foto.
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
    S.hud.addChild(vignette);
    const mini = new Graphics();
    S.hud.addChild(mini);
    const board = new Container();
    const rows: Container[] = [];
    const rowH = 22 * u;
    for (let k = 0; k < N; k++) {
      const r = new Container();
      const bgr = new Graphics().roundRect(0, 0, 168 * u, rowH - 3 * u, 4 * u).fill({ color: INK, alpha: 0.72 });
      const num = new Graphics().roundRect(2 * u, 2 * u, 18 * u, rowH - 7 * u, 3 * u).fill(S.color(k));
      const pos = S.text("", { fontSize: 11 * u, fontWeight: "900", fill: INK });
      pos.anchor.set(0.5);
      pos.position.set(11 * u, (rowH - 3 * u) / 2);
      const av = new Sprite(S.face(nameOf(k)));
      av.width = av.height = 14 * u;
      av.position.set(24 * u, 2.5 * u);
      const nm = S.text(shorten(nameOf(k), 16), { fontSize: 11 * u, fontWeight: "700", fill: CREAM });
      nm.position.set(42 * u, 3.5 * u);
      r.addChild(bgr, num, pos, av, nm);
      board.addChild(r);
      rows.push(r);
    }
    board.position.set(12 * u, S.top() + 40 * u);
    board.visible = !G.portrait;
    S.hud.addChild(board);
    const count: Text[] = ["3", "2", "1", getLang() === "es" ? "¡YA!" : "GO!"].map((s) => {
      const tx = S.text(s, {
        fontSize: 190 * u, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 18 * u },
        dropShadow: { color: INK, distance: 10 * u, angle: Math.PI / 4, blur: 0, alpha: 1 },
      });
      tx.anchor.set(0.5);
      tx.position.set(sw / 2, sh * 0.42);
      tx.alpha = 0;
      S.hud.addChild(tx);
      return tx;
    });
    const foto = new Container();
    foto.addChild(new Graphics().rect(0, 0, sw, sh * 0.1).fill(INK).rect(0, sh * 0.9, sw, sh * 0.1).fill(INK));
    const fotoTx = S.text(getLang() === "es" ? "● FOTO" : "● PHOTO", { fontFamily: MONO, fontSize: 26 * u, fontWeight: "900", fill: 0xff4d4d, letterSpacing: 6 * u });
    fotoTx.position.set(20 * u, sh * 0.1 + 12 * u);
    foto.addChild(fotoTx);
    foto.visible = false;
    S.hud.addChild(foto);

    L = { far, mid, near, stands, world, crowd, crowdBase, people, flags, fx, runners, clouds, sun, mini, rows, count, foto };
    choreograph();
  }

  /* ========================================================= coreografía */
  const tlCount = gsap.timeline({ paused: true });
  S.onCleanup(() => tlCount.kill());
  function choreograph(): void {
    tlCount.clear();
    L.count.forEach((tx, i) => {
      tlCount
        .fromTo(tx.scale, { x: 2.6, y: 2.6 }, { x: 1, y: 1, duration: 0.45, ease: "back.out(2.2)" }, i)
        .fromTo(tx, { alpha: 0 }, { alpha: 1, duration: 0.08 }, i)
        .to(tx, { alpha: 0, duration: 0.25 }, i + (i === 3 ? 0.55 : 0.75));
    });
  }

  build();
  const crown = S.crown(names, winners);
  S.onResize(() => {
    build();
    // La cámara conserva lo que mira: solo cambia el tamaño.
  });

  /* ============================================================== estado */
  let phase: "count" | "race" | "done" = "count";
  let tPhase = 0, tRace = 0, tFreeze = 0, lastLeader = -1, saidLast = false, finished = false;
  let lastBeepN = 4;
  const rowPos = lanes.map((_, k) => k);
  const winnerLane = story.winner;
  const qNow = (): number => Math.min(1, tRace / DUR);
  const xOf = (k: number, q: number): number => G.X0 + plan.pos(k, q) * G.TL;

  // Arranca pegada a la largada.
  cam.cut(G.X0 - 20 * G.u, G.midY, G.portrait ? 1.3 : 1.55);

  skipFn = (): void => {
    if (finished) return;
    phase = "race";
    tRace = DUR;
    finishNow();
  };

  function finishNow(): void {
    finished = true;
    phase = "done";
    tFreeze = 0;
    S.say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    cam.punch(0.12).shake(14 * G.u);
  }

  const roar = space ? null : crowdNoise();

  /* ---------------------------------------------------------------- relato */
  const fired = new Set<string>();
  let lastSayAt = -99;
  let lastHeat = 0;
  function sayIf(msg: string, heat: number): boolean {
    const now = tRace / paceFactor();
    if (now - lastSayAt < 1.1 && heat < lastHeat + 0.3) return false;
    lastSayAt = now;
    lastHeat = heat;
    S.say(msg, heat);
    return true;
  }
  const key = (base: string): string => `${base}${voice}`;
  let latido = -1;
  /** El momento de la historia que la cámara está mirando, y hasta cuándo. */
  let shot: { k: number; until: number; zoom: number } | null = null;
  function storyBeats(prog: number): void {
    const L_ = T[getLang()];
    const calor = 0.35 + 0.5 * tension(story, prog);
    story.beats.forEach((bt, n) => {
      const id = `b${n}`;
      if (prog < bt.at || fired.has(id)) return;
      fired.add(id);
      const quien = nameOf(bt.actor);
      const suya = bt.actor === story.winner;
      // La cámara se mete en cada momento de la historia.
      shot = { k: bt.target ?? bt.actor, until: prog + 0.06, zoom: bt.kind === "tropiezo" ? 1.7 : 1.5 };
      if (bt.kind === "plantada") {
        sayIf((L_[key("cPlantada")] as (n: string) => string)(quien), calor);
        beep(note(8), 0.12, "triangle", 0.045);
        setTimeout(() => beep(note(3), 0.16, "triangle", 0.04), 120);
      } else if (bt.kind === "tropiezo") {
        sayIf((L_[key("cTropiezo")] as (n: string) => string)(quien), suya ? 0.85 : calor);
        beep(note(1), 0.09, "square", 0.05);
        cam.punch(0.06).shake(8 * G.u);
      } else if (bt.kind === "pique") {
        sayIf((L_[key("cPique")] as (n: string) => string)(quien), calor);
        [10, 12, 14].forEach((g, i) => setTimeout(() => beep(note(g), 0.08, "triangle", 0.04), i * 60));
      } else if (bt.kind === "escupida" && bt.target !== undefined) {
        const tapada = story.arc === "tapada" && bt.actor === story.rival;
        sayIf((L_[key("cEscupida")] as (a: string, b: string) => string)(quien, nameOf(bt.target)), tapada ? 0.8 : calor);
        beep(note(16), 0.05, "square", 0.035);
        setTimeout(() => beep(note(11), 0.07, "triangle", 0.035), 50);
        cam.punch(0.04);
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
        cam.punch(0.08);
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
      beep(note(hoofStep % 2 === 0 ? 0 : 3), 0.05, space ? "sawtooth" : "square", 0.022);
      hoofStep++;
    }
    droneIn -= dt;
    if (droneIn <= 0) {
      droneIn = 0.7;
      beepFor(note(prog > 0.8 ? 4 : prog > 0.45 ? 2 : 0), 0.78, "sawtooth", 0.02);
    }
  }

  /* ---------------------------------------------------------- el guion */
  function update(dt: number): void {
    if (phase === "count") {
      tPhase += dt * paceFactor();
      const n = 3 - Math.floor(tPhase);
      if (n < lastBeepN && n >= 1) {
        lastBeepN = n;
        beep(note(n === 3 ? 9 : n === 2 ? 10 : 12), 0.18, "triangle", 0.06);
        cam.punch(0.03);
      }
      // En la cuenta la cámara se va abriendo de a poco, sobre la largada.
      cam.lookAt(G.X0 - 20 * G.u + G.sw * 0.04 * Math.min(3, tPhase), G.midY, (G.portrait ? 1.3 : 1.55) - 0.12 * Math.min(3, tPhase), 2);
      if (tPhase >= 3) {
        phase = "race";
        S.say(t("cStart"), 0.6);
        beep(note(14), 0.45, "square", 0.055);
        beep(note(9), 0.45, "square", 0.055);
        cam.punch(0.08).shake(6 * G.u);
      }
      return;
    }
    if (phase === "done") {
      tFreeze += dt * paceFactor();
      // Con la ganadora ya en la meta, la cámara se le acerca despacio.
      cam.lookAt(xOf(winnerLane, 1) - 20 * G.u, G.laneY(winnerLane) - 40 * G.u, G.portrait ? 1.35 : 1.6, 1.6);
      if (tFreeze > WINNER_HOLD) {
        roar?.stop();
        S.cleanup();
      }
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
    S.mark("puesto", String(order.findIndex((o) => o.k === story.winner) + 1));

    // La cámara. Por defecto sigue a la punta, un poco adelantada, y se
    // acerca a medida que sube la tensión. En un momento de la historia se
    // mete en ese carril; en la recta final se cierra sobre las dos de
    // adelante; en la foto va a la meta, bien cerca.
    const tens = tension(story, prog);
    const leadX = G.X0 + (xs[leader] as number) * G.TL;
    if (shot && prog >= shot.until) shot = null;
    if (prog > plan.foto) {
      cam.lookAt(G.X0 + G.TL - 30 * G.u, (G.laneY(story.winner) + G.laneY(story.rival)) / 2 - 30 * G.u, G.portrait ? 1.8 : 2.1, 4);
    } else if (shot) {
      cam.lookAt(xOf(shot.k, prog) + 20 * G.u, G.laneY(shot.k) - 40 * G.u, shot.zoom, 5);
    } else if (prog > 0.8) {
      const second = order[1]?.k ?? leader;
      const x2 = xOf(second, prog);
      const y = (G.laneY(leader) + G.laneY(second)) / 2 - 30 * G.u;
      cam.lookAt((leadX + x2) / 2 + 30 * G.u, y, (G.portrait ? 1.2 : 1.35) + 0.2 * (prog - 0.8) / 0.2, 3);
    } else {
      cam.lookAt(leadX - G.sw * 0.08, G.midY, 1 + 0.18 * tens, 2.6);
    }
    if (prog >= 1) finishNow();
  }

  function draw(now: number): void {
    const prog = qNow();
    const { u, sw } = G;
    const tens = phase === "count" ? 0.1 : phase === "done" ? 1 : tension(story, prog);

    // Paralaje: cada capa se corre una parte de lo que se corre la cámara.
    const par = (c: Container, f: number): void => {
      c.x = cam.x * (1 - f);
      c.y = (cam.y - G.midY) * (1 - f) * 0.6;
    };
    par(L.far, 0.1);
    par(L.mid, 0.2);
    par(L.near, 0.35);
    par(L.stands, 0.7);
    L.clouds.x = -cam.x * 0.05 - now * 6 * u;
    L.sun.x = sw * 0.78 - cam.x * 0.02;

    // La hinchada salta más cuanto más tensa está la carrera.
    const lo = cam.x * 0.7 - sw, hi = cam.x * 0.7 + sw;
    L.crowd.forEach((sp, i) => {
      const b = L.crowdBase[i];
      if (!b) return;
      if (b.x < lo || b.x > hi) {
        sp.visible = false;
        return;
      }
      sp.visible = true;
      sp.y = b.y - Math.max(0, Math.sin(now * (6 + tens * 6) + b.ph)) * (1 + tens * 6) * u;
      const up = tens > 0.7 && Math.sin(now * 3 + b.ph) > -0.2;
      const kind = Math.floor(((i * 7) % 16) / 2);
      sp.texture = (L.people[kind * 2 + (up ? 1 : 0)] ?? sp.texture) as Texture;
    });
    const fl = L.flags;
    fl.clear();
    for (let i = 0; i < 18; i++) {
      const x = (i + 0.5) * (G.TL * 0.75 + sw * 2) / 18 - sw * 0.5;
      if (x < lo - 60 * u || x > hi + 60 * u) continue;
      const y0 = G.trackTop - 100 * u;
      fl.moveTo(x, y0).lineTo(x, y0 - 34 * u).stroke({ width: 2 * u, color: CREAM });
      const pts: number[] = [];
      for (let j = 0; j <= 6; j++) pts.push(x - j * 5 * u, y0 - 34 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      for (let j = 6; j >= 0; j--) pts.push(x - j * 5 * u, y0 - 20 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      fl.poly(pts).fill(S.color(i)).stroke({ width: 1.5 * u, color: INK });
    }

    // Los corredores.
    const fx = L.fx;
    fx.clear();
    for (let k = 0; k < N; k++) {
      const r = L.runners[k] as Runner;
      const sc = G.laneScale(k);
      const p = phase === "count" ? 0 : plan.pos(k, prog);
      const pPrev = phase === "count" ? 0 : plan.pos(k, Math.max(0, prog - 0.004));
      const speed = phase === "race" ? (p - pPrev) / 0.004 : 0;
      const x = G.X0 + p * G.TL;
      const y = G.laneY(k);
      r.root.position.set(x - 34 * sc, y);
      r.pose(p * 95, speed, phase === "race" ? plan.beatOf(k, prog) : null, now);
      if (phase === "done" && k === winnerLane) r.root.y = y - Math.abs(Math.sin(tFreeze * 7)) * 22 * u * Math.max(0, 1 - tFreeze / 2.6);
      r.tag.position.set(x - (space ? 82 : 40) * sc - r.tag.width, y - 30 * sc);
      r.tag.alpha = phase === "done" ? 0.35 : 1;
      if (phase === "count") continue;
      // Polvo (o estela), cada grano calculado desde su hora.
      const every = 0.006;
      for (let e = Math.floor((prog - 0.03) / every); e <= Math.floor(prog / every); e++) {
        if (e < 0) continue;
        const qe = e * every;
        const age = (prog - qe) / 0.03;
        if (age < 0 || age > 1) continue;
        const spd = (plan.pos(k, qe) - plan.pos(k, Math.max(0, qe - 0.004))) / 0.004;
        if (spd < 0.5) continue;
        const px = G.X0 + plan.pos(k, qe) * G.TL - (space ? 44 : 30) * sc - age * 26 * u - hash(e, k) * 10 * u;
        const py = y - (space ? 36 * sc : 3 * u) - age * (space ? (hash(k, e) - 0.5) * 16 : 8 + hash(k, e) * 12) * u;
        fx.circle(px, py, (3 + age * 7) * u * sc).fill({ color: space ? 0xff9f1c : dark ? 0x8a6a52 : 0xe0c49a, alpha: (space ? 0.6 : 0.45) * (1 - age) });
      }
      if (speed > 1.3) {
        for (let j = 0; j < 3; j++) {
          const ly = y - (20 + j * 14) * sc;
          const lx = x - (70 + ((now * 900 + j * 37 + k * 11) % 60)) * u;
          fx.moveTo(lx, ly).lineTo(lx - 40 * u, ly).stroke({ width: 2 * u, color: 0xffffff, alpha: 0.6 });
        }
      }
      const beat = phase === "race" ? plan.beatOf(k, prog) : null;
      if (beat?.kind === "escupida") {
        const bt = story.beats.find((b) => b.kind === "escupida" && b.actor === k && prog >= b.at && prog < b.at + 0.05);
        if (bt?.target !== undefined) {
          const tx = xOf(bt.target, prog);
          const ty = G.laneY(bt.target) - 70 * G.laneScale(bt.target);
          const sx = x + 4 * u, sy = y - 78 * sc;
          for (let j = 0; j < 6; j++) {
            const f = Math.min(1, beat.p * 2) - j * 0.06;
            if (f < 0) continue;
            fx.circle(sx + (tx - sx) * f, sy + (ty - sy) * f - Math.sin(Math.PI * f) * 40 * u, 3.2 * u).fill({ color: space ? 0xff4d4d : 0x9fe3ff, alpha: 0.9 });
          }
        }
      }
    }

    // El minimapa.
    const mini = L.mini;
    mini.clear();
    const mw = G.portrait ? sw - 40 * u : Math.min(sw * 0.46, 560 * u);
    const mx = (sw - mw) / 2, my = S.top() + 16 * u;
    mini.roundRect(mx - 10 * u, my - 12 * u, mw + 20 * u, 24 * u, 12 * u).fill({ color: INK, alpha: 0.75 });
    mini.rect(mx, my - 1.5 * u, mw, 3 * u).fill({ color: CREAM, alpha: 0.5 });
    for (let c = 0; c < 4; c++) mini.rect(mx + mw - 6 * u + (c % 2) * 3 * u, my - 7 * u + Math.floor(c / 2) * 7 * u, 3 * u, 7 * u).fill(c % 3 === 0 ? 0xffffff : INK);
    const minis = lanes.map((_, k) => ({ k, p: phase === "count" ? 0 : plan.pos(k, prog) })).sort((a, b) => a.p - b.p);
    for (const { k, p } of minis) {
      const lead = Math.round(rowPos[k] as number) === 0 && phase !== "count";
      mini.circle(mx + Math.max(0, Math.min(1, p)) * mw, my, (lead ? 7 : 5) * u).fill(S.color(k)).stroke({ width: 2 * u, color: INK });
    }
    const rowH = 22 * u;
    L.rows.forEach((r, k) => {
      r.y = (rowPos[k] as number) * rowH;
      (r.children[2] as Text).text = String(Math.round(rowPos[k] as number) + 1);
      r.alpha = phase === "done" && k !== winnerLane ? 0.4 : 1;
    });

    tlCount.time(phase === "count" ? tPhase : 4);
    L.foto.visible = prog > plan.foto && phase === "race";
    if (phase === "done") crown.at(tFreeze);
    roar?.(tens);
  }

  S.run((dt, now) => {
    update(dt);
    cam.update(dt);
    cam.apply(S.scene, G.sw, G.sh, now);
    draw(now);
  });
}

/**
 * El ruido de la tribuna: ruido filtrado en la banda de las voces, que sube
 * con la tensión. No es una nota: es gente.
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
    g.gain.setTargetAtTime(isMuted() ? 0 : 0.012 + 0.05 * tension * tension, ctx.currentTime, 0.25);
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
