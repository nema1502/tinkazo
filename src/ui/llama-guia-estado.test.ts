import { describe, expect, it } from "vitest";
import {
  CAMINO_FELIZ,
  ORDEN_DE_TRAMOS,
  PANTALLAS_DE_CARGA,
  PANTALLAS_DE_COMPRA,
  POSE_DE_PANTALLA,
  TRAMOS,
  avanceDeEtapa,
  lugarEnRecorrido,
  paradas,
  posicion,
  type LugarEnRecorrido,
  type Recorrido,
} from "./llama-guia-estado";
import { POSES } from "./llama-poses";

/**
 * Lo que la llama que acompaña calcula sin tocar la página: dónde va en el camino y qué pose y qué lugar le tocan en
 * cada pantalla de la compra y de la carga.
 */

describe("posicion: dónde va la llama en el camino", () => {
  it("la primera parada es 0 y la bandera es 100", () => {
    expect(posicion(1, 4, 0)).toBe(0);
    expect(posicion(4, 4, 1)).toBe(100);
  });

  it("cada tramo ocupa lo mismo y el avance camina dentro del tramo", () => {
    expect(posicion(2, 4, 0)).toBe(25);
    expect(posicion(2, 4, 0.25)).toBe(31.25);
    expect(posicion(3, 4, 0.8)).toBe(70);
    expect(posicion(1, 2, 0.5)).toBe(25);
  });

  it("lo que se pasa de los bordes queda en el borde, y sin tramos queda al principio", () => {
    expect(posicion(0, 4, 0)).toBe(0);
    expect(posicion(9, 4, 0)).toBe(75);
    expect(posicion(2, 4, -1)).toBe(25);
    expect(posicion(2, 4, 3)).toBe(50);
    expect(posicion(2, 4, Number.NaN)).toBe(25);
    expect(posicion(1, 0, 0)).toBe(0);
  });

  it("las paradas van una por tramo, desde 0", () => {
    expect(paradas(4)).toEqual([0, 25, 50, 75]);
    expect(paradas(3)).toEqual([0, 33.33, 66.67]);
    expect(paradas(2)).toEqual([0, 50]);
    expect(paradas(0)).toEqual([]);
  });

  it("la etapa del dinero en camino lleva la llama hasta las tres cuartas partes del tramo, nunca a la bandera", () => {
    expect(avanceDeEtapa(0, 3)).toBe(0);
    expect(avanceDeEtapa(1, 3)).toBe(0.25);
    expect(avanceDeEtapa(3, 3)).toBe(0.75);
    expect(avanceDeEtapa(5, 3)).toBe(0.75);
    expect(avanceDeEtapa(1, 0)).toBe(0);
  });
});

describe("la tabla de poses", () => {
  const todas = [
    ...PANTALLAS_DE_COMPRA.map((p) => ["compra", p, POSE_DE_PANTALLA.compra[p]] as const),
    ...PANTALLAS_DE_CARGA.map((p) => ["carga", p, POSE_DE_PANTALLA.carga[p]] as const),
  ];

  it("cada pantalla de la compra y de la carga tiene su lugar, y la tabla no tiene pantallas de más", () => {
    expect(Object.keys(POSE_DE_PANTALLA.compra).sort()).toEqual([...PANTALLAS_DE_COMPRA].sort());
    expect(Object.keys(POSE_DE_PANTALLA.carga).sort()).toEqual([...PANTALLAS_DE_CARGA].sort());
  });

  it("cada lugar tiene una pose de las cinco, un avance entre 0 y 1 y un tramo que existe", () => {
    for (const [, , lugar] of todas) {
      expect(POSES).toContain(lugar.pose);
      expect(lugar.avance).toBeGreaterThanOrEqual(0);
      expect(lugar.avance).toBeLessThanOrEqual(1);
      if (lugar.tramo !== null) expect(ORDEN_DE_TRAMOS).toContain(lugar.tramo);
    }
  });

  it("toda falla se preocupa y deja a la llama donde estaba, y nada más se preocupa", () => {
    const fallas = ["CQ-ID-VENCIDA", "CQ-RECHAZO", "CQ-SEGIP-NO", "CQ-QR-FALTA", "CQ-QR-VENCIDO-ABIERTA", "CQ-QR-VENCIDO-CERRADA", "CQ-APROBAR-NOSALIO", "CQ-MENOS", "CQ-SINQR", "CQ-NOVENDE", "CQ-FRENADA", "CQ-FALLO", "CQ-RARO", "CQ-DESCONOCIDO", "SIN-CONEXION", "F1", "F2", "X1"];
    for (const [, p, lugar] of todas) {
      const esFalla = fallas.includes(p);
      expect(lugar.pose === "preocupa", p).toBe(esFalla);
      if (esFalla) expect(lugar.quedarse, p).toBe(true);
    }
  });

  it("las poses de la tabla del diseño: saluda al empezar, festeja solo al terminar, espera mientras algo de afuera trabaja", () => {
    expect(POSE_DE_PANTALLA.compra["CL-OFERTA"]).toEqual({ tramo: "tramoCuenta", avance: 0, pose: "saluda" });
    expect(POSE_DE_PANTALLA.compra["CQ-ID-ESPERA"]).toEqual({ tramo: "tramoIdentidad", avance: 0.25, pose: "espera" });
    expect(POSE_DE_PANTALLA.compra["CQ-ESPERA-PAGO"]).toEqual({ tramo: "tramoPago", avance: 0.8, pose: "espera" });
    expect(POSE_DE_PANTALLA.compra["CQ-PAGANDO"]).toEqual({ tramo: "tramoCamino", avance: 0.95, pose: "espera" });
    expect(POSE_DE_PANTALLA.compra["CQ-CAMINO"]).toMatchObject({ tramo: "tramoCamino", pose: "espera", porEtapa: true });
    expect(POSE_DE_PANTALLA.carga.C1).toEqual({ tramo: null, avance: 0, pose: "saluda" });
    expect(POSE_DE_PANTALLA.carga.Q2).toMatchObject({ pose: "espera" });
    expect(POSE_DE_PANTALLA.carga.E1).toMatchObject({ pose: "espera", porEtapa: true });
    const festejan = todas.filter(([, , l]) => l.pose === "festeja").map(([, p]) => p);
    expect(festejan).toEqual(["CQ-LISTO", "L1"]);
    for (const [, p, l] of todas) if (l.pose === "festeja") expect(posicion(4, 4, l.avance), p).toBe(100);
  });
});

