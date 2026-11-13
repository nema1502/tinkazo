import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rotuloDelPanel } from "./rotulo";

/**
 * El rótulo del panel final de los juegos (`stage.ts`, la corona): quién se lleva qué. En un orden de turnos nadie gana:
 * el panel dice que es el orden. En una ronda de stand dice que salieron, nunca que ganan.
 */

describe("el rótulo del panel final", () => {
  it("un sorteo común: gana uno o ganan varios", () => {
    expect(rotuloDelPanel("es", 1, { stand: false, turnos: false })).toBe("GANA");
    expect(rotuloDelPanel("es", 3, { stand: false, turnos: false })).toBe("GANAN");
    expect(rotuloDelPanel("en", 1, { stand: false, turnos: false })).toBe("WINNER");
    expect(rotuloDelPanel("en", 3, { stand: false, turnos: false })).toBe("WINNERS");
  });

  it("una ronda de stand: salió o salieron, nunca ganan", () => {
    expect(rotuloDelPanel("es", 1, { stand: true, turnos: false })).toBe("SALIÓ");
    expect(rotuloDelPanel("es", 4, { stand: true, turnos: false })).toBe("SALIERON");
    expect(rotuloDelPanel("en", 1, { stand: true, turnos: false })).toBe("PICKED");
    expect(rotuloDelPanel("en", 4, { stand: true, turnos: false })).toBe("PICKED");
  });

  it("un orden de turnos dice que es el orden, no que alguien gana, con o sin stand", () => {
    for (const stand of [false, true]) {
      for (const cuantos of [2, 8, 18, 300]) {
        expect(rotuloDelPanel("es", cuantos, { stand, turnos: true })).toBe("EL ORDEN");
        expect(rotuloDelPanel("en", cuantos, { stand, turnos: true })).toBe("THE ORDER");
      }
    }
    expect(rotuloDelPanel("es", 18, { stand: false, turnos: true })).not.toMatch(/GAN/);
    expect(rotuloDelPanel("en", 18, { stand: false, turnos: true })).not.toMatch(/WIN/);
  });

  it("el panel de la corona lo pide con la marca del resultado de turnos", () => {
    const stage = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
    expect(stage).toContain('import { rotuloDelPanel } from "./rotulo";');
    expect(stage).toMatch(/rotuloDelPanel\(getLang\(\), all\.length, \{ stand: enStand\(\), turnos: esResultadoDeTurnos\(\) \}\)/);
    // Lo de antes, escrito a mano en el panel, ya no está.
    expect(stage).not.toContain('"GANAN" : "GANA"');
  });
});
