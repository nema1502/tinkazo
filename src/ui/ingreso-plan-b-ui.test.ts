// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/**
 * El plan B del ingreso, en `wallet-ui.ts` y `wallet-pollar.ts` de verdad: el aviso de un ingreso que falló suma UNA
 * acción secundaria para seguir sin cuenta, y solo cuando la bandera está prendida, la red es Prueba y la falla no es de
 * la persona. Lo único simulado es el proveedor (`@pollar/core`): contesta con los códigos de error que define su paquete,
 * y el camino que recorren hasta la pantalla es el de verdad.
 *
 * - Apagada la bandera, nada cambia: ni el botón, ni los textos, ni el candado del botón de sellar.
 * - Prendida: cada tipo de falla del proveedor lo ofrece (con Google y con el correo, al pedir el código y al comprobarlo).
 * - Las fallas de la persona no lo ofrecen (ventana bloqueada, código equivocado o vencido, sesión vencida, sin internet).
 * - En Oficial nunca aparece.
 * - Elegirlo cierra el aviso, deja el botón de sellar como en el modo libre y pone una línea permanente para entrar después.
 * - Entrar con una cuenta, después, borra la elección.
 */

const TEST = "Test SDF Network ; September 2015";
const MAIN = "Public Global Stellar Network ; September 2015";
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

const h = vi.hoisted(() => ({
  red: "testnet" as "testnet" | "mainnet",
  /** Cómo contesta el proveedor al pedir el código: ok, silencio (no contesta) o el código de error de su paquete. */
  alEnviar: "ok",
  /** Cómo contesta al comprobar el código: ok, o el código de error de su paquete. */
  alVerificar: "ok",
  /** La entrada con Google: ok, sin-sesion (el proveedor no arma la entrada) o error:CODIGO (contesta con ese error). */
  google: "ok",
  paso: "idle",
  oyentes: new Set<(estado: unknown) => void>(),
  billetera: null as null | { address: string },
  config: null as null | { openAuthUrl?: (ctx: { getUrl: () => Promise<string | null> }) => unknown },
  logins: 0,
  activa: null as unknown,
  pasar: (..._a: unknown[]): void => undefined,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    anchoringAvailable: true,
    get network() {
      return { ...o.network, name: h.red, contractId: "CREAL", networkPassphrase: h.red === "mainnet" ? MAIN : TEST };
    },
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => ({
  ...(await orig<typeof import("../stellar/wallet-lite")>()),
  freighterInstalled: async () => false,
  guestStored: () => false,
  guestAvailable: () => false,
  setActiveWallet: (w: unknown) => void (h.activa = w),
  activeWallet: () => h.activa,
  xlmBalance: async () => 10,
}));
// El proveedor de cuentas: un cliente que anda por pasos, como el de Pollar, y contesta lo que diga `h`.
vi.mock("@pollar/core", () => {
  const emitir = (estado: { step: string; errorCode?: string }): void => {
    h.paso = estado.step;
    setTimeout(() => {
      for (const aviso of [...h.oyentes]) aviso(estado);
    }, 0);
  };
  class ClienteFalso {
    apiKeyHash = "huella";
    constructor(config: typeof h.config) {
      h.config = config;
    }
    getWallet(): { address: string } | null {
      return h.billetera;
    }
    getAuthState(): { step: string } {
      return { step: h.paso };
    }
    ready = async (): Promise<void> => undefined;
    onConfirmationRequest(): () => void {
      return () => undefined;
    }
    onAuthStateChange(aviso: (estado: unknown) => void): () => void {
      h.oyentes.add(aviso);
      // Como el SDK: al suscribirse repite el estado actual.
      aviso({ step: h.paso });
      return () => void h.oyentes.delete(aviso);
    }
    beginEmailLogin(): void {
      emitir({ step: "entering_email" });
    }
    sendEmailCode(): void {
      if (h.alEnviar === "silencio") return;
      emitir(h.alEnviar === "ok" ? { step: "entering_code" } : { step: "error", errorCode: h.alEnviar });
    }
    verifyEmailCode(): void {
      if (h.alVerificar === "ok") {
        h.billetera = { address: DIR };
        emitir({ step: "authenticated" });
      } else emitir({ step: "error", errorCode: h.alVerificar });
    }
    login(): void {
      h.logins++;
      if (h.google.startsWith("error:")) {
        emitir({ step: "error", errorCode: h.google.slice("error:".length) });
        return;
      }
      void Promise.resolve(h.config?.openAuthUrl?.({ getUrl: async () => (h.google === "sin-sesion" ? null : "https://pollar.invalid/entrar") })).then(() => {
        if (h.google === "ok") {
          h.billetera = { address: DIR };
          emitir({ step: "authenticated" });
        }
      });
    }
    cancelLogin(): void {
      h.paso = "idle";
    }
    logout = async (): Promise<void> => undefined;
    getUserProfile(): null {
      return null;
    }
  }
  return { PollarClient: ClienteFalso, isValidSession: () => false };
});
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./freeze", () => ({ refreshFreezeLabel: () => undefined }));
vi.mock("./anchor", () => ({ precalentarSello: () => undefined }));
vi.mock("./participants", () => ({ guardarBorrador: () => undefined }));
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => false }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, marcarEntrada: () => undefined, tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: (...a: unknown[]) => h.pasar(...a), abrirHojaDeModo: () => undefined }));