describe("los caminos felices nunca vuelven atrás", () => {
  const lugares = (r: Recorrido, ps: readonly string[]): LugarEnRecorrido[] =>
    ps.map((p) => (lugarEnRecorrido as (r: string, p: string) => LugarEnRecorrido)(r, p));
  const enCamino = (l: LugarEnRecorrido): number | null => (l.paso && l.total ? posicion(l.paso, l.total, l.avance ?? 0) : null);

  for (const [recorrido, pantallas] of [
    ["compra", CAMINO_FELIZ.compra],
    ["compraSiguiente", CAMINO_FELIZ.compra],
    ["carga", CAMINO_FELIZ.carga],
    ["cargaVerificada", CAMINO_FELIZ.carga],
  ] as const) {
    it(`${recorrido}: empieza saludando, avanza siempre y termina en la bandera festejando`, () => {
      const ls = lugares(recorrido, pantallas);
      expect(ls[0]?.pose).toBe("saluda");
      const xs = ls.map(enCamino).filter((x): x is number => x !== null);
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] as number);
      expect(ls.at(-1)).toMatchObject({ pose: "festeja", paso: TRAMOS[recorrido].length, avance: 1 });
      expect(xs.at(-1)).toBe(100);
    });
  }
});

describe("lugarEnRecorrido: el número de tramo sale del recorrido", () => {
  it("la misma pantalla de pago es el tramo 3 de 4 en la primera compra y el 1 de 2 en las siguientes", () => {
    expect(lugarEnRecorrido("compra", "CQ-QR")).toEqual({ pose: "anima", paso: 3, total: 4, avance: 0.5, tramos: TRAMOS.compra });
    expect(lugarEnRecorrido("compraSiguiente", "CQ-QR")).toEqual({ pose: "anima", paso: 1, total: 2, avance: 0.5, tramos: TRAMOS.compraSiguiente });
  });

  it("en la carga, Cuánto es el tramo 2 de 4, y el 1 de 3 si ya está verificada", () => {
    expect(lugarEnRecorrido("carga", "M2")).toMatchObject({ paso: 2, total: 4, avance: 0.66 });
    expect(lugarEnRecorrido("cargaVerificada", "M2")).toMatchObject({ paso: 1, total: 3, avance: 0.66 });
  });

  it("una pantalla de un tramo que el recorrido no tiene deja a la llama al principio del tramo que sigue", () => {
    expect(lugarEnRecorrido("compraSiguiente", "CL-PAQUETE")).toMatchObject({ paso: 1, total: 2, avance: 0 });
    expect(lugarEnRecorrido("cargaVerificada", "V2")).toMatchObject({ paso: 1, total: 3, avance: 0 });
  });

  it("una falla no trae camino: pide quedarse donde estaba", () => {
    expect(lugarEnRecorrido("compra", "CQ-FRENADA")).toEqual({ pose: "preocupa", quedarse: true });
    expect(lugarEnRecorrido("carga", "X1")).toEqual({ pose: "preocupa", quedarse: true });
    expect(lugarEnRecorrido("compra", "CQ-ESPERA")).toEqual({ pose: "espera", quedarse: true });
  });

  it("la primera pantalla de la carga saluda sin camino", () => {
    expect(lugarEnRecorrido("carga", "C1")).toEqual({ pose: "saluda" });
  });

  it("el avance por etapa pisa el de la tabla, sin salirse de 0 a 1", () => {
    expect(lugarEnRecorrido("compra", "CQ-CAMINO", { avance: avanceDeEtapa(2, 3) })).toMatchObject({ paso: 4, avance: 0.5, pose: "espera" });
    expect(lugarEnRecorrido("carga", "A1", { avance: 7 })).toMatchObject({ paso: 4, avance: 1 });
  });

  it("los tramos de cada recorrido van en el orden de siempre", () => {
    for (const ts of Object.values(TRAMOS)) {
      const idx = ts.map((t) => ORDEN_DE_TRAMOS.indexOf(t));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      expect(idx.every((i) => i >= 0)).toBe(true);
    }
  });
});
