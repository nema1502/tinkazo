// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_INVITADA, CLAVE_PREMIO, marcarPremio } from "../campana/invitada";
import { CLAVE_PASO_CUPON } from "../stellar/cupon-paso-guardado";

/**
 * La marca de invitada, el permiso del premio y lo que el flujo de la cuenta (`cuenta-lista-flujo.ts`) abre solo y por un
 * toque. Las dos cosas que no se rompen: a quien organiza no le cambia nada (sin la marca y sin el permiso, todo igual,
 * con las campañas en el build o sin ellas), y la entrada del premio no salta el acceso (eso lo prueban las pruebas del
 * paso: acá solo se mira cuándo y para qué se abre).
 */

type Local = { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" };

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  sinGrabar: false,
  practica: false,
  app: { frozen: null as unknown, drawn: null as unknown },
  nombres: [] as string[],
  abrir: vi.fn(),
  billetera: null as unknown,
  estado: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: h.red };
    },
  };
});
vi.mock("../ensayo-modo", () => ({ sinGrabar: () => h.sinGrabar, enPractica: () => h.practica }));
vi.mock("../state", () => ({ app: h.app }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => h.billetera }));
vi.mock("./cuenta-lista", () => ({ abrirCuentaLista: (...a: unknown[]) => h.abrir(...a) }));
vi.mock("../stellar/wallet-pollar", () => ({ pollarWallet: { label: "Google" }, puedeUsarDesbloqueo: async () => false }));
vi.mock("./wallet-ui", () => ({
  currentSession: () => ({ address: "GAAA", mail: "ana@example.org" }),
  estadoDeLaCuenta: () => ({ estado: "dentro", via: "google", nombre: "Ana", inicial: "A", foto: "", direccion: "GAAA" }),
  cerrarSesion: async () => undefined,
  entrar: async () => undefined,
  openPicker: async () => undefined,
}));
vi.mock("./modo-ui", () => ({
  pasarAModo: () => true,
  puedeCambiarDeModo: () => true,
  haceFaltaConfirmar: () => true,
  yaConfirmoPrimerOficial: () => false,
  marcarPrimerOficial: () => undefined,
}));
vi.mock("./participants", () => ({ parseNames: () => h.nombres }));
vi.mock("./freeze", () => ({ freeze: async () => undefined }));
vi.mock("@stellar/stellar-sdk", () => ({}));

const pollar = (local: Local, address = "GAAA") => ({
  submitsItself: true,
  address,
  label: "Google",
  estadoOficialLocal: () => local,
  estadoOficial: (...a: unknown[]) => h.estado(...a),
});
const FALTA: Local = { activacion: "falta", proteccion: "no-se-sabe" };
const LISTA: Local = { activacion: "lista", proteccion: "lista" };
const TODO = { activacion: "lista", proteccion: "lista", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };
const MARCA_VIGENTE = (): string => String(Date.now() + 60_000);

/** Lo que recibió el paso en el último `abrirCuentaLista`: el tercer argumento. */
const opciones = (n = 0): { para: string; primerOficial?: { pendiente: () => boolean; marcar: () => void }; cupon?: unknown; inicial?: unknown } =>
  h.abrir.mock.calls[n]?.[2] as never;

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  h.red = "mainnet";
  h.sinGrabar = false;
  h.practica = false;
  h.app.frozen = null;
  h.app.drawn = null;
  h.nombres = [];
  h.abrir.mockReset();
  h.abrir.mockResolvedValue(true);
  h.estado.mockReset();
  h.estado.mockResolvedValue({ ...TODO });
  h.billetera = pollar(FALTA);
  document.body.innerHTML = "";
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

const flujo = () => import("./cuenta-lista-flujo");

