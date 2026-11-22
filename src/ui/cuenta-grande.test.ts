// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La cuenta de junto al cuadro con el número en grande (`participants.ts`, pintarCuenta), con el markup de verdad: el
 * primer grupo de cifras va en su propio elemento y el texto de la cuenta sigue igual, letra por letra.
 */

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

const ta = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
const cuenta = (): HTMLElement => document.getElementById("lista-cuenta") as HTMLElement;
const numeros = (): HTMLElement[] => [...cuenta().querySelectorAll<HTMLElement>("b.cuenta-num")];

const escribir = (valor: string): void => {
  ta().value = valor;
  ta().dispatchEvent(new Event("input", { bubbles: true }));
};

/** Monta la herramienta con la dirección que se pida: sin parámetros o con `?modo=varias`. */
async function montar(modo = ""): Promise<void> {
  vi.resetModules();
  sessionStorage.clear();
  history.replaceState(null, "", modo ? `/?modo=${modo}` : "/");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
  const p = await import("./participants");
  const g = await import("./ganadores");
  p.bindParticipants();
  g.montarGanadores();
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("el número grande de la cuenta", () => {
  it("con varias participaciones solo el primer número va en grande y el texto no cambia", async () => {
    await montar("varias");
    escribir("Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto\nCarla");
    expect(cuenta().textContent).toBe("Lista de 3 personas, 5 participaciones");
    expect(numeros().map((b) => b.textContent)).toEqual(["3"]);
  });

  it("con una lista común el número de personas va en grande", async () => {
    await montar();
    escribir("Ana\nBeto\nCarla\nDora");
    expect(cuenta().textContent).toBe("Lista de 4 personas");
    expect(numeros().map((b) => b.textContent)).toEqual(["4"]);
  });

  it("con una sola persona también", async () => {
    await montar();
    escribir("Ana");
    expect(cuenta().textContent).toBe("Lista de 1 persona");
    expect(numeros().map((b) => b.textContent)).toEqual(["1"]);
  });

  it("con la lista vacía no queda ningún número", async () => {
    await montar();
    escribir("Ana");
    escribir("");
    expect(cuenta().textContent).toBe("");
    expect(numeros()).toEqual([]);
  });

  it("al cambiar de idioma el número sigue en grande", async () => {
    await montar("varias");
    escribir("Ana (1/3)\nAna (2/3)\nAna (3/3)\nBeto\nCarla");
    const { setLang } = await import("../i18n");
    setLang("en");
    expect(cuenta().textContent).toBe("List of 3 people, 5 entries");
    expect(numeros().map((b) => b.textContent)).toEqual(["3"]);
    setLang("es");
  });

  it("mide 28 px en el celular y 32 en la computadora", () => {
    expect(css).toContain(".lista-cuenta .cuenta-num { font-size: 28px; line-height: 1; }");
    expect(css).toContain("@media (min-width: 761px) { .lista-cuenta .cuenta-num { font-size: 32px; } }");
  });
});
