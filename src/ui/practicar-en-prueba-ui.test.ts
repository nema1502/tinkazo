// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Practicar en Prueba, de un toque, en `wallet-ui.ts` de verdad. Lo simulado es el proveedor de cuentas (`@pollar/core`),
 * la cuenta de prueba (`../stellar/wallet`, que pide fondos a la red) y el cambio de modo (`./modo-ui`, que recarga).
 *
 * - La marca que deja Practicar en Prueba se consume una sola vez al cargar y entra con la cuenta de prueba, sin ventana.
 * - Sin la marca no pasa nada.
 * - La ventana de entrar ofrece Practicar sin cuenta solo en Oficial, fuera de la demo y con el cambio de modo abierto.
 * - En Oficial, un ingreso que falla por el proveedor ofrece Practicar en Prueba. Uno que falla por la persona, no.
 * - Desde el navegador de una app, junto al aviso, un botón copia el enlace de la página.
 */

const TEST = "Test SDF Network ; September 2015";
const MAIN = "Public Global Stellar Network ; September 2015";
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

const h = vi.hoisted(() => ({
  red: "testnet" as "testnet" | "mainnet",
  /** Cómo contesta el proveedor al pedir el código: ok o el código de error de su paquete. */
  alEnviar: "ok",
  /** La entrada con Google: ok, sin-sesion (el proveedor no arma la entrada) o error:CODIGO. */
  google: "ok",
  paso: "idle",
  oyentes: new Set<(estado: unknown) => void>(),
  billetera: null as null | { address: string },
  config: null as null | { openAuthUrl?: (ctx: { getUrl: () => Promise<string | null> }) => unknown },
  activa: null as unknown,
  /** Cuántas veces entró la cuenta de prueba. */
  conexiones: 0,
  /** Cuántas veces se pidió Practicar en Prueba. */
  practicar: 0,
  /** Si la guarda del cambio de modo deja cambiar. */
  puede: true,
  /** La demo, el ensayo o el stand. */
  sinGrabar: false,
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
  guestAvailable: () => h.red === "testnet",
  setActiveWallet: (w: unknown) => void (h.activa = w),
  activeWallet: () => h.activa,
  xlmBalance: async () => 10,
}));
// La cuenta de prueba: entra sin pedirle nada a la red.
vi.mock("../stellar/wallet", () => ({
  guestWallet: {
    kind: "guest",
    label: "Cuenta de prueba",
    connect: async () => {
      h.conexiones++;
      return DIR;
    },
    restore: async () => null,
    networkPassphrase: async () => TEST,
    disconnect: async () => undefined,
  },
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
      aviso({ step: h.paso });
      return () => void h.oyentes.delete(aviso);
    }
    beginEmailLogin(): void {
      emitir({ step: "entering_email" });
    }
    sendEmailCode(): void {
      emitir(h.alEnviar === "ok" ? { step: "entering_code" } : { step: "error", errorCode: h.alEnviar });
    }
    verifyEmailCode(): void {
      emitir({ step: "error", errorCode: "EMAIL_CODE_INVALID" });
    }
    login(): void {
      if (h.google.startsWith("error:")) {
        emitir({ step: "error", errorCode: h.google.slice("error:".length) });
        return;
      }
      const getUrl = async (): Promise<string | null> => (h.google === "sin-sesion" ? null : "https://pollar.invalid/entrar");
      void Promise.resolve(h.config?.openAuthUrl?.({ getUrl })).then(() => {
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
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => h.sinGrabar }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, marcarEntrada: () => undefined, tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({
  pasarAModo: () => true,
  abrirHojaDeModo: () => undefined,
  puedeCambiarDeModo: () => h.puede,
  practicarEnPrueba: () => {
    h.practicar++;
    return true;
  },
}));

type Ui = typeof import("./wallet-ui");

/** Lo que hay en la página, para que una falla diga qué se veía. */
const volcado = (): string => document.body.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, 1800);
const aviso = (): HTMLElement | null => document.querySelector(".wallet-notice.bad");
const practicar = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button[data-salida="practicar"]')];
const enlace = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(".login-practicar button");
const esperar = { timeout: 5000 };
/** Deja pasar un rato de verdad, para afirmar que algo NO pasa: lo que tenía que pasar ya pasó. */
const asentar = (ms = 40): Promise<void> => new Promise((listo) => setTimeout(listo, ms));
const ventanaFalsa = (): unknown => ({ closed: false, close: () => undefined, location: { href: "" }, opener: null });
const UA_DE_SIEMPRE = navigator.userAgent;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_de_ejemplo");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_de_ejemplo");
  h.red = "testnet";
  h.alEnviar = "ok";
  h.google = "ok";
  h.paso = "idle";
  h.oyentes.clear();
  h.billetera = null;
  h.config = null;
  h.activa = null;
  h.conexiones = 0;
  h.practicar = 0;
  h.puede = true;
  h.sinGrabar = false;
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

async function cargar(): Promise<{ ui: Ui; t: (k: string) => string }> {
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

describe("la marca de Practicar en Prueba, al cargar en Prueba", () => {
  it("se consume una sola vez y entra con la cuenta de prueba, sin abrir la ventana", async () => {
    sessionStorage.setItem("tinkazo.entrar.prueba", "1");
    const { ui } = await cargar();
    await vi.waitFor(() => expect(ui.currentSession()?.kind, volcado()).toBe("guest"), esperar);
    expect(h.conexiones).toBe(1);
    expect(sessionStorage.getItem("tinkazo.entrar.prueba")).toBeNull();
    expect(document.querySelector(".modal-card.login")).toBeNull();
    // La carga siguiente ya no la encuentra: no entra otra vez.
    vi.resetModules();
    await cargar();
    await asentar();
    expect(h.conexiones).toBe(1);
  });

  it("sin la marca no pasa nada", async () => {
    const { ui } = await cargar();
    await asentar();
    expect(h.conexiones).toBe(0);
    expect(ui.currentSession()).toBeNull();
  });

  it("en la demo, el ensayo o el stand se consume sin entrar", async () => {
    sessionStorage.setItem("tinkazo.entrar.prueba", "1");
    h.sinGrabar = true;
    const { ui } = await cargar();
    await asentar();
    expect(h.conexiones).toBe(0);
    expect(ui.currentSession()).toBeNull();
    expect(sessionStorage.getItem("tinkazo.entrar.prueba")).toBeNull();
  });

  it("en Oficial se consume sin entrar: ahí no hay cuenta de prueba", async () => {
    sessionStorage.setItem("tinkazo.entrar.prueba", "1");
    h.red = "mainnet";
    const { ui } = await cargar();
    await asentar();
    expect(h.conexiones).toBe(0);
    expect(ui.currentSession()).toBeNull();
    expect(sessionStorage.getItem("tinkazo.entrar.prueba")).toBeNull();
  });
});

describe("el enlace chico de la ventana de entrar", () => {
  it("en Prueba no aparece", async () => {
    const { ui } = await cargar();
    await ui.openPicker();
    expect(document.querySelector(".modal-card.login"), volcado()).not.toBeNull();
    expect(enlace()).toBeNull();
  });

  it("en Oficial aparece debajo de las formas de entrar y lleva a practicar", async () => {
    h.red = "mainnet";
    const { ui, t } = await cargar();
    await ui.openPicker();
    const b = enlace();
    expect(b?.textContent, volcado()).toBe(t("loginPracticar"));
    // Es lo último de la ventana antes del pie: debajo de todas las formas de entrar.
    expect(document.querySelector(".login-body")?.lastElementChild?.classList.contains("login-practicar")).toBe(true);
    b?.click();
    await vi.waitFor(() => expect(h.practicar).toBe(1), esperar);
  });

  it("en Oficial, con un sorteo sellado esperando su número, no aparece", async () => {
    h.red = "mainnet";
    h.puede = false;
    const { ui } = await cargar();
    await ui.openPicker();
    expect(enlace(), volcado()).toBeNull();
  });

  it("en Oficial, en la demo, el ensayo o el stand, no aparece", async () => {
    h.red = "mainnet";
    h.sinGrabar = true;
    const { ui } = await cargar();
    await ui.openPicker();
    expect(enlace(), volcado()).toBeNull();
  });
});

describe("en Oficial, un ingreso que falla", () => {
  beforeEach(() => {
    h.red = "mainnet";
  });

  it("por el proveedor, con Google, ofrece Practicar en Prueba en el aviso", async () => {
    h.google = "sin-sesion";
    const { ui, t } = await cargar();
    await ui.entrar();
    await vi.waitFor(() => expect(practicar(), volcado()).toHaveLength(1), esperar);
    expect(aviso()?.textContent).toContain(t("ingresoCaidoTitulo"));
    expect(aviso()?.textContent).toContain(t("ingresoPracticarLinea"));
    const botones = [...(aviso()?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(botones).toEqual([t("loginOtraVia"), t("ingresoPracticar"), t("loginClose")]);
  });

  it("por el proveedor, elegir Practicar en Prueba cierra el aviso y pide el cambio", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await vi.waitFor(() => expect(practicar(), volcado()).toHaveLength(1), esperar);
    (practicar()[0] as HTMLButtonElement).click();
    expect(aviso()).toBeNull();
    await vi.waitFor(() => expect(h.practicar).toBe(1), esperar);
  });

  it("por el proveedor, con el correo, ofrece Practicar en Prueba junto al error", async () => {
    h.alEnviar = "SESSION_CREATE_FAILED";
    const { ui, t } = await cargar();
    await ui.openPicker();
    const mail = document.querySelector<HTMLInputElement>("#login-mail") as HTMLInputElement;
    mail.value = "ana@example.org";
    mail.dispatchEvent(new Event("input", { bubbles: true }));
    const form = mail.closest("form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(practicar(), volcado()).toHaveLength(1), esperar);
    expect(form.querySelector(".login-err")?.textContent).toContain(t("ingresoPracticarLinea"));
  });

  it("por la persona (la ventana de Google bloqueada) no lo ofrece", async () => {
    vi.stubGlobal("open", () => null);
    const { ui, t } = await cargar();
    await ui.entrar();
    await asentar();
    expect(aviso()?.textContent, volcado()).toContain(t("cuentaBloqueada"));
    expect(practicar()).toHaveLength(0);
  });

  it("con un sorteo sellado esperando su número no lo ofrece", async () => {
    h.google = "sin-sesion";
    h.puede = false;
    const { ui } = await cargar();
    await ui.entrar();
    await asentar();
    expect(aviso(), volcado()).not.toBeNull();
    expect(practicar()).toHaveLength(0);
  });
});

describe("en Prueba, un ingreso que falla por el proveedor", () => {
  it("no ofrece Practicar en Prueba: ya está en Prueba", async () => {
    h.google = "sin-sesion";
    const { ui } = await cargar();
    await ui.entrar();
    await asentar();
    expect(aviso(), volcado()).not.toBeNull();
    expect(practicar()).toHaveLength(0);
  });
});

describe("desde el navegador de una app", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone) Instagram 300.0", configurable: true });
  });

  it("junto al aviso, un botón copia el enlace de la página con su modo", async () => {
    const copiado: string[] = [];
    const portapapeles = { writeText: async (s: string): Promise<void> => void copiado.push(s) };
    Object.defineProperty(navigator, "clipboard", { value: portapapeles, configurable: true });
    const { ui, t } = await cargar();
    await ui.openPicker();
    const fila = document.querySelector(".login-app")?.nextElementSibling;
    const b = fila?.querySelector<HTMLButtonElement>("button");
    expect(b?.textContent, volcado()).toBe(t("loginCopiarEnlace"));
    b?.click();
    await vi.waitFor(() => expect(copiado).toHaveLength(1), esperar);
    expect(new URL(copiado[0] as string).searchParams.get("red")).toBe("prueba");
    await vi.waitFor(() => expect(b?.textContent).toBe(t("errCopiado")), esperar);
  });

  it("fuera de una app, el botón no está", async () => {
    Object.defineProperty(navigator, "userAgent", { value: UA_DE_SIEMPRE, configurable: true });
    const { ui } = await cargar();
    await ui.openPicker();
    expect(document.querySelector(".login-copiar"), volcado()).toBeNull();
  });
});
