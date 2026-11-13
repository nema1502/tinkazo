// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lo que pasa con la pestaña y con la pantalla completa mientras se sella en modo Oficial (`freeze.ts`). Se prueba
 * `freeze()` con lo de afuera reemplazado: el sello, la lista, la red, la pantalla completa.
 */

const h = vi.hoisted(() => ({
  orden: [] as string[],
  sealOnChain: vi.fn(),
  sellarSinDuplicar: null as null | ((inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => Promise<unknown>),
  chequeo: vi.fn(),
  grande: false,
  soltar: vi.fn(),
  nombres: ["Ana", "Beto"],
  sesion: { address: "GAAA" } as { address: string } | null,
  /** Lo que `leerPendiente` encuentra guardado en el navegador: el intento de un sello que no se sabe si entró. */
  pendiente: null as null | { intento: unknown; premio: string },
}));

vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  escribirError: async (status: HTMLElement, e: unknown) => {
    h.orden.push("escribirError");
    status.textContent = (e as Error).message;
  },
  hideTxStatus: () => h.orden.push("hideTxStatus"),
  margenParaAprobar: async () => 0,
  pagaElPortero: async () => false,
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
  leerPendiente: () => h.pendiente,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    if (h.sellarSinDuplicar) return h.sellarSinDuplicar(inicial, o);
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  billeteraEnOtraRed: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => h.sesion,
  frenarPorOtraRed: async () => false,
}));
vi.mock("./participants", () => ({
  cerrarLista: (...a: unknown[]) => void h.orden.push(`cerrarLista:${String(a[0])}`),
  olvidarBorrador: () => undefined,
  parseNames: () => h.nombres,
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
  verSinSello: async () => undefined,
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: () => undefined }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => h.grande }));
vi.mock("./pantalla-completa", () => ({
  pedirPantallaCompleta: () => {
    h.orden.push("pedirPantallaCompleta");
    return "pedida";
  },
  soltarPantallaCompleta: (...a: unknown[]) => h.soltar(...a),
}));
vi.mock("../games/engine", () => ({ preloadGame: () => undefined }));
vi.mock("../games/pixi/kit/catalogo", () => ({ JUEGOS: [] }));
vi.mock("./premios", () => ({ ponerPremio: () => undefined, recordarPremio: () => undefined }));
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => "race" }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

function armarPagina(): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap"].map((id) => `<div id="${id}"></div>`).join("")}<button id="g-wheel"></button>`;
  Element.prototype.scrollIntoView = () => undefined;
}

