import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { MAX_RECIENTES, agregarReciente, alternar, esElegido, opciones, recortar } from "./premios";

describe("premios: los recientes", () => {
  it("el último va primero y no se repite aunque cambie la mayúscula o los espacios", () => {
    expect(agregarReciente(["Libro", "Polera"], "  stickers ")).toEqual(["stickers", "Libro", "Polera"]);
    expect(agregarReciente(["Libro", "Polera"], "polera")).toEqual(["polera", "Libro"]);
    expect(agregarReciente(["Libro"], "LIBRO   ")).toEqual(["LIBRO"]);
  });

  it("no pasa del máximo: se va el más viejo", () => {
    const lleno = ["a", "b", "c", "d"];
    expect(lleno).toHaveLength(MAX_RECIENTES);
    expect(agregarReciente(lleno, "e")).toEqual(["e", "a", "b", "c"]);
  });

  it("un premio vacío no cambia nada", () => {
    expect(agregarReciente(["Libro"], "")).toEqual(["Libro"]);
    expect(agregarReciente(["Libro"], "   ")).toEqual(["Libro"]);
  });

  it("espacios dobles por dentro se juntan, como se van a leer", () => {
    expect(agregarReciente([], "Licencia   de  JetBrains")).toEqual(["Licencia de JetBrains"]);
  });
});

describe("premios: lo que se ofrece", () => {
  it("primero los recientes y después los sugeridos", () => {
    expect(opciones(["Polera", "Libro"], ["Termo"])).toEqual([
      { texto: "Termo", reciente: true },
      { texto: "Polera", reciente: false },
      { texto: "Libro", reciente: false },
    ]);
  });

  it("si un reciente coincide con un sugerido queda una sola vez, como reciente", () => {
    expect(opciones(["Polera", "Libro"], ["libro"])).toEqual([
      { texto: "libro", reciente: true },
      { texto: "Polera", reciente: false },
    ]);
  });

  it("sin recientes son solo los sugeridos, y sin nada no hay nada", () => {
    expect(opciones(["Polera"], [])).toEqual([{ texto: "Polera", reciente: false }]);
    expect(opciones([], [])).toEqual([]);
  });

  it("ignora los vacíos", () => {
    expect(opciones(["", "  "], ["", "Libro"])).toEqual([{ texto: "Libro", reciente: true }]);
  });
});

describe("premios: elegir y desmarcar", () => {
  it("está elegido el que dice el cuadro, sin importar mayúsculas ni espacios", () => {
    expect(esElegido("Libro", "libro")).toBe(true);
    expect(esElegido("  libro  ", "Libro")).toBe(true);
    expect(esElegido("Libro de Stellar", "Libro")).toBe(false);
  });

  it("con el cuadro vacío no está elegido ninguno", () => {
    expect(esElegido("", "")).toBe(false);
    expect(esElegido("   ", "Libro")).toBe(false);
  });

  it("tocar uno lo pone; tocarlo otra vez lo saca; tocar otro lo cambia", () => {
    expect(alternar("", "Libro")).toBe("Libro");
    expect(alternar("Libro", "Libro")).toBe("");
    expect(alternar("Libro", "Polera")).toBe("Polera");
    expect(alternar("algo escrito a mano", "Libro")).toBe("Libro");
  });

  it("el cuadro admite 60 caracteres: un premio largo se corta sin partir una letra", () => {
    expect(recortar("x".repeat(80))).toHaveLength(60);
    expect(recortar("Libro")).toBe("Libro");
    // Un emoji vale una letra, no dos.
    expect(Array.from(recortar("🦙".repeat(70)))).toHaveLength(60);
  });
});

describe("premios: los textos", () => {
  it("hay sugeridos en los dos idiomas, sin repetir ni pasarse del cuadro", () => {
    for (const l of ["es", "en"] as const) {
      const lista = T[l].prizeSugeridos;
      expect(Array.isArray(lista)).toBe(true);
      const v = lista as string[];
      expect(v.length).toBeGreaterThanOrEqual(6);
      expect(v.length).toBeLessThanOrEqual(10);
      expect(new Set(v.map((x) => x.toLocaleLowerCase())).size).toBe(v.length);
      expect(v.every((x) => x.length > 0 && x.length <= 60)).toBe(true);
    }
  });

  it("nada que huela a casino ni a plata: son cosas que se regalan en un evento", () => {
    const prohibidas = /dinero|efectivo|cash|bono|apuesta|bet|jackpot|casino|loter/i;
    for (const l of ["es", "en"] as const) {
      for (const p of T[l].prizeSugeridos as string[]) expect(p).not.toMatch(prohibidas);
    }
  });
});
