// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorPortero } from "../stellar/patrocinador";

/**
 * El sorteo cuando el servicio que cubre la comisión no puede (no contesta, sin fondo, sin cupo la cuenta) y la lista ya
 * está sellada: la primera acción sigue siendo reintentar y, si la cuenta tiene con qué pagar la suya (en testnet, con
 * el grifo), la segunda es "Sortear pagando con mi cuenta", que sortea de nuevo con `pagarConMiCuenta`.
 */

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  verError: vi.fn(),
  contar: vi.fn(),
}));

vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async (o: { intentar: () => Promise<unknown> }) => {
    try {
      return { ok: true, valor: await o.intentar() };
    } catch (error) {
      return { ok: false, error };
    }
  },
  SORTEO_REINTENTABLE: new Set<string>(),
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => true }));
vi.mock("../stellar/errores", async (orig) => ({ ...(await orig<typeof import("../stellar/errores")>()), errorKey: () => "porteroFondo" }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: (...a: unknown[]) => h.verError(...a) }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
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
  h.drawOnChain.mockReset();
  h.verError.mockReset();
  h.contar.mockReset();
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><select id="nw"><option value="1">1</option></select>`;
});

describe("sortear con el servicio que paga caído", () => {
  it("ofrece la segunda salida, y al apretarla sortea de nuevo pagando con la propia cuenta, una sola vez", async () => {
    h.drawOnChain.mockRejectedValueOnce(new ErrorPortero("cerrado", 0, { detalle: "sin-respuesta" })).mockResolvedValue({ winners: [0], randomness: "00" });
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    // El primer intento va como siempre (con el patrocinio), y la segunda salida está en el mensaje.
    expect(h.drawOnChain.mock.calls[0]?.[3]).toEqual({ pagarConMiCuenta: false });
    const boton = document.getElementById("draw-propio") as HTMLButtonElement | null;
    expect(boton).not.toBeNull();
    expect(document.getElementById("draw-status")?.contains(boton)).toBe(true);
    const segunda = h.verError.mock.calls[0]?.[2] as { texto: string } | undefined;
    expect(segunda?.texto).toBeTruthy();
    // La primera sigue siendo el botón de reintentar de siempre.
    expect(document.getElementById("btn-draw")?.dataset.i).not.toBe("sortearPropio");
    boton?.click();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(2));
    expect(h.drawOnChain.mock.calls[1]?.[3]).toEqual({ pagarConMiCuenta: true });
  });

  it("reintentar con el botón de siempre vuelve al patrocinio: lo elegido no se hereda", async () => {
    h.drawOnChain.mockRejectedValue(new ErrorPortero("cerrado", 0, { detalle: "sin-respuesta" }));
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    (document.getElementById("draw-propio") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    await draw();
    expect(h.drawOnChain.mock.calls[2]?.[3]).toEqual({ pagarConMiCuenta: false });
  });

  it("un error que no es del servicio que paga no ofrece nada", async () => {
    h.drawOnChain.mockRejectedValue(new Error("boom"));
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(document.getElementById("draw-propio")).toBeNull();
    expect(h.verError.mock.calls[0]?.[2]).toBeUndefined();
  });
});
