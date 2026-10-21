import { describe, expect, it } from "vitest";
import { PILE_SLOPE, PILE_STEP, SETTLE_AFTER, createPile, shouldSettle } from "./pinata-monton";

/** El mismo azar por argumentos que usa el estadio (`hash` de stage.ts). */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * La caída de los caramelos como la hace `pinata.ts`: gravedad, rebote en el
 * montón, la ladera que los hace rodar y el asiento. Caen en ocho tandas desde
 * la piñata, en el medio de la pantalla. Devuelve el montón y cuánto tardó cada
 * uno en asentarse desde que tocó el piso.
 */
function caer(n: number, w: number, h: number): { pile: ReturnType<typeof createPile>; sz: number; tardanzas: number[]; sinAsentar: number; paredes: [number, number] } {
  const portrait = h > w * 1.1;
  const k = portrait ? Math.min(w / 420, h / 900) : h / 720;
  const sz = Math.min(26 * k, Math.max(12 * k, Math.sqrt(1 / n) * 70 * k));
  const floor = h - (w <= 520 ? 118 : 106) - 58 * k;
  const pile = createPile(sz, 20 * k, w - 20 * k);
  const R = Math.min(h * 0.13, w * 0.12);
  const DT = 1 / 120;
  const cs = Array.from({ length: n }, (_, id) => ({
    id, out: false, done: false, x: 0, y: 0, vx: 0, vy: 0, touch: -1, at: Math.floor((id * 8) / n) * 1.4,
  }));
  const tardanzas: number[] = [];
  for (let t = 0; t < 8 * 1.4 + 6; t += DT) {
    for (const c of cs) {
      if (c.done) continue;
      if (!c.out) {
        if (t < c.at) continue;
        c.out = true;
        c.x = w / 2 + (hash(c.id, 1) - 0.5) * R * 0.8;
        c.y = h * 0.35;
        c.vx = (hash(c.id, 2) - 0.5) * 720 * k;
        c.vy = -(120 + hash(c.id, 4) * 260) * k;
      }
      c.vy += 1500 * k * DT;
      c.x += c.vx * DT;
      c.y += c.vy * DT;
      const col = pile.colOf(c.x);
      const ground = floor - sz * 0.62 - pile.heightAt(col);
      if (c.y >= ground) {
        c.y = ground;
        if (c.touch < 0) c.touch = t;
        if (c.vy > 150 * k) {
          c.vy *= -0.42;
          c.vx *= 0.75;
        } else {
          c.vy = 0;
          c.vx += (pile.heightAt(col - 1) - pile.heightAt(col + 1)) * 6 * DT * k;
          c.vx *= 0.9;
          if (shouldSettle(c.vx, k, t - c.touch)) {
            pile.settle(col, hash(c.id, 9) < 0.5 ? -1 : 1);
            c.done = true;
            tardanzas.push(t - c.touch);
          }
        }
      }
      if (c.x < 20 * k || c.x > w - 20 * k) {
        c.x = Math.min(w - 20 * k, Math.max(20 * k, c.x));
        c.vx *= -0.6;
      }
    }
  }
  return { pile, sz, tardanzas, sinAsentar: cs.filter((c) => !c.done).length, paredes: [pile.colOf(20 * k), pile.colOf(w - 20 * k)] };
}

describe("el montón de la piñata: arena, no torres", () => {
  it.each([
    ["la pantalla grande", 1280, 720],
    ["un celular", 390, 844],
  ])("con 200 en %s, el montón es una loma baja y nadie queda sin asentarse", (_, w, h) => {
    const r = caer(200, w, h);
    // Antes: torres de 31 caramelos en la pantalla grande y de 49 en el celular.
    expect(r.pile.peak() / r.sz).toBeLessThanOrEqual(9);
    expect(r.sinAsentar).toBe(0);
    expect(Math.max(...r.tardanzas)).toBeLessThanOrEqual(SETTLE_AFTER + 0.05);
  });

  it("con 27, un montoncito de pocos caramelos de alto", () => {
    const r = caer(27, 1280, 720);
    expect(r.pile.peak() / r.sz).toBeLessThanOrEqual(3);
    expect(r.sinAsentar).toBe(0);
  });

  it("ninguna columna queda más alta que su vecina por más del talud", () => {
    for (const [w, h] of [[1280, 720], [390, 844], [844, 390]] as const) {
      const r = caer(200, w, h);
      const cols = new Map(r.pile.columns());
      // Entre las paredes: contra la pared el montón se apoya, como contra un muro.
      const [lo, hi] = r.paredes;
      for (let c = lo; c < hi; c++) {
        expect(Math.abs((cols.get(c) ?? 0) - (cols.get(c + 1) ?? 0))).toBeLessThanOrEqual(r.sz * PILE_SLOPE + 1e-9);
      }
    }
  });

  it("nadie rueda afuera de las paredes", () => {
    // Todos caen contra la pared de la izquierda: se apilan ahí, sin pasarla.
    const pile = createPile(10, 20, 400);
    for (let i = 0; i < 300; i++) pile.settle(pile.colOf(25), -1);
    const cols = pile.columns().map(([c]) => c);
    expect(Math.min(...cols)).toBeGreaterThanOrEqual(pile.colOf(20));
    expect(Math.max(...cols)).toBeLessThanOrEqual(pile.colOf(400));
  });

  it("cada caramelo sube su columna medio caramelo, y devuelve lo que tiene debajo", () => {
    const pile = createPile(10, 0, 1000);
    const a = pile.settle(10, 1);
    expect(a).toEqual({ col: 10, base: 0 });
    expect(pile.heightAt(10)).toBeCloseTo(10 * PILE_STEP);
    // El segundo en la misma columna rueda si quedaría más alto que el talud.
    const b = pile.settle(10, 1);
    expect(b.base).toBeLessThanOrEqual(10 * PILE_SLOPE);
  });

  it("la misma caída arma el mismo montón", () => {
    expect(caer(120, 1280, 720).pile.columns()).toEqual(caer(120, 1280, 720).pile.columns());
  });
});

describe("el asiento de un caramelo", () => {
  it("se asienta cuando casi no se mueve", () => {
    expect(shouldSettle(3, 1, 0.1)).toBe(true);
    expect(shouldSettle(-5.9, 1, 0)).toBe(true);
    expect(shouldSettle(40, 1, 0.1)).toBe(false);
  });

  it("y siempre, a más tardar un rato después de tocar el piso", () => {
    expect(shouldSettle(400, 1, SETTLE_AFTER)).toBe(true);
    expect(shouldSettle(400, 1, SETTLE_AFTER - 0.01)).toBe(false);
  });
});
