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
      "st-skip", "stadium", "g-race", "g-sapo", "g-trompo", "g-chovena", "g-pinata", "g-wheel", "g-quien",
      "g-trueque", "g-teleferico", "g-oruro", "ta", "nw", "names", "pace",
      // Lo que sigue (siguiente.ts): el indicador de pasos y la barra.
      "pasos", "siguiente", "sig-paso", "sig-btn", "sig-aviso", "juego-actual", "btn-cambiar", "gamepick", "again-acciones",
      // El primer sorteo (22 de octubre de 2026): la cuenta, la oferta, el tutorial y el ensayo.
      "gate", "btn-pegar", "primera-vez", "pegar-ayuda", "sellar-resumen", "ya-entraste", "btn-como", "como-panel",
      "btn-ensayo", "ensayo-banda", "ensayo-guia", "ensayo-fin", "ens-mio", "ens-salir",
      // La red antes de sellar (red.ts): la caja, "¿La red está bien?" y la nota de un sorteo sin sello.
      "red-estado", "red-fila", "btn-red", "btn-red-txt", "sin-sello-nota",
    ];
    const faltan = ids.filter((id) => !new RegExp(`\\bid="${id}"`).test(html));
    expect(faltan).toEqual([]);
  });

  it("el tutorial, la oferta de primera vez y la línea de la cuenta no tienen ningún botón de color", () => {
    // La única acción principal de la pantalla es la del paso (docs/ux.md). "¿Cómo se usa?" es secundario.
    const bloque = (id: string): string => {
      const i = html.indexOf(`id="${id}"`);
      const etiqueta = html.lastIndexOf("<", i);
      const nombre = /^<(\w+)/.exec(html.slice(etiqueta))?.[1] ?? "";
      return html.slice(etiqueta, html.indexOf(`</${nombre}>`, i));
    };
    for (const id of ["como-panel", "primera-vez", "gate"]) expect(bloque(id), id).not.toMatch(/class="[^"]*\bprimary\b/);
    expect(bloque("btn-como")).not.toMatch(/\bprimary\b/);
  });

  it("\"Cargar ejemplo\" ya no está a la vista en el markup: en una red con contrato lo reemplaza el ensayo", () => {
    // participants.ts lo esconde en una red con contrato; queda en la página para los auditores (.click()).
    expect(html).toMatch(/id="btn-ensayo"[^>]*data-entrar-ensayo/);
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
