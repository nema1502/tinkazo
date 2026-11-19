import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// El teleférico se dibuja con WebGL y no corre en estas pruebas: se cuida sobre la fuente, como en
// ganador-altura-ficha.test.ts. Despejar al ganador pone la ficha con su nombre completo encima de la cabina.
const teleferico = readFileSync(new URL("./cablecar.ts", import.meta.url), "utf8");

/** La condición del `if` que encierra la llamada a `despejarGanador`. */
function guardaDelDespeje(): string {
  const llamada = teleferico.indexOf("S.despejarGanador(");
  expect(llamada).toBeGreaterThan(0);
  const si = teleferico.lastIndexOf("if (", llamada);
  return teleferico.slice(si, teleferico.indexOf("{", si));
}

describe("el teleférico no nombra a quien gana en el silencio del foco", () => {
  it("despeja al ganador, y con eso pone su ficha, recién desde el golpe", () => {
    expect(guardaDelDespeje()).toContain("tHold >= FOCO.golpe");
  });

  it("el golpe es el mismo momento en que el relator dice el nombre", () => {
    expect(teleferico).toContain("if (tAll >= T_CROWN && tHold >= FOCO.golpe) crowned();");
  });

  it("solo despeja en un lugar, así la guarda cubre todas las llamadas", () => {
    expect(teleferico.split("S.despejarGanador(").length - 1).toBe(1);
  });

  it("saltar lleva al golpe, así que la ficha sale también al saltar", () => {
    expect(teleferico).toContain("tHold = Math.max(tHold, FOCO.golpe);");
  });
});
