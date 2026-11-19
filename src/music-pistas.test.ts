// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferFalso, ContextoFalso, type FuenteFalsa } from "./sonidos/audio-falso";

/**
 * La música de los juegos con las pistas por secciones, por los mismos pedidos de siempre (`startMusic`, `musicCue`,
 * `musicHold`, `musicBreath`, `stopMusic` y `fanfare`), con un contexto de audio de mentira en la página.
 *
 * Las pistas van prendidas por defecto, pero fuera del sitio y sin carpeta de pistas no baja nada y suena la de
 * osciladores. Con la música sintetizada (`?musica=sintetizada` o `VITE_MUSICA=sintetizada`) nada cambia: ni un pedido de
 * red ni una fuente de pista. Con las pistas y la del juego lista, la pista toma la música y la de osciladores no arma
 * nada; si la pista se rompe en medio del show, vuelve la de osciladores.
 */

// Las pruebas ponen sus propias pistas: la lista de verdad no cuenta.
vi.mock("./sonidos/pistas-lista", () => ({ PISTAS: {} }));

class ContextoDeLaPagina extends ContextoFalso {}
vi.stubGlobal("AudioContext", ContextoDeLaPagina);
(window as unknown as { AudioContext: unknown }).AudioContext = ContextoDeLaPagina;

const { audio, fanfare, isMuted, sonidoDelJuego, toggleSound } = await import("./sound");
const { musicBreath, musicCue, musicHold, musicOn, startMusic, stopMusic, toggleMusic } = await import("./music");
const { leerPista } = await import("./sonidos/pistas");
const { estadoDePistas, ponerPistaLista, reiniciarPistas } = await import("./sonidos/pistas-enganche");

const PISTA = leerPista(
  {
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
  },
  "race",
);
const BUFFERS = { entrada: bufferFalso(7.5), cuerpo: bufferFalso(33), subida: bufferFalso(15), golpe: bufferFalso(2.4), festejo: bufferFalso(4) };

const ctx = (): ContextoFalso => audio() as unknown as ContextoFalso;
const osciladores = (): number => ctx().nodos.filter((n) => n.tipo === "oscilador").length;
let red: ReturnType<typeof vi.fn>;
let semilla = 1000;

/** Corre el reloj del audio y el de la página juntos, de a 40 ms (lo que tarda el programador de la música en volver). */
function avanzar(segundos: number): void {
  for (let i = 0; i < Math.round(segundos / 0.04); i++) {
    ctx().currentTime = Math.round((ctx().currentTime + 0.04) * 1000) / 1000;
    vi.advanceTimersByTime(40);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  red = vi.fn(async () => ({ ok: false, status: 404 }));
  vi.stubGlobal("fetch", red);
  // Cada prueba arranca un sorteo nuevo (otra semilla), con el reloj del audio en cero.
  stopMusic();
  ctx().currentTime = 0;
  ctx().fuentes.splice(0);
  semilla++;
});

afterEach(() => {
  stopMusic();
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
  reiniciarPistas();
});

/** Un sorteo entero por los pedidos de siempre: tiene que sonar con osciladores, sin un pedido de red ni una fuente de pista. */
function sorteoConOsciladores(): void {
  sonidoDelJuego("race");
  startMusic(semilla);
  const antes = osciladores();
  avanzar(2);
  expect(osciladores()).toBeGreaterThan(antes);
  musicCue(0.9);
  musicHold(true);
  musicHold(false);
  musicBreath();
  const antesDelRemate = osciladores();
  musicCue(1);
  fanfare();
  vi.advanceTimersByTime(2000);
  expect(osciladores()).toBeGreaterThan(antesDelRemate);
  stopMusic();
  expect(red).not.toHaveBeenCalled();
  expect(ctx().dePista()).toHaveLength(0);
}

describe("por defecto, en la máquina de quien prueba y sin carpeta de pistas", () => {
  it("las pistas van prendidas, pero no baja nada y suena la de osciladores", () => {
    sessionStorage.clear();
    // La configuración que arma la pestaña sola: esta página es localhost, sin parámetros ni bandera.
    reiniciarPistas();
    expect(estadoDePistas().modo).toBe("pistas");
    sorteoConOsciladores();
  });
});

describe("con la música sintetizada (?musica=sintetizada o VITE_MUSICA=sintetizada)", () => {
  it("todos los pedidos suenan con osciladores, sin un pedido de red ni una fuente de pista", () => {
    reiniciarPistas({ modo: "sintetizada", host: "tinkazo.app" });
    expect(estadoDePistas().modo).toBe("sintetizada");
    sorteoConOsciladores();
  });
});

