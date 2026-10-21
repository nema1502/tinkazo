import { describe, expect, it } from "vitest";
import { CAPTURE_CLEAR, MOUTH, NEAR_MAX, NEAR_MIN, holeLayout, optsForArc, planThrows, type ArcName, type Point, type Throw } from "./sapo-plan";

/** Un generador sembrado (mulberry32), como en sapo-plan.test.ts. */
function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

const ARCS: ArcName[] = ["remontada", "susto", "duelo", "tapada"];
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const SEEDS = Array.from({ length: 48 }, (_, i) => i * 6121 + 3);
/** Las barridas hacen miles de comprobaciones: con la máquina ocupada, 5 s no alcanzan. */
const SWEEP_MS = 60_000;

/** Las combinaciones que el juego puede tirar: n agujeros, 1 a 3 premios, cada arco. */
function casos(): { n: number; winners: number[]; arc: ArcName; seed: number }[] {
  const out: { n: number; winners: number[]; arc: ArcName; seed: number }[] = [];
  for (const seed of SEEDS) {
    for (const n of [2, 3, 5, 8, 12]) {
      for (const k of [1, 2, 3]) {
        if (k > n) continue;
        const r = rngOf(seed * 31 + n * 7 + k);
        const all = Array.from({ length: n }, (_, i) => i);
        for (let i = all.length - 1; i > 0; i--) {
          const j = Math.floor(r() * (i + 1));
          [all[i], all[j]] = [all[j] as number, all[i] as number];
        }
        out.push({ n, winners: all.slice(0, k), arc: ARCS[seed % ARCS.length] as ArcName, seed });
      }
    }
  }
  return out;
}

const planear = (c: ReturnType<typeof casos>[number], boca: boolean): Throw[] =>
  planThrows(c.n, c.winners, rngOf(c.seed), optsForArc(c.arc), boca);

describe("sapo: la boca de la rana", () => {
  it("hay exactamente una boca por show, en cualquier arco, y es un fallo que no es el último tiro", () => {
    for (const c of casos()) {
      const tiros = planear(c, true);
      const bocas = tiros.filter((t) => t.boca);
      expect(bocas.length).toBe(1);
      const boca = tiros.indexOf(bocas[0] as Throw);
      expect((bocas[0] as Throw).kind).toBe("miss");
      expect(boca).toBeLessThan(tiros.length - 1);
    }
  }, SWEEP_MS);

  it("entrar a la boca no cambia el resto del guion: mismos tiros, mismo orden, salvo el fallo convertido", () => {
    for (const c of casos()) {
      const sin = planear(c, false);
      const con = planear(c, true);
      expect(con.length).toBe(sin.length);
      con.forEach((t, i) => {
        const original = sin[i] as Throw;
        expect(t.kind).toBe(original.kind);
        expect(t.turn).toBe(original.turn);
        if (!t.boca) expect(t).toEqual(original);
      });
    }
  }, SWEEP_MS);

  it("la argolla que entra cae en la boca de la rana, lejos de cualquier agujero", () => {
    for (const c of casos()) {
      const L = holeLayout(c.n);
      const boca = planear(c, true).find((t) => t.boca) as Throw;
      expect(dist(boca.landing, MOUTH)).toBeLessThan(1e-9);
      expect(dist(boca.exit, MOUTH)).toBeLessThan(1e-9);
      for (const h of L.holes) expect(dist(MOUTH, h)).toBeGreaterThan(L.holeR + CAPTURE_CLEAR);
    }
  }, SWEEP_MS);

  it("la escupida cae sobre el aro de un agujero que todavía no ganó nadie, sin entrar en ninguno", () => {
    for (const c of casos()) {
      const L = holeLayout(c.n);
      const tiros = planear(c, true);
      const idx = tiros.findIndex((t) => t.boca);
      const boca = tiros[idx] as Throw;
      const b = boca.boca as NonNullable<Throw["boca"]>;
      // Aún no ganado: ningún premio anterior tiene ese agujero.
      expect(c.winners.slice(0, boca.turn)).not.toContain(b.rimSlot);
      const aro = L.holes[b.rimSlot] as Point;
      const d = dist(b.spit, aro);
      expect(d).toBeGreaterThanOrEqual(L.holeR * NEAR_MIN - 1e-9);
      expect(d).toBeLessThanOrEqual(L.holeR * NEAR_MAX + 1e-9);
      for (const h of L.holes) expect(dist(b.spit, h)).toBeGreaterThan(L.holeR + CAPTURE_CLEAR);
    }
  }, SWEEP_MS);

  it("después de escupirla, la argolla rueda afuera y nunca atraviesa un agujero", () => {
    for (const c of casos()) {
      const L = holeLayout(c.n);
      const b = (planear(c, true).find((t) => t.boca) as Throw).boca as NonNullable<Throw["boca"]>;
      for (let i = 0; i <= 50; i++) {
        const f = i / 50;
        const p = { x: b.spit.x + (b.exit.x - b.spit.x) * f, y: b.spit.y + (b.exit.y - b.spit.y) * f };
        for (const h of L.holes) expect(dist(p, h)).toBeGreaterThan(L.holeR);
      }
    }
  }, SWEEP_MS);

  it("es determinista: la misma ronda pone la boca en el mismo lugar, y otra ronda la pone distinto", () => {
    const c = casos()[10] as ReturnType<typeof casos>[number];
    const a = planear(c, true).findIndex((t) => t.boca);
    const b = planear(c, true).findIndex((t) => t.boca);
    expect(a).toBe(b);
    const otra = casos().filter((x) => x.n === c.n && x.winners.length === c.winners.length && x.seed !== c.seed);
    const lugares = new Set(otra.map((x) => planear(x, true).findIndex((t) => t.boca)));
    expect(lugares.size).toBeGreaterThan(1);
  }, SWEEP_MS);
});
