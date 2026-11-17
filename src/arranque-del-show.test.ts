import { describe, expect, it } from "vitest";
import { CUENTA_TRAS_LA_RONDA_S, LECTURA_DE_LA_TARJETA_S, MARGEN_DE_LA_CADENA_S, arranqueDelShow, juegoTrasLaRonda, msHasta } from "./arranque-del-show";
import { roundTime } from "./protocol/quicknet";

describe("cuándo arranca el show respecto del número", () => {
  const R = 32254977;

  it("la tarjeta termina de leerse justo cuando nace el número, y la cuenta nunca empieza antes", () => {
    const a = arranqueDelShow(R);
    expect(a.nace).toBe(roundTime(R));
    expect(a.tarjeta + LECTURA_DE_LA_TARJETA_S).toBe(a.nace);
    expect(CUENTA_TRAS_LA_RONDA_S).toBeGreaterThanOrEqual(0);
    expect(a.cuenta).toBeGreaterThanOrEqual(a.nace);
  });

  it("el juego arranca tres segundos después de la cuenta, o con ella si la duración no la lleva", () => {
    expect(arranqueDelShow(R).juego - arranqueDelShow(R).cuenta).toBe(3);
    expect(arranqueDelShow(R, false).juego).toBe(arranqueDelShow(R, false).cuenta);
    expect(juegoTrasLaRonda()).toBe(3);
    expect(juegoTrasLaRonda(false)).toBe(0);
  });

  it("la grabación espera el margen de la cadena, y el show no", () => {
    const a = arranqueDelShow(R);
    expect(a.grabable - a.nace).toBe(MARGEN_DE_LA_CADENA_S);
    expect(a.juego).toBeLessThan(a.grabable);
  });

  it("cuenta los milisegundos que faltan, y cero si ya pasó", () => {
    expect(msHasta(100, 99_000)).toBe(1000);
    expect(msHasta(100, 101_000)).toBe(0);
  });
});
