// @vitest-environment jsdom
/**
 * Lo que Ganaste suma en una campaña de personas con el premio en dólares: debajo del código, una línea que dice que le pase a
 * quien organiza la dirección donde recibe dólares digitales, y un plegado con tres pasos y un enlace para quien no tiene dónde
 * recibirlos. No hay botones, el enlace nunca lleva a la entrada de recibir un premio, y con premio en mano o en una campaña de
 * cuentas no aparece nada.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import { pintarGano } from "./adentro";
import type { BotonDeGoogle, DepsDelCelular } from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { campanaDeEjemplo } from "./ejemplo";
import { completarEnDolares } from "./ganaste-dolares";
import type { Campana } from "./modelo";
import * as premio from "./premio";
import { TEXTOS_CAMPANA } from "./textos";
import { TEXTOS_GANASTE_DOLARES } from "./textos-ganaste-dolares";

const main = /<main[\s\S]*<\/main>/.exec(readFileSync("participar.html", "utf8"))?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 25, 18, 0);
const CODIGO = "0421";
const COMPROBANTE = "/verificar.html?demo=1";
usarTextos(TEXTOS_CAMPANA);

const google: BotonDeGoogle = { montar: () => () => undefined };
const ES = TEXTOS_GANASTE_DOLARES.es;
const EN = TEXTOS_GANASTE_DOLARES.en;

/** Una campaña de la red principal con tres premios de 40 dólares. */
const conDolares = (cambios: Partial<Campana> = {}): Campana => ({ ...campanaDeEjemplo(AHORA), red: "mainnet", premios: [400000000n, 400000000n, 400000000n], ...cambios });

function preparar(campana: Campana, o: { persona?: boolean; idioma?: "es" | "en" } = {}): { raiz: HTMLElement; deps: DepsDelCelular } {
  document.body.innerHTML = main;
  setLang(o.idioma ?? "es");
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const base = {
    tx: texto,
    idioma: getLang,
    enApp: false,
    ahora: () => AHORA,
    cada: () => () => undefined,
    visible: () => true,
    alVolver: () => () => undefined,
    vibrar: () => undefined,
    movimientoReducido: () => false,
  };
  const deps = depsDeDemostracion(base, campana, null);
  return { raiz, deps: o.persona === false ? deps : { ...deps, persona: { google } } };
}

/** Pinta Ganaste como lo pinta la página y después lo completa. */
function ganaste(raiz: HTMLElement, deps: DepsDelCelular, datos: { codigo?: string | null; comprobante?: string | null; avisado?: boolean } = {}): HTMLElement {
  pintarGano(raiz, deps, { avisado: datos.avisado ?? false, comprobante: datos.comprobante === undefined ? COMPROBANTE : datos.comprobante, codigo: datos.codigo === undefined ? CODIGO : datos.codigo });
  completarEnDolares(raiz, deps);
  return raiz.querySelector<HTMLElement>("#cmp-estado .cmp-hero") as HTMLElement;
}

const linea = (bloque: HTMLElement): HTMLElement | null => bloque.querySelector<HTMLElement>("[data-cmp-dolares]");
const plegado = (bloque: HTMLElement): HTMLDetailsElement | null => bloque.querySelector("details");
const hijos = (bloque: HTMLElement): string[] => [...bloque.children].map((e) => `${e.tagName.toLowerCase()}.${e.className.split(" ")[0] ?? ""}`);

/** La entrada de la página del celular y todo lo que importa sin import(). */
function archivosDeLaPagina(): string[] {
  const vistos = new Set<string>();
  const pendientes = [resolve("src/participar.ts")];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop() as string;
    if (vistos.has(archivo) || !archivo.endsWith(".ts")) continue;
    vistos.add(archivo);
    const importaciones = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gmu;
    for (const m of readFileSync(archivo, "utf8").matchAll(importaciones)) {
      const base = resolve(dirname(archivo), m[1] ?? "");
      const candidato = [base, `${base}.ts`, resolve(base, "index.ts")].find((c) => existsSync(c) && statSync(c).isFile());
      if (candidato) pendientes.push(candidato);
    }
  }
  return [...vistos];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  setLang("es");
});

