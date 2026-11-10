import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leerNiveles, nuevosNiveles, textoDeNiveles } from "./carrera-calibrar-lib.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("calibrar el volumen de las candidatas", () => {
  it("sube lo que suena bajo y baja lo que suena alto, la mayor parte de la diferencia, sin tocar 'el de hoy'", () => {
    const { nuevos, cambios } = nuevosNiveles(
      { "musica/a": { trim: 2 }, "pasos/a": { nivel: 1, trim: 1 }, "pasos/b": { nivel: 1 } },
      [
        { pieza: "musica", eleccion: "a", correccionDb: 6 },
        { pieza: "musica", eleccion: "hoy", correccionDb: 12 },
        { pieza: "pasos", eleccion: "a", correccionDb: -6 },
      ],
    );
    expect(nuevos["musica/a"]?.trim).toBeCloseTo(2 * Math.pow(10, (6 * 0.85) / 20), 1);
    expect(nuevos["pasos/a"]?.nivel).toBeLessThan(1);
    expect(nuevos["pasos/a"]?.trim).toBeLessThan(1);
    expect(nuevos["pasos/b"]).toEqual({ nivel: 1 });
    expect(cambios.map((c) => c.clave)).toEqual(["musica/a", "pasos/a"]);
  });

  it("no pasa del tope ni baja de lo audible", () => {
    const { nuevos } = nuevosNiveles({ "pasos/a": { nivel: 8, trim: 0.1 } }, [{ pieza: "pasos", eleccion: "a", correccionDb: 40 }]);
    expect(nuevos["pasos/a"]?.nivel).toBe(12);
    const { nuevos: bajos } = nuevosNiveles({ "pasos/a": { nivel: 0.1 } }, [{ pieza: "pasos", eleccion: "a", correccionDb: -40 }]);
    expect(bajos["pasos/a"]?.nivel).toBe(0.05);
  });

  it("el texto escrito se lee de vuelta igual, y el archivo del repo trae una entrada por cada candidata", () => {
    const n = { "musica/a": { trim: 3.12 }, "pasos/b": { nivel: 4.5, trim: 1 } };
    expect(leerNiveles(textoDeNiveles(n))).toEqual(n);
    const delRepo = leerNiveles(readFileSync(join(RAIZ, "src", "sonidos", "carrera-niveles.ts"), "utf8"));
    for (const pieza of ["pasos", "echarse", "obstaculos", "final", "festejo"]) for (const id of ["a", "b", "c"]) expect(delRepo[`${pieza}/${id}`], `${pieza}/${id}`).toBeDefined();
    for (const id of ["base", "a", "b", "c"]) expect(delRepo[`musica/${id}`]?.trim, `musica/${id}`).toBeGreaterThan(0);
  });
});
