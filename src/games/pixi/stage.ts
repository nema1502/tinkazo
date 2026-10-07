import { Application, Container, Graphics, Sprite, Text, Texture, WebGLRenderer, loadEnvironmentExtensions, type TextStyleOptions } from "pixi.js";
import { gsap } from "gsap";
import { $ } from "../../dom";
import { T, getLang, setPickSeed, t } from "../../i18n";
import { LCOLORS, drawAvatar, paceFactor, params, skipMotion, takeShowGate, type Beacon } from "../../state";
import { musicBreath, musicCue, startMusic, stopMusic, type MusicStyle } from "../../music";
import { beep, note } from "../../sound";
import { registerSkip, releaseScreen, shorten, takeOverScreen, winnerNames } from "../overlay";
import { Camera } from "./camera";
import { watchRecovery } from "./recover";

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

/**
 * Lo que PixiJS baja recién al arrancar, pedido antes: el entorno del
 * navegador (`loadEnvironmentExtensions`) y el renderizador de WebGL, que
 * `app.init` importa aparte. Con la referencia de acá, el renderizador viaja
 * en el mismo archivo que este andamiaje y ya está cuando el juego arranca.
 * No crea ningún contexto ni toca la pantalla.
 */
export async function warmPixi(): Promise<string> {
  await loadEnvironmentExtensions(false);
  return WebGLRenderer.name;
}

/** El motor no pudo arrancar en este equipo: el juego se cuenta con el de siempre. */
export class PixiInitError extends Error {
  constructor(cause: unknown) {
    super("PixiJS no arrancó", { cause });
  }
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
  /** `faceOf`: de quién es la cara, cuando la etiqueta es una versión corta del nombre. */
  chip(name: string, scale?: number, faceOf?: string): Container;
  /**
   * Los nombres de `who` encima de cada uno, en una capa propia que los juegos
   * no vacían: repartidos para que no se pisen y adentro de la pantalla. `at(i)`
   * es el punto de la pantalla sobre la cabeza de la persona `i`, o null si no
   * se ve. Se llama en cada cuadro con la lista de ese momento (vacía, para
   * sacarlos).
   */
  tags(names: string[], who: readonly number[], at: (i: number) => { x: number; y: number } | null, avoid?: readonly { x: number; y: number; width: number; height: number }[]): void;
  /**
   * La tanda de la lista que toca en `t`: todos de a ocho, entre `t0` y `t1`,
   * tomando uno de cada tantos de `order` para que la tanda quede repartida por
   * la escena. Vacía fuera de ese rato o con más de 64 personas, donde los
   * nombres ya no entran.
   */
  batch(n: number, t: number, t0: number, t1: number, order?: readonly number[]): number[];
  /**
   * El respiro antes del ganador: la música se corta 0,4 s reales antes de
   * coronar y el remate la vuelve a abrir. `t` es el reloj del juego, `at`
   * cuándo corona en ese reloj, y `speed` qué tan rápido corre ese reloj en
   * ese momento (0,4 en la cámara lenta de la carrera). Se llama en cada cuadro.
   */
  breath(t: number, at: number, speed?: number): void;
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
  /** Dibuja el cartel una vez a una textura que se tira: ver `warmUp`. */
  warm(): void;
}

/** Lo que mide `?auditar=identidad`: cuándo se leyó por primera vez cada nombre. */
interface Identidad {
  n: number;
  /** Segundos desde que arrancó el juego, o -1 si no se leyó antes del ganador. */
  vistos: number[];
  /** Cuándo salió el cartel del ganador; lo que se lee después no cuenta. */
  revelado: number | null;
  muestras: number;
}

/**
 * `?auditar=identidad`, para `scripts/audit-identidad.mjs`: qué nombres se
 * llegan a leer antes de que salga el ganador. Cada persona tiene que poder
 * saber en dos segundos si sigue en juego, y la forma más directa es ver su
 * nombre (auditoría de los juegos, 4 de octubre de 2026).
 *
 * Recorre los textos de la escena, del HUD y de pasar lista, no los del
 * cartel del ganador.
 * Un nombre cuenta si se ve entero en pantalla, con opacidad de 0,6 o más y
 * un alto de al menos 1,6% de la pantalla. Las etiquetas cortas ("María Q.",
 * "Valeria Torr…") cuentan solo si no se confunden con otro nombre.
 */
