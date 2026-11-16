// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El sorteo se graba aparte del show (`draw.ts`), y la grabación puede tardar más de un minuto con la red lenta. Mientras
 * tanto quien organiza ya pasó al premio siguiente: ese sorteo arranca, lanzado desde la espera en grande o con el
 * botón, y no lo frena la grabación del anterior. Y la grabación de un mismo sorteo va una sola vez a la vez.
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
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => true }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
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

/** Un sello confirmado con la lista y la ronda de los vectores. */
async function sellar(raffleId: bigint): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 1, raffleId } as never;
  return state;
}

/** El primer sorteo: jugado, con el show terminado y la grabación sin terminar. */
async function primerSorteoGrabandose(): Promise<typeof import("./draw")> {
  h.drawOnChain.mockReturnValue(new Promise(() => undefined));
  await sellar(7n);
  const d = await import("./draw");
  void d.draw();
  await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
  h.fin?.();
  return d;
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.fin = null;
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("el premio siguiente no espera la grabación del anterior", () => {
  it("lanzado por adelantado desde la espera en grande, arranca", async () => {
    const { draw } = await primerSorteoGrabandose();
    // Siguiente premio: otro sello. La grabación del anterior sigue.
    await sellar(8n);
    void draw({ adelantado: true });
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(2));
  });

  it("con un toque en Lanzar el sorteo, arranca", async () => {
    const { draw } = await primerSorteoGrabandose();
    await sellar(8n);
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(2));
  });
});

describe("la grabación de un mismo sorteo va de a una", () => {
  it("un toque mientras se graba no lanza otra grabación del mismo sorteo", async () => {
    const { draw } = await primerSorteoGrabandose();
    void draw();
    void draw({ adelantado: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.juego).toHaveBeenCalledTimes(1);
  });
});
