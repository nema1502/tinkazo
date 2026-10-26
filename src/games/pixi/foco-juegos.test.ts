import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Los juegos que coronan con foco tienen que cumplir tres cosas a la vez, y
 * cada una está en un lugar distinto del archivo: si falta una, el golpe suena
 * en el silencio, o el cartel se sostiene menos de tres segundos, o el
 * selector de duración calcula mal. Esta prueba lee el código para que no se
 * pierda al tocar un juego (no corre el motor: no hay placa de video).
 */
const JUEGOS = ["chovena", "cablecar", "oruro", "sapo"] as const;

describe("los juegos que coronan con foco", () => {
  for (const juego of JUEGOS) {
    const src = readFileSync(new URL(`./${juego}.ts`, import.meta.url), "utf8");

    it(`${juego}: arma la corona con foco y le pasa dónde está quien gana`, () => {
      expect(src).toMatch(/S\.crown\(names, winners, true\)/);
      expect(src).toMatch(/\.at\(tAll - [A-Za-z_.]*T_CROWN, true, foco[A-Za-z]+\(/);
    });

    it(`${juego}: demora su golpe hasta el golpe del foco y no antes`, () => {
      expect(src).toMatch(/tiemposFoco\(/);
      expect(src).toMatch(/tHold >= FOCO\.golpe/);
    });

    it(`${juego}: sostiene el cartel tres segundos reales después de que sale, y se lo cuenta al selector`, () => {
      const veces = src.match(/WINNER_HOLD \+ FOCO\.placa/g) ?? [];
      // Una en `setGameLength` y otra en el cierre.
      expect(veces.length).toBe(2);
      expect(src).toMatch(/setGameLength\([^)]*WINNER_HOLD \+ FOCO\.placa\)/);
    });
  }
});
