import { describe, expect, it } from "vitest";
import { gajoDe, repartir } from "../wheel-layout";
import { problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { FALSA, T_CROWN, T_HOLD, T_LOCK, T_WIND } from "./wheel-beats";
import { planWheelMotion } from "./wheel-motion";
import { SENTIDO_RULETA, respuestasRuleta, type PlanDeLaRuleta } from "./wheel-nino";

const SEGS = 24;

/** Un azar sembrado (mulberry32). */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El plan de la rueda armado como lo arma `wheel.ts`, para `n` personas y esta semilla. */
function ruleta(n: number, semilla: number, falsa: boolean): PlanDeLaRuleta {
  const rng = azar(semilla);
  const ganador = Math.floor(rng() * n);
  const grupos = n > SEGS ? repartir(n) : null;
  const rep = n <= 12 ? Math.max(1, Math.round(SEGS / n)) : 1;
  const segs = grupos ? SEGS : n * rep;
  const startSeg = rng() * segs;
  const winSeg = grupos ? gajoDe(grupos, ganador) : ganador + n * Math.floor(rng() * rep);
  const landing = winSeg + 0.5 + (rng() - 0.5) * 0.6;
  const mov = planWheelMotion({ segs, ciclo: grupos ? segs : n, startSeg, landing, falsa, rng });
  return { n, segs, grupos, startSeg, mov, ganador, falsa };
}

const comoPlan = (p: PlanDeLaRuleta): PlanDeRespuestas => ({ duracion: T_CROWN, sentido: SENTIDO_RULETA, respuestas: (t) => respuestasRuleta(p, t) });

describe("las respuestas de la ruleta", () => {
  it("cumplen la prueba del plan con 2, 5, 18, 24 y 60 personas, con y sin parada falsa", () => {
    for (const n of [2, 5, 18, 24, 60]) {
      for (const falsa of [false, true]) {
        for (let semilla = 1; semilla <= 6; semilla++) {
          const p = ruleta(n, semilla * 7919 + n, falsa);
          expect(problemasDeRespuestas(comoPlan(p), { n, ganadores: [p.ganador], paso: 0.05 }), `n=${n} falsa=${falsa} semilla=${semilla}`).toEqual([]);
        }
      }
    }
  });

  it("empieza quieta, el progreso solo sube y con el cartel gana quien gana", () => {
    const p = ruleta(18, 3, false);
    expect(respuestasRuleta(p, 0).paso).toEqual({ tipo: "empezo", desde: 0 });
    expect(respuestasRuleta(p, 0).progreso).toBe(0);
    expect(respuestasRuleta(p, T_CROWN / 2).progreso).toBeCloseTo(0.5, 5);
    const fin = respuestasRuleta(p, T_CROWN + 1);
    expect(fin.progreso).toBe(1);
    expect(fin.adelante.quienes).toEqual([p.ganador]);
    expect(fin.paso).toMatchObject({ tipo: "gano", quien: p.ganador });
  });

  it("al trabarse, la flecha ya está sobre la ganadora y se frena", () => {
    for (let semilla = 1; semilla <= 8; semilla++) {
      const p = ruleta(18, semilla, semilla % 2 === 0);
      const r = respuestasRuleta(p, (T_LOCK + T_CROWN) / 2);
      expect(r.adelante.quienes).toContain(p.ganador);
      expect(r.paso).toMatchObject({ tipo: "freno", quien: p.ganador });
    }
  });

  it("girando, quien está bajo la flecha es una sola persona (o dos si está en el borde)", () => {
    const p = ruleta(18, 11, false);
    for (let t = T_WIND + 0.2; t < T_LOCK; t += 0.37) {
      const q = respuestasRuleta(p, t).adelante.quienes;
      expect(q.length).toBeGreaterThanOrEqual(1);
      expect(q.length).toBeLessThanOrEqual(2);
    }
  });

  it("en la parada falsa el último hecho es el amague, con el nombre del señuelo", () => {
    const p = ruleta(18, 5, true);
    const r = respuestasRuleta(p, T_HOLD + FALSA / 2);
    expect(r.paso.tipo).toBe("casi");
    expect(r.paso.quien).toBeGreaterThanOrEqual(0);
    expect(r.paso.desde).toBe(T_HOLD);
  });

  it("con más de veinticuatro personas, adelante es el grupo del gajo", () => {
    const p = ruleta(60, 9, false);
    const r = respuestasRuleta(p, 5);
    expect(r.adelante.quienes.length).toBeGreaterThan(1);
    expect(new Set(r.adelante.quienes).size).toBe(r.adelante.quienes.length);
  });

  it("gira alrededor de principio a fin, y la flecha está arriba de la rueda", () => {
    const p = ruleta(18, 2, false);
    for (const t of [0, 3, 9, 16, 19]) {
      const r = respuestasRuleta(p, t);
      expect(r.hacia).toBe("alrededor");
      expect(r.adelante.lugar).toBe("arriba");
    }
  });

  it("lo que acaba de pasar es de hace tres segundos o menos: empezó a girar y después nada nuevo", () => {
    const p = ruleta(18, 4, false);
    expect(respuestasRuleta(p, T_WIND + 1).paso).toEqual({ tipo: "empezo", desde: T_WIND });
    expect(respuestasRuleta(p, T_WIND + 3.5).paso).toEqual({ tipo: "nada", desde: T_WIND });
    expect(respuestasRuleta(p, 10).paso.tipo).toBe("nada");
  });
});
