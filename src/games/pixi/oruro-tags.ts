/**
 * Pure name-tag logic for Carnaval de Oruro (no Pixi, no DOM, no randomness).
 * Decides WHO gets a tag (front devils and just-eliminated ones first), how many
 * fit, the roll-call sweep and the "out" treatment. Placement itself is done by
 * the shared `layoutLabels`. Nothing here knows who wins: priority only uses
 * depth, visibility and elimination that already happened.
 */
import { MAX_LABEL_ITEMS } from "./pinata-labels";

/** Hard cap on tags, well under the layout's own cap. */
export const MAX_TAGS = Math.min(14, MAX_LABEL_ITEMS);
/** Seconds the eliminated tag stays highlighted with an X, then it fades. */
export const OUT_HOLD = 1.5;
export const OUT_FADE = 0.4;

const fin = (v: number): boolean => Number.isFinite(v);

/** Deterministic id-only hash in [0, 1): tie-breaks and roll-call order that ignore slot and position. */
export function idHash(id: number): number {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The HUD counter, e.g. "EN LA COMPARSA  18 / 18". */
export const counterText = (label: string, alive: number, total: number): string => `${label}  ${alive} / ${total}`;

export interface TagCandidate {
  id: number;
  /** Screen anchor of the devil's head. */
  sx: number;
  sy: number;
  /** World y: larger = closer to the camera. */
  depth: number;
  /** On screen right now. */
  visible: boolean;
  /** Just eliminated and still in its highlight window. */
  out: boolean;
}

/** Selection weight: a stable shown tag beats a near tie by this much depth. */
const STICKY = 50;
const SPOT = 1e6;

export function selectTags(cands: readonly TagCandidate[], cap: number, prev: ReadonlySet<number>): { shown: number[] } {
  const m = fin(cap) ? Math.min(MAX_TAGS, Math.max(0, Math.floor(cap))) : 0;
  const ok = cands.filter((c) => c.visible && fin(c.sx) && fin(c.sy) && fin(c.depth));
  const scored = ok
    .map((c) => ({ id: c.id, s: (c.out ? SPOT : 0) + (prev.has(c.id) ? STICKY : 0) + c.depth }))
    .sort((a, b) => b.s - a.s || idHash(a.id) - idHash(b.id) || a.id - b.id);
  const shown = scored.slice(0, m).map((x) => x.id);
  return { shown };
}

/** Rough tag size in px for a chip built with scale factor `kk` (= u * scale). */
export function estimateTagSize(kk: number, maxChars: number): { w: number; h: number } {
  const k = fin(kk) && kk > 0 ? kk : 1;
  const chars = fin(maxChars) && maxChars > 0 ? maxChars : 12;
  return { w: 12 * k * 0.6 * chars + 32 * k, h: 25 * k };
}

/** How many tags fit: they may cover about a sixth of the usable area. */
export function tagBudget(w: number, h: number, top: number, bottom: number, tagW: number, tagH: number): number {
  if (![w, h, top, bottom, tagW, tagH].every(fin) || w <= 0 || tagW <= 0 || tagH <= 0) return 0;
  const usable = Math.max(0, h - top - bottom) * w;
  const per = tagW * 1.2 * (tagH * 1.7);
  return Math.min(MAX_TAGS, Math.max(0, Math.floor((usable * 0.17) / per)));
}

export function tagName(name: string, max: number): string {
  const chars = Array.from(name.trim());
  const m = Math.max(2, Math.floor(fin(max) ? max : 12));
  return chars.length <= m ? chars.join("") : `${chars.slice(0, m - 1).join("")}…`;
}

/** Index of the tag being introduced at time t during the roll call, or -1. */
export function rollCallSlot(t: number, t0: number, t1: number, count: number): number {
  if (![t, t0, t1].every(fin) || count <= 0 || t1 <= t0 || t < t0 || t >= t1) return -1;
  return Math.min(count - 1, Math.floor(((t - t0) / (t1 - t0)) * count));
}

export interface OutLook { visible: boolean; struck: boolean; scale: number; alpha: number }

/** Look of a tag `age` seconds after its devil stayed behind (age < 0: still dancing). */
export function outTreatment(age: number): OutLook {
  if (!fin(age) || age < 0) return { visible: true, struck: false, scale: 1, alpha: 1 };
  if (age < OUT_HOLD) return { visible: true, struck: true, scale: 1.15, alpha: 1 };
  const f = (age - OUT_HOLD) / OUT_FADE;
  if (f >= 1) return { visible: false, struck: true, scale: 1, alpha: 0 };
  return { visible: true, struck: true, scale: 1, alpha: 1 - f };
}

/** The roll call never lasts longer than this (seconds), whatever the crowd. */
export const ROLL_MAX_DURATION = 4.5;
const ROLL_DWELL_MAX = 1.0;
const ROLL_DWELL_MIN = 0.6;

export interface RollPlan { pages: number[][]; dwell: number; hidden: number }

/**
 * Time-sliced roll call over ALL devils: ids ordered by hash (never by slot or
 * position), `cap` per page, so everyone is named once. Past ROLL_MAX_DURATION the
 * remaining ids are not paged (`hidden`; the "+N" chip stands for them).
 */
export function planRollCall(ids: readonly number[], cap: number): RollPlan {
  const m = fin(cap) ? Math.max(0, Math.floor(cap)) : 0;
  if (m === 0) return { pages: [], dwell: ROLL_DWELL_MAX, hidden: fin(cap) ? ids.length : 0 };
  const sorted = [...ids].sort((a, b) => idHash(a) - idHash(b) || a - b);
  const all: number[][] = [];
  for (let i = 0; i < sorted.length; i += m) all.push(sorted.slice(i, i + m));
  const maxPages = Math.floor(ROLL_MAX_DURATION / ROLL_DWELL_MIN);
  const pages = all.slice(0, maxPages);
  const dwell = pages.length ? Math.min(ROLL_DWELL_MAX, Math.max(ROLL_DWELL_MIN, ROLL_MAX_DURATION / pages.length)) : ROLL_DWELL_MAX;
  return { pages, dwell, hidden: sorted.length - pages.reduce((a, p) => a + p.length, 0) };
}

/** Which page is up at time t (roll call starts at t0), and which member is being introduced. */
export function rollCallAt(plan: RollPlan, t: number, t0: number): { page: number; hi: number } {
  const none = { page: -1, hi: -1 };
  if (!fin(t) || !fin(t0) || !plan.pages.length) return none;
  const x = (t - t0) / plan.dwell;
  if (x < 0 || x >= plan.pages.length) return none;
  const page = Math.floor(x);
  const pg = plan.pages[page] as number[];
  const hi = pg[Math.min(pg.length - 1, Math.floor((x - page) * pg.length))];
  return { page, hi: hi ?? -1 };
}
