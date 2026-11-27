// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * Mis sorteos con una campaña de personas. Quien organiza sortea con la lista de líneas de persona, y esas líneas
 * nunca se ven: ni en la tarjeta, ni en el detalle del evento, ni en el archivo que se baja, ni en lo que se comparte,
 * ni en lo que queda guardado en el navegador. Se ve el nombre, o el lugar en la lista.
 */

const h = vi.hoisted(() => ({ evento: vi.fn(), sorteo: vi.fn() }));
vi.mock("./compartir", () => ({
  compartirEvento: (...a: unknown[]) => h.evento(...a),
  compartirSorteo: (...a: unknown[]) => h.sorteo(...a),
}));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const AHORA = 1_790_000_000;
const LINEAS = [lineaDePrueba(1), lineaDePrueba(2), lineaDePrueba(3), lineaDePrueba(4)];

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** La fila que anota el sorteo al revelar el resultado: los ganadores son las líneas de la lista sellada, tal cual. */
const sorteoDePersonas = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  organizer: WHO,
  listHash: "ab".repeat(32),
  count: LINEAS.length,
  numWinners: 2,
  round: 77,
  sealedAt: AHORA - 120,
  prize: "Auriculares",
  names: LINEAS,
  winners: [LINEAS[2], LINEAS[0]],
  id: "9",
  proof: "https://tinkazo.app/verificar.html#rPRUEBA",
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA * 1000);
  localStorage.clear();
  sessionStorage.clear();
  h.evento.mockReset();
  h.sorteo.mockReset();
  history.replaceState(null, "", "/?lang=es");
  document.body.innerHTML = `<div id="pendiente" style="display:none"></div>${seccionDeMisSorteos()}`;
  vi.stubGlobal("CompressionStream", undefined);
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function pintar(entrada: Record<string, unknown>): Promise<typeof import("./history")> {
  const hist = await import("./history");
  hist.remember(entrada as never);
  hist.renderHistory(WHO);
  return hist;
}

const tarjeta = (): HTMLElement => document.querySelector<HTMLElement>("#hist-list article") as HTMLElement;

describe("Mis sorteos con una lista de personas", () => {
  it("sin nombres, la tarjeta dice el lugar en la lista y nunca la línea", async () => {
    const { winnerLabel } = await pintar(sorteoDePersonas());
    expect(tarjeta().textContent).toContain("Lugar 3 de la lista, Lugar 1 de la lista");
    expect(tarjeta().innerHTML).not.toContain("p1:");
    const guardada = JSON.parse(localStorage.getItem(Object.keys(localStorage)[0] ?? "") ?? "[]")[0];
    expect(winnerLabel(guardada)).toBe("Lugar 3 de la lista, Lugar 1 de la lista");
  });

  it("con los nombres de esta pestaña, dice el nombre", async () => {
    const { ponerEtiquetas } = await import("../equipos/etiquetas");
    ponerEtiquetas(new Map([[LINEAS[2] as string, "Nora"]]), "personas");
    await pintar(sorteoDePersonas());
    expect(tarjeta().textContent).toContain("Nora, Lugar 1 de la lista");
    expect(tarjeta().innerHTML).not.toContain("p1:");
  });

  it("nada de lo guardado en el navegador lleva una línea", async () => {
    await pintar(sorteoDePersonas());
    const guardado = JSON.stringify(JSON.parse(localStorage.getItem(Object.keys(localStorage)[0] ?? "") ?? "[]"), (k, v) =>
      k === "names" ? undefined : v,
    );
    expect(guardado).not.toContain("p1:");
  });

  it("el archivo que se baja no lleva la línea de quienes ganaron", async () => {
    const hist = await pintar(sorteoDePersonas());
    const csv = hist.toCsv(WHO);
    expect(csv).toContain("Lugar 3 de la lista | Lugar 1 de la lista");
    expect(csv).not.toContain("p1:");
  });

  it("lo que se comparte lleva el lugar y no la línea", async () => {
    await pintar(sorteoDePersonas());
    tarjeta().querySelector<HTMLButtonElement>("[data-compartir]")?.click();
    expect(h.sorteo).toHaveBeenCalledTimes(1);
    const [, ganadores] = h.sorteo.mock.calls[0] as [string, string[]];
    expect(ganadores).toEqual(["Lugar 3 de la lista", "Lugar 1 de la lista"]);
    expect(JSON.stringify(ganadores)).not.toContain("p1:");
  });

  it("se anota en dos tiempos, al sellar y al sortear, y no vuelve la línea", async () => {
    const hist = await import("./history");
    const { winners: _w, ...alSellar } = sorteoDePersonas();
    hist.remember(alSellar as never);
    hist.remember(sorteoDePersonas() as never);
    hist.renderHistory(WHO);
    expect(document.querySelectorAll("#hist-list article").length).toBe(1);
    expect(tarjeta().innerHTML).not.toContain("p1:");
    expect(tarjeta().textContent).toContain("Lugar 3 de la lista");
  });

  it("una lista de cuentas sigue anotándose como siempre", async () => {
    const hist = await pintar(sorteoDePersonas({ names: ["Ana", "Beto", "Carla", "Diego"], winners: ["Carla", "Ana"] }));
    expect(tarjeta().textContent).toContain("Carla, Ana");
    expect(hist.toCsv(WHO)).toContain("Carla | Ana");
  });
});
