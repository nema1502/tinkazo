// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La cuenta abierta en el otro modo, en `wallet-ui.ts` de verdad (nema1502/tinkazo#90).
 *
 * La sesión se guarda por red: quien ya entró en Oficial y llega a Prueba sin
 * sesión (una pestaña nueva, un cupón, el celular de un equipo) ve "Entrar"
 * como si no hubiera entrado nunca. Si no hay sesión en este modo pero queda
 * cuenta guardada del otro, la puerta del sorteo lo dice en su línea: Entrar
 * sigue primero y con el foco, y el botón para ir al otro modo va segundo. La
 * cabecera abre la entrada, como siempre.
 *
 * Solo se lee si existe la marca: nunca se abre acá la sesión de la otra red.
 */

const h = vi.hoisted(() => ({
  hayModo: true,
  red: "testnet" as "mainnet" | "testnet",
  pollar: false,
  /** Si el plan B del ingreso ya fue elegido (`sin-cuenta.ts`). */
  sinCuenta: false,
  pasar: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get hayModoOficial() {
      return h.hayModo;
    },
    anchoringAvailable: true,
    get network() {
      return { ...o.network, name: h.red, contractId: "CREAL" };
    },
  };
});
vi.mock("../stellar/pollar-config", async (orig) => ({
  ...(await orig<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => h.pollar,
}));
const MAIN = "Public Global Stellar Network ; September 2015";
const TEST = "Test SDF Network ; September 2015";
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

vi.mock("../stellar/wallet-lite", () => ({
  freighterWallet: {
    kind: "external",
    label: "Varial",
    restore: async () => DIR,
    networkPassphrase: async () => (h.red === "mainnet" ? MAIN : TEST),
  },
  freighterAllowed: () => Promise.resolve(true),
  freighterInstalled: async () => true,
  guestStored: () => false,
  guestAvailable: () => false,
  setActiveWallet: () => undefined,
  activeWallet: () => null,
  xlmBalance: async () => 10,
}));
vi.mock("../stellar/wallet-pollar", () => ({
  pollarConfigured: () => false,
  submitsItself: () => false,
  precargarSdk: () => undefined,
  pollarWallet: { hayMarca: () => false, restore: async () => null },
}));
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./freeze", () => ({ refreshFreezeLabel: () => undefined }));
vi.mock("./anchor", () => ({ precalentarSello: () => undefined }));
vi.mock("./participants", () => ({ guardarBorrador: () => undefined }));
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => false }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, contarUnaVez: () => undefined, origenActual: () => "home", tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: (...a: unknown[]) => h.pasar(...a), abrirHojaDeModo: () => undefined }));
// El plan B del ingreso ya elegido (`sin-cuenta.ts` lo dice por su marca), solo en la prueba que lo pide: un `vi.doMock`
// quedaba puesto para las pruebas que venían después.
vi.mock("./sin-cuenta", async (orig) => ({ ...(await orig<typeof import("./sin-cuenta")>()), sinCuentaElegido: () => h.sinCuenta }));

type Ui = typeof import("./wallet-ui");

beforeEach(() => {
  vi.resetModules();
  h.hayModo = true;
  h.red = "testnet";
  h.pollar = false;
  h.sinCuenta = false;
  h.pasar.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  // Lo que la página prepara con el "load" (Freighter y Pollar) no es de estas pruebas.
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  document.body.innerHTML = `<div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>`;
});

/** La puerta del sorteo, tal como quedó después de abrir la página. */
const puerta = (): { texto: string; botones: string[] } => {
  const gate = document.getElementById("gate");
  return {
    texto: (gate?.textContent ?? "").trim(),
    botones: [...(gate?.querySelectorAll("button") ?? [])].map((b) => b.textContent ?? ""),
  };
};

const chip = (): { texto: string; aria: string } => {
  const el = document.querySelector<HTMLElement>('#wallet-box [data-estado="fuera"]');
  return { texto: el?.textContent?.trim() ?? "", aria: el?.getAttribute("aria-label") ?? "" };
};

