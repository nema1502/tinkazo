// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "../i18n";

/**
 * La puerta del premio en la pantalla del sello (`freeze.ts`): con `VITE_RAMPA=premios`, una cuenta de Google o de correo
 * que puede guardar dinero no sella. Hay dos lugares donde se ve:
 *
 * - la consulta adelantada, antes del cupón y de cerrar la lista, que no gasta nada para enterarse;
 * - el error que lanza la puerta de la firma (`wallet-pollar.ts`), que llega por el `catch` del sello.
 *
 * Los dos muestran el mismo aviso: con dos salidas (otra cuenta o la billetera) si la cuenta puede guardar dinero, y con
 * Probar de nuevo si no se pudo comprobar. Con la pantalla y la red de mentira: nada sale de la prueba.
 */

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  orden: [] as string[],
  sealOnChain: vi.fn(),
  contar: vi.fn(),
  pedir: vi.fn(),
  soltar: vi.fn(),
  confirmar: vi.fn(),
  acceso: vi.fn(),
  cuentaLista: vi.fn(),
  cerrarLista: vi.fn(),
  verError: vi.fn(),
  cerrarSesion: vi.fn(),
  openPicker: vi.fn(),
  revisar: vi.fn(),
  mostrarCostoAlto: vi.fn(),
  mostrarSinPatrocinio: vi.fn(),
  mostrarSinSaldo: vi.fn(),
  verLaRedTrasFallar: vi.fn(),
  conPollar: true,
  cobro: true,
  pendiente: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    get network() {
      return { ...o.network, name: h.red, contractId: "CREAL" };
    },
  };
});
vi.mock("../stellar/cobro-oficial", async (orig) => ({
  ...(await orig<typeof import("../stellar/cobro-oficial")>()),
  cobroPorUso: () => h.cobro,
  redPrincipalConPollar: () => h.conPollar && h.red === "mainnet",
}));
vi.mock("../stellar/wallet-pollar", () => ({
  pollarWallet: { revisarPuertaDelPremio: (...a: unknown[]) => h.revisar(...a) },
  submitsItself: () => true,
}));
vi.mock("./anchor", () => ({
  clienteListo: async () => undefined,
  cuentaPatrocinada: async () => true,
  // Escribe el texto de verdad de la clave del error, como `anchorErrorText`.
  escribirError: async (status: HTMLElement, e: unknown) => {
    const { errorKey } = await import("../stellar/errores");
    status.textContent = String(T.es[`errAnchor.${errorKey(e)}`]);
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
vi.mock("./proteger-flujo", () => ({ pideProtegerLaCuenta: async () => false, protegerLaCuenta: async () => false }));
vi.mock("./sin-sorteos", () => ({ accesoParaSellar: (...a: unknown[]) => h.acceso(...a), esSinSorteos: () => false, alQuedarseSinSorteos: async () => undefined }));
vi.mock("./cuenta-lista-flujo", () => ({ cuentaListaParaGrabar: (...a: unknown[]) => h.cuentaLista(...a) }));
// `errorContable` es el de verdad: lo que se cuenta es lo que se manda, no lo que la prueba supone.
vi.mock("../contar", async (orig) => {
  const real = await orig<typeof import("../contar")>();
  return { contar: (...a: unknown[]) => h.contar(...a), errorContable: real.errorContable, origenActual: () => "" };
});
vi.mock("../ensayo-modo", () => ({ ENSAYO_ESPERA_S: 15, STAND_ESPERA_S: 15, enEnsayo: () => false, enStand: () => false, sinGrabar: () => false }));
vi.mock("./wallet-ui", () => ({
  apruebaAMano: () => false,
  canAnchor: () => true,
  cerrarSesion: (...a: unknown[]) => h.cerrarSesion(...a),
  claveDeSellar: () => "freeze",
  currentSession: () => ({ address: "GAAA" }),
  billeteraEnOtraRed: () => false,
  frenarPorOtraRed: async () => false,
  openPicker: (...a: unknown[]) => h.openPicker(...a),
}));
vi.mock("./modo-ui", () => ({
  confirmarPrimerSelloOficial: () => h.confirmar(),
  marcarSellandoAhora: () => undefined,
}));
vi.mock("./participants", () => ({
  cerrarLista: (...a: unknown[]) => h.cerrarLista(...a),
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
  mostrarCostoAlto: (...a: unknown[]) => h.mostrarCostoAlto(...a),
  mostrarSinPatrocinio: (...a: unknown[]) => h.mostrarSinPatrocinio(...a),
  mostrarSinSaldo: (...a: unknown[]) => h.mostrarSinSaldo(...a),
  patrocinioDelError: () => null,
  verLaRedTrasFallar: (...a: unknown[]) => h.verLaRedTrasFallar(...a),
  verSinSello: async () => undefined,
}));
vi.mock("./siguiente", () => ({ actualizarPaso: () => undefined, barraActiva: () => false, verError: (...a: unknown[]) => h.verError(...a) }));
vi.mock("./qr", () => ({ precargarQr: async () => undefined }));
vi.mock("./vista-grande", () => ({ entornoDeAhora: () => ({}), grandeAlSellar: () => true }));
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

/** El error que lanza la puerta de la firma, con la forma de `PremioGuardado`. */
const premio = (que: "puede-guardar" | "no-se-sabe"): Error => Object.assign(new Error(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber"), { name: "PremioGuardado", que });

function armarPagina(): void {
  document.body.innerHTML = `<button id="btn-freeze"></button><p id="sellar-modo" style="display:none"></p><input id="prize" value="Una pizza"><input id="nw" type="number" value="1"><div id="seal-status"></div>${["freeze-hint", "free-rule", "sec-frozen", "k-n", "k-digest", "k-status", "frozen-ts", "wheel-cap", "wait-box", "wait-round", "wait-left"].map((id) => `<div id="${id}"></div>`).join("")}<button id="btn-draw"></button><button id="g-wheel"></button>`;
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.resetModules();
  h.red = "mainnet";
  h.orden = [];
  for (const f of [h.sealOnChain, h.contar, h.pedir, h.soltar, h.confirmar, h.acceso, h.cuentaLista, h.cerrarLista, h.verError, h.cerrarSesion, h.openPicker, h.revisar, h.mostrarCostoAlto, h.mostrarSinPatrocinio, h.mostrarSinSaldo, h.verLaRedTrasFallar]) f.mockReset();
  h.sealOnChain.mockResolvedValue({ raffleId: 1n, txHash: "H" });
  h.confirmar.mockResolvedValue(true);
  h.acceso.mockResolvedValue(true);
  h.cuentaLista.mockResolvedValue(true);
  h.cerrarSesion.mockResolvedValue(undefined);
  h.openPicker.mockResolvedValue(undefined);
  h.revisar.mockResolvedValue("libre");
  h.verLaRedTrasFallar.mockResolvedValue(false);
  h.conPollar = true;
  h.cobro = true;
  h.pendiente = null;
  vi.stubEnv("VITE_RAMPA", "premios");
  armarPagina();
  vi.spyOn(performance, "now").mockReturnValue(10_000);
});

afterEach(() => vi.unstubAllEnvs());

const cuentas = (evento: string): number => h.contar.mock.calls.filter(([e]) => e === evento).length;
const estado = (): HTMLElement => document.getElementById("seal-status") as HTMLElement;
const boton = (id: string): HTMLButtonElement | null => document.getElementById(id) as HTMLButtonElement | null;
const sellar = async (): Promise<void> => {
  const { app } = await import("../state");
  app.frozen = null;
  const { freeze } = await import("./freeze");
  await freeze().catch(() => undefined);
};
const ultimaAccion = (cual: 1 | 2): { texto: string; ejecutar: () => void } | undefined => (h.verError.mock.calls.at(-1) as unknown[] | undefined)?.[cual] as { texto: string; ejecutar: () => void } | undefined;

describe("el sello frenado por la puerta de la firma (premioGuardado)", () => {
  async function conPremioGuardado(): Promise<void> {
    h.sealOnChain.mockRejectedValue(premio("puede-guardar"));
    await sellar();
  }

  it("dice el aviso, con la clase de los errores, y la lista queda abierta sin abrir la caja de la red ni la del costo", async () => {
    await conPremioGuardado();
    expect(estado().textContent).toContain(T.es["errAnchor.premioGuardado"] as string);
    expect(estado().style.display).toBe("block");
    expect(estado().className).toBe("txstatus bad");
    // La lista se cerró para sellar y se reabrió: nada quedó mandado.
    expect(h.cerrarLista.mock.calls.at(-1)).toEqual([false]);
    for (const caja of [h.mostrarCostoAlto, h.mostrarSinPatrocinio, h.mostrarSinSaldo, h.verLaRedTrasFallar]) expect(caja).not.toHaveBeenCalled();
    // Sellar la lista queda encendido, como con cualquier error.
    expect((document.getElementById("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
    // Un solo fallo contado, con la clave de la puerta del premio: la lista cerrada del conteo la trae.
    expect(cuentas("seal_failed")).toBe(1);
    expect(h.contar.mock.calls.find(([e]) => e === "seal_failed")?.[1]).toMatchObject({ error: "premioGuardado" });
  });

  it("ofrece dos salidas, otra cuenta y mi billetera, y ninguna manda el saldo a otro lado", async () => {
    await conPremioGuardado();
    expect(boton("premio-otra-cuenta")?.textContent).toBe(T.es.premioOtraCuenta);
    expect(boton("premio-billetera")?.textContent).toBe(T.es.premioBilletera);
    expect(estado().querySelectorAll("button")).toHaveLength(2);
    expect(estado().textContent).not.toMatch(/mand(a|á)r|transfer/i);
    // Para la espera en grande: la misma pareja de acciones, y el aviso sin el texto de los botones.
    expect(ultimaAccion(1)?.texto).toBe(T.es.premioOtraCuenta);
    expect(ultimaAccion(2)?.texto).toBe(T.es.premioBilletera);
    expect((h.verError.mock.calls.at(-1) as unknown[])[0]).toBe(estado());
  });

  it.each([
    ["premio-otra-cuenta", "premioMotivoOtra"],
    ["premio-billetera", "premioMotivoBilletera"],
  ] as const)("%s: cierra la sesión y abre la ventana para entrar con su motivo y el foco de vuelta en Sellar la lista", async (id, motivo) => {
    await conPremioGuardado();
    expect(h.cerrarSesion).not.toHaveBeenCalled();
    boton(id)?.click();
    await vi.waitFor(() => expect(h.openPicker).toHaveBeenCalledTimes(1));
    expect(h.cerrarSesion).toHaveBeenCalledTimes(1);
    expect(h.openPicker).toHaveBeenCalledWith({ motivo: T.es[motivo], volverA: document.getElementById("btn-freeze") });
    // Primero se cierra la sesión y después se abre la ventana.
    expect(h.cerrarSesion.mock.invocationCallOrder[0]).toBeLessThan(h.openPicker.mock.invocationCallOrder[0] as number);
  });

  it("las acciones de la espera en grande hacen lo mismo que los botones", async () => {
    await conPremioGuardado();
    ultimaAccion(2)?.ejecutar();
    await vi.waitFor(() => expect(h.openPicker).toHaveBeenCalledWith({ motivo: T.es.premioMotivoBilletera, volverA: document.getElementById("btn-freeze") }));
  });

  it("si cerrar la sesión falla, igual se abre la ventana", async () => {
    await conPremioGuardado();
    h.cerrarSesion.mockRejectedValue(new Error("sin red"));
    boton("premio-otra-cuenta")?.click();
    await vi.waitFor(() => expect(h.openPicker).toHaveBeenCalledTimes(1));
  });

  it("los botones llevan su clave de traducción: siguen al idioma", async () => {
    await conPremioGuardado();
    expect(boton("premio-otra-cuenta")?.dataset.i).toBe("premioOtraCuenta");
    expect(boton("premio-billetera")?.dataset.i).toBe("premioBilletera");
  });
});

describe("el sello frenado porque no se pudo comprobar (premioSinSaber)", () => {
  it("dice el aviso, deja Sellar la lista encendido y ofrece Probar de nuevo, que vuelve a sellar", async () => {
    h.sealOnChain.mockRejectedValue(premio("no-se-sabe"));
    await sellar();
    expect(estado().textContent).toBe(T.es["errAnchor.premioSinSaber"]);
    expect(estado().className).toBe("txstatus bad");
    expect((document.getElementById("btn-freeze") as HTMLButtonElement).disabled).toBe(false);
    expect(estado().querySelectorAll("button")).toHaveLength(0);
    const accion = ultimaAccion(1);
    expect(accion?.texto).toBe(T.es.clProbarDeNuevo);
    expect(ultimaAccion(2)).toBeUndefined();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    // Probar de nuevo es sellar otra vez, y la puerta vuelve a mirar (acá sigue sin dejar saber).
    accion?.ejecutar();
    await vi.waitFor(() => expect(h.sealOnChain).toHaveBeenCalledTimes(2));
  });
});

describe("la consulta adelantada, antes del cupón y de cerrar la lista", () => {
  it("con Google, la red principal y una cuenta que puede guardar dinero: el aviso, sin tocar el cupón, la lista ni la pantalla completa", async () => {
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).toHaveBeenCalledTimes(1);
    expect(estado().textContent).toContain(T.es["errAnchor.premioGuardado"] as string);
    expect(boton("premio-otra-cuenta")).not.toBeNull();
    expect(boton("premio-billetera")).not.toBeNull();
    // Nada se gastó para enterarse: ni el cupón ni la compuerta de la cuenta ni la confirmación del primer sello.
    expect(h.acceso).not.toHaveBeenCalled();
    expect(h.cuentaLista).not.toHaveBeenCalled();
    expect(h.confirmar).not.toHaveBeenCalled();
    expect(h.orden).not.toContain("chequear");
    // La lista no se cerró, no se contó un intento de sello y no queda pedida la pantalla completa.
    expect(h.cerrarLista).not.toHaveBeenCalled();
    expect(cuentas("seal_sent")).toBe(0);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(h.soltar).toHaveBeenCalled();
  });

  it("si no se pudo saber: el aviso con Probar de nuevo, y tampoco se gasta nada", async () => {
    h.revisar.mockResolvedValue("no-se-sabe");
    await sellar();
    expect(estado().textContent).toBe(T.es["errAnchor.premioSinSaber"]);
    expect(ultimaAccion(1)?.texto).toBe(T.es.clProbarDeNuevo);
    expect(h.acceso).not.toHaveBeenCalled();
    expect(h.cerrarLista).not.toHaveBeenCalled();
    expect(cuentas("seal_sent")).toBe(0);
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("con una cuenta libre sigue como hoy: cupón, lista y sello", async () => {
    h.revisar.mockResolvedValue("libre");
    await sellar();
    expect(h.acceso).toHaveBeenCalledTimes(1);
    expect(h.cuentaLista).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(cuentas("seal_sent")).toBe(1);
    expect(estado().querySelectorAll("button")).toHaveLength(0);
  });

  it("una cuenta que Horizon todavía no conoce pasa: se crea en el paso siguiente y la puerta de la firma la mira de nuevo", async () => {
    h.revisar.mockResolvedValue("no-existe");
    await sellar();
    expect(h.acceso).toHaveBeenCalledTimes(1);
    expect(h.cuentaLista).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(estado().textContent).not.toContain(T.es["errAnchor.premioSinSaber"] as string);
  });

  it("con un sello de esta lista que se averigua, no frena: averiguar no firma", async () => {
    h.pendiente = { intento: {}, red: "mainnet", contrato: "CREAL", premio: "" };
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).not.toHaveBeenCalled();
  });

  it.each(["pollar", " POLLAR "])("con VITE_RAMPA=%s, donde la venta paga con el saldo: no se lee nada y se sella como siempre", async (modo) => {
    vi.stubEnv("VITE_RAMPA", modo);
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).not.toHaveBeenCalled();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(estado().textContent).not.toContain(T.es["errAnchor.premioGuardado"] as string);
    expect(estado().querySelectorAll("button")).toHaveLength(0);
  });

  it.each(["recibir", "meru", "", "otra-cosa"])("con VITE_RAMPA=%s la puerta también cuida: frena sin gastar nada", async (modo) => {
    vi.stubEnv("VITE_RAMPA", modo);
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).not.toHaveBeenCalled();
    expect(estado().textContent).toContain(T.es["errAnchor.premioGuardado"] as string);
  });

  it("sin la bandera puesta del todo también cuida", async () => {
    vi.unstubAllEnvs();
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).not.toHaveBeenCalled();
  });

  it("con la billetera que vota a mano (dice libre sin leer), no frena y se sella como siempre", async () => {
    h.revisar.mockResolvedValue("libre");
    await sellar();
    expect(h.revisar).toHaveBeenCalledTimes(1);
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(estado().textContent).not.toContain(T.es["errAnchor.premioGuardado"] as string);
  });

  it("con una billetera propia, o sin cuenta de Google en la red principal: no se lee nada", async () => {
    h.conPollar = false;
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).not.toHaveBeenCalled();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("en la red de prueba: no se lee nada", async () => {
    h.red = "testnet";
    h.revisar.mockResolvedValue("puede-guardar");
    await sellar();
    expect(h.revisar).not.toHaveBeenCalled();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
  });

  it("si la lectura se rompe, no frena acá: la puerta de la firma mira igual", async () => {
    h.revisar.mockRejectedValue(new Error("boom"));
    await sellar();
    expect(h.sealOnChain).toHaveBeenCalledTimes(1);
    expect(estado().querySelectorAll("button")).toHaveLength(0);
  });
});

describe("un error que no es de la puerta del premio no cambia", () => {
  it("otro error del sello sigue su camino de siempre y no muestra las salidas del premio", async () => {
    h.sealOnChain.mockRejectedValue(new Error("boom"));
    await sellar();
    expect(boton("premio-otra-cuenta")).toBeNull();
    expect(boton("premio-billetera")).toBeNull();
    // Cayó en el aviso de siempre: se miró si la red estaba caída.
    expect(h.verLaRedTrasFallar).not.toHaveBeenCalled();
    expect(estado().textContent).not.toContain(T.es["errAnchor.premioGuardado"] as string);
  });
});
