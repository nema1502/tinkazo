// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * La línea bajo el reloj de la página (`freeze.ts`, `claveDeLaLinea`). En un sorteo de premios dice que nadie elige quién
 * gana. Un orden de turnos y un Amigo secreto no tienen quién gane: dicen que nadie elige el número, lo mismo que la
 * espera en grande en esos modos. Sin sello, los tres dicen que no se puede comprobar. Con el reloj de la prueba y sin red.
 */

vi.mock("../protocol/quicknet", async (orig) => {
  const o = await orig<typeof import("../protocol/quicknet")>();
  // Nadie sale a la red: la ronda que se pida, todavía no nació.
  return { ...o, fetchRound: async () => Promise.reject(new Error("sin red en la prueba")) };
});
vi.mock("../protocol/firma", () => ({ prepararFirma: () => undefined, verifyRoundAsync: async () => true }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined, puede3D: () => false, usa3D: () => false }));
vi.mock("../contar", () => ({
  contar: () => undefined,
  contarUnaVez: () => undefined,
  contarPractica: () => undefined,
  errorContable: (c: string) => c,
  origenActual: () => "",
  refDe: () => ({}),
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));

const NOMBRES = ["Ana", "Beto", "Caro"];

/** Retoma una lista sellada con la ronda a cinco segundos, por el mismo camino que un sorteo de Mis sorteos. */
const sellar = async (prize: string, numWinners: number, sinSello = false): Promise<void> => {
  const freeze = await import("./freeze");
  const { targetRound } = await import("../protocol/quicknet");
  const { listHash } = await import("../protocol/canonical");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  const ahora = Math.floor(Date.now() / 1000);
  const sello = { names: NOMBRES, listHash: bytesToHex(listHash(NOMBRES)), sealedAt: ahora, prize, round: targetRound(ahora, 5), numWinners };
  freeze.resumeFrozen(sinSello ? { ...sello, sinSello: true } : sello);
};

const linea = (): HTMLElement | null => document.querySelector<HTMLElement>("#wait-box .wait-line");

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-21T20:00:00Z") });
  history.replaceState(null, "", "/?lang=es");
  const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  Element.prototype.scrollIntoView = () => undefined;
  const nada = (): undefined => undefined;
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: nada,
    removeEventListener: nada,
    addListener: nada,
    removeListener: nada,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

describe("la línea bajo el reloj de la página", () => {
  it("en un sorteo de premios dice que nadie elige quién gana", async () => {
    await sellar("Una pizza", 1);
    expect(linea()?.textContent).toBe(T.es.waitLine);
    expect(linea()?.dataset.i).toBe("waitLine");
  });

  it("en un orden de turnos no habla de ganar: dice que nadie elige el número", async () => {
    await sellar("Turnos para exponer", NOMBRES.length);
    expect(linea()?.textContent).toBe(T.es.espNadieSinGanador);
    expect(linea()?.dataset.i).toBe("espNadieSinGanador");
    // También con el reloj andando: cada segundo vuelve a escribir la misma.
    await vi.advanceTimersByTimeAsync(1000);
    expect(linea()?.textContent).toBe(T.es.espNadieSinGanador);
  });

  it("en un Amigo secreto no habla de ganar: dice que nadie elige el número", async () => {
    await sellar("Amigo secreto", NOMBRES.length);
    expect(linea()?.textContent).toBe(T.es.espNadieSinGanador);
    expect(linea()?.dataset.i).toBe("espNadieSinGanador");
  });

  it("en un orden de turnos sin sello manda el sello: dice que no se puede comprobar", async () => {
    await sellar("Turnos para exponer", NOMBRES.length, true);
    expect(linea()?.textContent).toBe(T.es.waitLineSinSello);
    expect(linea()?.dataset.i).toBe("waitLineSinSello");
  });
});
