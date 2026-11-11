// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La compuerta del sorteo en modo Oficial (`draw.ts`, «Dejá tu cuenta lista»). Mira solo la memoria, sin red: el sorteo
 * se lanza solo desde la espera. Si la memoria dice que falta activar la cuenta, el paso se abre antes de sortear, y si
 * la persona sale, no se sortea. Si no dice nada, se sortea como siempre. En Prueba la compuerta ni se baja.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sortear: vi.fn(),
  pide: vi.fn(),
  proteger: vi.fn(),
  contar: vi.fn(),
  red: "mainnet" as "mainnet" | "testnet",
  falta: false,
  gate: vi.fn(),
  cargoFlujo: false,
}));

const recuperacion = () => new Error("SDK_WALLET_RECOVERY_REQUIRED");

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: h.red };
    },
  };
});
vi.mock("./cuenta-lista-flujo", () => {
  h.cargoFlujo = true;
  return { faltaEnLaMemoria: () => h.falta, cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a) };
});
vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: async () => undefined,
  escribirError: async (status: HTMLElement, e: unknown) => {
    h.orden.push("escribirError");
    status.textContent = (e as Error).message;
  },
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: (id: string, paso: string) => {
    const host = document.getElementById(id);
    if (host) host.textContent = paso;
  },
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: (...a: unknown[]) => h.sortear(...a),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: (...a: unknown[]) => h.pide(...a), protegerLaCuenta: (...a: unknown[]) => h.proteger(...a) }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, rutaDe: () => "" }));

async function prepararEstado(): Promise<void> {
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: ["Ana", "Beto"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.sortear.mockReset();
  h.pide.mockReset();
  h.proteger.mockReset();
  h.contar.mockReset();
  h.red = "mainnet";
  h.falta = false;
  h.cargoFlujo = false;
  h.gate.mockReset();
  h.sortear.mockResolvedValue({ ok: false, error: new Error("boom") });
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><input id="nw" type="number" value="1">`;
  h.pide.mockImplementation(async (e: unknown) => e instanceof Error && /RECOVERY_REQUIRED/.test(e.message));
});


describe("la compuerta del sorteo en modo Oficial", () => {
  it("si la memoria no dice que falte algo, se sortea sin abrir nada", async () => {
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });

  it("si falta activar la cuenta, el paso antes de sortear; si la persona sale, no se sortea", async () => {
    h.falta = true;
    h.gate.mockResolvedValue(false);
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.gate).toHaveBeenCalledTimes(1);
    expect(h.gate.mock.calls[0]?.[0]).toBe("sorteo");
    expect(h.sortear).not.toHaveBeenCalled();
  });

  it("si la deja lista, se sortea", async () => {
    h.falta = true;
    h.gate.mockResolvedValue(true);
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });

  it("en Prueba la compuerta ni se baja", async () => {
    h.red = "testnet";
    h.falta = true;
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.cargoFlujo).toBe(false);
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });

  it("si el flujo del paso no se pudo bajar, el sorteo sellado sigue: no queda muerto hasta recargar", async () => {
    vi.doMock("./cuenta-lista-flujo", () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    h.falta = true;
    await prepararEstado();
    const { draw } = await import("./draw");
    try {
      await draw();
    } finally {
      vi.doMock("./cuenta-lista-flujo", () => {
        h.cargoFlujo = true;
        return { faltaEnLaMemoria: () => h.falta, cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a) };
      });
    }
    expect(h.gate).not.toHaveBeenCalled();
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });
});
