// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUSIBLE_DE_RETOMA_MS } from "../stellar/pollar-config";

/**
 * La cabecera y la puerta con la cuenta de Google que tarda en volver, en `wallet-ui.ts` de verdad.
 *
 * La pantalla se comporta como siempre y la paciencia corre por detrás:
 * - A los 8 segundos de la primera mirada la cabecera deja de decir que retoma y ofrece Entrar. El fusible de la página es
 *   el de siempre, 12 segundos.
 * - La retoma paciente sigue y, si llega, abre la cuenta sola.
 * - Si la persona ya entró de nuevo (o la ventana de Google está abierta) cuando la retoma llega, gana lo que ya está y la
 *   retoma tardía no abre nada dos veces.
 * - Entrar y el pedido de entrar esperan la retoma un segundo como mucho, para que el toque siga vivo y el navegador
 *   no bloquee la ventana de Google.
 */

const DIR = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const OTRA = "GBXYABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSAAAA";

const h = vi.hoisted(() => ({
  /** Cuánto tarda la retoma en devolver la cuenta guardada. */
  tarda: 20_000,
  /** La retoma avisa a los 8 segundos que la primera mirada venció (el proveedor todavía no contestó). */
  avisa: true,
  /** Cuánto tarda la ventana de Google en entregar la cuenta nueva. */
  conectaTarda: 0,
  conexiones: 0,
  activaciones: 0,
  restauraciones: 0,
  activa: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return { ...o, hayModoOficial: false, anchoringAvailable: true, network: { ...o.network, name: "testnet", contractId: "CREAL" } };
});
vi.mock("../stellar/pollar-config", async (orig) => ({
  ...(await orig<typeof import("../stellar/pollar-config")>()),
  hasPollarKey: () => true,
}));
vi.mock("../stellar/wallet-lite", () => ({
  freighterAllowed: () => Promise.resolve(false),
  freighterInstalled: async () => false,
  guestStored: () => false,
  guestAvailable: () => false,
  setActiveWallet: (w: unknown) => {
    h.activa = w;
    if (w) h.activaciones += 1;
  },
  activeWallet: () => h.activa,
  xlmBalance: async () => 10,
}));
vi.mock("../stellar/wallet-pollar", () => {
  const pollarWallet = {
    kind: "external",
    label: "Google",
    hayMarca: () => true,
    profile: () => null,
    networkPassphrase: async () => "Test SDF Network ; September 2015",
    restore: (opciones?: { cuandoTarda?: () => void }) => {
      h.restauraciones += 1;
      return new Promise<string | null>((resolver) => {
        if (h.avisa) setTimeout(() => opciones?.cuandoTarda?.(), 8_000);
        setTimeout(() => resolver(DIR), h.tarda);
      });
    },
    connect: () => {
      h.conexiones += 1;
      return new Promise<string>((resolver) => setTimeout(() => resolver(OTRA), h.conectaTarda));
    },
    disconnect: async () => undefined,
  };
  return { pollarConfigured: () => true, submitsItself: () => true, precargarSdk: () => undefined, pollarWallet };
});
vi.mock("../stellar/seals", () => ({ sealsOfAccount: async () => null }));
vi.mock("./history", () => ({ remember: () => undefined, renderHistory: () => undefined }));
vi.mock("./freeze", () => ({ refreshFreezeLabel: () => undefined }));
vi.mock("./anchor", () => ({ precalentarSello: () => undefined }));
vi.mock("./participants", () => ({ guardarBorrador: () => undefined }));
vi.mock("../ensayo-modo", () => ({ enPractica: () => false, sinGrabar: () => false }));
vi.mock("../contar", () => ({ contarEntrada: () => undefined, contarUnaVez: () => undefined, origenActual: () => "home", marcarEntrada: () => undefined, tomarEntrada: () => undefined }));
vi.mock("./modo-ui", () => ({ pasarAModo: () => undefined, abrirHojaDeModo: () => undefined }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.tarda = 20_000;
  h.avisa = true;
  h.conectaTarda = 0;
  h.conexiones = 0;
  h.activaciones = 0;
  h.restauraciones = 0;
  h.activa = null;
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
  document.body.innerHTML = `<div><div id="gate"></div></div><div id="wallet-box"></div><div id="fund-box"></div><button id="btn-freeze"></button><div id="cuenta-aviso"></div><section id="sec-history"></section>`;
});

afterEach(async () => {
  vi.useRealTimers();
  // Lo que la cabecera pidió de forma diferida termina antes de cerrar la prueba.
  await new Promise((r) => setTimeout(r, 0));
});

/**
 * Adelanta el reloj y deja que terminen los módulos que la cabecera baja por detrás (`import()`), que no dependen del
 * reloj de mentira: sin esto, lo que pasa después de bajarlos se mira antes de tiempo.
 */
async function asentar(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 3; i++) {
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
  }
}

const puerta = (): string => document.getElementById("gate")?.textContent ?? "";
const puertaVisible = (): boolean => document.getElementById("gate")?.style.display !== "none";

async function abrir(): Promise<{ ui: typeof import("./wallet-ui"); t: (k: string) => string }> {
  localStorage.setItem("tinkazo.session.kind.testnet", "google");
  const ui = await import("./wallet-ui");
  const { t } = await import("../i18n");
  ui.initWalletUI();
  return { ui, t };
}

