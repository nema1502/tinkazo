import { describe, expect, it } from "vitest";
import { problemasDeMomentos } from "../pixi/kit/director";
import { validarGuion } from "../pixi/kit/guion";
import { problemasDeMarcador } from "../pixi/kit/marcador";
import { problemasDeRespuestas } from "../pixi/kit/respuestas";
import { sembrar } from "../pixi/kit/azar";
import { ACORDEON, ACORDEON_CUERPOS, CUERPO, FOTO_CUERPOS, carrilesDe, planRecta } from "./carrera-recta";
import { ctxDe } from "./carrera-prueba";
import { FINALISTAS, planCarrera, type Datos } from "./carrera-show";

/**
 * La carrera nueva (`?carrera=nueva`): distancia de verdad, carriles fijos
 * y una recta que se decide al final. Todo a nivel del plan, sin navegador; el
 * adivinador completo es del auditor de delatores (`scripts/lib/delatores-bayes.mjs`).
 */
const TAMANOS = [2, 3, 5, 8, 9, 12, 18, 25, 30, 31, 50, 100, 200];
const NUEVA = { nueva: true };

describe("la carrera nueva: el plan es puro y cumple la regla del niño", () => {
  for (const n of TAMANOS) {
    for (const semilla of [1, 2, 3, 4, 5, 6]) {
      it(`con ${n}, semilla ${semilla}: guion, momentos, marcador y respuestas en regla`, () => {
        const ctx = ctxDe(n, semilla);
        const plan = planCarrera(ctx, NUEVA);
        expect(plan.datos.nueva).toBe(true);
        expect(validarGuion(plan.guion, plan.duracion, { nino: true, nombres: ctx.nombres }).problemas).toEqual([]);
        expect(problemasDeMomentos(plan)).toEqual([]);
        expect(problemasDeMarcador(plan.marcador, { duracion: plan.duracion, total: n, pasoMax: n > 30 ? 25 : FINALISTAS })).toEqual([]);
        expect(problemasDeRespuestas(plan, { n, ganadores: ctx.ganadores })).toEqual([]);
      });
    }
  }

  it("es determinista y no toca la de siempre: sin la bandera el plan es el mismo de antes", () => {
    const a = planCarrera(ctxDe(18, 7), NUEVA);
    const b = planCarrera(ctxDe(18, 7), NUEVA);
    expect(b.duracion).toBe(a.duracion);
    expect(b.datos.sucesos).toEqual(a.datos.sucesos);
    const vieja = planCarrera(ctxDe(18, 7));
    const sin = planCarrera(ctxDe(18, 7), {});
    expect(sin.datos.sucesos).toEqual(vieja.datos.sucesos);
    expect(sin.datos.nueva).toBe(false);
    expect(sin.arco).toBe(vieja.arco);
  });

  it("al caer el golpe, la nueva no repite el nombre en el relator ni deja el contador bajo el cartel; la de siempre sigue igual", () => {
    expect(planCarrera(ctxDe(18, 7), NUEVA).alCoronar).toEqual({ sinAnuncio: true, sinMarcador: true });
    expect(planCarrera(ctxDe(18, 7)).alCoronar).toBeUndefined();
  });

  it("la duración es la de siempre: la recta nueva mide lo mismo (solo la foto del duelo suma unos segundos)", () => {
    for (const n of [5, 18, 30, 60, 200]) {
      const v = planCarrera(ctxDe(n, 3));
      const nv = planCarrera(ctxDe(n, 3), NUEVA);
      expect(Math.abs(nv.duracion - v.duracion)).toBeLessThan(9);
    }
  });

  it("la ganadora corona primera y nunca se echa", () => {
    for (let s = 1; s <= 30; s++) {
      const ctx = ctxDe(20, s);
      const d = planCarrera(ctx, NUEVA).datos;
      expect(d.vivas(d.tCrown)[0]).toBe(ctx.ganadores[0]);
      expect(d.lanes).toContain(ctx.ganadores[0]);
    }
  });
});

