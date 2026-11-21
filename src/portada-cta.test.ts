import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

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

describe("el botón de entrar con Google en Oficial", () => {
  // Desde el 20 de noviembre de 2026 todo el que entra con Google recibe sus primeros sorteos oficiales gratis.
  it("dice que sortear es gratis, en los dos idiomas", () => {
    expect(T.es.ctaGoogle).toBe("Entrar con Google y sortear gratis");
    expect(T.en.ctaGoogle).toBe("Sign in with Google and draw for free");
  });

  it("el modo Prueba ya no se presenta como el gratis", () => {
    expect(T.es.modeTestBody).not.toMatch(/gratis/i);
    expect(T.en.modeTestBody).not.toMatch(/free/i);
  });
});