function identidadDe(names: string[]): { estado: Identidad; mirar: (raices: Container[], ahora: number, sw: number, sh: number) => void } {
  const norm = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const nombres = names.map(norm);
  const exactos = new Map<string, number[]>();
  nombres.forEach((nm, i) => exactos.set(nm, [...(exactos.get(nm) ?? []), i]));
  const memo = new Map<string, number>();
  const quien = (txt: string): number => {
    const s = norm(txt);
    const hecho = memo.get(s);
    if (hecho !== undefined) return hecho;
    let hit = -1;
    const ex = exactos.get(s);
    if (ex) hit = ex.length === 1 ? (ex[0] as number) : -1;
    else {
      const ts = s.split(" ").map((x) => x.replace(/[.…]+$/, "")).filter(Boolean);
      for (let i = 0; ts.length && i < nombres.length; i++) {
        const ns = (nombres[i] as string).split(" ");
        if (ts.length > ns.length) continue;
        const ok = ts.every((a, j) => (j < ts.length - 1 ? a === ns[j] : (ns[j] ?? "").startsWith(a)));
        if (!ok) continue;
        if (hit >= 0) {
          hit = -1;
          break;
        }
        hit = i;
      }
    }
    memo.set(s, hit);
    return hit;
  };
  const estado: Identidad = { n: names.length, vistos: names.map(() => -1), revelado: null, muestras: 0 };
  const mirar = (raices: Container[], ahora: number, sw: number, sh: number): void => {
    if (estado.revelado !== null) return;
    estado.muestras++;
    const min = Math.max(10, sh * 0.016);
    const visitar = (c: Container, alfa: number): void => {
      if (!c.visible || !c.renderable) return;
      const a = alfa * c.alpha;
      if (a < 0.05) return;
      if (c instanceof Text) {
        const i = a >= 0.6 ? quien(c.text) : -1;
        if (i >= 0 && (estado.vistos[i] as number) < 0) {
          const b = c.getBounds();
          if (b.height >= min && b.x >= 0 && b.y >= 0 && b.x + b.width <= sw && b.y + b.height <= sh) estado.vistos[i] = ahora;
        }
        return;
      }
      for (const ch of c.children) visitar(ch as Container, a);
    };
    for (const r of raices) visitar(r, 1);
  };
  return { estado, mirar };
}

/** Lo que un juego pide al montar el estadio. */
export interface MountOptions {
  /** La música del juego: la andina de siempre, salvo que pida otra. */
  music?: MusicStyle;
}