/** Abre la página (con las marcas de sesión ya puestas, si las hubo). */
async function alAbrir(): Promise<{ ui: Ui; t: (k: string) => string }> {
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

const conMarcaDelOtroModo = (): void => {
  h.pollar = true;
  localStorage.setItem("tinkazo.pollar.intent.mainnet", "google");
};

describe("la puerta del sorteo con la cuenta abierta en el otro modo", () => {
  it("en Prueba con la cuenta de Oficial guardada, dice dónde está, con Entrar primero y con el foco", async () => {
    conMarcaDelOtroModo();
    const { t } = await alAbrir();
    const p = puerta();
    expect(p.texto).toContain(t("cuentaOtroModo").replace("{modo}", t("netMain")));
    expect(p.botones).toEqual([t("cuentaPideEntrar"), t("cuentaOtroModoIr").replace("{modo}", t("netMain"))]);
    expect(document.activeElement?.textContent).toBe(t("cuentaPideEntrar"));
  });

  it("en Prueba con la cuenta de Oficial guardada, el segundo botón es secundario y manda a Oficial", async () => {
    conMarcaDelOtroModo();
    await alAbrir();
    const segundo = document.querySelectorAll<HTMLButtonElement>("#gate button")[1];
    expect(segundo?.className).toBe("enlace");
    segundo?.click();
    await vi.waitFor(() => expect(h.pasar).toHaveBeenCalledWith("mainnet"));
  });

  it("también vale la marca de sesión guardada del otro modo, sin importar de qué vía era", async () => {
    localStorage.setItem("tinkazo.session.kind.mainnet", "guest");
    const { t } = await alAbrir();
    expect(puerta().texto).toContain(t("cuentaOtroModo").replace("{modo}", t("netMain")));
  });

  it("en Oficial con la cuenta de Prueba guardada, dice dónde está, con Entrar primero y con el foco", async () => {
    h.red = "mainnet";
    localStorage.setItem("tinkazo.session.kind.testnet", "guest");
    const { t } = await alAbrir();
    const p = puerta();
    expect(p.texto).toContain(t("cuentaOtroModo").replace("{modo}", t("netTest")));
    expect(p.botones).toEqual([t("cuentaPideEntrar"), t("cuentaOtroModoIr").replace("{modo}", t("netTest"))]);
    expect(document.activeElement?.textContent).toBe(t("cuentaPideEntrar"));
  });

  it("en Oficial con la cuenta de Prueba guardada, el segundo botón manda de vuelta a Prueba", async () => {
    h.red = "mainnet";
    localStorage.setItem("tinkazo.session.kind.testnet", "guest");
    await alAbrir();
    document.querySelectorAll<HTMLButtonElement>("#gate button")[1]?.click();
    await vi.waitFor(() => expect(h.pasar).toHaveBeenCalledWith("testnet"));
  });

  it("quien pasó a Oficial para entrar ve Entrar con el foco, aunque quede la cuenta de Prueba guardada", async () => {
    // Pasar a Oficial deja la marca de entrar y, al recargar, la página llama a pedirEntrar (main.ts).
    h.red = "mainnet";
    h.pollar = true;
    localStorage.setItem("tinkazo.session.kind.testnet", "google");
    const { ui, t } = await alAbrir();
    ui.pedirEntrar();
    await vi.waitFor(() => expect(puerta().botones).toEqual([t("cuentaPideEntrar")]));
    expect(puerta().texto).toContain(t("cuentaPideGoogle"));
    expect(document.activeElement?.textContent).toBe(t("cuentaPideEntrar"));
    expect(chip().texto).toContain(t("cuentaEntrar"));
    expect(chip().texto).not.toContain(t("netTest"));
  });

  it("sin cuenta guardada en el otro modo, la puerta no aparece y la cabecera pide entrar, como siempre", async () => {
    const { t } = await alAbrir();
    expect(puerta().texto).toBe("");
    expect(puerta().botones).toEqual([]);
    expect(chip().texto).toContain(t("cuentaEntrar"));
  });

  it("con la cuenta en el otro modo, la puerta lleva la marca que esconde la invitación de primera vez", async () => {
    conMarcaDelOtroModo();
    await alAbrir();
    expect(document.getElementById("gate")?.classList.contains("otro-modo")).toBe(true);
  });

  it("sin cuenta en el otro modo, la puerta no lleva esa marca y la invitación sigue como siempre", async () => {
    await alAbrir();
    expect(document.getElementById("gate")?.classList.contains("otro-modo")).toBe(false);
  });

  it("sin modo Oficial para ofrecer, la puerta y la cabecera se quedan como siempre", async () => {
    h.hayModo = false;
    localStorage.setItem("tinkazo.session.kind.mainnet", "guest");
    const { t } = await alAbrir();
    expect(puerta().texto).toBe("");
    expect(chip().texto).toContain(t("cuentaEntrar"));
    // Sin contrato en Oficial, Oficial no existe: no se ofrece llegar a un modo que no está.
    expect(chip().aria).not.toContain(t("netMain"));
  });

  it("mientras la sesión de este modo vuelve, la puerta dice Retomando y no manda a ningún modo", async () => {
    // Una sesión de este modo guardada: al abrir, retoma, y la puerta no se repinta; el chip dice "Retomando…".
    localStorage.setItem(`tinkazo.session.kind.${h.red}`, "freighter");
    conMarcaDelOtroModo();
    const ui = await import("./wallet-ui");
    const { t } = await import("../i18n");
    // Sin esperar: la retoma le gana a nada que la página vuelva a pintarse.
    ui.initWalletUI();
    expect(ui.estadoDeLaCuenta().estado).toBe("retomando");
    expect(puerta().texto).toContain(t("gateRetomando"));
    expect(puerta().botones).toEqual([]);
    expect(document.querySelector('#wallet-box [data-estado="retomando"]')?.textContent).toContain(t("cuentaRetomando"));
  });

  it("con el plan B del ingreso elegido, la puerta no aparece y la cabecera pide entrar, como siempre", async () => {
    h.sinCuenta = true;
    conMarcaDelOtroModo();
    const { t } = await alAbrir();
    expect(puerta().texto).toBe("");
    expect(chip().texto).toContain(t("cuentaEntrar"));
  });

  it("quien ya tiene sesión en este modo no ve la puerta del otro modo: la suya está acá", async () => {
    h.red = "mainnet";
    const ui = await import("./wallet-ui");
    const t = (await import("../i18n")).t;
    // La sesión de Oficial vuelve: guardada de Oficial y Freighter que da el paso.
    localStorage.setItem(`tinkazo.session.kind.${h.red}`, "freighter");
    localStorage.setItem("tinkazo.session.kind.testnet", "guest");
    ui.initWalletUI();
    await vi.waitFor(() => expect(ui.estadoDeLaCuenta().estado).toBe("dentro"), { timeout: 5000 });
    // Con la sesión, la puerta que decía Retomando se esconde: queda su texto, pero no se ve.
    expect(document.getElementById("gate")?.style.display).toBe("none");
    expect(document.querySelector('[data-estado="fuera"]')).toBeNull();
  });
});

describe("la cabecera con la cuenta abierta en el otro modo", () => {
  it("en Prueba con la cuenta de Oficial guardada, el chip pide entrar y tocarlo abre la entrada", async () => {
    conMarcaDelOtroModo();
    const { t } = await alAbrir();
    expect(chip().texto).toContain(t("cuentaEntrar"));
    expect(chip().aria).toBe(t("cuentaEntrarAria"));
    document.querySelector<HTMLButtonElement>('#wallet-box [data-estado="fuera"]')?.click();
    await vi.waitFor(() => expect(document.querySelector(".modal-card.login")).not.toBeNull());
    expect(h.pasar).not.toHaveBeenCalled();
  });

  it("en Oficial con la cuenta de Prueba guardada, el chip pide entrar y tocarlo abre la entrada", async () => {
    h.red = "mainnet";
    localStorage.setItem("tinkazo.session.kind.testnet", "guest");
    const { t } = await alAbrir();
    expect(chip().texto).toContain(t("cuentaEntrar"));
    document.querySelector<HTMLButtonElement>('#wallet-box [data-estado="fuera"]')?.click();
    await vi.waitFor(() => expect(document.querySelector(".modal-card.login")).not.toBeNull());
    expect(h.pasar).not.toHaveBeenCalled();
  });

  it("en los dos idiomas, la puerta dice dónde está la cuenta con Entrar primero", async () => {
    conMarcaDelOtroModo();
    await alAbrir();
    // En español (el de la carga).
    expect(puerta().texto).toContain("Tu cuenta está abierta en el modo Oficial.");
    expect(puerta().botones).toEqual(["Entrar con Google", "Ir a Oficial"]);
    // En inglés, la página se repinta entera.
    vi.resetModules();
    document.body.innerHTML = `<div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>`;
    const i18n = await import("../i18n");
    i18n.setLang("en");
    await alAbrir();
    expect(puerta().texto).toContain("Your account is open in Live.");
    expect(puerta().botones).toEqual(["Sign in with Google", "Go to Live"]);
  });
});
