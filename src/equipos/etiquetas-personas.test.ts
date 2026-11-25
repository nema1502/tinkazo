// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineaDePrueba, cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { setLang } from "../idioma";
import { T } from "../i18n";
import { etiquetaConCuenta, etiquetaDe, nombreOLugar, paraMostrar, ponerEtiquetas } from "./etiquetas";
import { cuentaCorta } from "./modelo";

/**
 * Lo que dicen las etiquetas del show cuando la lista es de personas (campañas de personas): una línea de persona no se
 * muestra nunca. Va el nombre, si este navegador lo conoce, y si no el lugar de la línea en la lista. Con cuentas todo
 * queda como siempre (lo cubren `equipos.test.ts` y la foto de la regla de hoy).
 */

const L = [1, 2, 3, 4].map((n) => lineaDePrueba(n));
const SIN_LINEA = (s: string): void => {
  expect(s.startsWith("p1:")).toBe(false);
  expect(s).not.toContain("p1:");
};

/** Pone la lista en el cuadro de la herramienta, como al pasar la lista de la campaña. */
function ponerCuadro(lineas: readonly string[]): void {
  document.body.innerHTML = `<textarea id="ta"></textarea>`;
  (document.getElementById("ta") as HTMLTextAreaElement).value = lineas.join("\n");
}

beforeEach(() => {
  setLang("es");
  ponerEtiquetas(new Map());
  document.body.innerHTML = "";
});

afterEach(() => {
  ponerEtiquetas(new Map());
  document.body.innerHTML = "";
  setLang("es");
});

describe("con el mapa de etiquetas vacío, ninguna cadena visible es una línea de persona", () => {
  it("paraMostrar pone el lugar de cada línea en la lista", () => {
    const m = paraMostrar(L);
    expect(m).toEqual(["Lugar 1", "Lugar 2", "Lugar 3", "Lugar 4"]);
    for (const s of m) SIN_LINEA(s);
  });

  it("paraMostrar deja como están las cuentas y los nombres libres", () => {
    const g = cuentaDePrueba(5);
    expect(paraMostrar([g, "Ana"])).toEqual([g, "Ana"]);
  });

  it("paraMostrar con una lista mezclada cambia solo las líneas de persona", () => {
    const g = cuentaDePrueba(5);
    expect(paraMostrar([g, L[0]!, "Ana", L[1]!])).toEqual([g, "Lugar 2", "Ana", "Lugar 4"]);
  });

  it("etiquetaDe dice el lugar de la línea en el cuadro", () => {
    ponerCuadro(L);
    expect(etiquetaDe(L[2]!)).toBe("Lugar 3");
    SIN_LINEA(etiquetaDe(L[0]!));
  });

  it("etiquetaDe dice Persona anotada si la línea no está en el cuadro o no hay cuadro", () => {
    expect(etiquetaDe(L[0]!)).toBe("Persona anotada");
    ponerCuadro([L[1]!, L[2]!]);
    expect(etiquetaDe(L[0]!)).toBe("Persona anotada");
  });

  it("etiquetaConCuenta nunca agrega un trozo de la línea", () => {
    ponerCuadro(L);
    expect(etiquetaConCuenta(L[1]!)).toBe("Lugar 2");
    expect(etiquetaConCuenta(L[1]!)).not.toContain("(");
    SIN_LINEA(etiquetaConCuenta(L[3]!));
    ponerCuadro([]);
    expect(etiquetaConCuenta(L[3]!)).toBe("Persona anotada");
  });

  it("nombreOLugar dice el lugar que le dan, desde 1", () => {
    expect(nombreOLugar(L[2]!, 2)).toBe("Lugar 3 de la lista");
    SIN_LINEA(nombreOLugar(L[0]!, 0));
  });
});

describe("con etiquetas", () => {
  it("el nombre manda sobre el lugar, y sin paréntesis", () => {
    ponerEtiquetas(new Map([[L[0]!, "Ana"], [L[2]!, "Beto"]]), "personas");
    ponerCuadro(L);
    expect(etiquetaDe(L[0]!)).toBe("Ana");
    expect(etiquetaConCuenta(L[0]!)).toBe("Ana");
    expect(nombreOLugar(L[2]!, 2)).toBe("Beto");
  });

  it("una persona sin nombre entre otras con nombre dice su lugar, no su línea", () => {
    ponerEtiquetas(new Map([[L[0]!, "Ana"], [L[2]!, "Beto"]]), "personas");
    const m = paraMostrar(L);
    expect(m).toEqual(["Ana", "Lugar 2", "Beto", "Lugar 4"]);
    for (const s of m) SIN_LINEA(s);
    ponerCuadro(L);
    expect(etiquetaDe(L[1]!)).toBe("Lugar 2");
    expect(etiquetaConCuenta(L[3]!)).toBe("Lugar 4");
  });
});

describe("con cuentas todo queda como hoy", () => {
  it("etiquetaConCuenta de una cuenta con etiqueta lleva su cuenta acortada", () => {
    const g = cuentaDePrueba(7);
    ponerEtiquetas(new Map([[g, "Los Cóndores"]]));
    expect(etiquetaDe(g)).toBe("Los Cóndores");
    expect(etiquetaConCuenta(g)).toBe(`Los Cóndores (${cuentaCorta(g)})`);
  });

  it("sin etiqueta, una cuenta y un nombre libre se muestran tal cual", () => {
    const g = cuentaDePrueba(7);
    expect(etiquetaDe(g)).toBe(g);
    expect(etiquetaConCuenta(g)).toBe(g);
    expect(etiquetaDe("Ana")).toBe("Ana");
    expect(etiquetaConCuenta("Ana")).toBe("Ana");
  });
});

describe("los textos", () => {
  it("están en español y en inglés, y en inglés se usan", () => {
    expect(T.es.vLugar).toBe("Lugar {n}");
    expect(T.es.vPersonaAnotada).toBe("Persona anotada");
    expect(T.en.vLugar).toBe("Spot {n}");
    expect(T.en.vPersonaAnotada).toBe("Signed-up person");
    setLang("en");
    expect(paraMostrar(L)[1]).toBe("Spot 2");
    expect(etiquetaDe(L[0]!)).toBe("Signed-up person");
    expect(nombreOLugar(L[0]!, 0)).toBe("Spot 1 on the list");
  });
});
