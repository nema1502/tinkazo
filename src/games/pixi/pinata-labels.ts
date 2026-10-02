/**
 * Pure label placement for the Piñata game (no Pixi, no DOM).
 * Every label is a rectangle whose (x, y) is its TOP-LEFT corner in screen pixels.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface LabelItem extends Rect { id: number; priority: number }
export interface Bounds { w: number; h: number; top: number; bottom: number }
export interface Placed { id: number; x: number; y: number }

/** Ring search reach, and the smaller reach of the fallback pass that ignores `blocked`. */
const MAX_RINGS = 12;
const FALLBACK_RINGS = 3;
/** Hard cap on labels processed per call; lower priorities beyond it are dropped. */
export const MAX_LABEL_ITEMS = 40;

const fin = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);
const size = (v: number): number => Math.max(0, fin(v));

function hits(x: number, y: number, w: number, h: number, list: Rect[]): boolean {
  for (let i = 0; i < list.length; i++) {
    const o = list[i] as Rect;
    if (x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h) return true;
  }
  return false;
}

/**
 * Greedy, deterministic de-overlap. Higher priority is placed first and keeps its
 * (clamped) anchor; the rest search outward in rings for the nearest free spot.
 * Only the top MAX_LABEL_ITEMS items by priority are processed: extras are dropped,
 * so the result covers processed items only. Labels that find no free spot are
 * omitted too (cap them upstream). `blocked` rectangles (e.g. the piñata) are avoided
 * when possible; if that fails, a cheap short search ignores them but still never
 * overlaps another label.
 */
export function layoutLabels(items: LabelItem[], bounds: Bounds, blocked: Rect[] = []): Placed[] {
  const bw = size(bounds.w), top = fin(bounds.top), bot = Math.max(top, fin(bounds.h) - fin(bounds.bottom));
  const order = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => fin(b.it.priority) - fin(a.it.priority) || a.i - b.i)
    .slice(0, MAX_LABEL_ITEMS);
  const placed: Rect[] = [];
  const withBlocked: Rect[] = [...blocked];
  const out: Placed[] = [];
  let w = 0, h = 0, ax = 0, ay = 0, sx = 1, sy = 1, rx = 0, ry = 0;
  const clampX = (x: number): number => Math.min(Math.max(0, x), Math.max(0, bw - w));
  const clampY = (y: number): number => Math.min(Math.max(top, y), Math.max(top, bot - h));

  /** Nearest free spot within `rings`; result goes to rx/ry (no allocation per probe). */
  const search = (avoid: Rect[], rings: number): boolean => {
    rx = ax; ry = ay;
    if (!hits(rx, ry, w, h, avoid)) return true;
    for (let r = 1; r <= rings; r++) {
      let found = false, bestD = Infinity, bx = 0, by = 0;
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const cx = clampX(ax + i * sx), cy = clampY(ay + j * sy);
          const d = (cx - ax) ** 2 + (cy - ay) ** 2;
          if (d < bestD && !hits(cx, cy, w, h, avoid)) { found = true; bestD = d; bx = cx; by = cy; }
        }
      }
      if (found) { rx = bx; ry = by; return true; }
    }
    return false;
  };

  for (const { it } of order) {
    w = size(it.w); h = size(it.h);
    ax = clampX(fin(it.x)); ay = clampY(fin(it.y));
    sx = Math.max(1, w / 2); sy = Math.max(1, h * 0.6);
    if (!search(withBlocked, MAX_RINGS) && !search(placed, FALLBACK_RINGS)) continue;
    const r = { x: rx, y: ry, w, h };
    placed.push(r);
    withBlocked.push(r);
    out.push({ id: it.id, x: rx, y: ry });
  }
  return out;
}

/**
 * Of the candies still in flight, label the `max` most recently dropped and report
 * how many are left over, for a single compact "+N" chip.
 */
export function capRecent(items: { id: number; seq: number }[], max: number): { shown: number[]; more: number } {
  const m = Math.max(0, Math.floor(fin(max)));
  const sorted = [...items].sort((a, b) => b.seq - a.seq || a.id - b.id);
  return { shown: sorted.slice(0, m).map((x) => x.id), more: Math.max(0, sorted.length - m) };
}
