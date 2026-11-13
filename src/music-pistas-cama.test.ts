// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferFalso, ContextoFalso, type FuenteFalsa, type NodoFalso, type ParamFalso } from "./sonidos/audio-falso";

/**
 * La pista de archivo llega tarde (dentro de la gracia de un segundo y medio) a un juego que tiene cama de archivo.
 * Mientras la pista no llegó suena la cama; cuando llega, la cama se va y queda sola la pista: ni al soltar la retención
 * ni en el golpe vuelve a abrirse el bus de osciladores (donde está la cama), porque serían dos músicas a la vez.
 */

const cama = vi.hoisted(() => ({ buffer: null as unknown }));
vi.mock("./sonidos/banco", async (original) => ({
  ...(await original<typeof import("./sonidos/banco")>()),
  camaDeMusica: () => cama.buffer,
}));

// Las pruebas ponen sus propias pistas: la lista de verdad no cuenta.
vi.mock("./sonidos/pistas-lista", () => ({ PISTAS: {} }));

class ContextoDeLaPagina extends ContextoFalso {}
vi.stubGlobal("AudioContext", ContextoDeLaPagina);
(window as unknown as { AudioContext: unknown }).AudioContext = ContextoDeLaPagina;

const { audio, sonidoDelJuego } = await import("./sound");
const { musicBreath, musicCue, musicHold, startMusic, stopMusic } = await import("./music");
const { estadoDePistas, reiniciarPistas } = await import("./sonidos/pistas-enganche");

const BASE = "http://127.0.0.1:8796/muestra/";
const PISTA = {
  formato: 1,
  juego: "race",
  version: "m0",
  pulso: { bpm: 120, tiempos: 2, compas: 1 },
  secciones: {
    entrada: { archivo: "race-m0-entrada.mp3", inicio: 0, compases: 7 },
    cuerpo: { archivo: "race-m0-cuerpo.mp3", inicio: 0.5, compases: 32 },
    subida: { archivo: "race-m0-subida.mp3", inicio: 0.5, compases: 14, bucleDesde: 10 },
    golpe: { archivo: "race-m0-golpe.mp3", inicio: 0.05, compases: 2 },
    festejo: { archivo: "race-m0-festejo.mp3", inicio: 0.1 },
  },
};
/** Cada archivo de mentira pesa distinto, y con eso el contexto de mentira sabe cuánto dura. */
const PESOS: Record<string, number> = {
  "race-m0-entrada.mp3": 101,
  "race-m0-cuerpo.mp3": 102,
  "race-m0-subida.mp3": 103,
  "race-m0-golpe.mp3": 104,
  "race-m0-festejo.mp3": 105,
};
const DURACION: Record<number, number> = { 101: 7.5, 102: 33, 103: 15, 104: 2.4, 105: 4 };

const ctx = (): ContextoFalso => audio() as unknown as ContextoFalso;
let semilla = 5000;
/** Las decodificaciones que esperan a que la prueba las suelte. */
let esperando: (() => void)[] = [];

/** Corre el reloj del audio y el de la página juntos, de a 40 ms. */
function avanzar(segundos: number): void {
  for (let i = 0; i < Math.round(segundos / 0.04); i++) {
    ctx().currentTime = Math.round((ctx().currentTime + 0.04) * 1000) / 1000;
    vi.advanceTimersByTime(40);
  }
}

async function esperar(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await Promise.resolve();
  expect(cond()).toBe(true);
}

