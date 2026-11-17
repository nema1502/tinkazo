// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentoDeSello } from "../stellar/envio";

/**
 * El intento guardado de un sello es de su cuenta, su lista, su red y su contrato. Acá con el almacenamiento de verdad
 * (`sello-seguro.ts`) y con los tres lugares de `freeze.ts` que lo guardan y lo borran: el sello de siempre, la
 * averiguación de Seguir sin sello y sus reintentos.
 *
 * El caso: la lista A queda con un sello que se mandó y no se sabe si entró. Antes todos los intentos compartían un
 * solo lugar, y el sello bueno de otra lista (en la otra red, o con otra cuenta en el mismo navegador) lo pisaba al
 * mandarse y lo borraba al terminar. Al volver a la lista A no había nada que averiguar y salía un segundo sello.
 */

const h = vi.hoisted(() => ({
  names: [] as string[],
  cuenta: "GAAA",
  sealOnChain: vi.fn(),
  resolver: vi.fn(),
  reintentarSello: vi.fn(),
}));

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
  resolverSelloEnLaRed: (...a: unknown[]) => h.resolver(...a),
  sealOnChain: (...a: unknown[]) => h.sealOnChain(...a),
  selloSinGrabar: () => false,
  showTxStatus: () => undefined,
  stepLabel: (paso: string) => paso,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: h.cuenta }),
  frenarPorOtraRed: async () => false,
}));
vi.mock("./modo-ui", () => ({ confirmarPrimerSelloOficial: async () => true, marcarSellandoAhora: () => undefined }));
vi.mock("./participants", () => ({
  cerrarLista: () => undefined,
  olvidarBorrador: () => undefined,
  parseNames: () => h.names,
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
  verSinSello: () => undefined,
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => false }));
vi.mock("./pantalla-completa", () => ({ pedirPantallaCompleta: () => "pedida", soltarPantallaCompleta: () => undefined }));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: (...a: unknown[]) => h.reintentarSello(...a) }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

const LISTA_A = ["Nora", "Beto"];
const LISTA_B = ["Ana", "Beto"];

