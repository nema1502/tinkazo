// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cuándo se abre «Dejá tu cuenta lista» (`cuenta-lista-flujo.ts`). En Prueba, con Freighter, en la demo y en el ensayo,
 * nada cambia: todo sigue sin bajar la pantalla del paso. En modo Oficial con una cuenta de Google o de correo, el paso
 * se abre al entrar si falta algo, el sello revisa con tope y el sorteo mira solo la memoria.
 */

type Local = { activacion: "lista" | "falta" | "no-se-sabe"; proteccion: "lista" | "no-se-sabe" };

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  sinGrabar: false,
  practica: false,
  app: { frozen: null as unknown, drawn: null as unknown },
  nombres: [] as string[],
  cargoPaso: false,
  abrir: vi.fn(),
  billetera: null as unknown,
  local: { activacion: "lista", proteccion: "lista" } as { activacion: string; proteccion: string },
  estado: vi.fn(),
  soltar: vi.fn(),
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
vi.mock("./cuenta-lista", () => {
  h.cargoPaso = true;
  return { abrirCuentaLista: (...a: unknown[]) => h.abrir(...a) };
});
vi.mock("../stellar/wallet-pollar", () => ({ pollarWallet: { label: "Google" }, puedeUsarDesbloqueo: async () => false }));
vi.mock("./wallet-ui", () => ({
  currentSession: () => ({ address: "GAAA", mail: "ana@mail.com" }),
  estadoDeLaCuenta: () => ({ estado: "dentro", via: "google", nombre: "Ana", inicial: "A", foto: "", direccion: "GAAA" }),
  cerrarSesion: async () => undefined,
  entrar: async () => undefined,
  openPicker: async () => undefined,
}));
vi.mock("./modo-ui", () => ({ pasarAModo: () => true, puedeCambiarDeModo: () => true, haceFaltaConfirmar: () => false, yaConfirmoPrimerOficial: () => true, marcarPrimerOficial: () => undefined }));
vi.mock("./participants", () => ({ parseNames: () => h.nombres }));
vi.mock("./freeze", () => ({ freeze: async () => undefined }));
vi.mock("@stellar/stellar-sdk", () => ({}));
vi.mock("./pantalla-completa", () => ({ soltarPantallaCompleta: () => h.soltar() }));

const pollar = (local: Local) => ({ submitsItself: true, address: "GAAA", label: "Google", estadoOficialLocal: () => local, estadoOficial: (...a: unknown[]) => h.estado(...a) });
const freighter = { submitsItself: false, address: "GAAA" };
const TODO = { activacion: "lista", proteccion: "lista", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null };

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  h.red = "mainnet";
  h.sinGrabar = false;
  h.practica = false;
  h.app.frozen = null;
  h.app.drawn = null;
  h.nombres = [];
  h.cargoPaso = false;
  h.abrir.mockReset();
  h.abrir.mockResolvedValue(true);
  h.estado.mockReset();
  h.estado.mockResolvedValue({ ...TODO });
  h.billetera = pollar({ activacion: "lista", proteccion: "lista" });
  document.body.innerHTML = "";
});

const flujo = () => import("./cuenta-lista-flujo");

describe("donde no aplica, nada cambia", () => {
  it.each([
    ["en Prueba", () => (h.red = "testnet")],
    ["con Freighter", () => (h.billetera = freighter)],
    ["en la demo o el ensayo", () => (h.sinGrabar = true)],
    ["sin sesión", () => (h.billetera = null)],
  ])("%s: sellar y sortear siguen, al entrar no se abre nada, y no se baja la pantalla del paso", async (_, armar) => {
    armar();
    h.billetera = h.billetera === freighter || h.billetera === null ? h.billetera : pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    const f = await flujo();
    expect(f.aplica()).toBe(false);
    expect(await f.cuentaListaParaGrabar("sello")).toBe(true);
    expect(await f.cuentaListaParaGrabar("sorteo")).toBe(true);
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(f.faltaEnLaMemoria()).toBe(false);
    expect(await f.abrirParaElError("sello", null)).toBe(false);
    expect(h.estado).not.toHaveBeenCalled();
    expect(h.abrir).not.toHaveBeenCalled();
    expect(h.cargoPaso).toBe(false);
  });
});

