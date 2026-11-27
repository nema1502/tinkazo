// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * «Siguiente premio» y «No está» con una lista de líneas de persona: la nota de arriba del cuadro dice el lugar que tenía en la
 * lista sellada cada persona que salió, y nunca «Sin nombre». El cuadro ya no tiene a quienes ganaron cuando la nota se arma,
 * así que sus lugares se dicen con la lista sellada. Una lista de nombres comunes dice lo mismo que antes.
 */

const h = vi.hoisted(() => ({
  unfreeze: vi.fn((texto: string) => {
    // Como el de verdad: el cuadro pasa a ser la lista nueva, sin quienes ya ganaron.
    const ta = document.getElementById("ta");
    if (ta instanceof HTMLTextAreaElement) ta.value = texto;
  }),
  abrirSorteo: vi.fn(),
  ponerPremio: vi.fn(),
  // El armado de varios lugares, a la vista: qué premios se le pasan y en qué orden.
  armarMeta: vi.fn((lugares: readonly string[]) => lugares.join(" | ")),
  actualizarLugares: vi.fn(),
}));

vi.mock("./compartir", () => ({ abrirSorteo: (...a: unknown[]) => h.abrirSorteo(...a) }));
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
vi.mock("../contar", () => ({ contar: () => false, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: (...a: unknown[]) => h.unfreeze(...a),
}));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({
  marcarSalio: () => undefined,
  olvidarSalieron: () => undefined,
  ponerPremio: (v: string) => h.ponerPremio(v),
  armarMeta: (l: readonly string[]) => h.armarMeta(l),
  actualizarLugares: () => h.actualizarLugares(),
}));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

const LINEAS = [1, 2, 3, 4, 5, 6].map((n) => lineaDePrueba(n));

async function preparar(names: string[], winners: number[]): Promise<void> {
  const { app } = await import("../state");
  app.drawn = { winners, beacon: { round: 1, randomness: "00", signature: "00" } };
  app.frozen = { names, listHash: "00".repeat(32), ts: 1, at: "", prize: "Auriculares", round: 1, raffleId: 1n } as never;
  (document.getElementById("ta") as HTMLTextAreaElement).value = names.join("\n");
}

const nota = (): string => document.getElementById("again-note")?.textContent ?? "";

beforeEach(() => {
  vi.resetModules();
  h.unfreeze.mockClear();
  h.abrirSorteo.mockReset();
  h.ponerPremio.mockReset();
  h.armarMeta.mockClear();
  h.actualizarLugares.mockClear();
  history.replaceState(null, "", "/");
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<textarea id="ta"></textarea><input id="nw" type="number" value="1"><button id="btn-draw"></button><button id="btn-freeze"></button>' +
    '<div id="again-note"></div><div id="draw-status"></div><div id="reverify-out"></div><div id="again-row"></div>' +
    '<div id="winner-box"></div><div id="lore-box"></div><div id="leyenda-box"></div><div id="qr-box"></div>' +
    '<div id="sec-draw"></div><div id="winner-cards"></div><div id="sec-participants"></div><details id="mas-resultado"></details>' +
    '<div id="sec-history"></div>' +
    '<button id="btn-recuperar"></button>';
});

describe("la nota de Siguiente premio con una lista de líneas de persona", () => {
  it("con una ganadora dice su lugar en la lista sellada", async () => {
    await preparar(LINEAS, [1]);
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    expect(nota()).toBe("Lugar 2 ya ganó y no está en esta lista. Quedan 5.");
  });

  it("con dos y con tres ganadoras dice los lugares de cada una", async () => {
    await preparar(LINEAS, [4, 0]);
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    expect(nota()).toBe("Lugar 5 y Lugar 1 ya ganaron y no están en esta lista. Quedan 4.");
    vi.resetModules();
    await preparar(LINEAS, [2, 3, 5]);
    const otra = await import("./draw");
    otra.newDraw("sinGanadores");
    expect(nota()).toBe("Lugar 3, Lugar 4 y Lugar 6 ya ganaron y no están en esta lista. Quedan 3.");
  });

  it("nunca dice Sin nombre ni muestra una línea", async () => {
    await preparar(LINEAS, [1, 2, 3]);
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    expect(nota()).not.toContain("Sin nombre");
    expect(nota()).not.toContain("p1:");
  });

  it("No está dice el lugar de quien no estaba", async () => {
    await preparar(LINEAS, [2]);
    const { newDraw } = await import("./draw");
    newDraw("ausente", 0);
    expect(nota()).toContain("Lugar 3 no está");
    expect(nota()).not.toContain("Sin nombre");
    expect(nota()).not.toContain("p1:");
  });

  it("una lista de nombres comunes dice los nombres, como siempre", async () => {
    await preparar(["Ana", "Beto", "Carla", "Dora"], [1]);
    const { newDraw } = await import("./draw");
    newDraw("sinGanadores");
    expect(nota()).toBe("Beto ya ganó y no está en esta lista. Quedan 3.");
  });
});
