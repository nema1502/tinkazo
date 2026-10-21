import { describe, expect, it } from "vitest";
import { ATAQUE_GOLPE, suave, zoomDeEmocion, type Empuje, type Golpe } from "./zoom-emocion";

const empuje: Empuje = { t0: 2, dur: 3, amt: 0.06 };
const golpe: Golpe = { t0: 6, amt: 0.12, hold: 0.3, vuelta: 1 };

describe("zoom de emoción", () => {
  it("no hace nada sin empuje ni golpe", () => {
    for (const t of [0, 1, 5, 9]) expect(zoomDeEmocion(t, null, null)).toBe(0);
  });

  it("el empuje sube suave desde cero hasta su monto, y se queda ahí", () => {
    expect(zoomDeEmocion(empuje.t0, empuje, null)).toBe(0);
    let previo = 0;
    for (let t = empuje.t0; t <= empuje.t0 + empuje.dur; t += 0.1) {
      const z = zoomDeEmocion(t, empuje, null);
      expect(z).toBeGreaterThanOrEqual(previo - 1e-12);
      previo = z;
    }
    expect(zoomDeEmocion(empuje.t0 + empuje.dur, empuje, null)).toBeCloseTo(empuje.amt, 12);
    expect(zoomDeEmocion(empuje.t0 + empuje.dur + 4, empuje, null)).toBeCloseTo(empuje.amt, 12);
  });

  it("el golpe llega en una décima de segundo, se sostiene y vuelve suave", () => {
    expect(zoomDeEmocion(golpe.t0, null, golpe)).toBe(0);
    expect(zoomDeEmocion(golpe.t0 + ATAQUE_GOLPE, null, golpe)).toBeCloseTo(golpe.amt, 12);
    expect(zoomDeEmocion(golpe.t0 + golpe.hold, null, golpe)).toBeCloseTo(golpe.amt, 12);
    const mitad = zoomDeEmocion(golpe.t0 + golpe.hold + golpe.vuelta / 2, null, golpe);
    expect(mitad).toBeGreaterThan(0);
    expect(mitad).toBeLessThan(golpe.amt);
    expect(zoomDeEmocion(golpe.t0 + golpe.hold + golpe.vuelta, null, golpe)).toBeCloseTo(0, 12);
    expect(zoomDeEmocion(golpe.t0 + 10, null, golpe)).toBe(0);
  });

  it("la vuelta del golpe se lleva también el empuje, sin escalón", () => {
    const fin = golpe.t0 + golpe.hold + golpe.vuelta;
    const antes = zoomDeEmocion(fin - 1e-6, empuje, golpe);
    const despues = zoomDeEmocion(fin + 1e-6, empuje, golpe);
    expect(Math.abs(antes - despues)).toBeLessThan(1e-4);
    expect(zoomDeEmocion(fin + 0.5, empuje, golpe)).toBeCloseTo(0, 12);
  });

  it("el pico cae en el golpe: después del empuje, en la ventana de sostener", () => {
    let mejor = -1;
    let zMax = -Infinity;
    for (let t = 0; t <= 12; t += 0.01) {
      const z = zoomDeEmocion(t, empuje, golpe);
      if (z > zMax + 1e-12) {
        zMax = z;
        mejor = t;
      }
    }
    expect(mejor).toBeGreaterThanOrEqual(golpe.t0 + ATAQUE_GOLPE - 0.02);
    expect(mejor).toBeLessThanOrEqual(golpe.t0 + golpe.hold + 0.02);
  });

  it("la curva suave tiene pendiente cero en los extremos", () => {
    expect(suave(0)).toBe(0);
    expect(suave(1)).toBe(1);
    expect(suave(0.5)).toBe(0.5);
    expect(suave(-3)).toBe(0);
    expect(suave(7)).toBe(1);
  });

  it("es determinista: la misma hora da el mismo zoom", () => {
    for (let t = 0; t < 10; t += 0.07) {
      expect(zoomDeEmocion(t, empuje, golpe)).toBe(zoomDeEmocion(t, empuje, golpe));
    }
  });
});
