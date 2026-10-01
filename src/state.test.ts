import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `state.ts` lee `location.search` al cargarse, y vitest corre en Node. */
async function load(search = "") {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  return import("./state");
}

const media = (reduce: boolean) => vi.fn((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion") }));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("motionReduced", () => {
  it("es true cuando el sistema pide menos movimiento", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.motionReduced()).toBe(true);
  });

  it("es false cuando no lo pide", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(false));
    expect(s.motionReduced()).toBe(false);
  });

  it("es false si matchMedia no existe", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", undefined);
    expect(s.motionReduced()).toBe(false);
  });
});

describe("skipMotion", () => {
  it("anima si nada lo impide", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(false));
    expect(s.skipMotion()).toBe(false);
  });

  it("salta con movimiento reducido", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.skipMotion()).toBe(true);
  });

  it("forzar el movimiento anula la preferencia del sistema", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    s.forceMotion(true);
    expect(s.skipMotion()).toBe(false);
    s.forceMotion(false);
    expect(s.skipMotion()).toBe(true);
  });

  it("?instant=1 salta siempre, aunque se fuerce el movimiento", async () => {
    const s = await load("?instant=1");
    vi.stubGlobal("matchMedia", media(false));
    s.forceMotion(true);
    expect(s.skipMotion()).toBe(true);
  });

  it("reducedSkip avisa solo cuando el motivo es la preferencia del sistema", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.skippedForReducedMotion()).toBe(true);
    s.forceMotion(true);
    expect(s.skippedForReducedMotion()).toBe(false);
    const i = await load("?instant=1");
    vi.stubGlobal("matchMedia", media(true));
    expect(i.skippedForReducedMotion()).toBe(false);
  });
});

describe("playableGame", () => {
  it("keeps the existing caps working", async () => {
    const s = await load();
    expect(s.playableGame("wheel", 24)).toBe("wheel");
    expect(s.playableGame("wheel", 25)).toBe("race");
    expect(s.playableGame("plinko", 12)).toBe("plinko");
    expect(s.playableGame("plinko", 13)).toBe("race");
    expect(s.playableGame("sapo", 12)).toBe("sapo");
    expect(s.playableGame("sapo", 13)).toBe("race");
    expect(s.playableGame("race", 500)).toBe("race");
    expect(s.playableGame("teleferico", 500)).toBe("teleferico");
  });

  it("ahorcado falls back to the race over the cap, even without names", async () => {
    const s = await load();
    expect(s.HANGMAN_MAX).toBe(12);
    expect(s.playableGame("ahorcado", 12)).toBe("ahorcado");
    expect(s.playableGame("ahorcado", 13)).toBe("race");
  });

  it("ahorcado falls back when a name cannot be played, and stays when all can", async () => {
    const s = await load();
    expect(s.playableGame("ahorcado", 3, ["Ana", "Luis", "José"], [1])).toBe("ahorcado");
    expect(s.playableGame("ahorcado", 3, ["Ana", "X", "José"], [0])).toBe("race");
    expect(s.playableGame("ahorcado", 3, ["Ana", "😀", "José"], [0])).toBe("race");
    expect(s.playableGame("ahorcado", 2, ["Ana", "a".repeat(19)], [0])).toBe("race");
    expect(s.playableGame("ahorcado", 3, ["Ana", "Luis", "José"], [7])).toBe("race");
    // names are only consulted for ahorcado
    expect(s.playableGame("sapo", 3, ["Ana", "X", "José"], [0])).toBe("sapo");
  });
});
