// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUARDA_DE_TOQUE_MS as DEL_SITIO } from "../ui/cuenta-lista";
import { GUARDA_DE_TOQUE_MS, QUIETUD_PARA_CAMBIAR_MS } from "./guarda";

describe("los tiempos que cuidan un toque", () => {
  it("la guarda del celular es la misma que usa el sitio", () => {
    expect(GUARDA_DE_TOQUE_MS).toBe(DEL_SITIO);
    expect(GUARDA_DE_TOQUE_MS).toBe(500);
  });

  it("el botón espera segundo y medio de quietud antes de cambiar de acción", () => {
    expect(QUIETUD_PARA_CAMBIAR_MS).toBe(1_500);
  });

  it("vive en un archivo sin imports: la página del celular no puede traer el del sitio, que es pesado", () => {
    expect(readFileSync("src/campana/guarda.ts", "utf8")).not.toMatch(/^\s*import\b/mu);
  });
});
