import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aplicarElecciones, CLAVE_MEZCLA, eleccionesDeLaPagina, leerElegidas, PIEZAS, textoDeElegidas, valorDeElegida } from "./carrera-aplicar-lib.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hoy = Object.fromEntries([...PIEZAS, CLAVE_MEZCLA].map((p) => [p, "hoy"]));

describe("aplicar lo que se eligió escuchando", () => {
  it("lee las elecciones del formato que guarda la página (musica con clave carrera:pieza) y del nuevo (carrera.pieza)", () => {
    expect(eleccionesDeLaPagina({ musica: { "carrera:musica": "b", "carrera:final": "ninguno", otro: "x" } })).toEqual({ musica: "b", final: "ninguno" });
    expect(eleccionesDeLaPagina({ carrera: { pasos: "c", echarse: "z" } })).toEqual({ pasos: "c" });
    expect(eleccionesDeLaPagina({})).toEqual({});
  });

  it("'ninguno' es la música y el final de base (el ritmo nuevo y el silencio); en lo demás, lo de hoy", () => {
    expect(valorDeElegida("musica", "ninguno")).toBe("base");
    expect(valorDeElegida("final", "ninguno")).toBe("base");
    for (const p of ["pasos", "echarse", "obstaculos", "festejo"]) expect(valorDeElegida(p, "ninguno")).toBe("hoy");
    expect(valorDeElegida("pasos", "b")).toBe("b");
  });

  it("cambia lo que eligió, deja igual lo que no y avisa qué falta", () => {
    const r = aplicarElecciones(hoy, { musica: { "carrera:musica": "a", "carrera:pasos": "hoy", "carrera:festejo": "ninguno" } });
    expect(r.nuevas).toEqual({ ...hoy, musica: "a" });
    expect(r.cambios).toEqual([{ pieza: "musica", de: "hoy", a: "a", dijo: "a" }]);
    expect(r.faltan).toEqual(["echarse", "obstaculos", "final", "bomboBajo"]);
  });

  it("'base' solo vale en la música y en el final: en las demás piezas la carrera no lo lee, así que no se acepta", () => {
    expect(eleccionesDeLaPagina({ musica: { "carrera:musica": "base", "carrera:final": "base" } })).toEqual({ musica: "base", final: "base" });
    for (const p of ["pasos", "echarse", "obstaculos", "festejo"]) {
      expect(eleccionesDeLaPagina({ musica: { [`carrera:${p}`]: "base" } })).toEqual({});
      expect(eleccionesDeLaPagina({ carrera: { [p]: "base" } })).toEqual({});
      // Aunque llegara hasta valorDeElegida, no se escribe: queda en lo de hoy.
      expect(valorDeElegida(p, "base")).toBe("hoy");
      // Y 'ninguno' sigue siendo lo de hoy.
      expect(eleccionesDeLaPagina({ carrera: { [p]: "ninguno" } })).toEqual({ [p]: "ninguno" });
    }
    const r = aplicarElecciones(hoy, { carrera: { pasos: "base", musica: "base" } });
    expect(r.nuevas).toEqual({ ...hoy, musica: "base" });
    expect(r.faltan).toContain("pasos");
  });

  it("el archivo escrito con 'base' en una pieza que no la usa no se lee: falla fuerte", () => {
    for (const p of ["pasos", "echarse", "obstaculos", "festejo"]) {
      const roto = textoDeElegidas({ ...hoy, [p]: "base" });
      expect(() => leerElegidas(roto)).toThrow(new RegExp(p));
    }
    expect(leerElegidas(textoDeElegidas({ ...hoy, musica: "base", final: "base" }))).toEqual({ ...hoy, musica: "base", final: "base" });
  });

  it("el bombo y el bajo se guardan con su propia clave y valen 'hoy' o 'chico'", () => {
    expect(CLAVE_MEZCLA).toBe("bomboBajo");
    expect(eleccionesDeLaPagina({ musica: { "carrera:bomboBajo": "chico" } })).toEqual({ bomboBajo: "chico" });
    expect(eleccionesDeLaPagina({ carrera: { bomboBajo: "hoy" } })).toEqual({ bomboBajo: "hoy" });
    expect(eleccionesDeLaPagina({ musica: { "carrera:bomboBajo": "ninguno" } })).toEqual({ bomboBajo: "ninguno" });
    // 'a', 'b', 'c' y 'base' son de las piezas del show: acá no significan nada.
    for (const raro of ["a", "base", "grande"]) expect(eleccionesDeLaPagina({ musica: { "carrera:bomboBajo": raro } })).toEqual({});
    expect(valorDeElegida(CLAVE_MEZCLA, "ninguno")).toBe("hoy");
    expect(valorDeElegida(CLAVE_MEZCLA, "chico")).toBe("chico");
  });

  it("si elige 'parlante chico' pasa a valer también sin candidatas; si elige 'hoy' o 'ninguno', queda condicionado", () => {
    const chico = aplicarElecciones(hoy, { musica: { "carrera:bomboBajo": "chico" } });
    expect(chico.nuevas).toEqual({ ...hoy, bomboBajo: "chico" });
    expect(chico.cambios).toEqual([{ pieza: "bomboBajo", de: "hoy", a: "chico", dijo: "chico" }]);
    for (const dijo of ["hoy", "ninguno"]) {
      const sigue = aplicarElecciones({ ...hoy, bomboBajo: "chico" }, { musica: { "carrera:bomboBajo": dijo } });
      expect(sigue.nuevas.bomboBajo).toBe("hoy");
      expect(sigue.cambios).toEqual([{ pieza: "bomboBajo", de: "chico", a: "hoy", dijo }]);
    }
    // Sin elegir, queda como está.
    expect(aplicarElecciones({ ...hoy, bomboBajo: "chico" }, {}).nuevas.bomboBajo).toBe("chico");
  });

  it("el texto escrito se lee de vuelta igual, y el archivo del repo de hoy es todo 'hoy'", () => {
    const elegidas = { ...hoy, musica: "c", final: "base", pasos: "b", bomboBajo: "chico" };
    expect(leerElegidas(textoDeElegidas(elegidas))).toEqual(elegidas);
    const delRepo = readFileSync(join(RAIZ, "src", "sonidos", "carrera-elegidas.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(leerElegidas(delRepo)).toEqual(hoy);
    expect(textoDeElegidas(hoy)).toBe(delRepo);
  });

  it("falla fuerte si el archivo no tiene una pieza", () => {
    expect(() => leerElegidas(`export const ELEGIDAS = {\n  musica: "hoy",\n}`)).toThrow(/pasos/);
    const sinMezcla = textoDeElegidas(hoy).replace(/export const BOMBO_Y_BAJO[^\n]*\n/, "");
    expect(() => leerElegidas(sinMezcla)).toThrow(/BOMBO_Y_BAJO/);
  });
});
