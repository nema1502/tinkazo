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
