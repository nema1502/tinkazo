// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El celular de quien mira, a la par de la sala (`espectador.ts`, el enlace con `h: 1`): abre su tarjeta a su hora, trae
 * el número con el pedido que espera su nacimiento y juega a la hora que da esa llegada, 1,2 s después que la sala. Su
 * final queda retenido hasta ver lo grabado con los mismos ganadores; si no coincide, cierra el show sin soltarlo. Relee
 * su enlace por si la sala cambió el juego. Quien llega tarde se pone al día; sin show, Lo que salió espera lo grabado y
 * el final del juego. Sin red: el número, la cadena, el enlace y el reloj son de mentira.
 */

const h = vi.hoisted(() => ({
  firma: "01".repeat(48),
  fetchRound: vi.fn((..._a: unknown[]): any => undefined),
  verifyRoundAsync: vi.fn(async (..._a: unknown[]) => true),
  showALaPar: vi.fn((..._a: unknown[]): any => undefined),
  showDelEspectador: vi.fn((..._a: unknown[]): any => undefined),
  jugar: vi.fn((..._a: unknown[]): any => undefined),
  cancelar: vi.fn(),
  actualizar: vi.fn(),
  soltar: vi.fn(),
  virtual: null as number | null,
}));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n, callarEfectos: () => undefined }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => "no", soltarPantallaCompleta: () => undefined }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: (...a: unknown[]) => h.verifyRoundAsync(...a) }));
vi.mock("./draw", () => ({
  verDeNuevo: () => undefined,
  showALaPar: (...a: unknown[]) => h.showALaPar(...a),
  showDelEspectador: (...a: unknown[]) => h.showDelEspectador(...a),
}));
vi.mock("../games/en-hora", async (orig) => ({
  ...(await orig<typeof import("../games/en-hora")>()),
  soltarElFinal: () => h.soltar(),
}));
vi.mock("../reloj-de-la-ronda", async (orig) => ({
  ...(await orig<typeof import("../reloj-de-la-ronda")>()),
  anclaVirtual: () => h.virtual,
}));
vi.mock("./espectador-reloj", () => ({ desfaseDelReloj: async () => 0 }));

