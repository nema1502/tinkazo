import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El pie en el celular (punto 4 del pulido del sitio). Cada enlace ocupaba una
 * fila y el pie medía unos 540 px de alto: van en dos columnas que se acomodan
 * solas, sin bajar el blanco de toque de 44 px que mira `check-paginas.mjs`.
 */
describe("el pie en el celular", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  /** El bloque `@media` que empieza en `inicio`, con sus llaves parejas. */
  const bloqueMedia = (inicio: number): string => {
    let prof = 0;
    for (let i = inicio; i < css.length; i++) {
      if (css[i] === "{") prof++;
      else if (css[i] === "}") {
        prof--;
        if (prof === 0) return css.slice(inicio, i + 1);
      }
    }
    return "";
  };

  it("los enlaces del pie van en dos columnas y miden 44 px o más", () => {
    const medias = [...css.matchAll(/@media\s*\(\s*max-width:\s*700px\s*\)\s*\{/g)].map((m) => m.index ?? -1);
    expect(medias.length).toBeGreaterThan(0);
    const conPies = medias.map(bloqueMedia).filter((b) => b.includes("footer .pies"));
    expect(conPies.length).toBe(1);
    expect(conPies[0]).toMatch(/grid-template-columns:[^;]*repeat\(\s*2/);
    expect(conPies[0]).toMatch(/gap:\s*14px 10px/);
    // En celdas de 44 px, la letra respira: más aire entre filas y renglones
    // propios que no se pegan con los de la celda de al lado.
    expect(conPies[0]).toMatch(/padding-block:\s*6px/);
    expect(conPies[0]).toMatch(/line-height:\s*1\.25/);
    expect(conPies[0]).toMatch(/letter-spacing:\s*0\.06em/);
    // Con cantidad impar, el último enlace cruza las dos columnas en vez de
    // quedar solo abajo a la izquierda.
    expect(conPies[0]).toMatch(/a:last-child:nth-child\(odd\)[^}]*grid-column:\s*1\s*\/\s*-1/);
    const enlace = /\.pies a\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(enlace).toContain("min-height: 44px");
  });
});
