import { describe, expect, it } from "vitest";
import { enlaceDeFeedback, origenDelResultado } from "./feedback";

describe("el enlace para opinar", () => {
  it("lleva al formulario del idioma de la página", () => {
    expect(enlaceDeFeedback("es", "pie")).toBe("https://tally.so/r/KpzoAA?desde=pie");
    expect(enlaceDeFeedback("en", "pie")).toBe("https://tally.so/r/LD9GBj?desde=pie");
  });

  it("dice de dónde viene y qué juego se usó, y nada más", () => {
    const url = new URL(enlaceDeFeedback("es", "resultado", "race"));
    expect([...url.searchParams.keys()].sort()).toEqual(["desde", "juego"]);
    expect(url.searchParams.get("desde")).toBe("resultado");
    expect(url.searchParams.get("juego")).toBe("race");
  });

  it("la demo y el ensayo no se confunden con un sorteo de verdad", () => {
    expect(origenDelResultado(false, false)).toBe("resultado");
    expect(origenDelResultado(true, false)).toBe("demo");
    expect(origenDelResultado(false, true)).toBe("ensayo");
    expect(new URL(enlaceDeFeedback("es", "demo", "wheel")).searchParams.get("desde")).toBe("demo");
  });
});