/** Un intento de salir de la página (recargar, cerrar la pestaña): `true` si el navegador tendría que preguntar. */
function intentarSalir(): boolean {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(() => {
  vi.resetModules();
  h.orden = [];
  h.sealOnChain.mockReset();
  h.sellarSinDuplicar = null;
  h.chequeo.mockReset();
  h.chequeo.mockResolvedValue(true);
  h.grande = false;
  h.soltar.mockReset();
  h.nombres = ["Ana", "Beto"];
  h.sesion = { address: "GAAA" };
  h.pendiente = null;
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

describe("salir de la página mientras el sello va a la red", () => {
  it("mientras se manda el sello, recargar o cerrar la pestaña pide confirmación", async () => {
    let durante: boolean | null = null;
    h.sealOnChain.mockImplementation(async () => {
      durante = intentarSalir();
      throw new Error("boom");
    });
    const { freeze } = await import("./freeze");
    expect(intentarSalir()).toBe(false);
    await freeze();
    expect(durante).toBe(true);
  });

  it("terminado el sello, bien o mal, salir no pregunta nada", async () => {
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(intentarSalir()).toBe(false);
  });

  it("si la red no deja sellar, salir no pregunta nada", async () => {
    h.chequeo.mockResolvedValue(false);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(intentarSalir()).toBe(false);
  });
});

describe("un sello que se mandó y no se sabe si entró", () => {
  it("la lista queda cerrada y el botón encendido: el próximo toque averigua primero con la misma lista", async () => {
    const { SelloSinConfirmar } = await import("./sello-seguro");
    h.sellarSinDuplicar = async () => {
      throw new SelloSinConfirmar({ round: 1, desde: 1 } as never, new Error("se cortó"));
    };
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.orden).toContain("cerrarLista:true");
    expect(h.orden).not.toContain("cerrarLista:false");
    const btn = document.getElementById("btn-freeze") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.dataset.i).toBe("freeze");
    expect(h.orden).toContain("escribirError");
  });

  it("con el intento guardado, si el próximo toque encuentra la red en rojo la lista sigue cerrada", async () => {
    // Pasos: se manda el sello y no se sabe si entró. Sigue sin red y se toca Sellar de nuevo: el chequeo da rojo.
    // Reabrir la lista ahí dejaba sumar a alguien: la huella cambiaba, el intento guardado no aparecía y salía un
    // segundo sello si el primero había entrado.
    const { SelloSinConfirmar } = await import("./sello-seguro");
    const intento = { round: 1, desde: 1 } as never;
    h.sellarSinDuplicar = async () => {
      h.pendiente = { intento, premio: "Una pizza" };
      throw new SelloSinConfirmar(intento, new Error("se cortó"));
    };
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.orden).toContain("cerrarLista:true");

    h.orden = [];
    h.chequeo.mockResolvedValue(false);
    await freeze();
    expect(h.chequeo).toHaveBeenCalled();
    expect(h.orden).toContain("cerrarLista:true");
    expect(h.orden).not.toContain("cerrarLista:false");
    expect(h.orden).not.toContain("escribirError");
  });

  it("sin intento guardado, si la red no deja sellar la lista se reabre, porque no se mandó nada", async () => {
    h.chequeo.mockResolvedValue(false);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.orden).toContain("cerrarLista:false");
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("otro error del sello reabre la lista, como siempre", async () => {
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.orden).toContain("cerrarLista:false");
  });
});

describe("el intento se guarda antes de mandar el sello", () => {
  it("freeze le da a sellarSinDuplicar el intento de cada ronda: la cuenta, la huella, la cantidad y el premio", async () => {
    // El navegador de un iPhone no pregunta antes de salir: lo que queda guardado antes de mandar es lo que evita un segundo sello.
    let intentoDe: ((r: number) => unknown) | undefined;
    h.sellarSinDuplicar = async (_inicial, o) => {
      intentoDe = (o as { intentoDe?: (r: number) => unknown }).intentoDe;
      throw new Error("boom");
    };
    const { freeze } = await import("./freeze");
    await freeze();
    expect(intentoDe).toBeTypeOf("function");
    const { bytesToHex } = await import("../protocol/quicknet");
    const { listHash } = await import("../protocol/canonical");
    expect(intentoDe?.(123)).toMatchObject({ organizer: "GAAA", listHash: bytesToHex(listHash(["Ana", "Beto"])), round: 123, count: 2, numWinners: 1, meta: "Una pizza" });
  });
});

describe("la pantalla completa que pidió Sellar la lista, si no se selló", () => {
  it("si la red no deja sellar, se suelta", async () => {
    h.grande = true;
    h.chequeo.mockResolvedValue(false);
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.orden).toContain("pedirPantallaCompleta");
    expect(h.soltar).toHaveBeenCalled();
  });

  it("si el sello falla, se suelta", async () => {
    h.grande = true;
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.soltar).toHaveBeenCalled();
  });

  it("si la sesión se fue antes de mandar, se suelta", async () => {
    h.grande = true;
    h.sesion = null;
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.soltar).toHaveBeenCalled();
  });

  it("si no se pidió, no se suelta nada", async () => {
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    const { freeze } = await import("./freeze");
    await freeze();
    expect(h.soltar).not.toHaveBeenCalled();
  });
});