describe("el sello en modo Oficial", () => {
  it("con todo listo en memoria, sigue sin preguntar nada", async () => {
    const f = await flujo();
    const alRevisar = vi.fn();
    expect(await f.cuentaListaParaGrabar("sello", { alRevisar })).toBe(true);
    expect(h.estado).not.toHaveBeenCalled();
    expect(alRevisar).not.toHaveBeenCalled();
  });

  it("sin memoria, revisa (el botón dice «Revisando…») y sigue si está lista", async () => {
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    const f = await flujo();
    const alRevisar = vi.fn();
    expect(await f.cuentaListaParaGrabar("sello", { alRevisar })).toBe(true);
    expect(alRevisar.mock.calls).toEqual([[true], [false]]);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("si falta algo, abre el paso para el sello y devuelve lo que la persona eligió", async () => {
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    h.estado.mockResolvedValue({ ...TODO, proteccion: "falta" });
    h.abrir.mockResolvedValue(false);
    const f = await flujo();
    const volverA = document.createElement("button");
    expect(await f.cuentaListaParaGrabar("sello", { volverA })).toBe(false);
    expect(h.abrir).toHaveBeenCalledTimes(1);
    const op = h.abrir.mock.calls[0]?.[2] as { para: string; inicial: { proteccion: string }; volverA: unknown; aviso: () => string };
    expect(op.para).toBe("sello");
    expect(op.inicial.proteccion).toBe("falta");
    expect(op.volverA).toBe(volverA);
    expect(op.aviso()).toBe("Entraste con Google como Ana.");
    // La línea se arma en cada pintada: con los botones ES y EN del paso, cambia de idioma con lo demás.
    const { setLang } = await import("../i18n");
    setLang("en");
    try {
      expect(op.aviso()).not.toBe("Entraste con Google como Ana.");
      expect(op.aviso()).toContain("Ana");
    } finally {
      setLang("es");
    }
  });

  it("si no se pudo saber en 4 segundos, abre el paso igual", async () => {
    vi.useFakeTimers();
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    h.estado.mockReturnValue(new Promise(() => undefined));
    const f = await flujo();
    const p = f.cuentaListaParaGrabar("sello");
    await vi.advanceTimersByTimeAsync(4_100);
    await p;
    expect(h.abrir).toHaveBeenCalledTimes(1);
    expect((h.abrir.mock.calls[0]?.[2] as { inicial: unknown }).inicial).toBeNull();
  });
});

describe("el sorteo en modo Oficial", () => {
  it("sin memoria, sigue sin preguntar: puede lanzarse solo desde la espera", async () => {
    h.billetera = pollar({ activacion: "no-se-sabe", proteccion: "no-se-sabe" });
    const f = await flujo();
    expect(await f.cuentaListaParaGrabar("sorteo")).toBe(true);
    expect(h.estado).not.toHaveBeenCalled();
  });

  it("si la memoria dice que falta activar, abre el paso para el sorteo", async () => {
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    const f = await flujo();
    expect(f.faltaEnLaMemoria()).toBe(true);
    expect(await f.cuentaListaParaGrabar("sorteo")).toBe(true);
    expect((h.abrir.mock.calls[0]?.[2] as { para: string }).para).toBe("sorteo");
    expect(h.estado).not.toHaveBeenCalled();
  });
});

describe("al entrar y al retomar", () => {
  it("una cuenta nueva: abre enseguida, sin esperar la red", async () => {
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(true);
    await vi.waitFor(() => expect(h.abrir).toHaveBeenCalledTimes(1));
    expect(h.estado).not.toHaveBeenCalled();
    expect((h.abrir.mock.calls[0]?.[2] as { para: string }).para).toBe("entrada");
    expect(f.vaAAbrirseAlEntrar()).toBe(true);
  });

  it("con una lista lista, el final del paso sella", async () => {
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    h.nombres = ["Ana", "Beto"];
    const f = await flujo();
    await f.revisarCuentaOficial("entrada");
    await vi.waitFor(() => expect(h.abrir).toHaveBeenCalledTimes(1));
    const op = h.abrir.mock.calls[0]?.[2] as { para: string; alSeguir: unknown };
    expect(op.para).toBe("entrada-con-lista");
    expect(typeof op.alSeguir).toBe("function");
  });

  it("al retomar, nunca con la lista: el final solo cierra", async () => {
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    h.nombres = ["Ana", "Beto"];
    const f = await flujo();
    await f.revisarCuentaOficial("retomar");
    await vi.waitFor(() => expect(h.abrir).toHaveBeenCalledTimes(1));
    expect((h.abrir.mock.calls[0]?.[2] as { para: string }).para).toBe("entrada");
  });

  it("con la cuenta activada: revisa de fondo y abre solo si falta algo", async () => {
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(h.estado).toHaveBeenCalledTimes(1);
    h.estado.mockResolvedValue({ ...TODO, proteccion: "aparato-nuevo" });
    expect(await f.revisarCuentaOficial("entrada")).toBe(true);
    // Si no se pudo saber, no se abre: se mira al sellar.
    h.abrir.mockClear();
    h.estado.mockResolvedValue({ ...TODO, activacion: "no-se-sabe", proteccion: "no-se-sabe" });
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("no se abre solo con un sorteo sellado sin sortear, ni con la espera a la vista", async () => {
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    const f = await flujo();
    h.app.frozen = { round: 1 };
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    h.app.frozen = null;
    document.body.innerHTML = `<div class="espera"></div>`;
    expect(await f.revisarCuentaOficial("retomar")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });
});

describe("cuando el sello o el sorteo fallan por la cuenta", () => {
  it("protegerLaCuenta (proteger-flujo.ts) suelta la pantalla completa y abre el paso para el sello o el sorteo", async () => {
    h.soltar.mockReset();
    const { protegerLaCuenta } = await import("./proteger-flujo");
    expect(await protegerLaCuenta(null, "draw-status")).toBe(true);
    expect(h.soltar).toHaveBeenCalledTimes(1);
    expect((h.abrir.mock.calls[0]?.[2] as { para: string }).para).toBe("sorteo");
    expect(await protegerLaCuenta(null, "seal-status")).toBe(true);
    expect((h.abrir.mock.calls[1]?.[2] as { para: string }).para).toBe("sello");
  });

  it("protegerLaCuenta en Prueba no abre nada", async () => {
    h.red = "testnet";
    const { protegerLaCuenta } = await import("./proteger-flujo");
    expect(await protegerLaCuenta(null, "seal-status")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
  });

  it("abre el paso con el motivo y el botón a donde volver", async () => {
    const f = await flujo();
    const b = document.createElement("button");
    expect(await f.abrirParaElError("sorteo", b)).toBe(true);
    const op = h.abrir.mock.calls[0]?.[2] as { para: string; volverA: unknown };
    expect(op.para).toBe("sorteo");
    expect(op.volverA).toBe(b);
  });
});

describe("si el paso no se puede bajar", () => {
  const aviso = (): HTMLElement | null => document.querySelector(".cl-no-cargo");
  /** La descarga del paso falla, como en el wifi de un evento: el `import()` se rechaza. */
  const romperPaso = (): void => {
    vi.doMock("./cuenta-lista", () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
  };
  afterEach(() => {
    vi.doMock("./cuenta-lista", () => ({ abrirCuentaLista: (...a: unknown[]) => h.abrir(...a) }));
  });

  it("al sellar no sigue, pero lo dice con el aviso de volver a cargar la página", async () => {
    romperPaso();
    h.billetera = pollar({ activacion: "lista", proteccion: "no-se-sabe" });
    h.estado.mockResolvedValue({ ...TODO, proteccion: "falta" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = await flujo();
    const { t } = await import("../i18n");
    expect(await f.cuentaListaParaGrabar("sello")).toBe(false);
    expect(h.abrir).not.toHaveBeenCalled();
    const el = aviso();
    expect(el?.getAttribute("role")).toBe("alert");
    expect(el?.textContent).toContain(t("clNoCargo"));
    expect([...(el?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toContain(t("loginRecargar"));
  });

  it("al entrar, revisarCuentaOficial devuelve false (así la página anuncia la entrada) y deja el aviso", async () => {
    romperPaso();
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = await flujo();
    expect(await f.revisarCuentaOficial("entrada")).toBe(false);
    expect(aviso()).not.toBeNull();
  });

  it("al sortear, tampoco sigue en silencio", async () => {
    romperPaso();
    h.billetera = pollar({ activacion: "falta", proteccion: "no-se-sabe" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = await flujo();
    expect(await f.cuentaListaParaGrabar("sorteo")).toBe(false);
    expect(aviso()).not.toBeNull();
  });

  it("el botón vuelve a cargar la página, y «Cerrar» saca el aviso", async () => {
    const { avisarQueNoCargo } = await import("./aviso-no-cargo");
    const { t } = await import("../i18n");
    const recargar = vi.fn();
    avisarQueNoCargo(recargar);
    avisarQueNoCargo(recargar);
    expect(document.querySelectorAll(".cl-no-cargo")).toHaveLength(1);
    const botones = [...(aviso()?.querySelectorAll("button") ?? [])];
    botones.find((b) => b.textContent === t("loginRecargar"))?.click();
    expect(recargar).toHaveBeenCalledTimes(1);
    botones.find((b) => b.textContent === t("loginClose"))?.click();
    expect(aviso()).toBeNull();
  });
});

describe("el acceso al modo Oficial que recibe el paso (W3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sin el acceso por cupón en el build, cerrado: el paso no activa", async () => {
    vi.stubEnv("VITE_ALTA", "");
    vi.stubEnv("VITE_ALTA_LIBRE", "");
    const f = await flujo();
    await f.abrirParaElError("sello", null);
    expect((h.abrir.mock.calls[0]?.[2] as { acceso: unknown }).acceso).toBe("cerrado");
  });

  it("con el acceso por cupón y el portero en el build, el servidor; y «Usar un cupón» abre en el campo", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", "https://pm.prueba.invalid");
    const f = await flujo();
    await f.abrirParaElError("sello", null, { cupon: "escribir" });
    const op = h.abrir.mock.calls[0]?.[2] as { acceso: unknown; cupon: unknown };
    expect(typeof op.acceso).toBe("object");
    expect(Object.keys(op.acceso as object).sort()).toEqual(["canjear", "cuenta", "cuponGuardado", "estado", "guardarCupon", "olvidarCupon", "refrescarCupo"]);
    expect(op.cupon).toBe("escribir");
  });

  it("el plan B1 (VITE_ALTA_LIBRE=1): libre, como antes", async () => {
    vi.stubEnv("VITE_ALTA_LIBRE", "1");
    const f = await flujo();
    await f.abrirParaElError("sorteo", null);
    expect((h.abrir.mock.calls[0]?.[2] as { acceso: unknown }).acceso).toBe("libre");
  });
});
