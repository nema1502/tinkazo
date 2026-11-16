import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El modo stand y la cantidad de personas que salen. El stand sí muestra el contador, con sus propias palabras (Cuántos
 * salen, `ganadores.ts`): ninguna regla del stand lo esconde. Lo que el stand no tiene es el orden de turnos y las
 * participaciones por persona: una ronda de ejemplo no se reparte ni se ordena.
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

/** Todos los selectores de las reglas que dicen body[data-stand="1"], uno por uno. */
function selectoresDelStand(): string[] {
  const salida: string[] = [];
  const re = /([^{}]+)\{[^{}]*\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    for (const s of (m[1] ?? "").split(",")) {
      const limpio = s.replace(/\s+/g, " ").trim();
      if (limpio.startsWith('body[data-stand="1"]')) salida.push(limpio);
    }
  }
  return salida;
}

describe("el modo stand muestra Cuántos salen", () => {
  it("el control existe en la página con ese identificador", () => {
    expect(pagina).toContain('id="ganadores-control"');
  });

  it("ninguna regla del stand esconde el control, el contador, los atajos ni el rótulo", () => {
    const partes = ["#ganadores-control", ".sellar-ganadores", ".nw-grupo", ".nw-contador", "#nw-atajos", "#nw-menos", "#nw-mas", "#nw-valor", "#nw-etiqueta", "#nw"];
    for (const s of selectoresDelStand()) {
      for (const parte of partes) {
        expect(s.endsWith(parte) || s.includes(`${parte} `) || s.includes(`${parte}:`), `${s} esconde ${parte}`).toBe(false);
      }
    }
  });

  it("el stand sigue sin el orden de turnos, que no tiene", () => {
    const reglas = cuerpos('body[data-stand="1"] #turnos-opcion');
    expect(reglas).toHaveLength(1);
    expect(reglas[0]).toMatch(/display:\s*none\s*!important/);
  });

  it("el stand tampoco muestra las participaciones por persona: en una ronda de ejemplo cada línea es una persona", () => {
    for (const id of ["#btn-varias", "#varias-panel", "#participaciones-aviso"]) {
      const reglas = cuerpos(`body[data-stand="1"] ${id}`);
      expect(reglas, id).toHaveLength(1);
      expect(reglas[0], id).toMatch(/display:\s*none\s*!important/);
      expect(pagina, id).toContain(`id="${id.slice(1)}"`);
    }
  });

  it("fuera del stand nada lo esconde: sigue a la vista junto a Sellar la lista", () => {
    const sueltas = cuerpos("#ganadores-control").concat(cuerpos(".sellar-ganadores"));
    for (const cuerpo of sueltas) expect(cuerpo).not.toMatch(/display:\s*none/);
  });
});
