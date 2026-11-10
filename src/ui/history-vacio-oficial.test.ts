// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Mis sorteos con la cuenta vacía. En Oficial la cuenta empieza sin nada aunque haya sorteos en Prueba: el estado
 * vacío tiene que decir dónde están y ofrecer volver. Sin modo Oficial queda igual que en producción: ninguna línea.
 */

const h = vi.hoisted(() => ({ cambios: [] as string[], oficial: true, red: "mainnet" }));

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get hayModoOficial() {
      return h.oficial;
    },
    network: new Proxy(real.network, { get: (t, k) => (k === "name" ? h.red : Reflect.get(t, k)) }),
    changeMode: (r: string) => {
      h.cambios.push(r);
      return true;
    },
  };
});

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

function paginaDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", html.indexOf('id="hist-vacio"')) + "</section>".length;
  return html.slice(desde, hasta);
}

beforeEach(() => {
  vi.resetModules();
  h.cambios = [];
  h.oficial = true;
  h.red = "mainnet";
  localStorage.clear();
  document.body.innerHTML = paginaDeMisSorteos();
  // La cadena no contesta y no hay nada guardado: la cuenta está vacía.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const lineaVacia = (): HTMLElement => document.getElementById("hist-vacio-otro-modo") as HTMLElement;

describe("Mis sorteos vacío y el otro modo", () => {
  it("en Oficial, la cuenta vacía dice que los sorteos de Prueba están en Prueba y ofrece volver", async () => {
    const hist = await import("./history");
    hist.renderHistory(WHO);
    expect(lineaVacia().style.display).not.toBe("none");
    expect(lineaVacia().textContent).toContain(T.es.historyOtherModeTest);
    const boton = lineaVacia().querySelector("button");
    expect(boton?.textContent).toBe(T.es.historySwitchToTest);
    boton?.click();
    await vi.waitFor(() => expect(h.cambios).toEqual(["testnet"]));
    // La sección con la lista sigue escondida: el estado vacío es el que queda a la vista.
    expect((document.getElementById("sec-history") as HTMLElement).style.display).toBe("none");
  });

  it("en Prueba, la cuenta vacía ofrece pasar a Oficial", async () => {
    h.red = "testnet";
    const hist = await import("./history");
    hist.renderHistory(WHO);
    expect(lineaVacia().textContent).toContain(T.es.historyOtherModeOfficial);
    expect(lineaVacia().querySelector("button")?.textContent).toBe(T.es.historySwitchToOfficial);
  });

  it("sin modo Oficial, la cuenta vacía queda como hoy: sin la línea", async () => {
    h.oficial = false;
    h.red = "testnet";
    const hist = await import("./history");
    hist.renderHistory(WHO);
    expect(lineaVacia().style.display).toBe("none");
    expect(lineaVacia().textContent).toBe("");
    expect((document.getElementById("sec-history") as HTMLElement).style.display).toBe("none");
  });

  it("con sorteos a la vista, la línea del estado vacío se esconde", async () => {
    const hist = await import("./history");
    hist.renderHistory(WHO);
    expect(lineaVacia().style.display).not.toBe("none");
    hist.remember({ organizer: WHO, listHash: "aa", count: 2, numWinners: 1, round: 100, sealedAt: 1_000, prize: "", names: ["Ana", "Beto"] });
    hist.renderHistory(WHO);
    expect(lineaVacia().style.display).toBe("none");
  });
});
