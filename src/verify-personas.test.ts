// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "./campana/cuentas-de-prueba";

/**
 * El comprobante con líneas de persona (`renderList`, `renderResult` y las comprobaciones de `verify.ts`): cada línea de
 * persona se muestra como su lugar en la lista, en la lista sellada, en las tarjetas, en la comprobación y en el mensaje de
 * compartir, y nunca como la línea. Con líneas de persona el buscador por nombre no se muestra: no hay nombres que buscar. Se decide línea por línea, así que también vale con una lista mezclada. Con
 * una lista de cuentas o una lista libre de nombres, la página queda exactamente como siempre. Se prueba con el markup de
 * verdad de `verificar.html`.
 */

const pagina = readFileSync(join(process.cwd(), "verificar.html"), "utf8");

const { abrirSorteo } = vi.hoisted(() => ({ abrirSorteo: vi.fn() }));
vi.mock("./ui/compartir", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ui/compartir")>()), abrirSorteo }));

beforeAll(() => {
  window.matchMedia = ((q: string) =>
    ({ matches: false, media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
});

beforeEach(() => {
  vi.resetModules();
  abrirSorteo.mockClear();
  history.replaceState(null, "", "/verificar.html?lang=es");
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

async function montar(): Promise<typeof import("./verify")> {
  await import("./i18n");
  return import("./verify");
}

const aviso = (): HTMLElement => document.getElementById("v-personas") as HTMLElement;
const cuenta = (): string => document.getElementById("v-count")?.textContent ?? "";
/** El buscador por nombre de la lista sellada: su rótulo, el cuadro y lo que contesta. */
const buscador = (): HTMLElement[] => {
  const partes = [document.querySelector<HTMLElement>('label[for="v-buscar"]'), document.getElementById("v-buscar"), document.getElementById("v-buscar-out")];
  expect(partes.every((p) => p !== null)).toBe(true);
  return partes as HTMLElement[];
};
const tarjetas = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("#v-winners .winner-card")];
const filas = (): string[] => [...document.querySelectorAll<HTMLElement>("#v-names i")].map((f) => f.textContent ?? "");
const nombres = (): string[] => [...document.querySelectorAll<HTMLElement>("#v-winners .winner-name")].map((n) => n.textContent ?? "");
const premios = (): string[] => tarjetas().map((c) => c.querySelector(".winner-prize")?.textContent ?? "");

const lineas = [1, 2, 3, 4, 5].map((n) => lineaDePrueba(n));
const ES = "Hay líneas que no dicen a quién pertenecen. Se muestran como su lugar en la lista.";
const EN = "Some lines don't say who they belong to. They show as their spot on the list.";

const revision = (names: string[], ganadores: number[]): never =>
  ({ ronda: 7, firma: "ab", semilla: "cd", ganadores, nombres: names, ancla: { tipo: "libre" } }) as never;

describe("el comprobante: el renglón de la lista de personas", () => {
  it("el markup lo trae oculto por defecto, debajo del encabezado de la lista, con su clave y su texto en español", () => {
    expect(aviso()).not.toBeNull();
    expect(aviso().style.display).toBe("none");
    expect(aviso().dataset.i).toBe("vListaDePersonas");
    expect(aviso().textContent?.trim()).toBe(ES);
    // Está en el cuerpo de la lista, antes del buscador.
    const cuerpo = document.getElementById("v-list-h")?.closest(".block");
    expect(cuerpo?.contains(aviso())).toBe(true);
    expect(aviso().compareDocumentPosition(document.getElementById("v-buscar") as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("un script nuevo con un HTML viejo en la caché, sin el renglón, no rompe el comprobante", async () => {
    aviso().remove();
    expect(document.getElementById("v-personas")).toBeNull();
    const { renderList } = await montar();
    expect(() => renderList({ names: lineas } as never)).not.toThrow();
    expect(cuenta()).toBe("5 participantes");
    expect(filas()).toEqual(["Lugar 1", "Lugar 2", "Lugar 3", "Lugar 4", "Lugar 5"]);
    // Y una lista de cuentas tampoco lo busca.
    expect(() => renderList({ names: [cuentaDePrueba(1), cuentaDePrueba(2)] } as never)).not.toThrow();
  });

  it("una lista toda de líneas de persona lo muestra, y la cuenta de arriba es la de siempre", async () => {
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    expect(aviso().style.display).toBe("");
    expect(aviso().textContent).toBe(ES);
    expect(cuenta()).toBe("5 participantes");
    expect(document.querySelectorAll("#v-names i")).toHaveLength(5);
  });

  it("la lista sellada muestra el lugar de cada línea y ninguna línea, ni en el texto ni en la cara", async () => {
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    expect(filas()).toEqual(["Lugar 1", "Lugar 2", "Lugar 3", "Lugar 4", "Lugar 5"]);
    const html = document.getElementById("v-names")?.innerHTML ?? "";
    expect(html).not.toContain("p1:");
    const legible = ((): string => {
      try {
        return decodeURIComponent(html);
      } catch {
        return html;
      }
    })();
    for (const l of lineas) {
      expect(html).not.toContain(l.slice(3));
      expect(legible).not.toContain(l.slice(3));
    }
  });

  it("en inglés la lista dice Spot n", async () => {
    history.replaceState(null, "", "/verificar.html?lang=en");
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    expect(filas()).toEqual(["Spot 1", "Spot 2", "Spot 3", "Spot 4", "Spot 5"]);
  });

  it("una lista mezclada muestra el lugar de las líneas y deja el resto como estaba", async () => {
    const { renderList } = await montar();
    renderList({ names: [lineas[0] as string, "Ana", cuentaDePrueba(1), lineas[1] as string] } as never);
    expect(filas()).toEqual(["Lugar 1", "Ana", cuentaDePrueba(1), "Lugar 4"]);
    expect(document.getElementById("v-names")?.innerHTML).not.toContain("p1:");
    expect(aviso().style.display).toBe("");
  });

  it("una línea suelta también se muestra como su lugar", async () => {
    const { renderList } = await montar();
    renderList({ names: [lineas[0] as string] } as never);
    expect(filas()).toEqual(["Lugar 1"]);
    expect(aviso().style.display).toBe("");
  });

  it("con líneas de persona el buscador por nombre no se muestra: la lista dice Lugar n y no hay nombres que buscar", async () => {
    const { renderList } = await montar();
    for (const names of [lineas, [lineas[0] as string, "Ana", cuentaDePrueba(1), lineas[1] as string], [lineas[0] as string]]) {
      renderList({ names } as never);
      for (const parte of buscador()) expect(parte.style.display, JSON.stringify(names)).toBe("none");
    }
  });

  it("quien sí está en una lista de personas nunca lee que no aparece nadie con su nombre", async () => {
    const { renderList } = await montar();
    // Venía de buscarse en una lista de nombres, y la página pinta después una de personas.
    renderList({ names: ["Ana", "Beto", "Carla"] } as never);
    const buscar = document.getElementById("v-buscar") as HTMLInputElement;
    buscar.value = "Nora";
    buscar.dispatchEvent(new Event("input"));
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("No aparece nadie con ese nombre.");
    renderList({ names: lineas } as never);
    expect(buscar.value).toBe("");
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("");
    expect(document.querySelectorAll("#v-names i.match")).toHaveLength(0);
    // Aunque algo escriba en el cuadro escondido, no dice nada de nadie.
    buscar.value = "Nora";
    buscar.dispatchEvent(new Event("input"));
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("");
    expect(document.body.textContent).not.toContain("p1:");
  });

  it("con una lista de nombres o de cuentas el buscador queda como siempre", async () => {
    const { renderList } = await montar();
    renderList({ names: ["Ana", "Beto", "Carla"] } as never);
    for (const parte of buscador()) expect(parte.style.display).toBe("");
    const buscar = document.getElementById("v-buscar") as HTMLInputElement;
    buscar.value = "beto";
    buscar.dispatchEvent(new Event("input"));
    expect([...document.querySelectorAll("#v-names i.match")].map((f) => f.textContent)).toEqual(["Beto"]);
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("Estás en el puesto 2 de 3.");
    buscar.value = "Nora";
    buscar.dispatchEvent(new Event("input"));
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("No aparece nadie con ese nombre.");
    const cuentas = [cuentaDePrueba(1), cuentaDePrueba(2)];
    renderList({ names: cuentas } as never);
    for (const parte of buscador()) expect(parte.style.display).toBe("");
    buscar.value = cuentaDePrueba(2);
    buscar.dispatchEvent(new Event("input"));
    expect(document.getElementById("v-buscar-out")?.textContent).toBe("Estás en el puesto 2 de 2.");
  });

  it("un buscador que se escondió vuelve si después se pinta una lista de nombres", async () => {
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    for (const parte of buscador()) expect(parte.style.display).toBe("none");
    renderList({ names: ["Ana", "Beto", "Carla"] } as never);
    for (const parte of buscador()) expect(parte.style.display).toBe("");
  });

  it("en inglés dice lo mismo en inglés", async () => {
    history.replaceState(null, "", "/verificar.html?lang=en");
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    expect(aviso().style.display).toBe("");
    expect(aviso().textContent).toBe(EN);
  });

  it("una lista de cuentas, una de nombres libres, una con líneas casi bien y una vacía no lo muestran", async () => {
    const { renderList } = await montar();
    const casos: string[][] = [
      [cuentaDePrueba(1), cuentaDePrueba(2), cuentaDePrueba(3)],
      ["Ana", "Beto", "Carla"],
      [(lineas[0] as string).toUpperCase(), `${(lineas[1] as string).slice(0, -1)}z`],
      [],
    ];
    for (const names of casos) {
      renderList({ names } as never);
      expect(aviso().style.display, JSON.stringify(names)).toBe("none");
    }
  });

  it("un renglón que se mostró se esconde si después se pinta otra lista", async () => {
    const { renderList } = await montar();
    renderList({ names: lineas } as never);
    expect(aviso().style.display).toBe("");
    renderList({ names: ["Ana", "Beto", "Carla"] } as never);
    expect(aviso().style.display).toBe("none");
  });

  it("la lista de cuentas y la de nombres se pintan igual que siempre", async () => {
    const { renderList } = await montar();
    const cuentas = [cuentaDePrueba(1), cuentaDePrueba(2)];
    renderList({ names: cuentas } as never);
    expect([...document.querySelectorAll("#v-names i")].map((f) => f.textContent)).toEqual(cuentas);
    expect(cuenta()).toBe("2 participantes");
    renderList({ names: ["Ana", "Beto", "Carla"] } as never);
    expect([...document.querySelectorAll("#v-names i")].map((f) => f.textContent)).toEqual(["Ana", "Beto", "Carla"]);
    expect(cuenta()).toBe("3 participantes");
  });
});

describe("el comprobante: las ganadoras de una lista de personas", () => {
  it("cada tarjeta dice Lugar n de la lista, con el premio, y no aparece ninguna línea", async () => {
    const { renderResult } = await montar();
    renderResult({ names: lineas, prize: "Auriculares" } as never, revision(lineas, [2, 0]), "Auriculares", { fromChain: false });
    expect(nombres()).toEqual(["Lugar 3 de la lista", "Lugar 1 de la lista"]);
    expect(premios()).toEqual(["Se lleva: Auriculares", "Se lleva: Auriculares"]);
    const html = document.getElementById("v-winners")?.innerHTML ?? "";
    for (const l of lineas) expect(html).not.toContain(l);
    expect(html).not.toContain("p1:");
    expect(document.querySelector("#v-winners .again-note")).toBeNull();
  });

  it("en inglés dice Spot n on the list", async () => {
    history.replaceState(null, "", "/verificar.html?lang=en");
    const { renderResult } = await montar();
    renderResult({ names: lineas, prize: "Headphones" } as never, revision(lineas, [4]), "Headphones", { fromChain: false });
    expect(nombres()).toEqual(["Spot 5 on the list"]);
    expect(premios()).toEqual(["Takes home: Headphones"]);
  });

  it("sin premio, la tarjeta lleva solo el lugar", async () => {
    const { renderResult } = await montar();
    renderResult({ names: lineas, prize: "" } as never, revision(lineas, [1]), "", { fromChain: false });
    expect(nombres()).toEqual(["Lugar 2 de la lista"]);
    expect(premios()).toEqual([""]);
  });

  it("aunque la lista sellada sea un orden de turnos, no se muestra ninguna línea", async () => {
    const { renderResult } = await montar();
    renderResult({ names: lineas, prize: "Turnos" } as never, revision(lineas, [1, 0, 2, 4, 3]), "Turnos", { fromChain: false });
    expect(document.getElementById("v-winners")?.innerHTML).not.toContain("p1:");
    expect(nombres()).toEqual(["Lugar 2 de la lista", "Lugar 1 de la lista", "Lugar 3 de la lista", "Lugar 5 de la lista", "Lugar 4 de la lista"]);
  });

  it("el mensaje de compartir lleva el lugar de cada ganadora, no la línea", async () => {
    const { renderResult } = await montar();
    renderResult({ names: lineas, prize: "Auriculares" } as never, revision(lineas, [3, 1]), "Auriculares", { fromChain: false });
    (document.getElementById("btn-compartir") as HTMLButtonElement).click();
    expect(abrirSorteo).toHaveBeenCalledTimes(1);
    const datos = abrirSorteo.mock.calls[0]?.[0] as { ganadores: string[]; total: number; personas: number };
    expect(datos.ganadores).toEqual(["Lugar 4 de la lista", "Lugar 2 de la lista"]);
    expect(datos.total).toBe(5);
    expect(datos.personas).toBe(5);
  });

  it("la comprobación del ganador tampoco muestra la línea", async () => {
    const { pintarComprobaciones } = await montar();
    pintarComprobaciones({ names: lineas, prize: "Auriculares" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [2, 0],
      nombres: lineas,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("El ganador, calculado de nuevo");
    expect(texto).toContain("Lugar 3 de la lista, Lugar 1 de la lista");
    expect(texto).not.toContain("p1:");
  });
});

describe("el comprobante de una lista que no es de personas, igual que siempre", () => {
  it("cuentas: la tarjeta lleva la cuenta tal cual", async () => {
    const { renderResult } = await montar();
    const cuentas = [cuentaDePrueba(1), cuentaDePrueba(2), cuentaDePrueba(3)];
    renderResult({ names: cuentas, prize: "Auriculares" } as never, revision(cuentas, [1]), "Auriculares", { fromChain: false });
    expect(nombres()).toEqual([cuentaDePrueba(2)]);
    expect(premios()).toEqual(["Se lleva: Auriculares"]);
    (document.getElementById("btn-compartir") as HTMLButtonElement).click();
    expect((abrirSorteo.mock.calls[0]?.[0] as { ganadores: string[] }).ganadores).toEqual([cuentaDePrueba(2)]);
  });

  it("nombres libres: la tarjeta lleva el nombre y el mensaje también", async () => {
    const { renderResult } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    renderResult({ names, prize: "Un libro" } as never, revision(names, [2]), "Un libro", { fromChain: false });
    expect(nombres()).toEqual(["Carla"]);
    (document.getElementById("btn-compartir") as HTMLButtonElement).click();
    expect((abrirSorteo.mock.calls[0]?.[0] as { ganadores: string[] }).ganadores).toEqual(["Carla"]);
  });

  it("una lista mezclada de líneas y nombres: la línea es su lugar y el nombre sigue siendo el nombre", async () => {
    const { renderResult } = await montar();
    const mezcla = [lineas[0] as string, "Ana", lineas[1] as string];
    renderResult({ names: mezcla, prize: "Un libro" } as never, revision(mezcla, [0, 1, 2]), "Un libro", { fromChain: false });
    expect(nombres()).toEqual(["Lugar 1 de la lista", "Ana", "Lugar 3 de la lista"]);
    expect(document.getElementById("v-winners")?.innerHTML).not.toContain("p1:");
    (document.getElementById("btn-compartir") as HTMLButtonElement).click();
    expect((abrirSorteo.mock.calls[0]?.[0] as { ganadores: string[] }).ganadores).toEqual(["Lugar 1 de la lista", "Ana", "Lugar 3 de la lista"]);
  });

  it("la comprobación del ganador de una lista mezclada tampoco muestra la línea", async () => {
    const { pintarComprobaciones } = await montar();
    const mezcla = [lineas[0] as string, "Ana", lineas[1] as string];
    pintarComprobaciones({ names: mezcla, prize: "Un libro" } as never, {
      ancla: { tipo: "libre" },
      firma: "ab",
      firmaOk: true,
      semilla: "cd",
      ganadores: [2, 1],
      nombres: mezcla,
      motivos: [],
      veredicto: "libre",
      huella: "00".repeat(32),
    } as never);
    const texto = document.getElementById("checks")?.textContent ?? "";
    expect(texto).toContain("Lugar 3 de la lista, Ana");
    expect(texto).not.toContain("p1:");
  });

  it("una línea de persona que sale dos veces no deja su línea en el aviso", async () => {
    const { renderResult } = await montar();
    const repetida = [lineas[0] as string, lineas[0] as string, lineas[1] as string];
    renderResult({ names: repetida, prize: "Un libro" } as never, revision(repetida, [0, 1]), "Un libro", { fromChain: false });
    expect(document.getElementById("v-winners")?.innerHTML).not.toContain("p1:");
  });

  it("un orden de turnos de nombres sigue siendo una lista de turnos", async () => {
    const { renderResult } = await montar();
    const names = ["Ana", "Beto", "Carla"];
    renderResult({ names, prize: "Turnos" } as never, revision(names, [2, 0, 1]), "Turnos", { fromChain: false });
    expect(nombres()).toEqual(["Carla", "Ana", "Beto"]);
  });
});

describe("los textos del comprobante de personas", () => {
  it("están en los dos idiomas, sin signos prohibidos, y el del lugar lleva el número en los dos", async () => {
    const { T } = await import("./i18n");
    for (const l of ["es", "en"] as const) {
      for (const k of ["vListaDePersonas", "vLugarDeLaLista"]) {
        const v = T[l][k];
        expect(typeof v, `${l}.${k}`).toBe("string");
        expect(String(v), `${l}.${k}`).not.toMatch(/[;«»—–·→]/);
        expect(String(v), `${l}.${k}`).not.toMatch(/p1:|drand|hash|firma|signature|token/i);
      }
      expect(String(T[l].vLugarDeLaLista)).toContain("{n}");
    }
    expect(String(T.es.vListaDePersonas)).not.toMatch(/persona anotada/i);
    expect(T.es.vListaDePersonas).toBe(ES);
    expect(T.en.vListaDePersonas).toBe(EN);
    expect(T.es.vLugarDeLaLista).toBe("Lugar {n} de la lista");
    expect(T.en.vLugarDeLaLista).toBe("Spot {n} on the list");
  });
});
