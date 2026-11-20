// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Guardarlo ahora, en Mis sorteos (`history.ts`), termina de guardar un sorteo que la sala ya vio. Con la billetera
 * propia avisa que hay que aprobarlo en la billetera. Si el servicio que cubre el costo no pudo, ofrece la misma
 * segunda salida que el sorteo: guardarlo pagando con la cuenta propia. Y no guarda con otra cuenta sin avisar.
 */

const h = vi.hoisted(() => ({
  terminar: vi.fn(),
  sesion: null as null | { address: string; aMano?: boolean },
  pagando: true,
}));

vi.mock("./grabar-sorteo", () => ({ terminarDeGrabar: (...a: unknown[]) => h.terminar(...a) }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("./sortear-propio", () => ({ sePuedeSortearPagando: async () => h.pagando }));

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const OTRA = "GCOTRAQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4";

function seccionDeMisSorteos(): string {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** Mis sorteos con un sorteo jugado que falta guardar. */
async function pintar(extra: Record<string, unknown> = {}): Promise<void> {
  const { network } = await import("../stellar/config");
  const hist = await import("./history");
  hist.remember({ organizer: WHO, listHash: "aa", count: 2, numWinners: 1, round: 100, sealedAt: 1_000, prize: "", names: ["Ana", "Beto"], winners: ["Ana"], id: "7", contract: network.contractId ?? "", porGrabar: true, ...extra });
  hist.renderHistory(WHO);
}

const guardar = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("[data-grabar]");
const tarjeta = (): string => guardar()?.closest("article")?.textContent ?? "";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  h.terminar.mockReset();
  h.sesion = { address: WHO };
  h.pagando = true;
  document.body.innerHTML = seccionDeMisSorteos();
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Guardarlo ahora, en Mis sorteos", () => {
  it("con la billetera propia avisa que hay que aprobarlo en la billetera", async () => {
    h.sesion = { address: WHO, aMano: true };
    h.terminar.mockImplementation((_f: unknown, o?: { alPaso?: (paso: string) => void }) => {
      o?.alPaso?.("signing");
      return new Promise(() => undefined);
    });
    await pintar();
    guardar()?.click();
    await vi.waitFor(() => expect(h.terminar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es.txSigning));
  });

  it("si el servicio que cubre el costo no pudo, ofrece guardarlo pagando con la cuenta propia", async () => {
    h.terminar.mockResolvedValueOnce({ estado: "fallo", error: new Error("el servicio no pudo") }).mockReturnValue(new Promise(() => undefined));
    await pintar();
    guardar()?.click();
    const propio = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("[data-grabar-propio]");
    await vi.waitFor(() => expect(propio()).not.toBeNull());
    expect(propio()?.textContent).toBe(T.es.grabarPropio);
    expect(h.terminar.mock.calls[0]?.[1]).not.toEqual(expect.objectContaining({ pagarConMiCuenta: true }));
    propio()?.click();
    await vi.waitFor(() => expect(h.terminar).toHaveBeenCalledTimes(2));
    expect(h.terminar.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ pagarConMiCuenta: true }));
  });

  it("si no se puede pagar con la cuenta propia, no lo ofrece", async () => {
    h.pagando = false;
    h.terminar.mockResolvedValue({ estado: "fallo", error: new Error("el servicio no pudo") });
    await pintar();
    guardar()?.click();
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es.grabNoSePudo));
    expect(document.querySelector("[data-grabar-propio]")).toBeNull();
  });

  it.each([
    ["puede-guardar", "premioGuardadoSorteo"],
    ["no-se-sabe", "premioSinSaberSorteo"],
  ] as const)("si la puerta del premio frenó la grabación (%s), la nota es el aviso del sorteo y no el de siempre", async (que, clave) => {
    // Pagar con la cuenta propia no existe con una cuenta de Google en la red principal (`sePuedeSortearPagando`).
    h.pagando = false;
    const error = Object.assign(new Error(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber"), { name: "PremioGuardado", que });
    h.terminar.mockResolvedValue({ estado: "fallo", error });
    await pintar();
    guardar()?.click();
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es[`errAnchor.${clave}`] as string));
    expect(tarjeta()).not.toContain(T.es.grabNoSePudo);
    expect(document.querySelector("[data-grabar-propio]")).toBeNull();
    // El botón queda para volver a probar.
    expect(guardar()?.textContent).toBe(T.es.pendienteGrabarBtn);
    expect(guardar()?.disabled).toBe(false);
  });

  const premio = (que: "puede-guardar" | "no-se-sabe"): Error => Object.assign(new Error(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber"), { name: "PremioGuardado", que });
  const comprobante = (): HTMLAnchorElement | null => document.querySelector<HTMLAnchorElement>("a[href^='https://comprobante.test']");

  it("si la cuenta ya puede guardar dinero, volver a probar no es la principal: lo es el comprobante", async () => {
    h.pagando = false;
    h.terminar.mockResolvedValue({ estado: "fallo", error: premio("puede-guardar") });
    await pintar({ proof: "https://comprobante.test/#prueba" });
    expect(guardar()?.className).toContain("primary");
    guardar()?.click();
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es["errAnchor.premioGuardadoSorteo"] as string));
    expect(guardar()?.className).toContain("ghost");
    expect(guardar()?.className).not.toContain("primary");
    expect(comprobante()?.className).toContain("primary");
    expect(comprobante()?.className).not.toContain("ghost");
    expect(comprobante()?.textContent).toBe(T.es.histSeeProof);
    expect(document.querySelector("[data-grabar-propio]")).toBeNull();
  });

  it("si no se pudo comprobar, probar de nuevo sigue siendo lo principal", async () => {
    h.pagando = false;
    h.terminar.mockResolvedValue({ estado: "fallo", error: premio("no-se-sabe") });
    await pintar({ proof: "https://comprobante.test/#prueba" });
    guardar()?.click();
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es["errAnchor.premioSinSaberSorteo"] as string));
    expect(guardar()?.className).toContain("primary");
    expect(comprobante()?.className).toContain("ghost");
  });

  it("con otra cuenta activa no lo guarda sin avisar: dice que entre con la cuenta del sorteo", async () => {
    h.sesion = { address: OTRA };
    await pintar();
    guardar()?.click();
    expect(T.es.grabOtraCuenta).toBeTruthy();
    await vi.waitFor(() => expect(tarjeta()).toContain(T.es.grabOtraCuenta));
    expect(h.terminar).not.toHaveBeenCalled();
  });

  it("si lo guardado no coincide, lo anota en la fila: no lo ofrece guardar otra vez ni compartir", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.terminar.mockResolvedValue({ estado: "no-coincide", esperados: [0], grabados: [1] });
    await pintar();
    guardar()?.click();
    await vi.waitFor(() => expect(h.terminar).toHaveBeenCalledTimes(1));
    // Al volver a pintarse, la fila ya no dice que falta guardarlo ni ofrece Guardarlo ahora: dice lo que pasó.
    await vi.waitFor(() => expect(document.querySelector("[data-grabar]")).toBeNull());
    const lista = document.getElementById("hist-list")?.textContent ?? "";
    expect(lista).toContain(T.es.grabNoCoincide);
    expect(lista).not.toContain(T.es.histStateSinGuardar);
    expect(document.querySelector("[data-compartir]")).toBeNull();
    const { historyOf } = await import("./history");
    expect(historyOf(WHO)[0]).toEqual(expect.objectContaining({ porGrabar: false, noCoincide: true }));
    consola.mockRestore();
  });

  it("los textos nuevos están en los dos idiomas, sin palabras técnicas", () => {
    for (const k of ["grabarPropio", "grabOtraCuenta"] as const) {
      for (const L of [T.es, T.en]) {
        const s = String((L as Record<string, unknown>)[k]);
        expect(s.length).toBeGreaterThan(3);
        expect(s).not.toMatch(/[;«»]|\b(token|hash|transacci|firma|ledger|drand|XLM|ronda|cadena|blockchain|signature|transaction)\b/i);
      }
    }
  });
});
