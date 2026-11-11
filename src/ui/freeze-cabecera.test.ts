// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La cabecera del selector dice la verdad cuando hay varias participaciones por persona
 * (`pintarCabecera` en `freeze.ts`): personas y participaciones, y turnos en un orden de
 * turnos repartido. Sin reparto, la frase de siempre.
 */

const REPARTO = ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto (1/2)", "Beto (2/2)", "Carla", "Dora"];

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/?modo=varias&lang=es");
  document.body.innerHTML = '<p id="rec-head"></p><input id="prize" value="" /><input id="nw" value="1" />';
});

describe("la cabecera del selector con varias participaciones", () => {
  it("cuenta participaciones como si fueran personas: dice las dos cuentas", async () => {
    const { pintarCabecera } = await import("./freeze");
    pintarCabecera(REPARTO);
    expect(document.getElementById("rec-head")?.textContent).toMatch(/^Para 4 personas, 7 participaciones\./);
  });

  it("en un orden de turnos repartido, las líneas son turnos", async () => {
    (document.getElementById("prize") as HTMLInputElement).value = "Turnos de limpieza";
    (document.getElementById("nw") as HTMLInputElement).value = "7";
    const { pintarCabecera } = await import("./freeze");
    pintarCabecera(REPARTO);
    expect(document.getElementById("rec-head")?.textContent).toMatch(/^Para 4 personas, 7 turnos\./);
  });

  it("sin reparto, la frase de siempre", async () => {
    const { pintarCabecera } = await import("./freeze");
    pintarCabecera(["Ana", "Beto", "Carla", "Dora", "Eva", "Fran", "Gala", "Hugo"]);
    expect(document.getElementById("rec-head")?.textContent).toMatch(/^Para 8 personas\. /);
  });
});
