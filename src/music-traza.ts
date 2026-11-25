import { vi } from "vitest";

/**
 * Un contexto de audio de mentira que anota todo lo que la música le programa, y un guion del show con reloj falso.
 * Sirve para comparar, nota por nota, lo que suena ahora con lo que sonaba antes de un cambio (`music-igual-a-hoy.test.ts`).
 * No lo importa ningún archivo del sitio: solo las pruebas.
 */

/** Un número redondeado a 6 decimales: la misma cuenta da lo mismo en cualquier máquina. */
const num = (v: number): string => (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : String(v));

/** Una versión corta de cualquier valor, para anotarlo. */
function resumen(v: unknown, ids: WeakMap<object, string>): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "string" || typeof v === "boolean" || v == null) return String(v);
  if (typeof v === "function") return "fn";
  if (v instanceof Float32Array) {
    let suma = 0;
    for (let i = 0; i < v.length; i += 7) suma += (v[i] as number) * (1 + (i % 13));
    return `curva(${v.length},${num(suma)})`;
  }
  if (typeof v === "object") return ids.get(v as object) ?? "obj";
  return "?";
}

export interface ContextoDeMentira {
  ctx: AudioContext;
  /** Todo lo programado, en orden. */
  eventos: string[];
  /** La hora del audio, en segundos. */
  poner(segundos: number): void;
}