describe("con las pistas y la del juego lista", () => {
  beforeEach(() => {
    reiniciarPistas({ modo: "pistas", host: "localhost", busqueda: "?pistasdesde=http://127.0.0.1:8796/" });
    if (!PISTA) throw new Error("la pista de prueba no se leyó");
    ponerPistaLista("race", PISTA, BUFFERS);
    sonidoDelJuego("race");
  });

  it("la pista toma la música y la de osciladores no arma ni una nota", () => {
    startMusic(semilla);
    expect(ctx().dePista("entrada")).toHaveLength(1);
    const antes = osciladores();
    avanzar(3);
    expect(osciladores()).toBe(antes);
    expect(red).not.toHaveBeenCalled();
  });

  it("la tensión trae la subida, el corte la retiene, y el ganador es un solo final: el de la pista", () => {
    startMusic(semilla);
    ctx().currentTime = 12;
    musicCue(0.9);
    expect(ctx().dePista("subida")).toHaveLength(1);
    ctx().currentTime = 20;
    musicHold(true);
    ctx().currentTime = 21;
    musicHold(false);
    expect(ctx().dePista("subida")).toHaveLength(2);
    ctx().currentTime = 29.6;
    musicBreath();
    ctx().currentTime = 30;
    const antes = osciladores();
    musicCue(1);
    fanfare();
    avanzar(2);
    expect(ctx().dePista("golpe")).toHaveLength(1);
    expect(ctx().dePista("festejo")).toHaveLength(1);
    // Ni el remate de osciladores ni la fanfarria suenan encima.
    expect(osciladores()).toBe(antes);
  });

  it("la fanfarria que llega antes que el relator también da el golpe, una sola vez", () => {
    startMusic(semilla);
    ctx().currentTime = 30;
    fanfare();
    musicCue(1);
    expect(ctx().dePista("golpe")).toHaveLength(1);
  });

  it("al parar en el festejo, el festejo sigue y se apaga solo", () => {
    startMusic(semilla);
    ctx().currentTime = 30;
    musicCue(1);
    ctx().currentTime = 33;
    stopMusic();
    const festejo = ctx().dePista("festejo")[0];
    expect(festejo && ctx().nivel(festejo, 33.5)).toBeGreaterThan(0.3);
    expect(festejo && ctx().nivel(festejo, 34.5)).toBe(0);
  });

  it("si la pista se rompe en medio del show, vuelve la de osciladores", () => {
    startMusic(semilla);
    ctx().currentTime = 12;
    const original = ctx().createBufferSource.bind(ctx());
    ctx().createBufferSource = (): AudioBufferSourceNode => {
      throw new Error("sin audio");
    };
    musicCue(0.9);
    ctx().createBufferSource = original;
    expect(estadoDePistas().suena).toBe(false);
    const antes = osciladores();
    avanzar(2);
    expect(osciladores()).toBeGreaterThan(antes);
  });

  it("la chovena no la usa: sus bailarines pisan en el tiempo de la de osciladores", () => {
    startMusic(semilla, "chovena");
    expect(ctx().dePista()).toHaveLength(0);
  });

  describe("la cola del festejo, cuando el show ya terminó", () => {
    afterEach(() => {
      // Que una prueba que falla a mitad de camino no deje el sonido o la música apagados para las demás.
      if (isMuted()) toggleSound();
      if (!musicOn()) toggleMusic();
    });

    /** Un sorteo que termina con el festejo sonando debajo del cartel, a los 33,2 s del reloj del audio. */
    function conFestejoSonando(): FuenteFalsa {
      startMusic(semilla);
      ctx().currentTime = 30;
      musicCue(1);
      ctx().currentTime = 33;
      stopMusic();
      const festejo = ctx().dePista("festejo")[0];
      if (!festejo) throw new Error("el festejo no sonó");
      ctx().currentTime = 33.2;
      expect(ctx().nivelFinal(festejo, 33.2)).toBeGreaterThan(0.2);
      return festejo;
    }

    it("sin tocar nada sigue sonando y se apaga con su salida", () => {
      const festejo = conFestejoSonando();
      expect(ctx().nivelFinal(festejo, 33.5)).toBeGreaterThan(0.2);
      expect(ctx().nivelFinal(festejo, 34.5)).toBe(0);
    });

    it("el botón de sonido la calla en 0,1 s", () => {
      const festejo = conFestejoSonando();
      toggleSound();
      expect(ctx().nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
    });

    it("el botón de música la calla en 0,1 s", () => {
      const festejo = conFestejoSonando();
      toggleMusic();
      expect(ctx().nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
    });

    it("el sorteo siguiente de un juego sin pista no empieza encima de la cola", () => {
      const festejo = conFestejoSonando();
      sonidoDelJuego("sapo");
      startMusic(semilla + 1);
      expect(ctx().nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
    });

    it("el sorteo siguiente con pista tampoco", () => {
      const festejo = conFestejoSonando();
      startMusic(semilla + 1);
      expect(ctx().nivelFinal(festejo, 33.3)).toBeCloseTo(0, 6);
      expect(ctx().dePista("entrada")).toHaveLength(2);
    });
  });
});
