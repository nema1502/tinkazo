// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { MAX_WINNERS } from "../protocol/select";
import { ATAJOS, acotar, atajosHasta } from "./ganadores";

/**
 * «Cuántos ganan»: el campo numérico con atajos (`ganadores.ts`) y su lugar en `index.html`.
 *
 * El markup es el de verdad: se saca de `index.html` el pliegue de las opciones y se prueba sobre él, sin navegador.
 */

const h = vi.hoisted(() => ({ tope: 100 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

// La raíz del proyecto: con jsdom `import.meta.url` no es una URL de archivo.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const pliegue = (): string => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.getElementById("mas-opciones")?.outerHTML ?? "";
};

const campo = (): HTMLInputElement => document.getElementById("nw") as HTMLInputElement;
const nota = (): HTMLElement => document.getElementById("nw-nota") as HTMLElement;
const chip = (n: number): HTMLButtonElement => document.querySelector(`#nw-atajos button[data-n="${n}"]`) as HTMLButtonElement;
/** Escribe como lo hace la persona: pone el valor y avisa con `input`. */
const escribir = (valor: string): void => {
  campo().value = valor;
  campo().dispatchEvent(new Event("input", { bubbles: true }));
};
const salir = (): void => {
  campo().dispatchEvent(new Event("change", { bubbles: true }));
  campo().dispatchEvent(new Event("blur"));
};

describe("el campo en index.html", () => {
  beforeEach(() => {
    document.body.innerHTML = pliegue();
  });

  it("es un campo numérico (no un desplegable de cien renglones), con el tope del protocolo y 1 de inicio", () => {
    expect(campo().tagName).toBe("INPUT");
    expect(campo().type).toBe("number");
    expect(document.querySelector("select#nw")).toBeNull();
    expect(campo().min).toBe("1");
    expect(campo().max).toBe(String(MAX_WINNERS));
    expect(campo().value).toBe("1");
    expect(campo().getAttribute("inputmode")).toBe("numeric");
    // Con rótulo: el que lee el lector de pantalla, y el mismo que ya traducen las dos lenguas.
    expect(document.querySelector('label[for="nw"]')?.getAttribute("data-i")).toBe("winners");
  });

  it("trae los atajos de lo común: 1, 2, 3, 5 y 10, en ese orden, y ninguno pasa del tope", () => {
    const enHtml = [...document.querySelectorAll<HTMLButtonElement>("#nw-atajos button")].map((b) => Number(b.dataset.n));
    expect(enHtml).toEqual([...ATAJOS]);
    expect(ATAJOS).toEqual([1, 2, 3, 5, 10]);
    expect(Math.max(...enHtml)).toBeLessThanOrEqual(MAX_WINNERS);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#nw-atajos button")) {
      expect(b.type).toBe("button");
      expect(b.textContent).toBe(b.dataset.n);
    }
    // El del 1 empieza elegido, como el campo.
    expect(chip(1).getAttribute("aria-pressed")).toBe("true");
    expect(chip(5).getAttribute("aria-pressed")).toBe("false");
  });

  it("el grupo de atajos y el aviso tienen texto en español y en inglés", () => {
    const aria = document.getElementById("nw-atajos")?.getAttribute("data-i-aria") ?? "";
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l][aria], `${l}.${aria}`).toBe("string");
      expect(T[l].winnersTope, `${l}.winnersTope`).toContain("{n}");
    }
    expect(nota().hidden).toBe(true);
  });
});

