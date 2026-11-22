// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que se sella como premio con los campos de verdad (`premios.ts` sin reemplazar): con un solo premio, el texto de
 * siempre, y con un premio por lugar, todos los que se escribieron o ninguno. Con la red de mentira: nada sale de la prueba.
 */

const h = vi.hoisted(() => ({
  sealOnChain: vi.fn(),
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

function armarPagina(ganadores: number): void {
  const vacios = ["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap"];
  document.body.innerHTML =
    `<textarea id="ta">Ana\nBeto\nCeci\nDani\nEli\nFede</textarea><button id="btn-freeze"></button>` +
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

/** Lo que llegó a la red como premio, o null si no se selló. */
const metaSellado = (): string | null => {
  const llamada = h.sealOnChain.mock.calls[0] as [{ meta: string }] | undefined;
  return llamada ? llamada[0].meta : null;
};

beforeEach(() => {
  vi.resetModules();
  h.sealOnChain.mockReset();
  h.sealOnChain.mockRejectedValue(new Error("fin de la prueba"));
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  // Pasada la guarda de "recién se soltó el sorteo anterior".
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

describe("el premio que se sella", () => {
  it("con un solo premio es el cuadro como se escribió, sin cambiar sus signos", async () => {
    armarPagina(1);
    await escribirPremios(["  Entrada Nº 5 "]);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(metaSellado()).toBe("Entrada Nº 5");
  });

  it("con un premio por lugar que entra, se sellan todos con su rótulo", async () => {
    armarPagina(3);
    await escribirPremios(["Bici", "Termo", "Libro"]);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(metaSellado()).toBe("1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro");
  });

  it("con cinco premios de 21 letras no se sella sin el 5.º: se frena y lo dice debajo de los campos", async () => {
    armarPagina(5);
    await escribirPremios(Array.from({ length: 5 }, () => "Auriculares Bluetooth"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const linea = document.getElementById("prize-largo") as HTMLElement;
    expect(linea.hidden).toBe(false);
    expect(linea.textContent).not.toBe("");
    expect(document.activeElement).toBe(document.querySelector('#prize-lugares input[data-lugar="5"]'));
  });

  it("con tildes que pasan los 160 bytes del sello no se manda a la red: se frena antes", async () => {
    // 156 letras y 163 bytes: el contrato lo rechazaría.
    armarPagina(3);
    const premio = "Auriculares inalámbricos con micrófono";
    await escribirPremios([premio, premio, premio]);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect((document.getElementById("prize-largo") as HTMLElement).hidden).toBe(false);
  });
});
