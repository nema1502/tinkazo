import { describe, expect, it } from "vitest";
import { MAX_LABEL_ITEMS, layoutLabels, type LabelItem } from "./pinata-labels";
import {
  MAX_TAGS, OUT_HOLD, OUT_FADE, ROLL_MAX_DURATION, counterText, estimateTagSize, idHash, outTreatment, planRollCall, rollCallAt, rollCallSlot, selectTags, tagBudget, tagName, type TagCandidate,
} from "./oruro-tags";

const cand = (id: number, depth: number, extra: Partial<TagCandidate> = {}): TagCandidate => ({
  id, sx: 100 + id * 10, sy: 300, depth, visible: true, out: false, ...extra,
});

describe("selectTags", () => {
  it("is deterministic and never exceeds the cap", () => {
    const cs = Array.from({ length: 18 }, (_, i) => cand(i, (i * 37) % 11));
    const a = selectTags(cs, 6, new Set());
    const b = selectTags([...cs].reverse(), 6, new Set());
    expect(a.shown.length).toBe(6);
    expect([...a.shown].sort()).toEqual([...b.shown].sort());
  });

  it("prefers front (larger depth) devils", () => {
    const cs = [cand(0, 10), cand(1, 300), cand(2, 200), cand(3, 50)];
    expect(selectTags(cs, 2, new Set()).shown).toEqual([1, 2]);
  });

  it("gives just-eliminated devils priority over any depth", () => {
    const cs = [cand(0, 900), cand(1, 800), cand(2, 1, { out: true })];
    expect(selectTags(cs, 2, new Set()).shown).toContain(2);
    expect(selectTags(cs, 1, new Set()).shown).toEqual([2]);
  });

  it("keeps already shown tags on near ties (no flicker)", () => {
    const cs = [cand(0, 100), cand(1, 110)];
    expect(selectTags(cs, 1, new Set([0])).shown).toEqual([0]);
    expect(selectTags(cs, 1, new Set()).shown).toEqual([1]);
  });

  it("skips off-screen and non-finite candidates and counts only visible leftovers in more", () => {
    const cs = [
      cand(0, 5, { visible: false }),
      cand(1, 5, { sx: NaN }),
      cand(2, 5, { depth: NaN }),
      cand(3, 5),
      cand(4, 4),
    ];
    expect(selectTags(cs, 1, new Set()).shown).toEqual([3]);
  });

  it("handles n=2, n=200, empty and a bad cap", () => {
    expect(selectTags([cand(0, 1), cand(1, 2)], 8, new Set())).toEqual({ shown: [1, 0] });
    const big = Array.from({ length: 200 }, (_, i) => cand(i, i));
    const r = selectTags(big, 9999, new Set());
    expect(r.shown.length).toBeLessThanOrEqual(MAX_TAGS);
    expect(selectTags([], 5, new Set())).toEqual({ shown: [] });
    for (const bad of [0, -3, NaN, Infinity * 0]) expect(selectTags(big, bad, new Set()).shown).toEqual([]);
  });
});

describe("tagBudget / estimateTagSize / tagName", () => {
  it("scales with area and stays within [0, MAX_TAGS]", () => {
    const sz = estimateTagSize(1.2, 12);
    const phone = tagBudget(390, 844, 100, 118, sz.w, sz.h);
    const land = tagBudget(844, 390, 82, 106, sz.w, sz.h);
    expect(phone).toBeGreaterThanOrEqual(4);
    expect(phone).toBeLessThanOrEqual(MAX_TAGS);
    expect(land).toBeGreaterThanOrEqual(3);
    expect(tagBudget(2000, 2000, 80, 100, 20, 10)).toBe(MAX_TAGS);
    expect(MAX_TAGS).toBeLessThanOrEqual(MAX_LABEL_ITEMS);
  });

  it("returns 0 for degenerate sizes", () => {
    expect(tagBudget(0, 0, 0, 0, 100, 20)).toBe(0);
    expect(tagBudget(390, 844, 100, 118, 0, 20)).toBe(0);
    expect(tagBudget(NaN, 844, 100, 118, 100, 20)).toBe(0);
    expect(tagBudget(390, 844, 100, 118, 100, NaN)).toBe(0);
    expect(estimateTagSize(NaN, 12).w).toBeGreaterThan(0);
  });

  it("shortens long names and keeps short ones", () => {
    expect(tagName("Ana", 12)).toBe("Ana");
    expect(tagName("Maximiliano Fernandez", 12)).toBe("Maximiliano…");
    expect(Array.from(tagName("Maximiliano Fernandez", 12)).length).toBe(12);
    expect(tagName("  Bo  ", 12)).toBe("Bo");
    expect(tagName("", 12)).toBe("");
  });
});

