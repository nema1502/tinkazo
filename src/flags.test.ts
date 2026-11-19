import { describe, expect, it } from "vitest";
import { videoDescarga } from "./flags";

/**
 * La bandera de la medición del video del sorteo (`src/video/`). Apagada por
 * defecto: sin la bandera de construcción ni el parámetro de medición, nada
 * del prototipo se activa.
 */
describe("la bandera videoDescarga", () => {
  it("está apagada sin nada que la prenda", () => {
    expect(videoDescarga(undefined, "")).toBe(false);
    expect(videoDescarga("", "")).toBe(false);
    expect(videoDescarga("0", "")).toBe(false);
    expect(videoDescarga(null, "")).toBe(false);
  });

  it("se prende con la bandera de construcción", () => {
    expect(videoDescarga("1", "")).toBe(true);
  });

  it("se prende con el parámetro de medición ?video=medir", () => {
    expect(videoDescarga(undefined, "?video=medir")).toBe(true);
    expect(videoDescarga("", "?demo=carrera&video=medir&n=32")).toBe(true);
  });

  it("no se prende con otro valor del parámetro", () => {
    expect(videoDescarga(undefined, "?video=1")).toBe(false);
    expect(videoDescarga(undefined, "?video=si")).toBe(false);
    expect(videoDescarga(undefined, "?otro=medir")).toBe(false);
  });
});