const ids = ["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-entries", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left", "wait-id", "entities", "gamepick", "rules-text", "rules-pre-text", "fund-box", "cuenta-aviso", "gate"];

function armarPagina(): void {
  document.body.innerHTML =
    `<div>${ids.map((id) => `<div id="${id}"></div>`).join("")}</div>` +
    '<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>' +
    '<textarea id="ta"></textarea><button id="btn-draw"></button><button id="g-wheel"></button>';
  Element.prototype.scrollIntoView = () => undefined;
}

/** El almacenamiento de verdad, en la red y con el contrato que usa `freeze.ts`. */
async function almacen() {
  const [{ network }, { bytesToHex, targetRound }, { listHash }, seguro] = await Promise.all([
    import("../stellar/config"),
    import("../protocol/quicknet"),
    import("../protocol/canonical"),
    import("./sello-seguro"),
  ]);
  const contrato = network.contractId ?? "";
  const huella = (names: string[]): string => bytesToHex(listHash(names));
  return {
    /** Un intento de sellar esa lista que se mandó hace un momento. */
    intento: (names: string[], organizer = "GAAA"): IntentoDeSello => {
      const ahora = Math.floor(Date.now() / 1000);
      return { organizer, listHash: huella(names), round: targetRound(ahora, 45), count: names.length, numWinners: 1, meta: "Una bici", desde: ahora, hash: "tx-de-antes" };
    },
    guardar: (i: IntentoDeSello) => seguro.guardarPendiente(i, network.name, contrato, "Una bici", { organizer: i.organizer, listHash: i.listHash }),
    leer: (names: string[], organizer = "GAAA") => seguro.leerPendiente(organizer, huella(names), network.name, contrato),
  };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  h.names = LISTA_B;
  h.cuenta = "GAAA";
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.resolver.mockReset();
  h.reintentarSello.mockReset();
  h.reintentarSello.mockImplementation(() => ({ fin: new Promise(() => undefined), reintentarYa: () => undefined, cancelar: () => undefined, enCurso: () => false }));
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

describe("el intento guardado de un sello es de su cuenta y su lista", () => {
  it("el sello de siempre no deja nada guardado al terminar y no averigua nada", async () => {
    const a = await almacen();
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(h.resolver).not.toHaveBeenCalled();
    expect(a.leer(LISTA_B)).toBeNull();
    expect(localStorage.getItem("tinkazo.sello.pendiente")).toBeNull();
  });

  it("sellar bien otra lista no borra el sello sin confirmar de la lista A, y al volver a A se averigua ese y no se manda otro", async () => {
    const a = await almacen();
    const deA = a.intento(LISTA_A);
    a.guardar(deA);
    const { freeze } = await import("./freeze");
    const { app } = await import("../state");

    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(app.frozen?.raffleId).toBe(1n);
    expect(a.leer(LISTA_B)).toBeNull();
    expect(a.leer(LISTA_A)?.intento).toEqual(deA);

    // Vuelve a la lista A: primero averigua el sello de antes, que había entrado, y sigue con ese.
    h.names = LISTA_A;
    h.resolver.mockResolvedValue({ estado: "entro", raffleId: "7" });
    await freeze();
    expect(h.resolver).toHaveBeenCalledTimes(1);
    expect(h.resolver.mock.calls[0]?.[0]).toEqual(deA);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(app.frozen?.raffleId).toBe(7n);
    expect(app.frozen?.round).toBe(deA.round);
    expect(a.leer(LISTA_A)).toBeNull();
  });

  it("con otra cuenta en el mismo navegador, el sello bueno de una no borra el sin confirmar de la otra", async () => {
    const a = await almacen();
    const deOtra = a.intento(LISTA_B, "GOTRA");
    a.guardar(deOtra);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(a.leer(LISTA_B)).toBeNull();
    expect(a.leer(LISTA_B, "GOTRA")?.intento).toEqual(deOtra);
  });

  it("Seguir sin sello averigua el de su lista y, si no entró, borra solo ese", async () => {
    const a = await almacen();
    const deA = a.intento(LISTA_A);
    const deB = a.intento(LISTA_B);
    a.guardar(deA);
    a.guardar(deB);
    h.resolver.mockResolvedValue({ estado: "no-entro" });
    const { freeze } = await import("./freeze");
    await freeze({ sinSello: true, saltarChequeo: true });
    expect(h.resolver).toHaveBeenCalledTimes(1);
    expect(h.resolver.mock.calls[0]?.[0]).toEqual(deB);
    expect(a.leer(LISTA_B)).toBeNull();
    expect(a.leer(LISTA_A)?.intento).toEqual(deA);
    expect(h.reintentarSello).toHaveBeenCalledTimes(1);
  });

  it("cada reintento de Seguir sin sello guarda y borra solo el suyo", async () => {
    const a = await almacen();
    const deA = a.intento(LISTA_A);
    a.guardar(deA);
    const { freeze } = await import("./freeze");
    await freeze({ sinSello: true, saltarChequeo: true });
    const p = h.reintentarSello.mock.calls[0]?.[0] as { round: number; intentoDe: (r: number) => IntentoDeSello; guardarPendiente: (i: IntentoDeSello | null) => void };
    p.guardarPendiente(p.intentoDe(p.round));
    await vi.waitFor(() => expect(a.leer(LISTA_B)?.intento.round).toBe(p.round));
    expect(a.leer(LISTA_A)?.intento).toEqual(deA);
    p.guardarPendiente(null);
    await vi.waitFor(() => expect(a.leer(LISTA_B)).toBeNull());
    expect(a.leer(LISTA_A)?.intento).toEqual(deA);
  });
});
