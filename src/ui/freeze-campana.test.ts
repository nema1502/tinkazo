// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sellar la lista de una campaña de empresa: el sello apunta a una ronda a 90 segundos o más, la cantidad de ganadoras es la
 * de los premios firmados, no se sella con otra cuenta que la que nombra la campaña ni sin sello, y la traba de Cuántos ganan
 * no sobrevive al sorteo. Fuera de una campaña, el margen de siempre y la cantidad que se pidió.
 */

const h = vi.hoisted(() => ({
  inicial: null as null | { round: number; ts: number },
  nombres: ["Ana", "Beto"] as string[],
  orden: [] as string[],
  sealOnChain: vi.fn(),
  contar: vi.fn(),
  /** Escribir en el cuadro de la lista: si sellar lo llama con una lista de campaña, cambió lo que pasó el panel. */
  setList: vi.fn(),
  /** La puerta de la cuenta lista: si se abre antes de comprobar la cuenta nombrada, el sello ya gastó un paso. */
  cuentaLista: vi.fn(),
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
    h.inicial = inicial;
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./cuenta-lista-flujo", () => ({ cuentaListaParaGrabar: (...a: unknown[]) => h.cuentaLista(...a) }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: (...a: unknown[]) => h.contar(...a), errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({
  ENSAYO_ESPERA_S: 15,
  STAND_ESPERA_S: 15,
  enEnsayo: () => false,
  enStand: () => false,
  sinGrabar: () => h.sinGrabar,
}));
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
  confirmarPrimerSelloOficial: () => h.confirmar(),
  marcarSellandoAhora: (v: boolean) => void h.orden.push(`sellando:${String(v)}`),
}));
vi.mock("./participants", () => ({
  cerrarLista: () => undefined,
  olvidarBorrador: () => undefined,
  parseNames: () => h.nombres,
  setList: (...a: unknown[]) => h.setList(...a),
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
vi.mock("./recomendar", () => ({
  juegoPorDefecto: () => "race",
  juegoSiguiente: () => "race",
  rangoParaLeer: () => [0, 0],
  rangoVisible: () => [0, 0],
  recomendar: () => ({ games: [] }),
}));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  const ids = [
    "freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "k-entries", "frozen-ts", "wheel-cap", "wait-box",
    "wait-round", "wait-left", "rules-text", "rules-pre-text", "entities", "gamepick",
  ];
  document.body.innerHTML =
    '<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><textarea id="ta"></textarea>' +
    '<input id="nw" type="number" value="1"><div id="seal-status"></div>' +
    ids.map((id) => `<div id="${id}"></div>`).join("") +
    '<button id="btn-draw"></button><button id="g-wheel"></button>';
  Element.prototype.scrollIntoView = () => undefined;
}

const HUELLA_ANA_BETO = async (): Promise<string> => {
  const { listHash } = await import("../protocol/canonical");
  const { bytesToHex } = await import("../protocol/quicknet");
  return bytesToHex(listHash(["Ana", "Beto"]));
};

/** Una campaña activa en la red principal: la sala cerrada de su evento y la lista que pasó el panel. */
async function conCampana(cambios: { premios?: number; organizadora?: string | null; huella?: string } = {}): Promise<void> {
  const { guardarSorteoDeCampana } = await import("../campana/en-curso");
  const { guardarOrg } = await import("../sala/campana-org");
  guardarOrg(localStorage, {
    sala: {
      id: "AbCd1234",
      token: "T".repeat(22),
      clave: "C".repeat(22),
      vence: Date.now() + 86_400_000,
      servicio: "https://s.tinkazo.app",
      evento: "evento-uno",
      red: "mainnet",
    },
    fase: "cerrada",
  });
  guardarSorteoDeCampana({
    evento: "evento-uno",
    red: "mainnet",
    contrato: "CREAL",
    huella: cambios.huella ?? (await HUELLA_ANA_BETO()),
    premios: cambios.premios ?? 2,
    organizadora: cambios.organizadora ?? null,
    pasadaEn: Date.now(),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CAMPANAS", "1");
  localStorage.clear();
  h.orden = [];
  h.inicial = null;
  h.nombres = ["Ana", "Beto"];
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.contar.mockReset();
  h.setList.mockReset();
  h.cuentaLista.mockReset();
  h.cuentaLista.mockResolvedValue(true);
  h.pedir.mockReset();
  h.soltar.mockReset();
  h.confirmar.mockReset();
  h.confirmar.mockResolvedValue(true);
  h.hayModo = true;
  h.canAnchor = true;
  h.otraRed = false;
  h.sinGrabar = false;
  h.grande = false;
  h.frenadas = 0;
  h.frenarCon = null;
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Cuántos segundos faltan para la ronda del sello, desde el momento en que se eligió. */
async function margenDelSello(): Promise<number> {
  const { roundTime } = await import("../protocol/quicknet");
  if (!h.inicial) throw new Error("no se eligió ninguna ronda");
  return roundTime(h.inicial.round) - h.inicial.ts;
}

describe("sellar la lista de una campaña", () => {
  it("el sello apunta a una ronda a 90 segundos o más", async () => {
    await conCampana();
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(await margenDelSello()).toBeGreaterThanOrEqual(90);
  });

  it("fuera de una campaña el margen es el de siempre: 45 segundos y menos de 90", async () => {
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    const margen = await margenDelSello();
    expect(margen).toBeGreaterThanOrEqual(45);
    expect(margen).toBeLessThan(90);
  });

  it("con otra lista que la que pasó el panel no sella: dice que la lista cambió y deja volver a pasarla", async () => {
    await conCampana({ huella: "00".repeat(32) });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.cuentaLista).not.toHaveBeenCalled();
    expect(document.getElementById("seal-status")?.textContent).toBe("La lista cambió. Volvé a pasarla.");
    const { pasoDelPuente } = await import("../campana/puente");
    expect(pasoDelPuente()).toEqual({ paso: "lista-cambio" });
  });

  it("con la sala sin lista pasada (la huella vacía) un sello común no se frena", async () => {
    await conCampana({ huella: "" });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(await margenDelSello()).toBeLessThan(90);
  });

  it("sin la bandera, aunque haya una campaña guardada, el margen es el de siempre", async () => {
    await conCampana();
    vi.stubEnv("VITE_CAMPANAS", "");
    const { freeze } = await import("./freeze");
    await freeze();
    expect(await margenDelSello()).toBeLessThan(90);
  });

  it("la cantidad de ganadoras es la de los premios de la campaña y no la que hubiera en el contador", async () => {
    await conCampana({ premios: 2 });
    const { freeze } = await import("./freeze");
    await freeze();
    expect((h.sealOnChain.mock.calls[0]?.[0] as { numWinners: number }).numWinners).toBe(2);
    const { app } = await import("../state");
    expect(app.frozen?.numWinners).toBe(2);
  });

  it("fuera de una campaña la cantidad es la que se pidió", async () => {
    const { freeze } = await import("./freeze");
    await freeze();
    expect((h.sealOnChain.mock.calls[0]?.[0] as { numWinners: number }).numWinners).toBe(1);
  });

  it("con menos personas que premios no sella y lo dice en la caja del sello", async () => {
    await conCampana({ premios: 3 });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(document.getElementById("seal-status")?.textContent).toBe("Hacen falta al menos 3 personas.");
  });

  it("con otra cuenta que la que nombra la campaña no sella y dice con cuál entrar", async () => {
    await conCampana({ organizadora: "GOTRA".padEnd(52, "A") + "6XWZ" });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(document.getElementById("seal-status")?.textContent).toBe("Entrá con la cuenta que termina en 6XWZ.");
  });

  it("la cuenta nombrada se comprueba antes de la puerta de la cuenta lista: con otra cuenta no se abre ningún paso", async () => {
    await conCampana({ organizadora: "GOTRA".padEnd(52, "A") + "6XWZ" });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.cuentaLista).not.toHaveBeenCalled();
    expect(h.confirmar).not.toHaveBeenCalled();
  });

  it("la cantidad mínima se comprueba antes de la puerta de la cuenta lista", async () => {
    await conCampana({ premios: 3 });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.cuentaLista).not.toHaveBeenCalled();
  });

  it("con la cuenta que nombra la campaña, pasa por la puerta de la cuenta lista y sella", async () => {
    await conCampana({ organizadora: "GAAA" });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.cuentaLista).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("con la cuenta que nombra la campaña, sella", async () => {
    await conCampana({ organizadora: "GAAA" });
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("no se sigue sin sello con la lista de una campaña", async () => {
    await conCampana();
    const { freeze } = await import("./freeze");
    await freeze({ sinSello: true });
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const { app } = await import("../state");
    expect(app.frozen).toBeNull();
    expect(document.getElementById("seal-status")?.textContent).toBe("Una campaña no sigue sin sello. Sellá la lista de nuevo.");
  });
});

describe("la lista de una campaña sin cuenta o sin sello", () => {
  it("sin cuenta conectada en la red de la sala no se sortea en modo libre: lo dice y no congela nada", async () => {
    await conCampana();
    h.canAnchor = false;
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const { app } = await import("../state");
    expect(app.frozen).toBeNull();
    expect(document.getElementById("seal-status")?.textContent).toBe("Conectá una cuenta en el modo de la campaña para sellar.");
  });

  it("fuera de una campaña, sin cuenta conectada se sigue en modo libre como siempre", async () => {
    h.canAnchor = false;
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const { app } = await import("../state");
    expect(app.frozen).not.toBeNull();
  });

  it("la demostración con una campaña guardada sigue en modo libre: nunca graba ni frena", async () => {
    await conCampana();
    h.canAnchor = false;
    h.sinGrabar = true;
    const { freeze } = await import("./freeze");
    await freeze();
    const { app } = await import("../state");
    expect(app.frozen).not.toBeNull();
  });

  it("con un sorteo de esa lista mandado a la sala sin respuesta, seguir sin sello también se frena", async () => {
    await conCampana();
    const { guardarSorteoDeCampana, entradaDelEvento } = await import("../campana/en-curso");
    const e = entradaDelEvento("mainnet", "evento-uno");
    if (!e) throw new Error("sin entrada");
    guardarSorteoDeCampana({ ...e, sorteo: "41", ronda: 123, mandados: ["41"], aviso: "pendiente" });
    const { freeze } = await import("./freeze");
    await freeze({ sinSello: true });
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const { app } = await import("../state");
    expect(app.frozen).toBeNull();
    expect(document.getElementById("seal-status")?.textContent).toBe("Una campaña no sigue sin sello. Sellá la lista de nuevo.");
  });
});

describe("la lista que pasó el panel de una campaña", () => {
  const CUENTAS = ["A", "B", "C"].map((letra) => "G" + letra.repeat(55));

  /** Pasa la lista al cuadro como lo hace el panel: las cuentas ordenadas, una por línea y sin sufijos. */
  async function pasarLaLista(): Promise<string> {
    const { listHash } = await import("../protocol/canonical");
    const { bytesToHex } = await import("../protocol/quicknet");
    const huella = bytesToHex(listHash(CUENTAS));
    h.nombres = CUENTAS;
    (document.getElementById("ta") as HTMLTextAreaElement).value = CUENTAS.join("\n");
    await conCampana({ premios: 3, huella });
    return huella;
  }

  it("sellar no cambia ni un carácter de la lista, con los modos a la vista", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    await pasarLaLista();
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(h.setList).not.toHaveBeenCalled();
    expect((document.getElementById("ta") as HTMLTextAreaElement).value).toBe(CUENTAS.join("\n"));
  });

  it("la huella que se sella es la misma que pasó el panel", async () => {
    vi.stubEnv("VITE_MODOS", "1");
    const huella = await pasarLaLista();
    const { freeze } = await import("./freeze");
    await freeze();
    const { bytesToHex } = await import("../protocol/quicknet");
    const sellada = (h.sealOnChain.mock.calls[0]?.[0] as { listHash: Uint8Array }).listHash;
    expect(bytesToHex(sellada)).toBe(huella);
  });
});

describe("la traba de Cuántos ganan", () => {
  it("se apaga cuando el sello queda hecho", async () => {
    await conCampana();
    const { fijarPorCampana, fijoPorCampana } = await import("./ganadores");
    fijarPorCampana(true);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(fijoPorCampana()).toBe(false);
  });

  it("se apaga al soltar el sello, para que el siguiente sorteo común deje cambiar la cantidad", async () => {
    const { fijarPorCampana, fijoPorCampana } = await import("./ganadores");
    fijarPorCampana(true);
    const { unfreeze } = await import("./freeze");
    unfreeze("");
    expect(fijoPorCampana()).toBe(false);
    expect((document.getElementById("nw") as HTMLInputElement).disabled).toBe(false);
  });
});
