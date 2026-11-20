// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El rótulo de la caja de la espera en la página (`freeze.ts`, `startCountdown`): Empieza en se ve mientras falta para
 * el número, se esconde cuando el número ya salió (el reloj pasa a Ya se puede sortear: ahí ya no hay nada que empiece,
 * cualquiera podría calcular quién gana) y vuelve solo con la lista siguiente. Con el reloj de la prueba y sin red.
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

/** Sella una lista con la ronda a cinco segundos, por el mismo camino que retoma un sorteo de Mis sorteos. */
const sellar = async (nombres: string[]): Promise<void> => {
  const freeze = await import("./freeze");
  const { targetRound } = await import("../protocol/quicknet");
  const { listHash } = await import("../protocol/canonical");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  const ahora = Math.floor(Date.now() / 1000);
  const ronda = targetRound(ahora, 5);
  const sello = { names: nombres, listHash: bytesToHex(listHash(nombres)), sealedAt: ahora, prize: "Una pizza", round: ronda, numWinners: 1 };
  freeze.resumeFrozen(sello);
};

const rotulo = (): HTMLElement | null => document.querySelector<HTMLElement>('#wait-box [data-i="waitTitle"]');
const reloj = (): string => document.getElementById("wait-left")?.textContent ?? "";

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

describe("Empieza en, sobre el reloj de la página", () => {
  it("se ve mientras falta y se esconde cuando el reloj pasa a Ya se puede sortear", async () => {
    await sellar(["Ana", "Beto", "Caro"]);
    expect(rotulo()?.textContent).toBe(T.es.waitTitle);
    expect(rotulo()?.hidden).toBe(false);
    expect(reloj()).toMatch(/^\d+:\d\d$/);
    // Toda la espera con el reloj de la prueba, hasta que nace la ronda elegida.
    await vi.advanceTimersByTimeAsync(10000);
    expect(reloj()).toBe(T.es.waitNow);
    expect(rotulo()?.hidden).toBe(true);
  });

  it("vuelve solo al sellar otra lista", async () => {
    await sellar(["Ana", "Beto", "Caro"]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(rotulo()?.hidden).toBe(true);
    await sellar(["Dora", "Eva"]);
    expect(reloj()).toMatch(/^\d+:\d\d$/);
    expect(rotulo()?.hidden).toBe(false);
  });
});
