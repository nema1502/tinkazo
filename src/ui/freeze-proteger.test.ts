// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";

/**
 * El sello cuando Pollar pide proteger la cuenta (`SDK_WALLET_RECOVERY_REQUIRED`, `freeze.ts`). Se prueba el flujo
 * de `freeze()` con lo de afuera reemplazado: el sello, la ventana, la lista, el contador. Lo que importa:
 *
 * - la lista no se reabre mientras la ventana está abierta;
 * - si la persona protege la cuenta, el sello se repite UNA vez, con la misma lista, y cuenta un solo envío;
 * - si no la protege, vuelve a la lista intacta y se cuenta el fallo;
 * - si vuelve a pedirla después de protegida, no hay bucle.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  pide: vi.fn(),
  proteger: vi.fn(),
  contar: vi.fn(),
  nombres: ["Ana", "Beto"],
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
  margenParaAprobar: async () => 0,
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
vi.mock("./sello-seguro", () => ({
  leerPendiente: () => null,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: (...a: unknown[]) => h.pide(...a), protegerLaCuenta: () => h.proteger() }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({ apruebaAMano: () => false, canAnchor: () => true, claveDeSellar: () => "freeze", currentSession: () => ({ address: "GAAA" }) }));
vi.mock("./participants", () => ({
  cerrarLista: (...a: unknown[]) => void h.orden.push(`cerrarLista:${String(a[0])}`),
  olvidarBorrador: () => undefined,
  parseNames: () => h.nombres,
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
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => "race" }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><input id="prize" value="Una pizza"><select id="nw"><option value="1">1</option></select><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap"].map((id) => `<div id="${id}"></div>`).join("")}<button id="g-wheel"></button>`;
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
  armarPagina();
  // Pasada la guarda de "recién se soltó el sorteo anterior".
  vi.spyOn(performance, "now").mockReturnValue(10_000);
  h.pide.mockImplementation(async (e: unknown) => e instanceof Error && /RECOVERY_REQUIRED/.test(e.message));
});

const cuentas = (evento: string): number => h.contar.mock.calls.filter(([e]) => e === evento).length;

describe("sellar cuando la cuenta pide protección", () => {
  it("protegida: la lista no se reabre con la ventana abierta, el sello se repite una vez y cuenta un solo envío", async () => {
    // El reintento termina con otro fallo cualquiera: lo que viene después de sellar bien no es de esta prueba.
    h.sealOnChain.mockRejectedValueOnce(recuperacion()).mockRejectedValue(new Error("boom"));
    h.proteger.mockImplementation(async () => {
      h.orden.push("ventana");
      return true;
    });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(2);
    expect(h.proteger).toHaveBeenCalledTimes(1);
    // Con la ventana abierta la lista sigue cerrada: nunca un cerrarLista(false) antes de que la ventana termine.
    const iVentana = h.orden.indexOf("ventana");
    expect(iVentana).toBeGreaterThan(-1);
    expect(h.orden.slice(0, iVentana)).not.toContain("cerrarLista:false");
    expect(cuentas("seal_sent")).toBe(1);
    // El primer intento no se cuenta como fallado: se cuenta cómo termina el reintento.
    expect(cuentas("seal_failed")).toBe(1);
    expect(document.getElementById("seal-status")?.textContent ?? "").not.toContain("RECOVERY");
  });

  it("el reintento le dice a la persona que la cuenta quedó protegida", async () => {
    const vistos: string[] = [];
    h.sealOnChain.mockRejectedValueOnce(recuperacion()).mockImplementation(async (_a: unknown, onStep: (p: string) => void) => {
      onStep("simulating");
      vistos.push(document.getElementById("seal-status")?.textContent ?? "");
      throw new Error("boom");
    });
    h.proteger.mockResolvedValue(true);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(vistos[0]).toContain(t("protSigue"));
  });

  it("si no la protege: vuelve a la lista, dice el motivo y cuenta el fallo una vez", async () => {
    h.sealOnChain.mockRejectedValue(recuperacion());
    h.proteger.mockResolvedValue(false);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(h.orden).toContain("cerrarLista:false");
    expect(h.orden).toContain("escribirError");
    expect(document.getElementById("btn-freeze")?.hasAttribute("disabled")).toBe(false);
    expect(cuentas("seal_sent")).toBe(1);
    expect(cuentas("seal_failed")).toBe(1);
  });

  it("si vuelve a pedirla después de protegida: no abre la ventana otra vez y lo dice", async () => {
    h.sealOnChain.mockRejectedValue(recuperacion());
    h.proteger.mockResolvedValue(true);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(2);
    expect(h.proteger).toHaveBeenCalledTimes(1);
    expect(h.orden.filter((x) => x === "escribirError")).toHaveLength(1);
    expect(cuentas("seal_sent")).toBe(1);
    expect(cuentas("seal_failed")).toBe(1);
  });

  it("si la lista cambió mientras la ventana estaba abierta, no se sella otra distinta", async () => {
    h.sealOnChain.mockRejectedValue(recuperacion());
    h.proteger.mockImplementation(async () => {
      h.nombres = ["Ana", "Beto", "Carla"];
      return true;
    });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("otro error no abre la ventana", async () => {
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.proteger).not.toHaveBeenCalled();
    expect(cuentas("seal_failed")).toBe(1);
  });
});