export async function mountPixi(beacon: Beacon, done: () => void, onSkip: () => void, opts: MountOptions = {}): Promise<PixiStage | null> {
  if (skipMotion()) return null;
  const ov = $("stadium");
  const base = $<HTMLCanvasElement>("race-canvas");
  const commentEl = $("commentary");
  commentEl.textContent = "";
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;

  // El lienzo de siempre queda escondido; PixiJS dibuja en uno propio, porque
  // un lienzo que ya dio un contexto 2D no puede dar uno de WebGL.
  base.style.visibility = "hidden";
  delete base.dataset.cartel;
  delete base.dataset.mitad;
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
  try {
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
  } catch (err) {
    // Sin motor no se muestra nada: todo queda como estaba y el sorteo sigue
    // con el motor de siempre.
    view.remove();
    base.style.visibility = "";
    setPickSeed(null);
    throw new PixiInitError(err);
  }
  // La pantalla completa ahora se pide con la tarjeta, así que la ventana pudo
  // cambiar de tamaño mientras el motor arrancaba, antes de que existiera el
  // aviso de resize: se mide de nuevo.
  if (app.screen.width !== innerWidth || app.screen.height !== innerHeight) app.renderer.resize(innerWidth, innerHeight);
  const bg = new Container();
  const scene = new Container();
  const hud = new Container();
  // El cartel del ganador tiene su propia capa: los juegos vacían `hud` cuando
  // cambia el tamaño de la pantalla, y el cartel se rearma solo.
  const podium = new Container();
  // Los nombres de pasar lista tienen su capa: los juegos vacían `hud` cuando
  // cambia el tamaño de la pantalla, y estos se rearman solos.
  const tagLayer = new Container();
  app.stage.addChild(bg, scene, hud, tagLayer, podium);
  const cam = new Camera();
  // `?auditar=identidad`: ver `identidadDe`. Se arma con los nombres del primer cartel.
  const identPedida = params.get("auditar") === "identidad";
  // `?auditar=mezcla`: el instante del revelado, para que el auditor de mezcla
  // compare lo que suena antes y después del ganador.
  const mezclaPedida = params.get("auditar") === "mezcla";
  let ident: ReturnType<typeof identidadDe> | null = null;
  let relojId = 0;
  let cuadros = 0;

  // El estadio aparece recién con el juego armado y el primer cuadro
  // dibujado, justo antes de que corra el bucle (ver `run`). Dos razones:
  // arrancar el motor tarda distinto en cada carga, y si el estadio se
  // mostraba antes, el primer cuadro del juego caía en otro momento de cada
  // corrida y el auditor exigente comparaba dos corridas desfasadas; y entre
  // mostrarlo y el primer cuadro la sala veía el lienzo vacío, hasta dos
  // segundos en un celular lento (auditoría del stack, 29 de septiembre de 2026).
  let shown = false;
  const show = (): void => {
    if (shown) return;
    shown = true;
    ov.style.display = "block";
    document.body.style.overflow = "hidden";
    takeOverScreen(ov);
    registerSkip(onSkip);
  };

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

  // Los textos se dibujan al doble: la cámara se acerca hasta 1,5× o más sobre
  // el ganador, y un nombre dibujado a la resolución de la pantalla se veía
  // borroso justo ahí (el sapo, 4 de octubre de 2026). El tope en 3 cuida la
  // memoria en pantallas de alta densidad.
  const textRes = Math.min(3, dpr * 2);
  const text = (s: string, style: TextStyleOptions): Text =>
    new Text({ text: s, style: { fontFamily: FONT, ...style }, resolution: textRes });

  const chip = (name: string, scale = 1, faceOf = name): Container => {
    const k = u() * scale;
    const c = new Container();
    const label = text(shorten(name, 20), { fontSize: 12 * k, fontWeight: "800", fill: INK });
    const av = new Sprite(face(faceOf));
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

  // The GPU can drop textures while the tab is hidden (mobile). Pixi uploads
  // them again on its own; the winner plate and the chips need a rebuild.
  // Cheap path (tab back, context intact): only the crowns, no game resizers,
  // no camera. Heavy path (context restored): full resize, camera pose kept
  // so the shot does not snap.
  const repaint = (full: boolean): void => {
    if (dead) return;
    try {
      if (full) {
        const pose = cam.snapshot();
        try {
          onResize();
        } finally {
          cam.restore(pose);
        }
      } else {
        for (const c of crowns) c.rebuild();
      }
      app.renderer.render(app.stage);
    } catch {
      /* the loop goes on; a failed recovery must not skip done() */
    }
  };
  const stopWatching = watchRecovery(view, document, { onReturn: () => repaint(false), onRestore: () => repaint(true) });

  /**
   * Lo que cuesta la primera vez, pagado antes de mostrar el estadio: el
   * desenfoque de la cámara (su compilación congelaba el primer zoom), el
   * nombre del ganador dibujado a textura (se rasterizaba en el cuadro del
   * revelado, el que toda la sala está mirando) y un primer dibujo de la
   * escena armada, con sus texturas ya en la placa. Si algo de esto falla, se
   * paga en el primer cuadro, como antes.
   */
  const warmUp = (): void => {
    // La música arma su sala (el eco sale de una respuesta al impulso de un
    // segundo y medio) antes de que se vea el estadio: armarla en el primer
    // cuadro lo congelaba.
    startMusic(parseInt(beacon.randomness.slice(8, 16), 16), opts.music);
    try {
      cam.warm(app.renderer);
      for (const c of crowns) c.warm();
      app.renderer.render(app.stage);
    } catch {
      /* se paga después, en su momento */
    }
  };

  const crown = (names: string[], winners: readonly number[]): Crown => {
    if (identPedida && !ident) {
      ident = identidadDe(names);
      (window as unknown as { __identidad: Identidad }).__identidad = ident.estado;
    }
    const root = new Container();
    podium.addChild(root);
    const flash = new Graphics();
    const confetti = new Graphics();
    const plate = new Container();
    root.addChild(confetti, plate, flash);
    const tl = gsap.timeline({ paused: true });
    cleaners.push(() => tl.kill());
    const all = winnerNames(names, winners);
    /** Cuándo entra cada premio después del primero, en segundos de la corona. */
    let entradas: number[] = [];
    const sonados = new Set<number>();
    const build = (): void => {
      plate.removeChildren().forEach((c) => c.destroy({ children: true }));
      flash.clear().rect(0, 0, sw(), sh()).fill(0xffffff);
      const k = u();
      const title = text(getLang() === "es" ? (all.length > 1 ? "GANAN" : "GANA") : all.length > 1 ? "WINNERS" : "WINNER", {
        fontFamily: MONO, fontSize: 14 * k, fontWeight: "900", fill: INK, letterSpacing: 3 * k,
      });
      // Hasta tres nombres y "y N más", igual que el relator.
      const resto = all.length - 3;
      const lines = all.length <= 3 ? all : [...all.slice(0, 3), getLang() === "es" ? `y ${resto} más` : `and ${resto} more`];
      const big = lines.length === 1;
      // Con varios premios, el primero un poco más grande y cada uno con su
      // cara: antes eran renglones chicos e iguales, sin cara, y desde el fondo
      // no se sabía quién era quién ni cuál era el primero.
      const conCara = (i: number): boolean => !big && (all.length <= 3 || i < 3);
      const talla = (i: number): number => (big ? 54 : i === 0 ? 46 : 38) * k;
      const nameTexts = lines.map((n, i) =>
        text(conCara(i) ? `${i + 1}. ${n}` : n, { fontSize: talla(i), fontWeight: "900", fill: INK }),
      );
      const cara = (i: number): number => (conCara(i) ? talla(i) * 1.1 : 0);
      const hueco = (i: number): number => (conCara(i) ? cara(i) + 12 * k : 0);
      for (const [i, tx] of nameTexts.entries()) {
        const maxW = sw() * 0.86 - (big ? 130 : 40) * k - hueco(i);
        if (tx.width > maxW) tx.scale.set(maxW / tx.width);
      }
      const innerW = Math.max(title.width, ...nameTexts.map((x, i) => x.width + hueco(i)));
      const pw = innerW + (big ? 132 : 56) * k;
      const altos = nameTexts.map((_, i) => (big ? 60 * k : talla(i) * 1.22));
      const lineH = altos[0] ?? 60 * k;
      const ph = 40 * k + altos.reduce((a, h) => a + h, 0) + 16 * k;
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
      // Cada renglón en su contenedor, para que con varios premios entren de a uno.
      const renglones: Container[] = [];
      let y = -ph / 2 + 36 * k;
      nameTexts.forEach((tx, i) => {
        const fila = new Container();
        if (conCara(i)) {
          const lado = cara(i);
          const av = new Sprite(face(all[i] ?? ""));
          av.width = av.height = lado;
          av.position.set(0, (altos[i] ?? lineH) / 2 - lado / 2 - 2 * k);
          fila.addChild(av, new Graphics().rect(av.x - 2 * k, av.y - 2 * k, lado + 4 * k, lado + 4 * k).stroke({ width: 3 * k, color: INK }));
        }
        tx.position.set(hueco(i), 0);
        fila.addChild(tx);
        fila.position.set(x0, y);
        y += altos[i] ?? lineH;
        plate.addChild(fila);
        renglones.push(fila);
      });
      plate.position.set(sw() / 2, portrait() ? sh() * 0.24 : sh() * 0.26);
      tl.clear();
      tl.fromTo(flash, { alpha: 0.9 }, { alpha: 0, duration: 0.5, ease: "power2.out" }, 0)
        .fromTo(plate.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.9, ease: "elastic.out(1, 0.55)" }, 0.12)
        .fromTo(plate, { rotation: -0.12 }, { rotation: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" }, 0.12);
      // Con varios premios, el primero aparece con el cartel y los demás
      // llegan después, de a uno: cada premio tiene su momento.
      // En segundos reales: la corona recibe la hora del juego, que el
      // selector de duración estira, y en "épico" el tercer premio entraba
      // cuando el cartel ya se iba.
      const real = (s: number): number => s / paceFactor();
      entradas = big ? [] : renglones.slice(1).map((_, i) => real(0.55 + (i + 1) * 0.35));
      if (!big) {
        renglones.forEach((fila, i) => {
          if (i === 0) return;
          tl.fromTo(fila, { alpha: 0, x: x0 - 40 * k }, { alpha: 1, x: x0, duration: real(0.35), ease: "back.out(2)" }, real(0.55 + i * 0.35));
        });
      }
    };
    build();
    root.visible = false;
    // The last pose, to put a rebuilt plate back where it was.
    let lastT = 0;
    let lastPlaca = true;
    const c: Crown = {
      root,
      at(tt: number, placa = true) {
        if (ident && ident.estado.revelado === null) ident.estado.revelado = relojId;
        const w = window as unknown as { __revelado?: number };
        if (mezclaPedida && w.__revelado === undefined) w.__revelado = performance.now();
        lastT = tt;
        lastPlaca = placa;
        root.visible = true;
        plate.visible = placa;
        tl.time(Math.max(0, tt));
        // Cada premio que entra suena, más grave cuanto más abajo en la lista.
        // Si se saltó la animación, no suenan todos juntos de golpe.
        entradas.forEach((te, i) => {
          if (tt < te || sonados.has(i)) return;
          sonados.add(i);
          if (tt - te > 0.3) return;
          beep(note(12 - 2 * i), 0.42, "triangle", 0.055);
          beep(note(7 - 2 * i), 0.6, "triangle", 0.04);
        });
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
      rebuild() {
        build();
        // `build` leaves the plate at scale 0 (the entrance animation starts
        // there): if it was already shown, replay it to the same moment.
        if (root.visible) c.at(lastT, lastPlaca);
      },
      warm() {
        // El cartel arranca en escala cero por su animación: sin tamaño no se
        // dibuja nada, y el nombre no se rasteriza.
        const sx = plate.scale.x;
        const sy = plate.scale.y;
        plate.scale.set(1);
        app.renderer.generateTexture(plate).destroy(true);
        plate.scale.set(sx, sy);
      },
    };
    crowns.push(c);
    return c;
  };

  /**
   * Pasar lista (auditoría de identificación, 4 de octubre de 2026): cada
   * persona tiene que poder saber en dos segundos cuál es la suya. Lo usan los
   * juegos donde cada uno tiene su lugar desde el arranque.
   */
  let tagChips = new Map<number, Container>();
  let tagK = 0;
  const tags = (names: string[], who: readonly number[], at: (i: number) => { x: number; y: number } | null, avoid: readonly { x: number; y: number; width: number; height: number }[] = []): void => {
    const k = u();
    if (k !== tagK) {
      tagLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      tagChips = new Map();
      tagK = k;
    }
    for (const c of tagChips.values()) c.visible = false;
    const placed: { x: number; y: number; w: number; h: number }[] = avoid.map((r) => ({ x: r.x, y: r.y + r.height / 2, w: r.width, h: r.height }));
    const W = sw(), H = sh();
    const lo = top() + 14 * k, hi = H - bottom() - 16 * k;
    const pts = who.map((i) => ({ i, p: at(i) })).filter((a): a is { i: number; p: { x: number; y: number } } => !!a.p).sort((a, b) => a.p.y - b.p.y);
    for (const { i, p } of pts) {
      let c = tagChips.get(i);
      if (!c) {
        c = chip(names[i] ?? "", portrait() ? 0.9 : 1);
        tagChips.set(i, c);
        tagLayer.addChild(c);
      }
      c.visible = true;
      const cw = c.width, ch = 24 * k;
      const cx = (v: number): number => Math.max(8 * k, Math.min(W - cw - 8 * k, v));
      const cy = (v: number): number => Math.max(lo, Math.min(hi, v));
      const choca = (a: number, b: number): boolean => placed.some((r) => a < r.x + r.w && a + cw > r.x && b - ch / 2 < r.y + r.h / 2 && b + ch / 2 > r.y - r.h / 2);
      let x = cx(p.x - cw / 2);
      let y = cy(p.y - ch / 2);
      // Primero encima, después a los costados: apilados en escalera quedaban
      // lejos de su dueño (lo vio el agente evaluador en el trompo, en celular).
      const libre = ([[x, y], [x - cw * 0.62, y], [x + cw * 0.62, y]] as const).map(([a, b]) => [cx(a), cy(b)] as const).find(([a, b]) => !choca(a, b));
      if (libre) [x, y] = libre;
      for (let tries = 0; tries < 8 && !libre; tries++) {
        const hit = placed.find((r) => x < r.x + r.w && x + cw > r.x && y - ch / 2 < r.y + r.h / 2 && y + ch / 2 > r.y - r.h / 2);
        if (!hit) break;
        y = hit.y - (hit.h + ch) / 2 - 2 * k;
        if (y < lo) {
          y = hit.y + (hit.h + ch) / 2 + 2 * k;
          x = Math.max(8 * k, Math.min(W - cw - 8 * k, x + cw * 0.35));
        }
      }
      placed.push({ x, y, w: cw, h: ch });
      c.position.set(x, y);
    }
  };
  let breathed = false;
  const breath = (t: number, at: number, speed = 1): void => {
    if (breathed || t >= at) return;
    if (t >= at - (0.4 * speed) / paceFactor()) {
      breathed = true;
      musicBreath();
    }
  };
  const batch = (n: number, t: number, t0: number, t1: number, order?: readonly number[]): number[] => {
    if (n > 64 || n <= 0 || t < t0 || t >= t1) return [];
    const B = Math.max(1, Math.ceil(n / 8));
    const b = Math.min(B - 1, Math.floor(((t - t0) / (t1 - t0)) * B));
    const seq = order ?? Array.from({ length: n }, (_, i) => i);
    return seq.filter((_, j) => j % B === b);
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
      musicCue(heat);
    },
    face, text, chip, tags, batch, breath, mark, crown,
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
        if (ident) {
          relojId = (now - start) / 1000;
          if (cuadros++ % 5 === 0) ident.mirar([scene, hud, tagLayer], relojId, sw(), sh());
        }
        rafId = requestAnimationFrame(loop);
      };
      const arrancar = (): void => {
        show();
        rafId = requestAnimationFrame(loop);
      };
      // Con la tarjeta de "cómo se juega" arriba, lo caro se paga mientras la
      // sala la lee (la música ya suena) y la escena espera armada: el reloj del
      // juego corre recién cuando la tarjeta termina.
      warmUp();
      const gate = takeShowGate();
      if (gate) void gate.then(() => (dead ? undefined : arrancar()));
      else arrancar();
    },
    cleanup() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(rafId);
      removeEventListener("resize", onResize);
      stopWatching();
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
      stopMusic();
      $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
      done();
    },
  };
  return stage;
}

/** El texto del ganador, en el idioma de la página, para el relator. */
export const winLine = (label: string): string => T[getLang()].cWin(label);
