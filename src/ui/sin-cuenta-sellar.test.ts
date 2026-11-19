// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Después de elegir seguir sin cuenta (plan B del ingreso), "Sellar la lista" sella de verdad en el modo libre, con
 * `freeze.ts` y `wallet-ui.ts` sin simular: la lista queda cerrada en el navegador, con la ronda a unos segundos, y no se
 * toca la cadena, ni Mis sorteos, ni la cuenta. Sin elegir, el botón sigue pidiendo entrar.
 */

const TEST = "Test SDF Network ; September 2015";

const h = vi.hoisted(() => ({
  sealOnChain: vi.fn(),
  remember: vi.fn(),
  contar: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    anchoringAvailable: true,
    get network() {
      return { ...o.network, name: "testnet", contractId: "CPRUEBA", networkPassphrase: TEST };
    },
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => ({
  ...(await orig<typeof import("../stellar/wallet-lite")>()),
  freighterInstalled: async () => false,
  guestStored: () => false,
  guestAvailable: () => false,
  setActiveWallet: () => undefined,
  activeWallet: () => null,
  xlmBalance: async () => 10,
}));
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async () => undefined,
  hideTxStatus: () => undefined,
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
  precalentarSello: () => undefined,
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: (...a: unknown[]) => h.sealOnChain(...a),
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", () => ({ leerPendiente: () => null, guardarPendiente: () => undefined, sellarSinDuplicar: async () => ({}) }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({
  contar: (...a: unknown[]) => h.contar(...a),
  errorContable: (c: string) => c,
  origenActual: () => "",
  contarEntrada: () => undefined,
  tomarEntrada: () => undefined,
}));
vi.mock("../ensayo-modo", () => ({
  ENSAYO_ESPERA_S: 15,
  STAND_ESPERA_S: 3,
  enEnsayo: () => false,
  enStand: () => false,
  enPractica: () => false,
  sinGrabar: () => false,
}));
vi.mock("./modo-ui", () => ({
  confirmarPrimerSelloOficial: async () => true,
  marcarSellandoAhora: () => undefined,
  pasarAModo: () => undefined,
  abrirHojaDeModo: () => undefined,
}));
vi.mock("./participants", () => ({
  cerrarLista: () => undefined,
  olvidarBorrador: () => undefined,
  guardarBorrador: () => undefined,
  parseNames: () => ["Ana", "Beto", "Carla", "Dani"],
  setList: () => undefined,
}));
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
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => false }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

/** Lo que se mira de lo sellado. */
interface LoSellado {
  raffleId?: bigint;
  sinSello?: boolean;
  sinCuenta?: boolean;
  names: string[];
  round: number;
}

const ids = ["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-entries", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left", "wait-id", "entities", "gamepick", "rules-text", "rules-pre-text", "fund-box", "cuenta-aviso", "gate"];

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
  h.sealOnChain.mockReset();
  h.remember.mockReset();
  h.contar.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    `<header></header><div>${ids.map((id) => `<div id="${id}"></div>`).join("")}</div><div id="wallet-box"></div><section id="sec-history"></section>` +
    '<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>' +
    '<textarea id="ta"></textarea><button id="btn-draw"></button><button id="g-wheel"></button>';
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * Elige seguir sin cuenta, como lo deja `wallet-ui.ts` al tocar el botón del aviso (probado en
 * `ingreso-plan-b-ui.test.ts`), y arma la herramienta con la elección ya hecha.
 */
async function seguirSinCuenta(): Promise<{ ui: typeof import("./wallet-ui") }> {
  const { elegirSinCuenta } = await import("./sin-cuenta");
  expect(elegirSinCuenta()).toBe(true);
  const ui = await import("./wallet-ui");
  ui.initWalletUI();
  return { ui };
}

describe("seguir sin cuenta y sellar", () => {
  it("sin elegir, el botón sigue pidiendo entrar", async () => {
    const ui = await import("./wallet-ui");
    ui.initWalletUI();
    expect(ui.claveDeSellar()).toBe("sigEntrarSellar");
    expect(document.getElementById("btn-freeze")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("elegido, el botón sella: queda cerrada en el navegador, con la ronda cerca, sin cadena y sin Mis sorteos", async () => {
    const { ui } = await seguirSinCuenta();
    expect(ui.claveDeSellar()).toBe("freeze");
    expect(ui.currentSession()).toBeNull();
    expect(ui.canAnchor()).toBe(false);
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    const antes = Math.floor(Date.now() / 1000);
    await freeze();
    // Se lee de nuevo: lo asignó `freeze()`, y el compilador no lo sabe.
    const sellada = (): LoSellado | null => app.frozen as LoSellado | null;
    expect(sellada()).not.toBeNull();
    // Sin sello en la cadena: ni número de sorteo, ni la marca de "seguir sin sello" (que es de quien tiene cuenta).
    expect(sellada()?.raffleId).toBeUndefined();
    expect(sellada()?.sinSello).toBeUndefined();
    // Lo sellado recuerda que nació sin cuenta: así no se anota en Mis sorteos si después se entra con una.
    expect(sellada()?.sinCuenta).toBe(true);
    expect(sellada()?.names).toEqual(["Ana", "Beto", "Carla", "Dani"]);
    // La ronda del modo libre, a unos segundos: no la de 45 s del sello en la cadena.
    const { roundTime } = await import("../protocol/quicknet");
    const espera = roundTime(sellada()?.round ?? 0) - antes;
    expect(espera).toBeGreaterThanOrEqual(3);
    expect(espera).toBeLessThanOrEqual(20);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
    expect(h.contar.mock.calls.filter(([e]) => e === "seal_sent")).toHaveLength(0);
    // La línea de "Modo Prueba: se borra…" no se ve: no hay nada que se registre.
    expect((document.getElementById("sellar-modo") as HTMLElement).style.display).toBe("none");
  });
});
