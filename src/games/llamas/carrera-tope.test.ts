import { describe, expect, it } from "vitest";
import { CUERPO, TOPES, medirMarcha, type SerieLlama } from "./carrera-marcha";
import { medirShow } from "./carrera-marcha-datos";
import { ctxDe } from "./carrera-prueba";
import { planCarrera } from "./carrera-show";
import { ACEL_RECTA, conTopeDeAceleracion, limitarAceleracion } from "./carrera-tope";
import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import type { Plan as PlanFinal } from "./plan";

const aceleracionMax = (x: Float64Array, dt: number): number => {
  let m = 0;
  for (let i = 1; i < x.length - 1; i++) m = Math.max(m, Math.abs((x[i + 1] as number) - 2 * (x[i] as number) + (x[i - 1] as number)) / (dt * dt));
  return m;
};

describe("el tope de aceleración: la corrección", () => {
  const dt = 1 / 60;

  it("una curva que ya está dentro del tope queda exactamente igual", () => {
    const x = Float64Array.from({ length: 300 }, (_, i) => 0.4 * Math.sin(i * dt));
    const copia = Float64Array.from(x);
    expect(limitarAceleracion(x, dt, ACEL_RECTA)).toBe(0);
    expect(Array.from(x)).toEqual(Array.from(copia));
  });

  it("un frenazo de 1,6 se deja en el tope, los extremos no se mueven y la curva se mueve poco", () => {
    // Una velocidad que cae de 0,8 a cero en medio segundo (acel. de 1,6) y se queda quieta.
    const x = new Float64Array(300);
    for (let i = 0; i < 300; i++) {
      const t = i * dt;
      x[i] = t < 2 ? 0.8 * t : t < 2.5 ? 0.8 * 2 + 0.8 * (t - 2) - 0.8 * (t - 2) ** 2 : 0.8 * 2 + 0.2;
    }
    const antes = Float64Array.from(x);
    expect(aceleracionMax(x, dt)).toBeGreaterThan(1.5);
    const pasadas = limitarAceleracion(x, dt, ACEL_RECTA);
    expect(pasadas).toBeGreaterThan(0);
    expect(aceleracionMax(x, dt)).toBeLessThanOrEqual(ACEL_RECTA * (1 + 1e-6));
    expect(x[0]).toBe(antes[0]);
    expect(x[299]).toBe(antes[299]);
    let mayor = 0;
    for (let i = 0; i < 300; i++) mayor = Math.max(mayor, Math.abs((x[i] as number) - (antes[i] as number)));
    // Un exceso de unas décimas en medio segundo se reparte en un par de centésimas de cuerpo.
    expect(mayor).toBeLessThan(0.05);
  });

  it("dos aceleraciones que se suman en el mismo cuadro (una de 0,7 y otra de 0,6) quedan en el tope", () => {
    // Dos golpes suaves de aceleración de 0,8 s que se pisan: cada uno está dentro del tope, la suma llega a 1,3.
    const pulso = (u: number): number => (u > 0 && u < 1 ? Math.sin(Math.PI * u) ** 2 : 0);
    const x = new Float64Array(300);
    let v = 0;
    for (let i = 1; i < 300; i++) {
      const t = i * dt;
      v += (0.7 * pulso((t - 1) / 0.8) + 0.6 * pulso((t - 1.1) / 0.8)) * dt;
      x[i] = (x[i - 1] as number) + v * dt;
    }
    expect(aceleracionMax(x, dt)).toBeGreaterThan(1.2);
    limitarAceleracion(x, dt, ACEL_RECTA);
    expect(aceleracionMax(x, dt)).toBeLessThanOrEqual(ACEL_RECTA * (1 + 1e-6));
  });
});

describe("el tope de aceleración sobre el plan", () => {
  /** Un plan sintético de dos carriles: el primero lleva un frenazo de 1,6 y el segundo va parejo. */
  const sintetico = (): PlanFinal => {
    const foto = 2;
    const T = segundosDeQ(1, foto);
    const lugar = (k: number, tau: number): number => {
      if (k === 1) return -0.5 - 0.1 * tau;
      // Va a 0,8 cuerpos por segundo y a los 3 s frena en medio segundo hasta quedar quieta (aceleración de 1,6).
      const t = tau - 3;
      return t < 0 ? 0.8 * tau : t < 0.5 ? 2.4 + 0.8 * t - 0.8 * t * t : 2.6;
    };
    return {
      lanes: [0, 1], foto, pos: (k: number, q: number) => q + CUERPO * lugar(k, Math.min(T, segundosDeQ(q, foto))),
    } as unknown as PlanFinal;
  };

  it("deja el carril que pasaba del tope por debajo y el otro tal cual, y la llegada no se mueve", () => {
    const base = sintetico();
    const tope = conTopeDeAceleracion(base);
    expect(tope).not.toBe(base);
    const dt = 1 / 60;
    const medir = (plan: PlanFinal, k: number): { acel: number; fin: number } => {
      const N = 800;
      const x = Float64Array.from({ length: N }, (_, i) => { const q = qDeSegundos(i * dt, plan.foto); return (plan.pos(k, q) - q) / CUERPO; });
      return { acel: aceleracionMax(x, dt), fin: plan.pos(k, 1) };
    };
    expect(medir(base, 0).acel).toBeGreaterThan(1.3);
    expect(medir(tope, 0).acel).toBeLessThanOrEqual(TOPES.aceleracion);
    // El otro carril no se toca: ni un decimal.
    for (const q of [0, 0.1, 0.37, 0.8, 1]) expect(tope.pos(1, q)).toBe(base.pos(1, q));
    expect(tope.pos(0, 1)).toBe(base.pos(0, 1));
    expect(tope.pos(0, 0)).toBe(base.pos(0, 0));
    // Una curva que ya está dentro del tope devuelve el mismo plan.
    const quieta = { ...base, pos: (k: number, q: number) => q + CUERPO * -0.5 * k } as unknown as PlanFinal;
    expect(conTopeDeAceleracion(quieta)).toBe(quieta);
  });

  it("medido a otra fase del reloj, el carril corregido tampoco pasa del tope de la dirección", () => {
    const tope = conTopeDeAceleracion(sintetico());
    const dt = 1 / 60;
    for (const fase of [0, 0.25, 0.5, 0.75]) {
      const N = 700;
      const x = Float64Array.from({ length: N }, (_, i) => { const q = qDeSegundos((i + fase) * dt, tope.foto); return (tope.pos(0, q) - q) / CUERPO; });
      const serie: SerieLlama = { id: 0, x, corre: new Uint8Array(N).fill(1) };
      expect(medirMarcha([serie], 0, dt).acelMax, `fase ${fase}`).toBeLessThanOrEqual(TOPES.aceleracion * TOPES.tolerancia);
    }
  });
});

describe("el tope de aceleración en el show", () => {
  for (const n of [8, 18, 60, 200]) {
    it(`con ${n} personas, 40 semillas: la aceleración de la suma de las capas no pasa de 1,2 en ningún cuadro`, () => {
      for (let s = 1; s <= 40; s++) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const m = medirShow(d);
        expect(m.sinCausa.filter((e) => e.tipo === "aceleracion").map((e) => `${e.valor.toFixed(2)} a los ${(e.t - d.tSalida).toFixed(1)} s`), `n=${n} semilla ${s}`).toEqual([]);
        expect(m.acelMax, `n=${n} semilla ${s}`).toBeLessThanOrEqual(TOPES.aceleracion * TOPES.tolerancia);
      }
    });
  }
});