/** Las fuentes de la cama de archivo: un bucle que no es de la pista. */
const camas = (): FuenteFalsa[] => ctx().fuentes.filter((f) => f.loop && f.__pista === undefined && f.buffer === cama.buffer);
const nodo = (n: unknown): NodoFalso => n as NodoFalso;
/** La cadena de la cama: fuente, filtro, volumen de la cama y bus de osciladores. */
const volumenDeLaCama = (f: FuenteFalsa): ParamFalso => nodo(nodo(f.conectado[0]).conectado[0]).gain as unknown as ParamFalso;
const busDeOsciladores = (f: FuenteFalsa): ParamFalso => nodo(nodo(nodo(f.conectado[0]).conectado[0]).conectado[0]).gain as unknown as ParamFalso;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const archivo = url.slice(BASE.length);
      const cuerpo: unknown = archivo === "race.json" ? PISTA : archivo in PESOS ? new ArrayBuffer(PESOS[archivo] as number) : undefined;
      if (cuerpo === undefined) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => cuerpo, arrayBuffer: async () => cuerpo as ArrayBuffer };
    }),
  );
  stopMusic();
  ctx().currentTime = 0;
  ctx().fuentes.splice(0);
  semilla++;
  cama.buffer = bufferFalso(8);
  // Las cinco secciones se bajan de una vez, pero se decodifican cuando la prueba lo suelta: la pista llega tarde.
  esperando = [];
  ctx().decodificar = (ab) => bufferFalso(DURACION[ab.byteLength] ?? 10);
  const decodificar = ctx().decodificar;
  ctx().decodeAudioData = (ab: ArrayBuffer): Promise<AudioBuffer> => new Promise((ok) => esperando.push(() => ok(decodificar(ab))));
  reiniciarPistas({ modo: "pistas", host: "localhost", busqueda: `?pistasdesde=${encodeURIComponent(BASE)}` });
  sonidoDelJuego("race");
  await esperar(() => estadoDePistas().cargas.race === "decodificando");
});

afterEach(() => {
  stopMusic();
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.stubGlobal("AudioContext", ContextoDeLaPagina);
  reiniciarPistas();
  cama.buffer = null;
});

/** Arranca la música con la pista todavía sin decodificar, y la deja llegar a los 0,4 s. */
async function conLaPistaTarde(): Promise<FuenteFalsa> {
  startMusic(semilla);
  const [f] = camas();
  expect(f).toBeDefined();
  expect(estadoDePistas().suena).toBe(false);
  avanzar(0.4);
  esperando.splice(0).forEach((fn) => fn());
  await esperar(() => estadoDePistas().suena);
  return f as FuenteFalsa;
}

describe("la pista llega en la gracia a un juego con cama de archivo", () => {
  it("la cama se va en el momento en que la pista toma la música", async () => {
    const f = await conLaPistaTarde();
    avanzar(0.5);
    expect(busDeOsciladores(f).en(ctx().currentTime)).toBeCloseTo(0, 6);
    expect(volumenDeLaCama(f).en(ctx().currentTime)).toBeCloseTo(0, 6);
    // Y la fuente de la cama se para sola, sin esperar al final del sorteo.
    avanzar(0.8);
    expect(f.parada).not.toBeNull();
  });

  it("al soltar la retención del juego el bus de osciladores no se vuelve a abrir", async () => {
    const f = await conLaPistaTarde();
    avanzar(0.5);
    musicHold(true);
    avanzar(0.2);
    musicHold(false);
    avanzar(0.2);
    expect(estadoDePistas().suena).toBe(true);
    expect(busDeOsciladores(f).en(ctx().currentTime)).toBe(0);
    expect(volumenDeLaCama(f).en(ctx().currentTime)).toBeCloseTo(0, 6);
  });

  it("en el golpe del ganador tampoco, ni con el silencio de antes puesto", async () => {
    const f = await conLaPistaTarde();
    avanzar(0.5);
    musicBreath();
    avanzar(0.4);
    musicCue(1);
    avanzar(0.2);
    expect(ctx().dePista("golpe")).toHaveLength(1);
    expect(busDeOsciladores(f).en(ctx().currentTime)).toBe(0);
    expect(volumenDeLaCama(f).en(ctx().currentTime)).toBeCloseTo(0, 6);
  });

  it("si la pista no llega, la cama sigue sonando como hoy y el golpe es el de siempre", async () => {
    startMusic(semilla);
    const [f] = camas();
    expect(f).toBeDefined();
    avanzar(2);
    // Pasó la gracia: la pista que llega ahora ya no entra en este sorteo.
    esperando.splice(0).forEach((fn) => fn());
    await esperar(() => estadoDePistas().cargas.race === "lista");
    avanzar(0.5);
    expect(estadoDePistas().suena).toBe(false);
    musicHold(true);
    avanzar(0.2);
    musicHold(false);
    avanzar(0.2);
    expect(busDeOsciladores(f as FuenteFalsa).en(ctx().currentTime)).toBeGreaterThan(0.2);
    musicCue(1);
    expect(ctx().dePista()).toHaveLength(0);
  });
});