describe.each([["sin las campañas", ""], ["con las campañas", "1"]])("a quien organiza no le cambia nada, %s en el build", (_n, bandera) => {
  beforeEach(() => vi.stubEnv("VITE_CAMPANAS", bandera));

  it("al entrar con una cuenta nueva abre para la entrada, con el primer sello y sin cupón", async () => {
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(typeof opciones().primerOficial?.pendiente).toBe("function");
    expect(opciones().cupon).toBeUndefined();
    expect(opciones().inicial).toEqual({ activacion: "falta" });
    expect(f.vaAAbrirseAlEntrar()).toBe(true);
  });

  it("al entrar con una lista lista abre para la entrada con la lista", async () => {
    h.nombres = ["Ana", "Beto"];
    const f = await flujo();
    await f.revisarCuentaOficial("entrada");
    expect(opciones().para).toBe("entrada-con-lista");
    expect(opciones().primerOficial).toBeDefined();
  });

  it("al retomar abre para la entrada", async () => {
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
  });

  it("con el pedido del cupón, abre en el campo del cupón y lo consume", async () => {
    sessionStorage.setItem(CLAVE_PASO_CUPON, "1");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(opciones().cupon).toBe("escribir");
    expect(sessionStorage.getItem(CLAVE_PASO_CUPON)).toBeNull();
  });

  it("el sello abre el paso para sellar con el primer sello", async () => {
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    h.estado.mockResolvedValue({ ...TODO, proteccion: "falta" });
    const f = await flujo();
    await f.cuentaListaParaGrabar("sello");
    expect(opciones().para).toBe("sello");
    expect(typeof opciones().primerOficial?.marcar).toBe("function");
    expect(opciones().cupon).toBeUndefined();
  });

  it("el sorteo abre el paso para sortear con el primer sello", async () => {
    const f = await flujo();
    await f.cuentaListaParaGrabar("sorteo");
    expect(opciones().para).toBe("sorteo");
    expect(opciones().primerOficial).toBeDefined();
  });

  it("el error del sello abre el paso, y Usar un cupón lo abre en el campo", async () => {
    const f = await flujo();
    await f.abrirParaElError("sello", null);
    await f.abrirParaElError("sorteo", null, { cupon: "escribir" });
    expect(opciones(0).para).toBe("sello");
    expect(opciones(0).cupon).toBeUndefined();
    expect(opciones(1).para).toBe("sorteo");
    expect(opciones(1).cupon).toBe("escribir");
  });

  it("Tus dólares abre el paso para la entrada, con el primer sello", async () => {
    const f = await flujo();
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(opciones().primerOficial).toBeDefined();
    expect(opciones().cupon).toBeUndefined();
  });

  it("con una billetera de otra clase, o en Prueba, nada se abre", async () => {
    h.billetera = { submitsItself: false, address: "GAAA" };
    const f = await flujo();
    expect(f.aplica()).toBe(false);
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(await f.abrirDesdeTusDolares()).toBe(false);
    h.billetera = pollar(FALTA);
    h.red = "testnet";
    expect(f.aplica()).toBe(false);
    expect(await f.abrirDesdeTusDolares()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });
});

describe("la marca de invitada", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CAMPANAS", "1");
    localStorage.setItem(CLAVE_INVITADA, MARCA_VIGENTE());
  });

  it("lo que se abre solo se queda cerrado: al entrar y al retomar no se abre el paso", async () => {
    const f = await flujo();
    expect(f.aplica()).toBe(true);
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(f.vaAAbrirseAlEntrar()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("con la marca y una lista lista, tampoco se abre al entrar", async () => {
    h.nombres = ["Ana", "Beto"];
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("lo que pide un toque se abre: sellar con la cuenta sin activar abre el paso para sellar y suelta la marca", async () => {
    h.estado.mockResolvedValue({ ...TODO, activacion: "falta" });
    const f = await flujo();
    expect(await f.cuentaListaParaGrabar("sello")).toBe(true);
    expect(opciones().para).toBe("sello");
    expect(localStorage.getItem(CLAVE_INVITADA)).toBeNull();
  });

  it("sortear con la cuenta sin activar abre el paso para sortear y suelta la marca", async () => {
    const f = await flujo();
    await f.cuentaListaParaGrabar("sorteo");
    expect(opciones().para).toBe("sorteo");
    expect(localStorage.getItem(CLAVE_INVITADA)).toBeNull();
  });

  it("arreglar el error del sello abre el paso y suelta la marca", async () => {
    const f = await flujo();
    expect(await f.abrirParaElError("sello", null)).toBe(true);
    expect(opciones().para).toBe("sello");
    expect(localStorage.getItem(CLAVE_INVITADA)).toBeNull();
    // Y con la marca soltada, la herramienta se porta como con quien organiza.
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones(1).para).toBe("entrada");
  });

  it("Tus dólares, solo con la marca de invitada, abre el paso de siempre: quien no ganó nada no recibe un premio", async () => {
    const f = await flujo();
    expect(f.pasoDelPremio()).toBe(false);
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(opciones().primerOficial).toBeDefined();
    expect(opciones().cupon).toBeUndefined();
  });

  it("con la marca vencida, todo sigue como con quien organiza", async () => {
    localStorage.setItem(CLAVE_INVITADA, String(Date.now() - 1));
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(true);
    expect(opciones().para).toBe("entrada");
  });

  it("con las campañas apagadas en el build, la marca no cambia nada", async () => {
    vi.stubEnv("VITE_CAMPANAS", "");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones(1).para).toBe("entrada");
  });

  it("el pedido del cupón se abre con la marca y la suelta: lo pidió un toque", async () => {
    sessionStorage.setItem(CLAVE_PASO_CUPON, "1");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(opciones().cupon).toBe("escribir");
    expect(localStorage.getItem(CLAVE_INVITADA)).toBeNull();
  });
});

describe("el permiso del premio", () => {
  beforeEach(() => vi.stubEnv("VITE_CAMPANAS", "1"));

  it("con el permiso de esta cuenta, nada se abre solo y Tus dólares abre para recibir", async () => {
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(f.vaAAbrirseAlEntrar()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("premio");
  });

  it("después de una recarga, la marca de la pestaña sigue valiendo: nada se abre solo y Tus dólares abre para recibir", async () => {
    marcarPremio(sessionStorage, Date.now(), "GAAA");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("premio");
  });

  it("con la marca de la pestaña y sin la de invitada, una cuenta nueva no abre el paso de quien organiza", async () => {
    marcarPremio(sessionStorage, Date.now());
    const f = await flujo();
    expect(localStorage.getItem(CLAVE_INVITADA)).toBe(null);
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("la marca pendiente se queda con la primera cuenta que entra, y otra cuenta después ya no la tiene", async () => {
    marcarPremio(sessionStorage, Date.now());
    const f = await flujo();
    expect(f.pasoDelPremio()).toBe(true);
    expect(sessionStorage.getItem(CLAVE_PREMIO)).toMatch(/:GAAA$/);
    h.billetera = pollar(FALTA, "GBBB");
    expect(f.pasoDelPremio()).toBe(false);
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
  });

  it("el permiso es de una cuenta: si llega otra, quien organiza vuelve a ver el paso de siempre", async () => {
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    h.billetera = pollar(FALTA, "GBBB");
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones(0).para).toBe("entrada");
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones(1).para).toBe("entrada");
  });

  it("apagar el permiso borra la marca de la pestaña", async () => {
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    expect(sessionStorage.getItem(CLAVE_PREMIO)).not.toBeNull();
    f.permitirPasoDelPremio(null);
    expect(sessionStorage.getItem(CLAVE_PREMIO)).toBeNull();
    expect(f.pasoDelPremio()).toBe(false);
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
  });

  it("una marca vencida o rara no da permiso", async () => {
    sessionStorage.setItem(CLAVE_PREMIO, String(Date.now() - 1));
    const f = await flujo();
    expect(f.pasoDelPremio()).toBe(false);
    sessionStorage.setItem(CLAVE_PREMIO, "mañana");
    expect(f.pasoDelPremio()).toBe(false);
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
  });

  it("cuando el paso del premio termina con Seguir, el permiso se apaga", async () => {
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(sessionStorage.getItem(CLAVE_PREMIO)).toBeNull();
    expect(f.pasoDelPremio()).toBe(false);
  });

  it("si la persona sale del paso sin seguir, el permiso queda", async () => {
    h.abrir.mockResolvedValue(false);
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    expect(await f.abrirDesdeTusDolares()).toBe(false);
    expect(f.pasoDelPremio()).toBe(true);
  });

  it("cerrar la sesión desde el paso se lleva el permiso", async () => {
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    await f.abrirDesdeTusDolares();
    const salidas = h.abrir.mock.calls[0]?.[1] as { cerrarSesion: () => Promise<void> };
    marcarPremio(sessionStorage, Date.now(), "GAAA");
    f.permitirPasoDelPremio("GAAA");
    await salidas.cerrarSesion();
    expect(f.pasoDelPremio()).toBe(false);
    expect(sessionStorage.getItem(CLAVE_PREMIO)).toBeNull();
  });

  it("en la ventana de Google ya atendida, el paso de quien organiza no se abre, ni con la marca de invitada borrada", async () => {
    const f = await flujo();
    f.callarPasoEnEstaCarga();
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(f.vaAAbrirseAlEntrar()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("con la marca de invitada y el permiso de esta cuenta, Tus dólares abre para recibir", async () => {
    localStorage.setItem(CLAVE_INVITADA, MARCA_VIGENTE());
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones().para).toBe("premio");
  });

  it("el permiso de la memoria vence a los 30 minutos, como el de la pestaña", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
    const f = await flujo();
    f.permitirPasoDelPremio("GAAA");
    vi.setSystemTime(new Date("2026-11-18T12:29:00Z"));
    expect(f.pasoDelPremio()).toBe(true);
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    vi.setSystemTime(new Date("2026-11-18T12:31:00Z"));
    expect(f.pasoDelPremio()).toBe(false);
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
    expect(await f.abrirDesdeTusDolares()).toBe(true);
    expect(opciones(1).para).toBe("entrada");
  });
});

describe("la dirección que pide el premio", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CAMPANAS", "1");
    vi.stubEnv("VITE_RAMPA", "premios");
    history.replaceState(null, "", "/?red=oficial&premio=1");
  });

  it("mientras la dirección la pide, el paso de quien organiza no se abre solo", async () => {
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(f.vaAAbrirseAlEntrar()).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("con la ventana del saldo apagada, la dirección no manda: se abre como siempre", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
  });

  it("con las campañas apagadas en el build, la dirección no manda", async () => {
    vi.stubEnv("VITE_CAMPANAS", "");
    const f = await flujo();
    expect(await f.revisarCuentaOficial("retomar")).toBe(true);
    expect(opciones().para).toBe("entrada");
  });

  it("en la demo, el ensayo o el stand, la dirección no manda", async () => {
    h.sinGrabar = true;
    h.billetera = pollar(FALTA);
    const f = await flujo();
    expect(f.aplica()).toBe(false);
    const { pideElPremioAqui } = await import("./premio-pide");
    expect(pideElPremioAqui()).toBe(false);
  });
});

describe("pideElPremioAqui", () => {
  it.each([
    ["con todo prendido", {}, true],
    ["sin las campañas en el build", { campanas: "" }, false],
    ["sin la ventana del saldo", { rampa: "" }, false],
    ["con otra dirección que no es premio", { url: "/?red=oficial" }, false],
    ["con premio distinto de uno", { url: "/?premio=2" }, false],
  ])("%s", async (_n, o: { campanas?: string; rampa?: string; url?: string }, esperado) => {
    vi.stubEnv("VITE_CAMPANAS", o.campanas ?? "1");
    vi.stubEnv("VITE_RAMPA", o.rampa ?? "premios");
    history.replaceState(null, "", o.url ?? "/?red=oficial&premio=1");
    const { pideElPremioAqui } = await import("./premio-pide");
    expect(pideElPremioAqui()).toBe(esperado);
  });

  it("en la red de prueba, nunca", async () => {
    vi.stubEnv("VITE_CAMPANAS", "1");
    vi.stubEnv("VITE_RAMPA", "premios");
    history.replaceState(null, "", "/?premio=1");
    h.red = "testnet";
    const { pideElPremioAqui } = await import("./premio-pide");
    expect(pideElPremioAqui()).toBe(false);
  });
});
