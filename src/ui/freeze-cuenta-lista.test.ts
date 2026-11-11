// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La compuerta del sello en modo Oficial (`freeze.ts`, «Dejá tu cuenta lista»). Con la cuenta lista, el sello sigue sin
 * esperar; si falta algo, el paso se abre antes de la confirmación del primer sello y de cerrar la lista, suelta la
 * pantalla completa que pidió el toque, y su botón del final la vuelve a pedir. Si la persona sale, no se sella nada.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  contar: vi.fn(),
  pedir: vi.fn(),
  soltar: vi.fn(),
  confirmar: vi.fn(),
  hayModo: true,
  canAnchor: false,
  otraRed: true,
  sinGrabar: false,
  grande: false,
  frenadas: 0,
  /** Cómo contesta `frenarPorOtraRed`, si no es enseguida: la billetera tarda en decir su red. */
  frenarCon: null as null | (() => Promise<boolean>),
  /** Lo que devuelve la compuerta, y lo que hace con las opciones que recibe antes de devolverlo. */
  gate: vi.fn(),
  /** La billetera activa, para saber si el paso aplica cuando el flujo no bajó. */
  billetera: { submitsItself: true } as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get hayModoOficial() {
      return h.hayModo;
    },
    network: { ...o.network, name: "mainnet", contractId: "CREAL" },
  };
});
vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async (status: HTMLElement, e: unknown) => {
    status.textContent = (e as Error).message;
  },
  hideTxStatus: () => undefined,
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
  precargarParaElSorteo: () => undefined,
  resolverSelloEnLaRed: async () => null,
  sealOnChain: (...a: unknown[]) => h.sealOnChain(...a),
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./sello-seguro", async (orig) => ({
  ...(await orig<typeof import("./sello-seguro")>()),
  leerPendiente: () => null,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./cuenta-lista-flujo", () => ({ cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a) }));
/** La descarga del flujo del paso falla, como en el wifi de un evento: el `import()` se rechaza. Se deshace al final. */
const romperFlujo = (): void => {
  vi.doMock("./cuenta-lista-flujo", () => {
    throw new TypeError("Failed to fetch dynamically imported module");
  });
};
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => h.sinGrabar }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  canAnchor: () => h.canAnchor,
  claveDeSellar: () => "freeze",
  currentSession: () => {
    h.orden.push("sesion");
    return { address: "GAAA" };
  },
  billeteraEnOtraRed: () => h.otraRed,
  frenarPorOtraRed: async () => {
    h.frenadas++;
    return h.frenarCon ? h.frenarCon() : h.otraRed;
  },
}));
vi.mock("./modo-ui", () => ({
  confirmarPrimerSelloOficial: () => {
    h.orden.push("confirmar");
    return h.confirmar();
  },
  marcarSellandoAhora: (v: boolean) => void h.orden.push(`sellando:${String(v)}`),
}));
vi.mock("./participants", () => ({
  cerrarLista: (v: boolean) => void h.orden.push(`cerrarLista:${String(v)}`),
  olvidarBorrador: () => undefined,
  parseNames: () => ["Ana", "Beto"],
  setList: () => undefined,
}));
vi.mock("./red", () => ({
  chequearAntesDeSellar: async () => {
    h.orden.push("chequear");
    return true;
  },
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
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => h.grande }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: (...a: unknown[]) => h.pedir(...a), soltarPantallaCompleta: () => h.soltar() }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left"].map((id) => `<div id="${id}"></div>`).join("")}<button id="btn-draw"></button><button id="g-wheel"></button>`;
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.contar.mockReset();
  h.pedir.mockReset();
  h.soltar.mockReset();
  h.confirmar.mockReset();
  h.confirmar.mockResolvedValue(true);
  h.hayModo = true;
  h.canAnchor = false;
  h.otraRed = true;
  h.sinGrabar = false;
  h.grande = false;
  h.frenadas = 0;
  h.frenarCon = null;
  h.canAnchor = true;
  h.otraRed = false;
  h.billetera = { submitsItself: true };
  h.gate.mockReset();
  h.gate.mockImplementation(async () => {
    h.orden.push("compuerta");
    return true;
  });
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});


afterEach(() => {
  vi.doMock("./cuenta-lista-flujo", () => ({ cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a) }));
});

describe("la compuerta del sello en modo Oficial", () => {
  it("con la cuenta lista, sella; la compuerta va antes de la confirmación del primer sello y de cerrar la lista", async () => {
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.gate).toHaveBeenCalledTimes(1);
    expect(h.gate.mock.calls[0]?.[0]).toBe("sello");
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    const o = h.orden;
    expect(o.indexOf("compuerta")).toBeLessThan(o.indexOf("confirmar"));
    expect(o.indexOf("compuerta")).toBeLessThan(o.indexOf("cerrarLista:true"));
    expect(o.indexOf("compuerta")).toBeLessThan(o.indexOf("sellando:true"));
  });

  it("si la persona sale del paso, no se sella nada y se suelta la pantalla completa que pidió el toque", async () => {
    h.grande = true;
    h.gate.mockResolvedValue(false);
    const { app } = await import("../state");
    app.frozen = null;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.confirmar).not.toHaveBeenCalled();
    expect(app.frozen).toBeNull();
    expect(h.pedir).toHaveBeenCalledTimes(1);
    expect(h.soltar).toHaveBeenCalledTimes(1);
  });

  it("al abrirse el paso suelta la pantalla completa; su botón del final la pide de nuevo y el sello sigue con la misma lista", async () => {
    h.grande = true;
    h.gate.mockImplementation(async (_para: string, o: { alAbrir: () => void; alSeguir: () => void; alRevisar: (b: boolean) => void }) => {
      o.alRevisar(true);
      expect((document.getElementById("btn-freeze") as HTMLButtonElement).disabled).toBe(true);
      o.alRevisar(false);
      o.alAbrir();
      expect(h.soltar).toHaveBeenCalledTimes(1);
      o.alSeguir();
      return true;
    });
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.pedir).toHaveBeenCalledTimes(2);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    const arg = h.sealOnChain.mock.calls[0]?.[0] as { count: number };
    expect(arg.count).toBe(2);
  });

  it("sin cuenta (modo libre) o en la demo, la compuerta no se mira", async () => {
    h.canAnchor = false;
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.gate).not.toHaveBeenCalled();
  });

  it("si el paso no se pudo bajar, con una cuenta de Google no sella, pero lo dice con el aviso de volver a cargar", async () => {
    romperFlujo();
    const { freeze } = await import("./freeze");
    const { t } = await import("../i18n");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const aviso = document.querySelector(".cl-no-cargo");
    expect(aviso?.textContent).toContain(t("clNoCargo"));
    expect((document.getElementById("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
  });

  it("si el paso no se pudo bajar, con billetera propia sella como siempre y no avisa nada", async () => {
    romperFlujo();
    h.billetera = { submitsItself: false };
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cl-no-cargo")).toBeNull();
  });
});
