// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";
import { decodeFragment } from "../protocol/proof";

/**
 * El sorteo que arrancó desde la espera en grande termina en el resultado en grande (`pantalla.ts`), que tapa la
 * página. Ahí también se ve si el sorteo se está guardando, si quedó guardado o si no se pudo, con el botón para volver
 * a probar. Y al guardarse, el QR de la pantalla grande pasa al comprobante que lleva el sorteo grabado.
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
  qr: [] as { grande: boolean; link: string }[],
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
vi.mock("./qr", () => ({
  pintarQrDelComprobante: async (img: HTMLImageElement, link: string) => {
    h.qr.push({ grande: !!img.closest(".pantalla"), link });
    return true;
  },
}));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined, piezaParaLaSala: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
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
vi.mock("../enlace-corto", () => ({
  acortar: async () => null,
  alAcortar: () => undefined,
  cortoGuardado: () => null,
  enlaceParaElQr: async (l: string) => ({ ahora: l, despues: Promise.resolve(null) }),
  ponerLogoDeRuta: () => undefined,
  rutaDe: () => "",
}));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const TX = "cd".repeat(32);
const ESPERADOS = V.cases.find((c) => c.k === 1)?.winners ?? [];
const lineaGrande = (): HTMLElement | null => document.querySelector<HTMLElement>(".pantalla .pantalla-grab");
const qrsGrandes = (): string[] => h.qr.filter((q) => q.grande).map((q) => q.link);

/** Un sello confirmado, con la espera en grande abierta: el resultado va a salir en grande. */
async function sellarEnGrande(): Promise<typeof import("./draw")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 1, raffleId: 7n } as never;
  const espera = document.createElement("div");
  espera.className = "espera";
  document.body.appendChild(espera);
  const d = await import("./draw");
  document.getElementById("btn-draw")?.addEventListener("click", () => void d.draw());
  return d;
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.fin = null;
  h.qr = [];
  // El comprobante sin comprimir: jsdom no sabe leer un archivo como flujo, y sin esto el enlace cae al del número.
  vi.stubGlobal("CompressionStream", undefined);
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el guardado del sorteo en la pantalla grande", () => {
  it("dice que se está guardando y, al terminar, que quedó guardado", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    const { draw } = await sellarEnGrande();
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    h.fin?.();
    await vi.waitFor(() => expect(lineaGrande()?.textContent).toMatch(/Guardando el sorteo/));
    soltar({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await vi.waitFor(() => expect(lineaGrande()?.textContent).toMatch(/Sorteo guardado/));
  });

  it("si no se pudo, lo dice con el botón para volver a probar, y ese botón lo guarda", async () => {
    h.drawOnChain.mockRejectedValueOnce(new Error("la red no contestó")).mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    const { draw } = await sellarEnGrande();
    void draw();
    await vi.waitFor(() => expect(document.getElementById("grab-estado")?.dataset.grabacion).toBe("error"));
    h.fin?.();
    await vi.waitFor(() => expect(lineaGrande()?.textContent).toMatch(/la red no contestó/));
    const otraVez = lineaGrande()?.querySelector("button");
    expect(otraVez?.textContent).toBe("Guardar el sorteo");
    otraVez?.click();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lineaGrande()?.textContent).toMatch(/Sorteo guardado/));
  });

  it("si lo que sigue no es guardar (el sorteo ya estaba grabado), no ofrece botón: dice que se sigue desde la página", async () => {
    // Con el wifi inestable, la primera grabación entra y su respuesta se pierde: el reintento da AlreadyDrawn y leer lo
    // grabado tampoco contesta. La página ofrece ver el sorteo grabado, que la lleva a otra página.
    h.drawOnChain.mockRejectedValue(new Error("HostError: Error(Contract, #2)"));
    const { draw } = await sellarEnGrande();
    void draw();
    await vi.waitFor(() => expect(document.getElementById("btn-draw")?.textContent).toBe(T.es.drawConsultar));
    h.fin?.();
    await vi.waitFor(() => expect(lineaGrande()?.textContent).toContain(T.es["errAnchor.alreadyDrawn"]));
    // En la pantalla grande, Guardar el sorteo solo guarda: acá no hay nada que guardar, así que no hay botón que se
    // lleve el proyector al comprobante.
    expect(lineaGrande()?.querySelector("button")).toBeNull();
    expect(lineaGrande()?.textContent).toContain(T.es.grabSigueEnLaPagina);
    expect(document.querySelector(".pantalla")).not.toBeNull();
  });

  it("al guardarse, el QR de la pantalla grande pasa al comprobante con el sorteo grabado", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    const { draw } = await sellarEnGrande();
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    h.fin?.();
    await vi.waitFor(() => expect(qrsGrandes().length).toBeGreaterThan(0));
    const antes = qrsGrandes().at(-1) ?? "";
    expect(((await decodeFragment(new URL(antes).hash)) as { dtx?: string }).dtx).toBeUndefined();
    soltar({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await vi.waitFor(() => expect(qrsGrandes().at(-1)).not.toBe(antes));
    const despues = qrsGrandes().at(-1) ?? "";
    expect(((await decodeFragment(new URL(despues).hash)) as { dtx?: string }).dtx).toBe(TX);
  });
});
