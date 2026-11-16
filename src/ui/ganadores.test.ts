// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { MAX_WINNERS } from "../protocol/select";
import { ATAJOS, acotar, atajosHasta } from "./ganadores";

/**
 * Cuántos ganan: el contador con botones y atajos (`ganadores.ts`) y su lugar en `index.html`.
 *
 * El markup es el de verdad: se saca de `index.html` el control que va junto a Sellar la lista y se prueba sin navegador.
 */

const h = vi.hoisted(() => ({ tope: 300 }));
vi.mock("../stellar/config", async (orig) => ({ ...(await orig<typeof import("../stellar/config")>()), topeDeGanadores: () => h.tope }));

// La raíz del proyecto: con jsdom `import.meta.url` no es una URL de archivo.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const control = (): string => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.getElementById("ganadores-control")?.outerHTML ?? "";
};

const campo = (): HTMLInputElement => document.getElementById("nw") as HTMLInputElement;
const nota = (): HTMLElement => document.getElementById("nw-nota") as HTMLElement;
const chip = (n: number): HTMLButtonElement => document.querySelector(`#nw-atajos button[data-n="${n}"]`) as HTMLButtonElement;
/** Pone un valor por código, como hacen el borrador y los auditores, y avisa con `input`. */
const escribir = (valor: string): void => {
  campo().value = valor;
  campo().dispatchEvent(new Event("input", { bubbles: true }));
};
const salir = (): void => {
  campo().dispatchEvent(new Event("change", { bubbles: true }));
};

describe("el contador en index.html", () => {
  beforeEach(() => {
    document.body.innerHTML = control();
  });

  it("se maneja con menos y más, nunca escribiendo un número, y conserva el tope del protocolo", () => {
    expect(campo().tagName).toBe("INPUT");
    expect(campo().type).toBe("hidden");
    expect(document.querySelector("#ganadores-control input:not([type='hidden'])")).toBeNull();
    expect(document.querySelector("select#nw")).toBeNull();
    expect(campo().min).toBe("1");
    expect(campo().max).toBe(String(MAX_WINNERS));
    expect(campo().value).toBe("1");
    expect(document.getElementById("nw-valor")?.textContent).toBe("1");
    for (const id of ["nw-menos", "nw-mas"]) {
      const b = document.getElementById(id) as HTMLButtonElement;
      expect(b.type).toBe("button");
      expect(b.getAttribute("data-i-aria")).toBe(id === "nw-menos" ? "winnersMenos" : "winnersMas");
    }
    // El rótulo nombra también al grupo de botones para el lector de pantalla.
    expect(document.querySelector('label[for="nw"]')?.getAttribute("data-i")).toBe("winners");
    expect(document.querySelector(".nw-contador")?.getAttribute("aria-labelledby")).toBe("nw-etiqueta");
  });

  it("está fuera del pliegue, inmediatamente antes de la única acción principal", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const ganadores = doc.getElementById("ganadores-control") as HTMLElement;
    const sellar = doc.getElementById("btn-freeze") as HTMLButtonElement;
    expect(doc.getElementById("mas-opciones")?.contains(ganadores)).toBe(false);
    expect(ganadores.nextElementSibling).toBe(sellar.parentElement);
    expect(sellar.parentElement?.querySelectorAll(".primary")).toHaveLength(1);
    expect(sellar.classList.contains("primary")).toBe(true);
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

  it("los botones, los atajos y el aviso tienen texto en español y en inglés", () => {
    const aria = document.getElementById("nw-atajos")?.getAttribute("data-i-aria") ?? "";
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l][aria], `${l}.${aria}`).toBe("string");
      expect(typeof T[l].winnersMenos, `${l}.winnersMenos`).toBe("string");
      expect(typeof T[l].winnersMas, `${l}.winnersMas`).toBe("string");
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
    expect(acotar("301")).toBe(MAX_WINNERS);
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
    expect(atajosHasta(300)).toEqual([1, 2, 3, 5, 10]);
    expect(atajosHasta(32)).toEqual([1, 2, 3, 5, 10]);
    expect(atajosHasta(4)).toEqual([1, 2, 3]);
    expect(atajosHasta(1)).toEqual([1]);
  });
});

