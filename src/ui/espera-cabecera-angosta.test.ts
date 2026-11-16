import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La cabecera de la espera en grande en un celular: la calcomanía, la pastilla de Prueba y el botón de volver tienen
 * que caber en una fila sin pisarse. Medido en Chrome con la cuenta de prueba, con el botón de volver sin partirse la
 * pastilla quedaba debajo de él entre 320 y 480 px. El grupo del botón conserva su ancho y es la calcomanía la que cede
 * (su texto se parte en renglones). La pastilla se achica solo en su relleno y su espaciado de letras: la letra queda en
 * 14 px, como en toda la interfaz. Medido en Chrome de 320 a 600 px, en español y en inglés, sin que nada se pise.
 */
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** El cuerpo del primer bloque `@media (max-width: 480px)` que contiene el selector pedido. */
function bloque480(selector: string): string {
  const re = /@media \(max-width: 480px\) \{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let hondo = 1;
    let i = m.index + m[0].length;
    const ini = i;
    for (; i < css.length && hondo > 0; i++) {
      if (css[i] === "{") hondo++;
      else if (css[i] === "}") hondo--;
    }
    const cuerpo = css.slice(ini, i - 1);
    if (cuerpo.includes(selector)) return cuerpo;
  }
  return "";
}

describe("la cabecera de la espera en un celular", () => {
  it("el grupo del botón de volver no se encoge, para que no pise la pastilla de Prueba", () => {
    expect(bloque480(".espera-top-acc")).toMatch(/\.espera-top-acc \{ flex-shrink: 0; \}/);
  });

  it("la pastilla de Prueba se achica en la misma pantalla angosta, pero no baja del piso de 14 px de letra", () => {
    const regla = bloque480(".espera-top .espera-prueba");
    expect(regla).toMatch(/\.espera-top \.espera-prueba \{[^}]*padding: 2px 6px;/);
    // docs/ux.md: 14 px en todo texto, también a 320 px, y las mayúsculas no cuentan doble. La pastilla avisa que el
    // sorteo es de prueba: es lo que menos puede quedar chico.
    const letra = /\.espera-top \.espera-prueba \{[^}]*font-size:\s*([\d.]+)px/.exec(regla);
    expect(letra).not.toBeNull();
    expect(Number(letra![1])).toBeGreaterThanOrEqual(14);
  });
});
