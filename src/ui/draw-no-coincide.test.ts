// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Si lo que grabó el contrato no coincide con el resultado de la pantalla (`draw.ts`, `alNoCoincidir`), es un error
 * grave y es el único lugar que lo atrapa. El aviso va en el sorteo que corresponde: si la pantalla ya pasó al premio
 * siguiente, no se escribe en el nuevo y queda anotado en Mis sorteos. Si sigue en pantalla, ese resultado no se
 * comparte ni se muestra su QR hasta revisarlo, llegue el aviso antes o después del resultado.
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
  remember: vi.fn(),
  abrir: vi.fn(),
  grande: vi.fn(),
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
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: (...a: unknown[]) => h.abrir(...a) }));
vi.mock("./pantalla", () => ({ mostrarResultado: async (...a: unknown[]) => h.grande(...a) }));
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
const TX = "cd".repeat(32);
const OTROS = [4, 3, 11];
const grab = (): HTMLElement => document.getElementById("grab-estado") as HTMLElement;
const qr = (): HTMLElement => document.getElementById("qr-box") as HTMLElement;
const wa = (): HTMLAnchorElement => document.getElementById("btn-whatsapp") as HTMLAnchorElement;

async function sellar(raffleId: bigint): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 3, raffleId } as never;
  return state;
}

let consola: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.remember.mockReset();
  h.abrir.mockReset();
  h.grande.mockReset();
  h.fin = null;
  consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

afterEach(() => {
  consola.mockRestore();
});

describe("lo grabado no coincide con lo que se vio", () => {
  it("con la pantalla ya en el premio siguiente, no se escribe en el sorteo nuevo y queda anotado en Mis sorteos", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    await sellar(7n);
    const { draw } = await import("./draw");
    const sorteo = draw();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    h.fin?.();
    // Siguiente premio, como lo deja `newDraw`: otro sello y la línea de la grabación vacía.
    await sellar(8n);
    grab().style.display = "none";
    grab().textContent = "";
    delete grab().dataset.grabacion;
    soltar({ winners: OTROS, randomness: V.quicknet.randomness, txHash: TX });
    await sorteo;
    await new Promise((r) => setTimeout(r, 20));
    expect(grab().dataset.grabacion).toBeUndefined();
    expect(grab().textContent).toBe("");
    expect(consola).toHaveBeenCalled();
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ id: "7", noCoincide: true, porGrabar: false })));
  });

  it("con el aviso antes del resultado, el resultado sale sin QR ni forma de compartirlo, y Mis sorteos lo anota", async () => {
    h.drawOnChain.mockResolvedValue({ winners: OTROS, randomness: V.quicknet.randomness, txHash: TX });
    await sellar(7n);
    const { draw, shareProof, mostrarGrande } = await import("./draw");
    void draw();
    await vi.waitFor(() => expect(grab().dataset.grabacion).toBe("no-coincide"));
    h.fin?.();
    // El resultado ya anotó su comprobante en Mis sorteos.
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ proof: expect.any(String) })));
    await new Promise((r) => setTimeout(r, 20));
    expect(grab().dataset.grabacion).toBe("no-coincide");
    expect(qr().style.display).toBe("none");
    expect(wa().getAttribute("href") ?? "").not.toMatch(/wa\.me/);
    shareProof();
    mostrarGrande();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.abrir).not.toHaveBeenCalled();
    expect(h.grande).not.toHaveBeenCalled();
    expect(h.remember).toHaveBeenLastCalledWith(expect.objectContaining({ id: "7", noCoincide: true, porGrabar: false }));
  });

  it("con el aviso después del resultado, se apaga lo que ya estaba a la vista para compartir", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    await sellar(7n);
    const { draw, shareProof } = await import("./draw");
    const sorteo = draw();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    h.fin?.();
    await vi.waitFor(() => expect(qr().style.display).toBe("block"));
    expect(wa().getAttribute("href") ?? "").toMatch(/wa\.me/);
    soltar({ winners: OTROS, randomness: V.quicknet.randomness, txHash: TX });
    await sorteo;
    expect(grab().dataset.grabacion).toBe("no-coincide");
    expect(qr().style.display).toBe("none");
    expect(wa().getAttribute("href") ?? "").not.toMatch(/wa\.me/);
    shareProof();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.abrir).not.toHaveBeenCalled();
  });
});