describe("Ganaste en una campaña de personas con el premio en dólares", () => {
  it("debajo del código dice que le pase la dirección donde recibe dólares digitales", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps);
    const codigo = bloque.querySelector<HTMLElement>(".cmp-codigo-linea");
    expect(codigo?.textContent).toBe(`Mostrale este código a quien organiza: ${CODIGO}`);
    const direccion = codigo?.nextElementSibling;
    expect(direccion).toBe(linea(bloque));
    expect(direccion?.tagName).toBe("P");
    expect(direccion?.className).toBe("cmp-apoyo");
    expect(direccion?.textContent).toBe("Y pasale la dirección donde recibís dólares digitales.");
  });

  it("justo debajo va el plegado No tengo dónde recibirlos, cerrado, y Ver cómo se eligió queda al final", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps);
    expect(hijos(bloque)).toEqual(["div.cmp-marca", "h1.", "p.cmp-premio-resultado", "p.cmp-apoyo", "p.cmp-apoyo", "details.", "a.cmp-suave"]);
    const caja = plegado(bloque) as HTMLDetailsElement;
    expect(linea(bloque)?.nextElementSibling).toBe(caja);
    expect(caja.open).toBe(false);
    const resumen = caja.querySelector("summary");
    expect(resumen?.className).toBe("cmp-suave");
    expect(resumen?.textContent).toBe("No tengo dónde recibirlos");
    const ultimo = bloque.lastElementChild as HTMLAnchorElement;
    expect(ultimo.textContent).toBe("Ver cómo se eligió");
    expect(ultimo.getAttribute("href")).toBe(COMPROBANTE);
  });

  it("el plegado trae los tres pasos y el enlace Abrir Tinkazo, que abre la herramienta en otra pestaña", () => {
    const { raiz, deps } = preparar(conDolares());
    const caja = plegado(ganaste(raiz, deps)) as HTMLDetailsElement;
    const pasos = [...caja.querySelectorAll("p")];
    expect(pasos.map((p) => p.textContent)).toEqual([
      "Entrá a Tinkazo con Google y dejá tu cuenta lista.",
      "Tocá tu cuenta, abrí Tus dólares digitales y tocá Preparar mi cuenta.",
      "En tu cuenta, tocá Copiar y pasale esa dirección a quien organiza.",
    ]);
    expect(pasos.every((p) => p.className === "cmp-apoyo")).toBe(true);
    const enlaces = caja.querySelectorAll("a");
    expect(enlaces).toHaveLength(1);
    const abrir = enlaces[0] as HTMLAnchorElement;
    expect(abrir.textContent).toBe("Abrir Tinkazo");
    expect(abrir.className).toBe("cmp-suave");
    expect(abrir.getAttribute("href")).toBe("/?red=oficial");
    expect(abrir.target).toBe("_blank");
    expect(abrir.rel).toBe("noopener noreferrer");
    expect(caja.lastElementChild).toBe(abrir);
  });

  it("en la red de prueba el enlace abre la herramienta en el modo de prueba", () => {
    const { raiz, deps } = preparar(conDolares({ red: "testnet" }));
    const abrir = plegado(ganaste(raiz, deps))?.querySelector("a");
    expect(abrir?.getAttribute("href")).toBe("/?red=prueba");
  });

  it("el enlace nunca lleva a la entrada de recibir un premio", () => {
    for (const red of ["mainnet", "testnet"] as const) {
      const { raiz, deps } = preparar(conDolares({ red }));
      const destino = plegado(ganaste(raiz, deps))?.querySelector("a")?.getAttribute("href") ?? "";
      expect(destino, red).not.toContain("premio");
      expect(new URL(destino, "https://tinkazo.app").searchParams.has("premio"), red).toBe(false);
    }
  });

  it("en inglés dice lo mismo en inglés", () => {
    const { raiz, deps } = preparar(conDolares(), { idioma: "en" });
    const bloque = ganaste(raiz, deps);
    expect(linea(bloque)?.textContent).toBe("And give them the address where you receive digital dollars.");
    const caja = plegado(bloque) as HTMLDetailsElement;
    expect(caja.querySelector("summary")?.textContent).toBe("I have nowhere to receive them");
    expect([...caja.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Sign in to Tinkazo with Google and get your account ready.",
      "Tap your account, open Your digital dollars and tap Get my account ready.",
      "In your account, tap Copy and give that address to the organizer.",
    ]);
    expect(caja.querySelector("a")?.textContent).toBe("Open Tinkazo");
  });

  it("si el código todavía no llegó, la línea va después de la que dice dónde entregan el premio", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps, { codigo: null });
    expect(bloque.querySelector(".cmp-codigo-linea")).toBeNull();
    const entrega = [...bloque.querySelectorAll<HTMLElement>(":scope > p.cmp-apoyo")].find((p) => p.textContent === TEXTOS_CAMPANA.es.cpEntregaL);
    expect(entrega).toBeDefined();
    expect(entrega?.nextElementSibling).toBe(linea(bloque));
    expect(linea(bloque)?.nextElementSibling).toBe(plegado(bloque));
    expect(bloque.lastElementChild?.textContent).toBe("Ver cómo se eligió");
  });

  it("sin enlace para ver cómo se eligió, el plegado queda al final del bloque", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps, { comprobante: null });
    expect(bloque.lastElementChild).toBe(plegado(bloque));
  });

  it("con el cartel de que la esperan en el stand también va", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps, { avisado: true });
    expect(raiz.querySelector("#cmp-estado .cmp-cartel")?.textContent).toBe(TEXTOS_CAMPANA.es.cpTeEsperan);
    expect(linea(bloque)).not.toBeNull();
    expect(plegado(bloque)).not.toBeNull();
  });

  it("no suma ningún botón: lo único que se toca es el plegado y sus enlaces", () => {
    const { raiz, deps } = preparar(conDolares());
    ganaste(raiz, deps);
    expect(raiz.querySelector("#cmp-estado button")).toBeNull();
    expect(raiz.querySelector("#cmp-estado .primary")).toBeNull();
    expect(raiz.querySelector("#cmp-estado .cmp-accion")).toBeNull();
    expect(raiz.querySelector("#cmp-estado input")).toBeNull();
  });

  it("completar dos veces el mismo bloque no repite nada", () => {
    const { raiz, deps } = preparar(conDolares());
    const bloque = ganaste(raiz, deps);
    completarEnDolares(raiz, deps);
    completarEnDolares(raiz, deps);
    expect(bloque.querySelectorAll("[data-cmp-dolares]")).toHaveLength(1);
    expect(bloque.querySelectorAll("details")).toHaveLength(1);
  });

  it("un bloque pintado de nuevo se completa de nuevo", () => {
    const { raiz, deps } = preparar(conDolares());
    ganaste(raiz, deps);
    const bloque = ganaste(raiz, deps);
    expect(bloque.querySelectorAll("[data-cmp-dolares]")).toHaveLength(1);
    expect(bloque.querySelectorAll("details")).toHaveLength(1);
  });
});

