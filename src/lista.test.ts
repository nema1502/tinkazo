// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ names: ["Ana", "Beto"] }));

vi.mock("./pagina", () => ({}));
vi.mock("./version-nueva", () => ({}));
vi.mock("./protocol/proof", () => ({ decodePreview: async () => ({ names: h.names, prize: "" }) }));

const TEXTOS = {
  es: {
    salaN: "{n} personas",
    salaPart: "{n} personas, {k} participaciones",
    salaRep: "repetido",
    listaCabina: "{g}, línea {l}",
    teleLinea0: "Roja",
    buscateNada: "No estás en la lista",
    buscateUno: "Estás en el puesto {p} de {n}",
    buscateVarios: "Aparecés {k} veces, en los puestos {p}",
    buscateDos: " Tu nombre exacto aparece {k} veces",
    vLugar: "Lugar {n}",
  },
  en: {
    salaN: "{n} people",
    salaPart: "{n} people, {k} entries",
    salaRep: "repeated",
    listaCabina: "{g}, {l} line",
    teleLinea0: "Red",
    buscateNada: "You are not on the list",
    buscateUno: "You are number {p} of {n}",
    buscateVarios: "You appear {k} times, at {p}",
    buscateDos: " Your exact name appears {k} times",
    vLugar: "Spot {n}",
  },
};

async function montar(search = ""): Promise<void> {
  vi.resetModules();
  history.replaceState(null, "", `/lista.html${search}`);
  document.body.innerHTML = `
    <p id="l-count"></p><p id="l-huella"></p>
    <p id="l-premio-row"></p><p id="l-premio"></p>
    <section id="l-ok"></section><section id="l-error"></section>
    <label for="l-buscar">Buscate</label><input id="l-buscar" /><p id="l-buscar-out"></p><ol id="l-lista"></ol>`;
  const { setLang, usarTextos } = await import("./idioma");
  usarTextos(TEXTOS);
  setLang("es");
  await import("./lista");
  await vi.waitFor(() => expect(document.querySelectorAll("#l-lista li")).toHaveLength(h.names.length));
}

beforeEach(() => {
  h.names = ["Ana", "Beto"];
});

describe("la cabina de la lista para buscarse", () => {
  it("aparece cuando el enlace dice que el juego es Teleférico", async () => {
    await montar("?juego=teleferico");
    const cabinas = [...document.querySelectorAll("#l-lista .cabina")];
    expect(cabinas).toHaveLength(2);
    expect(cabinas[0]?.textContent).toBe("Guacamayas, línea Roja");
  });

  it.each(["", "?juego=race"])("no aparece sin ese dato o con otro juego (%s)", async (search) => {
    await montar(search);
    expect(document.querySelectorAll("#l-lista li")).toHaveLength(2);
    expect(document.querySelector("#l-lista .cabina")).toBeNull();
  });
});

/** Dos líneas de persona con la forma de la sala: prefijo, 25 letras y una de cierre. */
const LINEA_A = `p1:${"a".repeat(25)}a`;
const LINEA_B = `p1:${"b".repeat(25)}q`;

const filas = (): string[] => [...document.querySelectorAll("#l-lista li")].map((li) => li.textContent ?? "");
const buscadorVisible = (): boolean =>
  ["#l-buscar", "#l-buscar-out", 'label[for="l-buscar"]'].every((sel) => !document.querySelector<HTMLElement>(sel)?.hidden);

describe("la lista en grande con líneas de persona", () => {
  it("una lista de líneas muestra Lugar n y no ofrece el buscador", async () => {
    h.names = [LINEA_A, LINEA_B];
    await montar();
    expect(filas()).toEqual(["Lugar 1", "Lugar 2"]);
    expect(document.getElementById("l-lista")?.innerHTML).not.toContain("p1:");
    for (const sel of ["#l-buscar", "#l-buscar-out", 'label[for="l-buscar"]']) expect(document.querySelector<HTMLElement>(sel)?.hidden).toBe(true);
  });

  it("una lista mezclada muestra los nombres como nombres y las líneas como Lugar n, sin buscador", async () => {
    h.names = ["Ana", LINEA_A];
    await montar();
    expect(filas()).toEqual(["Ana", "Lugar 2"]);
    expect(document.getElementById("l-lista")?.innerHTML).not.toContain("p1:");
    expect(buscadorVisible()).toBe(false);
  });

  it("una lista de nombres queda como siempre, con el buscador", async () => {
    h.names = ["Ana", "Beto"];
    await montar();
    expect(filas()).toEqual(["Ana", "Beto"]);
    expect(buscadorVisible()).toBe(true);
    for (const sel of ["#l-buscar", "#l-buscar-out", 'label[for="l-buscar"]']) expect(document.querySelector(sel)?.hasAttribute("hidden")).toBe(false);
  });

  it("el lugar se vuelve a escribir al cambiar de idioma", async () => {
    h.names = [LINEA_A, LINEA_B];
    await montar();
    const { setLang } = await import("./idioma");
    setLang("en");
    await vi.waitFor(() => expect(filas()).toEqual(["Spot 1", "Spot 2"]));
  });
});