describe("acotar: el número que queda", () => {
  it("un entero entre 1 y el tope, venga lo que venga del campo", () => {
    expect(acotar("7")).toBe(7);
    expect(acotar(" 12 ")).toBe(12);
    expect(acotar("100")).toBe(100);
    expect(acotar("101")).toBe(MAX_WINNERS);
    expect(acotar("5000")).toBe(MAX_WINNERS);
    expect(acotar("1e2")).toBe(100);
    expect(acotar("3.7")).toBe(3);
    expect(acotar("0")).toBe(1);
    expect(acotar("-4")).toBe(1);
    expect(acotar("")).toBe(1);
    expect(acotar("abc")).toBe(1);
    expect(acotar(null)).toBe(1);
    expect(acotar(undefined)).toBe(1);
    expect(acotar(Number.NaN)).toBe(1);
    expect(acotar(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("con un tope propio, el de la red", () => {
    expect(acotar("50", 32)).toBe(32);
    expect(acotar("32", 32)).toBe(32);
    expect(acotar("33", 32)).toBe(32);
    expect(acotar("9", 5)).toBe(5);
    expect(acotar("9", 0)).toBe(1);
  });

  it("los atajos que caben en un tope", () => {
    expect(atajosHasta(100)).toEqual([1, 2, 3, 5, 10]);
    expect(atajosHasta(32)).toEqual([1, 2, 3, 5, 10]);
    expect(atajosHasta(4)).toEqual([1, 2, 3]);
    expect(atajosHasta(1)).toEqual([1]);
  });
});

describe("montado en la página", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = pliegue();
    h.tope = 100;
  });

  const montar = async (): Promise<typeof import("./ganadores")> => {
    const m = await import("./ganadores");
    m.montarGanadores();
    return m;
  };

  it("pone los límites de la red en el campo", async () => {
    h.tope = 32;
    await montar();
    expect(campo().min).toBe("1");
    expect(campo().max).toBe("32");
  });

  it("con el tope de 100: 100 se queda, 101 baja a 100 y dice por qué", async () => {
    await montar();
    escribir("100");
    expect(campo().value).toBe("100");
    expect(nota().hidden).toBe(true);
    escribir("101");
    expect(campo().value).toBe("100");
    expect(nota().hidden).toBe(false);
    expect(nota().textContent).toBe("Hasta 100 ganadores por sorteo.");
    // Y en cuanto vuelve a un número que entra, el aviso se va.
    escribir("40");
    expect(campo().value).toBe("40");
    expect(nota().hidden).toBe(true);
    expect(nota().textContent).toBe("");
  });

  it("con el tope de 32 (el contrato de testnet de hoy): 33 baja a 32, nunca se ofrece más de lo que la red admite", async () => {
    h.tope = 32;
    await montar();
    escribir("33");
    expect(campo().value).toBe("32");
    expect(nota().textContent).toBe("Hasta 32 ganadores por sorteo.");
    escribir("80");
    expect(campo().value).toBe("32");
    escribir("32");
    expect(campo().value).toBe("32");
    expect(nota().hidden).toBe(true);
  });

  it("mientras se teclea no se pisa: un campo vacío se deja y al salir vuelve a 1", async () => {
    await montar();
    escribir("");
    expect(campo().value).toBe("");
    salir();
    expect(campo().value).toBe("1");
    expect(chip(1).getAttribute("aria-pressed")).toBe("true");
  });

  it("al salir del campo queda un número válido: cero, negativo o decimal se arreglan", async () => {
    await montar();
    for (const [escrito, queda] of [["0", "1"], ["-3", "1"], ["4.6", "4"]] as const) {
      escribir(escrito);
      salir();
      expect(campo().value, escrito).toBe(queda);
    }
  });

  it("tocar un atajo escribe el número, lo marca y avisa con change (el borrador, el resumen y el pliegue lo escuchan)", async () => {
    await montar();
    const avisos = vi.fn();
    campo().addEventListener("change", avisos);
    chip(5).click();
    expect(campo().value).toBe("5");
    expect(avisos).toHaveBeenCalledTimes(1);
    expect(chip(5).getAttribute("aria-pressed")).toBe("true");
    expect(chip(1).getAttribute("aria-pressed")).toBe("false");
    chip(10).click();
    expect(campo().value).toBe("10");
    expect(chip(10).getAttribute("aria-pressed")).toBe("true");
    expect(chip(5).getAttribute("aria-pressed")).toBe("false");
  });

  it("escribir otro número desmarca los atajos que no lo son", async () => {
    await montar();
    escribir("5");
    expect(chip(5).getAttribute("aria-pressed")).toBe("true");
    escribir("6");
    for (const n of ATAJOS) expect(chip(n).getAttribute("aria-pressed"), `atajo ${n}`).toBe("false");
  });

  it("los atajos que pasan del tope de la red se esconden", async () => {
    h.tope = 4;
    await montar();
    expect(chip(3).hidden).toBe(false);
    expect(chip(5).hidden).toBe(true);
    expect(chip(10).hidden).toBe(true);
  });

  it("ganadoresPedidos lee el campo ya acotado, y sin campo (la página de verificar) es 1", async () => {
    const m = await montar();
    escribir("7");
    expect(m.ganadoresPedidos()).toBe(7);
    campo().value = "";
    expect(m.ganadoresPedidos()).toBe(1);
    document.body.innerHTML = "";
    expect(m.ganadoresPedidos()).toBe(1);
  });

  it("un sorteo ya sellado con más de lo que la red ofrece se lee tal cual: el tope al leer es el del protocolo", async () => {
    h.tope = 32;
    const m = await montar();
    m.ponerGanadores(80);
    expect(campo().value).toBe("80");
    expect(m.ganadoresPedidos()).toBe(80);
    m.ponerGanadores(500);
    expect(campo().value).toBe(String(MAX_WINNERS));
    m.ponerGanadores(0);
    expect(campo().value).toBe("1");
  });

  it("con la lista cerrada se bloquean el campo y los atajos, y un atajo no hace nada", async () => {
    const m = await montar();
    m.bloquearGanadores(true);
    expect(campo().disabled).toBe(true);
    for (const n of ATAJOS) expect(chip(n).disabled, `atajo ${n}`).toBe(true);
    chip(5).click();
    expect(campo().value).toBe("1");
    m.bloquearGanadores(false);
    expect(campo().disabled).toBe(false);
    chip(5).click();
    expect(campo().value).toBe("5");
  });

  it("montarlo dos veces no duplica los avisos", async () => {
    const m = await montar();
    m.montarGanadores();
    const avisos = vi.fn();
    campo().addEventListener("change", avisos);
    chip(3).click();
    expect(avisos).toHaveBeenCalledTimes(1);
  });
});
