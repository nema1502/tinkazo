// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoFalso } from "../../workers/cuenta/src/horizon-falso";
import { BASE, mundoFalso } from "../../workers/cuenta/src/mundo-falso";
import { setLang, t } from "../i18n";
import { abrirSaldo } from "./saldo";

vi.mock("./qr", () => ({
  pintarQr: vi.fn(async (img: HTMLImageElement, texto: string) => {
    img.dataset.qr = texto;
    return true;
  }),
}));
vi.mock("../stellar/wallet-pollar", () => ({
  pollarWallet: { cotizarRampa: vi.fn(async () => ({ quotes: [{ quoteId: "q1", amountOut: "28.41", etaSeconds: 600 }] })) },
}));

/**
 * "Cargá tu saldo" (`saldo.ts`): la guía de cuatro pasos con Meru, la dirección grande con copiar y QR, el costo dicho con
 * honestidad, y "Ya cargué" contra un Horizon y un Worker simulados.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const pago = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: YO, monto: "10.0000000", tx: "a".repeat(64), ...extra });

const dialogo = (): HTMLElement | null => document.querySelector(".dlg-card");
const textoDe = (): string => dialogo()?.textContent ?? "";
const principal = (): HTMLButtonElement => {
  const bs = document.querySelectorAll<HTMLButtonElement>(".dlg-main");
  expect(bs, "una sola acción principal").toHaveLength(1);
  return bs[0] as HTMLButtonElement;
};
const estado = (): string => document.querySelector(".dlg-estado")?.textContent ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
  setLang("es");
  vi.stubEnv("VITE_RAMPA", "meru");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("la guía de Meru", () => {
  it("son cuatro pasos en palabras de persona, con el costo dicho con honestidad", () => {
    abrirSaldo({ address: YO });
    const pasos = [...document.querySelectorAll(".saldo-pasos li")].map((li) => li.textContent);
    expect(pasos).toHaveLength(4);
    expect(pasos[0]).toContain("Descargá la app de Meru");
    expect(pasos[1]).toContain("QR de tu banco");
    expect(pasos[2]).toContain("dólares digitales (USDC)");
    expect(pasos[2]).toContain("Stellar");
    expect(pasos[3]).toContain("Ya cargué");
    const todo = textoDe();
    expect(todo).toContain("Meru cobra 1 % más 1 dólar al mandar. Tinkazo no cobra ni guarda nada.");
    expect(todo).toContain("El dinero es tuyo: queda en tu cuenta y lo retirás cuando quieras.");
    expect(todo).toContain("25 dólares o más");
  });

  it("muestra la dirección de la cuenta con la que entró, grande, con copiar y su QR", () => {
    abrirSaldo({ address: YO });
    expect(document.querySelector('[data-saldo="dir"]')?.textContent).toBe(YO);
    expect((document.querySelector('[data-saldo="qr"]') as HTMLImageElement).dataset.qr).toBe(YO);
    expect(document.querySelector('[data-saldo="copiar"]')?.textContent).toBe(t("acctCopy"));
  });

  it("copiar deja la dirección en el portapapeles y lo dice en el botón", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    abrirSaldo({ address: YO });
    const b = document.querySelector<HTMLButtonElement>('[data-saldo="copiar"]') as HTMLButtonElement;
    b.click();
    await vi.waitFor(() => expect(b.textContent).toBe(t("acctCopied")));
    expect(writeText).toHaveBeenCalledWith(YO);
  });

  it("lleva un enlace a Meru, y una sola acción principal: Ya cargué", () => {
    abrirSaldo({ address: YO });
    expect(document.querySelector<HTMLAnchorElement>('a[href="https://getmeru.com"]')?.rel).toContain("noopener");
    expect(principal().textContent).toBe("Ya cargué");
  });

  it("en inglés dice lo mismo", () => {
    setLang("en");
    abrirSaldo({ address: YO });
    expect(document.querySelectorAll(".saldo-pasos li")).toHaveLength(4);
    expect(textoDe()).toContain("Meru charges 1 % plus 1 dollar when it sends. Tinkazo charges nothing and keeps nothing.");
    expect(principal().textContent).toBe("I've added it");
  });

  it("apagada la bandera, no abre nada", () => {
    vi.stubEnv("VITE_RAMPA", "");
    abrirSaldo({ address: YO });
    expect(dialogo()).toBeNull();
  });

  it("Escape la cierra", () => {
    abrirSaldo({ address: YO });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialogo()).toBeNull();
  });
});

describe("Ya cargué", () => {
  it("si todavía no llegó nada, lo dice y se puede probar de nuevo", async () => {
    const m = await mundoFalso({ horizon: { cuentas: [YO] } });
    vi.stubGlobal("fetch", m.fetch);
    abrirSaldo({ address: YO });
    const b = principal();
    b.click();
    expect(estado()).toBe(t("saldoMirando"));
    expect(b.disabled).toBe(true);
    await vi.waitFor(() => expect(estado()).toContain("Todavía no los vemos"));
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe("Ya cargué");
  });

  it("si llegó un pago de USDC de 1 o más, dice 'Tus primeros dólares digitales llegaron' y pide las monedas", async () => {
    vi.stubEnv("VITE_MONEDAS", "1");
    vi.stubEnv("VITE_CUENTA_URL", BASE);
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    vi.stubGlobal("fetch", m.fetch);
    abrirSaldo({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("Tus primeros dólares digitales llegaron"));
    expect(estado()).toContain("Sumaste 50 monedas de regalo.");
    expect(m.guardada(YO)?.saldo).toBe(50);
    // El botón pasa a cerrar: una sola acción, siempre.
    expect(principal().textContent).toBe(t("acctClose"));
    principal().click();
    expect(dialogo()).toBeNull();
  });

  it("con las monedas apagadas igual avisa que llegaron los dólares, sin hablar de monedas", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    vi.stubGlobal("fetch", m.fetch);
    abrirSaldo({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toBe("Tus primeros dólares digitales llegaron"));
  });

  it("con Horizon caído no afirma nada", async () => {
    const m = await mundoFalso({ horizon: { caido: true } });
    vi.stubGlobal("fetch", m.fetch);
    abrirSaldo({ address: YO });
    principal().click();
    await vi.waitFor(() => expect(estado()).toContain("No pudimos mirar tu cuenta"));
  });
});

describe("con Pollar", () => {
  beforeEach(() => vi.stubEnv("VITE_RAMPA", "pollar"));

  it("muestra el precio de cargar desde acá, avisa que todavía no se puede y deja la guía de Meru", async () => {
    abrirSaldo({ address: YO });
    expect(document.querySelectorAll(".saldo-pasos li")).toHaveLength(4);
    expect((document.querySelector('[data-saldo="cargar"]') as HTMLButtonElement).disabled).toBe(true);
    expect(textoDe()).toContain("Cargar sin salir de Tinkazo todavía no está listo");
    (document.querySelector('[data-saldo="ver"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-saldo="cotizacion"]')?.textContent).toContain("Recibirías unos 28,41 dólares digitales."));
    expect(document.querySelector('[data-saldo="cotizacion"]')?.textContent).toContain("Tarda unos 10 minutos.");
    // Sigue habiendo una sola acción principal.
    expect(principal().textContent).toBe("Ya cargué");
  });
});