import { bytesToHex, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { select } from "../protocol/select";
import { app, paceSeconds } from "../state";
import { t } from "../i18n";
import { ponerEtiquetas } from "../equipos/etiquetas";
import type { Registro } from "../protocol/verificacion";
import { abrirEspectador, enlaceEspectador, type DatosEspectador, type OpcionesDeLaVista } from "./espectador";
import { LARGA_IGUAL_TRAS_MS, horaDeLaTarjeta, juegoDelCelular, segundosDelJuego } from "./espectador-regla";
import { juegoTrasLaLlegada } from "../arranque-del-show";

const NOMBRES = ["Ana", "Beto", "Cami", "Dani", "Eva", "Fito"];
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const R = 1_000_000;
const NACE = roundTime(R) * 1000;
const datos = (extra: Partial<DatosEspectador> = {}): DatosEspectador => ({ r: R, g: "race", p: "normal", w: 1, z: "Una polera", n: [...NOMBRES], net: "testnet", k: CONTRATO_PRUEBA, i: "42", h: 1, ...extra });
const semilla = (): string => bytesToHex(randomnessOf(h.firma));
const ganadores = (): number[] => select(hexToBytes(semilla()), listHash(NOMBRES), NOMBRES.length, 1);

function registro(o: { grabado?: boolean; winners?: number[] } = {}): Registro {
  return {
    wasm: "w",
    siguiente: 100,
    sello: { id: "42", organizer: "GAAA", listHash: bytesToHex(listHash(NOMBRES)), count: NOMBRES.length, numWinners: 1, round: R, sealedAt: 1, meta: "Una polera", drawn: !!o.grabado },
    resultado: o.grabado ? { raffleId: "42", round: R, signature: h.firma, randomness: semilla(), winners: o.winners ?? ganadores(), drawnAt: 2 } : null,
  };
}

/** La cadena de mentira: sellado hasta `grabadoDesde` (ms del reloj), grabado después, con `winners` si se pide otros. */
const cadena = (grabadoDesde: number, winners?: number[]) => async (): Promise<Registro> => registro(Date.now() >= grabadoDesde ? { grabado: true, ...(winners ? { winners } : {}) } : {});

/** La llegada del número, en el reloj monótono de prueba: la hora de verdad de la ronda más un poco. */
const anclaA = (masMs = 100): OpcionesDeLaVista["ancla"] => async () => {
  const falta = NACE + masMs - Date.now();
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  return { llegada: performance.now(), retenido: true, idaYVuelta: 80, firma: h.firma };
};

let resultado: Promise<{ terminaEn: number } | undefined> | null = null;
let conTarjeta: boolean | undefined;
let jugado: { horario: { inicio: number; retener?: boolean; alcanzar?: boolean }; avisos: Record<string, (...a: unknown[]) => void> } | null = null;
let alTerminar: ((conShow: boolean) => void) | null = null;

const abrir = (d: DatosEspectador, op: OpcionesDeLaVista = {}): boolean =>
  abrirEspectador(d, "es", { medir: async () => undefined, irA: () => undefined, azar: () => 0, leer: cadena(NACE + 14_000), ancla: anclaA(), ref: null, ...op });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  vi.setSystemTime(NACE - 30_000);
  for (const f of [h.fetchRound, h.showALaPar, h.showDelEspectador, h.jugar, h.cancelar, h.actualizar, h.soltar]) f.mockReset();
  h.verifyRoundAsync.mockReset().mockResolvedValue(true);
  h.fetchRound.mockResolvedValue({ round: R, signature: h.firma });
  h.virtual = null;
  resultado = null;
  conTarjeta = undefined;
  jugado = null;
  alTerminar = null;
  h.showALaPar.mockImplementation((...args: unknown[]) => {
    const o = args[0] as { resultado: Promise<{ terminaEn: number } | undefined>; conTarjeta?: boolean };
    resultado = o.resultado;
    conTarjeta = o.conTarjeta;
    return {
      actualizar: h.actualizar,
      cancelar: h.cancelar,
      jugar: (conHora: typeof jugado, fin: (conShow: boolean) => void) => {
        jugado = conHora;
        alTerminar = fin;
        h.jugar(conHora);
      },
    };
  });
  document.body.innerHTML = `<div id="stadium" style="display:none"><button id="st-skip"></button></div>`;
  app.frozen = null;
  app.drawn = null;
  app.game = "race";
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const capa = (): HTMLElement => document.querySelector(".espectador") as HTMLElement;
const telon = (): HTMLElement | null => document.querySelector(".espectador-telon");

describe("el celular a la par de la sala", () => {
  it("abre su tarjeta a su hora, 1,2 s después que la de la sala, y no antes", async () => {
    abrir(datos());
    const tarjeta = horaDeLaTarjeta(R, true) * 1000;
    expect(Math.abs(tarjeta - (NACE - 2_000 + 1_200))).toBeLessThan(1);
    await vi.advanceTimersByTimeAsync(tarjeta - Date.now() - 300);
    expect(h.showALaPar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(h.showALaPar).toHaveBeenCalledTimes(1);
  });

  it("su juego va a la hora que da la llegada de su número: 5,6 s después, con el final retenido y poniéndose al día", async () => {
    abrir(datos());
    await vi.advanceTimersByTimeAsync(NACE + 500 - Date.now());
    const llegada = performance.now() - 400;
    expect(await resultado).toEqual({ terminaEn: llegada + 5_600 });
    expect(juegoTrasLaLlegada(true, true)).toBe(5.6);
    expect(jugado?.horario).toEqual({ inicio: llegada + 5_600, retener: true, alcanzar: true });
    // El número es el del ancla: no se pidió otra vez. Los ganadores, calculados con el protocolo.
    expect(h.fetchRound).not.toHaveBeenCalled();
    expect(app.drawn?.winners).toEqual(ganadores());
  });

  it("retiene el final hasta ver lo grabado con los mismos ganadores, y entonces lo suelta", async () => {
    abrir(datos(), { leer: cadena(NACE + 15_000) });
    await vi.advanceTimersByTimeAsync(NACE + 14_000 - Date.now());
    expect(h.soltar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.soltar).toHaveBeenCalledTimes(1);
  });

  it("si la cadena no contesta, no suelta el final aunque pase el tope: lo dice y sigue mirando hasta verlo grabado", async () => {
    // La sala cerró la espera y todavía no lanzó, o lanza mucho después, y el RPC no le contesta a este celular. Soltar el
    // final ahí sería coronar con una sala que todavía no mostró nada.
    let contesta = false;
    abrir(datos(), {
      leer: async () => {
        if (!contesta) throw new Error("rpc caído");
        return registro({ grabado: true });
      },
    });
    await vi.advanceTimersByTimeAsync(NACE + 20_000 - Date.now());
    jugado?.avisos.alRetener?.();
    await vi.advanceTimersByTimeAsync(LARGA_IGUAL_TRAS_MS + 60_000);
    expect(h.soltar).not.toHaveBeenCalled();
    expect(telon()?.textContent).toContain(t("espSinConfirmar"));
    contesta = true;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(h.soltar).toHaveBeenCalledTimes(1);
  });

  it("si lo grabado no coincide, cierra el show sin soltar su final y lo dice", async () => {
    const otros = [(ganadores()[0] ?? 0) === 0 ? 1 : 0];
    abrir(datos(), { leer: cadena(NACE + 10_000, otros) });
    await vi.advanceTimersByTimeAsync(20_000 + 30_000);
    expect(h.cancelar).toHaveBeenCalled();
    expect(h.soltar).not.toHaveBeenCalled();
    expect(capa().textContent).toContain(t("espNoCoincide"));
    // Lo que diga el estadio al cerrarse ya no es de este intento: no sale Lo que salió.
    alTerminar?.(true);
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
  });

  it("mientras retiene, tapa el estadio con la línea de espera; al soltar, la saca", async () => {
    abrir(datos(), { leer: cadena(NACE + 60_000) });
    await vi.advanceTimersByTimeAsync(NACE + 2_000 - Date.now());
    jugado?.avisos.alRetener?.();
    expect(telon()?.textContent).toContain(t("espEsperaLaSala"));
    jugado?.avisos.alSoltar?.();
    expect(telon()).toBeNull();
    // Ponerse al día también lo tapa, para que no se vean los segundos que se saltan.
    jugado?.avisos.alPonerseAlDia?.(true);
    expect(telon()?.textContent).toContain(t("espPonerAlDia"));
    jugado?.avisos.alPonerseAlDia?.(false);
    expect(telon()).toBeNull();
  });

  it("al terminar su show, Lo que salió, con los ganadores calculados", async () => {
    abrir(datos());
    await vi.advanceTimersByTimeAsync(NACE + 20_000 - Date.now());
    alTerminar?.(true);
    expect(capa().querySelectorAll(".espectador-ganadores li")).toHaveLength(1);
    expect(capa().querySelector(".espectador-ganadores")?.textContent).toContain(NOMBRES[ganadores()[0] ?? 0]);
  });
});

describe("sin show en el celular (menos movimiento, sin el motor nuevo)", () => {
  it("Lo que salió espera lo grabado y el final del juego, y mientras tanto dice que se mire la sala", async () => {
    abrir(datos(), { leer: cadena(NACE + 15_000) });
    await vi.advanceTimersByTimeAsync(NACE + 1_000 - Date.now());
    const inicio = jugado?.horario.inicio ?? 0;
    alTerminar?.(false);
    expect(capa().textContent).toContain(t("espMiraLaSala"));
    const fin = inicio + segundosDelJuego(paceSeconds("normal"), true) * 1000 + 1_000;
    await vi.advanceTimersByTimeAsync(fin - performance.now() - 200);
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(capa().querySelector(".espectador-ganadores")).not.toBeNull();
  });

  it("con la sala tardía, lo grabado llega después del final programado y manda", async () => {
    abrir(datos(), { leer: cadena(NACE + 90_000) });
    await vi.advanceTimersByTimeAsync(NACE + 1_000 - Date.now());
    alTerminar?.(false);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(capa().querySelector(".espectador-ganadores")).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(capa().querySelector(".espectador-ganadores")).not.toBeNull();
  });
});

describe("el juego que la sala cambió con el QR a la vista", () => {
  const ref = { id: "AbCd1234", clave: "k".repeat(22), n: 1 };
  const ruta = (d: DatosEspectador): string => new URL(enlaceEspectador(d, "https://tinkazo.app")).pathname + new URL(enlaceEspectador(d, "https://tinkazo.app")).hash;

  it("relee su enlace antes de la tarjeta y juega el juego nuevo", async () => {
    const releer = vi.fn(async () => ({ ruta: ruta(datos({ g: "sapo" })), n: 2, version: '"2"', cambia: true }));
    abrir(datos(), { ref, releer });
    await vi.advanceTimersByTimeAsync(NACE - 11_000 - Date.now());
    expect(releer).toHaveBeenCalledTimes(1);
    expect(app.game).toBe("sapo");
    await vi.advanceTimersByTimeAsync(NACE + 1_000 - Date.now());
    expect(releer).toHaveBeenCalledTimes(2);
    expect(h.showALaPar).toHaveBeenCalledTimes(1);
  });

  it("si el contenido nuevo es de otro sorteo (otra lista), lo ignora", async () => {
    const releer = vi.fn(async () => ({ ruta: ruta(datos({ g: "sapo", n: [...NOMBRES, "Gaby"] })), n: 2, version: '"2"', cambia: true }));
    abrir(datos(), { ref, releer });
    await vi.advanceTimersByTimeAsync(NACE - 1_000 - Date.now());
    expect(app.game).toBe("race");
  });

  it("nunca vuelve a un contenido más viejo que el que tiene", async () => {
    const releer = vi.fn(async () => ({ ruta: ruta(datos({ g: "sapo" })), n: 0, version: '"1"', cambia: true }));
    abrir(datos(), { ref: { ...ref, n: 3 }, releer });
    await vi.advanceTimersByTimeAsync(NACE - 1_000 - Date.now());
    expect(app.game).toBe("race");
  });

  it("si la lectura vuelve con la tarjeta ya abierta, la tarjeta pasa a anunciar el juego nuevo", async () => {
    // La segunda lectura sale 1,1 s antes del número y tarda: vuelve con la tarjeta del celular ya abierta.
    const releer = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 800));
      return { ruta: ruta(datos({ g: "trompo" })), n: 2, version: '"2"', cambia: true };
    });
    vi.setSystemTime(NACE - 2_000);
    abrir(datos(), { ref, releer, azar: () => 0.99 });
    // La tarjeta abre a los 1,2 s (0,8 s antes del número); la lectura salió a los 0,9 s y vuelve a los 1,7 s.
    await vi.advanceTimersByTimeAsync(1_300);
    expect(h.showALaPar).toHaveBeenCalled();
    expect(app.game).toBe("race");
    await vi.advanceTimersByTimeAsync(600);
    expect(app.game).toBe("trompo");
    expect(h.actualizar).toHaveBeenCalled();
  });

  it("si el enlace releído trae nombres de personas, lo que se comparte desde este celular no los lleva", async () => {
    const gana = NOMBRES[ganadores()[0] ?? 0] ?? "";
    // El enlace de la sala no traía etiquetas; el releído las trae, marcadas como de personas.
    const nuevo = datos({ g: "sapo", e: [[gana, "Nombre Privado"]], q: 1 });
    const releer = vi.fn(async () => ({ ruta: ruta(nuevo), n: 2, version: '"2"', cambia: true }));
    const abrirSorteo = vi.fn();
    abrir(datos(), { ref, releer, cargarCompartir: async () => ({ abrirSorteo }) as unknown as typeof import("./compartir") });
    await vi.advanceTimersByTimeAsync(NACE + 20_000 - Date.now());
    expect(app.game).toBe("sapo");
    alTerminar?.(true);
    capa().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    await vi.waitFor(() => expect(abrirSorteo).toHaveBeenCalled());
    const compartido = (abrirSorteo.mock.calls[0]?.[0] as { ganadores: string[] }).ganadores.join("|");
    expect(compartido).not.toContain("Nombre Privado");
    ponerEtiquetas(new Map());
  });
});

