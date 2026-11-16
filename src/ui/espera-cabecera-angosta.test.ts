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

/** El cuerpo completo del bloque que abre con `apertura` (por ejemplo `@media (max-width: 599px) {`), o "" si no está. */
function bloqueDe(apertura: string): { cuerpo: string; entero: string } {
  const ini = css.indexOf(apertura);
  if (ini < 0) return { cuerpo: "", entero: "" };
  let hondo = 1;
  let i = ini + apertura.length;
  for (; i < css.length && hondo > 0; i++) {
    if (css[i] === "{") hondo++;
    else if (css[i] === "}") hondo--;
  }
  return { cuerpo: css.slice(ini + apertura.length, i - 1), entero: css.slice(ini, i) };
}

describe("la barra de arriba de la espera en un celular no tapa lo de abajo", () => {
  // Fija, la capa le reservaba 72 px de relleno, pensados para una calcomanía de un renglón. Con tres renglones (Todavía
  // nadie sabe quién gana, a 390 px) la calcomanía llegaba más abajo y tapaba la cuenta o el título (Se sortea el orden
  // de los turnos, a 320 px). En el flujo, su alto empuja a todo lo demás, sea cual sea.
  const celular = bloqueDe("@media (max-width: 599px) and (min-height: 561px) {");

  it("existe el bloque del celular, de 599 px para abajo y sin ser una pantalla baja", () => {
    expect(celular.cuerpo).not.toBe("");
  });

  it("la barra va en el flujo y antes de los espaciadores que centran el resto, a todo el ancho", () => {
    expect(celular.cuerpo).toMatch(/\.espera-top \{[^}]*position: static;/);
    expect(celular.cuerpo).toMatch(/\.espera-top \{[^}]*order: -1;/);
    expect(celular.cuerpo).toMatch(/\.espera-top \{[^}]*align-self: stretch;/);
  });

  it("entre 481 y 599 px el grupo de Volver tampoco se encoge: si no, el botón pisa la pastilla de Prueba", () => {
    expect(celular.cuerpo).toMatch(/\.espera-top-acc \{ flex-shrink: 0; \}/);
  });

  it("la capa ya no reserva arriba el lugar de la barra fija, solo el aire y la muesca del aparato", () => {
    expect(celular.cuerpo).toMatch(/\.espera \{[^}]*padding-top: max\(16px, env\(safe-area-inset-top, 0px\)\);/);
  });

  it("sin la barra fija, el hueco extra para la etiqueta del ensayo ya no hace falta", () => {
    expect(celular.cuerpo).toMatch(/\.espera-ensayo \{[^}]*margin-top: 0;/);
  });

  it("de 600 px para arriba (laptop y proyector) la barra sigue fija arriba con sus 72 px de lugar", () => {
    const resto = css.replace(celular.entero, "");
    expect(resto).toMatch(/\.espera-top \{ position: fixed; top: 16px; left: 16px; right: 16px;/);
    expect(resto).toMatch(/\.espera \{[^}]*padding: 72px 16px calc\(24px \* var\(--ajuste, 1\)\);/);
    // La barra en el flujo vive solo en el bloque del celular.
    expect(resto).not.toMatch(/\.espera-top \{[^}]*position: static;/);
  });

  it("una pantalla baja (un celular acostado) conserva la barra fija arriba con su fondo: se recorre por debajo", () => {
    const baja = bloqueDe("@media (max-height: 560px) {");
    expect(baja.cuerpo).toMatch(/\.espera-top \{[^}]*top: 0;[^}]*background: var\(--paper\);/);
    expect(baja.cuerpo).not.toMatch(/position: static/);
  });
});

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
