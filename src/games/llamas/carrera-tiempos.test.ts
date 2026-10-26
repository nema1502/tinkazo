import { describe, expect, it } from "vitest";
import { sembrar } from "../pixi/kit/azar";
import { CIERRE_TRAMO, DESORDEN, ESP_MIN, REMATE, armarTiempos, duracionGrupo, nominalDe, pasoEntre, repartir, tramosPara } from "./carrera-tiempos";

describe("los tiempos del grupo reparten un presupuesto", () => {
  it("entre dos echadas hay siempre 1,2 s o más, con cualquier cantidad y cualquier desorden", () => {
    for (let echan = 1; echan <= 30; echan++) {
      for (let s = 1; s <= 25; s++) {
        const fila = Array.from({ length: echan }, (_, i) => i);
        const t = armarTiempos({ t0: 6, fila, total: echan + 8, rng: sembrar(s * 7919 + echan) });
        t.echadas.forEach((e, i) => {
          if (i) expect(e.t - (t.echadas[i - 1] as { t: number }).t, `${echan} echadas, semilla ${s}`).toBeGreaterThanOrEqual(ESP_MIN - 1e-9);
        });
      }
    }
  });

  it("el paso baja de 2,9 a 1,5 s a medida que hay más que echar y nunca pasa de ahí", () => {
    expect(pasoEntre(1)).toBeCloseTo(2.9, 6);
    expect(pasoEntre(22)).toBeCloseTo(1.5, 6);
    expect(pasoEntre(60)).toBeCloseTo(1.5, 6);
    for (let e = 2; e <= 30; e++) expect(pasoEntre(e)).toBeLessThanOrEqual(pasoEntre(e - 1));
  });

  it("la duración del grupo sale del mismo cálculo que los tiempos y no pasa de 55 s con 22 echadas", () => {
    for (let echan = 1; echan <= 22; echan++) {
      const t = armarTiempos({ t0: 0, fila: Array.from({ length: echan }, (_, i) => i), total: echan + 8, rng: sembrar(echan) });
      expect(t.abre).toBeCloseTo(duracionGrupo(echan), 9);
      expect(t.ultima).toBeLessThanOrEqual(nominalDe(echan).abre - REMATE + DESORDEN + 1e-9);
      expect(t.ultima).toBeGreaterThanOrEqual(nominalDe(echan).abre - REMATE - DESORDEN - 1e-9);
    }
    expect(duracionGrupo(22)).toBeLessThanOrEqual(55);
  });

  it("los tramos se reparten sin dejar ninguno vacío y cada terreno nuevo llega después de cerrar el anterior", () => {
    for (let echan = 1; echan <= 22; echan++) {
      const K = tramosPara(echan);
      expect(repartir(echan, K === 1 ? [1] : K === 2 ? [0.62, 0.38] : K === 3 ? [0.5, 0.32, 0.18] : [0.4, 0.32, 0.18, 0.1]).every((x) => x >= 1)).toBe(true);
      const t = armarTiempos({ t0: 0, fila: Array.from({ length: echan }, (_, i) => i), total: echan + 8, rng: sembrar(3) });
      t.tramos.forEach((tr, k) => {
        const propias = t.echadas.filter((e) => e.tramo === k);
        expect(propias.length).toBeGreaterThanOrEqual(1);
        for (const e of propias) expect(e.t).toBeGreaterThan(tr.t0);
        if (k) expect(tr.t0 - (t.echadas.filter((e) => e.tramo === k - 1).at(-1) as { t: number }).t).toBeGreaterThanOrEqual(CIERRE_TRAMO - DESORDEN - 1e-9);
      });
    }
  });

  it("sin nadie que echar no hay tramos ni echadas", () => {
    const t = armarTiempos({ t0: 6, fila: [], total: 8, rng: sembrar(1) });
    expect(t.tramos).toEqual([]);
    expect(t.echadas).toEqual([]);
    expect(t.abre).toBe(6);
  });
});
