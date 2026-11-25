// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ventana de entrar, en `wallet-ui.ts` de verdad: Entrar con Google es el único botón principal, a la vista y con el
 * foco, y las demás formas de entrar (el correo, la billetera y la cuenta de prueba) esperan plegadas detrás de un solo
 * renglón, Otras formas de entrar. Lo simulado es el proveedor de cuentas (`@pollar/core`), Varial y el cambio de modo.
 *
 * - Con la llave del proveedor: Google solo a la vista, lo demás plegado y cerrado.
 * - Sin la llave: como antes, todo a la vista.
 * - Con una billetera recordada, su forma queda a la vista.
 * - Abrir el pliegue muestra las mismas opciones de antes.
 * - El renglón es un botón con aria-expanded, y el foco va de Google al renglón y a lo de adentro.
 * - Cuando el ingreso falla, o cuando se pide, el pliegue abre desplegado.
 * - Desde el navegador de una app, la ventana queda como antes.
 */

const TEST = "Test SDF Network ; September 2015";
const MAIN = "Public Global Stellar Network ; September 2015";

const h = vi.hoisted(() => ({
  red: "testnet" as "testnet" | "mainnet",
  /** La entrada con Google: ok o sin-sesion (el proveedor no arma la entrada). */
  google: "ok",
  paso: "idle",
  oyentes: new Set<(estado: unknown) => void>(),
  config: null as null | { openAuthUrl?: (ctx: { getUrl: () => Promise<string | null> }) => unknown },
  activa: null as unknown,
  /** Varial instalada, y si ya le dio permiso al sitio. */
  freighter: false,
  permiso: false,
  /** Una cuenta de prueba guardada en este navegador. */
  guardada: false,
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
  freighterInstalled: async () => h.freighter,
  freighterAllowed: async () => h.permiso,
  guestStored: () => h.guardada,
  guestAvailable: () => h.red === "testnet",
  setActiveWallet: (w: unknown) => void (h.activa = w),
  activeWallet: () => h.activa,
  xlmBalance: async () => 10,
}));
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
    getWallet(): null {
      return null;
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
      aviso({ step: h.paso });
      return () => void h.oyentes.delete(aviso);
    }
    beginEmailLogin(): void {
      emitir({ step: "entering_email" });
    }
    sendEmailCode(): void {
      emitir({ step: "entering_code" });
    }
    verifyEmailCode(): void {
      emitir({ step: "error", errorCode: "EMAIL_CODE_INVALID" });
    }
    login(): void {
      const getUrl = async (): Promise<string | null> => (h.google === "sin-sesion" ? null : "https://pollar.invalid/entrar");
      void Promise.resolve(h.config?.openAuthUrl?.({ getUrl }));
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
vi.mock("../contar", () => ({ contarEntrada: () => undefined, contarUnaVez: () => undefined, origenActual: () => "home", marcarEntrada: () => undefined, tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({
  pasarAModo: () => true,
  abrirHojaDeModo: () => undefined,
  puedeCambiarDeModo: () => true,
  practicarEnPrueba: () => true,
}));

type Ui = typeof import("./wallet-ui");

/** Lo que hay en la página, para que una falla diga qué se veía. */
const volcado = (): string => document.body.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, 2400);
const esperar = { timeout: 5000 };
const ventanaFalsa = (): unknown => ({ closed: false, close: () => undefined, location: { href: "" }, opener: null });
const UA_DE_SIEMPRE = navigator.userAgent;

/** Si algo se ve: ni él ni nada de lo que lo contiene lleva `hidden` ni es un details cerrado. */
const seVe = (el: Element): boolean => !el.closest("[hidden]") && !el.closest("details:not([open]) > :not(summary)");
const renglon = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(".login-otras");
const lista = (): HTMLElement | null => document.getElementById("login-otras-lista");
/** Las formas de entrar a la vista: los botones de las opciones y el campo del correo. */
const formasALaVista = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".login-body .login-opt, .login-body #login-mail")]
    .filter(seVe)
    .map((el) => (el.id === "login-mail" ? "correo" : (el.querySelector("span")?.textContent ?? "")));
