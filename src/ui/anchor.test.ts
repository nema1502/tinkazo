import { nativeToScVal } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selloSinGrabar, type AnchorStep, type SealResult } from "./anchor";

/**
 * `sealOnChain` con las piezas de afuera reemplazadas: el cliente del contrato, la
 * wallet activa, el grifo y el saldo. Lo que se mira es la conexión de la ayuda de
 * fondos: qué ve la pantalla (los pasos), qué se le pide al grifo y cuándo, y que
 * una wallet que no es de Pollar siga como estaba.
 */
const h = vi.hoisted(() => ({
  red: { name: "testnet" as "testnet" | "mainnet", friendbotUrl: "https://friendbot.stellar.org" as string | null },
  wallet: null as null | Record<string, unknown>,
  seal: vi.fn(),
  accountExists: vi.fn(),
  fundWithFriendbot: vi.fn(),
  xlmBalance: vi.fn(),
}));

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      return { ...real.network, name: h.red.name, friendbotUrl: h.red.friendbotUrl };
    },
  };
});
vi.mock("../stellar/contract", async (orig) => {
  const real = await orig<typeof import("../stellar/contract")>();
  return {
    ...real,
    getClient: async () => ({ seal: h.seal }),
    server: { pollTransaction: async () => ({ status: "SUCCESS", returnValue: nativeToScVal(7n, { type: "u64" }) }) },
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => {
  const real = await orig<typeof import("../stellar/wallet-lite")>();
  return {
    ...real,
    activeWallet: () => h.wallet,
    accountExists: h.accountExists,
    fundWithFriendbot: h.fundWithFriendbot,
    xlmBalance: h.xlmBalance,
  };
});

const DIR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const ARGS = { organizer: DIR, listHash: new Uint8Array(32), count: 5, numWinners: 1, round: 123, meta: "premio" };

/** La transacción ya simulada: con su tope de comisión (0,75 XLM) y lista para entregar. */
const txSimulada = () => ({ built: { fee: "7500000" }, simulationData: {}, toXDR: () => "AAAA", signAndSend: vi.fn() });
/**
 * La de una simulación que falló: `client.seal()` no lanza, devuelve la transacción sin armar, y el SDK
 * recién se queja al leer `simulationData` (que es lo que hace su `signAndSend`).
 */
const txConSimulacionFallida = (error: string, lecturas = { n: 0 }) => ({
  built: { fee: "100" },
  get simulationData(): never {
    lecturas.n++;
    throw new Error(`Transaction simulation failed: "${error}"`);
  },
  toXDR: () => "SIN-ARMAR",
  signAndSend: vi.fn(),
});
const sinSaldo = () => new Error("txInsufficientBalance");

const pollar = (signAndSubmit = vi.fn(async () => "deadbeef")) => ({ kind: "external", address: DIR, submitsItself: true, signAndSubmit });

/** Corre el sellado y devuelve lo que vio la pantalla, en orden, y cómo terminó. */
async function sellar(): Promise<{ pasos: [AnchorStep, string | undefined][]; r?: SealResult; error?: unknown }> {
  const { sealOnChain } = await import("./anchor");
  const pasos: [AnchorStep, string | undefined][] = [];
  try {
    const r = await sealOnChain(ARGS, (paso, detalle) => void pasos.push([paso, detalle]));
    return { pasos, r };
  } catch (error) {
    return { pasos, error };
  }
}

let eventos: string[];
beforeEach(() => {
  vi.resetModules();
  h.red.name = "testnet";
  h.red.friendbotUrl = "https://friendbot.stellar.org";
  h.wallet = null;
  h.seal.mockReset().mockImplementation(async () => txSimulada());
  h.accountExists.mockReset().mockResolvedValue(true);
  h.fundWithFriendbot.mockReset().mockResolvedValue(undefined);
  h.xlmBalance.mockReset().mockResolvedValue(10_000);
  eventos = [];
  vi.stubGlobal("document", { dispatchEvent: (e: Event) => void eventos.push(e.type) });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("con una cuenta de Pollar", () => {
  it("no muestra la comisión al firmar: quizá la paga la app", async () => {
    h.wallet = pollar();
    const { pasos, r } = await sellar();
    expect(r?.txHash).toBe("deadbeef");
    expect(pasos).toContainEqual(["signing", undefined]);
    expect(pasos.some(([, detalle]) => detalle?.includes("XLM"))).toBe(false);
  });

  it("si Pollar paga la comisión, el sellado entra a la primera: ni grifo, ni 'preparando', ni caja de fondos", async () => {
    h.wallet = pollar();
    const { pasos } = await sellar();
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });

  it("sin saldo en testnet: lo cuenta, carga la cuenta con el grifo una vez y reintenta una vez", async () => {
    const enviar = vi.fn().mockRejectedValueOnce(sinSaldo()).mockResolvedValueOnce("deadbeef");
    h.wallet = pollar(enviar);
    const { pasos, r } = await sellar();
    expect(r?.txHash).toBe("deadbeef");
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).toHaveBeenCalledWith(DIR);
    expect(h.seal).toHaveBeenCalledTimes(2);
    expect(enviar).toHaveBeenCalledTimes(2);
    // Lo que ve la pantalla: arma, firma (sin costo), prepara la cuenta, y vuelve a armar y firmar.
    expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "funding", "simulating", "signing", "sending", "confirmed"]);
    expect(eventos).toEqual([]);
  });

  it("si la cuenta todavía no existe, le da unos segundos a Pollar antes de abrirla con el grifo", async () => {
    h.accountExists.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    h.wallet = pollar(vi.fn().mockRejectedValueOnce(new Error("Account not found: " + DIR)).mockResolvedValueOnce("deadbeef"));
    const { r } = await sellar();
    expect(r?.txHash).toBe("deadbeef");
    expect(h.accountExists.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
  });

  it("si el grifo no contesta: el error de verdad y la caja de fondos, sin reintentar", async () => {
    h.fundWithFriendbot.mockRejectedValue(new Error("friendbot-failed"));
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { error } = await sellar();
    expect((error as Error).message).toContain("txInsufficientBalance");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["tinkazo:sin-fondos"]);
  });

  it("si después del grifo sigue sin saldo: lo intenta dos veces en total y pide la caja de fondos", async () => {
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { error } = await sellar();
    expect(error).toBeInstanceOf(Error);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["tinkazo:sin-fondos"]);
  });

  it("no insiste con el grifo: si ya se le pidió a esta cuenta hace poco, va directo a la caja de fondos", async () => {
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    await sellar();
    await sellar();
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["tinkazo:sin-fondos", "tinkazo:sin-fondos"]);
  });

  it("en mainnet nunca hay grifo: no se pide nada, se dice y se muestra la caja de fondos", async () => {
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { pasos, error } = await sellar();
    expect(error).toBeInstanceOf(Error);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual(["tinkazo:sin-fondos"]);
  });

  it("si la simulación falló (la ronda quedó cerca) no manda una transacción sin armar: lanza el error del contrato", async () => {
    const enviar = vi.fn(async () => "deadbeef");
    h.wallet = pollar(enviar);
    h.seal.mockImplementation(async () => txConSimulacionFallida("HostError: Error(Contract, #5)"));
    const { error } = await sellar();
    expect(enviar).not.toHaveBeenCalled();
    expect((error as Error).message).toContain("Error(Contract, #5)");
    // Con ese mensaje freeze.ts reintenta con otra ronda, igual que con las otras wallets.
    expect(selloSinGrabar(error)).toBe(true);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it("si tras cargar la cuenta la ronda quedó cerca, sale ese error y no la caja de fondos: ya hay saldo", async () => {
    const enviar = vi.fn().mockRejectedValueOnce(sinSaldo());
    h.wallet = pollar(enviar);
    h.seal.mockImplementationOnce(async () => txSimulada()).mockImplementationOnce(async () => txConSimulacionFallida("HostError: Error(Contract, #5)"));
    const { error } = await sellar();
    expect((error as Error).message).toContain("Error(Contract, #5)");
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual([]);
    expect(selloSinGrabar(error)).toBe(true);
  });

  it("un error de otro tipo no se reintenta ni toca el grifo", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    h.wallet = pollar(enviar);
    const { error } = await sellar();
    expect((error as Error).message).toBe("Failed to fetch");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });
});

