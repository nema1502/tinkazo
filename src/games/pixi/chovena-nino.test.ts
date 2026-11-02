import { describe, expect, it } from "vitest";
import { problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { FORMA_CHOVENA, SENTIDO_CHOVENA, respuestasChovena, type PlanDeLaChovena } from "./chovena-nino";

const T_INTRO = 2.6;
const FREEZE = 0.22;
const WOBBLE = 0.62;
const EXIT = 0.65;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/**
 * El plan de la chovena con la forma de `chovena.ts`: cortes de la música, cada
 * uno suelta a un grupo a la vez (más al principio), uno trastabilla y aguanta, y
 * en la final sale la rival. `premios` son los que ganan algo; gana el primero.
 */
function chovena(n: number, premios: number, semilla: number): { plan: PlanDeLaChovena; ganadores: number[] } {
  const ganadores = Array.from({ length: premios }, (_, k) => (semilla + k * 3) % n);
  const ganador = ganadores[0] as number;
  const rival = n >= 2 ? (ganadores[1] ?? (ganador + 1) % n) : -1;
  const resto = Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador && i !== rival);
  const R = Math.min(n <= 2 ? 0 : n === 3 ? 1 : n <= 12 ? 2 : n <= 40 ? 3 : n <= 90 ? 4 : 5, resto.length);
  const shares = Array.from({ length: R }, (_, c) => Math.pow(R - c, 1.4));
  let dado = 0;
  const salidas: PlanDeLaChovena["salidas"][number][] = [];
  const hechos: PlanDeLaChovena["hechos"][number][] = [{ desde: 0, tipo: "empezo" }, { desde: T_INTRO, tipo: "empezo" }];
  let tt = T_INTRO;
  for (let c = 0; c < R; c++) {
    const quedan = resto.length - dado;
    const resta = shares.slice(c).reduce((a, b) => a + b, 0);
    const quiere = clamp(c === R - 1 ? quedan : Math.round(((shares[c] as number) / resta) * quedan), 1, quedan - (R - 1 - c));
    const dance = clamp(2.55 - 0.14 * c, 1.75, 2.55);
    const w0 = tt + dance + FREEZE;
    const x0 = w0 + WOBBLE;
    const victimas = resto.slice(dado, dado + quiere);
    dado += quiere;
    // Todos los de un corte se sueltan a la vez.
    for (const v of victimas) salidas.push({ persona: v, at: x0 });
    // Uno que trastabilla y aguanta: de los que siguen.
    const sigue = resto[resto.length - 1 - c] as number;
    if (sigue !== undefined && !victimas.includes(sigue)) hechos.push({ desde: w0, tipo: "casi", quien: sigue });
    tt = x0 + EXIT;
  }
  const FX0 = tt + 0.9 + 2.3 + 0.22 + 0.05 + 0.95;
  if (rival >= 0) salidas.push({ persona: rival, at: FX0 });
  const golpe = FX0 + 0.6 + 0.7;
  return { plan: { n, salidas, hechos, ganador, duracion: golpe }, ganadores };
}

const comoPlan = (p: PlanDeLaChovena): PlanDeRespuestas => ({ duracion: p.duracion, sentido: SENTIDO_CHOVENA, respuestas: (t) => respuestasChovena(p, t) });

describe("las respuestas de la chovena", () => {
  it("la forma es de pie", () => {
    expect(FORMA_CHOVENA).toBe("de-pie");
  });

  it("cumplen la prueba del plan con 2, 3, 8, 18, 60 y 200 personas, con uno y con tres premios", () => {
    for (const n of [2, 3, 8, 18, 60, 200]) {
      for (const premios of [1, 3].filter((p) => p <= n)) {
        for (let semilla = 1; semilla <= 4; semilla++) {
          const { plan, ganadores } = chovena(n, premios, semilla * 11 + n);
          expect(problemasDeRespuestas(comoPlan(plan), { n, ganadores, paso: 0.05 }), `n=${n} premios=${premios} semilla=${semilla}`).toEqual([]);
        }
      }
    }
  });

  it("al 25 %, al 60 % y con el cartel: quienes siguen, el progreso que solo sube y quién gana", () => {
    for (const n of [8, 18, 60]) {
      for (let semilla = 1; semilla <= 6; semilla++) {
        const { plan } = chovena(n, 1, semilla);
        const r25 = respuestasChovena(plan, 0.25 * plan.duracion);
        const r60 = respuestasChovena(plan, 0.6 * plan.duracion);
        const fin = respuestasChovena(plan, plan.duracion + 1);
        expect(r25.adelante.quienes).toContain(plan.ganador);
        expect(r60.adelante.quienes).toContain(plan.ganador);
        for (const q of r60.adelante.quienes) expect(r25.adelante.quienes).toContain(q);
        expect(r60.adelante.quienes.length).toBeLessThanOrEqual(r25.adelante.quienes.length);
        expect(r25.progreso).toBeCloseTo(0.25, 5);
        expect(r60.progreso).toBeCloseTo(0.6, 5);
        expect(fin.progreso).toBe(1);
        expect(r25.paso.tipo).not.toBe("gano");
        expect(r60.paso.tipo).not.toBe("gano");
        expect(fin.adelante.quienes).toEqual([plan.ganador]);
        expect(fin.paso).toMatchObject({ tipo: "gano", quien: plan.ganador });
      }
    }
  });

  it("en un corte salen varios a la vez: un solo hecho, con el primero, y los que siguen se achican de golpe", () => {
    const { plan } = chovena(18, 1, 5);
    const corte = plan.salidas.filter((s) => s.at === (plan.salidas[0] as { at: number }).at);
    expect(corte.length).toBeGreaterThan(1);
    const at = corte[0]!.at;
    expect(respuestasChovena(plan, at - 0.01).adelante.quienes).toHaveLength(18);
    expect(respuestasChovena(plan, at + 0.01).adelante.quienes).toHaveLength(18 - corte.length);
    expect(respuestasChovena(plan, at + 0.3).paso).toMatchObject({ tipo: "salio", desde: at });
    for (const s of corte) expect(respuestasChovena(plan, at + 0.3).adelante.quienes).not.toContain(s.persona);
  });

  it("quien trastabilla y aguanta es un «casi» con su nombre, y sigue en la rueda", () => {
    const { plan } = chovena(18, 1, 5);
    const casi = plan.hechos.find((h) => h.tipo === "casi");
    expect(casi).toBeDefined();
    const c = casi as { desde: number; quien: number };
    expect(respuestasChovena(plan, c.desde + 0.3).paso).toEqual({ tipo: "casi", quien: c.quien, desde: c.desde });
    expect(respuestasChovena(plan, c.desde + 0.3).adelante.quienes).toContain(c.quien);
  });
});
