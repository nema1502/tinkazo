// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/quicknet";

/**
 * Antes de sellar, con los modos a la vista, a quien quedó con números que no cierran (se borró a mano una línea de
 * su reparto) se lo vuelve a numerar: lo que se sella es lo que cuenta el panel. Sin los modos, la lista se sella tal
 * cual, como siempre.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  pide: vi.fn(),
  proteger: vi.fn(),
  contar: vi.fn(),
  nombres: ["Ana", "Beto"],
  pagaElPortero: vi.fn(),
  paraAprobar: 0,
  inicial: null as { round: number; ts: number } | null,
}));

const recuperacion = () => new Error("SDK_WALLET_RECOVERY_REQUIRED");

vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async (status: HTMLElement, e: unknown) => {
    h.orden.push("escribirError");
    status.textContent = (e as Error).message;
  },
  hideTxStatus: () => h.orden.push("hideTxStatus"),
  margenParaAprobar: async () => h.paraAprobar,
  pagaElPortero: (...a: unknown[]) => h.pagaElPortero(...a),
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: (...a: unknown[]) => h.sealOnChain(...a),
  selloSinGrabar: () => false,
  showTxStatus: (id: string, paso: string) => {
    const host = document.getElementById(id);
    if (host) host.textContent = paso;
  },
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", async (orig) => ({
  ...(await orig<typeof import("./sello-seguro")>()),
  leerPendiente: () => null,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    h.inicial = inicial;
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: (...a: unknown[]) => h.pide(...a), protegerLaCuenta: (...a: unknown[]) => h.proteger(...a) }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
  // Con contrato en mainnet, sellar pregunta antes si la billetera está en la otra red: aquí nunca lo está.
  frenarPorOtraRed: async () => false,
}));
vi.mock("./participants", async () => {
  const { canonicalList } = await import("../protocol/canonical");
  const caja = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
  return {
    cerrarLista: () => undefined,
    olvidarBorrador: () => undefined,
    parseNames: () => canonicalList(caja().value),
    setList: (texto: string) => {
      caja().value = texto;
    },
  };
});
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
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => "race" }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  document.body.innerHTML = `<textarea id="ta"></textarea><button id="btn-freeze"></button><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap"].map((id) => `<div id="${id}"></div>`).join("")}<button id="g-wheel"></button>`;
  // jsdom no trae scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.sealOnChain.mockReset();
  h.pide.mockReset();
  h.proteger.mockReset();
  h.contar.mockReset();
  h.nombres = ["Ana", "Beto"];
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  h.paraAprobar = 0;
  h.inicial = null;
  h.pagaElPortero.mockReset();
  h.pagaElPortero.mockResolvedValue(false);
  armarPagina();
  // Pasada la guarda de "recién se soltó el sorteo anterior".
  vi.spyOn(performance, "now").mockReturnValue(10_000);
  h.pide.mockImplementation(async (e: unknown) => e instanceof Error && /RECOVERY_REQUIRED/.test(e.message));
});

const ta = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
const LISTA_ROTA = "Ana (1/3)\nAna (3/3)\nBeto";

describe("sellar un reparto al que le borraron una línea a mano", () => {
  it("con los modos a la vista, se vuelve a numerar y lo sellado son las líneas que cierran", async () => {
    history.replaceState(null, "", "/?modo=varias");
    ta().value = LISTA_ROTA;
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(ta().value).toBe("Ana (1/2)\nAna (2/2)\nBeto");
    const [sello] = h.sealOnChain.mock.calls[0] as [{ listHash: Uint8Array; count: number }];
    expect(sello.count).toBe(3);
    expect(bytesToHex(sello.listHash)).toBe(bytesToHex(listHash(["Ana (1/2)", "Ana (2/2)", "Beto"])));
  });

  it("sin los modos, la lista se sella tal cual: nada se reescribe", async () => {
    ta().value = LISTA_ROTA;
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(ta().value).toBe(LISTA_ROTA);
    const [sello] = h.sealOnChain.mock.calls[0] as [{ listHash: Uint8Array; count: number }];
    expect(sello.count).toBe(3);
    expect(bytesToHex(sello.listHash)).toBe(bytesToHex(listHash(["Ana (1/3)", "Ana (3/3)", "Beto"])));
  });
});
