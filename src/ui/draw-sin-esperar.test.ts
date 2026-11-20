// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El juego arranca cuando nace el número y el sorteo se graba mientras tanto (`draw.ts`, `grabar-sorteo.ts`). El
 * resultado se calcula en el navegador con lo sellado y el número comprobado, y al grabarlo se compara con lo que
 * devuelve el contrato. Con la lista y el número de `docs/vectors.json`.
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
  verError: vi.fn(),
  remember: vi.fn(),
  sesion: { address: "GAAA" } as { address: string; aMano?: boolean },
  fetchRound: vi.fn(),
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
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: (...a: unknown[]) => h.verError(...a) }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true }));
vi.mock("./freeze", () => ({ rotarJuego: () => undefined, secondsToRound: () => 0, unfreeze: () => undefined, alElegirDespuesDelResultado: () => undefined, irAlSelectorParaOtro: () => undefined, juegoParaVerDeNuevo: () => undefined, marcarShow: () => undefined, pintarNotaDelJuego: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 3.5, showGameCard: () => null }));
vi.mock("./wallet-ui", () => ({ currentSession: () => h.sesion }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => true }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./pantalla", () => ({ mostrarResultado: () => undefined }));
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
const ESPERADOS = V.cases.find((c) => c.k === 3)?.winners ?? [];

/** Un sello confirmado con la lista y la ronda de los vectores, como lo deja `freeze.ts`. */
async function sellar(extra: Record<string, unknown> = {}): Promise<typeof import("../state")> {
  const state = await import("../state");
  state.app.drawn = null;
  state.app.frozen = { names: [...V.list], listHash: V.list_hash, ts: 1, at: "", prize: "Una pizza", round: V.quicknet.round, numWinners: 3, raffleId: 7n, ...extra } as never;
  return state;
}

const grab = (): HTMLElement => document.getElementById("grab-estado") as HTMLElement;

beforeEach(() => {
  vi.resetModules();
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.drawOnChain.mockReset();
  h.juego.mockReset();
  h.verError.mockReset();
  h.remember.mockReset();
  h.fin = null;
  h.sesion = { address: "GAAA" };
  h.fetchRound.mockReset().mockResolvedValue({ round: V.quicknet.round, signature: V.quicknet.signature });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = new DOMParser().parseFromString(pagina, "text/html").body.innerHTML;
});

afterEach(() => {
  history.replaceState(null, "", "/");
});

describe("el juego arranca cuando nace el número", () => {
  it("arranca con el resultado calculado mientras la grabación sigue en curso, y después lo dice guardado", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    const { app } = await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    // El juego ya tiene a quienes ganan, y la grabación todavía no terminó. Con tres lugares
    // sellados la sala ve de a uno (issue #102): el primer show es el primer lugar.
    expect(h.juego).toHaveBeenCalledWith([ESPERADOS[0]]);
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    expect(grab().dataset.grabacion).toBe("guardando");
    expect(grab().textContent).toMatch(/Guardando el sorteo/);
    expect(app.drawn?.guardado).not.toBe(true);
    soltar({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await sorteo;
    expect(grab().dataset.grabacion).toBe("guardado");
    expect(grab().textContent).toMatch(/Sorteo guardado/);
    expect(app.drawn?.drawTx).toBe(TX);
    expect(app.drawn?.winners).toEqual(ESPERADOS);
  });

  it("si la grabación falla, el ganador no cambia, el botón la vuelve a probar sin otro show y el comprobante verifica", async () => {
    h.drawOnChain.mockRejectedValueOnce(new Error("la red no contestó")).mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    const { app } = await sellar();
    const { draw, reverify } = await import("./draw");
    await draw();
    expect(h.juego).toHaveBeenCalledTimes(1);
    expect(grab().dataset.grabacion).toBe("error");
    const btn = document.getElementById("btn-draw") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Guardar el sorteo");
    await draw();
    // Un solo show: el segundo toque solo grabó.
    expect(h.juego).toHaveBeenCalledTimes(1);
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
    expect(grab().dataset.grabacion).toBe("guardado");
    expect(app.drawn?.winners).toEqual(ESPERADOS);
    // El comprobante se rehace desde cero (firma, semilla y selección) y da lo mismo.
    await reverify();
    expect(document.getElementById("reverify-out")?.textContent).not.toBe("✗");
  });

  it("si la pestaña se cierra mientras se graba, Mis sorteos queda con el sorteo por guardar, y al guardarse se apaga", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    await sellar();
    const { draw } = await import("./draw");
    const sorteo = draw();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalled());
    // Termina el show con la grabación en curso: el resultado se anota, todavía por guardar.
    h.fin?.();
    await vi.waitFor(() => expect(h.remember).toHaveBeenCalledWith(expect.objectContaining({ id: "7", porGrabar: true, winners: ESPERADOS.map((i) => V.list[i]) })));
    soltar({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await sorteo;
    await vi.waitFor(() => expect(h.remember).toHaveBeenLastCalledWith(expect.objectContaining({ id: "7", porGrabar: false, drawTx: TX })));
  });

  it("si el contrato devuelve otros ganadores, es un error grave y se dice, no se calla", async () => {
    const consola = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.drawOnChain.mockResolvedValue({ winners: [4, 3, 11], randomness: V.quicknet.randomness, txHash: TX });
    const { app } = await sellar();
    const { draw } = await import("./draw");
    await draw();
    expect(grab().dataset.grabacion).toBe("no-coincide");
    expect(grab().textContent).toMatch(/no coincide/);
    expect(grab().textContent).toMatch(/hola@tinkazo\.app/);
    expect(h.verError).toHaveBeenCalled();
    expect(consola).toHaveBeenCalled();
    expect(app.drawn?.guardado).not.toBe(true);
    consola.mockRestore();
  });

  it("con varios ganadores usa los que se sellaron, aunque el campo diga otra cosa después de una recarga", async () => {
    h.drawOnChain.mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    const { app } = await sellar();
    (document.getElementById("nw") as HTMLInputElement).value = "5";
    const { draw } = await import("./draw");
    await draw();
    // La sala ve de a un lugar (issue #102), pero el resultado es el sellado entero.
    expect(h.juego).toHaveBeenCalledWith([ESPERADOS[0]]);
    expect(app.drawn?.winners).toEqual(ESPERADOS);
  });

  it("un orden de turnos (todos ganan) sale completo y en el orden del protocolo", async () => {
    const orden = V.cases.find((c) => c.k === V.list.length)?.winners ?? [];
    h.drawOnChain.mockResolvedValue({ winners: orden, randomness: V.quicknet.randomness, txHash: TX });
    await sellar({ numWinners: V.list.length, prize: "Turnos" });
    const { draw } = await import("./draw");
    await draw();
    expect(h.juego).toHaveBeenCalledWith(orden);
    expect(grab().dataset.grabacion).toBe("guardado");
  });

  it("con la billetera propia el juego no espera la aprobación: se pide después del show", async () => {
    h.sesion = { address: "GAAA", aMano: true };
    h.drawOnChain.mockResolvedValue({ winners: ESPERADOS, randomness: V.quicknet.randomness, txHash: TX });
    await sellar();
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.drawOnChain).not.toHaveBeenCalled();
    // Termina el show: recién ahí se pide la aprobación para grabarlo.
    h.fin?.();
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(grab().dataset.grabacion).toBe("guardado"));
  });
});

