import { $ } from "../dom";
import { LCOLORS, avatar, instantMode, paceFactor, type Beacon } from "../state";
import { setPickSeed, t } from "../i18n";
import { narrate, stopNarrator } from "../narrator";

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
  /**
   * Escribe y dice una línea del narrador.
   *
   * `heat` va de 0 a 1 y es la tensión del momento. Sube el ritmo y el tono de
   * la voz: es lo que separa a un relator de alguien leyendo en voz alta.
   */
  say: (msg: string, heat?: number) => void;
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
  // `?instant=1` existe para el auditor. Esto es para alguien que marcó en su
  // sistema que las animaciones lo marean, y que hasta ahora no tenía forma de
  // decirlo. El sorteo igual se hace y el ganador igual sale.
  if (instantMode || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
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
  takeOverScreen(ov);

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
    say(msg, heat = 0) {
      commentEl.textContent = msg;
      // Con la API de animaciones en vez de quitar y poner la clase: ese truco
      // obligaba a recalcular el diseño de la página en cada línea.
      commentEl.animate(
        [{ transform: "translateX(-50%) scale(0.75)" }, { transform: "translateX(-50%) scale(1)" }],
        { duration: 280, easing: "cubic-bezier(.34,1.56,.64,1)" },
      );
      narrate(msg, heat);
    },
    chip(name, x, y, alpha = 1) {
      const k = u();
      const av = 18 * k;
      const label = shorten(name, 20);
      c.save();
      c.globalAlpha = alpha;
      // El espaciado de letras en lienzo existe desde 2025. En un navegador
      // viejo asignarlo no hace nada y el chip se ve igual, solo más apretado.
      c.letterSpacing = "0.01em";
      c.font = `700 ${12 * k}px system-ui, sans-serif`;
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      const bw = c.measureText(label).width + av + 18 * k;

      const round = typeof c.roundRect === "function";
      c.beginPath();
      if (round) c.roundRect(x - 4 * k, y - 14 * k, bw, 22 * k, 5 * k);
      else c.rect(x - 4 * k, y - 14 * k, bw, 22 * k);
      // La sombra dura de la casa, la misma que el CSS: sin desenfoque, porque
      // el neobrutalismo no lo tiene. Hasta ahora vivía solo en la página y no
      // existía en ningún juego.
      c.shadowColor = INK;
      c.shadowBlur = 0;
      c.shadowOffsetX = 3 * k;
      c.shadowOffsetY = 3 * k;
      c.fillStyle = dark ? "#f6efe2" : "#ffffff";
      c.fill();
      c.shadowColor = "transparent";
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 0;
      c.strokeStyle = INK;
      c.lineWidth = 2 * k;
      c.stroke();

      const im = imageOf(name);
      if (im.complete && im.naturalWidth) {
        c.save();
        c.beginPath();
        if (round) c.roundRect(x, y - 11 * k, av, av, 3 * k);
        else c.rect(x, y - 11 * k, av, av);
        c.clip();
        c.drawImage(im, x, y - 11 * k, av, av);
        c.restore();
      }
      c.fillStyle = INK;
      c.fillText(label, x + av + 6 * k, y + 3 * k);
      c.letterSpacing = "0px";
      c.restore();
      return bw;
    },
    cleanup() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(rafId);
      setPickSeed(null);
      stopNarrator();
      releaseScreen();
      removeEventListener("resize", resize);
      ov.style.display = "none";
      document.body.style.overflow = "";
      current = null;
      $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
      done();
    },
    run(fn) {
      let prev = 0;
      // El factor de ritmo divide el tiempo que ve el juego, así que las
      // fases, los avisos del narrador y los sonidos se estiran juntos y
      // nunca se desacoplan.
      const pace = paceFactor();
      const loop = (now: number): void => {
        if (dead) return;
        // Se acota el delta para que volver de una pestaña en segundo plano no
        // salte media animación de golpe.
        const dt = prev ? Math.min(0.05, (now - prev) / 1000) / pace : 0;
        prev = now;
        fn(dt, now / 1000);
        if (!dead) rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    },
  };

  // Las frases del narrador también salen de la semilla: con voz, dos corridas
  // de la misma ronda tienen que sonar igual.
  setPickSeed(rng);
  current = { skip: onSkip };
  return stage;
}

/* ------------------------------------------------------------------ pantalla
   El estadio pide la pantalla completa y le dice al sistema que no la apague.

   Los dos permisos pueden negarse, y ninguno hace falta para sortear, así que
   todo falla en silencio: el estadio ya ocupa la ventana entera por CSS.

   El bloqueo se suelta solo cuando la pestaña pasa a segundo plano, así que hay
   que volver a pedirlo al regresar. Si no, la pantalla se apaga en la mitad de
   una carrera de quince segundos porque alguien miró el celular. */

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}
type NavWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

let sentinel: WakeLockSentinelLike | null = null;

async function keepAwake(): Promise<void> {
  const nav = navigator as NavWithWakeLock;
  if (!nav.wakeLock) return;
  try {
    sentinel = await nav.wakeLock.request("screen");
  } catch {
    /* sin permiso o con la batería baja: la pantalla se apagará, y no es fatal */
  }
}

const onVisible = (): void => {
  if (document.visibilityState === "visible" && sentinel) void keepAwake();
};

function takeOverScreen(el: HTMLElement): void {
  // Esconder la barra del navegador solo funciona en escritorio. En iPhone no
  // hay pantalla completa de elementos, y ahí el CSS es todo lo que hay.
  if (!document.fullscreenElement && el.requestFullscreen) {
    void el.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  }
  void keepAwake();
  document.addEventListener("visibilitychange", onVisible);
}

function releaseScreen(): void {
  document.removeEventListener("visibilitychange", onVisible);
  if (sentinel) {
    void sentinel.release().catch(() => undefined);
    sentinel = null;
  }
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * La bandera de Bolivia, en tres franjas.
 *
 * Estaba mal: eran tres barras verticales pegadas, que no es una bandera de
 * nadie. La de Bolivia es de franjas **horizontales**, de arriba abajo rojo,
 * amarillo y verde, en ese orden, fijado por ley desde 1851. Dibujarla mal es
 * peor que no dibujarla.
 */
export function drawFlag(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const band = h / 3;
  ["#d52b1e", "#f9e300", "#007a33"].forEach((col, i) => {
    c.fillStyle = col;
    c.fillRect(x, y + i * band, w, band);
  });
  c.lineWidth = Math.max(1, h * 0.07);
  c.strokeStyle = INK;
  c.strokeRect(x, y, w, h);
}

/** Interpolación suave, la de siempre. */
export const ease = {
  outCubic: (p: number) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p: number) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
};

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Acorta un nombre sin que dos personas queden iguales.
 *
 * Cortar por el final es lo natural y es justo lo que falla acá: "María
 * Fernanda Quispe Mamani" y "María Fernanda Quispe Rojas" se vuelven la misma
 * cosa, y en una sala llena de apellidos compartidos eso pasa seguido. Cortar
 * por el medio conserva las dos puntas, que es donde está la diferencia.
 */
export function shorten(name: string, max: number): string {
  if (name.length <= max) return name;
  if (max < 6) return name.slice(0, Math.max(1, max - 1)) + "…";
  const head = Math.ceil((max - 1) * 0.55);
  const tail = max - 1 - head;
  return name.slice(0, head) + "…" + name.slice(name.length - tail);
}
