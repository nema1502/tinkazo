import { describe, expect, it } from "vitest";
import {
  ATRASO_DEL_CELULAR_S,
  CUENTA_DE_LA_SALA_S,
  LECTURA_DE_LA_TARJETA_S,
  LLEGADA_TIPICA_S,
  MARGEN_DE_LA_CADENA_S,
  MARGEN_DEL_NUMERO_S,
  arranqueDelShow,
  juegoTrasLaLlegada,
  juegoTrasLaRonda,
  lecturaMinimaS,
  msHasta,
} from "./arranque-del-show";
import { roundTime } from "./protocol/quicknet";
import { IDA_Y_VUELTA_MAX_MS } from "./reloj-de-la-ronda";

describe("cuándo arranca el show respecto del número", () => {
  const R = 32254977;

  it("la sala arranca su juego a una hora fija desde que le llega el número: 4,4 s con la cuenta, 2,9 s sin ella", () => {
    expect(juegoTrasLaLlegada(true)).toBe(4.4);
    expect(juegoTrasLaLlegada(false)).toBe(2.9);
    // Antes de la cuenta queda el margen del número: traerlo, comprobarlo y calcular quién gana.
    expect(juegoTrasLaLlegada(true) - CUENTA_DE_LA_SALA_S).toBeCloseTo(MARGEN_DEL_NUMERO_S - LLEGADA_TIPICA_S, 6);
  });

  it("el celular, lo mismo y un poco más: nunca antes, y nunca más de 2 s detrás de una sala a la par", () => {
    for (const cuenta of [true, false]) {
      const atraso = juegoTrasLaLlegada(cuenta, true) - juegoTrasLaLlegada(cuenta);
      expect(atraso).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
    }
    // El peor caso de la sala a la par: su número le llegó la ida y vuelta máxima después de nacer, y el del celular en
    // el acto. El celular igual arranca después.
    expect(ATRASO_DEL_CELULAR_S - IDA_Y_VUELTA_MAX_MS / 1000).toBeGreaterThan(0.5);
    // Y con los dos números en el mismo instante, a lo sumo el atraso: dentro de los 2 s.
    expect(ATRASO_DEL_CELULAR_S).toBeLessThanOrEqual(2 - 0.5);
  });

  it("la espera en grande lanza la tarjeta para que se lea entera y termine con la cuenta a horario", () => {
    const a = arranqueDelShow(R);
    expect(a.nace).toBe(roundTime(R));
    // Normal: la tarjeta 2 s antes del número, la cuenta 1,5 s después y el juego a los 4,5 s.
    expect(a.tarjeta).toBeCloseTo(a.nace - 2, 6);
    expect(a.cuenta).toBeCloseTo(a.nace + 1.5, 6);
    expect(a.juego).toBeCloseTo(a.nace + 4.5, 6);
    expect(a.cuenta - a.tarjeta).toBeCloseTo(LECTURA_DE_LA_TARJETA_S, 6);
    expect(a.juego - a.cuenta).toBe(CUENTA_DE_LA_SALA_S);
    // Rápido no tiene cuenta: la tarjeta medio segundo antes y el juego a los 3 s.
    const r = arranqueDelShow(R, false);
    expect(r.tarjeta).toBeCloseTo(r.nace - 0.5, 6);
    expect(r.juego).toBeCloseTo(r.nace + 3, 6);
    expect(r.juego - r.tarjeta).toBeCloseTo(LECTURA_DE_LA_TARJETA_S, 6);
    // El juego, a la misma hora que lo pone el ancla con una llegada típica.
    expect(a.juego - a.nace).toBeCloseTo(LLEGADA_TIPICA_S + juegoTrasLaLlegada(true), 6);
    expect(juegoTrasLaRonda()).toBeCloseTo(4.5, 6);
    expect(juegoTrasLaRonda(false)).toBeCloseTo(3, 6);
  });

  it("el celular lanza su tarjeta y su juego con el mismo atraso", () => {
    const sala = arranqueDelShow(R, true);
    const cel = arranqueDelShow(R, true, true);
    expect(cel.tarjeta - sala.tarjeta).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
    expect(cel.juego - sala.juego).toBeCloseTo(ATRASO_DEL_CELULAR_S, 6);
    expect(cel.grabable).toBe(sala.grabable);
  });

  it("una tarjeta que abre con poca lectura por delante lee la suya entera: esa sala ya es tardía", () => {
    expect(lecturaMinimaS()).toBe(1.5);
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