/** Lo que puede recibir el foco dentro de la ventana, en el orden del documento, solo lo que se ve. */
const ENFOCABLE = ".login-body a[href], .login-body button:not([disabled]), .login-body input, .login-body summary";
const enfocables = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(ENFOCABLE)].filter(seVe);

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_de_ejemplo");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_de_ejemplo");
  h.red = "testnet";
  h.google = "ok";
  h.paso = "idle";
  h.oyentes.clear();
  h.config = null;
  h.activa = null;
  h.freighter = false;
  h.permiso = false;
  h.guardada = false;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  vi.stubGlobal("open", () => ventanaFalsa());
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<header></header><div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div>' +
    '<button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(navigator, "userAgent", { value: UA_DE_SIEMPRE, configurable: true });
});

async function abrir(pedido?: Parameters<Ui["openPicker"]>[0]): Promise<{ ui: Ui; t: (k: string) => string }> {
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  // La capa liviana de la billetera ya bajada, como en la página (que la prepara con la página quieta): así la pregunta a
  // Varial no compite con la descarga del módulo.
  await import("../stellar/wallet-lite");
  await ui.openPicker(pedido);
  expect(document.querySelector(".modal-card.login"), volcado()).not.toBeNull();
  return { ui, t };
}

describe("con la llave del proveedor de cuentas", () => {
  it("Entrar con Google es la única forma de entrar a la vista", async () => {
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle")]);
  });

  it("Google tiene el foco al abrir", async () => {
    await abrir();
    expect(document.activeElement?.classList.contains("login-google"), volcado()).toBe(true);
  });

  it("lo demás espera detrás de un solo renglón, Otras formas de entrar, cerrado", async () => {
    const { t } = await abrir();
    expect(document.querySelectorAll(".login-otras")).toHaveLength(1);
    expect(renglon()?.textContent).toBe(t("loginOtras"));
    expect(renglon()?.getAttribute("aria-expanded")).toBe("false");
    expect(lista()?.hidden).toBe(true);
    // El correo y la cuenta de prueba están, plegados: no se sacó ninguna forma de entrar.
    expect(lista()?.querySelector("#login-mail")).not.toBeNull();
    expect(lista()?.textContent).toContain(t("guestWallet"));
    expect(document.querySelector(".login-mas"), volcado()).toBeNull();
  });

  it("vale también en Oficial", async () => {
    h.red = "mainnet";
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle")]);
    expect(renglon()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("en Oficial, Practicar sin cuenta va debajo del renglón", async () => {
    h.red = "mainnet";
    await abrir();
    const cuerpo = document.querySelector(".login-body") as HTMLElement;
    const hijos = [...cuerpo.children];
    const practicar = hijos.indexOf(document.querySelector(".login-practicar") as Element);
    expect(practicar, volcado()).toBeGreaterThan(hijos.indexOf(lista() as Element));
  });
});

describe("abrir el pliegue", () => {
  it("muestra las mismas formas de entrar de antes: el correo, la billetera y la cuenta de prueba", async () => {
    const { t } = await abrir();
    renglon()?.click();
    expect(renglon()?.getAttribute("aria-expanded")).toBe("true");
    expect(lista()?.hidden).toBe(false);
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle"), "correo", t("loginWallet"), t("guestWallet")]);
  });

  it("tocarlo otra vez lo vuelve a cerrar", async () => {
    await abrir();
    renglon()?.click();
    renglon()?.click();
    expect(renglon()?.getAttribute("aria-expanded")).toBe("false");
    expect(lista()?.hidden).toBe(true);
  });

  it("la cuenta de prueba de adentro entra como siempre", async () => {
    const { t } = await abrir();
    renglon()?.click();
    const opciones = [...(lista()?.querySelectorAll<HTMLButtonElement>(".login-opt") ?? [])];
    const prueba = opciones.find((b) => b.textContent?.includes(t("guestWallet")));
    expect(prueba?.tagName, volcado()).toBe("BUTTON");
    expect(prueba?.type).toBe("button");
  });
});

describe("lector de pantalla y teclado", () => {
  it("el renglón es un botón con aria-expanded que dice qué despliega", async () => {
    await abrir();
    const b = renglon();
    expect(b?.tagName).toBe("BUTTON");
    expect(b?.type).toBe("button");
    expect(b?.getAttribute("aria-controls")).toBe("login-otras-lista");
    expect(lista()).not.toBeNull();
  });

  it("cerrado, el foco va de Google al renglón y nada de lo plegado lo recibe", async () => {
    await abrir();
    expect(enfocables().map((el) => el.className), volcado()).toEqual(["login-opt login-google", "login-otras"]);
  });

  it("abierto, el foco va de Google al renglón y después a lo de adentro", async () => {
    await abrir();
    renglon()?.click();
    const orden = enfocables();
    expect(orden[0]?.classList.contains("login-google"), volcado()).toBe(true);
    expect(orden[1]).toBe(renglon());
    expect(orden.slice(2).every((el) => lista()?.contains(el)), volcado()).toBe(true);
    expect(orden.length).toBeGreaterThan(2);
  });

  it("Tab desde el renglón cerrado, el último que se ve, vuelve al primero sin pasar por lo plegado", async () => {
    await abrir();
    // Sin el pie, lo último que se ve en la ventana es el renglón: lo de adentro está plegado.
    document.querySelector(".login-foot")?.remove();
    renglon()?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement, volcado()).toBe(document.querySelector(".login-x"));
  });
});

describe("sin la llave del proveedor de cuentas", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "");
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "");
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "");
  });

  it("no hay Google ni renglón: las formas que quedan van a la vista, como antes", async () => {
    const { t } = await abrir();
    expect(document.querySelector(".login-google")).toBeNull();
    expect(renglon(), volcado()).toBeNull();
    expect(formasALaVista()).toEqual([t("loginWallet"), t("guestWallet")]);
  });
});

