// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * Después de elegir seguir sin cuenta (plan B del ingreso), "Lanzar el sorteo" sortea de verdad en el modo libre, con
 * `draw.ts` y `wallet-ui.ts` sin simular: el número público se pide y se comprueba, los ganadores salen de `select` en el
 * navegador, el comprobante no lleva sello en la cadena y no se toca ni la cadena ni Mis sorteos.
 */

const TEST = "Test SDF Network ; September 2015";
const LISTA = ["Ana", "Beto", "Carla", "Dani", "Eva"];
const FIRMA = "ab".repeat(48);

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  remember: vi.fn(),
  fetchRound: vi.fn(),
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
vi.mock("./compartir", () => ({ abrirSorteo: () => undefined }));
vi.mock("./history", () => ({ remember: (...a: unknown[]) => h.remember(...a), renderHistory: () => undefined }));
vi.mock("./anchor", () => ({
  cuentaPatrocinada: async () => true,
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  escribirError: async () => undefined,
  existenciaDelSorteo: async () => null,
  limpiarDetalle: () => undefined,
  precalentarSello: () => undefined,
  readDraw: async () => null,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sorteo-seguro", () => ({ sortearConReintentos: async () => ({ ok: false, error: new Error("no debe llamarse") }), sorteoReintentable: () => false, avisoDelReintento: () => "drawTry" }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({
  contar: () => false,
  contarPractica: () => undefined,
  errorContable: (c: string) => c,
  refDe: () => ({}),
  contarEntrada: () => undefined,
  tomarEntrada: () => undefined,
}));
vi.mock("../ensayo-modo", () => ({
  enEnsayo: () => false,
  enStand: () => false,
  enPractica: () => false,
  sinGrabar: () => false,
  faroDeStand: () => ({}),
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, verError: () => undefined, barraActiva: () => false }));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: (...a: unknown[]) => h.fetchRound(...a),
}));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async () => true, prepararFirma: () => undefined }));
vi.mock("./freeze", () => ({
  alElegirDespuesDelResultado: () => undefined,
  irAlSelectorParaOtro: () => undefined,
  juegoParaVerDeNuevo: () => undefined,
  marcarShow: () => undefined,
  pintarNotaDelJuego: () => undefined,
  rotarJuego: () => undefined,
  refreshFreezeLabel: () => undefined,
  secondsToRound: () => 0,
  unfreeze: () => undefined,
}));
vi.mock("./modo-ui", () => ({ pasarAModo: () => undefined, abrirHojaDeModo: () => undefined }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => undefined, soltarPantallaCompleta: () => undefined }));
vi.mock("./gamecard", () => ({ CARD_SECONDS: 5, showGameCard: () => null, claveNombre: () => "" }));
vi.mock("./qr", () => ({ pintarQrDelComprobante: async () => undefined }));
vi.mock("./leyenda", () => ({ pintarLeyenda: () => undefined }));
vi.mock("./participants", () => ({ setList: () => undefined, listaVinoDeLuma: () => false, guardarBorrador: () => undefined }));
vi.mock("./premios", () => ({ marcarSalio: () => undefined, olvidarSalieron: () => undefined, ponerPremio: () => undefined }));
vi.mock("./logo-sorteo", () => ({ pintarLogoEnElResultado: () => undefined, quitarLogoDelResultado: () => undefined }));
vi.mock("../games/engine", () => ({ usePixi: () => false }));
vi.mock("../games/lore", () => ({ loreFor: () => null }));
vi.mock("../games/overlay", () => ({ seguirEnPantallaCompleta: () => undefined }));
// El show no es de esta prueba: el sorteo ya está decidido cuando empieza, y no termina nunca.
vi.mock("../games/race", () => ({ stadiumRace: () => undefined }));
vi.mock("../music", () => ({ startMusic: () => undefined, stopMusic: () => undefined }));
vi.mock("../sound", () => ({ beep: () => undefined, note: () => undefined, sonidoDelJuego: () => "" }));
vi.mock("../enlace-corto", () => ({ acortar: async () => "", alAcortar: () => undefined, cortoGuardado: () => null, ponerLogoDeRuta: () => undefined, rutaDe: () => "" }));

