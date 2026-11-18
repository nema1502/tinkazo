import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/campana/campana.css", "utf8");
const acentos = ["rojo", "naranja", "amarillo", "verde", "azul", "morado"];

function variablesDe(bloque: string | undefined): string[] {
  return [...(bloque ?? "").matchAll(/--cmp-([a-z]+):/gu)].map((coincidencia) => coincidencia[1] ?? "");
}

describe("los acentos de campaña en tema oscuro", () => {
  it("aplican los seis acentos cuando la página fuerza el tema oscuro", () => {
    const bloque = /:root\[data-theme="dark"\]\s*\{([^}]+)\}/u.exec(css)?.[1];
    expect(variablesDe(bloque).sort()).toEqual(acentos.sort());
  });

  it("aplican los seis acentos cuando el sistema pide oscuro y la página no fuerza claro", () => {
    const bloque = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([^}]+)\}/u;
    expect(variablesDe(bloque.exec(css)?.[1]).sort()).toEqual(acentos.sort());
  });

  it("no depende de una clase que el sitio no usa", () => {
    expect(css).not.toContain("html.dark");
  });
});
