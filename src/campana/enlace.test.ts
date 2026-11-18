import { describe, expect, it } from "vitest";
import { leerEnlaceDeCampana } from "./enlace";

describe("leerEnlaceDeCampana", () => {
  it("lee un enlace completo", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&q=12.ABCDEFGHIJKLMNOP", "#abcdefghijklmnopqrstuv")).toEqual({ evento: "e7k2m9", q: "12.ABCDEFGHIJKLMNOP", clave: "abcdefghijklmnopqrstuv" });
  });
  it("acepta un enlace sin código", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9", "")).toEqual({ evento: "e7k2m9", q: null, clave: null });
  });
  it("acepta un enlace sin clave", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&q=1.ABCDEFGHIJKLMNOP", "")).not.toBeNull();
  });
  it("rechaza un código mal formado", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&q=1.malo", "#abcdefghijklmnopqrstuv")).toBeNull();
  });
  it("rechaza un evento mal formado", () => {
    expect(leerEnlaceDeCampana("?c=Evento", "")).toBeNull();
  });
  it("no incluye la clave en ningún error", () => {
    const clave = "abcdefghijklmnopqrstuv";
    expect(leerEnlaceDeCampana("?c=Mal evento", `#${clave}`)).toBeNull();
  });
});
