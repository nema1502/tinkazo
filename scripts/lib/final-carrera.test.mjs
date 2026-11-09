import { describe, expect, it } from "vitest";
import { writeStory } from "../../src/games/drama";
import { TEXTOS_CARRERA } from "../../src/games/llamas/carrera-textos";
import { alfabetico, planCarrera } from "../../src/games/llamas/carrera-show";
import { azarDe, sembrar } from "../../src/games/pixi/kit/azar";
import { listHash } from "../../src/protocol/canonical";
import { select } from "../../src/protocol/select";
import { rondaDe } from "./delatores-carrera.mjs";
import { CUERPO, METAS_FINAL, cambiosEntre, dibujadoContraElPlan, evaluarFinal, mayorRemontadaEsDeLaGanadora, medirFinal, remontadasDelCuarto, resumirFinal, tablaFinal } from "./final-carrera.mjs";

const lib = { planCarrera, alfabetico, sembrar, azarDe, textos: TEXTOS_CARRERA, writeStory, select, listHash };

/**
 * Un plan inventado: cuatro carriles (personas 10 a 13), la recta de 10 a 20 s, la ganadora la 12 (carril 2).
 * La punta: la 10 hasta 12 s, la 11 hasta 15 s, la 13 hasta 18 s y la 12 desde ahí. Posiciones: lineales, con la ganadora
 * primera en la meta por 0,0115 (un cuerpo) sobre la segunda.
 */
function planInventado() {
  const lanes = [10, 11, 12, 13];
  const lider = (t) => (t < 12 ? 10 : t < 15 ? 11 : t < 18 ? 13 : 12);
  // En q = 0,75 la ganadora va 4.ª y a la meta 1.ª: gana 3 puestos. Las demás, entre sí.
  const pos = (j, q) => {
    if (q >= 1) return [0.95, 0.97, 0.985 + CUERPO * 0.0, 0.9][j] + (j === 2 ? CUERPO * 0.0 : 0);
    return [0.7, 0.72, 0.6, 0.71][j] * q;
  };
  return {
    arco: "remontada",
    datos: {
      lanes,
      campeona: 12,
      tAbre: 10,
      tCrown: 20,
      tramos: [{ t0: 0, t1: 5 }, { t0: 5, t1: 10 }],
      lider: (t) => (t < 0 ? -1 : lider(t)),
      final: { pos: (j, q) => (q >= 1 ? [0.95, 0.97, 0.9815, 0.9][j] : pos(j, q)) },
    },
  };
}

describe("cambios de punta", () => {
  it("cuenta cada cambio de quien va primera en el rato pedido", () => {
    const quien = (t) => (t < 12 ? 10 : t < 15 ? 11 : 12);
    expect(cambiosEntre(quien, 10, 20)).toBe(2);
    expect(cambiosEntre(quien, 10, 14)).toBe(1);
    expect(cambiosEntre(quien, 16, 20)).toBe(0);
  });

  it("no cuenta el paso por «nadie» (-1) como un cambio", () => {
    const quien = (t) => (t < 1 ? 5 : t < 2 ? -1 : 5);
    expect(cambiosEntre(quien, 0, 3)).toBe(0);
  });
});

describe("la mayor remontada del último cuarto", () => {
  it("los puestos que gana cada carril de 0,75 a la meta", () => {
    // Al 75 % el orden es el carril 0, 1, 2, 3; en la meta, el 2, 0, 1, 3: el 2 sube dos, el 0 y el 1 bajan uno y el 3 queda.
    const pos = (j, q) => (q >= 1 ? [0.8, 0.7, 0.9, 0.5][j] : [0.8, 0.7, 0.6, 0.5][j]);
    expect(remontadasDelCuarto(pos, 4)).toEqual([-1, -1, 2, 0]);
  });

  it("la mayor es de la ganadora si es suya sola; compartida vale la parte; sin remontada, nada", () => {
    expect(mayorRemontadaEsDeLaGanadora([-1, 0, 2, 0], 2)).toBe(1);
    expect(mayorRemontadaEsDeLaGanadora([2, 0, 2, 0], 2)).toBe(0.5);
    expect(mayorRemontadaEsDeLaGanadora([2, 0, 1, 0], 2)).toBe(0);
    expect(mayorRemontadaEsDeLaGanadora([0, 0, 0, 0], 2)).toBe(0);
  });
});

