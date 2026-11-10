// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La lista de la página de verificación con varias participaciones por persona (`renderList`). Esta
 * página no conoce la bandera de quien selló: agrupa solo cuando la lista ENTERA es un reparto
 * coherente (`esReparto`); cualquier otra lista se muestra tal cual, como siempre. Se prueba con el
 * markup de verdad de `verificar.html`.
 */

const pagina = readFileSync(join(process.cwd(), "verificar.html"), "utf8");

const cuenta = (): HTMLElement => document.getElementById("v-count") as HTMLElement;
const filas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("#v-names i")];

// jsdom no trae matchMedia, y el menú de la página lo usa (src/ui/menu.ts).
beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/verificar.html?lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

/** La página con el diccionario entero, como lo registra la herramienta: el build le inyecta solo lo suyo. */
async function montar(): Promise<typeof import("./verify")> {
  await import("./i18n");
  return import("./verify");
}

describe("la lista de la verificación con sufijos", () => {
  it("un reparto entero: cada persona una sola vez, con sus puestos juntos y cuántas tiene", async () => {
    const { renderList } = await montar();
    renderList({ names: ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto (1/2)", "Beto (2/2)"] } as never);
    // La cuenta de arriba dice las dos cosas.
    expect(cuenta().textContent).toBe("2 personas, 5 participaciones");
    // Ana y Beto una sola vez cada uno, con sus puestos y su cuenta de participaciones.
    expect(filas()).toHaveLength(2);
    expect(filas()[0]?.dataset.p).toBe("1 2 3");
    expect(filas()[0]?.textContent).toContain("Ana");
    expect(filas()[0]?.textContent).toContain("3 participaciones");
    expect(filas()[1]?.dataset.p).toBe("4 5");
    expect(filas()[1]?.textContent).toContain("Beto");
  });

  it("una lista que no es un reparto entero: cada línea tal cual, como siempre", async () => {
    const { renderList } = await montar();
    // «Grupo (1/2)» puede ser solo un nombre: una línea sin sufijo rompe el reparto.
    renderList({ names: ["Grupo (1/2)", "Grupo (2/2)", "Otro"] } as never);
    expect(cuenta().textContent).toBe("3 participantes");
    expect(filas().map((f) => f.textContent)).toEqual(["Grupo (1/2)", "Grupo (2/2)", "Otro"]);
    expect(filas().map((f) => f.dataset.p)).toEqual(["1", "2", "3"]);
    // Nadie agrupado: sin la cuenta de participaciones al lado de un nombre.
    expect(document.querySelector("#v-names small")).toBeNull();
  });

  it("sufijos mezclados que no cierran: la lista se muestra en el orden sellado", async () => {
    const { renderList } = await montar();
    renderList({ names: ["Ana (1/3)", "Beto", "Ana (3/3)", "Carla"] } as never);
    expect(filas().map((f) => f.textContent)).toEqual(["Ana (1/3)", "Beto", "Ana (3/3)", "Carla"]);
    expect(filas().map((f) => f.dataset.p)).toEqual(["1", "2", "3", "4"]);
  });

  it("un comprobante de turnos dice «El orden recomputado», no «El ganador recomputado»", async () => {
    const { pintarComprobaciones } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    pintarComprobaciones({ names, prize: "Turnos de limpieza" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [2, 0, 1],
      nombres: names,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("El orden recomputado");
    expect(texto).not.toContain("El ganador recomputado");
  });

  it("con el modo de varias participaciones en el enlace, una lista que cierra agrupa por persona", async () => {
    history.replaceState(null, "", "/verificar.html?lang=es&modo=varias");
    const { renderList } = await montar();
    renderList({ names: ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla (1/2)", "Carla (2/2)", "Dana"] } as never);
    // Con el parámetro y la lista cerrada, cada persona una sola vez, con sus puestos y cuántas tiene.
    expect(cuenta().textContent).toBe("4 personas, 7 participaciones");
    expect(filas()).toHaveLength(4);
    expect(filas()[0]?.dataset.p).toBe("1 2 3");
    expect(filas()[0]?.textContent).toContain("Ana");
    expect(filas()[0]?.textContent).toContain("3 participaciones");
    expect(filas()[2]?.dataset.p).toBe("5 6");
    expect(filas()[2]?.textContent).toContain("Carla");
    expect(filas()[2]?.textContent).toContain("2 participaciones");
  });

  it("la misma lista sin parámetro y sin bandera no agrupa: siete renglones", async () => {
    const { renderList } = await montar();
    renderList({ names: ["Ana (1/3)", "Ana (2/3)", "Ana (3/3)", "Beto", "Carla (1/2)", "Carla (2/2)", "Dana"] } as never);
    // Sin el parámetro, una lista con líneas sin sufijo no es un reparto entero: línea por línea.
    expect(cuenta().textContent).toBe("7 participantes");
    expect(filas()).toHaveLength(7);
    expect(document.querySelector("#v-names small")).toBeNull();
  });

  it("con el modo de varias participaciones en el enlace, una lista que no cierra no se agrupa", async () => {
    history.replaceState(null, "", "/verificar.html?lang=es&modo=varias");
    const { renderList } = await montar();
    // Sufijo repetido: el grupo de Ana no trae del 1 al 3 sin repetir, así que no cierra.
    renderList({ names: ["Ana (1/3)", "Ana (1/3)", "Ana (3/3)", "Beto", "Carla (1/2)", "Carla (2/2)", "Dana"] } as never);
    // Con el parámetro sobre una lista que no cierra, línea por línea.
    expect(cuenta().textContent).toBe("7 participantes");
    expect(filas()).toHaveLength(7);
    expect(document.querySelector("#v-names small")).toBeNull();
  });

  it("con el modo de turnos en el enlace, un sorteo común se sigue mostrando como sorteo común", async () => {
    history.replaceState(null, "", "/verificar.html?lang=es&modo=turnos");
    const { pintarComprobaciones } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    pintarComprobaciones({ names, prize: "Una pizza" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [2, 0, 1],
      nombres: names,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("El ganador recomputado");
    expect(texto).not.toContain("El orden recomputado");
  });

  it("con el modo de turnos en el enlace y un solo ganador, tampoco es un orden", async () => {
    history.replaceState(null, "", "/verificar.html?lang=es&modo=turnos");
    const { pintarComprobaciones } = await montar();
    const names = Array.from({ length: 12 }, (_, i) => `Persona ${i + 1}`);
    pintarComprobaciones({ names, prize: "Termo" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [4],
      nombres: names,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("El ganador recomputado");
    expect(texto).not.toContain("El orden recomputado");
  });

  it("aceptado: sin parámetro, un sorteo común llamado «Turnos» donde salen todos se lee como orden", async () => {
    // Comportamiento aceptado y escrito en docs/ux.md: `isTurnOrder` decide solo con lo sellado, así que
    // este comprobante común, sin ningún modo pedido, se muestra como un orden a propósito.
    const { pintarComprobaciones } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    pintarComprobaciones({ names, prize: "Turnos de la oficina" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [2, 0, 1],
      nombres: names,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("El orden recomputado");
    expect(texto).not.toContain("El ganador recomputado");
  });

  it("un orden de turnos con varias participaciones cuenta por persona y muestra los turnos sin sufijo", async () => {
    // Los dos modos juntos: el enlace lleva solo `?modo=turnos`, y la lista cierra como reparto.
    history.replaceState(null, "", "/verificar.html?lang=es&modo=turnos");
    const { renderList, renderResult } = await montar();
    const names = ["Ana Quispe (1/2)", "Ana Quispe (2/2)", "Beto Rojas", "Carla Suarez (1/2)", "Carla Suarez (2/2)"];
    renderList({ names } as never);
    expect(cuenta().textContent).toBe("3 personas, 5 participaciones");
    renderResult({ names, prize: "Turnos" } as never, { ronda: 1, firma: "ab", semilla: "cd", ganadores: [1, 2, 0, 3, 4], nombres: names, ancla: { tipo: "libre" } } as never, "Turnos", {
      fromChain: false,
    });
    const turnos = [...document.querySelectorAll<HTMLElement>("#v-winners .winner-name")].map((n) => n.textContent);
    expect(turnos).toEqual(["Ana Quispe", "Beto Rojas", "Ana Quispe", "Carla Suarez", "Carla Suarez"]);
    expect(document.getElementById("v-winners")?.textContent).not.toContain("(2/2)");
  });

  it("un orden común con nombres que parecen sufijos, sin modo en el enlace, se muestra tal cual", async () => {
    const { renderList, renderResult } = await montar();
    const names = ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Otro"];
    renderList({ names } as never);
    expect(cuenta().textContent).toBe("3 participantes");
    renderResult({ names, prize: "Turnos" } as never, { ronda: 1, firma: "ab", semilla: "cd", ganadores: [2, 0, 1], nombres: names, ancla: { tipo: "libre" } } as never, "Turnos", {
      fromChain: false,
    });
    const turnos = [...document.querySelectorAll<HTMLElement>("#v-winners .winner-name")].map((n) => n.textContent);
    expect(turnos).toEqual(["Otro", "Grupo 4 (1/2)", "Grupo 4 (2/2)"]);
  });

  it("un orden sellado sin los modos lleva el enlace de siempre, y su verificación muestra las líneas tal cual", async () => {
    // «Turnos de exposición» sin bandera ni parámetro: el enlace se arma con el modo que decide la herramienta.
    const { modoDelComprobante } = await import("./modos/turnos");
    const { withMode } = await import("./modos/bandera");
    const names = ["Grupo 4 (1/2)", "Grupo 4 (2/2)", "Otro"];
    const enlace = new URL(withMode("https://tinkazo.app/verificar.html#rX", modoDelComprobante(names, 3, "Turnos de exposición", false)));
    expect(enlace.search).toBe("");
    history.replaceState(null, "", `/verificar.html?lang=es${enlace.search.replace("?", "&")}`);
    const { renderList, renderResult } = await montar();
    renderList({ names } as never);
    expect(cuenta().textContent).toBe("3 participantes");
    renderResult({ names, prize: "Turnos de exposición" } as never, { ronda: 1, firma: "ab", semilla: "cd", ganadores: [2, 0, 1], nombres: names, ancla: { tipo: "libre" } } as never, "Turnos de exposición", {
      fromChain: false,
    });
    const turnos = [...document.querySelectorAll<HTMLElement>("#v-winners .winner-name")].map((n) => n.textContent);
    expect(turnos).toEqual(["Otro", "Grupo 4 (1/2)", "Grupo 4 (2/2)"]);
  });

  it("un sorteo común sigue diciendo «El ganador recomputado»", async () => {
    const { pintarComprobaciones } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    pintarComprobaciones({ names, prize: "Una pizza" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [1],
      nombres: names,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    expect(document.getElementById("checks")?.textContent).toContain("El ganador recomputado");
  });
});
