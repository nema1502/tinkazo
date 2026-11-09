import { describe, expect, it } from "vitest";
import { SALIDAS_APARTE, problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { FORMA_TROMPO, SENTIDO_TROMPO, respuestasTrompo, type PlanDelTrompo } from "./trompo-nino";

const T_THROW = 2.2;
const T_FIGHT = 4.6;
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
type Arco = "susto" | "remontada" | "duelo" | "tapada";

/**
 * El plan del trompo con las mismas horas que arma `trompo.ts`: la ganadora primera,
 * la rival segunda, el resto saliendo en una gresca que se achica, el mano a mano
 * con sus choques y la rival que se apaga 0,7 s después del último.
 */
function trompo(n: number, arco: Arco, semilla: number): { plan: PlanDelTrompo; rival: number } {
  const ganador = semilla % n;
  const rival = n >= 2 ? (ganador + 1 + (semilla % Math.max(1, n - 1))) % n : ganador;
  const rival2 = rival === ganador ? (ganador + 1) % n : rival;
  const resto = Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador && i !== rival2);
  const fight0 = n === 2 ? T_THROW : T_FIGHT;
  const fightDur = n === 2 ? 0 : clamp(2.6 + Math.max(0, n - 2) * 0.32, 2.6, 7.8);
  const tDuel = fight0 + fightDur;
  const clashes = n === 2 ? (arco === "duelo" ? [2.5, 4.9, 7.3, 9.7] : [2.5, 4.9, 7.3]) : arco === "duelo" ? [0.7, 1.7, 2.7, 3.7] : [0.8, 1.9, 3.0];
  const duelDur = (clashes.at(-1) as number) + 1.6;
  const victims = [...resto].reverse();
  const salidas = victims.map((v, i) => ({ persona: v, at: fight0 + 0.3 + (fightDur - 0.7) * Math.pow((i + 1) / (victims.length + 1), 0.8) }));
  const duo = n >= 2 && rival2 !== ganador;
  if (duo) salidas.push({ persona: rival2, at: tDuel + (clashes.at(-1) as number) + 0.7 });
  const hechos: PlanDelTrompo["hechos"][number][] = [{ desde: 0, tipo: "empezo" }, { desde: tDuel, tipo: "empezo" }];
  if (n > 2) hechos.push({ desde: T_FIGHT, tipo: "empezo" });
  // Un casi en cada embestida menos la última, de uno de los dos.
  if (duo) clashes.slice(0, -1).forEach((c, i) => hechos.push({ desde: tDuel + c, tipo: "casi", quien: i % 2 ? ganador : rival2 }));
  if (arco === "remontada" && duo && n > 2) hechos.push({ desde: fight0 + fightDur * 0.45, tipo: "casi", quien: resto[0] as number });
  return { plan: { n, salidas, hechos, ganador, duracion: tDuel + duelDur }, rival: rival2 };
}

const comoPlan = (p: PlanDelTrompo): PlanDeRespuestas => ({ duracion: p.duracion, sentido: SENTIDO_TROMPO, respuestas: (t) => respuestasTrompo(p, t) });
const ARCOS: Arco[] = ["susto", "remontada", "duelo", "tapada"];

describe("las respuestas del trompo", () => {
  it("la forma es de pie", () => {
    expect(FORMA_TROMPO).toBe("de-pie");
  });

  it("cumplen la prueba del plan con 2, 3, 8, 18, 60 y 200 personas en los cuatro arcos", () => {
    for (const n of [2, 3, 8, 18, 60, 200]) {
      for (const arco of ARCOS) {
        for (let semilla = 1; semilla <= 4; semilla++) {
          const { plan } = trompo(n, arco, semilla * 31 + n);
          expect(problemasDeRespuestas(comoPlan(plan), { n, ganadores: [plan.ganador], paso: 0.05 }), `n=${n} arco=${arco} semilla=${semilla}`).toEqual([]);
        }
      }
    }
  });

  it("al 25 %, al 60 % y con el cartel: quienes siguen, el progreso que solo sube y quién gana", () => {
    for (const n of [8, 18, 60]) {
      for (let semilla = 1; semilla <= 6; semilla++) {
        const { plan } = trompo(n, ARCOS[semilla % 4] as Arco, semilla);
        const r25 = respuestasTrompo(plan, 0.25 * plan.duracion);
        const r60 = respuestasTrompo(plan, 0.6 * plan.duracion);
        const fin = respuestasTrompo(plan, plan.duracion + 1);
        // Nadie que ya salió vuelve, y la ganadora siempre sigue.
        expect(r25.adelante.quienes).toContain(plan.ganador);
        expect(r60.adelante.quienes).toContain(plan.ganador);
        for (const q of r60.adelante.quienes) expect(r25.adelante.quienes).toContain(q);
        expect(r60.adelante.quienes.length).toBeLessThan(r25.adelante.quienes.length);
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

  it("empieza con todos y cada salida achica a los que siguen en uno", () => {
    const { plan } = trompo(18, "duelo", 7);
    expect(respuestasTrompo(plan, 0.1).adelante.quienes).toHaveLength(18);
    expect(respuestasTrompo(plan, 0.1).paso).toEqual({ tipo: "empezo", desde: 0 });
    const orden = [...plan.salidas].sort((a, b) => a.at - b.at);
    orden.forEach((s, i) => {
      expect(respuestasTrompo(plan, s.at - 0.01).adelante.quienes).toHaveLength(18 - i);
      expect(respuestasTrompo(plan, s.at + 0.01).adelante.quienes).not.toContain(s.persona);
    });
    // Antes del cartel solo queda quien gana, con la rival ya acostada.
    expect(respuestasTrompo(plan, plan.duracion - 0.1).adelante.quienes).toEqual([plan.ganador]);
  });

  it("varias salidas en menos de un segundo son una sola tanda, con el primero que salió", () => {
    const plan: PlanDelTrompo = {
      n: 6,
      salidas: [{ persona: 3, at: 5 }, { persona: 4, at: 5.4 }, { persona: 2, at: 5.9 }, { persona: 1, at: 7 }],
      hechos: [{ desde: 0, tipo: "empezo" }],
      ganador: 0,
      duracion: 12,
    };
    expect(respuestasTrompo(plan, 5.5).paso).toEqual({ tipo: "salio", quien: 3, desde: 5 });
    expect(respuestasTrompo(plan, 6.5).paso).toEqual({ tipo: "salio", quien: 3, desde: 5 });
    expect(respuestasTrompo(plan, 7.2).paso).toEqual({ tipo: "salio", quien: 1, desde: 7 });
    expect(7 - 5).toBeGreaterThanOrEqual(SALIDAS_APARTE);
    expect(respuestasTrompo(plan, 5.95).adelante.quienes).toEqual([0, 1, 5]);
  });

  it("lo que pasó hace más de tres segundos ya es «nada»", () => {
    const plan: PlanDelTrompo = { n: 4, salidas: [{ persona: 2, at: 5 }, { persona: 1, at: 11 }], hechos: [{ desde: 0, tipo: "empezo" }], ganador: 0, duracion: 14 };
    expect(respuestasTrompo(plan, 7).paso).toEqual({ tipo: "salio", quien: 2, desde: 5 });
    expect(respuestasTrompo(plan, 8.2).paso).toEqual({ tipo: "nada", desde: 5 });
  });
});
