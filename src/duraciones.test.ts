import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARRERA_CARRILES, CARRERA_FINAL, CARRERA_FIJOS, hayPeloton, normalCarrera, segundosDe } from "./duraciones";
import { duracionPeloton } from "./games/llamas/peloton-plan";

describe("normalCarrera: cuánto dura la carrera según la gente", () => {
  it("con 8 o menos y con más de 30 no cambia: sigue valiendo lo de todos los juegos", () => {
    for (const n of [0, 1, 2, 8, 31, 60, 200]) expect(normalCarrera(n)).toBeNull();
    expect(hayPeloton(8)).toBe(false);
    expect(hayPeloton(9)).toBe(true);
    expect(hayPeloton(30)).toBe(true);
    expect(hayPeloton(31)).toBe(false);
  });
  it("crece con la gente y con 30 son unos 90 segundos de show", () => {
    let prev = 0;
    for (let n = 9; n <= 30; n++) {
      const v = normalCarrera(n) as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(normalCarrera(30)).toBeGreaterThanOrEqual(85);
    expect(normalCarrera(30)).toBeLessThanOrEqual(95);
    expect(normalCarrera(9)).toBeLessThan(50);
  });
  it("es contenido y no cámara lenta: el estiramiento queda entre 0,55 y 1,45 en los tres ritmos", () => {
    for (let n = 9; n <= 30; n++) {
      const normal = normalCarrera(n) as number;
      const nominal = duracionPeloton(n) + CARRERA_CARRILES + CARRERA_FINAL;
      for (const p of ["rapido", "normal", "epico"] as const) {
        const util = segundosDe(p, normal) - CARRERA_FIJOS;
        const estira = Math.max(0.55, Math.min(2.2, util / nominal));
        // Lo que se pide es lo que se obtiene, salvo el piso del ritmo rápido (no hay forma de ir más de prisa que 0,55).
        if (p !== "rapido") expect(estira).toBeCloseTo(util / nominal, 6);
        expect(util / nominal).toBeLessThan(1.45);
        expect(util / nominal).toBeGreaterThan(p === "rapido" ? 0.4 : 0.8);
      }
    }
  });
  it("los tres ritmos: rápido es la mitad (no menos de 20), épico un 18 % más", () => {
    expect(segundosDe("rapido", 87)).toBe(44);
    expect(segundosDe("rapido", 30)).toBe(20);
    expect(segundosDe("normal", 87)).toBe(87);
    expect(segundosDe("epico", 87)).toBe(103);
  });
});

describe("los auditores prometen lo mismo que el juego", () => {
  it("la tabla de audit-rigor es la de normalCarrera", () => {
    const fuente = readFileSync(new URL("../scripts/audit-rigor.mjs", import.meta.url), "utf8");
    const m = /const NORMAL_CARRERA = (\{[^}]*\});/.exec(fuente);
    expect(m).not.toBeNull();
    const tabla = new Function(`return (${m?.[1] ?? "{}"})`)() as Record<number, number>;
    for (let n = 9; n <= 30; n++) expect(tabla[n]).toBe(normalCarrera(n));
    expect(Object.keys(tabla).length).toBe(22);
  });
});
