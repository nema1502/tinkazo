// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUSIBLE_DE_RETOMA_MS } from "../stellar/pollar-config";

/**
 * La cabecera, en `wallet-ui.ts` de verdad, con una sesión guardada que tarda en volver: el fusible la suelta a los 12
 * segundos de siempre, aunque la retoma siga en camino, y la sesión que llega después se abre sola.
 */

const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";

const h = vi.hoisted(() => ({
  /** Cuánto tarda la billetera en devolver la cuenta guardada. */
  tarda: 25_000,
  activa: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, hayModoOficial: false, anchoringAvailable: true, network: { ...o.network, name: "testnet", contractId: "CREAL" } };
});
vi.mock("../stellar/pollar-config", async (orig) => ({
  ...(await orig<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => false,
}));
vi.mock("../stellar/wallet-lite", () => {
  const freighterWallet = {
    kind: "external",
    label: "Freighter",
    restore: () => new Promise<string>((resolver) => setTimeout(() => resolver(DIR), h.tarda)),
    networkPassphrase: async () => "Test SDF Network ; September 2015",
  };
  return {
    freighterWallet,
    freighterAllowed: () => Promise.resolve(true),
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
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./freeze", () => ({ refreshFreezeLabel: () => undefined }));
vi.mock("./anchor", () => ({ precalentarSello: () => undefined }));
vi.mock("./participants", () => ({ guardarBorrador: () => undefined }));
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => false }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, contarUnaVez: () => undefined, origenActual: () => "home", tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: () => undefined, abrirHojaDeModo: () => undefined }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.tarda = 25_000;
  h.activa = null;
  localStorage.clear();
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  document.body.innerHTML = `<div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>`;
});

afterEach(async () => {
  vi.useRealTimers();
  // Lo que la cabecera pidió de forma diferida termina antes de cerrar la prueba.
  await new Promise((r) => setTimeout(r, 0));
});

const puerta = (): string => document.getElementById("gate")?.textContent ?? "";
/** La puerta escondida deja su último texto: lo que la persona ve es la puerta visible. */
const puertaVisible = (): boolean => document.getElementById("gate")?.style.display !== "none";

async function abrir(): Promise<{ ui: typeof import("./wallet-ui"); t: (k: string) => string }> {
  localStorage.setItem("tinkazo.session.kind.testnet", "freighter");
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

describe("la cabecera mientras la sesión guardada vuelve", () => {
  it("con una retoma de 25 segundos, a los 11 todavía retoma y a los 13 ofrece Entrar, como siempre", async () => {
    const { ui, t } = await abrir();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("retomando");
    expect(puerta()).toContain(t("gateRetomando"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("fuera");
    expect(puerta()).not.toContain(t("gateRetomando"));
  });

  it("cuando la sesión llega, aunque sea después del fusible, queda adentro y la puerta se va", async () => {
    const { ui } = await abrir();
    await vi.advanceTimersByTimeAsync(26_000);
    expect(ui.currentSession()?.address).toBe(DIR);
    expect(puertaVisible()).toBe(false);
  });

  it("si la retoma se cuelga de verdad, el fusible suelta la puerta", async () => {
    h.tarda = 10 * FUSIBLE_DE_RETOMA_MS;
    const { ui } = await abrir();
    await vi.advanceTimersByTimeAsync(FUSIBLE_DE_RETOMA_MS + 1_000);
    expect(ui.currentSession()).toBeNull();
    expect(puertaVisible()).toBe(false);
  });
});