describe("montado en la página", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = control();
    h.tope = 300;
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

  it("con el tope de 300: 300 se queda, 301 baja a 300 y dice por qué", async () => {
    await montar();
    escribir("300");
    expect(campo().value).toBe("300");
    expect(nota().hidden).toBe(true);
    escribir("301");
    expect(campo().value).toBe("300");
    expect(nota().hidden).toBe(false);
    expect(nota().textContent).toBe("Hasta 300 ganadores por sorteo.");
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

  it("un valor vacío puesto por código vuelve a 1 al confirmarse", async () => {
    await montar();
    escribir("");
    expect(campo().value).toBe("");
    salir();
    expect(campo().value).toBe("1");
    expect(chip(1).getAttribute("aria-pressed")).toBe("true");
  });

  it("al confirmar un valor por código queda un entero válido", async () => {
    await montar();
    for (const [escrito, queda] of [["0", "1"], ["-3", "1"], ["4.6", "4"]] as const) {
      escribir(escrito);
      salir();
      expect(campo().value, escrito).toBe(queda);
    }
  });

  it("menos y más cambian de a uno, muestran el número y avisan con change", async () => {
    await montar();
    const menos = document.getElementById("nw-menos") as HTMLButtonElement;
    const mas = document.getElementById("nw-mas") as HTMLButtonElement;
    const avisos = vi.fn();
    campo().addEventListener("change", avisos);
    expect(menos.disabled).toBe(true);
    mas.click();
    expect(campo().value).toBe("2");
    expect(document.getElementById("nw-valor")?.textContent).toBe("2");
    expect(menos.disabled).toBe(false);
    expect(avisos).toHaveBeenCalledTimes(1);
    mas.click();
    expect(campo().value).toBe("3");
    menos.click();
    expect(campo().value).toBe("2");
    menos.click();
    expect(campo().value).toBe("1");
    expect(menos.disabled).toBe(true);
    expect(avisos).toHaveBeenCalledTimes(4);
  });

  it("más se apaga en el tope de la red y los atajos siguen eligiendo de un toque", async () => {
    h.tope = 4;
    const m = await montar();
    const mas = document.getElementById("nw-mas") as HTMLButtonElement;
    m.ponerGanadores(4);
    expect(mas.disabled).toBe(true);
    expect(document.getElementById("nw-valor")?.textContent).toBe("4");
    mas.click();
    expect(campo().value).toBe("4");
    chip(2).click();
    expect(campo().value).toBe("2");
    expect(mas.disabled).toBe(false);
    expect(chip(2).getAttribute("aria-pressed")).toBe("true");
    expect(chip(1).getAttribute("aria-pressed")).toBe("false");
    chip(3).click();
    expect(campo().value).toBe("3");
    expect(chip(3).getAttribute("aria-pressed")).toBe("true");
    expect(chip(2).getAttribute("aria-pressed")).toBe("false");
  });

  it("un valor sin atajo desmarca los que no coinciden", async () => {
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

  it("con la lista cerrada se bloquean el contador y los atajos", async () => {
    const m = await montar();
    const mas = document.getElementById("nw-mas") as HTMLButtonElement;
    m.bloquearGanadores(true);
    expect(campo().disabled).toBe(true);
    expect(mas.disabled).toBe(true);
    for (const n of ATAJOS) expect(chip(n).disabled, `atajo ${n}`).toBe(true);
    mas.click();
    chip(5).click();
    expect(campo().value).toBe("1");
    m.bloquearGanadores(false);
    expect(campo().disabled).toBe(false);
    expect(mas.disabled).toBe(false);
    mas.click();
    expect(campo().value).toBe("2");
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
