// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La billetera en la otra red, en `wallet-ui.ts` de verdad: lo que pregunta, lo que dice y lo que ofrece.
 *
 * - Con el modo Oficial a la vista, el aviso dice el modo, el nombre que la billetera le da a la red ("Main Net" o
 *   "Test Net", que es lo que hay que tocar) y, si la billetera está en la red del otro modo, ofrece pasar a ese modo.
 * - Antes de sellar se le pregunta de nuevo la red a la billetera: quien ya la cambió sigue sin volver a entrar, y el
 *   aviso de otra red se va en cuanto la red está bien.
 * - Sin modo Oficial, como hoy: no se frena nada y el aviso es el de siempre.
 * - La sesión guardada que se retoma es la de la red del modo: la de Prueba no hace decir "Retomando…" en Oficial.
 */

const MAIN = "Public Global Stellar Network ; September 2015";
const TEST = "Test SDF Network ; September 2015";
const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

const h = vi.hoisted(() => ({
  hayModo: true,
  red: "mainnet" as "mainnet" | "testnet",
  /** La red que dice la billetera (su frase). */
  frase: "" as string | null,
  /** Cuántas veces se le preguntó la red a la billetera. */
  preguntas: 0,
  /** La billetera no contesta cuando se le pregunta la red. */
  callada: false,
  /** Si Freighter ya dio permiso a este sitio; `null`: no contesta nunca. */
  permiso: true as boolean | null,
  pollar: false,
  pasar: vi.fn(),
  activa: null as unknown,
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
      return { ...o.network, name: h.red, contractId: "CREAL", networkPassphrase: h.red === "mainnet" ? MAIN : TEST };
    },
  };
});
vi.mock("../stellar/pollar-config", async (orig) => ({
  ...(await orig<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => h.pollar,
}));
vi.mock("../stellar/wallet-lite", () => {
  const freighterWallet = {
    kind: "external",
    label: "Freighter",
    restore: async () => DIR,
    networkPassphrase: async () => {
      h.preguntas++;
      if (h.callada) throw new Error("sin respuesta");
      return h.frase;
    },
  };
  return {
    freighterWallet,
    freighterAllowed: () => (h.permiso === null ? new Promise<boolean>(() => undefined) : Promise.resolve(h.permiso)),
    freighterInstalled: async () => true,
    guestStored: () => false,
    guestAvailable: () => false,
    setActiveWallet: (w: unknown) => void (h.activa = w),
    activeWallet: () => h.activa,
    xlmBalance: async () => 10,
  };
});
vi.mock("../stellar/wallet-pollar", () => ({
  pollarConfigured: () => false,
  submitsItself: () => false,
  precargarSdk: () => undefined,
  pollarWallet: { hayMarca: () => false, restore: async () => null },
}));
// El historial de la cuenta se pinta (`render`), pero no es de estas pruebas: no le pide nada a la red.
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./freeze", () => ({ refreshFreezeLabel: () => undefined }));
vi.mock("./anchor", () => ({ precalentarSello: () => undefined }));
vi.mock("./participants", () => ({ guardarBorrador: () => undefined }));
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => false }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: (...a: unknown[]) => h.pasar(...a), abrirHojaDeModo: () => undefined }));

type Ui = typeof import("./wallet-ui");

beforeEach(() => {
  vi.resetModules();
  h.hayModo = true;
  h.red = "mainnet";
  h.frase = TEST;
  h.preguntas = 0;
  h.callada = false;
  h.permiso = true;
  h.pollar = false;
  h.pasar.mockReset();
  h.activa = null;
  localStorage.clear();
  // Lo que la página prepara con el "load" (Freighter y Pollar, para la ventana de ingreso) no es de estas pruebas.
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  document.body.innerHTML = `<div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>`;
});

const aviso = (): HTMLElement | null => document.querySelector(".wallet-notice.bad");

/** Abre la página con la sesión de Freighter guardada para la red del modo, y espera a que vuelva. */
async function conFreighter(): Promise<{ ui: Ui; t: (k: string) => string }> {
  localStorage.setItem(`tinkazo.session.kind.${h.red}`, "freighter");
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  await vi.waitFor(() => expect(ui.currentSession()?.address).toBe(DIR), { timeout: 5000 });
  return { ui, t };
}

