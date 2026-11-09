import { describe, expect, it } from "vitest";
import { DUR_FINAL } from "./carrera-base";
import { RECTA_MEDIA, qDeSegundos, segundosDeQ } from "./carrera-ritmo";

/** El reloj de la recta: más tiempo en el final, la misma duración, sin saltos de velocidad. */
describe("el reloj de la recta", () => {
  it("la recta dura DUR_FINAL y el promedio con la cámara lenta del duelo es el que usa la duración anunciada", () => {
    expect(segundosDeQ(0)).toBe(0);
    expect(segundosDeQ(1)).toBeCloseTo(DUR_FINAL, 6);
    // Lo que se anunciaba antes (15 s y el 1,4 % del duelo) sigue siendo lo que dura la recta, con décimos de diferencia.
    expect(RECTA_MEDIA).toBeGreaterThan(15.1);
    expect(RECTA_MEDIA).toBeLessThan(15.3);
  });

  it("el final se ve más tiempo: del 90 % a la meta pasan casi tres segundos, y del 88 %, más de tres", () => {
    expect(segundosDeQ(1) - segundosDeQ(0.9)).toBeGreaterThan(2.8);
    expect(segundosDeQ(1) - segundosDeQ(0.88)).toBeGreaterThan(3.3);
    // Con la pista pareja eran 1,5 s y 1,8 s.
    expect(segundosDeQ(1) - segundosDeQ(0.9)).toBeGreaterThan(DUR_FINAL * 0.1 * 1.8);
  });

  it("frena sin saltos: la velocidad de la pista cambia de a poco y nunca se frena a menos de la mitad", () => {
    const paso = 0.002;
    let previa = 0, maxCambio = 0, minima = Infinity, maxima = 0;
    for (let q = paso; q <= 1; q += paso) {
      const v = paso / (segundosDeQ(q) - segundosDeQ(q - paso));
      if (previa) maxCambio = Math.max(maxCambio, Math.abs(v - previa) / previa);
      previa = v;
      minima = Math.min(minima, v);
      maxima = Math.max(maxima, v);
    }
    expect(maxCambio).toBeLessThan(0.02);
    expect(minima / maxima).toBeGreaterThan(0.43);
    expect(minima / maxima).toBeLessThan(0.5);
  });

  it("el duelo frena un poco más desde la foto, y el reloj se invierte", () => {
    const foto = 0.962;
    expect(segundosDeQ(1, foto)).toBeGreaterThan(segundosDeQ(1));
    expect(segundosDeQ(foto, foto)).toBeCloseTo(segundosDeQ(foto), 9);
    for (const f of [2, foto]) {
      let previo = -1;
      for (let q = 0; q <= 1; q += 0.01) {
        const s = segundosDeQ(q, f);
        expect(s).toBeGreaterThanOrEqual(previo);
        previo = s;
        expect(qDeSegundos(s, f)).toBeCloseTo(q, 6);
      }
    }
    expect(qDeSegundos(-1)).toBe(0);
    expect(qDeSegundos(99)).toBe(1);
  });
});
