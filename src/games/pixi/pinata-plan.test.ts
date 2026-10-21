import { describe, expect, it } from "vitest";
import { planPalos } from "./pinata-plan";

const sueltan = (ps: ReturnType<typeof planPalos>): number[] => ps.filter((p) => !p.miss).map((p) => p.take);
const fallos = (ps: ReturnType<typeof planPalos>): number => ps.filter((p) => p.miss).length;

describe("planPalos: palos que sueltan y fallos", () => {
  it("reparte todos los caramelos que caen, sin perder ninguno", () => {
    for (const caen of [0, 1, 2, 3, 5, 8, 12, 40, 150, 198]) {
      for (const base of [5, 6, 7, 8, 9]) {
        for (const rem of [false, true]) {
          const total = sueltan(planPalos(caen, base, rem)).reduce((a, b) => a + b, 0);
          expect(total).toBe(caen);
        }
      }
    }
  });

  it("nunca hay un palo vacío que no sea un fallo: cada palo que suelta tiene a alguien", () => {
    for (const caen of [1, 2, 3, 4, 5, 6, 7, 10, 60, 199]) {
      for (const base of [5, 9]) {
        for (const p of planPalos(caen, base, false)) {
          if (!p.miss) expect(p.take).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("con poca gente hay un fallo antes de cada palo que suelta (y no palos al aire)", () => {
    for (const caen of [1, 2, 3, 4]) {
      const ps = planPalos(caen, 5, false);
      expect(sueltan(ps).length).toBe(caen);
      expect(fallos(ps)).toBe(caen);
    }
  });

  it("con dos personas (ningún caramelo que soltar) hay dos fallos y ningún palo que suelte", () => {
    const ps = planPalos(0, 5, false);
    expect(ps.length).toBe(2);
    expect(ps.every((p) => p.miss)).toBe(true);
  });

  it("con mucha gente, los primeros palos sueltan más que los últimos y son los de base", () => {
    const ps = planPalos(199, 9, false);
    const golpes = sueltan(ps);
    expect(golpes.length).toBe(9);
    expect(golpes[0] as number).toBeGreaterThan(golpes[8] as number);
    expect(fallos(ps)).toBe(0);
  });

  it("la remontada mete dos fallos antes del penúltimo palo", () => {
    const sin = planPalos(40, 7, false);
    const con = planPalos(40, 7, true);
    expect(fallos(con)).toBe(fallos(sin) + 2);
    expect(sueltan(con)).toEqual(sueltan(sin));
  });

  it("los tiempos entre palos quedan dentro de lo que la sala puede seguir", () => {
    for (const p of planPalos(199, 9, true)) {
      expect(p.wait).toBeGreaterThanOrEqual(0.75);
      expect(p.wait).toBeLessThanOrEqual(1.9);
    }
  });
});
