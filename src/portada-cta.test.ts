import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El botón principal de la portada, en celulares angostos (punto 3 del pulido
 * del sitio). A 360 px "Entrar y sortear gratis" se parte en dos renglones:
 * el texto tiene que quedar centrado, no alineado a la izquierda.
 */
describe("el botón principal de la portada", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  it("el texto del botón va centrado cuando se parte", () => {
    const entrar = /\.cta-entrar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(entrar).toContain("text-align: center");
    const texto = /\.cta-entrar \.cta-t\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(texto).toContain("text-align: center");
  });
});