type Ui = typeof import("./wallet-ui");

/** Lo que hay en la página, para que una falla diga qué se veía. */
const volcado = (): string => document.body.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, 1800);

/** El botón de seguir sin cuenta: el mismo en el aviso flotante y en la ventana de ingreso. */
const salida = (de: ParentNode = document): HTMLButtonElement[] => [...de.querySelectorAll<HTMLButtonElement>('button[data-salida="sin-cuenta"]')];
const aviso = (): HTMLElement | null => document.querySelector(".wallet-notice.bad");
const esperar = { timeout: 5000 };

/** Una ventana que se puede abrir y cerrar, y no es ninguna: para la entrada con Google. */
const ventanaFalsa = (): unknown => ({ closed: false, close: () => undefined, location: { href: "" }, opener: null });

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_de_ejemplo");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_de_ejemplo");
  h.red = "testnet";
  h.alEnviar = "ok";
  h.alVerificar = "ok";
  h.google = "ok";
  h.paso = "idle";
  h.oyentes.clear();
  h.billetera = null;
  h.config = null;
  h.logins = 0;
  h.activa = null;
  h.pasar = () => undefined;
  localStorage.clear();
  sessionStorage.clear();
  // La propia página contesta: hay internet. Cada prueba que lo necesite lo cambia.
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  vi.stubGlobal("open", () => ventanaFalsa());
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<header></header><div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function cargar(): Promise<{ ui: Ui; t: (k: string) => string }> {
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

/** Abre la ventana de ingreso y manda el correo, para ver qué pasa cuando pedir el código falla. */
async function pedirCodigo(ui: Ui): Promise<HTMLElement> {
  await ui.openPicker();
  expect(document.querySelector("#login-mail"), volcado()).not.toBeNull();
  const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
  mail.value = "ana@example.org";
  mail.dispatchEvent(new Event("input", { bubbles: true }));
  (mail.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
  return (mail.closest("form") as HTMLFormElement).querySelector(".login-err") as HTMLElement;
}

/** Sigue hasta el segundo paso, el del código, y lo manda. */
async function mandarCodigo(): Promise<HTMLElement> {
  await vi.waitFor(() => expect(document.querySelector("#login-code"), volcado()).not.toBeNull(), esperar);
  const codigo = document.querySelector<HTMLInputElement>("#login-code") as HTMLInputElement;
  codigo.value = "123456";
  codigo.dispatchEvent(new Event("input", { bubbles: true }));
  const form = codigo.closest("form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  return form.querySelector(".login-err") as HTMLElement;
}

const esperarError = async (err: HTMLElement): Promise<void> => vi.waitFor(() => expect(err.hidden, volcado()).toBe(false), esperar);

/** Espera a que la salida aparezca: se suma cuando contesta el chequeo de internet, un rato después del error. */
const esperarSalida = async (): Promise<void> => vi.waitFor(() => expect(salida(), volcado()).toHaveLength(1), esperar);

/** Deja pasar un rato de verdad, para afirmar que algo NO se suma: lo que tenía que pasar ya pasó. */
const asentar = (ms = 40): Promise<void> => new Promise((listo) => setTimeout(listo, ms));

/** Un chequeo de internet que contesta cuando la prueba lo decide: así se ve qué hay en pantalla mientras tanto. */
function internetManual(): { pedidos: () => number; contestar: (cual?: number) => void } {
  const respuestas: Array<() => void> = [];
  vi.stubGlobal("fetch", () => new Promise<Response>((ok) => respuestas.push(() => ok(new Response(null, { status: 200 })))));
  return { pedidos: () => respuestas.length, contestar: (cual = 0) => respuestas[cual]?.() };
}

/** Anota cada lectura, escritura y borrado del almacenamiento de la pestaña y de la página, sin cambiar lo que hacen. Devuelve cómo deshacerlo. */
function espiarAlmacenamiento(llamadas: string[]): () => void {
  const proto = Storage.prototype as unknown as Record<"getItem" | "setItem" | "removeItem", (...a: unknown[]) => unknown>;
  const originales = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
  for (const metodo of ["getItem", "setItem", "removeItem"] as const) {
    proto[metodo] = function (this: Storage, ...a: unknown[]): unknown {
      llamadas.push(`${metodo}:${String(a[0])}`);
      return originales[metodo].apply(this, a);
    };
  }
  return () => void Object.assign(proto, originales);
}

describe("el entorno de estas pruebas", () => {
  it("el proveedor de mentira es el que usa la billetera de verdad", async () => {
    const { pollarConfigured, pollarWallet } = await import("../stellar/wallet-pollar");
    expect(pollarConfigured()).toBe(true);
    h.alEnviar = "SESSION_CREATE_FAILED";
    await expect(pollarWallet.sendEmailCode("ana@example.org")).rejects.toThrow("SESSION_CREATE_FAILED");
  });
  it("la página que contesta o no contesta decide si hay internet", async () => {
    const { hayInternet } = await import("./ingreso-plan-b");
    expect(await hayInternet()).toBe(true);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await hayInternet()).toBe(false);
  });
});

describe("con la bandera apagada, nada cambia", () => {
  it("un ingreso con Google que falla muestra el aviso de siempre, sin la salida", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    await asentar();
    expect(h.logins, volcado()).toBe(1);
    expect(aviso()?.textContent, volcado()).toContain(t("cuentaSinSesion"));
    expect(aviso()?.textContent).not.toContain(t("ingresoCaidoTitulo"));
    expect(salida(), volcado()).toHaveLength(0);
  });
  it("un correo que no se pudo mandar muestra el error de siempre, sin la salida", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const { ui, t } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await asentar();
    expect(err.textContent).toBe(t("loginSendFailed"));
    expect(salida(), volcado()).toHaveLength(0);
  });
  it("ni se pide la página para comprobar internet", async () => {
    const pedidos = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", pedidos);
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await asentar();
    expect(pedidos).not.toHaveBeenCalled();
  });
  it("sin cuenta, el botón de sellar sigue pidiendo entrar", async () => {
    const { ui } = await cargar();
    expect(ui.claveDeSellar()).toBe("sigEntrarSellar");
    expect(document.getElementById("btn-freeze")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById("sin-cuenta-franja")).toBeNull();
  });
  it("entrar con una cuenta no toca el almacenamiento de la pestaña por la elección de seguir sin cuenta", async () => {
    const llamadas: string[] = [];
    const deshacer = espiarAlmacenamiento(llamadas);
    try {
      const { ui } = await cargar();
      await ui.entrar();
      await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
      await asentar();
      expect(llamadas.filter((l) => l.endsWith(":tinkazo.sin-cuenta")), llamadas.join(" ")).toEqual([]);
    } finally {
      deshacer();
    }
  });
});

