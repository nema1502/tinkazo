import { describe, expect, it } from "vitest";
import { CENTAVO, DOLAR } from "../campana/comision";
import { GANAN_MAXIMO, GANAN_MINIMO, MONTOS_EN_ORDEN, costosDeLaCampana, premiosIniciales, reducirPremios, textoDeDolares } from "./premios";

describe("los premios del panel", () => {
  it("arrancan sin monto elegido y con un solo ganador", () => {
    expect(premiosIniciales()).toEqual({ monto: null, ganan: 1 });
  });

  it("la escaleras de montos es la de botones: más y menos la recorren sin escribir nada", () => {
    expect(MONTOS_EN_ORDEN[0]).toBe(5);
    let p = premiosIniciales();
    p = reducirPremios(p, { tipo: "monto-mas" });
    expect(p.monto).toBe(5);
    p = reducirPremios(p, { tipo: "monto-mas" });
    expect(p.monto).toBe(10);
    p = reducirPremios(p, { tipo: "monto-menos" });
    expect(p.monto).toBe(5);
    for (let i = 0; i < MONTOS_EN_ORDEN.length; i++) p = reducirPremios(p, { tipo: "monto-mas" });
    expect(p.monto).toBe(MONTOS_EN_ORDEN[MONTOS_EN_ORDEN.length - 1]);
    p = reducirPremios(p, { tipo: "monto-menos" });
    expect(p.monto).toBe(100);
  });

  it("los ganadores van de 1 a 10, ni más arriba ni por debajo", () => {
    let p = premiosIniciales();
    p = reducirPremios(p, { tipo: "ganan-mas" });
    expect(p.ganan).toBe(2);
    for (let i = 0; i < GANAN_MAXIMO * 2; i++) p = reducirPremios(p, { tipo: "ganan-mas" });
    expect(p.ganan).toBe(GANAN_MAXIMO);
    for (let i = 0; i < GANAN_MAXIMO * 2; i++) p = reducirPremios(p, { tipo: "ganan-menos" });
    expect(p.ganan).toBe(GANAN_MINIMO);
  });

  it("fijar con botones deja el monto y el número de ganadores exactos", () => {
    const p = reducirPremios(premiosIniciales(), [
      { tipo: "monto-fijo", v: 100 },
      { tipo: "ganar", v: 7 },
    ]);
    expect(p).toEqual({ monto: 100, ganan: 7 });
  });

  it("el total del panel suma los premios y el cobro del servicio", () => {
    const cfg = { pb: 200n, minimo: DOLAR };
    const c = costosDeLaCampana({ monto: 10, ganan: 5 }, cfg);
    expect(c).toEqual({ premios: 50n * DOLAR, comision: 1n * DOLAR, total: 51n * DOLAR });
  });

  it("el cobro no baja del mínimo y el total lo lleva con premios y servicio", () => {
    const cfg = { pb: 1n, minimo: 2n * DOLAR };
    const c = costosDeLaCampana({ monto: 5, ganan: 1 }, cfg);
    expect(c?.premios).toBe(5n * DOLAR);
    expect(c?.comision).toBe(2n * DOLAR);
    expect(c?.total).toBe(7n * DOLAR);
  });

  it("sin el cobro del servicio configurado, el total es solo lo de los premios", () => {
    const c = costosDeLaCampana({ monto: 20, ganan: 3 }, null);
    expect(c).toEqual({ premios: 60n * DOLAR, comision: 0n, total: 60n * DOLAR });
  });

  it("montos y ganadores fuera de lugar no muestran nada", () => {
    expect(costosDeLaCampana({ monto: 0, ganan: 5 }, { pb: 200n, minimo: DOLAR })).toBeNull();
    expect(costosDeLaCampana({ monto: 10, ganan: 0 }, { pb: 200n, minimo: DOLAR })).toBeNull();
    expect(costosDeLaCampana({ monto: 10.5, ganan: 5 }, { pb: 200n, minimo: DOLAR })).toBeNull();
    expect(costosDeLaCampana({ monto: 10, ganan: GANAN_MAXIMO + 1 }, { pb: 200n, minimo: DOLAR })).toBeNull();
  });

  it("el texto de los montos se lee sin sintaxis: enteros y centavos justos", () => {
    expect(textoDeDolares(DOLAR)).toBe("1");
    expect(textoDeDolares(51n * DOLAR)).toBe("51");
    expect(textoDeDolares(DOLAR + 50n * CENTAVO)).toBe("1.50");
    expect(textoDeDolares(DOLAR + CENTAVO)).toBe("1.01");
  });

  it("reducir no toca lo que le entra", () => {
    const p = { monto: 10 as number | null, ganan: 3 };
    const otro = reducirPremios(p, { tipo: "monto-mas" });
    expect(p.monto).toBe(10);
    expect(otro.monto).toBe(20);
  });
});