describe("donde no corresponde no aparece nada", () => {
  it("con premio en mano Ganaste queda como estaba", () => {
    const { raiz, deps } = preparar(conDolares({ identidad: "persona", premios: [0n, 0n, 0n], premioEnMano: { es: "Auriculares", en: "Headphones" } }));
    pintarGano(raiz, deps, { avisado: false, comprobante: COMPROBANTE, codigo: CODIGO });
    const antes = raiz.querySelector("#cmp-estado")?.innerHTML;
    completarEnDolares(raiz, deps);
    expect(raiz.querySelector("#cmp-estado")?.innerHTML).toBe(antes);
    expect(raiz.querySelector("#cmp-estado details")).toBeNull();
    expect(raiz.querySelector("#cmp-estado")?.textContent).not.toMatch(/dólares|dirección/u);
  });

  it("en una campaña de cuentas Ganaste queda como estaba", () => {
    const { raiz, deps } = preparar(conDolares(), { persona: false });
    pintarGano(raiz, deps, { avisado: false, comprobante: COMPROBANTE });
    const antes = raiz.querySelector("#cmp-estado")?.innerHTML;
    completarEnDolares(raiz, deps);
    expect(raiz.querySelector("#cmp-estado")?.innerHTML).toBe(antes);
    expect(raiz.querySelector("#cmp-estado details")).toBeNull();
    expect(raiz.querySelector("#cmp-estado .primary")?.textContent).toBe(TEXTOS_CAMPANA.es.cpRecibir);
  });

  it("sin Ganaste a la vista no hace nada y no falla", () => {
    const { raiz, deps } = preparar(conDolares());
    const antes = raiz.innerHTML;
    expect(() => completarEnDolares(raiz, deps)).not.toThrow();
    expect(raiz.innerHTML).toBe(antes);
  });
});

