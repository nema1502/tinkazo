// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La nota de arriba del cuadro después de un ganador ("Siguiente premio" y "No está") en un sorteo con equipos: en la
 * lista van las cuentas, y la nota tiene que decir el nombre del equipo, nunca las 56 letras de su cuenta.
 */

const h = vi.hoisted(() => ({ drawOnChain: vi.fn(), verError: vi.fn(), contar: vi.fn() }));

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
  sorteoReintentable: () => false,
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

const CUENTAS = ["GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR", "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U", "GDWUSKGGFDI4FRXK5EBTRECZSVQSSWJHHJOGH6JWG3AUMFFMQ435DIAG"];

async function prepararEstado(): Promise<void> {
  const { app } = await import("../state");
  const { ponerEtiquetas } = await import("../equipos/etiquetas");
  ponerEtiquetas(new Map([[CUENTAS[0] as string, "Los Cóndores"], [CUENTAS[1] as string, "Pumas"], [CUENTAS[2] as string, "Halcones"]]));
  app.drawn = { winners: [0], randomness: "ab".repeat(32) } as never;
  app.frozen = { names: [...CUENTAS], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
}

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = [
    "again-note", "btn-recuperar", "btn-draw", "draw-status", "reverify-out", "again-row", "winner-box", "lore-box", "leyenda-box", "qr-box", "sec-draw",
    "winner-cards", "sec-participants", "btn-freeze",
  ].map((id) => `<div id="${id}"></div>`).join("") + `<textarea id="ta"></textarea><input id="nw" type="number" value="1">`;
  for (const el of document.querySelectorAll<HTMLElement>("div")) el.scrollIntoView = () => undefined;
  (document.getElementById("btn-draw") as HTMLElement).outerHTML = "<button id=\"btn-draw\"></button>";
});

describe("la nota después de un ganador, con equipos", () => {
  it("«Siguiente premio» nombra al equipo que ya ganó, no su cuenta", async () => {
    await prepararEstado();
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    const nota = document.getElementById("again-note")?.textContent ?? "";
    expect(nota).toContain("Los Cóndores");
    expect(nota).not.toContain(CUENTAS[0] as string);
  });

  it("«No está» nombra al equipo ausente, no su cuenta", async () => {
    await prepararEstado();
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    const nota = document.getElementById("again-note")?.textContent ?? "";
    expect(nota).toContain("Los Cóndores");
    expect(nota).not.toContain(CUENTAS[0] as string);
  });
});
