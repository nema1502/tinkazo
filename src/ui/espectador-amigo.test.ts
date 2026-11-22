// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un Amigo secreto no se mira en vivo (`espectador.ts`): el orden que calcularía el celular es el reparto entero. La
 * espera ya no muestra el QR, pero un enlace viejo o armado a mano no abre la vista, no calcula el orden ni juega. Se
 * reconoce por el nombre que trae el enlace y, si el enlace no lo trae, por lo que quedó sellado en Stellar. Sin red: el
 * número, la cadena y el reloj son de mentira.
 */

const h = vi.hoisted(() => ({
  firma: "01".repeat(48),
  fetchRound: vi.fn((..._a: unknown[]): unknown => undefined),
  showALaPar: vi.fn((..._a: unknown[]): unknown => undefined),
  showDelEspectador: vi.fn((..._a: unknown[]): unknown => undefined),
}));

vi.mock("../sound", () => ({ beep: () => undefined, note: (n: number) => n, callarEfectos: () => undefined }));
vi.mock("./vista-grande", () => ({ rechazarGrande: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => "no", soltarPantallaCompleta: () => undefined }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./draw", () => ({
  verDeNuevo: () => undefined,
  showALaPar: (...a: unknown[]) => h.showALaPar(...a),
  showDelEspectador: (...a: unknown[]) => h.showDelEspectador(...a),
}));
vi.mock("./espectador-reloj", () => ({ desfaseDelReloj: async () => 0 }));

import { bytesToHex, roundTime } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { app } from "../state";
import { T, setLang } from "../i18n";
import type { Registro, Sello } from "../protocol/verificacion";
import { abrirEspectador, type DatosEspectador, type OpcionesDeLaVista } from "./espectador";
import { EsAmigoSecreto, NoCoincide, revisarSello, type SorteoDelEnlace } from "./espectador-cadena";
import { contratoOficial, type ContratoOficial } from "../stellar/oficiales";

const NOMBRES = ["Ana", "Beto", "Carla", "Diego", "Eva", "Fabio"];
const CONTRATO_PRUEBA = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const R = 1_000_000;
const NACE = roundTime(R) * 1000;

/** El enlace de la espera de un Amigo secreto: todos salen. Con `z` o sin él, como uno armado a mano. */
const datos = (extra: Partial<DatosEspectador> = {}): DatosEspectador => ({
  r: R, g: "race", p: "normal", w: NOMBRES.length, n: [...NOMBRES], net: "testnet", k: CONTRATO_PRUEBA, i: "42", h: 1, ...extra,
});

/** Lo sellado en Stellar: un Amigo secreto, o un sorteo común con el mismo largo. */
const sello = (meta: string, numWinners = NOMBRES.length): Sello => ({
  id: "42", organizer: "GAAA", listHash: bytesToHex(listHash(NOMBRES)), count: NOMBRES.length, numWinners, round: R, sealedAt: 1, meta, drawn: false,
});
const registro = (meta: string): Registro => ({ wasm: "w", siguiente: 100, sello: sello(meta), resultado: null });

const abrir = (d: DatosEspectador, meta = "Amigo secreto"): boolean => {
  const op: OpcionesDeLaVista = {
    medir: async () => undefined, irA: () => undefined, azar: () => 0, leer: async () => registro(meta), ancla: async () => null, ref: null,
  };
  return abrirEspectador(d, "es", op);
};

const resguardo = (): HTMLElement | null => document.querySelector(".espectador-amigo");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  vi.setSystemTime(NACE - 30_000);
  for (const f of [h.fetchRound, h.showALaPar, h.showDelEspectador]) f.mockReset();
  h.fetchRound.mockResolvedValue({ round: R, signature: h.firma });
  document.body.innerHTML = `<div id="stadium" style="display:none"><button id="st-skip"></button></div>`;
  app.frozen = null;
  app.drawn = null;
});

afterEach(() => {
  vi.useRealTimers();
  setLang("es");
  document.body.innerHTML = "";
});

describe("el celular con el enlace de un Amigo secreto", () => {
  it("con el nombre en el enlace, no abre la vista y lo dice", () => {
    expect(abrir(datos({ z: "Amigo secreto" }))).toBe(false);
    expect(resguardo()?.textContent).toContain("Este amigo secreto no se ve en vivo");
    expect(resguardo()?.textContent).toContain("Cada uno recibe su enlace de quien organiza.");
    expect(resguardo()?.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe("/");
    expect(resguardo()?.textContent).not.toContain("Ana");
  });

  it("con el nombre en el enlace, ni trae el número ni juega ni calcula el orden", async () => {
    abrir(datos({ z: "Secret Santa" }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fetchRound).not.toHaveBeenCalled();
    expect(h.showALaPar).not.toHaveBeenCalled();
    expect(app.drawn).toBeNull();
  });

  it("sin el nombre en el enlace, lo sellado en Stellar lo delata y la vista se cierra", async () => {
    expect(abrir(datos())).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(resguardo()).not.toBeNull();
    expect(document.querySelectorAll(".espectador").length).toBe(1);
    expect(document.querySelector(".espera-nombres")).toBeNull();
  });

  it("sin el nombre en el enlace, tampoco juega ni calcula el orden cuando nace el número", async () => {
    abrir(datos());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.showALaPar).not.toHaveBeenCalled();
    expect(h.showDelEspectador).not.toHaveBeenCalled();
    expect(app.drawn).toBeNull();
  });

  it("el aviso se traduce al cambiar de idioma", () => {
    abrir(datos({ z: "Amigo secreto" }));
    setLang("en");
    expect(resguardo()?.textContent).toContain(T.en.espAmigoT as string);
    expect(resguardo()?.textContent).toContain(T.en.espAmigoB as string);
    expect(resguardo()?.textContent).toContain(T.en.espHacerElTuyo as string);
  });

  it("un sorteo común en que salen todos se sigue mirando", async () => {
    expect(abrir(datos({ z: "Termo" }), "Termo")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(resguardo()).toBeNull();
    expect(document.querySelector(".espera-nombres")).not.toBeNull();
  });
});

describe("la comprobación del sello", () => {
  const s: SorteoDelEnlace = {
    contrato: contratoOficial("testnet", CONTRATO_PRUEBA) as ContratoOficial,
    id: "42",
    listHash: bytesToHex(listHash(NOMBRES)),
    count: NOMBRES.length,
    numWinners: NOMBRES.length,
    round: R,
  };

  it("un sello de Amigo secreto lanza EsAmigoSecreto aunque el enlace no traiga el nombre", () => {
    expect(() => revisarSello(sello("Amigo secreto: Navidad"), s)).toThrow(EsAmigoSecreto);
  });

  it("un sello común no lanza nada", () => {
    expect(() => revisarSello(sello("Termo"), s)).not.toThrow();
  });

  it("un enlace que no coincide sigue diciendo que no coincide", () => {
    expect(() => revisarSello({ ...sello("Amigo secreto"), id: "43" }, s)).toThrow(NoCoincide);
  });
});