describe("quien llega tarde", () => {
  it("con el show empezado: sin tarjeta, con la hora de su ancla virtual, y se pone al día", async () => {
    vi.setSystemTime(NACE + 20_000);
    // El piso de la medida del reloj: la ronda nació hace 20 s.
    h.virtual = performance.now() - 20_000 + 100;
    abrir(datos(), { ancla: async () => ({ llegada: performance.now(), retenido: false, idaYVuelta: 80, firma: h.firma }) });
    await vi.advanceTimersByTimeAsync(300);
    expect(conTarjeta).toBe(false);
    expect(jugado?.horario.inicio).toBeCloseTo((h.virtual ?? 0) + 5_600, 3);
    expect(jugado?.horario.alcanzar).toBe(true);
    expect(juegoDelCelular(h.virtual ?? 0, true)).toBe(jugado?.horario.inicio);
  });
});

describe("una sala con el sitio de antes (el enlace sin h)", () => {
  it("sigue el camino de antes: espera lo grabado", async () => {
    h.showDelEspectador.mockImplementation(() => ({ jugar: h.jugar, cancelar: h.cancelar }));
    const { h: _sinH, ...antes } = datos();
    abrir(antes);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(h.showALaPar).not.toHaveBeenCalled();
    expect(h.showDelEspectador).toHaveBeenCalled();
  });
});
