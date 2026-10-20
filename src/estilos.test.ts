import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Cuántos bloques quedan abiertos al final de un CSS, sin contar comentarios ni
 * cadenas, y en qué línea se cerró uno de más (0 si nunca pasó).
 */
export function llaves(css: string): { abiertos: number; cierraDeMasEn: number } {
  let prof = 0;
  let linea = 1;
  let cierraDeMasEn = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "\n") linea++;
    else if (css.startsWith("/*", i)) {
      const fin = css.indexOf("*/", i + 2);
      const hasta = fin < 0 ? css.length : fin + 2;
      for (let j = i; j < hasta; j++) if (css[j] === "\n") linea++;
      i = hasta - 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) {
        if (css[j] === "\\") j++;
        j++;
      }
      i = j;
    } else if (c === "{") prof++;
    else if (c === "}") {
      prof--;
      if (prof < 0 && !cierraDeMasEn) cierraDeMasEn = linea;
    }
  }
  return { abiertos: prof, cierraDeMasEn };
}

describe("estilos", () => {
  it("la cuenta de llaves funciona: un bloque sin cerrar se nota", () => {
    expect(llaves("a { color: red; }")).toEqual({ abiertos: 0, cierraDeMasEn: 0 });
    expect(llaves("@media (max-height: 520px) {\n a { color: red; }\n")).toEqual({ abiertos: 1, cierraDeMasEn: 0 });
    expect(llaves("a { }\n}\n")).toEqual({ abiertos: -1, cierraDeMasEn: 2 });
    // Una llave dentro de un comentario o de una cadena no cuenta.
    expect(llaves('/* { */ a::before { content: "}"; }')).toEqual({ abiertos: 0, cierraDeMasEn: 0 });
  });

  it("styles.css cierra todos sus bloques", () => {
    // Al juntar dos ramas que sumaban reglas al final del archivo quedó un
    // `@media` sin cerrar (20 de octubre de 2026): el navegador lo cierra solo
    // al final, y desde ahí todas las reglas valían solo con la condición del
    // bloque abierto. No da ningún error, así que se mira acá.
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(llaves(css)).toEqual({ abiertos: 0, cierraDeMasEn: 0 });
  });
});
