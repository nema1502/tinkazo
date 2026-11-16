// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mis sorteos sabe que un sorteo jugado falta guardarlo desde el momento en que hay resultado, antes del show
 * (`draw.ts`). Si la pestaña se cierra o se recarga durante el show, que dura de 20 a 60 segundos, la fila queda con
 * sus ganadores y Guardarlo ahora. Con la billetera propia también: su aprobación se pide recién después del show.
 */

const V = JSON.parse(readFileSync(join(process.cwd(), "docs/vectors.json"), "utf8")) as {
  list: string[];
  list_hash: string;
  quicknet: { round: number; signature: string; randomness: string };
  cases: { k: number; winners: number[] }[];
};

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  juego: vi.fn(),
  fin: null as null | (() => void),
  remember: vi.fn(),
  sesion: { address: "GAAA" } as { address: string; aMano?: boolean },
}));

vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  existenciaDelSorteo: async () => "existe",
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
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
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ round: V.quicknet.round, signature: V.quicknet.signature }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 3.5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => true }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: async () => undefined }));
vi.mock("../stellar/monedas-eventos", () => ({ acreditarEnSegundoPlano: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => true }));
vi.mock("../games/pixi", () => ({
  playPixi: async (_g: unknown, _n: unknown, winners: number[], _b: unknown, fin: () => void) => {
    h.juego([...winners]);
    h.fin = fin;
    return true;
  },
}));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const ESPERADOS = V.cases.find((c) => c.k === 3)?.winners ?? [];

async function sellar(): Promise<void> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 3, raffleId: 7n } as never;
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset().mockReturnValue(new Promise(() => undefined));
  h.juego.mockReset();
  h.remember.mockReset();
  h.fin = null;
  h.sesion = { address: "GAAA" };
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

const porGuardar = () =>
  expect.objectContaining({ organizer: "GAAA", id: "7", listHash: V.list_hash, round: V.quicknet.round, porGrabar: true, winners: ESPERADOS.map((i) => V.list[i]) });

describe("Mis sorteos anota lo que falta guardar apenas hay resultado", () => {
  it("durante el show, con la grabación en curso, la fila ya tiene los ganadores y falta guardarla", async () => {
    await sellar();
    const { draw } = await import("./draw");
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    // El show sigue (nadie llamó a su final) y la pestaña se podría cerrar acá.
    expect(h.fin).not.toBeNull();
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalledWith(porGuardar()));
  });

  it("con la billetera propia, aunque la aprobación se pida después del show", async () => {
    h.sesion = { address: "GAAA", aMano: true };
    await sellar();
    const { draw } = await import("./draw");
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    expect(h.drawOnChain).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalledWith(porGuardar()));
  });

  it("la demostración no anota nada", async () => {
    history.replaceState(null, "", "/?demo=race");
    const state = await import("../state");
    state.app.drawn = null;
    state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "", round: V.quicknet.round, numWinners: 3 } as never;
    const { draw } = await import("./draw");
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.remember).not.toHaveBeenCalled();
  });
});
