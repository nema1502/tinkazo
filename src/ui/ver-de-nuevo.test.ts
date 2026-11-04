// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Ver de nuevo con otro juego" y "Probar otro juego" (`verDeNuevo` en draw.ts): el mismo resultado, contado por otro
 * juego. Lo que importa es lo que NO hace: no sortea, no graba, no toca la cadena, no cuenta ni vuelve a revelar, y
 * le pasa al juego los mismos ganadores y la misma ronda.
 */

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  readDraw: vi.fn(),
  contar: vi.fn(),
  juego: vi.fn(),
  orden: [] as string[],
  alElegir: null as ((g: string) => void) | null,
}));

vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async () => undefined,
  existenciaDelSorteo: async () => "presente",
  limpiarDetalle: () => undefined,
  readDraw: (...a: unknown[]) => h.readDraw(...a),
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), contarPractica: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c, refDe: () => ({}) }));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined }));
vi.mock("./freeze", () => ({
  rotarJuego: () => undefined,
  secondsToRound: () => 0,
  unfreeze: () => undefined,
  alElegirDespuesDelResultado: (f: (g: string) => void) => (h.alElegir = f),
  irAlSelectorParaOtro: () => h.orden.push("selector"),
  juegoParaVerDeNuevo: async (g: string) => {
    h.orden.push(`juego:${g}`);
    const { app } = await import("../state");
    app.game = g as never;
  },
  marcarShow: (en: boolean) => h.orden.push(en ? "show" : "fin"),
  pintarNotaDelJuego: () => h.orden.push("nota"),
}));
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
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => undefined }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, rutaDe: () => "" }));
// El motor de respaldo: el "juego" solo anota con qué lo llamaron y termina.
vi.mock("../games/race", () => ({
  stadiumRace: (names: string[], winners: number[], beacon: { round: number }, fin: () => void) => {
    h.juego(names, winners, beacon.round);
    fin();
  },
}));

const BEACON = { round: 777, randomness: "ab".repeat(32), signature: "cd".repeat(48) };

async function prepararEstado(): Promise<{ drawn: unknown }> {
  const { app } = await import("../state");
  app.frozen = { names: ["Ana", "Beto", "Carla"], listHash: "00".repeat(32), ts: 1, at: "", prize: "Una pizza", round: 777, raffleId: 5n } as never;
  app.drawn = { beacon: BEACON, winners: [2] } as never;
  app.game = "race";
  return { drawn: app.drawn };
}

beforeEach(() => {
  vi.resetModules();
  for (const m of [h.drawOnChain, h.readDraw, h.contar, h.juego]) m.mockReset();
  h.orden = [];
  h.alElegir = null;
  document.body.innerHTML = `<button id="btn-draw"></button><div id="draw-status"></div><div id="winner-cards">Carla</div><div id="leyenda-box"></div><div id="lore-box"></div><button id="btn-replay"></button><button id="btn-otro-juego"></button>`;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sin red: verDeNuevo no la toca"));
  history.replaceState(null, "", "/?instant=1");
});

describe("ver de nuevo con otro juego", () => {
  it("cuenta el mismo resultado por el juego nuevo: mismos ganadores, misma ronda, sin sortear ni grabar", async () => {
    const { drawn } = await prepararEstado();
    const { app } = await import("../state");
    const { verDeNuevo } = await import("./draw");
    verDeNuevo("sapo");
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    expect(h.juego).toHaveBeenCalledWith(["Ana", "Beto", "Carla"], [2], 777);
    // El juego es el nuevo, el resultado es el mismo objeto de antes.
    expect(app.game).toBe("sapo");
    expect(app.drawn).toBe(drawn);
    // Nada de cadena, de red, de contador, ni un ganador nuevo en la página.
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(h.readDraw).not.toHaveBeenCalled();
    expect(h.contar).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById("winner-cards")?.textContent).toBe("Carla");
  });

  it("apaga el selector mientras corre el show y lo enciende al terminar", async () => {
    await prepararEstado();
    const { verDeNuevo } = await import("./draw");
    verDeNuevo("sapo");
    await vi.waitFor(() => expect(h.orden).toContain("fin"));
    expect(h.orden.indexOf("show")).toBeGreaterThan(-1);
    expect(h.orden.indexOf("show")).toBeLessThan(h.orden.indexOf("fin"));
  });

  it("sin resultado no hace nada: no hay qué volver a ver", async () => {
    const { app } = await import("../state");
    app.frozen = null;
    app.drawn = null;
    const { verDeNuevo, elegirOtroJuegoParaVer } = await import("./draw");
    verDeNuevo("sapo");
    elegirOtroJuegoParaVer();
    expect(h.juego).not.toHaveBeenCalled();
    expect(h.orden).toEqual([]);
  });

  it("un toque en el selector con el resultado puesto lo vuelve a ver con ese juego", async () => {
    await prepararEstado();
    await import("./draw");
    expect(h.alElegir).toBeTypeOf("function");
    h.alElegir?.("trompo");
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    expect(h.orden).toContain("juego:trompo");
  });

  it("los botones de «otro juego» llevan al selector", async () => {
    await prepararEstado();
    const { elegirOtroJuegoParaVer } = await import("./draw");
    elegirOtroJuegoParaVer();
    expect(h.orden).toEqual(["selector"]);
  });

  it("un show a la vez: mientras uno corre, otro toque no monta un segundo", async () => {
    await prepararEstado();
    // El primer juego no termina hasta que se lo diga la prueba.
    let terminar: () => void = () => undefined;
    vi.doMock("../games/race", () => ({
      stadiumRace: (_n: string[], _w: number[], b: { round: number }, fin: () => void) => {
        h.juego(b.round);
        terminar = fin;
      },
    }));
    const { verDeNuevo } = await import("./draw");
    verDeNuevo("sapo");
    await vi.waitFor(() => expect(h.juego).toHaveBeenCalledTimes(1));
    verDeNuevo("trompo");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.juego).toHaveBeenCalledTimes(1);
    terminar();
    vi.doUnmock("../games/race");
  });
});
