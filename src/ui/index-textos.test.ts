import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

describe("index.html, la herramienta", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

  it("cada texto marcado con data-i existe como cadena en español y en inglés", () => {
    // Una clave que falta no rompe nada a la vista en español: queda el texto
    // del markup. Pero al pasar a inglés se queda en español, o vacío, y en el
    // proyector se nota. Las claves con variantes no sirven en el markup.
    const claves = new Set([...html.matchAll(/\bdata-(?:i|i-html|i-ph|i-title|i-aria)="([^"]+)"/g)].map((m) => m[1] as string));
    const faltan = (["es", "en"] as const).flatMap((l) => [...claves].filter((k) => typeof T[l][k] !== "string").map((k) => `${l}.${k}`));
    expect(claves.size).toBeGreaterThan(50);
    expect(faltan).toEqual([]);
  });

  it("los ids de los que dependen los auditores y el sitio siguen en su lugar", () => {
    // `grep -rn "getElementById\|\$(\"" scripts/*.mjs src`: renombrar uno rompe un auditor o el sorteo.
    const ids = [
      "btn-freeze", "btn-draw", "btn-again-sin", "btn-again-nueva", "btn-proof", "btn-grande", "btn-espera", "btn-sample",
      "sec-frozen", "sec-draw", "sec-participants", "winner-box", "winner-cards", "again-row", "again-note", "wait-box", "wait-left",
      "st-skip", "stadium", "g-race", "g-chovena", "g-trompo", "g-pinata", "g-oruro", "g-wheel", "g-teleferico",
      "g-pasanaku", "g-stellar", "g-sapo", "g-quien", "ta", "nw", "names", "pace",
      // Lo que sigue (siguiente.ts): el indicador de pasos y la barra.
      "pasos", "siguiente", "sig-paso", "sig-btn", "sig-aviso", "juego-actual", "btn-cambiar", "gamepick", "again-acciones",
    ];
    const faltan = ids.filter((id) => !new RegExp(`\\bid="${id}"`).test(html));
    expect(faltan).toEqual([]);
  });

  it("lo que sigue después del ganador va pegado al ganador, antes de 'Mostrar en grande' y de la verificación", () => {
    const en = (id: string): number => html.indexOf(`id="${id}"`);
    expect(en("winner-cards")).toBeGreaterThan(0);
    expect(en("again-row")).toBeGreaterThan(en("winner-cards"));
    expect(en("btn-grande")).toBeGreaterThan(en("again-row"));
    expect(html.indexOf('class="verify"')).toBeGreaterThan(en("again-row"));
  });

  it("en la lista sellada el botón de sortear va antes del selector de juegos", () => {
    const en = (id: string): number => html.indexOf(`id="${id}"`);
    expect(en("btn-draw")).toBeGreaterThan(en("wait-box"));
    expect(en("btn-draw")).toBeLessThan(en("g-race"));
  });
});
