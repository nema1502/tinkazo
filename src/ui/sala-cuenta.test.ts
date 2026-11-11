// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «Mostrar la lista en grande» antes de sellar dice la misma cuenta que el cuadro (`#lista-cuenta`), con el markup
 * de verdad de `index.html`. Sin los modos, una lista hecha toda de marcas que cierran («Mesa 1 (1/3)» a «Mesa 2
 * (2/2)») es un reparto entero: el cuadro dice «2 personas, 5 participaciones», y la sala no puede decir «5 personas»
 * antes de sellar y «2 personas, 5 participaciones» después.
 */

vi.mock("./qr", () => ({ pintarQr: async () => false }));
vi.mock("../protocol/proof", async (orig) => ({
  ...(await orig<typeof import("../protocol/proof")>()),
  previewUrl: async () => "https://tinkazo.app/lista.html#x",
}));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const MESA = "Mesa 1 (1/3)\nMesa 1 (2/3)\nMesa 1 (3/3)\nMesa 2 (1/2)\nMesa 2 (2/2)";

async function montar(direccion: string): Promise<void> {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState(null, "", direccion);
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  p.bindParticipants();
  g.montarGanadores();
}

const escribir = (valor: string): void => {
  const ta = document.getElementById("ta") as HTMLTextAreaElement;
  ta.value = valor;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

async function tituloDeLaSala(): Promise<string> {
  const { mostrarLista } = await import("./sala");
  await mostrarLista();
  const titulo = document.querySelector(".sala h2")?.textContent ?? "";
  document.querySelector(".sala")?.remove();
  return titulo;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("la sala antes de sellar cuenta como el cuadro", () => {
  it("sin modos, un reparto entero dice «2 personas, 5 participaciones» en el cuadro y en la sala", async () => {
    await montar("/?lang=es");
    escribir(MESA);
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 2 personas, 5 participaciones");
    expect(await tituloDeLaSala()).toBe("2 personas, 5 participaciones");
  });

  it("sin modos, una lista común sigue diciendo una persona por línea", async () => {
    await montar("/?lang=es");
    escribir("Grupo 4 (1/2)\nGrupo 4 (2/2)\nAna\nBeto");
    expect(document.getElementById("lista-cuenta")?.textContent).toBe("Lista de 4 personas");
    expect(await tituloDeLaSala()).toBe("4 personas");
  });

  it("con ?modo=varias, la sala dice lo mismo que antes", async () => {
    await montar("/?modo=varias&lang=es");
    escribir("Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto\nCarla");
    expect(await tituloDeLaSala()).toBe("3 personas, 5 participaciones");
  });
});
