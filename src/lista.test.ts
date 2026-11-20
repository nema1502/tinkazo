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
  },
};

async function montar(search = ""): Promise<void> {
  vi.resetModules();
  history.replaceState(null, "", `/lista.html${search}`);
  document.body.innerHTML = `
    <p id="l-count"></p><p id="l-huella"></p>
    <p id="l-premio-row"></p><p id="l-premio"></p>
    <section id="l-ok"></section><section id="l-error"></section>
    <input id="l-buscar" /><p id="l-buscar-out"></p><ol id="l-lista"></ol>`;
  const { setLang, usarTextos } = await import("./idioma");
  usarTextos(TEXTOS);
  setLang("es");
  await import("./lista");
  await vi.waitFor(() => expect(document.querySelectorAll("#l-lista li")).toHaveLength(2));
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
