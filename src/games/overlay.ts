import { $ } from "../dom";
import { LCOLORS, avatar, instantMode, type Beacon } from "../state";
import { t } from "../i18n";

/**
 * Lo que comparten todos los juegos.
 *
 * Montar el modo estadio, sembrar el azar con la ronda de drand, registrar el
 * botón de saltar y desmontar sin dejar nada colgado es el mismo trabajo en
 * cada juego. Estaba escrito dentro de la carrera, así que cada juego nuevo lo
 * copiaba. Acá vive una sola vez.
 *
 * La regla que sostiene todo el producto: **ningún juego decide nada.** El
 * ganador llega dado desde el protocolo. Lo único que se siembra acá es cómo
 * se ve, para que la misma ronda dibuje siempre la misma animación.
 */

export interface Stage {
  canvas: HTMLCanvasElement;
  c: CanvasRenderingContext2D;
  /** Ancho y alto en píxeles de dibujo, no de CSS. */
  W: () => number;
  H: () => number;
  /** Unidad de escala: 1 en una pantalla de 720 px de alto. */
  u: () => number;
  /** Azar sembrado con la ronda. Nunca `Math.random()`. */
  rng: () => number;
  /** El color k del ciclo de la paleta. */
  color: (k: number) => string;
  /** Escribe una línea del narrador. */
  say: (msg: string) => void;
  /** Dibuja el chip con avatar y nombre. Devuelve su ancho. */
  chip: (name: string, x: number, y: number, alpha?: number) => number;
  /** Desmonta y devuelve el control a la página. Idempotente. */
  cleanup: () => void;
  /** `true` cuando el tema de la página es oscuro. */
  dark: boolean;
  /** Corre `fn` en cada cuadro con el delta en segundos, hasta `cleanup`. */
  run: (fn: (dt: number, now: number) => void) => void;
}

export const INK = "#191919";

let current: { skip: () => void } | null = null;

/** El botón de saltar de la barra del estadio. */
export function skipGame(): void {
  current?.skip();
}

/**
 * Registra el skip de un juego que monta el estadio por su cuenta.
 *
 * Lo usa la carrera, que es anterior a este módulo y tiene su propio montaje.
 * Los juegos nuevos no lo necesitan: `mount` ya lo hace.
 */
export function registerSkip(fn: (() => void) | null): void {
  current = fn ? { skip: fn } : null;
}

/**
 * Monta el estadio. Devuelve `null` si no hay que animar, y en ese caso quien
 * llama debe cerrar el sorteo de una: es el modo `?instant=1` que usa el
 * auditor para comprobar el resultado sin esperar la animación.
 */
export function mount(beacon: Beacon, done: () => void, onSkip: () => void): Stage | null {
  if (instantMode) return null;
  const ov = $("stadium");
  const canvas = $<HTMLCanvasElement>("race-canvas");
  const c = canvas.getContext("2d");
  if (!c) return null;

  const commentEl = $("commentary");
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;
  ov.style.display = "block";
  document.body.style.overflow = "hidden";

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = (): void => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  };
  resize();
  addEventListener("resize", resize);

  // PRNG sembrado con la aleatoriedad de drand: la misma ronda dibuja siempre
  // la misma animación, en cualquier navegador.
  let s = parseInt(beacon.randomness.slice(0, 8), 16) | 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };

  const dark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.dataset.theme !== "light"
    : document.documentElement.dataset.theme === "dark";
  const cs = getComputedStyle(document.documentElement);
  const P = LCOLORS.map((v) => cs.getPropertyValue(v).trim());

  const W = (): number => canvas.width;
  const H = (): number => canvas.height;
  const u = (): number => canvas.height / 720;

  const avatars = new Map<string, HTMLImageElement>();
  const imageOf = (name: string): HTMLImageElement => {
    let im = avatars.get(name);
    if (!im) {
      im = new Image();
      im.src = avatar(name, 64);
      avatars.set(name, im);
    }
    return im;
  };

  let rafId = 0;
  let dead = false;

  const stage: Stage = {
    canvas,
    c,
    W,
    H,
    u,
    rng,
    dark,
    color: (k) => P[k % P.length] ?? INK,
    say(msg) {
      commentEl.textContent = msg;
      commentEl.classList.remove("pop");
      void commentEl.offsetWidth;
      commentEl.classList.add("pop");
    },
    chip(name, x, y, alpha = 1) {
      const k = u();
      const av = 18 * k;
      const label = name.length > 18 ? name.slice(0, 17) + "…" : name;
      c.save();
      c.globalAlpha = alpha;
      c.font = `700 ${12 * k}px system-ui, sans-serif`;
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      const tw = c.measureText(label).width;
      const bw = tw + av + 18 * k;
      c.fillStyle = dark ? "#f6efe2" : "#ffffff";
      c.fillRect(x - 4 * k, y - 14 * k, bw, 22 * k);
      c.strokeStyle = INK;
      c.lineWidth = 2 * k;
      c.strokeRect(x - 4 * k, y - 14 * k, bw, 22 * k);
      const im = imageOf(name);
      if (im.complete && im.naturalWidth) c.drawImage(im, x, y - 11 * k, av, av);
      c.fillStyle = INK;
      c.fillText(label, x + av + 6 * k, y + 3 * k);
      c.restore();
      return bw;
    },
    cleanup() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(rafId);
      removeEventListener("resize", resize);
      ov.style.display = "none";
      document.body.style.overflow = "";
      current = null;
      $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
      done();
    },
    run(fn) {
      let prev = 0;
      const loop = (now: number): void => {
        if (dead) return;
        // Se acota el delta para que volver de una pestaña en segundo plano no
        // salte media animación de golpe.
        const dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0;
        prev = now;
        fn(dt, now / 1000);
        if (!dead) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    },
  };

  current = { skip: onSkip };
  return stage;
}

/** Interpolación suave, la de siempre. */
export const ease = {
  outCubic: (p: number) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p: number) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
};

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
