// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Seguir sin sello" cuando de esa misma lista quedó un sello que se mandó y no se sabe si entró.
 *
 * El caso: el sello sale a la red y la respuesta no llega (`SelloSinConfirmar`), la red sigue mal, y la
 * persona toca "Seguir sin sello". Si ese sello había entrado y se mandaba otro con otra ronda, la misma lista quedaba
 * sellada dos veces: el contrato no lo impide, y se gastaba un segundo sorteo oficial. Primero se averigua:
 *
 * - Si entró, se sigue con ese sello (anclado), no sin sello.
 * - Si no entró ni puede entrar, se sigue sin sello y se intenta sellar como siempre.
 * - Si no se puede saber, se sigue sin sello pero NO se vuelve a mandar ningún sello de esa lista.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  resolver: vi.fn(),
  reintentarSello: vi.fn(),
  /** Lo que `guardarPendiente` recibió, en orden. */
  guardados: [] as unknown[],
  /** Los intentos previos con que se llamó a `sellarSinDuplicar`. */
  previos: [] as unknown[],
  sellarSinDuplicar: null as null | ((inicial: { round: number; ts: number }, o: unknown, previo: unknown) => Promise<unknown>),
  chequeo: vi.fn(),
  /** Lo que `leerPendiente` encuentra guardado en el navegador. */
  pendiente: null as null | { intento: unknown; premio: string },
}));

const INTENTO = { organizer: "GAAA", listHash: "ab".repeat(32), round: 1000, count: 2, numWinners: 1, meta: "Una pizza", desde: 900 };

vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async (status: HTMLElement, e: unknown) => {
    h.orden.push("escribirError");
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
vi.mock("./sello-seguro", async (orig) => ({
  ...(await orig<typeof import("./sello-seguro")>()),
  leerPendiente: () => h.pendiente,
  guardarPendiente: (i: unknown) => {
    h.guardados.push(i);
    if (i === null) h.pendiente = null;
  },
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }, previo: unknown) => {
    h.previos.push(previo);
    if (h.sellarSinDuplicar) return h.sellarSinDuplicar(inicial, o, previo);
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
  frenarPorOtraRed: async () => false,
}));
vi.mock("./modo-ui", () => ({ confirmarPrimerSelloOficial: async () => true, marcarSellandoAhora: () => undefined }));
vi.mock("./participants", () => ({
  cerrarLista: (...a: unknown[]) => void h.orden.push(`cerrarLista:${String(a[0])}`),
  olvidarBorrador: () => undefined,
  parseNames: () => ["Ana", "Beto"],
  setList: () => undefined,
}));
vi.mock("./red", () => ({
  chequearAntesDeSellar: (...a: unknown[]) => h.chequeo(...a),
  hayAccionDeRed: () => false,
  limpiarRed: () => undefined,
  marcarSellado: () => undefined,
  mostrarCostoAlto: async () => undefined,
  mostrarSinPatrocinio: async () => undefined,
  mostrarSinSaldo: async () => undefined,
  patrocinioDelError: () => null,
  verLaRedTrasFallar: async () => false,
  verSinSello: (estado: string) => void h.orden.push(`verSinSello:${estado}`),
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

const ids = ["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-entries", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left", "wait-id", "entities", "gamepick", "rules-text", "rules-pre-text", "fund-box", "cuenta-aviso", "gate"];

function armarPagina(): void {
  document.body.innerHTML =
    `<div>${ids.map((id) => `<div id="${id}"></div>`).join("")}</div>` +
    '<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>' +
    '<textarea id="ta"></textarea><button id="btn-draw"></button><button id="g-wheel"></button>';
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.guardados = [];
  h.previos = [];
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.resolver.mockReset();
  h.reintentarSello.mockReset();
  h.reintentarSello.mockImplementation(() => ({ fin: new Promise(() => undefined), reintentarYa: () => undefined, cancelar: () => undefined, enCurso: () => false }));
  h.sellarSinDuplicar = null;
  h.chequeo.mockReset();
  h.chequeo.mockResolvedValue(true);
  h.pendiente = null;
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

describe("Seguir sin sello con un sello de esta lista que no se sabe si entró", () => {
  it("si no se puede saber, se sigue sin sello pero no se vuelve a mandar ningún sello de esa lista", async () => {
    // El sello sale, la respuesta no llega y no se puede averiguar: queda el intento guardado y la lista cerrada.
    const { SelloSinConfirmar } = await import("./sello-seguro");
    h.sellarSinDuplicar = async () => {
      h.pendiente = { intento: INTENTO, premio: "Una pizza" };
      throw new SelloSinConfirmar(INTENTO as never, new Error("se cortó"));
    };
    const { freeze } = await import("./freeze");
    const { app } = await import("../state");
    await freeze();
    expect(h.orden).toContain("cerrarLista:true");
    expect(app.frozen).toBeNull();

    // La red sigue mal y la persona elige Seguir sin sello.
    h.sellarSinDuplicar = null;
    h.orden = [];
    h.resolver.mockResolvedValue({ estado: "no-se-sabe", error: new Error("sin red") });
    await freeze({ sinSello: true, saltarChequeo: true });

    expect(h.resolver).toHaveBeenCalledTimes(1);
    expect(h.resolver.mock.calls[0]?.[0]).toEqual(INTENTO);
    expect(app.frozen).not.toBeNull();
    expect(app.frozen?.sinSello).toBe(true);
    expect(app.frozen?.raffleId).toBeUndefined();
    // Ningún sello de la misma lista, ni ahora ni cada 15 segundos.
    expect(h.reintentarSello).not.toHaveBeenCalled();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    // El intento sigue guardado: el próximo sorteo de esa lista empieza por averiguarlo.
    expect(h.guardados).not.toContain(null);
    expect(h.pendiente).not.toBeNull();
    expect(h.orden).toContain("verSinSello:vencio");
  });

  it("si al averiguar resulta que ese sello entró, se sigue con él: anclado, con su ronda, y sin mandar otro", async () => {
    h.pendiente = { intento: INTENTO, premio: "Una pizza" };
    h.resolver.mockResolvedValue({ estado: "entro", raffleId: "7" });
    h.sellarSinDuplicar = async (_inicial, _o, previo) => ({ raffleId: 7n, txHash: "H7", round: INTENTO.round, ts: INTENTO.desde, retomado: previo });
    const { freeze } = await import("./freeze");
    const { app } = await import("../state");
    await freeze({ sinSello: true, saltarChequeo: true });

    expect(h.previos).toEqual([INTENTO]);
    expect(app.frozen?.raffleId).toBe(7n);
    expect(app.frozen?.round).toBe(INTENTO.round);
    expect(app.frozen?.sinSello).toBeUndefined();
    expect(h.reintentarSello).not.toHaveBeenCalled();
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("si no entró ni puede entrar, el intento se borra y se sigue sin sello, intentando sellar como siempre", async () => {
    h.pendiente = { intento: INTENTO, premio: "Una pizza" };
    h.resolver.mockResolvedValue({ estado: "no-entro" });
    const { freeze } = await import("./freeze");
    const { app } = await import("../state");
    await freeze({ sinSello: true, saltarChequeo: true });

    expect(h.guardados).toContain(null);
    expect(app.frozen?.sinSello).toBe(true);
    expect(h.reintentarSello).toHaveBeenCalledTimes(1);
  });

  it("sin ningún sello pendiente de esa lista, nada cambia: no se averigua y se sigue intentando sellar", async () => {
    const { freeze } = await import("./freeze");
    const { app } = await import("../state");
    await freeze({ sinSello: true, saltarChequeo: true });

    expect(h.resolver).not.toHaveBeenCalled();
    expect(app.frozen?.sinSello).toBe(true);
    expect(h.reintentarSello).toHaveBeenCalledTimes(1);
  });

  it("cada intento de sellar de después también deja guardado el suyo antes de mandarlo", async () => {
    const { freeze } = await import("./freeze");
    await freeze({ sinSello: true, saltarChequeo: true });

    const params = h.reintentarSello.mock.calls[0]?.[0] as { round: number; intentoDe?: (r: number) => unknown };
    expect(params.intentoDe).toBeTypeOf("function");
    expect(params.intentoDe?.(params.round)).toMatchObject({ organizer: "GAAA", round: params.round, count: 2, numWinners: 1, meta: "Una pizza" });
  });
});