describe("con la bandera prendida, en Prueba, una falla del proveedor ofrece seguir sin cuenta", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("Google: el proveedor no arma la entrada", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    expect(h.logins, volcado()).toBe(1);
    await esperarSalida();
    expect(aviso()?.textContent, volcado()).toContain(t("ingresoCaidoTitulo"));
    expect(aviso()?.textContent).toContain(t("ingresoCaidoLinea"));
    expect(salida()[0]?.textContent).toBe(t("sinCuentaBoton"));
    // La salida es una más: reintentar (Otra forma de entrar) y cerrar siguen ahí, en ese orden.
    const botones = [...(aviso()?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(botones).toEqual([t("loginOtraVia"), t("sinCuentaBoton"), t("loginClose")]);
  });

  it.each([
    ["no pudo crear la sesión", "SESSION_CREATE_FAILED"],
    ["no dejó crear la cuenta", "WALLET_CONNECT_FAILED"],
    ["falló sin decir por qué", "UNEXPECTED_ERROR"],
  ])("Google: el proveedor contesta con un error, y se dice enseguida, con el título que lo señala: %s", async (_que, codigo) => {
    h.google = `error:${codigo}`;
    const { ui, t } = await cargar();
    await ui.entrar();
    expect(h.logins, volcado()).toBe(1);
    await esperarSalida();
    expect(aviso()?.textContent, volcado()).toContain(t("ingresoCaidoTitulo"));
    expect(aviso()?.textContent).not.toContain(t("ingresoPlazoTitulo"));
  });

  it("Google: el plazo venció sin que nada contestara. La salida está, y el aviso no culpa al proveedor", async () => {
    h.google = "error:LOGIN_TIMEOUT";
    const { ui, t } = await cargar();
    await ui.entrar();
    await esperarSalida();
    expect(aviso()?.textContent, volcado()).toContain(t("ingresoPlazoTitulo"));
    expect(aviso()?.textContent).not.toContain(t("ingresoCaidoTitulo"));
    // La línea de abajo queda igual.
    expect(aviso()?.textContent).toContain(t("ingresoCaidoLinea"));
  });

  it.each([
    ["no pudo crear la sesión", "SESSION_CREATE_FAILED"],
    ["no pudo mandar el código", "EMAIL_SEND_FAILED"],
    ["falló sin decir por qué", "UNEXPECTED_ERROR"],
  ])("correo, al pedir el código: %s", async (_que, codigo) => {
    h.alEnviar = codigo;
    const { ui, t } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await esperarSalida();
    expect(err.textContent, volcado()).toContain(t("ingresoCaidoTitulo"));
    expect(err.textContent).toContain(t("ingresoCaidoLinea"));
    // El botón principal sigue ahí, listo para reintentar.
    expect(document.querySelector<HTMLButtonElement>(".login-go")?.disabled).toBe(false);
  });

  it("correo, al pedir el código: el proveedor no contesta en el tiempo que corresponde. Título neutro", async () => {
    h.alEnviar = "silencio";
    const { ui, t } = await cargar();
    await ui.openPicker();
    // Los módulos se cargan antes de parar el reloj: bajarlos no depende de él.
    await import("@pollar/core");
    vi.useFakeTimers();
    const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
    mail.value = "ana@example.org";
    mail.dispatchEvent(new Event("input", { bubbles: true }));
    const form = mail.closest("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.advanceTimersByTimeAsync(31_000);
    const err = form.querySelector(".login-err") as HTMLElement;
    await esperarError(err);
    await vi.advanceTimersByTimeAsync(100);
    expect(salida(), volcado()).toHaveLength(1);
    expect(err.textContent).toContain(t("ingresoPlazoTitulo"));
    expect(err.textContent).not.toContain(t("ingresoCaidoTitulo"));
  });

  it.each([
    ["no pudo comprobar el código", "EMAIL_VERIFY_FAILED"],
    ["no dejó crear la cuenta", "WALLET_CONNECT_FAILED"],
    ["no autenticó", "AUTH_FAILED"],
  ])("correo, al comprobar el código: %s", async (_que, codigo) => {
    h.alVerificar = codigo;
    const { ui, t } = await cargar();
    await pedirCodigo(ui);
    const err = await mandarCodigo();
    await esperarError(err);
    await esperarSalida();
    expect(err.textContent, volcado()).toContain(t("ingresoCaidoTitulo"));
  });

  it("correo, al mandar otro código: también", async () => {
    const { ui, t } = await cargar();
    await pedirCodigo(ui);
    await vi.waitFor(() => expect(document.querySelector("#login-code"), volcado()).not.toBeNull(), esperar);
    h.alEnviar = "EMAIL_SEND_FAILED";
    (document.querySelectorAll<HTMLButtonElement>(".login-link")[0] as HTMLButtonElement).click();
    const err = document.querySelector(".login-err") as HTMLElement;
    await esperarError(err);
    await esperarSalida();
    expect(err.textContent, volcado()).toContain(t("ingresoCaidoTitulo"));
  });

  it("escribir de nuevo saca el aviso con su salida", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await esperarSalida();
    const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
    mail.value = "beto@example.org";
    mail.dispatchEvent(new Event("input", { bubbles: true }));
    expect(err.hidden).toBe(true);
    expect(salida(), volcado()).toHaveLength(0);
  });
});

