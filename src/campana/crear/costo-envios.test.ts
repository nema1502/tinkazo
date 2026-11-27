import { describe, expect, it } from "vitest";
import { comisionDelArmado, costoDeLaCampana } from "./costo";

/**
 * El envío de los premios en lo que pone quien organiza. En una campaña de personas con el premio en dólares, cada premio se manda
 * desde la cuenta de quien organiza y ese envío tiene un costo: va en su propio renglón y entra en el total. Sin envíos, la cuenta
 * es la de siempre.
 */

/** Los valores de producción: 2 % de los premios con un mínimo de 1,50. */
const PRODUCCION = { pb: 200n, minimo: 15_000_000n };

describe("costoDeLaCampana con el envío de los premios", () => {
  it("tres premios de 40, con el servicio en 2,40 y los envíos en 1,50, dan 123,90 en total", () => {
    const comision = comisionDelArmado(PRODUCCION)?.({ monto: 40, ganan: 3 }) ?? null;
    expect(comision).toEqual({ dolares: 2.4 });
    const costo = costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision, envios: 1.5 });
    expect(costo.premios).toBe(120);
    expect(costo.comision).toBe(2.4);
    expect(costo.envios).toBe(1.5);
    expect(costo.total).toBeCloseTo(123.9, 10);
    expect(costo.total.toFixed(2)).toBe("123.90");
  });

  it("un premio de 5: 1,50 de servicio y 0,50 de envío son 7 en total", () => {
    const comision = comisionDelArmado(PRODUCCION)?.({ monto: 5, ganan: 1 }) ?? null;
    expect(costoDeLaCampana({ premios: { monto: 5, ganan: 1 }, comision, envios: 0.5 })).toEqual({ premios: 5, comision: 1.5, envios: 0.5, total: 7 });
  });

  it("sin cobro configurado el envío igual entra en el total", () => {
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: null, envios: 1.5 })).toEqual({ premios: 120, comision: null, envios: 1.5, total: 121.5 });
  });

  it("sin envíos el resultado es igual, clave por clave, al de siempre", () => {
    for (const comision of [null, { dolares: 6 }]) {
      const deSiempre = { premios: 120, comision: comision?.dolares ?? null, total: 120 + (comision?.dolares ?? 0) };
      const sinPedirlo = costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision });
      expect(sinPedirlo).toEqual(deSiempre);
      expect(Object.keys(sinPedirlo)).toEqual(["premios", "comision", "total"]);
      for (const envios of [undefined, 0, -1, Number.NaN]) {
        const sinEnvio = costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision, ...(envios === undefined ? {} : { envios }) });
        expect(sinEnvio, String(envios)).toEqual(deSiempre);
        expect(Object.keys(sinEnvio), String(envios)).toEqual(["premios", "comision", "total"]);
      }
    }
  });
});
