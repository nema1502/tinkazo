import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** La configuración se evalúa al cargar el diccionario: no puede arrastrar interfaz ni estado de la cuenta. */
describe("las dependencias de la configuración del modo", () => {
  const fuente = readFileSync(new URL("./config.ts", import.meta.url), "utf8");

  it("config.ts no importa nada de src/ui", () => {
    const importes = [...fuente.matchAll(/^\s*(?:import|export)\s[^"']*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(importes.filter((ruta) => ruta?.startsWith("../ui/"))).toEqual([]);
    expect(fuente).not.toMatch(/^\s*import\s*["']\.\.\/ui\//m);
    expect(fuente).not.toMatch(/["']\.\.\/ui\//);
  });
});
