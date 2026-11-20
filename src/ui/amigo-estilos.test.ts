import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lo que el Amigo secreto esconde con sus dos marcas: `data-modo-lista="amigo"` en `<html>` (src/ui/turnos.ts) y
 * `#winner-box.es-amigo` en el resultado (src/ui/draw.ts). Cada regla esconde algo que existe: si la marca falla, la
 * pantalla queda como en los otros modos, y en los otros modos ninguna de estas reglas aplica.
 */

// Sin los comentarios: si no, el texto de un comentario queda pegado al selector de la regla que le sigue.
const estilos = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
/** Las reglas sueltas de la hoja, con su selector y su cuerpo. */
const reglas = [...estilos.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), cuerpo: m[2] ?? "" }));
const cuerpoDe = (re: RegExp): string => reglas.filter((r) => re.test(r.selector)).map((r) => r.cuerpo).join(";");

describe("el Amigo secreto deja a la vista solo lo que sirve", () => {
  it("con el modo elegido no se ven el stand, el registro con cupón, el logo, la fila de cuántos ni el sonido", () => {
    const regla = reglas.find((r) => r.selector.startsWith('html[data-modo-lista="amigo"]') && r.selector.includes("#btn-stand"));
    expect(regla?.cuerpo).toMatch(/display:\s*none/);
    for (const id of ["btn-stand", "btn-equipos", "logo-fila", "ganadores-control", "mas-ajustes"]) {
      expect(regla?.selector, id).toContain(`#${id}`);
    }
    // Los que vienen en la página existen: si no, la regla no esconde nada. El de equipos lo arma src/ui/equipos-sala.ts.
    for (const id of ["btn-stand", "logo-fila", "ganadores-control", "mas-ajustes"]) expect(pagina, id).toContain(`id="${id}"`);
  });

  it("con el modo elegido, y también con la lista sellada, no se ofrecen los juegos interactivos", () => {
    const regla = reglas.find((r) => r.selector.includes('html[data-modo-lista="amigo"] #btn-interactivos'));
    expect(regla?.cuerpo).toMatch(/display:\s*none\s*!important/);
    expect(pagina).toContain('id="btn-interactivos"');
  });

  it("ya sorteado, la tarjeta de la lista sellada no repite Ya se sorteó en el botón apagado", () => {
    expect(cuerpoDe(/^html\[data-modo-lista="amigo"\] #btn-draw\[data-i="drawnDone"\]$/)).toMatch(/display:\s*none/);
  });

  it("en el resultado, Usar otra lista va sin el marco grande de la fila de lo que sigue", () => {
    const cuerpo = cuerpoDe(/^#winner-box\.es-amigo \.again$/);
    expect(cuerpo).toMatch(/border:\s*0/);
    expect(cuerpo).toMatch(/padding:\s*0/);
    expect(cuerpo).toMatch(/background:\s*none/);
  });

  it("en el celular el nombre tiene el renglón entero y Copiar enlace va debajo", () => {
    const bloque = /@media \(max-width: 420px\)\s*\{([^@]*?\.amigo-fila[^@]*?)\}\s*\}/.exec(estilos)?.[1] ?? "";
    expect(bloque).toMatch(/\.amigo-fila \.winner-name\s*\{\s*flex:\s*1 1 100%/);
    expect(bloque).toMatch(/\.amigo-fila \[data-amigo-enlace\]\s*\{\s*flex:\s*1 1 100%/);
  });
});
