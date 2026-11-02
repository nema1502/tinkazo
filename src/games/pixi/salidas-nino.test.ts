import { describe, expect, it } from "vitest";
import { SALIDAS_APARTE } from "./kit/respuestas";
import { VENTANA, quienesSiguen, respuestasDeSalidas, tandas, type PlanDeSalidas } from "./salidas-nino";

const plan: PlanDeSalidas = {
  n: 5,
  salidas: [
    { persona: 3, at: 2 },
    { persona: 1, at: 2.4 },
    { persona: 4, at: 5 },
  ],
  hechos: [{ desde: 0, tipo: "empezo" }],
  ganador: 0,
  duracion: 10,
};

describe("las respuestas de los juegos de salir de a poco", () => {
  it("las salidas a menos de un segundo de la primera son un solo hecho, con la primera que salió", () => {
    expect(tandas(plan.salidas)).toEqual([
      { desde: 2, tipo: "salio", quien: 3 },
      { desde: 5, tipo: "salio", quien: 4 },
    ]);
    const hs = tandas(plan.salidas);
    for (let i = 1; i < hs.length; i++) expect((hs[i]?.desde ?? 0) - (hs[i - 1]?.desde ?? 0)).toBeGreaterThanOrEqual(SALIDAS_APARTE);
  });

  it("siguen los que no salieron, y con el golpe, quien gana", () => {
    expect(quienesSiguen(plan, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(quienesSiguen(plan, 2.5)).toEqual([0, 2, 4]);
    expect(quienesSiguen(plan, 6)).toEqual([0, 2]);
    expect(quienesSiguen(plan, 10)).toEqual([0]);
  });

  it("lo último que pasó vence a los tres segundos y el cartel llega con el golpe", () => {
    expect(respuestasDeSalidas(plan, 0, "abajo").paso).toEqual({ tipo: "empezo", desde: 0 });
    expect(respuestasDeSalidas(plan, 2.2, "abajo").paso).toEqual({ tipo: "salio", quien: 3, desde: 2 });
    // Pasados los tres segundos de una salida y antes de la siguiente, nada nuevo.
    expect(respuestasDeSalidas({ ...plan, salidas: [{ persona: 3, at: 2 }] }, 2 + VENTANA + 0.1, "abajo").paso).toEqual({ tipo: "nada", desde: 2 });
    expect(respuestasDeSalidas(plan, 9.99, "abajo").paso.tipo).not.toBe("gano");
    expect(respuestasDeSalidas(plan, 11, "abajo")).toMatchObject({ progreso: 1, paso: { tipo: "gano", quien: 0, desde: 10 } });
  });
});
