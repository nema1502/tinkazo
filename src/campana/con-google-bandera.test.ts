import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campanasConGoogleActivo } from "./con-google-bandera";

/** La entrada de una página y todo lo que importa sin import(), como lo recorre el armado del sitio. */
function archivosDe(entrada: string): string[] {
  const vistos = new Set<string>();
  const pendientes = [resolve(entrada)];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop() as string;
    if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
    vistos.add(archivo);
    const importaciones = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gmu;
    for (const m of readFileSync(archivo, "utf8").matchAll(importaciones)) {
      const base = resolve(dirname(archivo), m[1] ?? "");
      const candidato = [base, `${base}.ts`, resolve(base, "index.ts")].find((c) => existsSync(c) && statSync(c).isFile());
      if (candidato) pendientes.push(candidato);
    }
  }
  return [...vistos];
}

describe("la bandera de las campañas con Google", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("nace apagada", () => {
    expect(campanasConGoogleActivo({})).toBe(false);
    expect(campanasConGoogleActivo()).toBe(false);
  });

  it("sin pasarle nada lee las dos variables de construcción por su nombre", () => {
    vi.stubEnv("VITE_CAMPANAS_CON_GOOGLE", "1");
    expect(campanasConGoogleActivo()).toBe(false);
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    expect(campanasConGoogleActivo()).toBe(true);
    vi.stubEnv("VITE_CAMPANAS_CON_GOOGLE", "");
    expect(campanasConGoogleActivo()).toBe(false);
  });

  it("la bandera nueva sola no hace nada, y la de anotarse sin billetera sola tampoco", () => {
    expect(campanasConGoogleActivo({ VITE_CAMPANAS_CON_GOOGLE: "1" })).toBe(false);
    expect(campanasConGoogleActivo({ VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBe(false);
    expect(campanasConGoogleActivo({ VITE_CAMPANAS_CON_GOOGLE: "1", VITE_ANOTARSE_SIN_BILLETERA: "1" })).toBe(true);
  });

  it("solo el 1 exacto la prende, en cada una de las dos", () => {
    for (const valor of ["", "0", "true", "si", " 1", "1 ", "11", 1, true, null, undefined]) {
      expect(campanasConGoogleActivo({ VITE_CAMPANAS_CON_GOOGLE: valor, VITE_ANOTARSE_SIN_BILLETERA: "1" }), `nueva en ${String(valor)}`).toBe(false);
      expect(campanasConGoogleActivo({ VITE_CAMPANAS_CON_GOOGLE: "1", VITE_ANOTARSE_SIN_BILLETERA: valor }), `la otra en ${String(valor)}`).toBe(false);
    }
  });

  it("el archivo no importa nada y nombra cada variable entera, para que el armado reemplace solo esas dos", () => {
    const fuente = readFileSync("src/campana/con-google-bandera.ts", "utf8");
    expect(fuente).toContain("import.meta.env.VITE_CAMPANAS_CON_GOOGLE");
    expect(fuente).toContain("import.meta.env.VITE_ANOTARSE_SIN_BILLETERA");
    expect(fuente).not.toMatch(/^\s*import\s/mu);
  });

  it("la página del celular no la carga: su entrada está al tope de peso", () => {
    const delCelular = archivosDe("src/participar.ts");
    expect(delCelular.length).toBeGreaterThan(5);
    expect(delCelular.filter((archivo) => /con-google-bandera/u.test(archivo))).toEqual([]);
  });
});
