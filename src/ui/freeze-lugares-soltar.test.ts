// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Los premios por lugar de un sorteo no pasan al siguiente: soltar el sello los borra todos, no solo el 1.º, y la lista
 * de una campaña de empresa se sella con el premio de la campaña aunque antes hubiera tres premios por lugar escritos.
 * Con `premios.ts` y `ganadores.ts` de verdad, y la red de mentira: nada sale de la prueba.
 */

const h = vi.hoisted(() => ({
  sealOnChain: vi.fn(),
  /** La campaña de la lista que se sella, o null si no es de una campaña. */
  campana: null as null | { premios: number; organizadora: string | null },
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
vi.mock("../campana/en-curso", async (orig) => ({
  ...(await orig<typeof import("../campana/en-curso")>()),
  campanaDeLaLista: () => h.campana,
  esListaDeCampana: () => h.campana !== null,
  listaCambiadaDeLaCampana: () => false,
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => undefined }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
  frenarPorOtraRed: async () => false,
}));
vi.mock("./participants", async () => {
  const { canonicalList } = await import("../protocol/canonical");
  const caja = (): HTMLTextAreaElement => document.getElementById("ta") as HTMLTextAreaElement;
  return {
    cerrarLista: () => undefined,
    listaBloqueada: () => false,
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
vi.mock("./recomendar", () => ({
  juegoPorDefecto: () => "race",
  juegoSiguiente: () => "race",
  rangoParaLeer: () => [0, 0],
  rangoVisible: () => [0, 0],
  recomendar: () => "race",
}));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

const TRES = ["Bici", "Termo", "Libro"];

function armarPagina(ganadores: number): void {
  const vacios = [
    "freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "rules-text",
  ];
  document.body.innerHTML =
    `<textarea id="ta">Ana\nBeto\nCeci\nDani\nEli\nFede</textarea><button id="btn-freeze"></button><button id="btn-draw"></button>` +
    `<details id="mas-opciones"><summary>Premio</summary><div id="prize-chips"></div><input id="prize" maxlength="60">` +
    `<div id="prize-lugares" hidden></div><p id="prize-largo" role="status" hidden></p></details>` +
    `<input id="nw" type="number" value="${ganadores}"><div id="seal-status"></div>` +
    `${vacios.map((id) => `<div id="${id}"></div>`).join("")}<button id="g-wheel"></button>`;
  // jsdom no trae scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
}

/** Arma los campos de la cantidad pedida y escribe un premio en cada lugar, desde el 1.er. */
async function escribirPremios(premios: readonly string[]): Promise<void> {
  const { actualizarLugares } = await import("./premios");
  actualizarLugares();
  (document.getElementById("prize") as HTMLInputElement).value = premios[0] ?? "";
  premios.slice(1).forEach((premio, i) => {
    const input = document.querySelector<HTMLInputElement>(`#prize-lugares input[data-lugar="${i + 2}"]`);
    if (!input) throw new Error(`falta el campo del lugar ${i + 2}`);
    input.value = premio;
  });
}

/** Lo que llegó a la red en cada sello: el premio y la cantidad de ganadoras. */
const sellos = (): { meta: string; numWinners: number }[] =>
  (h.sealOnChain.mock.calls as [{ meta: string; numWinners: number }][]).map(([s]) => ({ meta: s.meta, numWinners: s.numWinners }));

beforeEach(() => {
  vi.resetModules();
  h.sealOnChain.mockReset();
  h.sealOnChain.mockRejectedValue(new Error("fin de la prueba"));
  h.campana = null;
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  // Pasada la guarda de "recién se soltó el sorteo anterior".
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

describe("los premios por lugar no pasan al sorteo siguiente", () => {
  it("al soltar el sello (Siguiente premio, Usar otra lista) se borran todos, no solo el del 1.er lugar", async () => {
    armarPagina(3);
    await escribirPremios(TRES);
    const { unfreeze } = await import("./freeze");
    unfreeze("Ana\nBeto\nCeci");
    const { premiosDeLosCampos } = await import("./premios");
    expect(premiosDeLosCampos()).toEqual(["", "", ""]);
  });

  it("una campaña que pasa después de un sorteo de tres premios por lugar sella solo el premio de la campaña", async () => {
    armarPagina(3);
    await escribirPremios(TRES);
    const { freeze } = await import("./freeze");
    // El sorteo de antes: sus tres premios, cada uno con su rótulo.
    await freeze();
    // La campaña pasa su lista como lo hace el paso de la campaña (`campana-pasar.ts`): premio, cantidad y traba, en ese orden.
    const { depsDelPasoReales } = await import("./campana-pasar-real");
    const d = depsDelPasoReales();
    const premio = d.premioEnEspanol(125_000_000n);
    d.ponerPremio(premio);
    d.ponerGanadores(3);
    d.fijarPorCampana(true);
    h.campana = { premios: 3, organizadora: null };
    await freeze();
    expect(sellos()).toEqual([
      { meta: "1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro", numWinners: 3 },
      { meta: premio, numWinners: 3 },
    ]);
    expect((document.getElementById("prize-lugares") as HTMLElement).hidden).toBe(true);
  });

  it("al dejar la campaña, los campos vuelven con la cantidad de ahora y vacíos", async () => {
    armarPagina(3);
    await escribirPremios(TRES);
    const { depsDelPasoReales, alOlvidarReal } = await import("./campana-pasar-real");
    const d = depsDelPasoReales();
    d.ponerPremio(d.premioEnEspanol(125_000_000n));
    d.ponerGanadores(2);
    d.fijarPorCampana(true);
    alOlvidarReal();
    const { premiosDeLosCampos } = await import("./premios");
    expect(premiosDeLosCampos().slice(1)).toEqual([""]);
  });
});
