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

describe("las claves de la página que usa la tarjeta de confirmar el correo", () => {
  it("existen y también las usa algún archivo de la página sin import(), así el armado las mete en el HTML", () => {
    const delaTarjeta = ["confirmar.ts", "confirmar-estado.ts"].map((f) => readFileSync(`src/campana/${f}`, "utf8")).join("\n");
    const claves = new Set([...delaTarjeta.matchAll(/["'](cp[A-Z][A-Za-z0-9]*)["']/gu)].map((m) => m[1] ?? ""));
    expect(claves.size).toBeGreaterThan(0);
    // La tarjeta se baja con import(): lo que se ve en el HTML es lo que usan los archivos de la página.
    const delaPagina = archivosDeLaPagina().filter((f) => !/confirmar|sesion-confirmar/u.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const clave of claves) {
      expect(clave in TEXTOS_CAMPANA.es && clave in TEXTOS_CAMPANA.en, clave).toBe(true);
      expect(delaPagina.includes(`"${clave}"`) || delaPagina.includes(`'${clave}'`), clave).toBe(true);
    }
  });

  it("la tarjeta y sus archivos no están en lo que la página importa sin import()", () => {
    const sueltos = archivosDeLaPagina().filter((f) => /confirmar/u.test(f));
    expect(sueltos).toEqual([]);
  });
});