describe("el error llega primero y la salida se suma cuando contesta el chequeo de internet", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("correo: el error de siempre se pinta al instante, sin esperar el chequeo", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const internet = internetManual();
    const { ui, t } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    // El chequeo todavía no contestó: está el error de siempre y nada más.
    expect(err.textContent).toBe(t("loginSendFailed"));
    expect(salida(), volcado()).toHaveLength(0);
    internet.contestar();
    await esperarSalida();
    expect(err.textContent).toContain(t("ingresoCaidoTitulo"));
  });

  it("correo: si mientras tanto la persona cambió el campo, no se suma nada", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const internet = internetManual();
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
    mail.value = "beto@example.org";
    mail.dispatchEvent(new Event("input", { bubbles: true }));
    internet.contestar();
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
    expect(err.hidden).toBe(true);
  });

  it("correo: si mientras tanto la persona volvió a mandar, la salida del primer error no se suma al segundo", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const internet = internetManual();
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    // Vuelve a mandar: sale otro error, con su propio chequeo.
    (document.querySelector("#login-mail")?.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(internet.pedidos()).toBe(2), esperar);
    internet.contestar(0);
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
    internet.contestar(1);
    await esperarSalida();
  });

  it("Google: primero el aviso de siempre, después se le suma la salida", async () => {
    h.google = "sin-sesion";
    const internet = internetManual();
    const { ui, t } = await cargar();
    await ui.entrar();
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    expect(aviso()?.textContent, volcado()).toContain(t("cuentaSinSesion"));
    expect(salida(), volcado()).toHaveLength(0);
    internet.contestar();
    await esperarSalida();
    expect(aviso()?.textContent).toContain(t("ingresoCaidoTitulo"));
    expect(aviso()?.textContent).not.toContain(t("cuentaSinSesion"));
  });

  it("Google: si la persona cerró el aviso mientras tanto, no se suma nada", async () => {
    h.google = "sin-sesion";
    const internet = internetManual();
    const { ui, t } = await cargar();
    await ui.entrar();
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    const cerrar = [...(aviso()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === t("loginClose"));
    cerrar?.click();
    expect(aviso()).toBeNull();
    internet.contestar();
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
    expect(aviso()).toBeNull();
  });
});

