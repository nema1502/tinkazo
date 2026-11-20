import { describe, expect, it } from "vitest";
import { costoDeLaCampana } from "./costo";

describe("costoDeLaCampana", () => {
  it("3 premios de 40 dan 120 en total y hoy no hay renglón de comisión", () => {
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: null })).toEqual({ premios: 120, comision: null, total: 120 });
  });

  it("con una comisión de prueba sale el renglón de la comisión y el total la incluye", () => {
    expect(costoDeLaCampana({ premios: { monto: 40, ganan: 3 }, comision: { dolares: 6 } })).toEqual({ premios: 120, comision: 6, total: 126 });
  });
});
