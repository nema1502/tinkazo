// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que se lee en la herramienta cuando la lista viene de los equipos con cupón (`participants.ts` con el markup de
 * verdad de `index.html`): el resumen de Sellar la lista y la cuenta de junto al cuadro dicen equipos, y dejan de
 * decirlo en cuanto el cuadro pasa a otra lista, aunque las etiquetas del sorteo anterior sigan en memoria.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");

const CONDORES = "GAAA1111111111111111111111111111111111111111111111111111111111";
const VICUNAS = "GBBB2222222222222222222222222222222222222222222222222222222222";
const ZORROS = "GCCC3333333333333333333333333333333333333333333333333333333333";
const etiquetas = (): Map<string, string> =>
  new Map([
    [CONDORES, "Los Cóndores"],
    [VICUNAS, "Las Vicuñas"],
    [ZORROS, "Los Zorros"],
  ]);

const resumen = (): string => document.getElementById("sellar-resumen")?.textContent ?? "";
const cuenta = (): string => document.getElementById("lista-cuenta")?.textContent ?? "";
const sinCuenta = (): string => document.getElementById("sellar-sin-cuenta")?.textContent ?? "";
const nota = (): HTMLElement => document.getElementById("lista-cuenta-nota") as HTMLElement;
const cuadro = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;

interface Mundo {
  p: typeof import("./participants");
  e: typeof import("../equipos/etiquetas");
  i: typeof import("../i18n");
}

async function montar(): Promise<Mundo> {
  vi.resetModules();
  h.tope = 300;
  sessionStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  const e = await import("../equipos/etiquetas");
  const i = await import("../i18n");
  i.setLang("es");
  p.bindParticipants();
  g.montarGanadores();
  return { p, e, i };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("la lista de los equipos con cupón", () => {
  it("con las etiquetas puestas antes que la lista, el resumen y la cuenta dicen equipos desde la primera vez", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS, ZORROS].join("\n"));
    expect(resumen()).toContain("3 equipos, 1 ganador");
    expect(resumen()).not.toContain("personas");
    expect(cuenta()).toBe("Lista de 3 equipos");
  });

  it("el mismo resumen y la misma cuenta, en inglés", async () => {
    const { p, e, i } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS, ZORROS].join("\n"));
    i.setLang("en");
    expect(resumen()).toContain("3 teams, 1 winner");
    expect(resumen()).not.toContain("people");
    expect(cuenta()).toBe("List of 3 teams");
  });

  it("con un solo equipo en el cuadro, la cuenta dice un equipo", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList(CONDORES);
    expect(cuenta()).toBe("Lista de 1 equipo");
  });

  it("con etiquetas de un sorteo anterior y una lista de personas, todo habla de personas", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList(["Ana", "Beto", "Carla"].join("\n"));
    expect(resumen()).toContain("3 personas, 1 ganador");
    expect(resumen()).not.toContain("equipo");
    expect(cuenta()).toBe("Lista de 3 personas");
  });

  it("al pasar de la lista de equipos a otra de personas, la palabra cambia con el cuadro", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    expect(resumen()).toContain("2 equipos");
    // Quien organiza borra la lista y pega la de siempre: las etiquetas siguen en esta pestaña.
    const ta = document.getElementById("ta") as HTMLTextAreaElement;
    ta.value = "Ana\nBeto";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    expect(resumen()).toContain("2 personas");
    expect(resumen()).not.toContain("equipo");
    expect(cuenta()).toBe("Lista de 2 personas");
  });

  it("una lista con un equipo y una persona suelta se cuenta como de personas", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, "Beto"].join("\n"));
    expect(resumen()).toContain("2 personas");
    expect(cuenta()).toBe("Lista de 2 personas");
  });

  it("los textos que se leen al apretar un botón también siguen al cuadro", async () => {
    const { p, e, i } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    // Lo que main.ts lee al entrar con la lista ya armada y al tocar Sellar sin cuenta.
    expect(i.t("yaEntraste").replace("{n}", "2")).toBe("Ya entraste. Sellá tu lista de 2 equipos.");
    expect(i.t("loginParaSellar").replace("{n}", "2")).toContain("lista de 2 equipos");
    p.setList(["Ana", "Beto"].join("\n"));
    expect(i.t("yaEntraste").replace("{n}", "2")).toBe("Ya entraste. Sellá tu lista de 2 personas.");
  });
});

describe("lo que se lee junto al cuadro cuando la lista es de equipos", () => {
  it("debajo del resumen ya no dice que la gente no necesita cuenta: cada equipo se anotó con la de su encargado", async () => {
    const { p, e } = await montar();
    // Con una lista de personas, el texto de siempre.
    p.setList(["Ana", "Beto"].join("\n"));
    expect(sinCuenta()).toBe("Tu gente no necesita crear cuenta.");
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    expect(sinCuenta()).toBe("Cada equipo ya se anotó con la cuenta de su encargado.");
    expect(sinCuenta()).not.toContain("no necesita");
  });

  it("el mismo cambio sigue al idioma y vuelve al de siempre con otra lista", async () => {
    const { p, e, i } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    i.setLang("en");
    expect(sinCuenta()).toBe("Each team already signed up with its lead's account.");
    p.setList(["Ana", "Beto"].join("\n"));
    expect(sinCuenta()).toBe("Your people don't need an account.");
    i.setLang("es");
    expect(sinCuenta()).toBe("Tu gente no necesita crear cuenta.");
  });

  it("cada cuenta ocupa un solo renglón del cuadro y una nota dice que cada renglón es un equipo", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS, ZORROS].join("\n"));
    expect(cuadro().getAttribute("wrap")).toBe("off");
    expect(nota().style.display).toBe("");
    expect(nota().textContent).toBe("Cada renglón es la cuenta de un equipo. Sus nombres están abajo.");
  });

  it("la nota también sale en inglés", async () => {
    const { p, e, i } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    i.setLang("en");
    expect(nota().textContent).toBe("Each line is one team's account. Their names are below.");
  });

  it("con una lista de personas el cuadro y la nota quedan como siempre, aunque haya etiquetas de antes", async () => {
    const { p, e } = await montar();
    e.ponerEtiquetas(etiquetas());
    p.setList([CONDORES, VICUNAS].join("\n"));
    expect(cuadro().getAttribute("wrap")).toBe("off");
    // Quien organiza borra la lista y pega la de siempre.
    cuadro().value = "Ana\nBeto";
    cuadro().dispatchEvent(new Event("input", { bubbles: true }));
    expect(cuadro().hasAttribute("wrap")).toBe(false);
    expect(nota().style.display).toBe("none");
    expect(nota().textContent).toBe("");
  });

  it("con el cuadro vacío no hay nota", async () => {
    await montar();
    expect(cuadro().hasAttribute("wrap")).toBe(false);
    expect(nota().textContent).toBe("");
  });
});