describe("con la bandera prendida, una falla de la persona no la ofrece", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("Google: el navegador bloqueó la ventana", async () => {
    vi.stubGlobal("open", () => null);
    const { ui, t } = await cargar();
    await ui.entrar();
    await asentar();
    expect(aviso()?.textContent, volcado()).toContain(t("cuentaBloqueada"));
    expect(salida(), volcado()).toHaveLength(0);
  });

  it.each([
    ["el código estaba mal", "EMAIL_CODE_INVALID"],
    ["el código venció", "EMAIL_CODE_EXPIRED"],
    ["la sesión venció mientras escribía", "SESSION_EXPIRED"],
  ])("correo, al comprobar el código: %s", async (_que, codigo) => {
    h.alVerificar = codigo;
    const { ui } = await cargar();
    await pedirCodigo(ui);
    const err = await mandarCodigo();
    await esperarError(err);
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
  });

  it("no tener internet: la propia página no contesta, aunque el navegador diga que sí", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    expect(h.logins, volcado()).toBe(1);
    await asentar();
    expect(aviso(), volcado()).not.toBeNull();
    expect(salida(), volcado()).toHaveLength(0);
    // Y con el correo, lo mismo.
    h.alEnviar = "SESSION_CREATE_FAILED";
    document.querySelector(".wallet-notice")?.remove();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
  });

  it("no tener internet: el navegador dice que está sin conexión", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      h.google = "sin-sesion";
      const { ui } = await cargar();
      await ui.entrar();
      await asentar();
      expect(salida(), volcado()).toHaveLength(0);
    } finally {
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    }
  });
});

