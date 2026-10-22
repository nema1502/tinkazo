import { describe, expect, it } from "vitest";
import { FALSA, T_CREEP, T_HOLD, T_LOCK } from "./wheel-beats";
import { L_MIN, planWheelMotion } from "./wheel-motion";

/** Un rng sembrado y simple, solo para las pruebas (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una ruleta como la arma `wheel.ts`: cada persona con varios gajos intercalados. */
function ruleta(n: number, seed: number, falsa: boolean) {
  const rng = rngOf(seed);
  const rep = n <= 12 ? Math.max(1, Math.round(24 / n)) : 1;
  const segs = n > 24 ? 24 : n * rep;
  const ciclo = n > 24 ? 24 : n;
  const ganador = (seed * 7) % ciclo;
  const startSeg = rng() * segs;
  const winSeg = ganador + ciclo * Math.floor(rng() * (segs / ciclo));
  const landing = winSeg + 0.5 + (rng() - 0.5) * 0.6;
  const m = planWheelMotion({ segs, ciclo, startSeg, landing, falsa, rng });
  const gajo = (t: number): number => Math.floor(startSeg + m.pos(t));
  const quien = (g: number): number => ((g % ciclo) + ciclo) % ciclo;
  return { m, segs, ciclo, ganador, startSeg, landing, gajo, quien };
}

describe("ruleta: cómo gira", () => {
  it.each([2, 5, 8, 12, 18, 24, 40])("con %i personas para donde tiene que parar, sin saltos ni marcha atrás", (n) => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const falsa of [false, true]) {
        const r = ruleta(n, seed, falsa);
        expect(r.m.pos(0)).toBe(0);
        expect(r.m.pos(T_LOCK)).toBeCloseTo(r.m.total, 9);
        expect(r.m.pos(T_LOCK + 3)).toBeCloseTo(r.m.total, 9);
        // Para dentro del gajo del ganador, en el lugar que le tocó.
        const fin = r.startSeg + r.m.total;
        const d = (((fin - r.landing) % r.segs) + r.segs) % r.segs;
        expect(Math.min(d, r.segs - d)).toBeLessThan(1e-6);
        expect(r.quien(r.gajo(T_LOCK))).toBe(r.ganador);
        // Nunca va para atrás ni salta: la posición sube de a poco, a la velocidad que dice.
        let antes = 0;
        for (let t = 0; t <= T_LOCK + 0.01; t += 0.01) {
          const p = r.m.pos(t);
          expect(p).toBeGreaterThanOrEqual(antes - 1e-9);
          expect(r.m.speed(t)).toBeGreaterThanOrEqual(0);
          expect(p - antes).toBeLessThan(0.01 * 56);
          antes = p;
        }
        // Sin quiebre al empezar el último tramo.
        expect(Math.abs(r.m.speed(T_CREEP - 1e-6) - r.m.speed(T_CREEP + 1e-6))).toBeLessThan(1e-3);
        // El último tramo se arrastra: frena todo el tiempo y no arranca más rápido que un tercio de la vuelta a fondo.
        expect(r.m.speed(T_CREEP + 0.01)).toBeLessThan(20);
        const hasta = falsa ? T_HOLD : T_LOCK;
        for (let t = T_CREEP; t + 0.05 <= hasta; t += 0.05) expect(r.m.speed(t + 0.05)).toBeLessThanOrEqual(r.m.speed(t) + 1e-9);
        expect(r.m.L).toBeGreaterThanOrEqual(L_MIN);
      }
    }
  });

  it.each([8, 18])("con %i personas, el gajo bajo la flecha al empezar el último tramo no dice quién gana", (n) => {
    // El auditor de delatores mira lo que se ve antes del corte, que es ese
    // momento: el relator dice "¡ya casi para!" y la cámara está sobre la flecha.
    const N = 2400;
    const cuenta = new Array<number>(n).fill(0);
    for (let seed = 1; seed <= N; seed++) {
      const r = ruleta(n, seed, seed % 4 === 0);
      const off = (((r.ganador - r.quien(r.gajo(T_CREEP))) % n) + n) % n;
      cuenta[off] = (cuenta[off] ?? 0) + 1;
    }
    for (const c of cuenta) {
      expect(c / (N / n)).toBeGreaterThan(0.75);
      expect(c / (N / n)).toBeLessThan(1.25);
    }
  });

  it.each([8, 18])("con %i personas, después de \"¡se traba!\" a veces gana ese gajo y a veces el siguiente", (n) => {
    const N = 1000;
    const k = [0, 0, 0, 0];
    for (let seed = 1; seed <= N; seed++) {
      const r = ruleta(n, seed, false);
      const g = r.gajo(T_LOCK) - r.gajo(T_HOLD);
      k[g] = (k[g] ?? 0) + 1;
      expect(g).toBe(r.m.gajosDespues);
    }
    // La mitad de las veces gana el gajo en que se trabó: el último que nombra el relator.
    expect((k[0] ?? 0) / N).toBeGreaterThan(0.4);
    expect((k[0] ?? 0) / N).toBeLessThan(0.6);
    expect((k[1] ?? 0) / N).toBeGreaterThan(0.3);
    expect(((k[2] ?? 0) + (k[3] ?? 0)) / N).toBeLessThan(0.15);
  });

  it("la parada falsa a veces se queda y a veces avanza uno o dos: el nombrado gana a veces", () => {
    const N = 1000;
    const k = [0, 0, 0, 0];
    for (let seed = 1; seed <= N; seed++) {
      const r = ruleta(8, seed, true);
      // Quieta durante la parada.
      expect(r.m.pos(T_HOLD + FALSA - 0.01)).toBeCloseTo(r.m.pos(T_HOLD), 9);
      const g = r.gajo(T_LOCK) - r.gajo(T_HOLD);
      k[g] = (k[g] ?? 0) + 1;
      expect(g === 0).toBe(r.m.seQueda);
    }
    expect(k[3]).toBe(0);
    for (const c of k.slice(0, 3)) expect(c / N).toBeGreaterThan(0.2);
  });

  it("es determinista: la misma semilla gira igual", () => {
    const a = ruleta(18, 99, true);
    const b = ruleta(18, 99, true);
    for (let t = 0; t <= T_LOCK; t += 0.37) expect(a.m.pos(t)).toBe(b.m.pos(t));
  });
});
