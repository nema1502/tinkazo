import { describe, expect, it } from "vitest";
import { isTurnOrder, isTurnPrize, turnOrder, turnOrderText, turnPrize } from "./turnos";

describe("isTurnPrize: el nombre empieza con «Turnos» o «Turns»", () => {
  it("sin distinguir mayúsculas ni espacios al principio", () => {
    for (const nombre of ["Turnos", "turnos", "TURNOS", "Turns", "turns", "TURNS", "  Turnos", "Turnos de limpieza", "Turnos: pasanaku", "Turns for the lab", "Turnos2026", "Turnos-A"]) {
      expect(isTurnPrize(nombre), nombre).toBe(true);
    }
  });

  it("no es turnos si la palabra no está al principio o sigue con otra letra", () => {
    for (const nombre of ["", "   ", "Termo", "Poleras", "3 poleras", "Los turnos", "Orden de turnos", "Turnstile", "Turnosaurio", "Turnero", "Tur nos", "Turno"]) {
      expect(isTurnPrize(nombre), nombre).toBe(false);
    }
  });
});

describe("isTurnOrder: ganan tantas personas como hay en la lista y el nombre empieza con Turnos", () => {
  it("3 poleras entre 3 personas no es turnos", () => {
    expect(isTurnOrder(3, 3, "3 poleras")).toBe(false);
    expect(isTurnOrder(3, 3, "Poleras")).toBe(false);
    expect(isTurnOrder(3, 3, "")).toBe(false);
  });

  it("«Turnos de limpieza» con 12 de 12 sí, y con 3 de 12 no", () => {
    expect(isTurnOrder(12, 12, "Turnos de limpieza")).toBe(true);
    expect(isTurnOrder(12, 3, "Turnos de limpieza")).toBe(false);
    expect(isTurnOrder(12, 11, "Turnos de limpieza")).toBe(false);
  });

  it("2, 12 y 300 personas, en español y en inglés", () => {
    for (const n of [2, 12, 300]) {
      expect(isTurnOrder(n, n, "Turnos"), `${n} es`).toBe(true);
      expect(isTurnOrder(n, n, "Turns"), `${n} en`).toBe(true);
      expect(isTurnOrder(n, n - 1, "Turnos"), `${n} menos uno`).toBe(false);
    }
  });

  it("con menos de dos personas no hay sorteo", () => {
    expect(isTurnOrder(1, 1, "Turnos")).toBe(false);
    expect(isTurnOrder(0, 0, "Turnos")).toBe(false);
  });
});

describe("el orden y su texto", () => {
  const nombres = ["Ana", "Beto", "Carla", "Dario"];

  it("el orden es el de los ganadores, sin reordenar: el índice 2 primero, después el 0, el 3 y el 1", () => {
    expect(turnOrder(nombres, [2, 0, 3, 1])).toEqual(["Carla", "Ana", "Dario", "Beto"]);
    expect(turnOrder(nombres, [0, 1, 2, 3])).toEqual(nombres);
  });

  it("un índice que no está en la lista no rompe: queda vacío", () => {
    expect(turnOrder(nombres, [1, 9])).toEqual(["Beto", ""]);
  });

  it("el texto para pegar en el grupo: «1. Ana, 2. Beto»", () => {
    expect(turnOrderText(["Ana", "Beto", "Carla"])).toBe("1. Ana, 2. Beto, 3. Carla");
    expect(turnOrderText(["Ana"])).toBe("1. Ana");
    expect(turnOrderText([])).toBe("");
  });
});

describe("turnPrize: el nombre que queda", () => {
  it("vacío es la palabra sola; lo que ya empieza bien se queda; lo demás lleva la palabra por delante", () => {
    expect(turnPrize("", "Turnos")).toBe("Turnos");
    expect(turnPrize("   ", "Turns")).toBe("Turns");
    expect(turnPrize("Turnos de limpieza", "Turnos")).toBe("Turnos de limpieza");
    expect(turnPrize("  turns   for   the lab ", "Turnos")).toBe("turns for the lab");
    expect(turnPrize("Orden de noviembre", "Turnos")).toBe("Turnos: Orden de noviembre");
    expect(turnPrize("Orden de noviembre", "Turns")).toBe("Turns: Orden de noviembre");
  });

  it("nunca pasa del largo del campo y el resultado siempre se reconoce como orden", () => {
    for (const texto of ["", "Termo", "Turnos", "x".repeat(200), "Turnos " + "y".repeat(200)]) {
      const queda = turnPrize(texto, "Turnos");
      expect(Array.from(queda).length, texto.slice(0, 12)).toBeLessThanOrEqual(60);
      expect(isTurnPrize(queda), texto.slice(0, 12)).toBe(true);
    }
  });
});

describe("la marca del resultado: el cartel final de los juegos", () => {
  // `draw.ts` la pone en `reveal`; los carteles (`cWin` de `i18n.ts`) la leen al terminar el juego.
  it("con un orden de turnos, el cartel dice que el orden quedó listo, no quién ganó", async () => {
    const { T } = await import("../i18n");
    const { setResultadoDeTurnos } = await import("./turnos");
    setResultadoDeTurnos(true);
    try {
      expect(T.es.cWin("Ana")).toBe("¡El orden quedó listo!");
      expect(T.en.cWin("Ana", true)).toBe("The order is set!");
    } finally {
      setResultadoDeTurnos(false);
    }
    // Sin la marca, el cartel de siempre.
    expect(T.es.cWin("Ana")).toContain("Ana");
    expect(T.en.cWin("Ana")).toContain("Ana");
  });
});

describe("modoDelComprobante: el modo que lleva el enlace de verificación", () => {
  const repartida = ["Ana (1/2)", "Ana (2/2)", "Beto"];

  it("sin los modos a la vista, ningún enlace lleva modo, tampoco un orden de turnos", async () => {
    const { modoDelComprobante } = await import("./turnos");
    expect(modoDelComprobante(["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Otro"], 3, "Turnos de exposición", false)).toBeNull();
    expect(modoDelComprobante(repartida, 1, "Una pizza", false)).toBeNull();
  });

  it("con los modos a la vista, un orden lleva el de turnos y un reparto común el de varias participaciones", async () => {
    const { modoDelComprobante } = await import("./turnos");
    expect(modoDelComprobante(repartida, 3, "Turnos", true)).toBe("turnos");
    expect(modoDelComprobante(["Ana", "Beto", "Carla"], 3, "Turnos", true)).toBe("turnos");
    expect(modoDelComprobante(repartida, 1, "Una pizza", true)).toBe("varias");
    expect(modoDelComprobante(["Ana", "Beto", "Carla"], 1, "Una pizza", true)).toBeNull();
  });
});
