// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import "../i18n";
import { cuentaDePrueba, lineaDePrueba } from "../campana/cuentas-de-prueba";
import { htmlDeLosGanadores, lugarDeLaLista } from "./ganadores-de-la-verificacion";

/**
 * Los ganadores en la página de verificación cuando la lista sellada es de personas: cada tarjeta dice el lugar en la
 * lista y nunca la línea, también para la cara. Con cualquier otra lista, la tarjeta es la de siempre.
 */
describe("los ganadores de una lista de personas", () => {
  const caras: string[] = [];
  const avatar = (nombre: string): string => {
    caras.push(nombre);
    return `data:cara-${nombre.replace(/\s/g, "-")}`;
  };
  const lineas = [1, 2, 3, 4].map((n) => lineaDePrueba(n));

  it("el lugar empieza en 1 y sale en el idioma de la página", () => {
    expect(lugarDeLaLista(0)).toBe("Lugar 1 de la lista");
    expect(lugarDeLaLista(11)).toBe("Lugar 12 de la lista");
  });

  it("cada tarjeta lleva el lugar, el premio y una cara que sale del lugar, sin ninguna línea", () => {
    caras.length = 0;
    const html = htmlDeLosGanadores(lineas, [3, 1], "Auriculares", avatar);
    expect(html).toContain('<p class="winner-name">Lugar 4 de la lista</p>');
    expect(html).toContain('<p class="winner-name">Lugar 2 de la lista</p>');
    expect(html.match(/Se lleva: Auriculares/g)).toHaveLength(2);
    expect(html).not.toContain("p1:");
    expect(caras).toEqual(["Lugar 4 de la lista", "Lugar 2 de la lista"]);
  });

  it("también cuando quien llama pide la lectura por persona: sigue el lugar", () => {
    const html = htmlDeLosGanadores(lineas, [0], "", avatar, true);
    expect(html).toContain("Lugar 1 de la lista");
    expect(html).not.toContain("p1:");
    expect(html).not.toContain("again-note");
  });

  it("una lista de cuentas o de nombres tiene la tarjeta de siempre", () => {
    const cuentas = [cuentaDePrueba(1), cuentaDePrueba(2)];
    expect(htmlDeLosGanadores(cuentas, [1], "Polera", avatar)).toContain(`<p class="winner-name">${cuentaDePrueba(2)}</p>`);
    expect(htmlDeLosGanadores(["Ana", "Beto"], [0], "Polera", avatar)).toContain('<p class="winner-name">Ana</p>');
    expect(htmlDeLosGanadores(["Ana", "Beto"], [0], "Polera", avatar)).not.toContain("Lugar");
  });

  it("una sola línea de persona no es una lista de personas: la tarjeta es la de siempre", () => {
    expect(htmlDeLosGanadores([lineas[0] as string], [0], "Polera", avatar)).toContain(`<p class="winner-name">${lineas[0]}</p>`);
  });
});
