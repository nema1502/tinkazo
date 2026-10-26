import { describe, expect, it } from "vitest";
import { planRace, type Plan } from "./plan";

/**
 * El plan de la carrera no delata a la ganadora con su puesto: el auditor de
 * delatores (scripts/audit-delatores.mjs race) lo mide en el plan con 1.500
 * rondas; esto lo mira acá con 1.600 planes de ocho, sin pasar por la selección.
 */

/** El chi cuadrado de un reparto parejo entre `k` casilleros (k − 1 grados de libertad). */
const chi2 = (cuenta: number[], total: number): number => {
  const e = total / cuenta.length;
  return cuenta.reduce((s, o) => s + (o - e) ** 2 / e, 0);
};
/** El crítico de 1 en 1000 con 7 grados de libertad (ocho puestos). */
const CRITICO_7 = 24.322;

/** Un azar sembrado chico (mulberry32), alcanza para las pruebas. */
function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Ana", "Jorge", "Lucía", "Carlos", "Elena", "Diego", "María", "Pablo"];

/** El puesto del actor `k` a la altura `q`. */
const puesto = (p: Plan, k: number, q: number): number => {
  const xs = p.lanes.map((_, j) => p.pos(j, q));
  return 1 + xs.filter((x, j) => j !== k && x > (xs[k] as number)).length;
};

function muchas(n: number, cuantas: number): Plan[] {
  return Array.from({ length: cuantas }, (_, i) => planRace(NAMES.slice(0, n), (i * 5) % n, rngOf(i * 7919 + 3)));
}

