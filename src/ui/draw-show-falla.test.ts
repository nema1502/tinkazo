// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Con la billetera propia la grabación se pide al terminar el show (`draw.ts`). Si el show falla después de fijar el
 * resultado, el sorteo igual se graba: el resultado se ve sin show, la billetera pide la aprobación y, si no se pudo,
 * el botón la vuelve a probar sin otro show. Antes quedaba sin grabar y el botón no hacía nada.
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
  sonido: vi.fn(),
  remember: vi.fn(),
  sesion: { address: "GAAA", aMano: true } as { address: string; aMano?: boolean },
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
  playPixi: async (_g: unknown, _n: unknown, winners: number[]) => {
    h.juego([...winners]);
    return true;
  },
}));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: (...a: unknown[]) => h.sonido(...a) }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const TX = "cd".repeat(32);
const ESPERADOS = V.cases.find((c) => c.k === 3)?.winners ?? [];
const grab = (): HTMLElement => document.getElementById("grab-estado") as HTMLElement;
const boton = (): HTMLButtonElement => document.getElementById("btn-draw") as HTMLButtonElement;

async function sellar(): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 3, raffleId: 7n } as never;
  return state;
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.remember.mockReset();
  h.sesion = { address: "GAAA", aMano: true };
  // El show se cae justo después de fijar el resultado: el sonido del juego no se pudo preparar.
  h.sonido.mockReset().mockImplementation(() => {
    throw new Error("el sonido del juego no se pudo preparar");
  });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

describe("con la billetera propia, el show falla después de fijar el resultado", () => {
  it("el sorteo se graba igual y el resultado se ve, sin show", async () => {
    h.drawOnChain.mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    const { app } = await sellar();
    const { draw } = await import("./draw");
    await draw();
    expect(h.juego).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(grab().dataset.grabacion).toBe("guardado"));
    expect(app.drawn?.drawTx).toBe(TX);
    expect(document.getElementById("winner-box")?.style.display).toBe("block");
  });

  it("si además la grabación falla, el botón la vuelve a probar sin otro show", async () => {
    h.drawOnChain.mockRejectedValueOnce(new Error("la billetera no lo aprobó")).mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    const { app } = await sellar();
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(grab().dataset.grabacion).toBe("error"));
    expect(boton().disabled).toBe(false);
    expect(boton().textContent).toBe("Guardar el sorteo");
    await draw();
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
    expect(grab().dataset.grabacion).toBe("guardado");
    expect(app.drawn?.winners).toEqual(ESPERADOS);
    expect(h.juego).not.toHaveBeenCalled();
  });

  it("con la grabación de ese sorteo todavía en curso, el sorteo del premio siguiente arranca", async () => {
    h.drawOnChain.mockReturnValue(new Promise(() => undefined));
    const state = await sellar();
    const { draw } = await import("./draw");
    void draw();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    // Siguiente premio: otro sello, y esta vez el show sale bien.
    h.sonido.mockReset().mockReturnValue("");
    state.app.drawn = null;
    state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 2, at: "", prize: "Una gorra", round: V.quicknet.round, numWinners: 1, raffleId: 8n } as never;
    void draw({ adelantado: true });
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
  });
});