describe("lo que este navegador ya usa queda a la vista", () => {
  it("una cuenta de prueba guardada", async () => {
    h.guardada = true;
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle"), t("guestWallet")]);
    // Lo demás sigue plegado.
    expect(lista()?.querySelector("#login-mail")).not.toBeNull();
  });

  it("Varial, si ya le dio permiso al sitio", async () => {
    h.freighter = true;
    h.permiso = true;
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle"), t("loginWallet")]);
  });

  it("el correo, si la marca del proveedor dice que se entró con correo", async () => {
    localStorage.setItem("tinkazo.pollar.intent.testnet", "email");
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle"), "correo"]);
  });

  it("Varial instalada pero sin permiso ni sesión sigue plegada", async () => {
    h.freighter = true;
    const { t } = await abrir();
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle")]);
  });
});

describe("cuando se pide o el ingreso falla, el pliegue abre desplegado", () => {
  it("abierta con otras: las formas de entrar a la vista desde el principio, y Google con el foco", async () => {
    const { t } = await abrir({ otras: true });
    expect(renglon()?.getAttribute("aria-expanded")).toBe("true");
    expect(formasALaVista(), volcado()).toEqual([t("loginGoogle"), "correo", t("loginWallet"), t("guestWallet")]);
    expect(document.activeElement?.classList.contains("login-google")).toBe(true);
  });

  it("Google falla con la ventana abierta: el aviso queda debajo de Google y el pliegue se abre", async () => {
    h.google = "sin-sesion";
    await abrir();
    document.querySelector<HTMLButtonElement>(".login-google")?.click();
    const avisoEnLaVentana = (): Element | null => document.querySelector(".modal-card.login .wallet-notice.bad");
    await vi.waitFor(() => expect(avisoEnLaVentana(), volcado()).not.toBeNull(), esperar);
    expect(renglon()?.getAttribute("aria-expanded")).toBe("true");
    expect(lista()?.hidden).toBe(false);
  });

  it("volver a escribir el correo desde el paso del código lo deja a la vista", async () => {
    await abrir();
    renglon()?.click();
    const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
    mail.value = "ana@example.org";
    mail.dispatchEvent(new Event("input", { bubbles: true }));
    (mail.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector("#login-code"), volcado()).not.toBeNull(), esperar);
    // El segundo enlace del paso del código: Usar otro correo.
    (document.querySelectorAll<HTMLButtonElement>(".login-links .login-link")[1] as HTMLButtonElement).click();
    const otra = document.querySelector<HTMLInputElement>("#login-mail");
    expect(otra && seVe(otra), volcado()).toBe(true);
    expect(otra?.value).toBe("ana@example.org");
  });
});

describe("desde el navegador de una app", () => {
  it("queda como antes: el aviso, el correo primero y la billetera en Más formas de entrar", async () => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone) Instagram 300.0", configurable: true });
    await abrir();
    expect(renglon(), volcado()).toBeNull();
    expect(document.querySelector(".login-app")).not.toBeNull();
    expect(document.querySelector(".login-mas")).not.toBeNull();
    const mail = document.querySelector("#login-mail");
    expect(mail && seVe(mail)).toBe(true);
  });
});