describe("con el modo Oficial, la billetera en la otra red", () => {
  it("el aviso dice el modo y el nombre de la red en la billetera, y ofrece pasar al modo de la billetera", async () => {
    const { ui, t } = await conFreighter();
    expect(ui.billeteraEnOtraRed()).toBe(true);
    expect(ui.canAnchor()).toBe(false);
    const el = aviso();
    expect(el?.textContent).toContain(t("sealModeOtraRed").replace("{modo}", t("netMain")));
    expect(el?.textContent).toContain(t("otraRedComoCambiar").replace("{etiqueta}", "Main Net"));
    const pasar = [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent === t("modeSwitchToTest"));
    expect(pasar).toBeTruthy();
    pasar?.click();
    await vi.waitFor(() => expect(h.pasar).toHaveBeenCalledWith("testnet"));
  });

  it("en Prueba con la billetera en la red real, dice Test Net y ofrece pasar a Oficial", async () => {
    h.red = "testnet";
    h.frase = MAIN;
    const { t } = await conFreighter();
    const el = aviso();
    expect(el?.textContent).toContain(t("sealModeOtraRed").replace("{modo}", t("netTest")));
    expect(el?.textContent).toContain(t("otraRedComoCambiar").replace("{etiqueta}", "Test Net"));
    const pasar = [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent === t("modeSwitchToOfficial"));
    pasar?.click();
    await vi.waitFor(() => expect(h.pasar).toHaveBeenCalledWith("mainnet"));
  });

  it("si la billetera está en una red que no es de ningún modo, no ofrece pasar a ninguno", async () => {
    h.frase = "Otra red ; 2026";
    const { t } = await conFreighter();
    const botones = [...(aviso()?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(botones).not.toContain(t("modeSwitchToTest"));
    expect(botones).not.toContain(t("modeSwitchToOfficial"));
  });

  it("al sellar, se le pregunta de nuevo la red: si sigue en la otra, frena con el aviso", async () => {
    const { ui } = await conFreighter();
    aviso()?.remove();
    h.preguntas = 0;
    expect(await ui.frenarPorOtraRed()).toBe(true);
    expect(h.preguntas).toBe(1);
    expect(aviso()).not.toBeNull();
  });

  it("si ya la cambió, sigue sin frenar, deja sellar y el aviso de otra red se va", async () => {
    const { ui } = await conFreighter();
    expect(aviso()).not.toBeNull();
    h.preguntas = 0;
    h.frase = MAIN;
    expect(await ui.frenarPorOtraRed()).toBe(false);
    expect(h.preguntas).toBe(1);
    expect(ui.billeteraEnOtraRed()).toBe(false);
    expect(ui.canAnchor()).toBe(true);
    expect(aviso()).toBeNull();
  });

  it("si la billetera no contesta su red, vale lo que dijo al entrar", async () => {
    const { ui } = await conFreighter();
    h.callada = true;
    expect(await ui.frenarPorOtraRed()).toBe(true);
  });
});

describe("sin modo Oficial, como hoy", () => {
  it("no frena ni pregunta, y el aviso es el de siempre", async () => {
    h.hayModo = false;
    const { ui, t } = await conFreighter();
    expect(ui.billeteraEnOtraRed()).toBe(false);
    h.preguntas = 0;
    expect(await ui.frenarPorOtraRed()).toBe(false);
    expect(h.preguntas).toBe(0);
    const el = aviso();
    expect(el?.querySelector("p")?.textContent).toBe(t("wrongNetwork").replace("{red}", "mainnet"));
    expect(el?.textContent).not.toContain("Main Net");
  });
});

describe("la sesión guardada es la de la red del modo", () => {
  /** Abre la página y dice cómo está la cuenta enseguida, mientras se retoma lo que haya. */
  async function alAbrir(): Promise<string> {
    h.permiso = null;
    const ui = await import("./wallet-ui");
    ui.initWalletUI();
    return ui.estadoDeLaCuenta().estado;
  }

  it("en Oficial, la de Freighter o la de Google de Prueba no hacen decir «Retomando…»", async () => {
    h.pollar = true;
    localStorage.setItem("tinkazo.session.kind.testnet", "freighter");
    localStorage.setItem("tinkazo.pollar.intent.testnet", "google");
    localStorage.setItem("tinkazo.pollar.intent", "google");
    expect(await alAbrir()).toBe("fuera");
  });

  it("en Oficial, la de Freighter de Oficial sí", async () => {
    localStorage.setItem("tinkazo.session.kind.mainnet", "freighter");
    expect(await alAbrir()).toBe("retomando");
  });

  it("en Oficial, la marca de Google de Oficial también", async () => {
    h.pollar = true;
    localStorage.setItem("tinkazo.pollar.intent.mainnet", "google");
    expect(await alAbrir()).toBe("retomando");
  });

  it("en Prueba, la de Oficial no cuenta, y la marca vieja sin red sí", async () => {
    h.red = "testnet";
    h.pollar = true;
    localStorage.setItem("tinkazo.session.kind.mainnet", "freighter");
    expect(await alAbrir()).toBe("fuera");
    vi.resetModules();
    localStorage.setItem("tinkazo.pollar.intent", "google");
    expect(await alAbrir()).toBe("retomando");
  });
});
