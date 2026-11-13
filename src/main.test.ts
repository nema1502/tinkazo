import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El arranque de la herramienta (`main.ts`) conecta las animaciones de atención
 * (`estilos-atencion.ts`). El módulo entero no se puede importar en una prueba
 * (necesita la página completa), así que el cableado se mira en la fuente; el
 * comportamiento de cada pieza se prueba en `estilos-atencion.test.ts`.
 */
describe("el arranque conecta las animaciones de atención", () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

  it("importa el módulo y conecta el temblor del hero, el destello del pie y el hover vivo de la portada", () => {
    expect(main).toContain('from "./estilos-atencion"');
    expect(main).toContain("iniciarTemblorHero()");
    expect(main).toContain("iniciarDestelloPie()");
    expect(main).toContain('iniciarHoverVivo(".portada-juegos a")');
  });

  it("el texto de sesión del botón grande se destraba cuando el JS lo decidió (contra el FOUC)", () => {
    // Dentro de `pintarCta`: después del primer pintado de estado, no antes.
    expect(main).toMatch(/const pintarCta = [\s\S]*?destrabarCtas\(\);/);
  });
});
