import { describe, expect, it } from "vitest";
import { leerEnlaceDeCampana } from "./enlace";

describe("leerEnlaceDeCampana", () => {
  it("lee un enlace completo", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&q=12.ABCDEFGHIJKLMNOP", "#abcdefghijklmnopqrstuv")).toEqual({
      evento: "e7k2m9",
      q: "12.ABCDEFGHIJKLMNOP",
      clave: "abcdefghijklmnopqrstuv",
      sala: null,
      pase: null,
    });
  });
  it("acepta un enlace sin código", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9", "")).toEqual({ evento: "e7k2m9", q: null, clave: null, sala: null, pase: null });
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
  it("lee s y p de un enlace completo", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&s=ABCDEFGH&p=ABCDEFGHIJKL&red=oficial", "#abcdefghijklmnopqrstuv")).toEqual({
      evento: "e7k2m9",
      q: null,
      clave: "abcdefghijklmnopqrstuv",
      sala: "ABCDEFGH",
      pase: "ABCDEFGHIJKL",
    });
  });
  it("un s de 7 caracteres da null", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&s=ABCDEFG", "")).toBeNull();
  });
  it("un p con un punto da null", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&s=ABCDEFGH&p=ABCDEFGHIJ.L", "")).toBeNull();
  });
  it("un s con una letra con tilde da null", () => {
    expect(leerEnlaceDeCampana("?c=e7k2m9&s=ABCDEFGÑ", "")).toBeNull();
  });
  it("no incluye la clave en ningún error", () => {
    const clave = "abcdefghijklmnopqrstuv";
    expect(leerEnlaceDeCampana("?c=Mal evento", `#${clave}`)).toBeNull();
  });
});
