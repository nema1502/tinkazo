import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * El pliegue del resultado se arma en el navegador (`plegarElResultado`, en `plegable.ts`): no hay DOM en las pruebas,
 * así que lo que se cuida acá es lo que podría romperlo sin que nadie se entere. Que cada id que el módulo busca esté
 * en `index.html` (si no, el pliegue no se arma y los tres botones quedan sueltos como antes) y que su texto esté en
 * los dos idiomas.
 */
describe("el pliegue del resultado", () => {
  const fuente = readFileSync(new URL("./plegable.ts", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const creados = new Set(["mas-resultado"]);
  const buscados = [...fuente.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1] as string).filter((id) => !creados.has(id));

  it("busca solo ids que están en index.html", () => {
    expect(buscados).toEqual(expect.arrayContaining(["again-acciones", "btn-again-nueva", "btn-copy", "btn-email", "mas-opciones"]));
    const faltan = buscados.filter((id) => !new RegExp(`\\bid="${id}"`).test(html));
    expect(faltan).toEqual([]);
  });

  it("el título del pliegue está en español y en inglés", () => {
    for (const l of ["es", "en"] as const) expect(typeof T[l].masResultado, l).toBe("string");
  });

  it("lo que se pliega es lo que se usa poco: la acción principal y 'Compartir el resultado' no se mueven", () => {
    const plegados = [...fuente.matchAll(/const (\w+) = document\.getElementById\("(btn-[\w-]+)"\)/g)].map((m) => m[2]);
    expect(plegados.sort()).toEqual(["btn-again-nueva", "btn-copy", "btn-email"]);
    for (const principal of ["btn-again-sin", "btn-proof", "btn-whatsapp", "btn-grande"]) expect(plegados).not.toContain(principal);
  });
});