describe("rollCallSlot", () => {
  it("sweeps each slot once, then stops", () => {
    expect(rollCallSlot(0, 0.2, 2.0, 4)).toBe(-1);
    expect(rollCallSlot(0.2, 0.2, 2.0, 4)).toBe(0);
    expect(rollCallSlot(1.0, 0.2, 2.0, 4)).toBe(1);
    expect(rollCallSlot(1.99, 0.2, 2.0, 4)).toBe(3);
    expect(rollCallSlot(2.5, 0.2, 2.0, 4)).toBe(-1);
    expect(rollCallSlot(1, 0.2, 2.0, 0)).toBe(-1);
    expect(rollCallSlot(NaN, 0.2, 2.0, 4)).toBe(-1);
    expect(rollCallSlot(1, 2, 2, 4)).toBe(-1);
  });
});

describe("outTreatment", () => {
  it("is neutral for devils still dancing", () => {
    expect(outTreatment(-1)).toEqual({ visible: true, struck: false, scale: 1, alpha: 1 });
    expect(outTreatment(NaN).struck).toBe(false);
  });
  it("highlights with an X, then fades and disappears", () => {
    const hot = outTreatment(0.3);
    expect(hot.struck).toBe(true);
    expect(hot.scale).toBeGreaterThan(1);
    expect(hot.visible).toBe(true);
    expect(outTreatment(OUT_HOLD + OUT_FADE / 2).alpha).toBeLessThan(1);
    expect(outTreatment(OUT_HOLD + OUT_FADE / 2).alpha).toBeGreaterThan(0);
    expect(outTreatment(OUT_HOLD + OUT_FADE + 0.01).visible).toBe(false);
    expect(OUT_HOLD).toBe(1.5);
  });
});

describe("selection + layoutLabels", () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  function run(w: number, h: number, top: number, bottom: number, kk: number, count: number): void {
    const sz = estimateTagSize(kk, 12);
    const cap = tagBudget(w, h, top, bottom, sz.w, sz.h);
    // A crowd bunched in the middle band, three rows deep, like the street.
    const cs = Array.from({ length: count }, (_, i) =>
      cand(i, i % 3, { sx: w * 0.1 + ((i * 53) % 80) * (w * 0.8) / 80, sy: h * 0.5 + (i % 3) * 60 }));
    const { shown } = selectTags(cs, cap, new Set());
    expect(shown.length).toBeLessThanOrEqual(cap);
    const items: LabelItem[] = shown.map((id, r) => {
      const c = cs.find((x) => x.id === id) as TagCandidate;
      return { id, x: c.sx - sz.w / 2, y: c.sy - sz.h - 8, w: sz.w, h: sz.h, priority: shown.length - r };
    });
    const out = layoutLabels(items, { w, h, top, bottom });
    const rs = out.map((o) => ({ x: o.x, y: o.y, w: sz.w, h: sz.h }));
    for (const r of rs) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(top);
      expect(r.y + r.h).toBeLessThanOrEqual(h - bottom + 1e-9);
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false);
    expect(rs.length).toBeGreaterThan(0);
  }

  it("never overlaps and stays in bounds on a phone with 18 devils", () => run(390, 844, 100, 118, 1.2 * 0.93, 18));
  it("never overlaps and stays in bounds in landscape with 18 devils", () => run(844, 390, 82, 106, 1.17, 18));
  it("holds with 200 devils", () => run(390, 844, 100, 118, 1.2 * 0.93, 200));
});

