/** Comprueba que el armado del diccionario vea todas las claves que usa participar.html. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXTOS_CAMPANA } from "./textos";

function resolver(desde: string, especificador: string): string | null {
  const base = resolve(dirname(desde), especificador);
  for (const candidato of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return null;
}

function archivosDeLaPagina(): string[] {
  const vistos = new Set<string>();
  const pendientes = [resolve("src/participar.ts")];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop() as string;
    if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
    vistos.add(archivo);
    const codigo = readFileSync(archivo, "utf8");
    const importaciones = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gmu;
    for (const coincidencia of codigo.matchAll(importaciones)) {
      const resuelto = resolver(archivo, coincidencia[1] ?? "");
      if (resuelto) pendientes.push(resuelto);
    }
  }
  return [...vistos];
}

describe("las claves de texto de participar.html", () => {
  it("existen en español y en inglés en todos los archivos importados sin import()", () => {
    const faltantes: string[] = [];
    for (const archivo of archivosDeLaPagina()) {
      const codigo = readFileSync(archivo, "utf8");
      for (const coincidencia of codigo.matchAll(/(["'])(cp[A-Z][A-Za-z0-9]*)\1/gu)) {
        const clave = coincidencia[2] ?? "";
        if (!(clave in TEXTOS_CAMPANA.es) || !(clave in TEXTOS_CAMPANA.en)) {
          faltantes.push(`${archivo}: ${clave}`);
        }
      }
    }
    expect(faltantes).toEqual([]);
  });

  it("no arma claves con plantillas porque el diccionario solo reconoce cadenas literales", () => {
    const conPlantillas = archivosDeLaPagina().filter((archivo) => {
      return /`cp[A-Z]/u.test(readFileSync(archivo, "utf8"));
    });
    expect(conPlantillas).toEqual([]);
  });
});
