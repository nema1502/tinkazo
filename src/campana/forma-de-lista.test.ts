import { describe, expect, it } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "./cuentas-de-prueba";
import { esListaDePersonas, formaDeLista, hayLineasDePersona } from "./forma-de-lista";

/**
 * La forma de una lista se reconoce en sus datos: de cuentas si todas las filas son cuentas, de personas si todas son
 * líneas de persona. Una mezcla no se sortea, y una lista que no tiene ninguna línea de persona pero sí algo que no es una
 * cuenta sigue siendo lo que era antes de que existieran las personas: una lista rara.
 */

const SIN_FINAL_DE_CONTROL = `G${"B".repeat(55)}`;

describe("formaDeLista", () => {
  it("una lista de cuentas es de cuentas", () => {
    expect(formaDeLista([cuentaDePrueba(1), cuentaDePrueba(2), cuentaDePrueba(3)])).toBe("cuenta");
  });

  it("una lista de líneas de persona es de personas", () => {
    expect(formaDeLista([lineaDePrueba(1), lineaDePrueba(2), lineaDePrueba(3)])).toBe("persona");
  });

  it("con una sola fila, es de lo que sea esa fila", () => {
    expect(formaDeLista([cuentaDePrueba(1)])).toBe("cuenta");
    expect(formaDeLista([lineaDePrueba(1)])).toBe("persona");
  });

  it("una lista vacía es de cuentas, como hoy: no es una falla", () => {
    expect(formaDeLista([])).toBe("cuenta");
  });

  it("una línea de persona entre cuentas da mezclada, esté donde esté", () => {
    expect(formaDeLista([cuentaDePrueba(1), lineaDePrueba(1)])).toBe("mezclada");
    expect(formaDeLista([lineaDePrueba(1), cuentaDePrueba(1)])).toBe("mezclada");
    expect(formaDeLista([cuentaDePrueba(1), cuentaDePrueba(2), lineaDePrueba(1), cuentaDePrueba(3)])).toBe("mezclada");
  });

  it("una línea de persona junto a algo que no es una cuenta ni una línea también da mezclada", () => {
    expect(formaDeLista([lineaDePrueba(1), "hola"])).toBe("mezclada");
    expect(formaDeLista([lineaDePrueba(1), 7])).toBe("mezclada");
    expect(formaDeLista([lineaDePrueba(1), lineaDePrueba(2), SIN_FINAL_DE_CONTROL])).toBe("mezclada");
  });

  it("sin ninguna línea de persona, una fila que no es una cuenta hace la lista rara, como hoy", () => {
    expect(formaDeLista([cuentaDePrueba(1), "GBBB"])).toBe("rara");
    expect(formaDeLista([cuentaDePrueba(1), SIN_FINAL_DE_CONTROL])).toBe("rara");
    expect(formaDeLista(["hola"])).toBe("rara");
    expect(formaDeLista([""])).toBe("rara");
    expect(formaDeLista([cuentaDePrueba(1), 7, null])).toBe("rara");
  });

  it("una línea de persona con una letra de más o con el final cambiado no es una línea de persona", () => {
    const linea = lineaDePrueba(1);
    expect(formaDeLista([`${linea}a`])).toBe("rara");
    expect(formaDeLista([linea.toUpperCase()])).toBe("rara");
    expect(formaDeLista([`P1:${linea.slice(3)}`])).toBe("rara");
  });

  it("no cambia la lista que recibe", () => {
    const filas = [cuentaDePrueba(2), lineaDePrueba(1)];
    const copia = [...filas];
    formaDeLista(filas);
    expect(filas).toEqual(copia);
  });
});

describe("esListaDePersonas", () => {
  it("con dos o más líneas de persona es de personas", () => {
    expect(esListaDePersonas([lineaDePrueba(1), lineaDePrueba(2)])).toBe(true);
    expect(esListaDePersonas([1, 2, 3, 4].map(lineaDePrueba))).toBe(true);
  });

  it("con una sola línea, o ninguna, no lo es", () => {
    expect(esListaDePersonas([lineaDePrueba(1)])).toBe(false);
    expect(esListaDePersonas([])).toBe(false);
  });

  it("con cuentas, con una mezcla o con filas raras no lo es", () => {
    expect(esListaDePersonas([cuentaDePrueba(1), cuentaDePrueba(2)])).toBe(false);
    expect(esListaDePersonas([lineaDePrueba(1), cuentaDePrueba(1)])).toBe(false);
    expect(esListaDePersonas([lineaDePrueba(1), lineaDePrueba(2), "hola"])).toBe(false);
  });
});

describe("hayLineasDePersona", () => {
  it("es cierto con una línea de persona, sola o entre otras filas", () => {
    expect(hayLineasDePersona([lineaDePrueba(1)])).toBe(true);
    expect(hayLineasDePersona([lineaDePrueba(1), lineaDePrueba(2)])).toBe(true);
    expect(hayLineasDePersona(["Ana", lineaDePrueba(1), cuentaDePrueba(1)])).toBe(true);
  });

  it("es falso con cuentas, nombres, filas casi bien o una lista vacía", () => {
    expect(hayLineasDePersona([cuentaDePrueba(1), cuentaDePrueba(2)])).toBe(false);
    expect(hayLineasDePersona(["Ana", "Beto"])).toBe(false);
    expect(hayLineasDePersona([lineaDePrueba(1).toUpperCase(), 7, null])).toBe(false);
    expect(hayLineasDePersona([])).toBe(false);
  });
});
