// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un sorteo que nació sin cuenta (plan B del ingreso) no se anota en Mis sorteos, aunque la persona haya entrado con una
 * cuenta mientras esperaba la ronda: nunca fue suyo, nadie lo selló a su nombre. Un sorteo de quien ya tenía cuenta sí se
 * anota. Se prueba con `reveal` de `draw.ts` de verdad, que arma el comprobante y escribe el historial.
 */

const h = vi.hoisted(() => ({ remember: vi.fn(), sesion: null as null | { address: string } }));

vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
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
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: async () => ({ ok: false, error: new Error("no debe llamarse") }),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../stellar/grifo", () => ({ grifoDisponible: () => true }));
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: () => undefined,
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const NOMBRES = ["Ana", "Beto", "Carla"];
const FARO = { round: 1, randomness: "00", signature: "00" };

/** Arma la página, deja `frozen` como lo dejó el sello y revela el resultado. Espera a que el comprobante termine de armarse. */
async function revelar(sellado: Record<string, unknown>): Promise<void> {
  vi.resetModules();
  h.remember.mockReset();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<textarea id="ta"></textarea><input id="nw" type="number" value="1"><button id="btn-draw"></button><button id="btn-freeze"></button>' +
    '<div id="again-note"></div><div id="draw-status"></div><div id="reverify-out"></div><div id="again-row"></div>' +
    '<div id="winner-box"></div><div id="lore-box"></div><div id="leyenda-box"></div><div id="qr-box"></div>' +
    '<div id="sec-draw"></div><div id="winner-cards"></div><div id="sec-participants"></div><details id="mas-resultado"></details>' +
    '<button id="btn-recuperar"></button><div id="motion-note"></div><p id="proof"></p><a id="drand-link"></a>' +
    '<div id="again-acciones"><button id="btn-again-sin"></button><button id="btn-proof"></button></div>' +
    '<button id="btn-again-nueva"></button><h3 id="again-t"></h3><p id="again-left"></p><p id="again-sigue"></p>' +
    '<a id="btn-whatsapp"></a><a id="btn-email"></a><div id="sin-sello-nota"></div><img id="qr-img"><div id="sec-history"></div>';
  const { app } = await import("../state");
  app.drawn = { winners: [0], beacon: FARO };
  app.frozen = { names: NOMBRES, listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, ...sellado } as never;
  const { reveal } = await import("./draw");
  reveal(NOMBRES, [0], FARO, "00".repeat(32));
  // Los avisos al ganador se arman al final del comprobante: cuando están, el historial ya tuvo su turno.
  await vi.waitFor(() => expect(decodeURIComponent(document.querySelector<HTMLAnchorElement>("#btn-whatsapp")?.href ?? "")).toContain("Ana"), { timeout: 5000 });
  await new Promise((listo) => setTimeout(listo, 60));
}

beforeEach(() => {
  h.sesion = null;
});

describe("Mis sorteos y los sorteos que nacieron sin cuenta", () => {
  it("un sorteo de quien tenía cuenta se anota, a nombre de su cuenta (el control de las demás pruebas)", async () => {
    h.sesion = { address: "GAAA" };
    await revelar({});
    expect(h.remember).toHaveBeenCalledOnce();
    expect(h.remember.mock.calls[0]?.[0]).toMatchObject({ organizer: "GAAA", count: 3 });
  });

  it("uno que nació sin cuenta no se anota, aunque la persona haya entrado con una mientras esperaba la ronda", async () => {
    h.sesion = { address: "GAAA" };
    await revelar({ sinCuenta: true });
    expect(h.remember).not.toHaveBeenCalled();
  });

  it("uno que nació sin cuenta y sigue sin cuenta tampoco", async () => {
    h.sesion = null;
    await revelar({ sinCuenta: true });
    expect(h.remember).not.toHaveBeenCalled();
  });
});