describe("la distancia de verdad: el puesto sale del puntaje, y el líder no salta", () => {
  it("lider(t) es el de mayor puntaje y solo cambia cuando dos se cruzan (nunca por un salto)", () => {
    for (const n of [9, 18, 30]) {
      for (let s = 1; s <= 10; s++) {
        const d: Datos = planCarrera(ctxDe(n, s), NUEVA).datos;
        const vivas = (t: number): number[] => d.gente.filter((g) => (d.tiempos.cae.get(g) ?? Infinity) > t);
        let previo = d.orden.lider(d.tSalida);
        for (let t = d.tSalida + 0.02; t < d.tAbre; t += 0.02) {
          const l = d.orden.lider(t);
          const mejor = Math.max(...vivas(t).map((g) => d.orden.puntaje(g, t)));
          expect(d.orden.puntaje(l, t)).toBeCloseTo(mejor, 9);
          if (l !== previo) {
            // El cambio es un cruce: la que deja la punta queda a un paso de la que la toma, no a varios puestos.
            if ((d.tiempos.cae.get(previo) ?? Infinity) > t) expect(Math.abs(d.orden.puntaje(l, t) - d.orden.puntaje(previo, t)), `n=${n} s=${s} t=${t.toFixed(2)}`).toBeLessThan(0.25);
            previo = l;
          }
        }
      }
    }
  });

  it("el puntaje de cada una es continuo: de un cuadro al siguiente no salta más de lo que se mueve el paseo", () => {
    for (const n of [9, 30]) {
      const d = planCarrera(ctxDe(n, 4), NUEVA).datos;
      for (const g of d.gente) {
        let previo = d.orden.puntaje(g, d.tSalida);
        for (let t = d.tSalida + 0.02; t < d.tAbre + 3; t += 0.02) {
          const v = d.orden.puntaje(g, t);
          expect(Math.abs(v - previo)).toBeLessThan(0.12);
          previo = v;
        }
      }
    }
  });

  it("cada una sale en su puesto y los puestos de salida son 0..n-1 sin repetir", () => {
    const d = planCarrera(ctxDe(30, 2), NUEVA).datos;
    expect([...d.gente.map((g) => d.orden.rango(g))].sort((a, b) => a - b)).toEqual(d.gente.map((_, i) => i));
  });

  it("la dueña de la ficha no parpadea: cambia menos veces que la punta y cada dueña dura casi un segundo o más", () => {
    for (const n of [9, 18, 30]) {
      for (let s = 1; s <= 8; s++) {
        const d: Datos = planCarrera(ctxDe(n, s), NUEVA).datos;
        let cambiosPunta = 0, cambiosDuena = 0, cortos = 0;
        let pl = d.lider(d.tSalida + 1), pd = d.duena(d.tSalida + 1), desde = -1e9;
        // Hasta el 97 % de la recta; después la dueña es, sin más, la que va primera.
        for (let t = d.tSalida + 1; t < d.tDeQ(0.97) - 0.01; t += 0.05) {
          const l = d.lider(t), du = d.duena(t);
          if (l !== pl) { cambiosPunta++; pl = l; }
          if (du !== pd) {
            cambiosDuena++;
            if (t - desde < 0.9 && (d.tiempos.cae.get(pd) ?? Infinity) > t) cortos++;
            pd = du;
            desde = t;
          }
        }
        expect(cambiosDuena, `n=${n} s=${s}`).toBeLessThanOrEqual(cambiosPunta);
        // Solo cuando quien tenía la ficha se echa, la ficha pasa un rato a quien va primera sin esperar el segundo.
        expect(cortos, `n=${n} s=${s}`).toBeLessThanOrEqual(d.tiempos.echadas.length);
        expect(d.duena(d.tCrown - 0.01)).toBe(d.campeona);
      }
    }
  });

  it("el líder al abrirse la recta es el primero de la recta, sin saltar", () => {
    for (const n of [3, 9, 18, 40]) {
      for (let s = 1; s <= 8; s++) {
        const d = planCarrera(ctxDe(n, s), NUEVA).datos;
        expect(d.lider(d.tAbre + 0.03), `n=${n} s=${s}`).toBe(d.lider(d.tAbre - 0.03));
      }
    }
  });
});

