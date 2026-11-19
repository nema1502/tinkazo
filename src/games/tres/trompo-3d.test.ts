import { readFileSync } from "node:fs";
import { DoubleSide, FrontSide, MeshLambertMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { crearMapa } from "./camara";
import { compararPuestos, type Puesto2D } from "./prueba";
import { APLASTADO_2D, LIM_RUEDO, PERFIL_TROMPO, parametrosLambert } from "./trompo-3d";
import { hash } from "./ids";

/**
 * El trompo en 3D no decide nada: dibuja lo que `pixi/trompo.ts` ya decidió. Estas pruebas cuidan que las cuentas del 3D
 * sean las del 2D (el ruedo, la tiza), que los trompos queden donde el 2D los pone y en el mismo orden, y que el archivo
 * del juego en 2D no traiga three.js.
 */

const dosD = readFileSync(new URL("../pixi/trompo.ts", import.meta.url), "utf8");

describe("el trompo en 3D usa las cuentas del 2D", () => {
  it("el aplastado y el borde del ruedo son los que están escritos en trompo.ts", () => {
    expect(dosD).toContain(`const SQUASH = ${APLASTADO_2D};`);
    expect(dosD).toContain(`const LIM = ${LIM_RUEDO};`);
    // Y la posición en el mundo 2D de un trompo es la que el 3D deshace (`toWorld`).
    expect(dosD).toContain("return { x: c.x + x * r, y: c.y + y * r * SQUASH };");
  });

  it("el archivo del juego en 2D solo importa tipos del 3D (no trae three.js ni el motor)", () => {
    const lineas = dosD.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l) && /tres\//.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      if (/tres\/(trompo-3d|tipos)/.test(l)) expect(l).toMatch(/^\s*import\s+type\b/);
      else expect(l).toContain("tres/enchufe");
    }
  });
});

describe("los materiales del trompo en 3D", () => {
  it("no reciben ninguna propiedad sin valor: side va solo en las piezas de dos caras y three.js no avisa", () => {
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // El testigo: three.js sí avisa cuando una propiedad llega sin valor, así que callar con las de abajo significa algo.
      new MeshLambertMaterial({ color: 0xffffff, side: undefined }).dispose();
      expect(avisos).toHaveBeenCalledTimes(1);
      avisos.mockClear();
      for (const doble of [false, true]) {
        const parametros = parametrosLambert(0xffffff, doble);
        expect(Object.values(parametros).every((v) => v !== undefined), `doble = ${doble}`).toBe(true);
        expect("side" in parametros).toBe(doble);
        const material = new MeshLambertMaterial(parametros);
        expect(material.side).toBe(doble ? DoubleSide : FrontSide);
        expect(material.flatShading).toBe(true);
        material.dispose();
      }
      expect(avisos).not.toHaveBeenCalled();
    } finally {
      avisos.mockRestore();
    }
  });
});

/** Dónde pone el 2D a un trompo del disco del ruedo (`toWorld` en trompo.ts). */
const toWorld = (cx: number, cy: number, r: number, x: number, y: number): { x: number; y: number } => ({ x: cx + x * r, y: cy + y * r * APLASTADO_2D });

describe("el ruedo y los trompos caen donde el 2D los pone", () => {
  for (const [w, h, u] of [[1366, 768, 768 / 720], [390, 844, Math.min(390 / 420, 844 / 900)], [1920, 1080, 1.5]] as const) {
    it(`a ${w} por ${h}: el ruedo es un círculo de verdad en el 3D y los puestos son los del 2D, en el mismo orden`, () => {
      const r = Math.min(h * 0.52, w * 0.34), cx = w / 2, cy = h * 0.54;
      const mapa = crearMapa(PERFIL_TROMPO, u);
      const [cx3, , cz3] = mapa.a3D(cx, cy);
      const R3 = r * mapa.s;
      // Un punto del borde de la tiza, en cualquier dirección, está a LIM radios del centro: el 2D lo aplasta y el 3D lo vuelve a estirar.
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const p = toWorld(cx, cy, r, Math.cos(a) * LIM_RUEDO, Math.sin(a) * LIM_RUEDO);
        const [x3, , z3] = mapa.a3D(p.x, p.y);
        expect(Math.hypot(x3 - cx3, z3 - cz3) / R3).toBeCloseTo(LIM_RUEDO, 9);
      }
      for (const n of [2, 3, 18, 60, 200]) {
        const puestos: Puesto2D[] = Array.from({ length: n }, (_, i) => {
          const a = hash(i, 1) * Math.PI * 2, d = Math.sqrt(hash(i, 2)) * 0.72;
          const p = toWorld(cx, cy, r, Math.cos(a) * d, Math.sin(a) * d);
          // Algunos vuelan (el que sacan del ruedo).
          return { id: i, x: p.x, y: p.y, alto: i % 5 === 0 ? hash(i, 3) * 60 : 0 };
        });
        expect(compararPuestos(puestos, PERFIL_TROMPO, u), `n = ${n}`).toEqual([]);
      }
    });
  }

  it("la cámara se baja al mismo ángulo con que el 2D aplasta el ruedo: el ruedo se ve con el mismo alto en la pantalla", () => {
    expect(Math.sin(PERFIL_TROMPO.elevacion)).toBeCloseTo(APLASTADO_2D, 12);
    expect(PERFIL_TROMPO.zc).toBeCloseTo(1 / APLASTADO_2D, 12);
    expect(PERFIL_TROMPO.azimut).toBe(0);
  });
});