describe("medir una ronda", () => {
  const m = medirFinal(planInventado());

  it("quién va primera a 3, 1,5 y 0,5 s de la meta (T = 20)", () => {
    // 17 s: la 13; 18,5 s: la 12; 19,5 s: la 12.
    expect(m.primera[3]).toBe(false);
    expect(m.primera[1.5]).toBe(true);
    expect(m.primera[0.5]).toBe(true);
  });

  it("los segundos en punta antes de cruzar: desde la última vez que otra iba primera (18 s)", () => {
    expect(m.segundosPunta).toBeCloseTo(2, 1);
  });

  it("el tiempo en punta: la ganadora, de 18 a 20 s (2 de 10); las otras, 4 s, 3 s y 2 s (ya con la 13 en 3 s)", () => {
    expect(m.tiempoGanadora).toBeCloseTo(0.2, 1);
    expect(m.tiempoOtras).toBeCloseTo((0.2 + 0.3 + 0.3) / 3, 1);
    // Sin el último segundo la ganadora lleva 1 s de 9.
    expect(m.tiempoGanadoraSin1).toBeCloseTo(1 / 9, 1);
  });

  it("el margen en la meta, en cuerpos: de 0,9815 a 0,97", () => {
    expect(m.margen).toBeCloseTo((0.9815 - 0.97) / CUERPO, 5);
  });

  it("los cambios de punta de la recta antes del cabeza a cabeza (10 a 17 s: 10→11 a los 12... ) y los de cada terreno", () => {
    // De 10 a 17 s: la 11 toma a los 12 s y la 13 a los 15 s; la 12 toma a los 18 s, ya dentro de los últimos 3.
    expect(m.cambiosRecta).toBe(2);
    expect(m.cambiosFinal).toBe(1);
    expect(m.cambiosPorTramo).toEqual([0, 0]);
  });
});

describe("las metas", () => {
  const filas = Array.from({ length: 10 }, () => medirFinal(planInventado()));
  const r = resumirFinal(filas);

  it("resume las rondas", () => {
    expect(r.rondas).toBe(10);
    expect(r.primera15).toBe(1);
    expect(r.cambiosPorTramo).toBe(0);
    expect(r.arcos).toEqual({ remontada: 10 });
  });

  it("evalúa cada meta y dice cuál no cumple", () => {
    const ev = evaluarFinal(r);
    const por = Object.fromEntries(ev.map((e) => [e.clave, e]));
    expect(por.primera15.ok).toBe(false);
    expect(por.cambiosPorTramo.ok).toBe(false);
    expect(por.margenMaximo.ok).toBe(true);
    expect(ev.length).toBe(METAS_FINAL.length);
  });

  it("sin grupo (hasta 8 personas) no evalúa los cambios por terreno", () => {
    const sinGrupo = { ...r, cambiosPorTramo: null, tramosEnBanda: null, tramos: 0 };
    expect(evaluarFinal(sinGrupo).some((e) => e.clave === "cambiosPorTramo")).toBe(false);
  });

  it("los límites son los de la dirección: 40 % a 1,5 s, 1,25 veces, un tercio", () => {
    const m = (clave) => METAS_FINAL.find((x) => x.clave === clave);
    expect(m("primera15").ok(0.4)).toBe(true);
    expect(m("primera15").ok(0.41)).toBe(false);
    expect(m("tiempoVecesSin1").ok(1.25)).toBe(true);
    expect(m("tiempoVecesSin1").ok(1.26)).toBe(false);
    expect(m("remontadaDeLaGanadora").ok(1 / 3)).toBe(true);
    expect(m("remontadaDeLaGanadora").ok(0.34)).toBe(false);
    expect(m("cambiosRecta").ok(3)).toBe(true);
    expect(m("cambiosRecta").ok(5.1)).toBe(false);
  });

  it("la tabla trae una columna por tamaño y una fila por meta que aplica", () => {
    const t = tablaFinal({ 8: evaluarFinal({ ...r, cambiosPorTramo: null }), 18: evaluarFinal(r) });
    expect(t).toMatch(/8 personas/);
    expect(t).toMatch(/18 personas/);
    expect(t).toMatch(/la primera a 1,5 s de la meta es la ganadora/);
  });
});

