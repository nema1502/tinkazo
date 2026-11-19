// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { roundTime } from "../protocol/quicknet";

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
  document.body.innerHTML = `<button id="btn-freeze"></button><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap"].map((id) => `<div id="${id}"></div>`).join("")}<button id="g-wheel"></button>`;
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
  h.paraAprobar = 0;
  h.inicial = null;
  h.pagaElPortero.mockReset();
  h.pagaElPortero.mockResolvedValue(false);
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

  it("a la ventana le dice a dónde devolver el foco: el botón de sellar, apagado, y su línea de estado", async () => {
    h.sealOnChain.mockRejectedValueOnce(recuperacion()).mockRejectedValue(new Error("boom"));
    h.proteger.mockResolvedValue(true);
    const { freeze } = await import("./freeze");
    await freeze();
    // Cuando se abre la ventana el botón ya está apagado y el foco cayó en la página: `document.activeElement` no sirve.
    expect(h.proteger).toHaveBeenCalledWith(document.getElementById("btn-freeze"), "seal-status");
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

describe("la ronda del primer intento según quién paga la comisión", () => {
  const AHORA_S = 1_800_000_000;

  /** Sella con el reloj quieto y devuelve a cuántos segundos de AHORA_S nace la ronda que se le pide a `sellarSinDuplicar`. */
  async function margenPedido(opciones: { pagarConMiCuenta?: boolean } = {}): Promise<number> {
    const reloj = vi.spyOn(Date, "now").mockReturnValue(AHORA_S * 1000);
    try {
      h.sealOnChain.mockRejectedValue(new Error("boom"));
      const { freeze } = await import("./freeze");
      await freeze(opciones);
      expect(h.inicial).not.toBeNull();
      expect(h.inicial?.ts).toBe(AHORA_S);
      return roundTime(h.inicial?.round ?? 0) - AHORA_S;
    } finally {
      reloj.mockRestore();
    }
  }

  it("si la comisión la paga el portero, la ronda nace a 65 s o más (y a menos de una ronda de drand de más)", async () => {
    h.pagaElPortero.mockResolvedValue(true);
    const margen = await margenPedido();
    expect(margen).toBeGreaterThanOrEqual(65);
    expect(margen).toBeLessThan(65 + 3);
  });

  it("si no la paga el portero, la ronda nace a 45 s, sin los 20 s de más", async () => {
    const margen = await margenPedido();
    expect(margen).toBeGreaterThanOrEqual(45);
    expect(margen).toBeLessThan(45 + 3);
  });

  it("con el portero, lo que se suma para aprobar a mano va sobre los 65 s", async () => {
    h.pagaElPortero.mockResolvedValue(true);
    h.paraAprobar = 45;
    const margen = await margenPedido();
    expect(margen).toBeGreaterThanOrEqual(110);
    expect(margen).toBeLessThan(110 + 3);
  });

  it("a pagaElPortero le llega si la persona eligió pagar con su cuenta", async () => {
    await margenPedido({ pagarConMiCuenta: true });
    expect(h.pagaElPortero).toHaveBeenCalledWith({ pagarConMiCuenta: true });
    h.pagaElPortero.mockClear();
    await margenPedido();
    expect(h.pagaElPortero).toHaveBeenCalledWith({ pagarConMiCuenta: false });
  });
});
