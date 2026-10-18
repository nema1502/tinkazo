import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Las páginas que no son la herramienta reciben al construir solo los textos
 * de sus `data-i*` (ver `textosPorPagina` en vite.config.ts). Una clave del
 * markup que no es una cadena en los dos idiomas se queda con el texto del
 * HTML, en español, también en inglés: mejor que falle acá.
 */
describe("textos de las páginas", () => {
  const paginas = readdirSync(".").filter((f) => f.endsWith(".html"));

  it("hay páginas que revisar", () => {
    expect(paginas.length).toBeGreaterThan(5);
  });

  it("cada clave del markup es una cadena en español y en inglés", () => {
    const faltan = paginas.flatMap((p) =>
      [...readFileSync(p, "utf8").matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria|label-i)="([^"]+)"/g)]
        .map((m) => m[1] as string)
        .filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string")
        .map((k) => `${p}: ${k}`),
    );
    expect(faltan).toEqual([]);
  });
});
