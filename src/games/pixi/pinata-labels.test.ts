import { describe, expect, it } from "vitest";
import { MAX_LABEL_ITEMS, capRecent, juntar, layoutLabels, listaCaidos, type LabelItem } from "./pinata-labels";

const B = { w: 390, h: 844, top: 100, bottom: 118 };
const item = (id: number, x: number, y: number, priority = 0, w = 100, h = 30): LabelItem => ({ id, x, y, w, h, priority });

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function rects(items: LabelItem[], out: { id: number; x: number; y: number }[]): { id: number; x: number; y: number; w: number; h: number }[] {
  return out.map((o) => {
    const it = items.find((i) => i.id === o.id) as LabelItem;
    return { id: o.id, x: o.x, y: o.y, w: it.w, h: it.h };
  });
}

function assertSane(items: LabelItem[], out: { id: number; x: number; y: number }[]): void {
  const rs = rects(items, out);
  for (const r of rs) {
    expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(B.w + 1e-9);
    expect(r.y).toBeGreaterThanOrEqual(B.top);
    expect(r.y + r.h).toBeLessThanOrEqual(B.h - B.bottom + 1e-9);
  }
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false);
}

describe("layoutLabels", () => {
  it("keeps the anchor of a single label", () => {
    const out = layoutLabels([item(1, 50, 200)], B);
    expect(out).toEqual([{ id: 1, x: 50, y: 200 }]);
  });

  it("clamps a single label that is off screen", () => {
    const its = [item(1, 380, 10), item(2, -40, 900)];
    const out = layoutLabels([its[0]!], B);
    expect(out[0]).toEqual({ id: 1, x: 290, y: 100 });
    const out2 = layoutLabels([its[1]!], B);
    expect(out2[0]).toEqual({ id: 2, x: 0, y: B.h - B.bottom - 30 });
  });

  it("separates labels that share the same anchor", () => {
    const its = [item(1, 100, 300), item(2, 100, 300), item(3, 110, 310)];
    const out = layoutLabels(its, B);
    expect(out).toHaveLength(3);
    assertSane(its, out);
  });

  it("is deterministic", () => {
    const its = Array.from({ length: 12 }, (_, i) => item(i, 150 + (i % 3) * 5, 300 + (i % 4) * 3, i % 5));
    expect(layoutLabels(its, B)).toEqual(layoutLabels(its.map((x) => ({ ...x })), B));
  });

  it("lets the higher priority keep its anchor", () => {
    const its = [item(1, 100, 300, 1), item(2, 100, 300, 9)];
    const out = layoutLabels(its, B);
    expect(out.find((o) => o.id === 2)).toEqual({ id: 2, x: 100, y: 300 });
    expect(out.find((o) => o.id === 1)).not.toEqual({ id: 1, x: 100, y: 300 });
  });

  it("never overlaps with 30 labels, and drops only what cannot fit", () => {
    const its = Array.from({ length: 30 }, (_, i) => item(i, 180, 400, 30 - i));
    const out = layoutLabels(its, B);
    expect(out.length).toBeGreaterThan(8);
    assertSane(its, out);
  });

  it("avoids blocked rectangles when it can", () => {
    const blocked = [{ x: 0, y: 250, w: 390, h: 100 }];
    const its = [item(1, 150, 280)];
    const out = layoutLabels(its, B, blocked);
    expect(out).toHaveLength(1);
    expect(overlap({ x: out[0]!.x, y: out[0]!.y, w: 100, h: 30 }, blocked[0]!)).toBe(false);
  });

  it("still places a label when the blocked area leaves no room", () => {
    const out = layoutLabels([item(1, 150, 280)], B, [{ x: 0, y: 0, w: 390, h: 844 }]);
    expect(out).toHaveLength(1);
  });

  it("never overlaps a hard rectangle, not even when the short search is the only one left", () => {
    const hard = [{ x: 0, y: 100, w: 390, h: 300 }];
    const everywhere = [{ x: 0, y: 100, w: 390, h: 626 }];
    const out = layoutLabels([item(1, 100, 350)], B, everywhere, hard);
    expect(out).toHaveLength(1);
    expect(overlap({ x: out[0]!.x, y: out[0]!.y, w: 100, h: 30 }, hard[0]!)).toBe(false);
  });

  it("lets an ignoreBlocked label keep its anchor over a soft blocked rectangle", () => {
    const blocked = [{ x: 50, y: 280, w: 200, h: 100 }];
    expect(layoutLabels([{ ...item(1, 100, 300), ignoreBlocked: true }], B, blocked)).toEqual([{ id: 1, x: 100, y: 300 }]);
    expect(layoutLabels([item(1, 100, 300)], B, blocked)[0]).not.toEqual({ id: 1, x: 100, y: 300 });
  });

  it("does not throw or return NaN on degenerate input", () => {
    const its = [item(1, NaN, NaN, NaN, 0, 0), item(2, Infinity, -Infinity, 1, -5, -5), item(3, 10, 10, 0, 9999, 9999)];
    const out = layoutLabels(its, B);
    for (const o of out) {
      expect(Number.isFinite(o.x)).toBe(true);
      expect(Number.isFinite(o.y)).toBe(true);
    }
    expect(() => layoutLabels([], B)).not.toThrow();
    expect(() => layoutLabels(its, { w: 0, h: 0, top: 0, bottom: 0 })).not.toThrow();
  });
});

