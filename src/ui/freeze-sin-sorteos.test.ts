// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeRespuesta } from "../stellar/patrocinador";

/**
 * Ninguna firma sin acceso (W5), en la compuerta del sello (`freeze.ts`). Con el cobro por uso del modo Oficial (red
 * principal, cuenta de Google o de correo y `VITE_ALTA=1`), antes de pedir la firma el portero tiene que decir en `/cupo`
 * que la cuenta tiene acceso y sorteos oficiales que alcancen. Con 0 no se pide la firma y sale «Se te acabaron»; con 1,
 * sí; con 60 ganadores y 1 sorteo, no; sin `/cupo`, no; sin acceso, el paso de la cuenta; y un 402 que igual llega
 * muestra la ventana. Con la bandera apagada o con Freighter, todo como hoy y sin preguntarle nada al portero.
 */

const URL = "https://pm.ejemplo";

const h = vi.hoisted(() => ({
  sealOnChain: vi.fn(),
  sinPatrocinio: vi.fn(),
  paso: vi.fn(),
  gate: vi.fn(),
  confirmar: vi.fn(),
  billetera: { submitsItself: true } as unknown,
  nombres: ["Ana", "Beto"] as string[],
  sellandoAhora: [] as boolean[],
  cambio: vi.fn(),
  pendiente: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, hayModoOficial: true, network: { ...o.network, name: "mainnet", contractId: "CREAL" } };
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
  leerPendiente: () => h.pendiente,
  guardarPendiente: () => undefined,
  sellarSinDuplicar: async (inicial: { round: number; ts: number }, o: { sellar: (r: number) => Promise<unknown> }) => {
    await o.sellar(inicial.round);
    return { raffleId: 1n, txHash: "H", round: inicial.round, ts: inicial.ts };
  },
}));
vi.mock("./cuenta-lista-flujo", () => ({
  cuentaListaParaGrabar: (...a: unknown[]) => h.gate(...a),
  abrirParaElError: (...a: unknown[]) => h.paso(...a),
}));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera }));
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("../contar", () => ({ contar: () => undefined, errorContable: (c: string) => c, origenActual: () => "" }));
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  canAnchor: () => true,
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
  billeteraEnOtraRed: () => false,
  frenarPorOtraRed: async () => false,
}));
vi.mock("./modo-ui", () => ({
  confirmarPrimerSelloOficial: () => h.confirmar(),
  marcarSellandoAhora: (v: boolean) => void h.sellandoAhora.push(v),
  puedeCambiarDeModo: () => h.sellandoAhora.at(-1) !== true,
  pasarAModo: (...a: unknown[]) => h.cambio(...a),
}));
vi.mock("./participants", () => ({
  cerrarLista: () => undefined,
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
  mostrarSinPatrocinio: (...a: unknown[]) => h.sinPatrocinio(...a),
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
vi.mock("./recomendar", () => ({ juegoPorDefecto: () => "race", juegoSiguiente: () => "race", rangoParaLeer: () => [0, 0], rangoVisible: () => [0, 0], recomendar: () => ({ games: [] }) }));
vi.mock("./gamecard", () => ({ claveNombre: () => "" }));
vi.mock("./sin-sello", () => ({ reintentarSello: async () => undefined }));
vi.mock("../logo-guardado", () => ({ logoParaSellar: () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./sin-sello-textos", () => ({ claveDelSello: () => "", ponerTextoDelSello: () => undefined, sinSelloAhora: () => false }));

/** Lo que dice `/cupo` del portero de la red principal con el cobro por uso. */
const cupo = (oficial: unknown, sellosQuedan = 99): Record<string, unknown> => ({
  prendido: true,
  rige: "portero",
  red: "mainnet",
  sellos: { usados: 1, max: 100, quedan: sellosQuedan },
  sorteos: { usados: 1, max: 100, quedan: 99 },
  liberaEn: Date.UTC(2026, 11, 1),
  ...(oficial === undefined ? {} : { oficial }),
});
const conSorteos = (quedan: number) => ({ acceso: true, sorteos: { quedan, proximoVence: quedan > 0 ? { fecha: Date.UTC(2027, 0, 14), cuantos: quedan } : null } });

/** El portero de mentira: cada pedido a `/cupo` contesta lo que sigue en la lista (el último se repite). */
function portero(...respuestas: Array<Record<string, unknown> | "caido">) {
  let i = 0;
  const f = vi.fn(async (u: string) => {
    if (!String(u).includes("/v1/patrocinio/cupo")) throw new Error(`pedido inesperado: ${u}`);
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r === "caido" || r === undefined) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/** Después del sello, la página de verdad tiene más que esta: lo que falta se ignora (como en `freeze-cuenta-lista.test.ts`). */
function armarPagina(ganadores = 1): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="${ganadores}"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left"].map((id) => `<div id="${id}"></div>`).join("")}<button id="btn-draw"></button><button id="g-wheel"></button>`;
  Element.prototype.scrollIntoView = () => undefined;
}

const ventana = (): HTMLElement | null => document.querySelector<HTMLElement>(".sin-sorteos");

async function esperar(cond: () => boolean, ms = 2_000): Promise<void> {
  const hasta = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > hasta) throw new Error("no llegó a pasar");
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_ALTA", "1");
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", URL);
  h.sealOnChain.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.sinPatrocinio.mockReset();
  h.sinPatrocinio.mockResolvedValue(undefined);
  h.paso.mockReset();
  h.paso.mockResolvedValue(false);
  h.gate.mockReset();
  h.gate.mockResolvedValue(true);
  h.confirmar.mockReset();
  h.confirmar.mockResolvedValue(true);
  h.cambio.mockReset();
  h.billetera = { submitsItself: true };
  h.nombres = ["Ana", "Beto"];
  h.sellandoAhora = [];
  h.pendiente = null;
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
  const { app } = await import("../state");
  app.frozen = null;
  app.drawn = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.querySelectorAll(".modal-back").forEach((e) => e.remove());
});

describe("la compuerta del sello con el cobro por uso", () => {
  it("con 0 sorteos no se pide la firma: sale «Se te acabaron», con «Usar un cupón» como principal", async () => {
    portero(cupo(conSorteos(0), 0));
    const { freeze } = await import("./freeze");
    const { t } = await import("../i18n");
    const p = freeze();
    await esperar(() => ventana() !== null);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    const v = ventana() as HTMLElement;
    expect(v.textContent).toContain(t("cupoOfCeroTitulo"));
    expect(v.textContent).toContain(t("cupoOfCeroTexto"));
    const principal = v.querySelector<HTMLButtonElement>(".dlg-main");
    expect(principal?.textContent).toBe(t("cupoOfUsarCupon"));
    expect(v.querySelectorAll(".dlg-main")).toHaveLength(1);
    // Ningún cobro como principal: puede estar proyectada frente a la sala.
    expect(v.textContent).not.toMatch(/dólares|US\$/);
    principal?.click();
    await p.catch(() => undefined);
    // «Usar un cupón» abre el paso de la cuenta, directo en el campo del cupón; la persona salió, y no se selló nada.
    expect(h.paso).toHaveBeenCalledWith("sello", expect.anything(), { cupon: "escribir" });
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.confirmar).not.toHaveBeenCalled();
  });

  it("con 1 sorteo sí se pide la firma", async () => {
    const f = portero(cupo(conSorteos(1), 1));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(ventana()).toBeNull();
    expect(String(f.mock.calls[0]?.[0])).toBe(`${URL}/v1/patrocinio/cupo?cuenta=GAAA`);
  });

  it("con 60 ganadores y 1 sorteo no se pide la firma (ese sello usa 2); con 2, sí", async () => {
    h.nombres = Array.from({ length: 80 }, (_, i) => `Persona ${i + 1}`);
    armarPagina(60);
    portero(cupo(conSorteos(1), 1));
    const { freeze } = await import("./freeze");
    const p = freeze();
    await esperar(() => ventana() !== null);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    (ventana()?.querySelector('[data-dlg="x"]') as HTMLButtonElement).click();
    await p.catch(() => undefined);
    expect(h.sealOnChain).not.toHaveBeenCalled();

    vi.resetModules();
    portero(cupo(conSorteos(2), 2));
    const { freeze: otra } = await import("./freeze");
    await otra().catch(() => undefined);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect((h.sealOnChain.mock.calls[0]?.[0] as { numWinners: number }).numWinners).toBe(60);
  });

  it("sin respuesta de /cupo no se pide la firma: cerrado, con la caja de la red", async () => {
    portero("caido");
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.sinPatrocinio).toHaveBeenCalledWith({ motivo: "cerrado" });
    expect((document.getElementById("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
  });

  it("si /cupo no trae lo oficial, o lo trae y no se entiende, tampoco", async () => {
    for (const cuerpo of [cupo(undefined), cupo({ acceso: "si" }), cupo({ acceso: true, sorteos: null }), cupo({ acceso: true, sorteos: { quedan: "3" } })]) {
      vi.resetModules();
      h.sinPatrocinio.mockClear();
      portero(cuerpo);
      const { freeze } = await import("./freeze");
      await freeze().catch(() => undefined);
      expect(h.sealOnChain, JSON.stringify(cuerpo)).not.toHaveBeenCalled();
      expect(h.sinPatrocinio).toHaveBeenCalledWith({ motivo: "cerrado" });
    }
  });

  it("sin acceso se abre el paso de la cuenta y no se firma; si al volver el portero ya da acceso, se sella", async () => {
    portero(cupo({ acceso: false }, 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.paso).toHaveBeenCalledTimes(1);
    expect(h.paso.mock.calls[0]?.[0]).toBe("sello");
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.sinPatrocinio).toHaveBeenCalledWith({ motivo: "ajena" });

    // Lo que diga el paso no alcanza: se le pregunta de nuevo al portero.
    vi.resetModules();
    h.paso.mockResolvedValue(true);
    const f = portero(cupo({ acceso: false }, 0), cupo(conSorteos(3), 3));
    const { freeze: otra } = await import("./freeze");
    await otra().catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(2);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("desde «Usar un cupón» de la caja de la red, el paso de la cuenta abre directo en el campo del cupón", async () => {
    portero(cupo({ acceso: false }, 0));
    const { freeze } = await import("./freeze");
    await freeze({ saltarChequeo: true, conCupon: true }).catch(() => undefined);
    expect(h.paso).toHaveBeenCalledTimes(1);
    expect(h.paso).toHaveBeenCalledWith("sello", expect.anything(), { cupon: "escribir" });
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("si vuelve del paso y sigue sin acceso, no se firma", async () => {
    h.paso.mockResolvedValue(true);
    portero(cupo({ acceso: false }, 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.paso).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.sinPatrocinio).toHaveBeenCalledWith({ motivo: "ajena" });
  });

  it("con sorteos pero en el tope de sellos del mes, no se firma y se dice con la caja de la red", async () => {
    portero(cupo(conSorteos(5), 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.sinPatrocinio).toHaveBeenCalledWith({ motivo: "cupo-cuenta", que: "sellos", liberaEn: Date.UTC(2026, 11, 1) });
  });

  it("un 402 que igual llega muestra la ventana, y «Pasar a Prueba» puede cambiar de modo", async () => {
    portero(cupo(conSorteos(1), 1));
    h.sealOnChain.mockRejectedValue(errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 0 }));
    const { freeze } = await import("./freeze");
    const { t } = await import("../i18n");
    const p = freeze();
    await esperar(() => ventana() !== null);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    const prueba = ventana()?.querySelector<HTMLButtonElement>('[data-accion="prueba"]');
    expect(prueba?.textContent).toBe(t("modeSwitchToTest"));
    expect(prueba?.disabled).toBe(false);
    prueba?.click();
    await p.catch(() => undefined);
    expect(h.cambio).toHaveBeenCalledWith("testnet");
    expect(h.sinPatrocinio).not.toHaveBeenCalled();
  });
});

describe("un sello cortado que todavía no se sabe si entró", () => {
  it("no lo frena la compuerta: averiguarlo no pide firma (y si hay que sellar de nuevo, el candado de antes de la firma vuelve a mirar)", async () => {
    h.pendiente = { intento: { round: 1 } };
    const f = portero(cupo(conSorteos(0), 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(f).not.toHaveBeenCalled();
    expect(ventana()).toBeNull();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });
});

describe("fuera del cobro por uso, como hoy", () => {
  it("con la bandera apagada, en la red principal, se sella sin preguntarle nada al portero", async () => {
    vi.stubEnv("VITE_ALTA", "");
    const f = portero(cupo(conSorteos(0), 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(f).not.toHaveBeenCalled();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("con Freighter, aunque la bandera esté puesta, se sella sin preguntarle nada al portero", async () => {
    h.billetera = { kind: "external", submitsItself: false };
    const f = portero(cupo(conSorteos(0), 0));
    const { freeze } = await import("./freeze");
    await freeze().catch(() => undefined);
    expect(f).not.toHaveBeenCalled();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });
});
