import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENTOS } from "../../workers/enlaces/src/conteo";

/**
 * "¿Cómo se usa?" (tutorial.ts) no se puede montar sin la página: se mira su
 * fuente. Lo que se cuida es que cuente lo que la lista cerrada del contador
 * acepta (`tutorial_open` con `step` y `from`) y desde los cuatro lugares.
 */
describe("el tutorial y el contador", () => {
  const fuente = readFileSync(new URL("./tutorial.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

  it("cuenta que se abrió, con el paso y desde dónde", () => {
    expect(fuente).toMatch(/contar\("tutorial_open", \{ step: String\(paso\)[^}]*from: desde \}\)/);
  });

  it("los cuatro lugares desde donde se abre son los que acepta la lista", () => {
    const desde = /abrirTutorial\(desde: ([^=]+) =/.exec(fuente)?.[1] ?? "";
    const valores = [...desde.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(valores.sort()).toEqual([...EVENTOS.tutorial_open.o.from].sort());
    // El menú y el final del ensayo o de la demo llegan por la dirección (main.ts); la oferta y el botón, por su clic.
    expect(main).toContain('m.abrirTutorial(h === "#como-se-usa-fin" ? "end" : "menu")');
    expect(main).toContain('abrirTutorial("offer")');
    expect(fuente).toContain('abrirTutorial("button")');
  });
});
