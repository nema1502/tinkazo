import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** El alto del botón principal de los diálogos: el global no cambia, y solo la ventana de los dólares digitales lo sube. */
const css = readFileSync("src/styles.css", "utf8");

describe("el botón principal de los diálogos", () => {
  it("el de todos los diálogos mide 48 px", () => {
    const regla = css.slice(css.indexOf("  .dlg-main {"), css.indexOf("  .dlg-main:disabled"));
    expect(regla).toMatch(/min-height: 48px;/);
  });

  it("el de Tus dólares digitales mide 56 px, solo en su ventana", () => {
    expect(css).toContain(".dlg-card.dlg-saldo .dlg-main { min-height: 56px; }");
  });
});
