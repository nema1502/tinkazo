import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El modo stand y Cuántos ganan. Cuántos ganan vive junto a Sellar la lista, fuera del pliegue de opciones. El stand no
 * sortea con premio ni habla de ganar (sus rondas dicen quién salió), así que no muestra ese control: si no se esconde,
 * queda entre la lista y Empezar la ronda con un rótulo que el stand no usa. Y con un orden de turnos elegido antes de
 * entrar, quedaba a la vista, bloqueado y sin explicación, porque el stand esconde la opción de los turnos.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");

/** Los cuerpos de las reglas cuyo selector, o uno de su lista, es exactamente el pedido. */
function cuerpos(selector: string): string[] {
  const salida: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    const lista = (m[1] ?? "").split(",").map((s) => s.replace(/\s+/g, " ").trim());
    if (lista.includes(selector)) salida.push(m[2] ?? "");
  }
  return salida;
}

describe("el modo stand no muestra Cuántos ganan", () => {
  it("el control existe en la página con ese identificador", () => {
    expect(pagina).toContain('id="ganadores-control"');
  });

  it("el stand lo esconde con la misma regla que esconde el premio y los turnos", () => {
    const reglas = cuerpos('body[data-stand="1"] #ganadores-control');
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
    // Va en la regla de lo que el stand no tiene, la misma de la opción de turnos.
    expect(cuerpos('body[data-stand="1"] #turnos-opcion')[0]).toBe(reglas[0]);
  });

  it("fuera del stand nada lo esconde: sigue a la vista junto a Sellar la lista", () => {
    const sueltas = cuerpos("#ganadores-control").concat(cuerpos(".sellar-ganadores"));
    for (const cuerpo of sueltas) expect(cuerpo).not.toMatch(/display:\s*none/);
  });
});
