// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import "../i18n";
import { htmlDeLosGanadores } from "./ganadores-de-la-verificacion";

/**
 * Los ganadores en la página de verificación (`ganadores-de-la-verificacion.ts`): debajo de las tarjetas, el
 * aviso de quien salió más de una vez. Estas tarjetas no llevan el número de cada premio, así que el aviso dice
 * cuántas veces salió, con una frase y con estilo de nota, no con los premios.
 */
describe("los ganadores de la verificación", () => {
  const avatar = (nombre: string): string => `data:cara-${nombre}`;

  it("quien salió dos veces lleva debajo una frase con cuántas veces salió, y la cara sale del nombre limpio", () => {
    const names = ["Ana (1/2)", "Ana (2/2)", "Beto (1/1)"];
    const html = htmlDeLosGanadores(names, [0, 2, 1], "Polera", avatar, true);
    expect(html).toContain('<p class="again-note veces">Ana salió 2 veces.</p>');
    expect(html).toContain('src="data:cara-Ana"');
    expect(html).not.toContain("cara-Ana (2 veces)");
    expect(html).not.toContain("#1");
  });

  it("sin lectura por persona no hay aviso, y en un orden de turnos no se junta a nadie", () => {
    const names = ["Ana (1/2)", "Ana (2/2)", "Beto (1/1)"];
    expect(htmlDeLosGanadores(names, [0, 2, 1], "Polera", avatar, false)).not.toContain("again-note");
    const turnos = htmlDeLosGanadores(["Ana", "Beto", "Carla"], [0, 1, 2], "Turnos", avatar, true);
    expect(turnos).not.toContain("veces");
    expect(turnos).not.toContain("again-note");
  });
});
