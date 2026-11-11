import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "./i18n";
import { quienEnLaTarjeta } from "./evento-tarjeta";

/**
 * Quién salió y entre cuántos en la tarjeta de cada sorteo del evento (`quienEnLaTarjeta`): la cuenta y los nombres
 * con la misma lectura por persona, calculada una sola vez. Se prueba lo que dice, sin abrir la página.
 */
describe("la tarjeta del evento y la marca de la línea sellada", () => {
  it("sin modos, una lista común con «Grupo 4 (1/2)» y «Grupo 4 (2/2)» se muestra tal cual", () => {
    const s = { names: ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Ana", "Beto"], ganadores: ["Grupo 4 (1/2)", "Grupo 4 (2/2)"] };
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 4, participaciones: 4, ganadores: ["Grupo 4 (1/2)", "Grupo 4 (2/2)"] });
  });

  it("con el modo a la vista y un reparto, nombra a la persona y junta a quien salió más de una vez", () => {
    const s = { names: ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla"], ganadores: ["Ana (1/3)", "Beto", "Ana (3/3)"] };
    expect(quienEnLaTarjeta("es", s, true, false)).toEqual({ personas: 3, participaciones: 5, ganadores: ["Ana (2 veces)", "Beto"] });
    expect(quienEnLaTarjeta("en", s, true, false).ganadores).toEqual(["Ana (2 times)", "Beto"]);
    // El mismo reparto sin el modo (el enlace del evento no lo lleva): cada línea tal cual, y la cuenta lo mismo.
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 5, participaciones: 5, ganadores: ["Ana (1/3)", "Beto", "Ana (3/3)"] });
  });

  it("sin modos, un reparto entero se cuenta y se nombra por persona, las dos cosas", () => {
    const s = { names: ["Mesa 1 (1/2)", "Mesa 1 (2/2)", "Mesa 2 (1/2)", "Mesa 2 (2/2)"], ganadores: ["Mesa 1 (2/2)", "Mesa 2 (1/2)"] };
    expect(quienEnLaTarjeta("es", s, false, false)).toEqual({ personas: 2, participaciones: 4, ganadores: ["Mesa 1", "Mesa 2"] });
  });

  it("en un orden de turnos no se junta a nadie: cada turno es su renglón", () => {
    const s = { names: ["Ana (1/2)", "Ana (2/2)", "Beto"], ganadores: ["Ana (2/2)", "Beto", "Ana (1/2)"] };
    expect(quienEnLaTarjeta("es", s, true, true).ganadores).toEqual(["Ana", "Beto", "Ana"]);
  });

  it("la página del evento la llama con los modos que valen ahí", () => {
    const codigo = readFileSync("src/evento.ts", "utf8");
    expect(codigo).toContain('quienEnLaTarjeta(getLang(), s, requestedMode() === "varias" || modesFlagOn(), turnos)');
  });
});