describe("capRecent", () => {
  it("shows everything under the cap", () => {
    expect(capRecent([{ id: 1, seq: 1 }, { id: 2, seq: 2 }], 8)).toEqual({ shown: [2, 1], more: 0 });
  });

  it("keeps the most recently dropped and counts the rest", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: i, seq: i }));
    const r = capRecent(items, 8);
    expect(r.shown).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
    expect(r.more).toBe(3);
  });

  it("handles a zero or negative cap", () => {
    expect(capRecent([{ id: 1, seq: 1 }], 0)).toEqual({ shown: [], more: 1 });
    expect(capRecent([{ id: 1, seq: 1 }], -3)).toEqual({ shown: [], more: 1 });
  });
});

describe("layoutLabels performance guards", () => {
  it("never returns more than the internal cap", () => {
    const its = Array.from({ length: MAX_LABEL_ITEMS + 60 }, (_, i) => item(i, (i * 37) % 300, 100 + ((i * 53) % 500), i, 20, 10));
    const out = layoutLabels(its, B);
    expect(MAX_LABEL_ITEMS).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(MAX_LABEL_ITEMS);
  });

  it("keeps the highest priorities when it drops extras", () => {
    const its = Array.from({ length: MAX_LABEL_ITEMS + 10 }, (_, i) => item(i, 0, 100, i, 1, 1));
    const ids = new Set(layoutLabels(its, B).map((o) => o.id));
    expect(ids.has(MAX_LABEL_ITEMS + 9)).toBe(true);
    expect(ids.has(0)).toBe(false);
  });

  it("finishes the worst case (200 items, huge blocked rect) quickly", () => {
    const its = Array.from({ length: 200 }, (_, i) => item(i, 150, 300, 200 - i));
    const blocked = [{ x: 0, y: 0, w: 390, h: 844 }];
    const t0 = performance.now();
    const out = layoutLabels(its, B, blocked);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out.length).toBeLessThanOrEqual(MAX_LABEL_ITEMS);
  });
});

describe("juntar: la pila de caramelos como pocos obstáculos", () => {
  it("une los que se tocan y deja aparte a los que no", () => {
    const pila = juntar([
      { x: 0, y: 500, w: 40, h: 20 },
      { x: 35, y: 505, w: 40, h: 20 },
      { x: 70, y: 490, w: 40, h: 20 },
      { x: 300, y: 500, w: 40, h: 20 },
      // Uno que cae alto, encima de la pila: no la estira hasta arriba.
      { x: 20, y: 200, w: 40, h: 20 },
    ]);
    expect(pila).toHaveLength(3);
    expect(pila).toContainEqual({ x: 0, y: 490, w: 110, h: 35 });
    expect(pila).toContainEqual({ x: 300, y: 500, w: 40, h: 20 });
    expect(pila).toContainEqual({ x: 20, y: 200, w: 40, h: 20 });
  });

  it("une a través de uno que crece después, y con margen", () => {
    // El tercero toca a los dos primeros, que entre sí no se tocaban.
    const pila = juntar([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 5, y: 5, w: 30, h: 10 },
    ]);
    expect(pila).toEqual([{ x: 0, y: 0, w: 40, h: 15 }]);
    expect(juntar([{ x: 0, y: 0, w: 10, h: 10 }, { x: 13, y: 0, w: 10, h: 10 }], 4)).toEqual([{ x: 0, y: 0, w: 23, h: 10 }]);
    expect(juntar([{ x: 0, y: 0, w: 10, h: 10 }, { x: 13, y: 0, w: 10, h: 10 }])).toHaveLength(2);
  });

  it("descarta los vacíos y aguanta doscientos", () => {
    expect(juntar([{ x: 0, y: 0, w: 0, h: 10 }])).toEqual([]);
    const muchos = Array.from({ length: 200 }, (_, i) => ({ x: (i % 40) * 30, y: 500 + Math.floor(i / 40) * 12, w: 34, h: 14 }));
    const t0 = performance.now();
    const pila = juntar(muchos);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(pila).toHaveLength(1);
  });
});

describe("listaCaidos: la lista con la letra de la sala", () => {
  it("sin letra ni ancho, las medidas de antes", () => {
    const g = listaCaidos({ w: 390, k: 1, top: 100, floor: 600, phone: true });
    expect(g.rowH).toBe(22);
    expect(g.colW).toBe(136);
    expect(g.letra).toBeCloseTo(13.2, 9);
  });

  it("la fila crece con la letra y la columna con el nombre más ancho, con tope", () => {
    const g = listaCaidos({ w: 390, k: 0.93, top: 100, floor: 600, phone: true, letra: 14, ancho: 112 });
    expect(g.letra).toBe(14);
    expect(g.rowH).toBeCloseTo(14 / 0.6, 9);
    expect(g.colW).toBeCloseTo(112 + g.rowH * 0.85 + 9.3, 9);
    expect(g.x + g.w).toBeLessThanOrEqual(390);
    // Un nombre larguísimo no se come la pantalla.
    const ancho = listaCaidos({ w: 390, k: 0.93, top: 100, floor: 600, phone: true, letra: 14, ancho: 400 });
    expect(ancho.colW).toBeCloseTo(390 * 0.42, 9);
    // En la pantalla ancha, dos columnas, sin pasar del 20% cada una.
    const ancha = listaCaidos({ w: 1280, k: 1, top: 82, floor: 560, phone: false, letra: 16, ancho: 500 });
    expect(ancha.cols).toBe(2);
    expect(ancha.colW).toBeCloseTo(256, 9);
  });
});
