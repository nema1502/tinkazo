// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";

/**
 * El sorteo cuando Pollar pide proteger la cuenta (`SDK_WALLET_RECOVERY_REQUIRED`, `draw.ts`). Antes la ventana solo se
 * abría desde el sello y, en el sorteo, el mensaje mandaba a un botón de sellar que ya no está. Ahora:
 *
 * - se abre "Protegé tu cuenta" y, si la persona la protege, se sortea de nuevo UNA vez;
 * - si no la protege, queda el botón para volver a intentar y el mensaje, sin contarlo dos veces;
 * - si vuelve a pedirla después de protegida, no hay bucle.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sortear: vi.fn(),
  pide: vi.fn(),
  proteger: vi.fn(),
  contar: vi.fn(),
}));

const recuperacion = () => new Error("SDK_WALLET_RECOVERY_REQUIRED");

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
  SORTEO_REINTENTABLE: new Set<string>(),
  avisoDelReintento: () => "drawTry",
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: (...a: unknown[]) => h.pide(...a), protegerLaCuenta: () => h.proteger() }));
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
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><select id="nw"><option value="1">1</option></select>`;
  h.pide.mockImplementation(async (e: unknown) => e instanceof Error && /RECOVERY_REQUIRED/.test(e.message));
});

const cuentas = (evento: string): number => h.contar.mock.calls.filter(([e]) => e === evento).length;

describe("sortear cuando la cuenta pide protección", () => {
  it("protegida: se sortea de nuevo una vez, y si vuelve a pedirla no hay bucle", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: recuperacion() });
    h.proteger.mockResolvedValue(true);
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.proteger).toHaveBeenCalledTimes(1);
    expect(h.sortear).toHaveBeenCalledTimes(2);
    expect(h.orden.filter((x) => x === "escribirError")).toHaveLength(1);
    // Un solo fallo contado: el del final, no el que abrió la ventana.
    expect(cuentas("draw_failed")).toBe(1);
    expect(document.getElementById("btn-draw")?.textContent).toBe(t("drawRetry"));
  });

  it("no protegida: queda el botón para volver a intentar, el mensaje, y un solo fallo contado", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: recuperacion() });
    h.proteger.mockResolvedValue(false);
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);
    expect(h.orden).toContain("escribirError");
    expect(cuentas("draw_failed")).toBe(1);
    expect((document.getElementById("btn-draw") as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById("btn-draw")?.textContent).toBe(t("drawRetry"));
  });

  it("otro error no abre la ventana", async () => {
    h.sortear.mockResolvedValue({ ok: false, error: new Error("boom") });
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.proteger).not.toHaveBeenCalled();
    expect(cuentas("draw_failed")).toBe(1);
  });
});

describe("el texto cuando la cuenta pide protección", () => {
  it("no manda a un botón de sellar, en los dos idiomas", async () => {
    const { T } = await import("../i18n");
    expect(T.es["errAnchor.recoveryRequired"]).not.toMatch(/sellar/i);
    expect(T.en["errAnchor.recoveryRequired"]).not.toMatch(/seal/i);
  });
});
