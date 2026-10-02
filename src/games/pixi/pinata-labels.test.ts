import { describe, expect, it } from "vitest";
import { MAX_LABEL_ITEMS, capRecent, layoutLabels, type LabelItem } from "./pinata-labels";

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
