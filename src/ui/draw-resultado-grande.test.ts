import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Desde la espera en grande, el show termina en el resultado en grande (`reveal` de `draw.ts`). Si durante el show se
 * perdía la pantalla completa, el resultado quedaba en la página, y con cinco ganadores el cartel del juego mostraba
 * tres y y 2 más. El sábado la pantalla completa la puede soltar Windows al cambiar de proyector, sin que nadie lo
 * pida. El resultado en grande es una capa de la página: sale igual, y se cierra con Cerrar o Escape.
 * `draw.ts` no se puede montar sin la página: se mira su fuente, como en `enlace-corto.test.ts`.
 */

const draw = readFileSync(new URL("./draw.ts", import.meta.url), "utf8");
// Con o sin el retorno de carro de Windows en los finales de línea.
const reveal = /\nexport function reveal\([\s\S]*?\r?\n\}\r?\n/.exec(draw)?.[0] ?? "";

describe("el resultado en grande al final del show", () => {
  it("sale en grande aunque se haya perdido la pantalla completa durante el show", () => {
    expect(reveal).not.toBe("");
    expect(reveal).toMatch(/\} else if \(final\) resultadoEnGrande\(enlace, principal\);/);
    expect(reveal).not.toMatch(/document\.fullscreenElement/);
  });
});