describe("los textos de Ganaste con dólares", () => {
  const CLAVES = ["gdDireccion", "gdSinDonde", "gdPaso1", "gdPaso2", "gdPaso3", "gdAbrir"];

  it("son seis, con las mismas claves en los dos idiomas", () => {
    expect(Object.keys(ES)).toEqual(CLAVES);
    expect(Object.keys(EN)).toEqual(CLAVES);
  });

  it("dicen esto", () => {
    expect(ES).toEqual({
      gdDireccion: "Y pasale la dirección donde recibís dólares digitales.",
      gdSinDonde: "No tengo dónde recibirlos",
      gdPaso1: "Entrá a Tinkazo con Google y dejá tu cuenta lista.",
      gdPaso2: "Tocá tu cuenta, abrí Tus dólares digitales y tocá Preparar mi cuenta.",
      gdPaso3: "En tu cuenta, tocá Copiar y pasale esa dirección a quien organiza.",
      gdAbrir: "Abrir Tinkazo",
    });
    expect(EN).toEqual({
      gdDireccion: "And give them the address where you receive digital dollars.",
      gdSinDonde: "I have nowhere to receive them",
      gdPaso1: "Sign in to Tinkazo with Google and get your account ready.",
      gdPaso2: "Tap your account, open Your digital dollars and tap Get my account ready.",
      gdPaso3: "In your account, tap Copy and give that address to the organizer.",
      gdAbrir: "Open Tinkazo",
    });
  });

  it("no llevan signos prohibidos, huecos sin llenar ni palabras técnicas o de juegos de azar", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const clave of CLAVES) {
        const dicho = TEXTOS_GANASTE_DOLARES[idioma][clave] ?? "";
        expect(dicho.trim().length, `${idioma}.${clave}`).toBeGreaterThan(0);
        expect(dicho, `${idioma}.${clave}`).not.toMatch(/[;«»"“”—–·→¡!{}]/u);
        expect(dicho, `${idioma}.${clave}`).not.toMatch(/\b(?:billetera|wallet|cadena|blockchain|firma|signature|token|contrato|contract|usdc|stellar|hash)\b/iu);
        expect(dicho, `${idioma}.${clave}`).not.toMatch(/\b(?:rifa|loter[ií]a|boleto|ticket|apuesta|raffle|lottery|bet)\b/iu);
      }
    }
  });

  it("ninguna de sus claves es de la página: empiezan con gd y el diccionario del celular no las tiene", () => {
    for (const clave of CLAVES) {
      expect(clave).toMatch(/^gd[A-Z]/u);
      expect(clave in TEXTOS_CAMPANA.es, clave).toBe(false);
    }
  });
});

describe("cómo llega a la página sin pesar en su entrada", () => {
  it("lo de Ganaste lo vuelve a exportar, para no sumar otra descarga", () => {
    expect(premio.completarEnDolares).toBe(completarEnDolares);
  });

  it("la entrada de la página no importa nada de esto sin import()", () => {
    const delaPagina = archivosDeLaPagina();
    expect(delaPagina.length).toBeGreaterThan(5);
    expect(delaPagina.filter((archivo) => /ganaste-dolares|[\\/]premio\.ts$/u.test(archivo))).toEqual([]);
  });

  it("no usa ninguna clave del diccionario de la página, que el armado no metería en el HTML", () => {
    const fuente = readFileSync("src/campana/ganaste-dolares.ts", "utf8");
    expect(fuente).not.toMatch(/["'`]cp[A-Z]/u);
  });
});