describe("la recta intercambiable", () => {
  const rondaDe = (L: number, i: number) => {
    const lanes = Array.from({ length: L }, (_, k) => k);
    const r = sembrar(i * 7919 + 13);
    const kw = Math.floor(r() * L);
    return { kw, p: planRecta(lanes, kw, sembrar(i * 104729 + 7)) };
  };
  const puesto = (p: { pos(k: number, q: number): number }, L: number, k: number, q: number): number => 1 + Array.from({ length: L }, (_, j) => j).filter((j) => j !== k && p.pos(j, q) > p.pos(k, q)).length;

  it("es determinista y la ganadora llega primera, de 2 a 8 carriles", () => {
    for (let L = 2; L <= 8; L++) {
      for (let i = 0; i < 60; i++) {
        const { kw, p } = rondaDe(L, i);
        expect(rondaDe(L, i).p.pos(kw, 0.5)).toBe(p.pos(kw, 0.5));
        expect(puesto(p, L, kw, 1), `L=${L} i=${i}`).toBe(1);
      }
    }
  });

  it("al 88 % todas quedan a menos de 1,2 cuerpos", () => {
    for (let L = 2; L <= 8; L++) {
      for (let i = 0; i < 40; i++) {
        const { p } = rondaDe(L, i);
        const xs = Array.from({ length: L }, (_, k) => p.pos(k, ACORDEON));
        expect((Math.max(...xs) - Math.min(...xs)) / CUERPO).toBeLessThanOrEqual(ACORDEON_CUERPOS + 1e-3);
      }
    }
  });

  it("la llegada apretada (menos de 0,35 cuerpos) es el duelo, con su foto; las demás no tienen foto", () => {
    let duelos = 0;
    for (let i = 0; i < 400; i++) {
      const { kw, p } = rondaDe(8, i);
      const margen = Math.min(...Array.from({ length: 8 }, (_, k) => (k === kw ? Infinity : p.pos(kw, 1) - p.pos(k, 1)))) / CUERPO;
      if (margen < FOTO_CUERPOS) {
        duelos++;
        expect(p.story.arc).toBe("duelo");
        expect(p.foto).toBeLessThan(1);
      } else {
        expect(p.story.arc).not.toBe("duelo");
        expect(p.foto).toBeGreaterThan(1);
      }
    }
    expect(duelos).toBeGreaterThan(40);
    expect(duelos).toBeLessThan(160);
  });

  it("antes del 88 %, quien va primera o con un suceso gana tanto como cualquiera", () => {
    const L = 8;
    const R = 6000;
    let primera = 0;
    let conSuceso = 0;
    for (let i = 0; i < R; i++) {
      const { kw, p } = rondaDe(L, i);
      if (puesto(p, L, kw, 0.5) === 1) primera++;
      if (p.story.beats.some((b) => b.actor === kw || b.target === kw)) conSuceso++;
    }
    // La primera a la mitad gana 1 de 8 (12,5 %; con 6.000 rondas, entre 11 y 14 %).
    expect(primera / R).toBeGreaterThan(0.11);
    expect(primera / R).toBeLessThan(0.14);
    // Tres sucesos entre ocho carriles (con el blanco de una escupida, un poco más): la ganadora tiene uno tantas veces como cualquiera.
    const cualquiera = 0.375;
    expect(conSuceso / R).toBeGreaterThan(cualquiera - 0.03);
    expect(conSuceso / R).toBeLessThan(cualquiera + 0.09);
  });

  it("los cuatro arcos aparecen con ocho carriles, ninguno por debajo del 8 % ni por encima del 45 %, y se nombran por cómo termina", () => {
    const cuenta: Record<string, number> = {};
    const R = 3000;
    for (let i = 0; i < R; i++) {
      const { kw, p } = rondaDe(8, i);
      cuenta[p.story.arc] = (cuenta[p.story.arc] ?? 0) + 1;
      expect(p.story.winner).toBe(kw);
      if (p.story.arc === "tapada") {
        // La tapada se cuela entre dos que iban adelante al 88 %.
        expect(p.story.rival).not.toBe(p.story.rival2);
        expect(p.pos(p.story.rival, ACORDEON)).toBeGreaterThan(p.pos(kw, ACORDEON));
        expect(p.pos(p.story.rival2, ACORDEON)).toBeGreaterThan(p.pos(kw, ACORDEON));
      }
    }
    expect(Object.keys(cuenta).sort()).toEqual(["duelo", "remontada", "susto", "tapada"]);
    for (const [arco, c] of Object.entries(cuenta)) {
      expect(c / R, arco).toBeGreaterThan(0.08);
      expect(c / R, arco).toBeLessThan(0.45);
    }
  });

  it("los carriles son de las ocho y la ganadora cae en cualquiera", () => {
    const cae = new Array<number>(8).fill(0);
    const nombres = Array.from({ length: 40 }, (_, i) => `N${i}`);
    for (let i = 0; i < 2000; i++) {
      const lanes = carrilesDe(nombres, 5, sembrar(i + 1));
      expect(lanes).toHaveLength(8);
      expect(new Set(lanes).size).toBe(8);
      const k = lanes.indexOf(5);
      cae[k] = (cae[k] ?? 0) + 1;
    }
    for (const c of cae) expect(c / 2000).toBeGreaterThan(0.1);
  });
});
