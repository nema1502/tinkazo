import { describe, expect, it } from "vitest";
import { cartelEnGrabacion, DESPUES_DEL_CARTEL, grabacionCorta, hayQueRepetir, puedeParar } from "./mezcla-captura.mjs";

describe("puedeParar", () => {
  it("no para mientras el show no cerró", () => {
    expect(puedeParar({ cerro: false, cartelSeg: 10, ahoraSeg: 50 })).toBe(false);
  });
  it("si cerró sin que se viera el cartel, para", () => {
    expect(puedeParar({ cerro: true, cartelSeg: null, ahoraSeg: 5 })).toBe(true);
    expect(puedeParar({ cerro: true, cartelSeg: -1, ahoraSeg: 5 })).toBe(true);
  });
  it("si se vio el cartel espera dos segundos de audio después de él", () => {
    expect(puedeParar({ cerro: true, cartelSeg: 38, ahoraSeg: 38 + DESPUES_DEL_CARTEL - 0.1 })).toBe(false);
    expect(puedeParar({ cerro: true, cartelSeg: 38, ahoraSeg: 38 + DESPUES_DEL_CARTEL })).toBe(true);
  });
});

describe("cartelEnGrabacion", () => {
  it("lo pasa a milisegundos desde que empezó a grabar", () => {
    expect(cartelEnGrabacion({ cartelSeg: 12.5, primerCuadro: 48000 * 0.5, sr: 48000 })).toBeCloseTo(12000, 6);
  });
  it("sin cartel da -1", () => {
    expect(cartelEnGrabacion({ cartelSeg: null, primerCuadro: 0, sr: 48000 })).toBe(-1);
    expect(cartelEnGrabacion({ cartelSeg: undefined, primerCuadro: 0, sr: 48000 })).toBe(-1);
  });
});

describe("grabacionCorta", () => {
  it("tolera un retraso chico, no 2,3 s de 39", () => {
    expect(grabacionCorta({ grabadoSeg: 38.9, sonadoSeg: 39 })).toBe(false);
    expect(grabacionCorta({ grabadoSeg: 36.7, sonadoSeg: 39 })).toBe(true);
  });
});

describe("hayQueRepetir", () => {
  it("repite si quedó corta", () => {
    expect(hayQueRepetir({ corta: true, cartelMs: -1, golpe: null })).toBe(true);
  });
  it("repite si se vio el cartel y el golpe no se midió", () => {
    expect(hayQueRepetir({ corta: false, cartelMs: 30000, golpe: null })).toBe(true);
  });
  it("no repite si no hay cartel (3D, sin señal) ni si todo midió", () => {
    expect(hayQueRepetir({ corta: false, cartelMs: -1, golpe: null })).toBe(false);
    expect(hayQueRepetir({ corta: false, cartelMs: 30000, golpe: 9 })).toBe(false);
  });
});
