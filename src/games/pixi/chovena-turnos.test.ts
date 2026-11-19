import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../../i18n";

/** Las tres salidas que antes anunciaban un premio tienen que caer a la frase neutra en un orden. */
describe("los subtítulos de la chovena con un orden de turnos", () => {
  it("todas las llamadas a la frase de premio están apagadas por la marca de turnos", () => {
    const fuente = readFileSync(new URL("./chovena.ts", import.meta.url), "utf8");
    expect(fuente).toContain('import { esResultadoDeTurnos } from "../../modos/turnos";');
    const lineas = fuente.split("\n").filter((linea) => linea.includes("L().cChoPrize"));
    expect(lineas).toHaveLength(3);
    for (const linea of lineas) expect(linea).toContain("!esResultadoDeTurnos()");
    // El sorteo de premios conserva su frase y sus tres llamadas.
    expect(T.es.cChoPrize("Ana")).toBe("¡Ana sale con premio!");
    expect(T.en.cChoPrize("Ana")).toBe("Ana goes out with a prize!");
  });
});