describe("lo dibujado contra el plan", () => {
  const cuadro = (tj, narices, lider) => ({ tj, narices, lider });

  it("sin diferencias si la primera dibujada es la del plan en cada cuadro", () => {
    const ms = [cuadro(10, [1, 3, 2], 1), cuadro(10.5, [1, 3, 5], 2), cuadro(19, [9, 3, 5], 0), cuadro(25, [0, 0, 0], 2)];
    const r = dibujadoContraElPlan(ms, 20);
    expect(r.cuadros).toBe(3);
    expect(r.distintos).toBe(0);
    // El último cuadro a 1,5 s o más de la meta (T = 20) es el de las 10,5 s: ahí van primera el carril 2, en lo dibujado y en el plan.
    expect(r.primeraDibujada).toBe(2);
    expect(r.primeraDelPlan).toBe(2);
  });

  it("cuenta los cuadros en que el 3D dibuja a otra primera", () => {
    const ms = [cuadro(10, [1, 3, 2], 0), cuadro(11, [1, 3, 2], 1)];
    expect(dibujadoContraElPlan(ms, 20).distintos).toBe(1);
  });

  it("antes de la recta no se compara: el grupo no se ordena por hocico", () => {
    const ms = [cuadro(9.5, [1, 3, 2], 0), cuadro(11, [1, 3, 2], 1)];
    expect(dibujadoContraElPlan(ms, 20, 1.5, 10).cuadros).toBe(1);
    expect(dibujadoContraElPlan(ms, 20, 1.5, 10).distintos).toBe(0);
  });

  it("en el primer segundo y medio de la recta, que entran a sus carriles, la diferencia se cuenta aparte", () => {
    const ms = [cuadro(10.1, [1, 3, 2], 0), cuadro(10.3, [1, 3, 2], 0), cuadro(12, [1, 3, 2], 0)];
    const r = dibujadoContraElPlan(ms, 20, 1.5, 10);
    expect(r.distintosEntrada).toBe(2);
    expect(r.distintos).toBe(1);
  });

  it("dos hocicos empatados valen los dos", () => {
    expect(dibujadoContraElPlan([cuadro(10, [4, 4, 1], 1)], 20).distintos).toBe(0);
  });
});

describe("con el plan de verdad de la carrera", () => {
  it("con 18 y con 8 personas: todo es un número y cada terreno trae su cuenta", () => {
    for (const n of [8, 18]) {
      for (let i = 1; i <= 4; i++) {
        const { ctx } = rondaDe(lib, n, i);
        const plan = planCarrera(ctx, {});
        const m = medirFinal(plan);
        expect(m.L).toBe(8);
        expect(Number.isFinite(m.tiempoGanadora)).toBe(true);
        expect(m.segundosPunta).toBeGreaterThan(0);
        expect(m.segundosPunta).toBeLessThanOrEqual(plan.datos.tCrown - plan.datos.tAbre + 1e-6);
        expect(m.margen).toBeGreaterThanOrEqual(0);
        expect(m.cambiosPorTramo.length).toBe(plan.datos.tramos.length);
        if (n === 8) expect(m.cambiosPorTramo).toEqual([]);
      }
    }
  });
});
