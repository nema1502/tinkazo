import { Application, Container, Graphics, Sprite, Text, Texture, type TextStyleOptions } from "pixi.js";
import { gsap } from "gsap";
import { $ } from "../../dom";
import { T, getLang, setPickSeed, t } from "../../i18n";
import { LCOLORS, drawAvatar, instantMode, paceFactor, type Beacon } from "../../state";
import { narrate, stopNarrator } from "../../narrator";
import { musicCue, startMusic, stopMusic } from "../../music";
import { registerSkip, releaseScreen, shorten, takeOverScreen, winnerNames } from "../overlay";
import { Camera } from "./camera";

/**
 * El andamiaje de los juegos en PixiJS: lo mismo que `overlay.ts` hace para
 * el motor de siempre, en el motor nuevo.
 *
 * Monta el lienzo, siembra el azar con la ronda, prende la música, le da al
 * juego el relator, las caras, los chips con nombre, el cartel del ganador, el
 * papel picado y una cámara, y lo desmonta todo al final. Un juego nuevo solo
 * escribe su escena y su guion.
 *
 * Capas, de atrás hacia adelante: `bg` (el cielo, que no se mueve), `scene`
 * (lo que mira la cámara), `hud` (la interfaz, siempre en su lugar) y, encima
 * de todo, el cartel del ganador.
 */

// GSAP duerme su reloj cuando no le queda nada que animar. Por defecto espera
// ciento veinte cuadros; con el estadio cerrado eso es un bucle de más que el
// auditor exigente cuenta como fuga.
gsap.config({ autoSleep: 20 });

export const INK = 0x191919;
export const CREAM = 0xf6efe2;
export const YELLOW = 0xffc629;

const hex = (css: string, fallback = 0xe93d9c): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  return m ? parseInt(m[1] as string, 16) : fallback;
};

