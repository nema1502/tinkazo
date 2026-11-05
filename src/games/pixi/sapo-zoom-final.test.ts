import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cabe, enPantalla } from "./encuadre";
import { sapoEstadoGanador, sapoFinalCloseUp, sapoFinalFrame, type SapoFinalFrame } from "./sapo-zoom-final";

const frame = (overrides: Partial<SapoFinalFrame> = {}): SapoFinalFrame => ({
  table: { x: 180, y: 90, w: 400, h: 230 },
  target: { x: 305, y: 175, w: 40, h: 26 },
  zone: { x0: 4, y0: 190, x1: 840, y1: 286 },
  width: 844, height: 390, portrait: false, portraitLimit: Infinity,
  chip: { x: 380, y: 195, w: 180, h: 40, ax: 0, ay: 0.5 },
  closeUp: false, ...overrides,
});

function expectInside(p: SapoFinalFrame): void {
  const v = sapoFinalFrame(p);
  const b = enPantalla(p.target, v, p.width, p.height);
  expect(b.x).toBeGreaterThanOrEqual(p.zone.x0 - 1e-4);
  expect(b.y).toBeGreaterThanOrEqual(p.zone.y0 - 1e-4);
  expect(b.x + b.w).toBeLessThanOrEqual(p.zone.x1 + 1e-4);
  expect(b.y + b.h).toBeLessThanOrEqual(p.zone.y1 + 1e-4);
}

describe("Sapo final composition", () => {
  it("enables the new composition only after landing in mobile landscape", () => {
    expect(sapoFinalCloseUp(844, 390, false, true)).toBe(true);
    expect(sapoFinalCloseUp(800, 360, false, true)).toBe(true);
    expect(sapoFinalCloseUp(932, 430, false, true)).toBe(true);
    expect(sapoFinalCloseUp(844, 390, false, false)).toBe(false);
    expect(sapoFinalCloseUp(390, 844, true, true)).toBe(false);
    expect(sapoFinalCloseUp(1280, 720, false, true)).toBe(false);
    expect(sapoFinalCloseUp(1024, 520, false, true)).toBe(true);
    expect(sapoFinalCloseUp(1024, 521, false, true)).toBe(false);
  });
  it("preserves the former desktop table and external chip fit", () => {
    const p = frame();
    expect(sapoFinalFrame(p)).toEqual({ x: 495.625, y: 101.97916666666666, z: 96 / 230 });
  });

  it("preserves the portrait limit and ignores the desktop chip", () => {
    const p = frame({ portrait: true, portraitLimit: 0.3 });
    expect(sapoFinalFrame(p)).toEqual({ x: 380, y: 61.66666666666666, z: 0.3 });
  });

  for (const [width, height] of [[844, 390], [800, 360], [932, 430]]) {
    it(`fits the selected painted target rather than the table at ${width}x${height}`, () => {
      const p = frame({ width, height, closeUp: true });
      const v = sapoFinalFrame(p);
      expect(v.z).toBeCloseTo(cabe(p.target, p.zone), 10);
      expect(v.z).toBeGreaterThan(sapoFinalFrame({ ...p, closeUp: false }).z);
      expectInside(p);
    });
  }

  it("allows a geometry-constrained final zoom below the emotional peak", () => {
    const p = frame({ closeUp: true, target: { x: 300, y: 180, w: 80, h: 80 } });
    expect(sapoFinalFrame(p).z).toBe(1.2);
    expectInside(p);
  });

  it("follows the actual selected target when its position changes", () => {
    const p = frame({ closeUp: true });
    const before = sapoFinalFrame(p);
    const moved = sapoFinalFrame({ ...p, target: { ...p.target, x: p.target.x + 47, y: p.target.y - 23 } });
    expect(moved.x).toBeCloseTo(before.x + 47);
    expect(moved.y).toBeCloseTo(before.y - 23);
    expect(moved.z).toBe(before.z);
  });

  it("does not let another table size or external label dictate the close-up", () => {
    const p = frame({ closeUp: true });
    expect(sapoFinalFrame({ ...p, table: { x: -500, y: -500, w: 2000, h: 2000 },
      chip: { x: 1000, y: 1000, w: 600, h: 150, ax: 1, ay: 1 } })).toEqual(sapoFinalFrame(p));
  });
});

describe("Sapo winner state for the clearance auditor", () => {
  it("is inactive before the crown and counts time from the crown, like the wheel", () => {
    expect(sapoEstadoGanador(9.5, 10)).toEqual({ activa: false, tiempo: -0.5, fase: "sapo-final" });
    expect(sapoEstadoGanador(10, 10)).toEqual({ activa: true, tiempo: 0, fase: "sapo-final" });
    const later = sapoEstadoGanador(12.25, 10);
    expect(later.activa).toBe(true);
    expect(later.tiempo).toBeCloseTo(2.25);
  });

  it("is the third argument Sapo gives to ganadorEn, with the game clock and crown time", () => {
    // sapoPixi needs a mounted Pixi stage; the call site is checked in the source instead of a browser.
    const src = readFileSync(new URL("./sapo.ts", import.meta.url), "utf8");
    const call = src.slice(src.indexOf("S.ganadorEn("), src.indexOf("S.ganadorEn(") + 1200);
    expect(call).toMatch(/selectedTargetOnScreen,\s*\(\) => sapoEstadoGanador\(tAll, T_CROWN\)\)/);
  });
});