describe("counterText", () => {
  it("keeps the label, the alive count and the total", () => {
    expect(counterText("EN LA COMPARSA", 18, 18)).toBe("EN LA COMPARSA  18 / 18");
    const s2 = counterText("LEFT", 7, 18);
    expect(s2).toContain("LEFT");
    expect(s2).toContain("7");
    expect(s2).toContain("/ 18");
  });
});

describe("tie-break and name guards", () => {
  it("breaks depth ties by hash of the id, not by lowest id", () => {
    const cs = Array.from({ length: 12 }, (_, i) => cand(i, 5));
    const a = selectTags(cs, 4, new Set()).shown;
    const b = selectTags([...cs].reverse(), 4, new Set()).shown;
    expect(a).toEqual(b);
    expect(a).not.toEqual([0, 1, 2, 3]);
    expect(idHash(3)).toBe(idHash(3));
    expect(idHash(3)).not.toBe(idHash(4));
  });
  it("tagName survives a non-finite max", () => {
    expect(tagName("Maximiliano Fernandez", NaN)).toBe("Maximiliano…");
    expect(tagName("Ana", Infinity)).toBe("Ana");
  });
});

describe("planRollCall / rollCallAt", () => {
  const ids = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it("names every devil in some page, never above the cap, for n=2 and n=18", () => {
    for (const n of [2, 18]) {
      const plan = planRollCall(ids(n), 6);
      const flat = plan.pages.flat();
      expect([...flat].sort((a, b) => a - b)).toEqual(ids(n));
      for (const pg of plan.pages) expect(pg.length).toBeLessThanOrEqual(6);
      expect(plan.hidden).toBe(0);
    }
    expect(planRollCall(ids(18), 6).pages.length).toBe(3);
  });

  it("is deterministic and independent of the input order (position/slot)", () => {
    const a = planRollCall(ids(18), 5);
    const b = planRollCall([...ids(18)].reverse(), 5);
    expect(a).toEqual(b);
    expect(a.pages.flat()).not.toEqual(ids(18));
  });

  it("bounds the roll call for n=200 and counts the rest as hidden", () => {
    const plan = planRollCall(ids(200), 8);
    expect(plan.pages.length * plan.dwell).toBeLessThanOrEqual(ROLL_MAX_DURATION + 1e-9);
    expect(plan.pages.flat().length + plan.hidden).toBe(200);
    expect(plan.hidden).toBeGreaterThan(0);
    for (const pg of plan.pages) expect(pg.length).toBeLessThanOrEqual(8);
  });

  it("handles empty input and a bad cap", () => {
    expect(planRollCall([], 6).pages).toEqual([]);
    expect(planRollCall(ids(5), NaN).pages).toEqual([]);
    expect(planRollCall(ids(5), 0).hidden).toBe(5);
  });

  it("walks the pages over time and highlights one member at a time, then ends", () => {
    const plan = planRollCall(ids(18), 6);
    const total = plan.pages.length * plan.dwell;
    expect(rollCallAt(plan, 0.1, 0.25).page).toBe(-1);
    const first = rollCallAt(plan, 0.25, 0.25);
    expect(first.page).toBe(0);
    expect(first.hi).toBe(plan.pages[0]![0]);
    const last = rollCallAt(plan, 0.25 + total - 0.01, 0.25);
    expect(last.page).toBe(plan.pages.length - 1);
    expect(plan.pages[last.page]).toContain(last.hi);
    expect(rollCallAt(plan, 0.25 + total + 0.01, 0.25)).toEqual({ page: -1, hi: -1 });
    expect(rollCallAt(plan, NaN, 0.25)).toEqual({ page: -1, hi: -1 });
  });
});