/** Un azar que depende solo de sus argumentos: para lo que se calcula desde la hora. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Un generador sembrado, el mismo de todos los juegos. */
export function seeded(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
export const MONO = "ui-monospace, Consolas, monospace";

export interface PixiStage {
  app: Application;
  view: HTMLCanvasElement;
  bg: Container;
  scene: Container;
  hud: Container;
  cam: Camera;
  sw(): number;
  sh(): number;
  /** La unidad: un píxel de un diseño de 720 de alto, o lo que entre en un celular. */
  u(): number;
  portrait(): boolean;
  /** Dónde empieza el juego debajo de la barra de arriba, y dónde termina encima del relator. */
  top(): number;
  bottom(): number;
  rng: () => number;
  dark: boolean;
  color(k: number): number;
  say(msg: string, heat?: number): void;
  face(name: string): Texture;
  text(s: string, style: TextStyleOptions): Text;
  /** Un chip con la cara y el nombre, anclado por la izquierda al medio. */
  chip(name: string, scale?: number): Container;
  /** Deja anotado un dato para los auditores (arco, puesto…). */
  mark(key: string, value: string): void;
  /** El cartel del ganador y el papel picado: se arman una vez y se llevan a la hora. */
  crown(names: string[], winners: readonly number[]): Crown;
  run(fn: (dt: number, now: number) => void): void;
  onResize(fn: () => void): void;
  /** Algo que hay que soltar al cerrar: una línea de tiempo, un sonido. */
  onCleanup(fn: () => void): void;
  cleanup(): void;
}

export interface Crown {
  root: Container;
  /**
   * Lleva el cartel, el destello y el papel picado a `t` segundos del final.
   * Sin `placa`, solo el destello y el papel picado: para un juego que arma su
   * propio cartel.
   */
  at(t: number, placa?: boolean): void;
  /** Vuelve a armarse para otro tamaño de pantalla. */
  rebuild(): void;
}

export async function mountPixi(beacon: Beacon, done: () => void, onSkip: () => void): Promise<PixiStage | null> {
  if (instantMode || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const ov = $("stadium");
  const base = $<HTMLCanvasElement>("race-canvas");
  const commentEl = $("commentary");
  commentEl.textContent = "";
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;

  // El lienzo de siempre queda escondido; PixiJS dibuja en uno propio, porque
  // un lienzo que ya dio un contexto 2D no puede dar uno de WebGL.
  base.style.visibility = "hidden";
  delete base.dataset.cartel;
  document.getElementById("pixi-canvas")?.remove();
  const view = document.createElement("canvas");
  view.id = "pixi-canvas";
  base.after(view);

  let s0 = parseInt(beacon.randomness.slice(0, 8), 16) | 0;
  const rng = (): number => {
    s0 = (s0 + 0x6d2b79f5) | 0;
    let q = Math.imul(s0 ^ (s0 >>> 15), 1 | s0);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
  setPickSeed(rng);

  const dark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.dataset.theme !== "light"
    : document.documentElement.dataset.theme === "dark";
  const cs = getComputedStyle(document.documentElement);
  const P = LCOLORS.map((v) => hex(cs.getPropertyValue(v)));

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
    // Para que los auditores puedan leer el lienzo entre cuadros.
    preserveDrawingBuffer: true,
    preference: "webgl",
  });
  const bg = new Container();
  const scene = new Container();
  const hud = new Container();
  // El cartel del ganador tiene su propia capa: los juegos vacían `hud` cuando
  // cambia el tamaño de la pantalla, y el cartel se rearma solo.
  const podium = new Container();
  app.stage.addChild(bg, scene, hud, podium);
  const cam = new Camera();

  // El estadio aparece recién con el motor listo. Arrancar el motor tarda
  // distinto en cada carga, y si el estadio se mostraba antes, el primer
  // cuadro del juego caía en otro momento de cada corrida: el auditor
  // exigente comparaba dos corridas desfasadas y las veía distintas.
  ov.style.display = "block";
  document.body.style.overflow = "hidden";
  takeOverScreen(ov);

  startMusic(parseInt(beacon.randomness.slice(8, 16), 16));
  registerSkip(onSkip);

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

  const sw = (): number => innerWidth;
  const sh = (): number => innerHeight;
  const portrait = (): boolean => sh() > sw() * 1.1;
  const u = (): number => (portrait() ? Math.min(sw() / 420, sh() / 900) : sh() / 720);
  const top = (): number => (innerWidth <= 520 ? 100 : 82);
  const bottom = (): number => (innerWidth <= 520 ? 118 : 106);

  const text = (s: string, style: TextStyleOptions): Text => new Text({ text: s, style: { fontFamily: FONT, ...style } });

  const chip = (name: string, scale = 1): Container => {
    const k = u() * scale;
    const c = new Container();
    const label = text(shorten(name, 20), { fontSize: 12 * k, fontWeight: "800", fill: INK });
    const av = new Sprite(face(name));
    av.width = av.height = 16 * k;
    av.position.set(5 * k, 3 * k);
    label.position.set(25 * k, 3.5 * k);
    const w = label.width + 32 * k;
    const bgc = new Graphics()
      .roundRect(3 * k, 3 * k, w, 22 * k, 5 * k)
      .fill(INK)
      .roundRect(0, 0, w, 22 * k, 5 * k)
      .fill(dark ? CREAM : 0xffffff)
      .stroke({ width: 2 * k, color: INK });
    c.addChild(bgc, av, label);
    c.pivot.set(0, 11 * k);
    return c;
  };

  const mark = (key: string, value: string): void => {
    base.dataset[key] = value;
    view.dataset[key] = value;
  };

  let rafId = 0;
  let dead = false;
  let loopFn: ((dt: number, now: number) => void) | null = null;
  const resizers: (() => void)[] = [];
  const cleaners: (() => void)[] = [];
  const crowns: Crown[] = [];
  const onResize = (): void => {
    app.renderer.resize(innerWidth, innerHeight);
    for (const c of crowns) c.rebuild();
    for (const f of resizers) f();
  };
  addEventListener("resize", onResize);

  const crown = (names: string[], winners: readonly number[]): Crown => {
    const root = new Container();
    podium.addChild(root);
    const flash = new Graphics();
    const confetti = new Graphics();
    const plate = new Container();
    root.addChild(confetti, plate, flash);
    const tl = gsap.timeline({ paused: true });
    cleaners.push(() => tl.kill());
    const all = winnerNames(names, winners);
    const build = (): void => {
      plate.removeChildren().forEach((c) => c.destroy({ children: true }));
      flash.clear().rect(0, 0, sw(), sh()).fill(0xffffff);
      const k = u();
      const title = text(getLang() === "es" ? (all.length > 1 ? "GANAN" : "GANA") : all.length > 1 ? "WINNERS" : "WINNER", {
        fontFamily: MONO, fontSize: 14 * k, fontWeight: "900", fill: INK, letterSpacing: 3 * k,
      });
      const lines = all.length <= 3 ? all : [...all.slice(0, 2), `+${all.length - 2}`];
      const big = lines.length === 1;
      const nameTexts = lines.map((n, i) =>
        text(lines.length > 1 && !n.startsWith("+") ? `${i + 1}. ${n}` : n, { fontSize: (big ? 54 : 34) * k, fontWeight: "900", fill: INK }),
      );
      const maxW = sw() * 0.86 - (big ? 130 : 40) * k;
      for (const tx of nameTexts) if (tx.width > maxW) tx.scale.set(maxW / tx.width);
      const innerW = Math.max(title.width, ...nameTexts.map((x) => x.width));
      const pw = innerW + (big ? 132 : 56) * k;
      const lineH = (big ? 60 : 40) * k;
      const ph = 40 * k + lineH * nameTexts.length + 16 * k;
      const bgp = new Graphics()
        .roundRect(-pw / 2 + 10 * k, -ph / 2 + 10 * k, pw, ph, 14 * k)
        .fill(INK)
        .roundRect(-pw / 2, -ph / 2, pw, ph, 14 * k)
        .fill(YELLOW)
        .stroke({ width: 5 * k, color: INK });
      plate.addChild(bgp);
      const x0 = -pw / 2 + (big ? 112 : 28) * k;
      if (big) {
        const av = new Sprite(face(all[0] ?? ""));
        av.width = av.height = 76 * k;
        av.position.set(-pw / 2 + 22 * k, -38 * k);
        const border = new Graphics().rect(-pw / 2 + 20 * k, -40 * k, 80 * k, 80 * k).stroke({ width: 4 * k, color: INK });
        plate.addChild(av, border);
      }
      title.position.set(x0, -ph / 2 + 16 * k);
      plate.addChild(title);
      nameTexts.forEach((tx, i) => {
        tx.position.set(x0, -ph / 2 + 36 * k + i * lineH);
        plate.addChild(tx);
      });
      plate.position.set(sw() / 2, portrait() ? sh() * 0.24 : sh() * 0.26);
      tl.clear();
      tl.fromTo(flash, { alpha: 0.9 }, { alpha: 0, duration: 0.5, ease: "power2.out" }, 0)
        .fromTo(plate.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.9, ease: "elastic.out(1, 0.55)" }, 0.12)
        .fromTo(plate, { rotation: -0.12 }, { rotation: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" }, 0.12);
    };
    build();
    root.visible = false;
    const c: Crown = {
      root,
      at(tt: number, placa = true) {
        root.visible = true;
        plate.visible = placa;
        tl.time(Math.max(0, tt));
        // El cartel queda anotado para el auditor exigente, en píxeles del lienzo.
        if (placa && tt > 0.6) {
          const b = plate.getBounds();
          view.dataset.cartel = [b.x, b.y, b.width, b.height].map((v) => Math.round(v * dpr)).join(",");
        }
        // Papel picado: cada tira se calcula desde la hora, no se acumula.
        confetti.clear();
        const k = u();
        for (let i = 0; i < 180; i++) {
          const t0 = hash(i, 7) * 0.4;
          const q = tt - t0;
          if (q < 0) continue;
          const vx = (hash(i, 1) - 0.5) * 900 * k, vy = -(300 + hash(i, 2) * 700) * k;
          const x = sw() / 2 + (hash(i, 3) - 0.5) * sw() * 0.3 + vx * q;
          const y = sh() * 0.3 + vy * q + 900 * k * q * q;
          if (y > sh() + 20) continue;
          const rot = hash(i, 4) * 6 + q * (4 + hash(i, 5) * 8);
          const w = 9 * k, h = Math.max(1, 5 * k * Math.abs(Math.cos(rot)));
          confetti.rect(x - w / 2, y - h / 2, w, h).fill(P[i % P.length] ?? YELLOW);
        }
      },
      rebuild: build,
    };
    crowns.push(c);
    return c;
  };

  const stage: PixiStage = {
    app, view, bg, scene, hud, cam, sw, sh, u, portrait, top, bottom, rng, dark,
    color: (k) => P[((k % P.length) + P.length) % P.length] ?? 0xe93d9c,
    say(msg, heat = 0) {
      commentEl.textContent = msg;
      commentEl.animate(
        [{ transform: "translateX(-50%) scale(0.75)" }, { transform: "translateX(-50%) scale(1)" }],
        { duration: 280, easing: "cubic-bezier(.34,1.56,.64,1)" },
      );
      narrate(msg, heat);
      musicCue(heat);
    },
    face, text, chip, mark, crown,
    onResize: (fn) => resizers.push(fn),
    onCleanup: (fn) => cleaners.push(fn),
    run(fn) {
      loopFn = fn;
      let prev = 0;
      let start = -1;
      const pace = paceFactor();
      const loop = (now: number): void => {
        if (dead) return;
        const dt = prev ? Math.min(0.05, (now - prev) / 1000) / pace : 0;
        prev = now;
        if (start < 0) start = now;
        loopFn?.(dt, (now - start) / 1000);
        if (dead) return;
        app.renderer.render(app.stage);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    },
    cleanup() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(rafId);
      removeEventListener("resize", onResize);
      for (const f of cleaners) {
        try {
          f();
        } catch {
          /* que un desmontaje falle no deja el estadio abierto */
        }
      }
      // La escena se destruye al terminar el cuadro: el juego suele cerrar
      // desde adentro de su propio cuadro, y lo que sigue en ese cuadro todavía
      // la usa (la cámara, el dibujo). Destruirla ahí mismo tiraba un error.
      setTimeout(() => {
        for (const tx of faces.values()) tx.destroy(true);
        app.destroy({ removeView: true }, { children: true });
      }, 0);
      base.style.visibility = "";
      releaseScreen();
      ov.style.display = "none";
      document.body.style.overflow = "";
      registerSkip(null);
      setPickSeed(null);
      stopNarrator();
      stopMusic();
      $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
      done();
    },
  };
  return stage;
}

/** El texto del ganador, en el idioma de la página, para el relator. */
export const winLine = (label: string): string => T[getLang()].cWin(label);
