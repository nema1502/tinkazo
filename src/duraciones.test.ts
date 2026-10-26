import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARRERA_FIJOS, CARRERA_TARJETA, hayPeloton, normalCarrera, segundosDe } from "./duraciones";
import { duracionNominal } from "./games/llamas/carrera-show";

describe("normalCarrera: cuánto dura la carrera según la gente", () => {
  it("con menos de dos no hay a quién contar; con 8 o menos no hay grupo que se eche", () => {
    for (const n of [0, 1]) expect(normalCarrera(n)).toBeNull();
    expect(hayPeloton(8)).toBe(false);
    expect(hayPeloton(9)).toBe(true);
    expect(hayPeloton(200)).toBe(true);
  });
  it("nunca pasa de 90 segundos de show, con ninguna cantidad de 2 a 200", () => {
    for (let n = 2; n <= 200; n++) expect(normalCarrera(n) as number, `con ${n}`).toBeLessThanOrEqual(90);
  });
  it("crece con la gente hasta 30 y con 18 son poco más de un minuto", () => {
    let prev = 0;
    for (let n = 9; n <= 30; n++) {
      const v = normalCarrera(n) as number;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(normalCarrera(18)).toBeGreaterThanOrEqual(45);
    expect(normalCarrera(18)).toBeLessThanOrEqual(70);
    expect(normalCarrera(9)).toBeLessThan(normalCarrera(30) as number);
  });
  it("es contenido y no cámara lenta: el estiramiento queda entre 0,85 y 1,45 y Normal no aprieta nada", () => {
    for (const n of [2, 5, 9, 18, 30, 60, 200]) {
      const normal = normalCarrera(n) as number;
      const nominal = duracionNominal(n);
      for (const p of ["rapido", "normal", "epico"] as const) {
        const util = segundosDe(p, normal) - CARRERA_FIJOS - CARRERA_TARJETA;
        expect(util / nominal).toBeLessThan(1.45);
        // Rápido no baja de 0,85: con 1,5 s nominales entre echadas (1,2 con el desorden) quedan 1 s o más de verdad.
        // Con 8 o menos no hay echadas y el redondeo de un show corto pesa más: ahí alcanza con 0,84.
        expect(util / nominal).toBeGreaterThan(p === "rapido" ? (hayPeloton(n) ? 0.85 : 0.84) : 0.95);
      }
    }
  });
  it("los tres ritmos: rápido es el 90 % (no menos de 20), épico un 18 % más", () => {
    expect(segundosDe("rapido", 87)).toBe(78);
    expect(segundosDe("rapido", 20)).toBe(20);
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
    for (const n of Object.keys(tabla).map(Number)) expect(tabla[n]).toBe(normalCarrera(n));
    expect(Object.keys(tabla).length).toBeGreaterThanOrEqual(22);
  });
});

describe("la portada no baja el show de la carrera", () => {
  // `duraciones.ts` lo carga la portada (el selector de duración); el plan de la carrera, el director de cámara
  // del kit y lo que trae (unos 25 kB minificados) tienen que esperar a que se juegue. Lo único que puede
  // importar es `carrera-duracion.ts`, y ese solo las medidas, las tandas y los tiempos.
  const importes = (archivo: string): string[] => [...readFileSync(new URL(archivo, import.meta.url), "utf8").matchAll(/^\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/gm)].map((m) => m[1] as string);

  it("duraciones.ts solo importa carrera-duracion", () => {
    expect(importes("./duraciones.ts")).toEqual(["./games/llamas/carrera-duracion"]);
  });
  it("carrera-duracion.ts solo importa las medidas, las tandas y los tiempos", () => {
    expect(importes("./games/llamas/carrera-duracion.ts").sort()).toEqual(["./carrera-base", "./carrera-tandas", "./carrera-tiempos"]);
  });
  it("y esos tres no traen el plan ni la cámara", () => {
    for (const f of ["carrera-base", "carrera-tandas", "carrera-tiempos"]) {
      for (const dep of importes(`./games/llamas/${f}.ts`)) expect(["./carrera-base", "./carrera-tiempos", "../nombres"], `${f} importa ${dep}`).toContain(dep);
    }
  });
});