export function contextoDeMentira(): ContextoDeMentira {
  const eventos: string[] = [];
  const ids = new WeakMap<object, string>();
  let cuantos = 0;
  let ahora = 0;
  const anotar = (...partes: unknown[]): void => {
    eventos.push(partes.map((p) => resumen(p, ids)).join(" "));
  };

  const METODOS = new Set(["connect", "disconnect", "start", "stop", "setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "setValueCurveAtTime", "cancelScheduledValues", "cancelAndHoldAtTime", "addEventListener", "removeEventListener"]);

  // eslint-disable-next-line prefer-const
  let ctxProxy: AudioContext;

  /** Un nodo (o un parámetro de un nodo): cualquier propiedad que se le pida existe y todo lo que se le programa queda anotado. */
  function nodo(nombre: string, camino: string): unknown {
    const guardado = new Map<string, unknown>();
    const objetivo = function () {} as unknown as object;
    const id = camino === "" ? `${nombre}#${cuantos++}` : camino;
    const p: unknown = new Proxy(objetivo, {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then") return undefined;
        if (prop === "context") return ctxProxy;
        if (guardado.has(prop)) return guardado.get(prop);
        if (METODOS.has(prop)) {
          const f = (...args: unknown[]): unknown => {
            anotar(id, prop, ...args);
            return prop === "connect" ? args[0] : undefined;
          };
          guardado.set(prop, f);
          return f;
        }
        const hijo = nodo(nombre, `${id}.${prop}`);
        guardado.set(prop, hijo);
        return hijo;
      },
      set(_t, prop, valor) {
        if (typeof prop === "symbol") return true;
        guardado.set(prop, valor);
        if (typeof valor !== "function") anotar(id, `=${prop}`, valor);
        return true;
      },
      apply() {
        return undefined;
      },
    });
    ids.set(objetivo, id);
    return p;
  }

  const buffer = (canales: number, largo: number, tasa: number): unknown => {
    const datos = Array.from({ length: canales }, () => new Float32Array(largo));
    const b = {
      numberOfChannels: canales,
      length: largo,
      sampleRate: tasa,
      duration: largo / tasa,
      getChannelData: (i: number): Float32Array => datos[i] as Float32Array,
      copyToChannel: (d: Float32Array, i: number): void => void (datos[i] as Float32Array).set(d),
    };
    ids.set(b, `buffer#${cuantos++}(${canales},${largo})`);
    return b;
  };

  const base = {
    get currentTime(): number {
      return ahora;
    },
    sampleRate: 44100,
    state: "running",
    resume: (): Promise<void> => Promise.resolve(),
    suspend: (): Promise<void> => Promise.resolve(),
    close: (): Promise<void> => Promise.resolve(),
    createBuffer: buffer,
    decodeAudioData: (): Promise<unknown> => Promise.reject(new Error("sin decodificar en la mentira")),
  } as Record<string, unknown>;
  base.destination = nodo("destination", "");

  ctxProxy = new Proxy(base, {
    get(t, prop) {
      if (typeof prop === "string" && prop.startsWith("create") && !(prop in t)) return () => nodo(prop.slice(6), "");
      return t[prop as string];
    },
  }) as unknown as AudioContext;

  return {
    ctx: ctxProxy,
    eventos,
    poner: (s: number): void => {
      ahora = s;
    },
  };
}

/** Una constructora de contexto que siempre entrega el mismo, para `window.AudioContext`. */
export function constructoraDe(c: ContextoDeMentira): typeof AudioContext {
  return function () {
    return c.ctx;
  } as unknown as typeof AudioContext;
}

/** Un paso del guion: cuánto pasó desde el tick anterior y lo que hace el juego en ese momento. */
export interface PasoDelGuion {
  /** Milisegundos desde el tick anterior (lo que tardó el hilo en volver). */
  ms: number;
  /** La pestaña está escondida en este tick. */
  escondida?: boolean;
  /** Lo que el juego le pide a la música justo antes de este tick. */
  antes?: (m: typeof import("./music")) => void;
}

/**
 * Un show de principio a fin con el reloj de la página y el del audio al mismo paso: ticks a tiempo, tropiezos de
 * 160, 320 y 640 ms (el procesador frenado 4, 8 y 16 veces), la pestaña escondida a uno por segundo y la vuelta, un
 * tirón de la red, y todo lo que el juego le dice a la música (la tensión, el silencio, el aliento, el ritmo, el
 * remate). Termina en el remate.
 */
export function guionDelShow(): PasoDelGuion[] {
  const pasos: PasoDelGuion[] = [];
  const a = (ms: number, extra: Partial<PasoDelGuion> = {}): void => void pasos.push({ ms, ...extra });
  const tiempo = (cuantos: number, ms = 40): void => {
    for (let i = 0; i < cuantos; i++) a(ms);
  };
  tiempo(50);
  a(40, { antes: (m) => m.musicCue(0.25) });
  tiempo(40);
  // El procesador frenado 4, 8 y 16 veces, con su recuperación.
  tiempo(6, 160);
  tiempo(30);
  tiempo(6, 320);
  tiempo(30);
  tiempo(6, 640);
  tiempo(60);
  a(40, { antes: (m) => m.musicCue(0.5) });
  tiempo(30);
  // La pestaña escondida: los temporizadores bajan a uno por segundo. Vuelve con un tropiezo y se recupera.
  for (let i = 0; i < 6; i++) a(1000, { escondida: true });
  a(700);
  tiempo(60);
  a(40, { antes: (m) => m.musicBreath() });
  tiempo(20);
  // Una sorpresa grande y un silencio del juego.
  a(40, { antes: (m) => m.musicCue(0.9) });
  tiempo(25);
  a(40, { antes: (m) => m.musicHold(true) });
  tiempo(15);
  a(40, { antes: (m) => m.musicHold(false) });
  tiempo(10);
  a(40, { antes: (m) => m.musicTempo(1.1) });
  // Un tirón de la red.
  a(1500);
  a(1200);
  a(900);
  tiempo(60);
  // El remate: el ganador y el festejo.
  a(40, { antes: (m) => m.musicCue(1) });
  tiempo(40);
  a(40, { antes: (m) => m.musicFinal() });
  tiempo(30);
  return pasos;
}

/** Lo que programó la música en un show, nota por nota. */
export interface TrazaDelShow {
  eventos: string[];
  /** Cuántas notas (arranques de osciladores y de ruido) se programaron. */
  notas: number;
  /** Por cada tick: la hora del audio, si la pestaña estaba escondida y qué tramo de `eventos` programó. */
  porTick: { ahora: number; escondida: boolean; desde: number; hasta: number }[];
}

/**
 * Corre un show entero de un juego con el reloj falso y la misma semilla, tal como lo hace el sitio: avisa el juego,
 * arranca la música y le da cada tick del guion. Cada corrida arma módulos nuevos, así que una no contamina a la otra.
 * `antes` corre después de cargar los módulos y antes de arrancar (para prender un interruptor, por ejemplo).
 */
export async function trazaDelShow(
  juego: string,
  semilla: number,
  guion: PasoDelGuion[] = guionDelShow(),
  antes?: () => Promise<void> | void,
): Promise<TrazaDelShow> {
  vi.resetModules();
  const c = contextoDeMentira();
  const reloj = { ms: 100000 };
  let tick: (() => void) | null = null;
  let escondida = false;
  const w = window as unknown as { AudioContext?: unknown };
  const ctorViejo = w.AudioContext;
  w.AudioContext = constructoraDe(c);
  vi.spyOn(performance, "now").mockImplementation(() => reloj.ms);
  vi.spyOn(window, "setInterval").mockImplementation(((fn: () => void) => {
    tick = fn;
    return 1;
  }) as unknown as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => escondida });
  const porTick: TrazaDelShow["porTick"] = [];
  try {
    const sound = await import("./sound");
    const m = await import("./music");
    if (antes) await antes();
    c.poner(reloj.ms / 1000);
    sound.sonidoDelJuego(juego as never);
    m.startMusic(semilla, juego === "chovena" ? "chovena" : "andino");
    for (const paso of guion) {
      reloj.ms += paso.ms;
      c.poner(reloj.ms / 1000);
      escondida = !!paso.escondida;
      paso.antes?.(m);
      const desde = c.eventos.length;
      (tick as (() => void) | null)?.();
      porTick.push({ ahora: reloj.ms / 1000, escondida, desde, hasta: c.eventos.length });
    }
    m.stopMusic();
  } finally {
    vi.restoreAllMocks();
    w.AudioContext = ctorViejo;
    delete (document as unknown as { hidden?: boolean }).hidden;
  }
  return { porTick, eventos: c.eventos, notas: c.eventos.filter((e) => / start /.test(e) && !/\.\w+ start/.test(e)).length };
}

/** Los diez juegos del selector, con los ids con que abren (`id` de cada botón `g-<id>` en `index.html`). */
export const JUEGOS_DEL_SELECTOR = ["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi"] as const;

/** Una semilla distinta por juego, siempre la misma. */
export const semillaDelJuego = (juego: string): number => 0x1234abcd + 977 * JUEGOS_DEL_SELECTOR.indexOf(juego as (typeof JUEGOS_DEL_SELECTOR)[number]);