describe("la pantalla se comporta como siempre y la paciencia corre por detrás", () => {
  it("el fusible de la cabecera es el de siempre: 12 segundos", () => {
    expect(FUSIBLE_DE_RETOMA_MS).toBe(12_000);
  });

  it("a los 7 segundos retoma y a los 9 ya no: ofrece Entrar, y a los 21 la cuenta se abre sola", async () => {
    const { ui, t } = await abrir();
    await asentar(7_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("retomando");
    expect(puerta()).toContain(t("gateRetomando"));
    await asentar(2_000);
    expect(ui.estadoDeLaCuenta().estado, "pasada la primera mirada la cabecera ofrece Entrar").toBe("fuera");
    // La puerta escondida deja su último texto: lo que cuenta es que no se ve.
    expect(puertaVisible()).toBe(false);
    expect(ui.currentSession()).toBeNull();
    await asentar(12_000);
    expect(ui.currentSession()?.address, "la retoma paciente abrió la cuenta sin que nadie toque nada").toBe(DIR);
    expect(ui.estadoDeLaCuenta().estado).toBe("dentro");
    expect(puertaVisible()).toBe(false);
  });

  it("si la billetera nunca avisa, el fusible suelta la cabecera a los 12 segundos, como siempre", async () => {
    h.avisa = false;
    h.tarda = 10 * FUSIBLE_DE_RETOMA_MS;
    const { ui } = await abrir();
    await asentar(FUSIBLE_DE_RETOMA_MS - 500);
    expect(ui.estadoDeLaCuenta().estado).toBe("retomando");
    await asentar(1_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("fuera");
  });

  it("una sesión que vuelve a tiempo se abre sin pasar por Entrar", async () => {
    h.tarda = 2_000;
    const { ui } = await abrir();
    await asentar(2_500);
    expect(ui.currentSession()?.address).toBe(DIR);
    expect(h.conexiones).toBe(0);
  });
});

describe("la retoma tardía contra una entrada nueva", () => {
  it("si la persona ya entró de nuevo cuando la retoma llega, gana la sesión que ya está y no se abre nada dos veces", async () => {
    const { ui } = await abrir();
    await asentar(9_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("fuera");
    const entro = ui.entrar();
    await asentar(10);
    await entro;
    expect(ui.currentSession()?.address).toBe(OTRA);
    expect(h.activaciones).toBe(1);
    await asentar(15_000);
    expect(ui.currentSession()?.address, "la retoma tardía no pisa la sesión nueva").toBe(OTRA);
    expect(h.activaciones, "y no activa la billetera otra vez").toBe(1);
  });

  it("si la ventana de Google sigue abierta cuando la retoma llega, la retoma se descarta y la entrada termina sola", async () => {
    h.conectaTarda = 30_000;
    const { ui } = await abrir();
    await asentar(9_000);
    void ui.entrar();
    await asentar(1_100);
    expect(h.conexiones).toBe(1);
    await asentar(12_000);
    expect(ui.estadoDeLaCuenta().estado, "la retoma llegó pero la entrada sigue en curso").toBe("conectando");
    expect(ui.currentSession()).toBeNull();
    expect(h.activaciones).toBe(0);
    await asentar(30_000);
    expect(ui.currentSession()?.address).toBe(OTRA);
    expect(h.activaciones).toBe(1);
  });

  it("la retoma tardía que abre la cuenta apaga el pedido de entrar que la puerta tenía puesto", async () => {
    const { ui, t } = await abrir();
    await asentar(2_000);
    ui.pedirEntrar();
    await asentar(7_000);
    expect(puerta()).toContain(t("cuentaPideGoogle"));
    await asentar(12_000);
    expect(ui.currentSession()?.address).toBe(DIR);
    expect(puertaVisible()).toBe(false);
  });
});

describe("Entrar no espera la retoma entera", () => {
  it("con la retoma en camino, Entrar sigue a Google al segundo con el toque vivo", async () => {
    const { ui } = await abrir();
    await asentar(2_000);
    expect(ui.estadoDeLaCuenta().estado).toBe("retomando");
    void ui.entrar();
    await asentar(900);
    expect(h.conexiones, "antes del segundo todavía espera").toBe(0);
    await asentar(300);
    expect(h.conexiones, "al segundo abre Google, no a los 8 ni a los 30").toBe(1);
  });

  it("si la retoma termina dentro de ese segundo, Entrar no abre Google", async () => {
    h.tarda = 2_500;
    const { ui } = await abrir();
    await asentar(2_000);
    void ui.entrar();
    await asentar(2_000);
    expect(ui.currentSession()?.address).toBe(DIR);
    expect(h.conexiones).toBe(0);
  });

  it("el pedido de entrar sigue al segundo, y cuando la retoma se suelta la puerta ofrece Entrar con el foco", async () => {
    const { ui, t } = await abrir();
    await asentar(2_000);
    ui.pedirEntrar();
    await asentar(1_200);
    expect(puerta(), "mientras la retoma sigue, la puerta lo dice").toContain(t("gateRetomando"));
    await asentar(6_000);
    expect(puerta()).toContain(t("cuentaPideGoogle"));
    expect(document.activeElement?.closest("#gate"), "el foco queda en el botón de la puerta").not.toBeNull();
  });

  it("Entrar y el pedido de entrar esperan con un solo tope corto, no con la promesa entera de la retoma", () => {
    const ui = readFileSync("src/ui/wallet-ui.ts", "utf8").replace(/\r\n/g, "\n");
    expect(ui).toMatch(/ESPERA_DE_ENTRAR_MS\s*=\s*1_000/);
    // La única espera a la promesa de la retoma es la que lleva su tope.
    const esperas = ui.match(/await retomaTerminada/g) ?? [];
    expect(esperas).toHaveLength(0);
  });
});
