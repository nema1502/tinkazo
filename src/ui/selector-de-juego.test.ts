// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";

/**
 * El selector de juegos y el ensayo (freeze.ts), 4 de noviembre de 2026:
 * - antes del resultado se elige y se cambia, también mientras llega el número;
 * - mientras corre el show el selector está apagado y dice por qué;
 * - con el resultado puesto, un toque en un juego lo vuelve a mostrar con ese juego (y nada más);
 * - sellar en el ensayo no pide la pantalla completa ni abre la espera en grande (en un sorteo de verdad, sí).
 */

const h = vi.hoisted(() => ({ ensayo: false, pedir: vi.fn(), nombres: ["Ana", "Beto"] }));

vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async () => undefined,
  hideTxStatus: () => undefined,
  margenParaAprobar: async () => 0,
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: async () => {
    throw new Error("boom");
  },
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", () => ({ leerPendiente: () => null, guardarPendiente: () => undefined, sellarSinDuplicar: async () => ({ raffleId: 1n, txHash: "H", round: 1, ts: 1 }) }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 3, enEnsayo: () => h.ensayo, enStand: () => false, sinGrabar: () => h.ensayo }));
vi.mock("./wallet-ui", () => ({ apruebaAMano: () => false, canAnchor: () => true, claveDeSellar: () => "freeze", currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./participants", () => ({ cerrarLista: () => undefined, olvidarBorrador: () => undefined, parseNames: () => h.nombres, setList: () => undefined }));
vi.mock("./red", () => ({
  chequearAntesDeSellar: async () => true,
  hayAccionDeRed: () => false,
  limpiarRed: () => undefined,
  marcarSellado: () => undefined,
  mostrarCostoAlto: async () => undefined,
  mostrarSinPatrocinio: async () => undefined,
  mostrarSinSaldo: async () => undefined,
  patrocinioDelError: () => null,
  verLaRedTrasFallar: async () => false,
  verSinSello: async () => undefined,
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => true }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: (...a: unknown[]) => h.pedir(...a), soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

const JUEGOS = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "quien", "trueque", "teleferico", "oruro", "guajojo", "toborochi"];

function armarPagina(): void {
  document.body.innerHTML =
    `<button id="btn-freeze"></button><input id="prize" value=""><input id="nw" type="number" value="1"><div id="seal-status"></div>` +
    ["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "juego-actual", "rec-sel-nota"].map((id) => `<div id="${id}"></div>`).join("") +
    `<p id="juego-nota" hidden></p><div id="gamepick">${JUEGOS.map((g) => `<button id="g-${g}"><span>${g}</span></button>`).join("")}</div>`;
  Element.prototype.scrollIntoView = () => undefined;
}

const RESULTADO = { beacon: { round: 1, randomness: "00", signature: "00" }, winners: [0] } as never;

beforeEach(() => {
  vi.resetModules();
  h.ensayo = false;
  h.pedir.mockReset();
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

const nota = (): HTMLElement => document.getElementById("juego-nota") as HTMLElement;
const marcados = (): string[] => [...document.querySelectorAll("#gamepick button.on")].map((b) => b.id);

describe("el selector de juegos", () => {
  it("antes del resultado se elige y se cambia, y no dice nada", async () => {
    const { app } = await import("../state");
    app.drawn = null;
    const { elegirJuego, pintarNotaDelJuego, alElegirDespuesDelResultado } = await import("./freeze");
    const alVer = vi.fn();
    alElegirDespuesDelResultado(alVer);
    elegirJuego("sapo");
    elegirJuego("trompo");
    expect(app.game).toBe("trompo");
    expect(marcados()).toEqual(["g-trompo"]);
    pintarNotaDelJuego();
    expect(nota().hidden).toBe(true);
    expect(alVer).not.toHaveBeenCalled();
  });

  it("mientras corre el show está apagado y dice por qué; los toques no hacen nada", async () => {
    const { app } = await import("../state");
    app.drawn = RESULTADO;
    app.game = "race";
    const { elegirJuego, marcarShow, alElegirDespuesDelResultado } = await import("./freeze");
    const alVer = vi.fn();
    alElegirDespuesDelResultado(alVer);
    marcarShow(true);
    expect(document.getElementById("gamepick")?.hasAttribute("inert")).toBe(true);
    expect(nota().hidden).toBe(false);
    expect(nota().textContent).toBe(t("juegoEnShow"));
    elegirJuego("sapo");
    expect(alVer).not.toHaveBeenCalled();
    expect(app.game).toBe("race");
  });

  it("al terminar el show se enciende, y con el resultado puesto dice que sirve para verlo de nuevo", async () => {
    const { app } = await import("../state");
    app.drawn = RESULTADO;
    const { marcarShow } = await import("./freeze");
    marcarShow(true);
    marcarShow(false);
    expect(document.getElementById("gamepick")?.hasAttribute("inert")).toBe(false);
    expect(document.body.hasAttribute("data-show")).toBe(false);
    expect(nota().textContent).toBe(t("juegoVerDeNuevo"));
  });

  it("con el resultado puesto, tocar un juego lo vuelve a ver con él; el selector solo cambia cuando el show lo pide", async () => {
    const { app } = await import("../state");
    app.drawn = RESULTADO;
    app.game = "race";
    const { elegirJuego, alElegirDespuesDelResultado, setGame, juegoParaVerDeNuevo } = await import("./freeze");
    const alVer = vi.fn();
    alElegirDespuesDelResultado(alVer);
    elegirJuego("trompo");
    expect(alVer).toHaveBeenCalledWith("trompo");
    expect(app.game).toBe("race");
    setGame("sapo");
    expect(app.game).toBe("race");
    juegoParaVerDeNuevo("trompo");
    expect(app.game).toBe("trompo");
    expect(marcados()).toEqual(["g-trompo"]);
  });

  it("los botones de otro juego dejan el foco en un juego que no es el de ahora", async () => {
    const { app } = await import("../state");
    app.drawn = null;
    const { irAlSelectorParaOtro, setGame } = await import("./freeze");
    setGame("race");
    irAlSelectorParaOtro();
    expect(document.activeElement?.id).toBe("g-sapo");
  });
});

describe("sellar en el ensayo", () => {
  it("no pide la pantalla completa ni deja la espera en grande pedida", async () => {
    h.ensayo = true;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.pedir).not.toHaveBeenCalled();
  });

  it("en un sorteo de verdad sí la pide, en el clic", async () => {
    h.ensayo = false;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.pedir).toHaveBeenCalledTimes(1);
  });
});
