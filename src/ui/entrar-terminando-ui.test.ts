// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entrar con una cuenta nueva de Google, en `wallet-ui.ts` y `wallet-pollar.ts` de verdad (15 de noviembre de 2026).
 *
 * Con la ventana de Google ya cerrada y el pedido de ingreso en camino, crear la cuenta puede tardar. La puerta no queda
 * muda: dice que se está terminando de entrar y ofrece Cancelar. Cancelar le pide al SDK que pare y la puerta vuelve a
 * como estaba, sin un aviso de error. Lo único simulado es el proveedor (`@pollar/core`).
 */

const TEST = "Test SDF Network ; September 2015";
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

const h = vi.hoisted(() => ({
  paso: "idle",
  oyentes: new Set<(estado: unknown) => void>(),
  billetera: null as null | { address: string },
  config: null as null | { openAuthUrl?: (ctx: { getUrl: () => Promise<string | null> }) => unknown },
  miradores: [] as Array<{ onRequest: (x: unknown) => unknown }>,
  cancelados: 0,
  activa: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    hayModoOficial: true,
    anchoringAvailable: true,
    get network() {
      return { ...o.network, name: "testnet", contractId: "CREAL", networkPassphrase: TEST };
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
// El proveedor: como el de verdad, con la ventana ya en Google pasa a autenticar, y deja mirar sus pedidos.
vi.mock("@pollar/core", () => {
  class ClienteFalso {
    apiKeyHash = "huella";
    _api = {
      use: (m: { onRequest: (x: unknown) => unknown }) => void h.miradores.push(m),
      eject: (m: unknown) => void (h.miradores = h.miradores.filter((x) => x !== m)),
    };
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
    login(): void {
      void Promise.resolve(h.config?.openAuthUrl?.({ getUrl: async () => "https://pollar.invalid/entrar" })).then(() => {
        h.paso = "authenticating";
      });
    }
    cancelLogin(): void {
      h.cancelados++;
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
vi.mock("./modo-ui", () => ({ pasarAModo: () => undefined, abrirHojaDeModo: () => undefined }));

const volcado = (): string => document.body.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").slice(0, 1800);
// Terminando de entrar aparece recién 2,5 segundos después del cierre de la ventana (`AVISO_TERMINANDO_MS`).
const esperar = { timeout: 10_000 };
const aviso = (): HTMLElement | null => document.querySelector(".wallet-notice.bad");

/** La ventana de Google: se abre, y la prueba decide cuándo se cierra. */
const ventana = { closed: false, close: (): void => undefined, location: { href: "" }, opener: null as unknown };

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_de_ejemplo");
  h.paso = "idle";
  h.oyentes.clear();
  h.billetera = null;
  h.config = null;
  h.miradores = [];
  h.cancelados = 0;
  h.activa = null;
  ventana.closed = false;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  vi.stubGlobal("open", () => ventana);
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML =
    '<header></header><div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function cargar() {
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

/** La persona terminó en Google: sale el pedido de ingreso y la página del proveedor cierra la ventana. */
async function terminaEnGoogle(): Promise<void> {
  await vi.waitFor(() => expect(h.miradores.length, volcado()).toBe(1), esperar);
  for (const m of h.miradores) m.onRequest({ request: { method: "POST" }, schemaPath: "/auth/login" });
  ventana.closed = true;
}

describe("la puerta mientras se termina de entrar", () => {
  it("dice Terminando de entrar y ofrece Cancelar. Cancelar para al SDK y la puerta vuelve a como estaba, sin error", async () => {
    const { ui, t } = await cargar();
    const fin = ui.entrar();
    await terminaEnGoogle();
    await vi.waitFor(() => expect(document.querySelector("#gate p")?.textContent, volcado()).toBe(t("loginTerminando")), esperar);
    expect(document.querySelector("#wallet-box .cuenta-chip")?.textContent, volcado()).toContain(t("loginTerminando"));
    const cancelar = document.querySelector<HTMLButtonElement>("#gate button");
    expect(cancelar?.textContent, volcado()).toBe(t("cancel"));
    expect(h.cancelados).toBe(0);
    cancelar?.click();
    await fin;
    expect(h.cancelados).toBe(1);
    expect(aviso(), volcado()).toBeNull();
    expect(document.getElementById("gate")?.style.display, volcado()).toBe("none");
    expect(document.querySelector("#wallet-box .cuenta-chip")?.getAttribute("data-estado"), volcado()).toBe("fuera");
    expect(ui.currentSession()).toBeNull();
  });

  it("si la cuenta llega mientras tanto, entra sin pedir nada más", async () => {
    const { ui, t } = await cargar();
    const fin = ui.entrar();
    await terminaEnGoogle();
    await vi.waitFor(() => expect(document.querySelector("#gate p")?.textContent, volcado()).toBe(t("loginTerminando")), esperar);
    h.billetera = { address: DIR };
    h.paso = "authenticated";
    for (const f of [...h.oyentes]) f({ step: "authenticated" });
    await fin;
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    expect(h.cancelados).toBe(0);
    // Con la cuenta adentro la puerta no se ve, y con ella Cancelar.
    expect(document.getElementById("gate")?.style.display, volcado()).toBe("none");
    expect(document.querySelector("#wallet-box .cuenta-chip")?.getAttribute("data-estado"), volcado()).toBe("dentro");
  });

  it("retomar la sesión de Google con cuenta deja guardado el tipo de sesión, para las páginas de lectura", async () => {
    localStorage.setItem("tinkazo.pollar.intent.testnet", "google");
    h.billetera = { address: DIR };
    const { ui } = await cargar();
    await vi.waitFor(() => expect(ui.currentSession()?.address, volcado()).toBe(DIR), esperar);
    expect(localStorage.getItem("tinkazo.session.kind.testnet")).toBe("google");
  });

  it("retomar sin cuenta no lo guarda", async () => {
    localStorage.setItem("tinkazo.pollar.intent.testnet", "google");
    const { ui } = await cargar();
    // La marca de Pollar se olvida cuando el SDK termina sin cuenta: ahí ya terminó de retomar.
    await vi.waitFor(() => expect(localStorage.getItem("tinkazo.pollar.intent.testnet")).toBeNull(), esperar);
    expect(ui.currentSession()).toBeNull();
    expect(localStorage.getItem("tinkazo.session.kind.testnet")).toBeNull();
  });

  it("los textos nuevos están en los dos idiomas", async () => {
    const { T } = await import("../i18n");
    expect(T.es.loginTerminando).toBe("Terminando de entrar…");
    expect(T.en.loginTerminando).toBe("Finishing signing you in…");
  });
});

/** La ventana de opciones abierta y su botón de Google tocado, con el foco en él (como desde el teclado). */
async function entrarDesdeLaVentana(ui: Awaited<ReturnType<typeof cargar>>["ui"]): Promise<HTMLButtonElement> {
  await ui.openPicker();
  const google = document.querySelector<HTMLButtonElement>(".login-google");
  expect(google, volcado()).not.toBeNull();
  google?.focus();
  google?.click();
  return google as HTMLButtonElement;
}

describe("en la ventana de opciones", () => {
  it("después de Cancelar, la puerta no queda diciendo Conectando sin ningún botón", async () => {
    const { ui, t } = await cargar();
    const google = await entrarDesdeLaVentana(ui);
    await terminaEnGoogle();
    await vi.waitFor(() => expect(google.textContent, volcado()).toBe(t("loginTerminando")), esperar);
    document.querySelector<HTMLButtonElement>(".login-links .login-link")?.click();
    await vi.waitFor(() => expect(google.textContent, volcado()).toContain(t("loginGoogle")), esperar);
    expect(h.cancelados).toBe(1);
    expect(aviso(), volcado()).toBeNull();
    expect(document.querySelector(".login-links"), volcado()).toBeNull();
    // La puerta vuelve a como estaba antes de entrar.
    expect(document.getElementById("gate")?.style.display, volcado()).toBe("none");
    expect(document.querySelector("#wallet-box .cuenta-chip")?.getAttribute("data-estado"), volcado()).toBe("fuera");
  });
});

describe("Terminando de entrar se anuncia y el foco no se pierde", () => {
  it("se anuncia en la región viva de la cabecera, y sin foco en ningún lado Cancelar de la puerta lo recibe", async () => {
    const { ui, t } = await cargar();
    const fin = ui.entrar();
    await terminaEnGoogle();
    const vivo = document.getElementById("cuenta-aviso") as HTMLElement;
    await vi.waitFor(() => expect(vivo.textContent, volcado()).toBe(t("loginTerminando")), esperar);
    const cancelar = document.querySelector<HTMLButtonElement>("#gate button");
    expect(document.activeElement, volcado()).toBe(cancelar);
    cancelar?.click();
    await fin;
    // Cancelado, la región viva no queda diciendo algo que ya no pasa.
    expect(vivo.textContent).toBe("");
  });

  it("en la ventana de opciones el foco pasa de Google a Cancelar, y al cancelar vuelve a Google", async () => {
    const { ui, t } = await cargar();
    const google = await entrarDesdeLaVentana(ui);
    expect(document.activeElement).toBe(google);
    await terminaEnGoogle();
    await vi.waitFor(() => expect(document.querySelector(".login-links .login-link"), volcado()).not.toBeNull(), esperar);
    const cancelar = document.querySelector<HTMLButtonElement>(".login-links .login-link") as HTMLButtonElement;
    expect(document.activeElement, volcado()).toBe(cancelar);
    expect(document.getElementById("cuenta-aviso")?.textContent).toBe(t("loginTerminando"));
    cancelar.click();
    await vi.waitFor(() => expect(google.textContent, volcado()).toContain(t("loginGoogle")), esperar);
    expect(document.activeElement, volcado()).toBe(google);
  });
});

describe("Cancelar desde la portada", () => {
  it("la portada puede cancelar la entrada que se está terminando, igual que la puerta", async () => {
    const { ui } = await cargar();
    const fin = ui.entrar();
    await terminaEnGoogle();
    await vi.waitFor(() => expect(ui.estadoDeLaCuenta(), volcado()).toEqual({ estado: "conectando", terminando: true }), esperar);
    ui.cancelarLaEntrada();
    await fin;
    expect(h.cancelados).toBe(1);
    expect(aviso(), volcado()).toBeNull();
    expect(ui.estadoDeLaCuenta()).toEqual({ estado: "fuera" });
    // Sin una entrada en curso no hace nada.
    expect(() => ui.cancelarLaEntrada()).not.toThrow();
    expect(h.cancelados).toBe(1);
  });
});
