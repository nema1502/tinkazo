import { describe, expect, it } from "vitest";
import { UMBRAL, binomialArriba, colaAbajo, colaArriba, distribucion, evaluarRegla, evaluarSenal, falsasAlarmas, formatoP, pct, veredicto, wilson } from "./delatores.mjs";

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