describe("con cualquier otra wallet (Freighter, cuenta de prueba)", () => {
  /** Una wallet que firma acá y envía el SDK: no es de Pollar. */
  const otra = { kind: "external", address: DIR, signTransaction: vi.fn() };

  it("muestra la comisión al firmar, como siempre", async () => {
    h.wallet = otra;
    h.seal.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => ({ result: 9n, sendTransactionResponse: { hash: "ab12" } }) }));
    const { pasos } = await sellar();
    const firma = pasos.find(([p]) => p === "signing");
    expect(firma?.[1]).toMatch(/0,75|0\.75/);
    expect(firma?.[1]).toContain("XLM");
  });

  it("no cambia nada con la simulación: la revisa el SDK al firmar, no esta capa", async () => {
    h.wallet = otra;
    const lecturas = { n: 0 };
    h.seal.mockImplementation(async () => {
      // Sin copiar el objeto con `...`: eso ejecutaría el getter y contaría una lectura que no es de la app.
      const tx = txConSimulacionFallida("HostError: Error(Contract, #5)", lecturas);
      tx.signAndSend = (async () => ({ result: 9n, sendTransactionResponse: { hash: "ab12" } })) as never;
      return tx;
    });
    await sellar();
    expect(lecturas.n).toBe(0);
  });

  it("sin saldo, el error sale tal cual: sin grifo, sin reintento y sin caja de fondos", async () => {
    h.wallet = otra;
    h.seal.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => Promise.reject(sinSaldo()) }));
    const { pasos, error } = await sellar();
    expect((error as Error).message).toBe("txInsufficientBalance");
    expect(h.seal).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });
});

describe("selloSinGrabar: cuándo se reintenta el sello con otra ronda", () => {
  it.each([
    ["la ronda quedó cerca, al simular", new Error("HostError: Error(Contract, #5)")],
    ["entró y falló (SDK de Stellar)", new Error("Transaction failed!")],
    ["entró y falló (esta capa)", new Error("tx-FAILED")],
    ["entró y falló (Pollar)", new Error("txFailed")],
    ["entró y falló (Pollar, con el código de API)", new Error("txFailed · TX_SUBMIT_FAILED")],
  ])("sí: %s", (_nombre, error) => {
    expect(selloSinGrabar(error)).toBe(true);
  });

  it.each([
    ["no hay saldo: lo resuelve la ayuda de fondos, no una ronda nueva", new Error("txInsufficientBalance")],
    ["un corte de red: no se sabe si el primero quedó grabado", new Error("Failed to fetch")],
    ["un plazo vencido: tampoco", new Error("tx-NOT_FOUND")],
    ["el contrato lo rechazó por otra razón", new Error("HostError: Error(Contract, #3)")],
    ["la comisión quedó corta", new Error("txInsufficientFee")],
  ])("no: %s", (_nombre, error) => {
    expect(selloSinGrabar(error)).toBe(false);
  });
});