describe("en Oficial, nunca", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
    h.red = "mainnet";
  });

  it("un ingreso con Google que falla por el proveedor no la ofrece", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    expect(h.logins, volcado()).toBe(1);
    await asentar();
    expect(aviso(), volcado()).not.toBeNull();
    expect(salida(), volcado()).toHaveLength(0);
  });
  it("un correo que falla por el proveedor no la ofrece", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
  });
  it("sin cuenta, el botón de sellar sigue pidiendo entrar, también con la marca de una pestaña en Prueba", async () => {
    sessionStorage.setItem("tinkazo.sin-cuenta", "1");
    const { ui } = await cargar();
    expect(ui.claveDeSellar()).toBe("sigEntrarSellar");
    expect(document.getElementById("sin-cuenta-franja")).toBeNull();
  });
});

describe("elegir seguir sin cuenta", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("desde el aviso de Google: cierra el aviso, deja sellar sin entrar y pone la línea para entrar después", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    await esperarSalida();
    expect(ui.claveDeSellar()).toBe("sigEntrarSellar");
    (salida()[0] as HTMLButtonElement).click();
    expect(aviso()).toBeNull();
    expect(ui.claveDeSellar()).toBe("freeze");
    expect(document.getElementById("btn-freeze")?.getAttribute("aria-disabled")).toBeNull();
    const franja = document.getElementById("sin-cuenta-franja");
    expect(franja?.textContent).toContain(t("sinCuentaLinea"));
    expect(franja?.querySelector("button")?.textContent).toBe(t("sinCuentaEntrar"));
    expect(ui.currentSession()).toBeNull();
  });

  it("desde el correo: cierra la ventana de ingreso", async () => {
    h.alEnviar = "EMAIL_SEND_FAILED";
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await esperarSalida();
    (salida()[0] as HTMLButtonElement).click();
    // La ventana sale con su animación corta (~150 ms, estilos-atencion.ts) y el nodo se quita después.
    await vi.waitFor(() => expect(document.querySelector(".modal-card.login")).toBeNull(), esperar);
    expect(ui.claveDeSellar()).toBe("freeze");
    expect(document.getElementById("sin-cuenta-franja")).not.toBeNull();
  });

  it("ya sin cuenta, un ingreso que vuelve a fallar no ofrece la salida otra vez", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    await esperarSalida();
    (salida()[0] as HTMLButtonElement).click();
    await ui.entrar();
    await asentar();
    expect(aviso()?.textContent, volcado()).toContain(t("cuentaSinSesion"));
    expect(salida(), volcado()).toHaveLength(0);
    expect(ui.claveDeSellar()).toBe("freeze");
  });

  it("la franja es una sola y se traduce con el idioma", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await esperarSalida();
    (salida()[0] as HTMLButtonElement).click();
    expect(document.querySelectorAll("#sin-cuenta-franja")).toHaveLength(1);
    const { setLang, T } = await import("../i18n");
    setLang("en");
    expect(document.getElementById("sin-cuenta-franja")?.textContent).toContain(String(T.en.sinCuentaLinea));
    setLang("es");
    expect(document.getElementById("sin-cuenta-franja")?.textContent).toContain(String(T.es.sinCuentaLinea));
  });

  it("la franja se anuncia una sola vez, al elegir: los repintados no la repiten", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    await esperarSalida();
    let cambios = 0;
    const mo = new MutationObserver((lista) => void (cambios += lista.length));
    mo.observe(document.getElementById("cuenta-aviso") as HTMLElement, { childList: true, characterData: true, subtree: true });
    (salida()[0] as HTMLButtonElement).click();
    cambios += mo.takeRecords().length;
    expect(document.getElementById("cuenta-aviso")?.textContent).toBe(t("sinCuentaLinea"));
    expect(cambios).toBe(1);
    // Cambiar de idioma y de lugar vuelve a pintar la página: la región viva no se toca.
    const { setLang } = await import("../i18n");
    setLang("en");
    setLang("es");
    cambios += mo.takeRecords().length;
    mo.disconnect();
    expect(cambios).toBe(1);
    expect(document.getElementById("sin-cuenta-franja")?.getAttribute("role")).toBeNull();
  });

  it("la franja ofrece entrar: abre la ventana de ingreso, y la elección sigue hasta que entre una cuenta", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await esperarSalida();
    (salida()[0] as HTMLButtonElement).click();
    (document.querySelector("#sin-cuenta-franja button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector(".modal-card.login"), volcado()).not.toBeNull(), esperar);
    expect(ui.claveDeSellar()).toBe("freeze");
  });

  it("entrar con una cuenta después borra la elección y la línea", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await esperarSalida();
    (salida()[0] as HTMLButtonElement).click();
    expect(document.getElementById("sin-cuenta-franja")).not.toBeNull();
    h.google = "ok";
    await ui.entrar();
    expect(h.logins, volcado()).toBe(2);
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    expect(document.getElementById("sin-cuenta-franja")).toBeNull();
    expect(sessionStorage.getItem("tinkazo.sin-cuenta")).toBeNull();
  });

  it("recargar la pestaña conserva la elección: el botón de sellar no pide entrar y la línea sigue", async () => {
    sessionStorage.setItem("tinkazo.sin-cuenta", "1");
    const { ui } = await cargar();
    expect(ui.claveDeSellar()).toBe("freeze");
    expect(document.getElementById("sin-cuenta-franja")).not.toBeNull();
  });
});

