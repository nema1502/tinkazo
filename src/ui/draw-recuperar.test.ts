// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recuperar la lista anterior después de Usar otra lista (`draw.ts`). Traía la lista sellada entera, con quienes ya
 * ganaron y sin nota: un toque equivocado frente a la sala y quien ganó podía volver a ganar. Ahora trae la lista sin
 * las personas que ya salieron, la misma que habría dejado Siguiente premio.
 */

const h = vi.hoisted(() => ({ setList: vi.fn() }));

vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: async () => ({ winners: [0], randomness: "00" }),
  escribirError: async () => undefined,
  existenciaDelSorteo: async () => null,
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({ sortearConReintentos: async () => ({ ok: false }), sorteoReintentable: () => false, avisoDelReintento: () => "drawTry" }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", async () => {
  const { app } = await import("../state");
  return {
    alElegirDespuesDelResultado: () => undefined,
    irAlSelectorParaOtro: () => undefined,
    juegoParaVerDeNuevo: () => undefined,
    marcarShow: () => undefined,
    pintarNotaDelJuego: () => undefined,
    rotarJuego: () => undefined,
    secondsToRound: () => 0,
    // Como el de verdad: el sorteo deja de estar sellado.
    unfreeze: () => {
      app.frozen = null;
    },
  };
});
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: (...a: unknown[]) => h.setList(...a), listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const LISTA = ["Ana", "Beto", "Nora", "Mesa 4", "Mesa 5"];

beforeEach(async () => {
  vi.resetModules();
  h.setList.mockReset();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<textarea id="ta"></textarea><input id="nw" type="number" value="1"><button id="btn-draw"></button><button id="btn-freeze"></button>' +
    '<div id="again-note"></div><div id="draw-status"></div><div id="reverify-out"></div><div id="again-row"></div>' +
    '<div id="winner-box"></div><div id="lore-box"></div><div id="leyenda-box"></div><div id="qr-box"></div>' +
    '<div id="sec-draw"></div><div id="winner-cards"></div><div id="sec-participants"></div><details id="mas-resultado"></details>' +
    '<div id="sec-history"></div><button id="btn-recuperar"></button>';
  const { app } = await import("../state");
  // Salieron Beto y Mesa 5.
  app.drawn = { winners: [1, 4], beacon: { round: 1, randomness: "00", signature: "00" } };
  app.frozen = { names: LISTA, listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
});

describe("Recuperar la lista anterior", () => {
  it("después de Usar otra lista, trae la lista sin quienes ya ganaron", async () => {
    const { newDraw, recuperarLista } = await import("./draw");
    newDraw("otraLista");
    recuperarLista();
    expect(h.setList).toHaveBeenCalledTimes(1);
    const traida = String(h.setList.mock.calls[0]?.[0]).split("\n");
    expect(traida).toEqual(["Ana", "Nora", "Mesa 4"]);
    expect(traida).not.toContain("Beto");
    expect(traida).not.toContain("Mesa 5");
  });
});
