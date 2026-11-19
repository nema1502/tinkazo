// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La compuerta del sorteo con el cobro por uso del modo Oficial (`draw.ts`): antes de pedir la firma del sorteo, el
 * portero tiene que decir que la cuenta tiene acceso. Sin acceso, el paso de la cuenta; sin respuesta, no se firma y se
 * dice, con el botón para volver a probar. Sortear lo sellado no pide sorteos oficiales. Con Freighter o con la bandera
 * apagada, como hoy y sin preguntarle nada al portero.
 */

const URL = "https://pm.ejemplo";

const h = vi.hoisted(() => ({
  sortear: vi.fn(),
  paso: vi.fn(),
  billetera: { submitsItself: true, address: "GAAA" } as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, network: { ...o.network, name: "mainnet" } };
});
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera }));
vi.mock("./cuenta-lista-flujo", () => ({ faltaEnLaMemoria: () => false, cuentaListaParaGrabar: async () => true, abrirParaElError: (...a: unknown[]) => h.paso(...a) }));
vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: async () => undefined,
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  limpiarDetalle: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({
  sortearConReintentos: (...a: unknown[]) => h.sortear(...a),
  sorteoReintentable: () => false,
  avisoDelReintento: () => "drawTry",
}));
vi.mock("./red", () => ({ mostrarSinPatrocinio: async () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: () => false, puedeCambiarDeModo: () => true }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async () => ({ signature: "01".repeat(48) }),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
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

const cupo = (oficial: unknown) => ({ prendido: true, rige: "portero", red: "mainnet", sellos: { usados: 1, max: 100, quedan: 0 }, sorteos: { usados: 1, max: 100, quedan: 99 }, liberaEn: Date.UTC(2026, 11, 1), ...(oficial === undefined ? {} : { oficial }) });

function portero(...respuestas: Array<unknown | "caido">) {
  let i = 0;
  const f = vi.fn(async () => {
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r === "caido") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

async function prepararEstado(): Promise<void> {
  const { app } = await import("../state");
  app.drawn = null;
  app.frozen = { names: ["Ana", "Beto"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 1, raffleId: 1n } as never;
}

const estado = (): string => document.getElementById("draw-status")?.textContent ?? "";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_ALTA", "1");
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", URL);
  h.sortear.mockReset();
  h.sortear.mockResolvedValue({ ok: false, error: new Error("boom") });
  h.paso.mockReset();
  h.paso.mockResolvedValue(false);
  h.billetera = { submitsItself: true, address: "GAAA" };
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><input id="nw" type="number" value="1">`;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("la compuerta del sorteo con el cobro por uso", () => {
  it("sin acceso se abre el paso de la cuenta; si sale, no se pide la firma y se dice por qué", async () => {
    portero(cupo({ acceso: false }));
    await prepararEstado();
    const { draw } = await import("./draw");
    const { t } = await import("../i18n");
    await draw();
    expect(h.paso).toHaveBeenCalledWith("sorteo", expect.anything());
    expect(h.sortear).not.toHaveBeenCalled();
    expect(estado()).toBe(t("errAnchor.porteroSinAlta"));
    const btn = document.getElementById("btn-draw") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe(t("drawRetry"));
  });

  it("si vuelve del paso con acceso, se sortea", async () => {
    h.paso.mockResolvedValue(true);
    portero(cupo({ acceso: false }), cupo({ acceso: true, sorteos: { quedan: 0, proximoVence: null } }));
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });

  it("sin respuesta del portero no se pide la firma: el ganador va a ser el mismo cuando se pueda", async () => {
    portero("caido");
    await prepararEstado();
    const { draw } = await import("./draw");
    const { t } = await import("../i18n");
    await draw();
    expect(h.sortear).not.toHaveBeenCalled();
    expect(h.paso).not.toHaveBeenCalled();
    expect(estado()).toBe(t("errAnchor.porteroFondoSorteo"));
  });

  it("con acceso y sin sorteos oficiales, se sortea: lo sellado no los gasta", async () => {
    portero(cupo({ acceso: true, sorteos: { quedan: 0, proximoVence: null } }));
    await prepararEstado();
    const { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });

  it("con Freighter, o con la bandera apagada, se sortea sin preguntarle nada al portero", async () => {
    const f = portero(cupo({ acceso: false }));
    h.billetera = { kind: "external", address: "GAAA" };
    await prepararEstado();
    let { draw } = await import("./draw");
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(1);

    vi.resetModules();
    vi.stubEnv("VITE_ALTA", "");
    h.billetera = { submitsItself: true, address: "GAAA" };
    await prepararEstado();
    ({ draw } = await import("./draw"));
    await draw();
    expect(h.sortear).toHaveBeenCalledTimes(2);
    expect(f).not.toHaveBeenCalled();
  });

  it("un doble toque mientras se revisa la cuenta no lanza dos sorteos, y el botón queda apagado mientras tanto", async () => {
    // El portero tarda (la wifi del evento): la respuesta llega cuando la prueba la suelta.
    let soltar: () => void = () => undefined;
    const lenta = new Promise<void>((r) => (soltar = r));
    const respuesta = cupo({ acceso: true, sorteos: { quedan: 3, proximoVence: null } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await lenta;
        return new Response(JSON.stringify(respuesta), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    h.sortear.mockImplementation(async () => {
      const { app } = await import("../state");
      // Mientras se sortea de verdad, el primero sigue en vuelo: el segundo toque no puede pasar por al lado.
      await new Promise((r) => setTimeout(r, 20));
      return { ok: false, error: new Error("boom"), app };
    });
    await prepararEstado();
    const { draw } = await import("./draw");
    const btn = document.getElementById("btn-draw") as HTMLButtonElement;
    const primero = draw();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.disabled).toBe(true);
    const segundo = draw();
    soltar();
    await Promise.all([primero, segundo]);
    expect(h.sortear).toHaveBeenCalledTimes(1);
  });
});
