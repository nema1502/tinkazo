// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Con la billetera propia, el show graba el sorteo recién al terminar (`draw.ts`), y Mis sorteos ya lo tiene anotado
 * por guardar. Mientras esa grabación va, Mis sorteos no puede mandar otra del mismo sorteo: con las dos aprobadas, la
 * segunda falla en la cadena y su comisión se paga igual. Una sola guarda para los dos caminos, por sorteo
 * (`grabacion-en-curso.ts`): Mis sorteos lo muestra apagado diciendo que se está guardando, y un toque que llega
 * igual espera la que está en curso en vez de mandar otra.
 */

const V = JSON.parse(readFileSync(join(process.cwd(), "docs/vectors.json"), "utf8")) as {
  list: string[];
  list_hash: string;
  quicknet: { round: number; signature: string; randomness: string };
  cases: { k: number; winners: number[] }[];
};

const h = vi.hoisted(() => ({ drawOnChain: vi.fn(), who: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY" }));

vi.mock("./anchor", () => ({ drawOnChain: (...a: unknown[]) => h.drawOnChain(...a), readDraw: async () => null }));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => {
    try {
      return { ok: true, valor: await o.intentar(), yaEstaba: false };
    } catch (error) {
      return { ok: false, error };
    }
  },
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ round: V.quicknet.round, signature: V.quicknet.signature }),
}));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: h.who, aMano: true }) }));
vi.mock("./sortear-propio", () => ({ sePuedeSortearPagando: async () => false }));

const WHO = h.who;
const ESPERADOS = V.cases.find((c) => c.k === 1)?.winners ?? [];
const TX = "cd".repeat(32);

function seccionDeMisSorteos(): string {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const desde = html.indexOf('<section class="block app-only tab-hist" id="sec-history"');
  const hasta = html.indexOf("</section>", desde) + "</section>".length;
  return html.slice(desde, hasta);
}

/** Mis sorteos con el sorteo 7 jugado y por guardar, como lo anota el show apenas hay resultado. */
async function anotar(): Promise<typeof import("./history")> {
  const { network } = await import("../stellar/config");
  const hist = await import("./history");
  hist.remember({
    organizer: WHO,
    listHash: V.list_hash,
    count: V.list.length,
    numWinners: ESPERADOS.length,
    round: V.quicknet.round,
    sealedAt: 1_000,
    prize: "Una pizza",
    winners: ESPERADOS.map((i) => V.list[i] ?? ""),
    id: "7",
    contract: network.contractId ?? "",
    porGrabar: true,
  });
  return hist;
}

/** La grabación del show, con la misma función que usa `draw.ts`, ya esperando a la cadena. */
async function grabaElShow(): Promise<{ fin: Promise<unknown> }> {
  const { grabarElSorteo } = await import("./grabar-sorteo");
  const fin = grabarElSorteo({ raffleId: 7n, round: V.quicknet.round, signature: V.quicknet.signature, esperados: ESPERADOS, dormir: async () => undefined });
  await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
  return { fin };
}

const guardar = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("[data-grabar]");

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  h.drawOnChain.mockReset();
  document.body.innerHTML = seccionDeMisSorteos();
  // La cadena no contesta: lo que se mira es lo de este navegador.
  vi.stubGlobal("fetch", () => new Promise(() => undefined));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Guardarlo ahora mientras el show guarda el mismo sorteo", () => {
  it("Mis sorteos lo muestra apagado diciendo que se está guardando, y al terminar lo vuelve a pintar", async () => {
    let fallar: (e: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValueOnce(new Promise((_r, j) => (fallar = j)));
    const hist = await anotar();
    const show = await grabaElShow();
    hist.renderHistory(WHO);
    expect(guardar()?.disabled).toBe(true);
    expect(guardar()?.textContent).toBe(T.es.grabGuardando);
    // La del show no se pudo: Mis sorteos vuelve a ofrecer Guardarlo ahora, encendido.
    fallar(new Error("la red no contestó"));
    await show.fin;
    await vi.waitFor(() => expect(guardar()?.disabled).toBe(false));
    expect(guardar()?.textContent).toBe(T.es.pendienteGrabarBtn);
  });

  it("si Guardarlo ahora ya estaba a la vista cuando arrancó la del show, el toque no manda otra", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    const hist = await anotar();
    hist.renderHistory(WHO);
    expect(guardar()?.disabled).toBe(false);
    const show = await grabaElShow();
    guardar()?.click();
    await new Promise((r) => setTimeout(r, 30));
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    soltar({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await show.fin;
    // El toque esperó la del show y se enteró de cómo terminó: la fila queda guardada.
    await vi.waitFor(() => expect(guardar()).toBeNull());
    expect(hist.historyOf(WHO)[0]).toEqual(expect.objectContaining({ porGrabar: false, drawTx: TX }));
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
  });
});
