import { describe, expect, it } from "vitest";
import { problemasDeRespuestas, type PlanDeRespuestas } from "../pixi/kit/respuestas";
import { planPeloton } from "./peloton-plan";
import { planRace } from "./plan";
import { duracionDeLaCarrera, horaDeLaCarrera, respuestasCarrera, type PlanDeLaCarrera, type RelojDeLaCarrera } from "./race-nino";

/** Los tiempos de `pixi-race.ts` que el plan de la prueba necesita. */
const DUR = 15;
const P_LANE = 0.5;
const P_TAIL = 0.7;

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

/** La carrera de hoy, armada como la arma `pixi-race.ts`, para `n` personas. */
function carrera(n: number, semilla: number, ganador = 3): PlanDeLaCarrera {
  const names = Array.from({ length: n }, (_, i) => `Persona ${i}`);
  const plan = planRace(names, ganador, azar(semilla));
  const peloton = n > 8 ? planPeloton(n, plan.lanes, azar(semilla + 1)) : null;
  const pre = (peloton ? peloton.fin : 0) + plan.lanes.length * P_LANE + P_TAIL;
  return { lanes: plan.lanes, ganador: plan.story.winner, pos: plan.pos, beats: plan.story.beats, pre, cuenta: 3, dur: DUR, peloton };
}

/** Los relojes del show a una hora dada de la prueba. */
function relojEn(p: PlanDeLaCarrera, t: number): RelojDeLaCarrera {
  if (t < p.pre) return { fase: "pre", tPre: t, tPhase: 0, tRace: 0, tFreeze: 0 };
  if (t < p.pre + p.cuenta) return { fase: "count", tPre: p.pre, tPhase: t - p.pre, tRace: 0, tFreeze: 0 };
  if (t < p.pre + p.cuenta + p.dur) return { fase: "race", tPre: p.pre, tPhase: 3, tRace: t - p.pre - p.cuenta, tFreeze: 0 };
  return { fase: "done", tPre: p.pre, tPhase: 3, tRace: p.dur, tFreeze: t - (p.pre + p.cuenta + p.dur) };
}

const comoPlan = (p: PlanDeLaCarrera): PlanDeRespuestas => ({ duracion: duracionDeLaCarrera(p), sentido: "derecha", respuestas: (t) => respuestasCarrera(p, relojEn(p, t)) });

describe("las respuestas de la carrera de hoy (el caso de control)", () => {
  it("la hora del show sigue a los relojes de las cuatro fases, sin saltos atrás", () => {
    const p = carrera(18, 4);
    let previa = -1;
    for (let t = 0; t < duracionDeLaCarrera(p) + 3; t += 0.1) {
      const h = horaDeLaCarrera(p, relojEn(p, t));
      expect(h).toBeCloseTo(t, 6);
      expect(h).toBeGreaterThanOrEqual(previa);
      previa = h;
    }
  });

  it("cumplen la prueba del plan salvo en lo que la carrera de hoy rompe a propósito: las echadas de a dos, a 0,3 s", () => {
    for (const n of [6, 8, 9, 18, 30]) {
      for (let semilla = 1; semilla <= 4; semilla++) {
        const p = carrera(n, semilla * 131 + n);
        const problemas = problemasDeRespuestas(comoPlan(p), { n, ganadores: [p.lanes[p.ganador] as number], paso: 0.25 });
        expect(problemas.filter((x) => !x.startsWith("dos salidas")), `n=${n} semilla=${semilla}`).toEqual([]);
      }
    }
  });

  it("con 18 personas la prueba del plan encuentra las dos salidas juntas: ninguna se ve (regla 6)", () => {
    const p = carrera(18, 77);
    const problemas = problemasDeRespuestas(comoPlan(p), { n: 18, ganadores: [p.lanes[p.ganador] as number], paso: 0.05 });
    expect(problemas.some((x) => x.startsWith("dos salidas"))).toBe(true);
  });

  it("en el pelotón adelante son los que siguen corriendo y se achican", () => {
    const p = carrera(18, 9);
    const pelo = p.peloton;
    expect(pelo).not.toBeNull();
    const al = (t: number) => respuestasCarrera(p, relojEn(p, t)).adelante.quienes.length;
    expect(al(0)).toBe(18);
    expect(al((pelo?.fin ?? 0) - 0.01)).toBe(8);
  });

  it("en la pista adelante es la primera y, con el cartel, la ganadora", () => {
    const p = carrera(8, 21);
    const enCarrera = respuestasCarrera(p, relojEn(p, p.pre + p.cuenta + DUR / 2));
    expect(enCarrera.adelante.quienes.length).toBeGreaterThanOrEqual(1);
    expect(enCarrera.hacia).toBe("derecha");
    const fin = respuestasCarrera(p, relojEn(p, duracionDeLaCarrera(p) + 1));
    expect(fin.adelante.quienes).toEqual([p.lanes[p.ganador]]);
    expect(fin.paso.tipo).toBe("gano");
    expect(fin.progreso).toBe(1);
  });

  it("sin pelotón (ocho o menos) no hay a quién echar: empieza la final", () => {
    const p = carrera(8, 5);
    expect(p.peloton).toBeNull();
    expect(respuestasCarrera(p, relojEn(p, 0.5)).paso.tipo).toBe("empezo");
  });
});
