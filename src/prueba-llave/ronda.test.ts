import { describe, expect, it } from "vitest";
import { roundTime } from "../protocol/quicknet-hora";
import { elegirRonda, MARGEN_DE_LA_RONDA_S, MINIMO_ANTES_DEL_DESBLOQUEO_S, MINIMO_DESPUES_DEL_DESBLOQUEO_S, quedaTiempo, vencimientoDeLaFirma } from "./ronda";

describe("la ronda del sello", () => {
  const ahora = 1_800_000_000;

  it("nace al menos 120 s después de ahora, y no mucho más", () => {
    const r = elegirRonda(ahora);
    const t = roundTime(r);
    expect(t - ahora).toBeGreaterThanOrEqual(MARGEN_DE_LA_RONDA_S);
    expect(t - ahora).toBeLessThan(MARGEN_DE_LA_RONDA_S + 3);
  });

  it("antes de pedir el desbloqueo exige 100 s y después exige 40 s", () => {
    expect(MINIMO_ANTES_DEL_DESBLOQUEO_S).toBe(100);
    expect(MINIMO_DESPUES_DEL_DESBLOQUEO_S).toBe(40);
    const r = elegirRonda(ahora);
    const t = roundTime(r);
    expect(quedaTiempo(r, t - 100, 100)).toBe(true);
    expect(quedaTiempo(r, t - 99, 100)).toBe(false);
    expect(quedaTiempo(r, t - 40, 40)).toBe(true);
    expect(quedaTiempo(r, t - 39, 40)).toBe(false);
  });

  it("la ronda elegida deja los 100 s antes del desbloqueo", () => {
    expect(quedaTiempo(elegirRonda(ahora), ahora, MINIMO_ANTES_DEL_DESBLOQUEO_S)).toBe(true);
  });

  it("la firma vence 60 ledgers después", () => {
    expect(vencimientoDeLaFirma(1000)).toBe(1060);
  });
});
