import { $ } from "../dom";
import { LCOLORS, drawAvatar, instantMode, paceFactor, type Beacon } from "../state";
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
  /**
   * Dibuja el chip con avatar y nombre. Devuelve su ancho.
   *
   * `scale` existe porque el chip cumple dos papeles distintos. Con doscientos
   * participantes es textura y tiene que ser chico; cuando quedan tres es el
   * dato más importante de la pantalla y a 12·u mide el 1,7% del alto, que
   * proyectado no se lee desde el fondo de la sala.
   */
  chip: (name: string, x: number, y: number, alpha?: number, scale?: number) => number;
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
  // Vacía al montar. Si no, en un evento con varios sorteos seguidos el juego
  // nuevo arrancaba mostrando "¡ganó fulano!" del sorteo anterior hasta que el
  // relator dijera su primera línea: casi tres segundos en la constelación.
  commentEl.textContent = "";
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
  // Nunca cero. Media docena de bucles de dibujo avanzan de a `algo * u()`, y
  // un paso de cero es un `for` que no termina y una pestaña colgada. Un alto
  // de ventana en cero dura un cuadro y no se ve, pero el cuelgue es para
  // siempre.
  const u = (): number => Math.max(canvas.height, 1) / 720;

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
    chip(name, x, y, alpha = 1, scale = 1) {
      const k = u() * scale;
      const av = 18 * k;
      const label = shorten(name, 20);
      c.save();
      c.globalAlpha = alpha;
      // El espaciado de letras en lienzo existe desde 2025. En un navegador
      // viejo asignarlo no hace nada y el chip se ve igual, solo más apretado.
      c.letterSpacing = "0.01em";
      c.font = `${scale > 1.2 ? 800 : 700} ${12 * k}px system-ui, sans-serif`;
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      const bw = c.measureText(label).width + av + 18 * k;
      // Que no se salga por los costados. El chip se ancla al nodo, y un nodo
      // cerca del borde ·cosa común en una pantalla vertical· lo empujaba
      // afuera: quedaba medio nombre cortado contra el filo del lienzo.
      const bx = Math.max(6 * k, Math.min(x - 4 * k, W() - bw - 6 * k));

      const round = typeof c.roundRect === "function";
      c.beginPath();
      if (round) c.roundRect(bx, y - 14 * k, bw, 22 * k, 5 * k);
      else c.rect(bx, y - 14 * k, bw, 22 * k);
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

      c.save();
      c.beginPath();
      if (round) c.roundRect(x, y - 11 * k, av, av, 3 * k);
      else c.rect(x, y - 11 * k, av, av);
      c.clip();
      drawAvatar(c, name, bx + 4 * k, y - 11 * k, av);
      c.restore();
      c.fillStyle = INK;
      c.fillText(label, bx + av + 10 * k, y + 3 * k);
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
      let start = -1;
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
        // El reloj de los adornos cuenta desde que arrancó el juego, no desde
        // que se abrió la página. Si no, el sol de la ruleta y los brillos
        // salían en otra posición según cuánto rato estuvo abierta la pestaña
        // antes de sortear, y la misma ronda no se dibujaba igual dos veces.
        if (start < 0) start = now;
        fn(dt, (now - start) / 1000);
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

/**
 * Los nombres que ganaron, listos para mostrar y para decir.
 *
 * Los juegos reciben la lista entera de ganadores, no solo el primero. Antes
 * la animación se quedaba con `winners[0]` y el cartel y el narrador cantaban
 * un solo nombre aunque se hubieran sorteado tres premios. Quien organiza
 * elegía tres y la sala escuchaba uno.
 */
/**
 * El fogonazo del revelado.
 *
 * Dos o tres cuadros de blanco en el instante exacto en que se sabe quién ganó,
 * antes de que el cartel termine de entrar. Cuesta cuatro líneas y es lo que
 * separa "apareció un nombre" de "pasó algo". La Constelación ya tenía su nova;
 * los otros cuatro revelaban sin ningún golpe visual.
 *
 * `a` va de 1 a 0 y quien llama decide en cuántos cuadros. Se corta en 0,85
 * para que la escena no desaparezca del todo: el blanco es un acento, no un
 * corte a negro.
 */
export function flashScreen(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: number,
): void {
  if (a <= 0) return;
  c.save();
  c.fillStyle = `rgba(255,255,255,${Math.min(0.85, a).toFixed(3)})`;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/**
 * Cuánto se sostiene el cartel del ganador, **en segundos reales**.
 *
 * Leer un nombre proyectado lleva casi un segundo, reconocerlo medio más, y la
 * reacción de la sala recién llega a su pico a los dos. Los juegos lo tenían
 * entre 1,4 y 1,7 segundos de juego, así que en modo rápido el cartel se iba
 * antes de que nadie alcanzara a reaccionar.
 *
 * Va en segundos reales a propósito: lo que tarda una persona en leer no cambia
 * porque el organizador haya elegido "épica". Se acumula con
 * `tHold += dt * paceFactor()`, que deshace la división del selector.
 */
export const WINNER_HOLD = 3;

/**
 * Los píxeles de lienzo que ocupan las barras de la interfaz del estadio.
 *
 * Arriba está la barra con la marca, la ronda y los botones; abajo, la caja del
 * comentario. Las dos son HTML por encima del lienzo, así que el juego no las
 * ve y dibujaba debajo: en un celular el contador de saltos de la constelación
 * quedaba tapado por la insignia de Tinkazo y el número de ronda, detrás del
 * comentario.
 *
 * La cuenta va de píxeles de CSS a píxeles de lienzo con la proporción real,
 * que es lo único que no depende de la densidad de la pantalla.
 */
export function chrome(c: CanvasRenderingContext2D): { arriba: number; abajo: number } {
  const escala = c.canvas.height / Math.max(1, window.innerHeight);
  const angosto = window.innerWidth < 700;
  // Por debajo de 520 la ronda va en un renglón propio, debajo de la marca y
  // los botones (ver `.st-top` en styles.css), y la barra crece.
  const partida = window.innerWidth <= 520;
  // La caja del relator mide 105 en escritorio, medida: con 86 el último
  // carril de la carrera quedaba detrás.
  return { arriba: (partida ? 100 : 82) * escala, abajo: (angosto ? 118 : 106) * escala };
}

export function winnerNames(names: string[], winners: readonly number[]): string[] {
  return winners.map((i) => names[i] ?? "").filter(Boolean);
}

/** Los ganadores en una línea, para el narrador y para el cartel. */
export function winnersLabel(names: string[], winners: readonly number[], max = 3): string {
  const all = winnerNames(names, winners);
  if (all.length <= 1) return all[0] ?? "";
  if (all.length <= max) return all.join(", ");
  return all.slice(0, max).join(", ") + " +" + (all.length - max);
}

/**
 * Anota en el lienzo dónde quedó el cartel del ganador, en píxeles del lienzo
 * y con la transformación que traiga el juego.
 *
 * Lo lee el auditor exigente para medir el nombre justo ahí: buscándolo por el
 * color se confundía con la franja amarilla del aguayo. Un juego que dibuja su
 * propio cartel, como el Cierre de Libro, lo llama también.
 */
export function markPlate(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const m = c.getTransform();
  c.canvas.dataset.cartel = [m.e + m.a * x, m.f + m.d * y, m.a * w, m.d * h].map((v) => Math.round(v)).join(",");
}

/**
 * El cartel del ganador, o de los ganadores.
 *
 * Con un solo premio es un nombre grande. Con varios, uno debajo del otro y
 * numerados, porque sortear tres premios y mostrar un nombre es mentir sobre
 * lo que acaba de pasar.
 */
export function drawWinnerPlate(
  c: CanvasRenderingContext2D,
  names: readonly string[],
  cx: number,
  cy: number,
  k: number,
  scale: number,
  maxSize = 64,
): void {
  const many = names.length > 1;
  let size = many ? Math.max(24 * k, (maxSize * k) / Math.min(names.length, 3)) : maxSize * k;
  const rows = names.map((n, i) => (many ? `${i + 1}. ${shorten(n, 22)}` : shorten(n, 26)));
  c.save();
  c.translate(cx, cy);
  c.scale(scale, scale);
  c.textAlign = "center";
  c.textBaseline = "middle";

  // El tamaño sale de la altura de la pantalla, y en un celular eso no dice
  // nada del ancho: a 390 por 844 la unidad vale 2,3, así que el cartel salía
  // con tipografía de 150 píxeles sobre un lienzo de 780. Un nombre largo se
  // iba de los dos bordes y el lienzo lo recortaba sin avisar. Se achica hasta
  // que entra, que es lo que haría cualquiera a mano.
  // El cartel entra con un rebote que llega a un 10% de más, y lleva la sombra
  // corrida diez unidades: las dos cosas cuentan. Medido sólo a tamaño final,
  // en un celular un nombre largo tocaba los dos bordes en el pico del rebote
  // y la sombra quedaba cortada.
  const cabe = (c.canvas.width * 0.94) / 1.1 - 10 * k;
  let wide = 0;
  for (let i = 0; i < 9; i++) {
    c.font = `900 ${size}px system-ui, sans-serif`;
    wide = rows.reduce((m, r) => Math.max(m, c.measureText(r).width), 0);
    // A tamaño final, no al de la animación de entrada: `scale` crece cuadro a
    // cuadro y medir contra él haría bailar la tipografía mientras entra.
    if (wide + 72 * k <= cabe || size <= 14) break;
    size *= 0.86;
  }
  const bw = wide + 72 * k;
  const lineH = size * 1.2;
  const bh = Math.max(110 * k, rows.length * lineH + 44 * k);
  markPlate(c, -bw / 2, -bh / 2, bw, bh);
  c.fillStyle = "#e93d9c";
  c.fillRect(-bw / 2 + 10 * k, -bh / 2 + 10 * k, bw, bh);
  c.fillStyle = "#ffc629";
  c.fillRect(-bw / 2, -bh / 2, bw, bh);
  c.lineWidth = 6 * k;
  c.strokeStyle = INK;
  c.strokeRect(-bw / 2, -bh / 2, bw, bh);
  c.fillStyle = INK;
  const top = -((rows.length - 1) * lineH) / 2;
  // El nombre entra un poco después que el cartel, subiendo desde el borde de
  // abajo. Antes cartel y nombre aparecían pegados y el momento se leía como
  // una sola cosa que crece; ahora primero llega el cartel y después el nombre
  // se asienta adentro, que es donde mira la sala. La animación sale del mismo
  // `scale` que trae cada juego, así que todos la tienen sin tocar nada.
  const entra = clamp((scale - 0.5) / 0.42, 0, 1);
  c.globalAlpha = entra;
  rows.forEach((r, i) => c.fillText(r, 0, top + i * lineH + (1 - entra) * lineH * 0.5));
  c.globalAlpha = 1;
  c.restore();
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
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