/** Lo que se mira de lo sorteado. */
interface LoSorteado {
  beacon: { round: number; randomness: string; signature: string };
  winners: number[];
  drawTx?: string;
}

const ids = [
  "gate", "fund-box", "cuenta-aviso", "draw-status", "reverify-out", "again-row", "again-note", "winner-box", "lore-box", "leyenda-box", "qr-box",
  "sec-draw", "winner-cards", "sec-participants", "seed-label", "proof", "motion-note", "sec-history", "btn-whatsapp", "btn-email", "btn-proof",
];

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
  h.drawOnChain.mockReset();
  h.remember.mockReset();
  h.fetchRound.mockReset();
  h.fetchRound.mockResolvedValue({ signature: FIRMA });
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  // Sin movimiento: el juego se salta y no hay cortina ni tarjeta.
  history.replaceState(null, "", "/?instant=1");
  Element.prototype.scrollIntoView = () => undefined;
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  document.body.innerHTML =
    `<header></header><div id="wallet-box"></div><textarea id="ta"></textarea><input id="nw" type="number" value="2"><button id="btn-draw"></button><button id="btn-freeze"></button>` +
    ids.map((id) => (id.startsWith("btn-") ? `<a id="${id}"></a>` : `<div id="${id}"></div>`)).join("");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("seguir sin cuenta y sortear", () => {
  it("el número público se pide y se comprueba, y los ganadores salen de la elección del navegador, sin cadena ni Mis sorteos", async () => {
    // Elige seguir sin cuenta, como lo deja el botón del aviso (probado en `ingreso-plan-b-ui.test.ts`).
    const { elegirSinCuenta } = await import("./sin-cuenta");
    expect(elegirSinCuenta()).toBe(true);
    const ui = await import("./wallet-ui");
    ui.initWalletUI();
    expect(ui.claveDeSellar()).toBe("freeze");

    // La lista quedó cerrada en el navegador (lo hace `freeze()`, probado en `sin-cuenta-sellar.test.ts`): sin sello en la cadena.
    const { app } = await import("../state");
    const { listHash } = await import("../protocol/canonical");
    const { bytesToHex, hexToBytes, randomnessOf } = await import("../protocol/quicknet");
    const { select } = await import("../protocol/select");
    app.drawn = null;
    app.frozen = { names: LISTA, listHash: bytesToHex(listHash(LISTA)), ts: 1_700_000_000, at: "", prize: "Una pizza", round: 123 } as never;

    const { draw } = await import("./draw");
    await draw();

    // Se lee de nuevo: lo asignó `draw()`, y el compilador no lo sabe.
    const hecho = ((): LoSorteado | null => app.drawn as LoSorteado | null)();
    expect(hecho).not.toBeNull();
    expect(h.fetchRound).toHaveBeenCalledOnce();
    expect(h.fetchRound.mock.calls[0]?.[0]).toBe(123);
    const aleatoriedad = bytesToHex(randomnessOf(FIRMA));
    expect(hecho?.beacon).toMatchObject({ round: 123, randomness: aleatoriedad, signature: FIRMA });
    // Los ganadores son los de la elección determinista: cualquiera los rehace con la lista y el número.
    const esperados = select(hexToBytes(aleatoriedad), hexToBytes(bytesToHex(listHash(LISTA))), LISTA.length, 2);
    expect(hecho?.winners).toEqual(esperados);
    expect(hecho?.winners).toHaveLength(2);
    // Nada de cadena, ni sello pendiente, ni historial de la cuenta.
    expect(hecho?.drawTx).toBeUndefined();
    expect(h.drawOnChain).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
});