describe("el plan de la carrera", () => {
  const planes = muchas(8, 1600);

  it("la ganadora llega primera, justo en la meta", () => {
    for (const p of planes) {
      const w = p.story.winner;
      expect(p.pos(w, 1)).toBeCloseTo(1, 6);
      for (let k = 0; k < p.lanes.length; k++) if (k !== w) expect(p.pos(k, 1)).toBeLessThan(1);
      // No cruza la meta antes de tiempo.
      for (const q of [0.9, 0.95, 0.98, 0.995]) expect(p.pos(w, q)).toBeLessThan(1);
    }
  });

  it("al largar y al 25, al 50 y al 75 por ciento, cualquier puesto sale una de cada ocho veces", () => {
    for (const q of [0.067, 0.25, 0.5, 0.75]) {
      const cuenta = new Array(9).fill(0);
      for (const p of planes) cuenta[puesto(p, p.story.winner, q)]++;
      // Cuatro desvíos de una binomial de 1.600 con 1/8: de 9,2 a 15,8 %.
      for (let r = 1; r <= 8; r++) {
        const f = (cuenta[r] as number) / planes.length;
        expect(f, `puesto ${r} al ${q * 100}%`).toBeGreaterThan(0.092);
        expect(f, `puesto ${r} al ${q * 100}%`).toBeLessThan(0.158);
      }
      // Y todos juntos: ninguna diferencia con el reparto parejo a 1 en 1000 (chi cuadrado, 7 grados de libertad).
      expect(chi2(cuenta.slice(1), planes.length), `al ${q * 100}%`).toBeLessThan(CRITICO_7);
    }
  });

  it("a la mitad, la ganadora va atrás (5.º a 8.º) y adelante (1.º a 4.º) mitad y mitad", () => {
    // Hasta el 26 de octubre iba atrás en 43 de cada 100 y el 1.º salía 1,3 veces lo que toca:
    // quien iba primera a la mitad ganaba más que una de cada ocho (auditor de delatores, 1.500 rondas).
    const atras = planes.filter((p) => puesto(p, p.story.winner, 0.5) >= 5).length / planes.length;
    expect(atras).toBeGreaterThan(0.46);
    expect(atras).toBeLessThan(0.54);
  });

  it("el puesto que se sortea es el que se ve, en los cinco puntos de control", () => {
    for (const p of planes) {
      expect(p.puestos.map((x) => x.q).sort()).toEqual([0.067, 0.25, 0.5, 0.75, 0.9]);
      for (const { q, r } of p.puestos) expect(puesto(p, p.story.winner, q), `al ${q * 100}% (${p.story.arc})`).toBe(r);
    }
  });

  it("nadie corre en el mismo punto que otra (el empate lo rompe el carril): la ganadora puede ser cualquier puesto", () => {
    for (const p of planes.slice(0, 300)) {
      for (const q of [0.067, 0.25, 0.5, 0.75, 0.9]) {
        const xs = p.lanes.map((_, j) => p.pos(j, q));
        expect(new Set(xs).size, `al ${q * 100}%`).toBe(xs.length);
      }
    }
  });

  it("en el susto, la ganadora tropieza antes y después de la mitad, mitad y mitad, entre el 38 % y el 66 %", () => {
    const sustos = planes.filter((p) => p.story.arc === "susto");
    expect(sustos.length).toBeGreaterThan(300);
    const antes = sustos.filter((p) => (p.story.beats.find((b) => b.kind === "tropiezo" && b.actor === p.story.winner) as { at: number }).at < 0.5).length / sustos.length;
    expect(antes).toBeGreaterThan(0.42);
    expect(antes).toBeLessThan(0.58);
    for (const p of sustos) {
      const at = (p.story.beats.find((b) => b.kind === "tropiezo" && b.actor === p.story.winner) as { at: number }).at;
      expect(at).toBeGreaterThanOrEqual(0.38);
      expect(at).toBeLessThanOrEqual(0.66);
      expect(p.story.beats.map((b) => b.at)).toEqual(p.story.beats.map((b) => b.at).sort((x, y) => x - y));
    }
  });

  it("en la recta final, la ganadora va primera o segunda, mitad y mitad", () => {
    let primera = 0, segunda = 0;
    for (const p of planes) {
      const r = puesto(p, p.story.winner, 0.9);
      if (r === 1) primera++;
      else if (r === 2) segunda++;
    }
    expect(primera + segunda).toBeGreaterThan(planes.length * 0.97);
    expect(primera / (primera + segunda)).toBeGreaterThan(0.44);
    expect(primera / (primera + segunda)).toBeLessThan(0.56);
  });

  it("en el duelo la rival va pegada, arriba o abajo mitad y mitad", () => {
    const duelos = planes.filter((p) => p.story.arc === "duelo");
    expect(duelos.length).toBeGreaterThan(300);
    const arriba = duelos.filter((p) => p.story.rival === p.story.winner - 1).length;
    const abajo = duelos.filter((p) => p.story.rival === p.story.winner + 1).length;
    expect(arriba + abajo).toBe(duelos.length);
    expect(arriba / duelos.length).toBeGreaterThan(0.42);
    expect(arriba / duelos.length).toBeLessThan(0.58);
  });

  it("en la remontada viene otra de atrás, que no gana", () => {
    const rem = planes.filter((p) => p.story.arc === "remontada");
    expect(rem.length).toBeGreaterThan(300);
    for (const p of rem) {
      expect(p.decoy).toBeGreaterThanOrEqual(0);
      expect(p.decoy).not.toBe(p.story.winner);
      expect(p.decoy).not.toBe(p.story.rival);
      // Viene de atrás: en la segunda mitad de atrás al 62%, y adelante al 90%.
      expect(puesto(p, p.decoy, 0.62)).toBeGreaterThan(3);
      expect(puesto(p, p.decoy, 0.9)).toBeLessThan(puesto(p, p.decoy, 0.62));
    }
    for (const p of planes.filter((x) => x.story.arc !== "remontada")) expect(p.decoy).toBe(-1);
  });

  it("la tribuna grita por cualquiera: por la ganadora, una de cada ocho veces", () => {
    const f = planes.filter((p) => p.hinchada === p.story.winner).length / planes.length;
    expect(f).toBeGreaterThan(0.09);
    expect(f).toBeLessThan(0.16);
  });

  it("en la remontada la cámara va a una de las dos que vienen de atrás, mitad y mitad", () => {
    const rem = planes.filter((p) => p.story.arc === "remontada");
    for (const p of rem) expect([p.decoy, p.story.winner]).toContain(p.foco);
    const f = rem.filter((p) => p.foco === p.story.winner).length / rem.length;
    expect(f).toBeGreaterThan(0.4);
    expect(f).toBeLessThan(0.6);
  });

  it("con pocas personas también llega la ganadora", () => {
    for (const n of [2, 3, 4, 5]) {
      for (const p of muchas(n, 200)) {
        const w = p.story.winner;
        for (let k = 0; k < p.lanes.length; k++) if (k !== w) expect(p.pos(k, 1)).toBeLessThan(p.pos(w, 1));
      }
    }
  });

  it("la misma ronda da el mismo plan", () => {
    const a = planRace(NAMES, 3, rngOf(42)), b = planRace(NAMES, 3, rngOf(42));
    expect(a.lanes).toEqual(b.lanes);
    for (const q of [0.1, 0.33, 0.5, 0.77, 0.9, 1]) for (let k = 0; k < 8; k++) expect(a.pos(k, q)).toBe(b.pos(k, q));
  });
});
