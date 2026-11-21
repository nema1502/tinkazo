import { describe, expect, it } from "vitest";
import { MONTOS_DEL_PAGO, estadoDelInforme, pagoInicialDelInforme, reducirPagoDelInforme } from "./informe";

describe("el informe del evento", () => {
  it("antes de publicar no hay informe", () => {
    expect(estadoDelInforme(null)).toEqual({ tipo: "sin-campana" });
    expect(estadoDelInforme({ estado: "borrador", anotadas: 0, ganadoras: [] })).toEqual({ tipo: "sin-campana" });
  });

  it("mientras la inscripción está abierta o cerrada muestra cuántos van", () => {
    expect(estadoDelInforme({ estado: "abierta", anotadas: 37, ganadoras: [] })).toEqual({ tipo: "parcial-abierto", anotadas: 37 });
    expect(estadoDelInforme({ estado: "cerrada", anotadas: 37, ganadoras: [] })).toEqual({ tipo: "parcial-cerrado", anotadas: 37 });
  });

  it("con el sorteo hecho, el informe nombra a cada ganadora y dice si se le pagó", () => {
    const informe = estadoDelInforme({
      estado: "sorteada",
      anotadas: 37,
      ganadoras: [
        { cuenta: "GAAA", nombre: "María Quispe", premia: true, pagada: true },
        { cuenta: "GBBB", nombre: "Jorge Mamani", premia: true, pagada: false },
      ],
    });
    if (informe.tipo !== "hecho") throw new Error("no es un sorteo hecho");
    expect(informe.anotadas).toBe(37);
    expect(informe.ganadoras).toHaveLength(2);
    expect(informe.ganadoras[0]).toEqual({ cuenta: "GAAA", nombre: "María Quispe", pagada: true });
    expect(informe.ganadoras[1]).toEqual({ cuenta: "GBBB", nombre: "Jorge Mamani", pagada: false });
  });

  it("el pago a quien organizó se elige entre montos, sin escribir números", () => {
    expect(MONTOS_DEL_PAGO).toEqual([5, 10, 20, 50]);
    expect(pagoInicialDelInforme()).toEqual({ monto: null });
    let p = pagoInicialDelInforme();
    for (let i = 0; i < MONTOS_DEL_PAGO.length; i++) p = reducirPagoDelInforme(p, { tipo: "mas" });
    expect(p.monto).toBe(MONTOS_DEL_PAGO[MONTOS_DEL_PAGO.length - 1]);
    for (let i = 0; i < MONTOS_DEL_PAGO.length * 2; i++) p = reducirPagoDelInforme(p, { tipo: "menos" });
    expect(p.monto).toBe(MONTOS_DEL_PAGO[0]);
    expect(reducirPagoDelInforme(pagoInicialDelInforme(), { tipo: "fijo", v: 20 })).toEqual({ monto: 20 });
    expect(reducirPagoDelInforme({ monto: 10 }, { tipo: "menos" })).toEqual({ monto: 5 });
  });
});
