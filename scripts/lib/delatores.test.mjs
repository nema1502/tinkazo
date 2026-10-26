import { describe, expect, it } from "vitest";
import { UMBRAL, binomialArriba, chi2sf, colaAbajo, colaArriba, colaNormal, distribucion, evaluarMedia, evaluarRegla, evaluarReparto, evaluarSenal, falsasAlarmas, formatoP, pct, veredicto, veredictoP, wilson } from "./delatores.mjs";

/** `n` observaciones con el mismo azar `p`, de las que aciertan las primeras `k`. */
const obs = (n, p, k) => Array.from({ length: n }, (_, i) => ({ acierta: i < k, azar: p }));
const choose = (n, k) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

describe("la distribución de los aciertos por azar", () => {
  it("suma uno", () => {
    const f = distribucion([0.1, 0.5, 0.9, 0.125, 0.3]);
    expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("con la misma probabilidad en todas es la binomial de siempre", () => {
    const f = distribucion(Array.from({ length: 10 }, () => 0.3));
    for (let k = 0; k <= 10; k++) expect(f[k]).toBeCloseTo(choose(10, k) * 0.3 ** k * 0.7 ** (10 - k), 12);
  });

  it("con probabilidades distintas, la cuenta a mano", () => {
    // Una moneda justa y una de un cuarto: ninguna 3/8, una 1/2, las dos 1/8.
    const f = distribucion([0.5, 0.25]);
    expect([...f]).toEqual([0.375, 0.5, 0.125]);
  });

  it("las dos colas se complementan", () => {
    const ps = [0.125, 0.5, 0.2, 0.125, 0.33, 0.6];
    for (let k = 1; k <= ps.length; k++) expect(colaArriba(ps, k) + colaAbajo(ps, k - 1)).toBeCloseTo(1, 12);
    expect(colaArriba(ps, 0)).toBe(1);
    expect(colaAbajo(ps, ps.length)).toBe(1);
    expect(colaArriba(ps, ps.length + 1)).toBe(0);
  });

  it("lo que dice la auditoría: con 16 semillas y 8 corredores, duplicar el azar pasa una de cada ocho veces", () => {
    // El azar acierta 2 de 16; acertar 4 o más por casualidad: 13%.
    const p = binomialArriba(16, 1 / 8, 4);
    expect(p).toBeGreaterThan(1 / 9);
    expect(p).toBeLessThan(1 / 7);
  });
});

describe("una regla, sobre todas las semillas", () => {
  it("cuenta aciertos, tasa, azar y cuántas veces el azar", () => {
    const r = evaluarRegla([...obs(8, 0.125, 4), ...obs(8, 0.25, 0)]);
    expect(r.n).toBe(16);
    expect(r.aciertos).toBe(4);
    expect(r.tasa).toBe(0.25);
    expect(r.azar).toBeCloseTo(0.1875, 12);
    expect(r.lift).toBeCloseTo(4 / 3, 12);
    expect(r.esperado).toBeCloseTo(3, 12);
    expect(r.pArriba).toBeCloseTo(colaArriba([...Array(8).fill(0.125), ...Array(8).fill(0.25)], 4), 12);
  });

  it("las semillas que no informan no cuentan: sin dato, apostar por nadie o por todos", () => {
    const r = evaluarRegla([null, { acierta: true, azar: 1 }, { acierta: false, azar: 0 }, { acierta: true, azar: 0.5 }, undefined]);
    expect(r.n).toBe(1);
    expect(r.aciertos).toBe(1);
  });

  it("el intervalo de Wilson contiene la tasa y se angosta con más datos", () => {
    const [a, b] = wilson(25, 200);
    expect(a).toBeLessThan(0.125);
    expect(b).toBeGreaterThan(0.125);
    const [c, d] = wilson(250, 2000);
    expect(d - c).toBeLessThan(b - a);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe("el veredicto, con el umbral fijado antes de correr", () => {
  it("el umbral es el documentado", () => {
    expect(UMBRAL).toEqual({ alfa: 0.001, mirar: 0.01, arriba: 1.25, abajo: 0.5, minimo: 10 });
    expect(Object.isFrozen(UMBRAL)).toBe(true);
  });

  it("con menos de diez observaciones, pocos datos", () => {
    expect(veredicto(evaluarRegla(obs(9, 0.125, 9))).veredicto).toBe("pocos");
  });

  it("acertar como el azar es limpio", () => {
    expect(veredicto(evaluarRegla(obs(200, 0.125, 25))).veredicto).toBe("limpia");
    expect(veredicto(evaluarRegla(obs(200, 0.5, 103))).veredicto).toBe("limpia");
  });

  it("un delator grosero se ve aun con dieciséis semillas: la última nombrada gana nueve de dieciséis", () => {
    const v = veredicto(evaluarRegla(obs(16, 0.125, 9)));
    expect(v.veredicto).toBe("delator");
    expect(v.sentido).toBe("arriba");
  });

  it("con doscientas semillas y ocho corredores, delata desde 42 aciertos (21%, 1,7 veces el azar)", () => {
    expect(veredicto(evaluarRegla(obs(200, 0.125, 42))).veredicto).toBe("delator");
    expect(veredicto(evaluarRegla(obs(200, 0.125, 41))).veredicto).toBe("mirar");
    expect(veredicto(evaluarRegla(obs(200, 0.125, 38))).veredicto).toBe("limpia");
  });

  it("en un mano a mano, delata desde 125 de 200 (62,5%): ahí manda el margen de 1,25", () => {
    expect(veredicto(evaluarRegla(obs(200, 0.5, 125))).veredicto).toBe("delator");
    expect(veredicto(evaluarRegla(obs(200, 0.5, 124))).veredicto).toBe("limpia");
  });

  it("al revés también delata: lo que señala nunca gana", () => {
    const v = veredicto(evaluarRegla(obs(200, 0.125, 0)));
    expect(v).toMatchObject({ veredicto: "delator", sentido: "abajo" });
    // Con dieciséis, que el amague nunca gane todavía puede ser casualidad.
    expect(veredicto(evaluarRegla(obs(16, 0.125, 0))).veredicto).toBe("limpia");
  });

  it("un desvío muy medido pero chico no es delator: 15,5% contra 12,5% con dos mil semillas", () => {
    const r = evaluarRegla(obs(2000, 0.125, 310));
    expect(Math.min(r.pArriba, r.pAbajo) * 2).toBeLessThan(UMBRAL.alfa);
    expect(r.lift).toBeLessThan(UMBRAL.arriba);
    expect(veredicto(r).veredicto).toBe("limpia");
  });
});

describe("una señal con varias reglas", () => {
  it("se queda con la regla más extrema y corrige por cuántas se miraron", () => {
    const fam = {
      "puesto-1": obs(200, 0.125, 25),
      "puesto-2": obs(200, 0.125, 70),
      "puesto-3": obs(200, 0.125, 24),
    };
    const s = evaluarSenal(fam);
    expect(s.mejor.nombre).toBe("puesto-2");
    expect(s.m).toBe(3);
    expect(s.p).toBeCloseTo(Math.min(1, 2 * 3 * s.mejor.pArriba), 15);
    expect(s.veredicto).toBe("delator");
  });

  it("la corrección puede bajar a una regla de delator a mirar", () => {
    // Sola, 41 de 200 queda a mirar; entre ocho reglas, limpia.
    const sola = evaluarSenal({ a: obs(200, 0.125, 41) });
    const entreOcho = evaluarSenal(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`r${i}`, i === 0 ? obs(200, 0.125, 41) : obs(200, 0.125, 25)])));
    expect(sola.veredicto).toBe("mirar");
    expect(entreOcho.veredicto).toBe("limpia");
  });

  it("las reglas sin datos no cuentan, y sin ninguna son pocos datos", () => {
    const s = evaluarSenal({ a: [null, null], b: obs(20, 0.5, 10) });
    expect(s.m).toBe(1);
    expect(evaluarSenal({ a: [null] }).veredicto).toBe("pocos");
    expect(evaluarSenal({}).veredicto).toBe("pocos");
  });

  it("si ninguna regla llega al mínimo, informa la de más datos sin juzgar", () => {
    const s = evaluarSenal({ a: obs(4, 0.5, 4), b: obs(6, 0.5, 3) });
    expect(s.veredicto).toBe("pocos");
    expect(s.mejor).not.toBeNull();
  });
});

describe("sin la regla del tamaño (a nivel del plan)", () => {
  it("un desvío chico pero real delata si no se le pide ser grande", () => {
    const r = evaluarRegla(obs(2000, 0.125, 310));
    expect(veredicto(r).veredicto).toBe("limpia");
    expect(veredicto(r, 1, { tamano: false })).toMatchObject({ veredicto: "delator", sentido: "arriba" });
    expect(evaluarSenal({ a: obs(2000, 0.125, 310) }, { tamano: false }).veredicto).toBe("delator");
    expect(evaluarSenal({ a: obs(2000, 0.125, 310) }).veredicto).toBe("limpia");
  });

  it("acertar como el azar sigue siendo limpio", () => {
    expect(evaluarSenal({ a: obs(1500, 0.125, 188) }, { tamano: false }).veredicto).toBe("limpia");
  });
});

describe("el chi cuadrado, con sus grados de libertad", () => {
  it("coincide con la tabla en el crítico de 1 en 1000 de cada grado", () => {
    const tabla = { 1: 10.828, 2: 13.816, 3: 16.266, 4: 18.467, 5: 20.515, 6: 22.458, 7: 24.322, 8: 26.124 };
    for (const [gl, x] of Object.entries(tabla)) expect(chi2sf(x, Number(gl)), `gl ${gl}`).toBeCloseTo(0.001, 6);
    expect(chi2sf(14.067, 7)).toBeCloseTo(0.05, 5);
    expect(chi2sf(6.346, 7)).toBeCloseTo(0.5, 4);
  });

  it("con 2 y con 4 grados es exacto: e^(-x/2) y e^(-x/2)·(1 + x/2)", () => {
    for (const x of [0.5, 3, 10, 40]) {
      expect(chi2sf(x, 2)).toBeCloseTo(Math.exp(-x / 2), 12);
      expect(chi2sf(x, 4)).toBeCloseTo(Math.exp(-x / 2) * (1 + x / 2), 12);
    }
  });

  it("cero es siempre posible, y lo muy grande no falla ni da negativo", () => {
    expect(chi2sf(0, 7)).toBe(1);
    expect(chi2sf(85.5, 7)).toBeGreaterThan(0);
    expect(chi2sf(85.5, 7)).toBeLessThan(1e-12);
    expect(chi2sf(1000, 7)).toBeGreaterThanOrEqual(0);
  });

  it("la cola de la normal es la de los dos lados", () => {
    expect(colaNormal(1.96)).toBeCloseTo(0.05, 4);
    expect(colaNormal(-1.96)).toBeCloseTo(0.05, 4);
    expect(colaNormal(3.2905)).toBeCloseTo(0.001, 6);
    expect(colaNormal(0)).toBe(1);
  });

  it("el veredicto por la probabilidad sola", () => {
    expect(veredictoP(0.0009)).toBe("delator");
    expect(veredictoP(0.005)).toBe("mirar");
    expect(veredictoP(0.2)).toBe("limpia");
  });
});

describe("un reparto: dónde cae la ganadora", () => {
  it("parejo es limpio, y los grados de libertad son casilleros menos uno", () => {
    const r = evaluarReparto([180, 189, 183, 190, 191, 191, 190, 186]);
    expect(r.gl).toBe(7);
    expect(r.n).toBe(1500);
    expect(r.chi2).toBeCloseTo(0.6, 0);
    expect(r.veredicto).toBe("limpia");
    expect(evaluarReparto([528, 530, 442]).gl).toBe(2);
    expect(evaluarReparto([361, 389, 384, 366]).gl).toBe(3);
  });

  it("el mismo chi cuadrado vale distinto con distintos grados: 15 es delator con 2 casilleros y limpio con 8", () => {
    // Dos casilleros: (n/2 + d, n/2 - d) da chi2 = 4 d² / n.
    const dos = evaluarReparto([750 + 61, 750 - 61]);
    expect(dos.chi2).toBeCloseTo(9.9, 0);
    expect(evaluarReparto([1230, 270], null).veredicto).toBe("delator");
    // 15 de chi cuadrado: con gl 2 es 0,0006; con gl 7 es 0,036.
    expect(chi2sf(15, 2)).toBeLessThan(0.001);
    expect(chi2sf(15, 7)).toBeGreaterThan(0.03);
  });

  it("un casillero muy cargado delata y dice cuál: la mitad de la recta, 1.º y 2.º por encima", () => {
    const r = evaluarReparto([259, 227, 229, 163, 162, 197, 135, 128]);
    expect(r.veredicto).toBe("delator");
    expect(r.p).toBeLessThan(1e-12);
    expect(r.mas.indice).toBe(0);
    expect(r.mas.observado).toBe(259);
    expect(r.mas.veces).toBeCloseTo(259 / 187.5, 6);
  });

  it("a mirar entre 1 en 1000 y 1 en 100", () => {
    // gl 2, n 1500: chi2 de 10,1 da 0,0064.
    const r = evaluarReparto([528, 530, 442]);
    expect(r.chi2).toBeCloseTo(10.1, 0);
    expect(r.veredicto).toBe("mirar");
  });

  it("casilleros distintos: con probabilidades, no con la parejas", () => {
    // Dos tandas, de 16 y de 15: con 3.100 rondas se esperan 1.600 y 1.500.
    const r = evaluarReparto([1600, 1500], [16 / 31, 15 / 31]);
    expect(r.chi2).toBeCloseTo(0, 9);
    expect(r.esperados).toEqual([1600, 1500]);
    expect(evaluarReparto([1600, 1500]).chi2).toBeGreaterThan(3);
  });

  it("con menos de cinco esperados por casillero, o con un solo casillero, pocos datos", () => {
    expect(evaluarReparto([3, 1, 2, 0, 2, 1, 1, 0]).veredicto).toBe("pocos");
    expect(evaluarReparto([1500]).veredicto).toBe("pocos");
    expect(evaluarReparto([0, 0, 0]).veredicto).toBe("pocos");
  });
});

describe("un promedio que sin señal vale cero", () => {
  const rondas = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  it("oscilar alrededor de cero es limpio", () => {
    const v = rondas(1500, (i) => Math.sin(i * 1.7) * 0.2);
    expect(evaluarMedia(v).veredicto).toBe("limpia");
  });

  it("un corrimiento chico pero sostenido delata con 1.500 rondas", () => {
    const v = rondas(1500, (i) => Math.sin(i * 1.7) + 0.2);
    const m = evaluarMedia(v);
    expect(m.media).toBeCloseTo(0.2, 1);
    expect(m.z).toBeGreaterThan(5);
    expect(m.veredicto).toBe("delator");
  });

  it("con el desvío conocido (z de cada ronda, desvío 1) no lo estima", () => {
    const v = rondas(1500, (i) => (i % 2 ? 1 : -1) * 0.5);
    expect(evaluarMedia(v, { sd: 1 }).de).toBe(1);
    expect(evaluarMedia(v, { sd: 1 }).veredicto).toBe("limpia");
  });

  it("al revés también: hacia abajo delata, y con pocas rondas no se juzga", () => {
    const v = rondas(400, (i) => Math.sin(i * 2.3) - 0.4);
    expect(evaluarMedia(v).veredicto).toBe("delator");
    expect(evaluarMedia(v.slice(0, 20)).veredicto).toBe("pocos");
    expect(evaluarMedia([]).veredicto).toBe("pocos");
  });
});

describe("lo que se escribe", () => {
  it("las falsas alarmas esperadas son las señales por el umbral", () => {
    expect(falsasAlarmas(240)).toBeCloseTo(0.24, 12);
  });

  it("probabilidades y porcentajes con coma", () => {
    expect(formatoP(0.25)).toBe("0,250");
    expect(formatoP(0.0046)).toBe("0,0046");
    expect(formatoP(0.00004)).toBe("4,0e-5");
    expect(formatoP(1e-15)).toBe("<1e-12");
    expect(pct(0.125)).toBe("12,5%");
    expect(pct(0.5)).toBe("50%");
  });
});
