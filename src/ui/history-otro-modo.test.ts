// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * El pie de Mis sorteos ofrece pasar al otro modo. Pasa por la misma guarda que la hoja del modo y la confirmación
 * del primer sello (`modo-ui.ts`): con un sorteo sellado esperando su número, no cambia y dice por qué.
 */

const h = vi.hoisted(() => ({ cambios: [] as string[] }));

vi.mock("../stellar/config", async (orig) => ({
  ...(await orig<typeof import("../stellar/config")>()),
  hayModoOficial: true,
  changeMode: (r: string) => {
    h.cambios.push(r);
    return true;
  },
}));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

beforeEach(() => {
  vi.resetModules();
  h.cambios = [];
  localStorage.clear();
  document.body.innerHTML = seccionDeMisSorteos();
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function pintarConUnSorteo(): Promise<void> {
  const hist = await import("./history");
  hist.remember({ organizer: WHO, listHash: "aa", count: 2, numWinners: 1, round: 100, sealedAt: 1_000, prize: "", names: ["Ana", "Beto"] });
  hist.renderHistory(WHO);
}

const botonDelPie = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("#hist-otro-modo button");

describe("el pie de Mis sorteos y el otro modo", () => {
  it("con un sorteo sellado esperando su número, no cambia de modo y dice por qué", async () => {
    const { app } = await import("../state");
    app.frozen = { names: ["Ana", "Beto"] } as unknown as typeof app.frozen;
    app.drawn = null;
    await pintarConUnSorteo();
    const boton = botonDelPie();
    expect(boton).not.toBeNull();
    boton?.click();
    await vi.waitFor(() => expect(document.getElementById("hist-otro-modo")?.textContent).toContain(T.es.modeSwitchBlocked));
    expect(h.cambios).toEqual([]);
  });

  it("sin sorteo esperando, cambia", async () => {
    const { app } = await import("../state");
    app.frozen = null;
    app.drawn = null;
    await pintarConUnSorteo();
    botonDelPie()?.click();
    await vi.waitFor(() => expect(h.cambios).toEqual(["mainnet"]));
  });
});
