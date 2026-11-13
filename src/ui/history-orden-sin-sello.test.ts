// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Mis sorteos y un orden de turnos hecho sin sello: no tiene comprobante, así que su tarjeta no ofrece ningún enlace de
 * verificación (ni el que apunta a la ronda, ni sumarlo a un evento). Un sorteo común sin sello, o un orden con sello,
 * conserva su enlace como siempre.
 */

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const RONDA = "https://api.drand.sh/dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493/public/100";
const VERIFICAR = "https://tinkazo.app/verificar.html#rX";

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = seccionDeMisSorteos();
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const personas = ["Ana", "Beto", "Carla"];
async function pintar(over: Record<string, unknown>): Promise<string> {
  const hist = await import("./history");
  hist.remember({
    organizer: WHO,
    listHash: "aa",
    count: 3,
    numWinners: 3,
    round: 100,
    sealedAt: 1_000,
    prize: "Turnos",
    names: personas,
    winners: ["Beto", "Ana", "Carla"],
    ...over,
  } as never);
  hist.renderHistory(WHO);
  return document.getElementById("hist-list")?.innerHTML ?? "";
}

describe("Mis sorteos con un orden de turnos sin sello", () => {
  it("la tarjeta no ofrece Ver comprobante, ni Compartir, ni sumarlo a un evento", async () => {
    const html = await pintar({ sinSello: true, proof: RONDA });
    expect(html).toContain(T.es.redSinSelloEtiqueta);
    expect(html).not.toContain(T.es.histSeeProof);
    expect(html).not.toContain("data-compartir");
    expect(html).not.toContain("data-sumar");
    expect(html).not.toContain(RONDA);
  });

  it("una entrada vieja, guardada con su enlace de verificación, tampoco lo ofrece", async () => {
    const html = await pintar({ sinSello: true, proof: VERIFICAR });
    expect(html).not.toContain(T.es.histSeeProof);
    expect(html).not.toContain(VERIFICAR);
  });
});

describe("lo demás conserva su enlace", () => {
  it("un orden de turnos con sello", async () => {
    const html = await pintar({ id: "7", proof: VERIFICAR });
    expect(html).toContain(T.es.histSeeProof);
    expect(html).toContain(VERIFICAR);
  });

  it("un sorteo común sin sello", async () => {
    const html = await pintar({ sinSello: true, numWinners: 1, prize: "Termo", winners: ["Ana"], proof: VERIFICAR });
    expect(html).toContain(T.es.histSeeProof);
    expect(html).toContain(VERIFICAR);
  });
});

/**
 * El archivo de Mis sorteos tiene una columna comprobante. Un orden de turnos sin sello no tiene comprobante: la celda
 * queda vacía. La ronda sigue en su propia columna.
 */
describe("el archivo CSV con un orden de turnos sin sello", () => {
  async function celdaDelComprobante(over: Record<string, unknown>): Promise<string | undefined> {
    await pintar(over);
    const hist = await import("./history");
    const [cabecera, fila] = hist.toCsv(WHO).split("\n");
    const celdas = (linea: string): string[] => linea.slice(1, -1).split('","');
    return celdas(fila ?? "")[celdas(cabecera ?? "").indexOf("comprobante")];
  }

  it("la celda del comprobante queda vacía, con el enlace de la ronda o con uno viejo de verificación", async () => {
    expect(await celdaDelComprobante({ sinSello: true, proof: RONDA })).toBe("");
    vi.resetModules();
    localStorage.clear();
    expect(await celdaDelComprobante({ sinSello: true, proof: VERIFICAR })).toBe("");
  });

  it("un orden con sello y un sorteo común sin sello conservan su enlace", async () => {
    expect(await celdaDelComprobante({ id: "7", proof: VERIFICAR })).toBe(VERIFICAR);
    vi.resetModules();
    localStorage.clear();
    expect(await celdaDelComprobante({ sinSello: true, numWinners: 1, prize: "Termo", winners: ["Ana"], proof: VERIFICAR })).toBe(VERIFICAR);
  });
});