describe("un aviso viejo con la salida, después de entrar con una cuenta por otro lado", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
    // Con la entrada anunciada en la página, el aviso de "Entraste" no tapa al viejo: es el caso que hay que cuidar.
    document.body.insertAdjacentHTML("beforeend", '<p id="ya-entraste"></p>');
  });

  it("el aviso de Google se va al entrar, y su botón, si alguien lo toca, no hace nada", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await esperarSalida();
    const viejo = salida()[0] as HTMLButtonElement;
    h.google = "ok";
    await ui.entrar();
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    expect(aviso(), volcado()).toBeNull();
    expect(salida(), volcado()).toHaveLength(0);
    viejo.click();
    expect(document.getElementById("sin-cuenta-franja")).toBeNull();
    expect(sessionStorage.getItem("tinkazo.sin-cuenta")).toBeNull();
    expect(ui.currentSession()?.address).toBe(DIR);
  });

  it("el error del correo con su salida se va al entrar, y no queda un error colgado", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const { ui } = await cargar();
    const err = await pedirCodigo(ui);
    await esperarError(err);
    await esperarSalida();
    const viejo = salida()[0] as HTMLButtonElement;
    h.google = "ok";
    await ui.entrar();
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    expect(salida(), volcado()).toHaveLength(0);
    expect(err.hidden).toBe(true);
    viejo.click();
    expect(document.getElementById("sin-cuenta-franja")).toBeNull();
    expect(sessionStorage.getItem("tinkazo.sin-cuenta")).toBeNull();
  });

  it("un aviso que todavía espera el chequeo de internet tampoco suma la salida si entró una cuenta", async () => {
    h.google = "sin-sesion";
    const internet = internetManual();
    const { ui } = await cargar();
    await ui.entrar();
    await vi.waitFor(() => expect(internet.pedidos()).toBe(1), esperar);
    h.google = "ok";
    await ui.entrar();
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    internet.contestar();
    await asentar();
    expect(salida(), volcado()).toHaveLength(0);
  });
});
