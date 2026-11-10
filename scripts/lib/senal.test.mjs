import { describe, expect, it } from "vitest";
import { aDb, energiaEnBanda, escribirWav, leerWav, medirSenal, nivelMaximoDeTramo, pasoAlto, picos, tramoQueSuena } from "./senal.mjs";

const SR = 44100;
const seno = (hz, amp, seg) => Float32Array.from({ length: Math.round(SR * seg) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));

describe("las medidas de una señal", () => {
  it("un seno de 1 kHz a −20 dBFS en los dos canales mide −20 LUFS (la ponderación K no toca el 1 kHz)", () => {
    const x = seno(1000, 0.1, 4);
    const m = medirSenal(x, x, SR);
    expect(m.I).toBeGreaterThan(-20.3);
    expect(m.I).toBeLessThan(-19.7);
    expect(m.recortes).toBe(0);
    expect(m.picoDb).toBeCloseTo(-20, 0);
  });

  it("el pico real de un seno cerca de Nyquist es mayor que el de sus muestras", () => {
    const x = Float32Array.from({ length: SR }, (_, i) => 0.9 * Math.sin(2 * Math.PI * 11025 * i / SR + 0.7));
    const p = picos(x, x);
    expect(p.picoReal).toBeGreaterThanOrEqual(p.pico);
    expect(p.picoReal).toBeLessThanOrEqual(0.95);
  });

  it("un recorte se cuenta", () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => (i % 100 === 0 ? 1 : 0.1));
    expect(picos(x, x).recortes).toBe(20);
  });

  it("un parlante que corta en 150 Hz casi no pierde un seno de 1 kHz y se lo come casi todo si es de 60 Hz", () => {
    const agudo = seno(1000, 0.3, 3), grave = seno(60, 0.3, 3);
    expect(medirSenal(agudo, agudo, SR).pierde150).toBeLessThan(0.3);
    expect(medirSenal(grave, grave, SR).pierde150).toBeGreaterThan(8);
    const f = pasoAlto(grave, SR, 150);
    expect(Math.max(...f.slice(SR))).toBeLessThan(0.3 * 0.25);
  });

  it("el silencio se mide: una ventana sin sonido está a −120 dB y un clic en medio se ve", () => {
    const x = new Float32Array(SR * 2);
    expect(nivelMaximoDeTramo(x, x, SR, 0.5, 1.5)).toBe(-120);
    x[SR] = 0.01;
    expect(nivelMaximoDeTramo(x, x, SR, 0.5, 1.5)).toBeCloseTo(-40, 0);
    expect(nivelMaximoDeTramo(x, x, SR, 1.5, 2)).toBe(-120);
  });

  it("la energía entre 250 Hz y 4 kHz: un seno de 1 kHz está todo ahí y uno de 80 Hz no está", () => {
    const a = seno(1000, 0.3, 2), b = seno(80, 0.3, 2);
    expect(energiaEnBanda(a, a, SR, 250, 4000).enBanda).toBeGreaterThan(0.95);
    expect(energiaEnBanda(b, b, SR, 250, 4000).enBanda).toBeLessThan(0.05);
    expect(energiaEnBanda(b, b, SR, 250, 4000).debajo).toBeGreaterThan(0.9);
  });

  it("el WAV se escribe y se lee igual, y se puede quitar el silencio de los bordes", () => {
    const x = new Float32Array(SR);
    x.set(seno(500, 0.5, 0.2), SR * 0.3);
    const { sr, L, R } = leerWav(escribirWav(x, x, SR));
    expect(sr).toBe(SR);
    expect(L.length).toBe(SR);
    expect(L[Math.round(SR * 0.3) + 10]).toBeCloseTo(x[Math.round(SR * 0.3) + 10] ?? 0, 3);
    const [a, b] = tramoQueSuena(L, R);
    expect(a / SR).toBeGreaterThan(0.29);
    expect(b / SR).toBeLessThan(0.51);
    expect(aDb(0.5)).toBeCloseTo(-6.02, 1);
  });
});
