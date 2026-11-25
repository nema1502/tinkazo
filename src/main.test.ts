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

  it("el arranque en Prueba limpia el paso del cupón, no la evaluación de la red", () => {
    expect(main).toContain('import { network } from "./stellar/config"');
    expect(main).toContain('import { limpiarPasoDelCupon } from "./stellar/cupon-paso-guardado"');
    expect(main).toMatch(/if \(network\.name === "testnet"\) limpiarPasoDelCupon\(\);/);
    const limpieza = main.indexOf('if (network.name === "testnet") limpiarPasoDelCupon();');
    expect(limpieza).toBeGreaterThan(-1);
    expect(main.indexOf("ingresarSiLoPidio();", limpieza)).toBeGreaterThan(limpieza);
  });
});

describe("el arranque abre el modo espectador", () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

  it("con #espectador= en la dirección, baja ui/espectador y abre la vista con los datos del enlace", () => {
    expect(main).toContain('location.hash.startsWith("#espectador=")');
    expect(main).toContain('import("./ui/espectador")');
    expect(main).toContain("datosDelEnlace");
    expect(main).toContain("abrirEspectador");
  });
});

describe("la demostración acepta la cantidad de personas", () => {
  const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
  const demo = main.slice(main.indexOf("async function autoDemo"), main.indexOf("async function poseScene"));

  it("con ?n= válido carga esa lista y sin él carga la de ejemplo de siempre", () => {
    expect(demo).toContain('cantidadDeLaDemo(params.get("n"))');
    expect(demo).toMatch(/setList\(nombresDeEjemplo\(/);
    expect(demo).toContain("loadSample()");
  });

  it("la escena fija arma su lista con la misma función", () => {
    expect(main).toContain("nombresDeEjemplo(cantidad)");
  });
});
