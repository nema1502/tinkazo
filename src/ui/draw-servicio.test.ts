// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * Con el sorteo por el servicio prendido, quien organiza con su cuenta de Google no ve ningún paso de aprobar: la línea
 * de la grabación pasa de "Guardando el sorteo" a "Sorteo guardado" con el enlace, el botón dice que ya se sorteó y se
 * cuenta el sorteo confirmado. Y una cuenta que ya puede guardar premios ve lo mismo: la puerta del premio protege
 * firmas, y acá no hay ninguna.
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
  contar: vi.fn(),
  servicio: vi.fn(),
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
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), contarPractica: () => undefined, errorContable: (c: string) => c, refDe: () => ({}) }));
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

vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => true }));
vi.mock("./sorteo-del-servicio", () => ({
  loTomaElServicio: () => true,
  sortearPorElServicio: (...a: unknown[]) => h.servicio(...a),
  reservaDelServicioViva: () => false,
}));

const pagina = readFileSync(join(process.cwd(), "index.html"), "utf8");
const TX = "cd".repeat(32);
const ESPERADOS = V.cases.find((c) => c.k === 1)?.winners ?? [];

/** Un sello confirmado: el sorteo sale al tocar Lanzar. */
async function sellar(): Promise<typeof import("./draw")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 1, raffleId: 7n } as never;
  return import("./draw");
}

/** Todo lo que dijo la línea de la grabación mientras pasaba. */
function anotarLinea(): string[] {
  const vistos: string[] = [];
  const mirar = (): void => {
    const t = document.getElementById("grab-estado")?.textContent;
    if (t && vistos.at(-1) !== t) vistos.push(t);
  };
  new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  return vistos;
}

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.contar.mockReset();
  h.servicio.mockReset();
  h.fin = null;
  h.qr = [];
  vi.stubEnv("VITE_SORTEO_SERVIDOR", "1");
  vi.stubGlobal("CompressionStream", undefined);
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("el sorteo que manda el servicio, en la pantalla", () => {
  it("pasa de Guardando el sorteo a Sorteo guardado con el enlace, sin ningún paso de aprobar", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.servicio.mockImplementation((p: { alPaso: (s: string, d?: string) => void }) => {
      p.alPaso("sending");
      return new Promise((r) => {
        soltar = (v) => {
          p.alPaso("sending", TX);
          p.alPaso("confirmed", TX);
          r(v);
        };
      });
    });
    const { draw } = await sellar();
    const vistos = anotarLinea();
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    h.fin?.();
    await vi.waitFor(() => expect(document.getElementById("grab-estado")?.textContent).toMatch(/Guardando el sorteo/));
    soltar({ estado: "listo", valor: { winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX }, yaEstaba: false });
    await vi.waitFor(() => expect(document.getElementById("grab-estado")?.dataset.grabacion).toBe("guardado"));
    const caja = document.getElementById("grab-estado");
    expect(caja?.textContent).toContain(String(T.es.grabGuardado));
    expect(caja?.querySelector("a")?.getAttribute("href")).toContain(TX);
    expect(document.getElementById("btn-draw")?.textContent).toBe(String(T.es.drawnDone));
    expect(h.contar).toHaveBeenCalledWith("draw_confirmed", expect.anything());
    expect(h.drawOnChain).not.toHaveBeenCalled();
    // Nunca se ve nada de aprobar ni de firmar.
    expect(vistos.some((v) => v.includes(String(T.es.txSigning)))).toBe(false);
    expect(document.body.textContent).not.toContain(String(T.es.txSigning));
  });

  it("una cuenta que ya puede guardar premios ve Sorteo guardado y no el comprobante de la puerta del premio", async () => {
    h.drawOnChain.mockRejectedValue(new Error("premioGuardado"));
    h.servicio.mockResolvedValue({ estado: "listo", valor: { winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX }, yaEstaba: false });
    const { draw } = await sellar();
    void draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    h.fin?.();
    await vi.waitFor(() => expect(document.getElementById("grab-estado")?.dataset.grabacion).toBe("guardado"));
    expect(document.getElementById("grab-estado")?.textContent).toContain(String(T.es.grabGuardado));
    expect(h.drawOnChain).not.toHaveBeenCalled();
  });
});