describe("lo que no graba", () => {
  it("el modo libre calcula por el mismo camino y no graba nada", async () => {
    await sellar({ raffleId: undefined });
    const { draw } = await import("./draw");
    await draw();
    // El juego se monta un instante después (se baja aparte), y sin sello no hay nada que esperar.
    // La sala ve de a un lugar (issue #102): el primer show es el primer lugar del resultado sellado.
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledWith([ESPERADOS[0]]));
    const estado = await import("../state");
    expect(estado.app.drawn?.winners).toEqual(ESPERADOS);
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(grab().style.display).toBe("none");
  });

  it("la demostración nunca graba nada", async () => {
    history.replaceState(null, "", "/?demo=race");
    await sellar({ raffleId: undefined });
    const { draw } = await import("./draw");
    await draw();
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalled());
    h.fin?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
});

describe("nunca arranca un juego sin el sello confirmado", () => {
  it("mientras el sello no está confirmado no hay lista sellada en la pantalla, y no hay juego ni número", async () => {
    const { app } = await import("../state");
    app.frozen = null;
    app.drawn = null;
    const { draw } = await import("./draw");
    await draw();
    await draw({ adelantado: true });
    expect(h.fetchRound).not.toHaveBeenCalled();
    expect(h.juego).not.toHaveBeenCalled();
  });

  it("lanzado antes de tiempo (más que la lectura de la tarjeta antes del número), no arranca", async () => {
    const { roundTime, roundAt } = await import("../protocol/quicknet");
    const lejos = roundAt(Math.floor(Date.now() / 1000)) + 20;
    expect(roundTime(lejos) * 1000 - Date.now()).toBeGreaterThan(5000);
    await sellar({ round: lejos });
    const { draw } = await import("./draw");
    await draw({ adelantado: true });
    expect(h.fetchRound).not.toHaveBeenCalled();
    expect(h.juego).not.toHaveBeenCalled();
  });
});
