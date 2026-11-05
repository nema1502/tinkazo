import { describe, expect, it } from "vitest";
import { CUADRO_MAX, PASO_MAX, pasosDelCuadro } from "./reloj-cuadro";

const suma = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("pasosDelCuadro", () => {
  it("a fast frame is a single step of its own length", () => {
    expect(pasosDelCuadro(1 / 60)).toEqual([1 / 60]);
    expect(pasosDelCuadro(PASO_MAX)).toEqual([PASO_MAX]);
  });

  it("a slow frame is split into steps of at most 50 ms that add up to the frame", () => {
    // The S72r public case: frames every ~109 ms on a slow device.
    const pasos = pasosDelCuadro(0.109);
    expect(pasos).toHaveLength(3);
    expect(pasos.slice(0, 2)).toEqual([PASO_MAX, PASO_MAX]);
    expect(pasos[2]).toBeCloseTo(0.009, 12);
    expect(suma(pasos)).toBeCloseTo(0.109, 12);
    for (const p of pasos) expect(p).toBeLessThanOrEqual(PASO_MAX);
  });

  it("caps a frame at 250 ms so returning from a background tab does not skip the show", () => {
    expect(CUADRO_MAX).toBe(0.25);
    const pasos = pasosDelCuadro(12);
    expect(pasos).toEqual([PASO_MAX, PASO_MAX, PASO_MAX, PASO_MAX, PASO_MAX]);
    expect(suma(pasosDelCuadro(0.268))).toBeCloseTo(CUADRO_MAX, 12);
  });

  it("no elapsed time, negative or invalid time gives no steps", () => {
    expect(pasosDelCuadro(0)).toEqual([]);
    expect(pasosDelCuadro(-0.02)).toEqual([]);
    expect(pasosDelCuadro(Number.NaN)).toEqual([]);
  });

  it("game time keeps up with wall time at 9 fps, unlike the old single capped step", () => {
    // 41 s of frames every 109 ms: before, each frame advanced only 50 ms of game time.
    const cuadros = Math.round(41 / 0.109);
    const antes = cuadros * Math.min(PASO_MAX, 0.109);
    const ahora = cuadros * suma(pasosDelCuadro(0.109));
    expect(antes / 41).toBeLessThan(0.5);
    expect(ahora / 41).toBeCloseTo(1, 2);
  });

  it("a step sequence at 9 fps is the same kind of sequence a fast device produces", () => {
    // A deterministic integrator fed sub-steps reaches the same place as one fed 20 fps frames.
    const integrar = (pasos: number[]): number => {
      let x = 0;
      let v = 1;
      for (const dt of pasos) {
        v += -0.3 * v * dt;
        x += v * dt;
      }
      return x;
    };
    const lento = Array.from({ length: 40 }, () => pasosDelCuadro(0.1)).flat();
    const rapido = Array.from({ length: 80 }, () => pasosDelCuadro(0.05)).flat();
    expect(lento).toEqual(rapido);
    expect(integrar(lento)).toBe(integrar(rapido));
  });
});
