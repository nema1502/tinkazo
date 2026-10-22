import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La línea de estado bajo los botones (`.txstatus`, styles.css) tiene tres
// colores: violeta mientras la transacción va, turquesa cuando quedó y naranja
// cuando falló. El error del sello salía con el borde violeta, como si siguiera
// en curso, y el del sorteo con el naranja (21 de octubre de 2026).
describe("la línea de estado de las transacciones", () => {
  it("todo error que se escribe lleva el borde naranja, el del sello y el del sorteo", () => {
    for (const f of ["src/ui/freeze.ts", "src/ui/draw.ts"]) {
      const src = readFileSync(f, "utf8");
      const llamadas = [...src.matchAll(/escribirError\(/g)].map((m) => m.index ?? 0);
      expect(llamadas.length).toBeGreaterThan(0);
      for (const i of llamadas) {
        const clase = [...src.slice(0, i).matchAll(/className = "([^"]*)"/g)].pop()?.[1];
        expect(clase, `${f}: la clase de la línea antes de escribir el error`).toBe("txstatus bad");
      }
    }
  });

  it("cada color dice lo mismo en la hoja de estilos", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.txstatus\s*\{[^}]*border-left:[^;]*var\(--purple\)/);
    expect(css).toMatch(/\.txstatus\.ok\s*\{\s*border-left-color:\s*var\(--teal\)/);
    expect(css).toMatch(/\.txstatus\.bad\s*\{\s*border-left-color:\s*var\(--orange\)/);
  });
});
