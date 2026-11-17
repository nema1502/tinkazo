// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { PROOF_VERSION, proofUrl } from "../protocol/proof";

/**
 * Un sorteo cuyo resultado grabado no coincide con el que vio la sala (`noCoincide`) no se comparte desde Mis sorteos
 * hasta revisarlo: ni en su tarjeta, ni en el Compartir el evento de su día, ni sumado a un evento con nombre. La
 * tarjeta lo dice. Los demás sorteos del mismo día se comparten como siempre.
 */

const h = vi.hoisted(() => ({ evento: vi.fn(), sorteo: vi.fn() }));
vi.mock("./compartir", () => ({
  compartirEvento: (...a: unknown[]) => h.evento(...a),
  compartirSorteo: (...a: unknown[]) => h.sorteo(...a),
}));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** Un sorteo con comprobante y ganador, sellado hace `hace` segundos. */
async function sorteo(id: string, ganador: string, hace: number, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { network } = await import("../stellar/config");
  const sealedAt = Math.floor(Date.now() / 1000) - hace;
  const names = [ganador, "Nora"];
  const proof = await proofUrl({ v: PROOF_VERSION, names, round: 100 + Number(id), sealedAt, prize: `Premio ${id}`, net: network.name, contract: network.contractId ?? "", id, signature: "ab".repeat(48) });
  return { organizer: WHO, listHash: `h${id}`, count: 2, numWinners: 1, round: 100 + Number(id), sealedAt, prize: `Premio ${id}`, names, winners: [ganador], id, contract: network.contractId ?? "", proof, ...extra };
}

/** Mis sorteos con un sorteo bien guardado (Ana) y uno cuyo resultado grabado no coincide (Beto), del mismo día. */
async function pintar(conEvento = false): Promise<{ bien: Record<string, unknown>; enDuda: Record<string, unknown> }> {
  const hist = await import("./history");
  const bien = await sorteo("7", "Ana", 3600);
  const enDuda = await sorteo("8", "Beto", 1800, { porGrabar: false, noCoincide: true });
  hist.remember(bien as never);
  hist.remember(enDuda as never);
  if (conEvento) {
    const { network } = await import("../stellar/config");
    const ev = await import("./eventos");
    let lista = ev.crearEvento([], WHO, "Fiesta", "e1");
    lista = ev.sumarAEvento(lista, "e1", { enlace: bien.proof as string, ganadores: ["Ana"] });
    lista = ev.sumarAEvento(lista, "e1", { enlace: enDuda.proof as string, ganadores: ["Beto"] });
    ev.guardarEventos(network.name, lista);
  }
  hist.renderHistory(WHO);
  return { bien, enDuda };
}

const tarjetaDe = (premio: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>("#hist-list article")].find((a) => a.querySelector("h3")?.textContent === premio);

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  h.evento.mockReset();
  h.sorteo.mockReset();
  document.body.innerHTML = seccionDeMisSorteos();
  // El comprobante sin comprimir: jsdom no sabe leer un archivo como flujo.
  vi.stubGlobal("CompressionStream", undefined);
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mis sorteos no comparte un resultado en duda", () => {
  it("solo, no forma un grupo con Compartir el evento ni es la acción principal: su tarjeta lo dice", async () => {
    const hist = await import("./history");
    hist.remember((await sorteo("8", "Beto", 1800, { porGrabar: false, noCoincide: true })) as never);
    hist.renderHistory(WHO);
    expect(document.querySelector("#hist-list [data-evento]")).toBeNull();
    expect(document.querySelector("#hist-list [data-compartir]")).toBeNull();
    expect(document.querySelector("#sec-history [data-principal]")).toBeNull();
    expect(tarjetaDe("Premio 8")?.textContent).toContain(T.es.grabNoCoincide);
  });

  it("Compartir el evento del día manda los demás sorteos y deja afuera el que está en duda", async () => {
    await pintar();
    const grupo = document.querySelector<HTMLButtonElement>("#hist-list [data-evento]");
    expect(grupo).not.toBeNull();
    grupo?.click();
    await vi.waitFor(() => expect(h.evento).toHaveBeenCalledTimes(1));
    const mandados = h.evento.mock.calls[0]?.[1] as { ganadores: string[] }[];
    expect(mandados.map((s) => s.ganadores)).toEqual([["Ana"]]);
  });

  it("un evento con nombre no lo ofrece para sumar", async () => {
    const { network } = await import("../stellar/config");
    const ev = await import("./eventos");
    ev.guardarEventos(network.name, ev.crearEvento([], WHO, "Fiesta", "e1"));
    await pintar();
    const ofrecidos = [...document.querySelectorAll<HTMLElement>("#hist-eventos [data-evento-sumar]")].map((b) => b.closest("li")?.textContent ?? "");
    expect(ofrecidos).toHaveLength(1);
    expect(ofrecidos[0]).toContain("Ana");
  });

  it("si ya estaba en un evento con nombre, ese evento no lo comparte", async () => {
    const { enDuda } = await pintar(true);
    const fila = [...document.querySelectorAll<HTMLElement>("#hist-eventos .evn-sorteo")].find((li) => li.textContent?.includes("Beto"));
    expect(fila?.querySelector("[data-compartir-enlace]")).toBeNull();
    document.querySelector<HTMLButtonElement>('#hist-eventos [data-evento-compartir="e1"]')?.click();
    await vi.waitFor(() => expect(h.evento).toHaveBeenCalledTimes(1));
    const mandados = h.evento.mock.calls[0]?.[1] as { ganadores: string[] }[];
    expect(mandados.map((s) => s.ganadores)).toEqual([["Ana"]]);
    expect(enDuda.noCoincide).toBe(true);
  });
});
