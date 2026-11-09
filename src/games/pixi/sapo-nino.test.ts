import { describe, expect, it } from "vitest";
import { problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { planQualifier } from "./qualifier";
import { SAPO_MAX, optsForArc, planThrows, type ArcName } from "./sapo-plan";
import { FORMA_SAPO, SENTIDO_SAPO, respuestasSapo, type PlanDelSapo } from "./sapo-nino";
import { Q_FLY, Q_SHOW, Q_WAVE, tiemposDeTiros } from "./sapo-tiempos";
import { assignSlots } from "./slots";

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

const GOLPE = 0.7;

/** El plan del sapo armado como lo arma `sapo.ts`: clasificatoria, agujeros, tiros y horas. */
function sapo(n: number, premios: number, semilla: number, arco: ArcName): { plan: PlanDelSapo; ganadores: number[]; ganador: number } {
  const rng = azar(semilla);
  // Los premios salen de la lista, repartidos; se tiran del último al primero.
  const ganadores = Array.from({ length: premios }, (_, k) => Math.floor(((k * 2 + 1) * n) / (premios * 2)) % n);
  const prizesAll = [...ganadores].reverse();
  const Q = planQualifier(n, prizesAll, SAPO_MAX, rng);
  const fin = Q.finalists;
  const asig = assignSlots(fin.length, Q.finalWinners, rng);
  const throws = planThrows(fin.length, asig.winnerSlots, rng, optsForArc(arco), true);
  const tFly = Q_SHOW + Q.waves.length * Q_WAVE;
  const linea = tiemposDeTiros(throws, Q.finalWinners.length - 1, tFly + Q_FLY);
  const whoAt = (s: number): number => fin[asig.nameAt[s] as number] as number;
  const plan: PlanDelSapo = {
    n,
    oleadas: Q.waves.map((w, wi) => w.map((persona, j) => ({ persona, at: Q_SHOW + wi * Q_WAVE + 0.1 + (j / Math.max(1, w.length)) * 0.45 }))),
    tFly,
    tiros: throws.map((th, i) => ({
      land: (linea.tiros[i] as { land: number }).land,
      kind: th.kind,
      final: (linea.tiros[i] as { final: boolean }).final,
      ...(th.kind === "hit" ? { persona: whoAt(asig.winnerSlots[th.turn] as number) } : {}),
      ...(th.kind === "near" && th.rimSlot !== undefined ? { borde: whoAt(th.rimSlot) } : {}),
    })),
    duracion: linea.corona + GOLPE,
  };
  return { plan, ganadores, ganador: ganadores[0] as number };
}

const comoPlan = (p: PlanDelSapo): PlanDeRespuestas => ({ duracion: p.duracion, sentido: SENTIDO_SAPO, respuestas: (t) => respuestasSapo(p, t) });
const ARCOS: ArcName[] = ["remontada", "susto", "duelo", "tapada"];

describe("las respuestas del sapo", () => {
  it("la forma es de pie", () => {
    expect(FORMA_SAPO).toBe("de-pie");
  });

  it("cumplen la prueba del plan con 2, 8, 12, 18, 60 y 200 personas, con uno y con tres premios, en los cuatro arcos", () => {
    for (const n of [2, 8, 12, 18, 60, 200]) {
      for (const premios of [1, 3].filter((p) => p <= Math.min(n, SAPO_MAX))) {
        for (const arco of ARCOS) {
          for (let semilla = 1; semilla <= 4; semilla++) {
            const { plan, ganadores } = sapo(n, premios, semilla * 7919 + n, arco);
            expect(problemasDeRespuestas(comoPlan(plan), { n, ganadores, paso: 0.05 }), `n=${n} premios=${premios} arco=${arco} semilla=${semilla}`).toEqual([]);
          }
        }
      }
    }
  });

  it("al 25 %, al 60 % y con el cartel: quienes siguen, el progreso que solo sube y quién gana", () => {
    for (const n of [8, 18, 60]) {
      for (let semilla = 1; semilla <= 6; semilla++) {
        const { plan, ganador } = sapo(n, 1, semilla, ARCOS[semilla % 4] as ArcName);
        const r25 = respuestasSapo(plan, 0.25 * plan.duracion);
        const r60 = respuestasSapo(plan, 0.6 * plan.duracion);
        const fin = respuestasSapo(plan, plan.duracion + 1);
        // Con un premio nadie tiene medalla: siguen los que no se tacharon, y la ganadora está entre ellos.
        expect(r25.adelante.quienes.length).toBeGreaterThanOrEqual(2);
        expect(r25.adelante.quienes).toContain(ganador);
        expect(r60.adelante.quienes).toContain(ganador);
        // Los que siguen al 60 % son los de la mesa (a lo sumo doce), y son los mismos o menos que al 25 %.
        expect(r60.adelante.quienes.length).toBeLessThanOrEqual(Math.min(n, SAPO_MAX));
        for (const q of r60.adelante.quienes) expect(r25.adelante.quienes).toContain(q);
        expect(r25.progreso).toBeLessThan(r60.progreso);
        expect(r60.progreso).toBeLessThan(fin.progreso);
        expect(r25.progreso).toBeCloseTo(0.25, 5);
        expect(fin.progreso).toBe(1);
        // Antes del cartel nadie gana; con el cartel, quien fijó el plan.
        expect(r25.paso.tipo).not.toBe("gano");
        expect(r60.paso.tipo).not.toBe("gano");
        expect(fin.adelante.quienes).toEqual([ganador]);
        expect(fin.paso).toMatchObject({ tipo: "gano", quien: ganador });
      }
    }
  });

  it("antes del cartel, ningún cuadro dice «gano»", () => {
    const { plan } = sapo(18, 3, 5, "remontada");
    for (let t = 0; t < plan.duracion - 1e-6; t += 0.05) expect(respuestasSapo(plan, t).paso.tipo).not.toBe("gano");
  });

  it("la clasificatoria tacha de a una oleada: salen de a uno y los que siguen se achican hasta los de la mesa", () => {
    const { plan } = sapo(60, 1, 3, "duelo");
    const antes = respuestasSapo(plan, 0.5);
    expect(antes.adelante.quienes).toHaveLength(60);
    expect(antes.paso).toEqual({ tipo: "empezo", desde: 0 });
    const primera = respuestasSapo(plan, Q_SHOW + 0.5);
    expect(primera.paso.tipo).toBe("salio");
    expect(primera.adelante.quienes.length).toBeLessThan(60);
    const mesa = respuestasSapo(plan, plan.tFly + 0.1);
    expect(mesa.adelante.quienes).toHaveLength(SAPO_MAX);
    expect(mesa.paso).toEqual({ tipo: "empezo", desde: plan.tFly });
  });

  it("con tres premios, quien ya tiene su medalla deja de seguir y el último premio se queda solo con el cartel", () => {
    const { plan, ganadores, ganador } = sapo(12, 3, 9, "remontada");
    const hits = plan.tiros.filter((t) => t.kind === "hit");
    expect(hits).toHaveLength(3);
    const primero = hits[0] as (typeof hits)[number];
    const antes = respuestasSapo(plan, primero.land - 0.1).adelante.quienes;
    const despues = respuestasSapo(plan, primero.land + 1).adelante.quienes;
    expect(antes).toContain(primero.persona);
    expect(despues).not.toContain(primero.persona);
    expect(despues).toHaveLength(antes.length - 1);
    expect(respuestasSapo(plan, primero.land + 0.1).paso).toMatchObject({ tipo: "adelante", quien: primero.persona });
    expect(new Set(hits.map((h) => h.persona))).toEqual(new Set(ganadores));
    expect(respuestasSapo(plan, plan.duracion).adelante.quienes).toEqual([ganador]);
  });

  it("una argolla que baila en el borde es un «casi» con el nombre de ese agujero, y a los tres segundos ya es nada", () => {
    // La tapada trae un solo «casi», así que nada lo pisa en los tres segundos que siguen.
    const { plan } = sapo(12, 1, 2, "tapada");
    const casi = plan.tiros.find((t) => t.kind === "near");
    expect(casi).toBeDefined();
    const c = casi as (typeof plan.tiros)[number];
    expect(respuestasSapo(plan, c.land + 0.3).paso).toEqual({ tipo: "casi", quien: c.borde, desde: c.land });
    expect(respuestasSapo(plan, c.land + 3.5).paso.tipo).not.toBe("casi");
  });
});
