import { describe, expect, it } from "vitest";
import { datosVacios, registrarNota, registrarTick, texto } from "./diag-audio";

describe("diagnóstico de la música (?diag=audio, solo la rama de prueba de la VPS)", () => {
  it("cuenta los ticks tardíos y el peor intervalo", () => {
    const d = datosVacios();
    for (const ms of [40, 300, 1500, 40]) registrarTick(d, { intervaloMs: ms, margen: 0.5, hueco: 0, escondida: false, deriva: 0 });
    expect(d.ticks).toBe(4);
    expect(d.peorTickMs).toBe(1500);
    expect(d.ticksSobre220).toBe(2);
    expect(d.ticksSobre1000).toBe(1);
    expect(d.margenMax).toBe(0.5);
  });

  it("un hueco es la música que se quedó sin notas antes del tick: se cuenta, se suma y se guarda el peor", () => {
    const d = datosVacios();
    registrarTick(d, { intervaloMs: 900, margen: 0.6, hueco: 0.3, escondida: false, deriva: 0 });
    registrarTick(d, { intervaloMs: 40, margen: 0.6, hueco: 0.001, escondida: false, deriva: 0 });
    registrarTick(d, { intervaloMs: 1400, margen: 1, hueco: 0.4, escondida: false, deriva: 0 });
    expect(d.huecos).toBe(2);
    expect(d.huecoTotal).toBeCloseTo(0.7, 9);
    expect(d.huecoMax).toBeCloseTo(0.4, 9);
  });

  it("con la pestaña escondida no cuenta nada: ahí el silencio es a propósito", () => {
    const d = datosVacios();
    registrarTick(d, { intervaloMs: 1000, margen: 0.22, hueco: 0.8, escondida: true, deriva: 0.9 });
    expect(d.ticks).toBe(1);
    expect(d.peorTickMs).toBe(0);
    expect(d.huecos).toBe(0);
    expect(d.derivaAudio).toBe(0);
  });

  it("acumula cuánto se atrasó el reloj del audio respecto del de la página", () => {
    const d = datosVacios();
    registrarTick(d, { intervaloMs: 40, margen: 0.22, hueco: 0, escondida: false, deriva: 0.02 });
    registrarTick(d, { intervaloMs: 40, margen: 0.22, hueco: 0, escondida: false, deriva: 0.03 });
    expect(d.derivaAudio).toBeCloseTo(0.05, 9);
  });

  it("cuenta las notas programadas y las descartadas por llegar tarde", () => {
    const d = datosVacios();
    registrarNota(d, false);
    registrarNota(d, false);
    registrarNota(d, true);
    expect(d.programadas).toBe(2);
    expect(d.descartadas).toBe(1);
  });

  it("el texto muestra lo que hace falta para la captura", () => {
    const d = datosVacios();
    registrarTick(d, { intervaloMs: 1200, margen: 1, hueco: 0.25, escondida: false, deriva: 0 });
    registrarNota(d, true);
    const t = texto(d, { estado: "running", latencia: 0.01, cortes: null });
    for (const s of ["peor tick 1200 ms", "ticks >1 s: 1", "margen 1.00 s", "huecos 1", "descartadas 1", "running"]) expect(t).toContain(s);
  });
});
