import { nativeToScVal } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { selloSinGrabar, type AnchorStep, type DrawResult, type SealResult } from "./anchor";

// La primera prueba paga la carga en frío del SDK de Stellar (cada una vuelve a cargar
// `anchor` con `vi.resetModules()`). Con la máquina ocupada, 5 s no alcanzaban (20 de
// octubre de 2026: 60 s de transformación entre todos los archivos, y esa prueba se cayó).
vi.setConfig({ testTimeout: 30_000 });

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
  draw: vi.fn(),
  poll: vi.fn(),
  accountOnRpc: vi.fn(),
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
    getClient: async () => ({ seal: h.seal, draw: h.draw }),
    server: { pollTransaction: (...a: unknown[]) => h.poll(...a) },
    accountOnRpc: h.accountOnRpc,
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => {
  const real = await orig<typeof import("../stellar/wallet-lite")>();
  return {
    ...real,
    activeWallet: () => h.wallet,
    fundWithFriendbot: h.fundWithFriendbot,
    xlmBalance: h.xlmBalance,
  };
});

const DIR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
/** Los argumentos del sello, con la ronda que elegiría `freeze.ts` ahora mismo: 45 s de margen. */
const argsDeAhora = () => ({ organizer: DIR, listHash: new Uint8Array(32), count: 5, numWinners: 1, round: targetRound(Date.now() / 1000, 45), meta: "premio" });

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
async function sellar(args = argsDeAhora()): Promise<{ pasos: [AnchorStep, string | undefined][]; r?: SealResult; error?: unknown }> {
  const { sealOnChain } = await import("./anchor");
  const pasos: [AnchorStep, string | undefined][] = [];
  try {
    const r = await sealOnChain(args, (paso, detalle) => void pasos.push([paso, detalle]));
    return { pasos, r };
  } catch (error) {
    return { pasos, error };
  }
}

/** Lo que devuelve el contrato al sortear: los números que ganaron y la semilla. */
const resultadoDelSorteo = () => ({ status: "SUCCESS", returnValue: nativeToScVal({ winners: [1, 2], randomness: new Uint8Array(32) }) });

/** Corre el sorteo en la cadena y devuelve lo que vio la pantalla, en orden, y cómo terminó. */
async function sortear(): Promise<{ pasos: [AnchorStep, string | undefined][]; r?: DrawResult; error?: unknown }> {
  const { drawOnChain } = await import("./anchor");
  const pasos: [AnchorStep, string | undefined][] = [];
  try {
    const r = await drawOnChain(5n, new Uint8Array(96), (paso, detalle) => void pasos.push([paso, detalle]));
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
  h.draw.mockReset().mockImplementation(async () => txSimulada());
  // Lo que la red devuelve al confirmar: el número del sorteo, que es lo que lee `seal`.
  h.poll.mockReset().mockImplementation(async () => ({ status: "SUCCESS", returnValue: nativeToScVal(7n, { type: "u64" }) }));
  h.accountOnRpc.mockReset().mockResolvedValue(true);
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

  it("antes de simular mira una sola vez si la cuenta existe, y si existe no dice nada ni espera", async () => {
    h.wallet = pollar();
    const { pasos } = await sellar();
    expect(h.accountOnRpc).toHaveBeenCalledTimes(1);
    expect(h.accountOnRpc).toHaveBeenCalledWith(DIR);
    expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "sending", "confirmed"]);
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

  it("en mainnet nunca hay grifo: no se pide nada, no se reintenta y no sale la caja de fondos", async () => {
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { pasos, error } = await sellar();
    // Quien entra con Google o con un correo ve el mensaje de falta de saldo y nada más:
    // la caja que pide copiar una dirección y mandarle XLM no es para ella.
    expect((error as Error).message).toContain("txInsufficientBalance");
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
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

/**
 * Una cuenta de Pollar la abre Pollar de fondo después de entrar y tarda de 5 a 62 segundos.
 * Con el reloj de mentira: la espera de 90 segundos no se espera de verdad.
 */
describe("una cuenta de Pollar que todavía no existe en la red", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  /** Deja correr el reloj de mentira hasta que la corrida termina, y dice cuánto pasó. */
  async function correr<T>(corrida: Promise<T>, hastaMs = 150_000): Promise<T & { transcurrido: number }> {
    const t0 = Date.now();
    let listo = false;
    void corrida.then(
      () => (listo = true),
      () => (listo = true),
    );
    // Las piezas de afuera se cargan con import(): el reloj de mentira avanza de a poco.
    for (let t = 0; t < hastaMs && !listo; t += 250) await vi.advanceTimersByTimeAsync(250);
    expect(listo).toBe(true);
    return { ...(await corrida), transcurrido: Date.now() - t0 };
  }

  /** Un `document` que además guarda los oyentes, para poder avisar que la sesión cambió. */
  function documentoConOyentes() {
    const oyentes = new Map<string, Set<(e: Event) => void>>();
    vi.stubGlobal("document", {
      dispatchEvent: (e: Event) => {
        if (e.type === "tinkazo:sin-fondos") eventos.push(e.type);
        for (const f of oyentes.get(e.type) ?? []) f(e);
      },
      addEventListener: (tipo: string, f: (e: Event) => void) => {
        if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
        oyentes.get(tipo)?.add(f);
      },
      removeEventListener: (tipo: string, f: (e: Event) => void) => void oyentes.get(tipo)?.delete(f),
    });
    return {
      oyentes: (tipo: string) => oyentes.get(tipo)?.size ?? 0,
      avisarSesion: (detail: string | null) => document.dispatchEvent(new CustomEvent("tinkazo:sesion", { detail })),
    };
  }

  const noExiste = () => new Error("Account not found: " + DIR);

  it("espera a que exista ANTES de simular: lo cuenta con 'Preparando tu cuenta…' y sella cuando aparece", async () => {
    h.accountOnRpc.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    h.wallet = pollar();
    const { pasos, r } = await correr(sellar());
    expect(r?.txHash).toBe("deadbeef");
    expect(h.accountOnRpc).toHaveBeenCalledTimes(3);
    // "Preparando" va primero, antes de la primera simulación, y una sola vez.
    expect(pasos.map(([p]) => p)).toEqual(["preparing", "simulating", "signing", "sending", "confirmed"]);
    expect(h.seal).toHaveBeenCalledTimes(1);
    const { stepLabel } = await import("./anchor");
    expect(stepLabel("preparing")).toBe("Preparando tu cuenta…");
    // No era falta de saldo: nada de grifo ni de caja de fondos.
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it("espera también antes de sortear, no solo antes de sellar", async () => {
    h.accountOnRpc.mockResolvedValueOnce(false).mockResolvedValue(true);
    h.wallet = pollar();
    h.draw.mockRejectedValue(new Error("se corta acá: lo que se mira es el orden"));
    const { drawOnChain } = await import("./anchor");
    const pasos: AnchorStep[] = [];
    await correr(drawOnChain(1n, new Uint8Array(96), (p) => void pasos.push(p)).catch(() => undefined));
    expect(pasos).toEqual(["preparing", "simulating"]);
    expect(h.accountOnRpc.mock.invocationCallOrder[0]).toBeLessThan(h.draw.mock.invocationCallOrder[0] as number);
  });

  it.each(["testnet", "mainnet"] as const)(
    "si a los 90 segundos no existe (%s): 'todavía no está lista', sin simular, sin grifo y sin caja de fondos",
    async (red) => {
      h.red.name = red;
      h.red.friendbotUrl = red === "testnet" ? "https://friendbot.stellar.org" : null;
      h.accountOnRpc.mockResolvedValue(false);
      h.wallet = pollar();
      const { pasos, error, transcurrido } = await correr(sellar());
      expect((error as Error).message).toBe("account-not-ready");
      const { anchorErrorText } = await import("./anchor");
      // No es "sin saldo" ni "la red rechazó la transacción".
      expect(await anchorErrorText(error)).toBe("Tu cuenta todavía no está lista. Probá de nuevo en un minuto.");
      expect(transcurrido).toBeGreaterThanOrEqual(90_000);
      expect(transcurrido).toBeLessThan(92_000);
      expect(pasos.map(([p]) => p)).toEqual(["preparing"]);
      expect(h.seal).not.toHaveBeenCalled();
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    },
  );

  it("la línea de estado y el mensaje están en los dos idiomas", async () => {
    const { T } = await import("../i18n");
    expect(T.es["errAnchor.accountNotReady"]).toBe("Tu cuenta todavía no está lista. Probá de nuevo en un minuto.");
    expect(T.en["errAnchor.accountNotReady"]).toBe("Your account isn't ready yet. Try again in a minute.");
    expect(T.es.txPreparing).toBe("Preparando tu cuenta…");
    expect(T.en.txPreparing).toBe("Setting up your account…");
  });

  it("mira a lo sumo una vez por segundo", async () => {
    const cuando: number[] = [];
    h.accountOnRpc.mockImplementation(async () => {
      cuando.push(Date.now());
      return false;
    });
    h.wallet = pollar();
    await correr(sellar());
    expect(cuando.length).toBeGreaterThan(80);
    const entre = cuando.slice(1).map((t, i) => t - (cuando[i] as number));
    expect(Math.min(...entre)).toBeGreaterThanOrEqual(1000);
  });

  it("un corte de red a ratos no corta la espera", async () => {
    h.accountOnRpc.mockRejectedValueOnce(new Error("Failed to fetch")).mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(false).mockResolvedValue(true);
    h.wallet = pollar();
    const { r, pasos } = await correr(sellar());
    expect(r?.txHash).toBe("deadbeef");
    expect(pasos.map(([p]) => p)[0]).toBe("preparing");
  });

  it("si la red no contesta en los 90 segundos, se dice como red caída y no como 'sin saldo'", async () => {
    h.accountOnRpc.mockRejectedValue(new Error("Failed to fetch"));
    h.wallet = pollar();
    const { error } = await correr(sellar());
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(error)).toBe("No pude hablar con la red de Stellar. Probá de nuevo.");
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  describe("la espera se comió el margen de la ronda", () => {
    /** La cuenta aparece al cabo de `segundos` de preguntar una vez por segundo. */
    const apareceA = (segundos: number) => {
      for (let i = 0; i < segundos; i++) h.accountOnRpc.mockResolvedValueOnce(false);
      h.accountOnRpc.mockResolvedValue(true);
    };

    it("con una espera larga no manda el sello (iba a entrar al ledger y fallar con RoundTooSoon): pide otra ronda, como el contrato", async () => {
      apareceA(12);
      h.wallet = pollar();
      const { pasos, error } = await correr(sellar());
      expect((error as Error).message).toContain("Error(Contract, #5)");
      // Lo que hace freeze.ts: lo reconoce y reintenta con otra ronda, sin que haya quedado nada en la cadena.
      const { selloSinGrabar, anchorErrorText } = await import("./anchor");
      expect(selloSinGrabar(error)).toBe(true);
      expect(await anchorErrorText(error)).toBe("Esa ronda está demasiado cerca. Probá de nuevo.");
      // Ni simuló, ni firmó, ni mandó nada.
      expect(pasos.map(([p]) => p)).toEqual(["preparing"]);
      expect(h.seal).not.toHaveBeenCalled();
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    });

    it("el reintento de freeze.ts, con la ronda nueva y la cuenta ya abierta, sella sin esperar", async () => {
      apareceA(12);
      const enviar = vi.fn(async () => "deadbeef");
      h.wallet = pollar(enviar);
      const primero = await correr(sellar());
      expect(primero.error).toBeDefined();
      const { r, pasos } = await correr(sellar());
      expect(r?.txHash).toBe("deadbeef");
      expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "sending", "confirmed"]);
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it("con una espera corta (la mediana de Pollar, 7 s) todavía alcanza y sella a la primera", async () => {
      apareceA(2);
      h.wallet = pollar();
      const { r, pasos } = await correr(sellar());
      expect(r?.txHash).toBe("deadbeef");
      expect(pasos.map(([p]) => p)).toEqual(["preparing", "simulating", "signing", "sending", "confirmed"]);
    });
  });

  describe("la red la mostró pero simular dice 'Account not found'", () => {
    it("un respiro, se mira otra vez y se reintenta una vez: si ahora sale bien, sella", async () => {
      h.wallet = pollar();
      h.seal.mockRejectedValueOnce(noExiste()).mockImplementation(async () => txSimulada());
      const { r } = await correr(sellar());
      expect(r?.txHash).toBe("deadbeef");
      expect(h.seal).toHaveBeenCalledTimes(2);
      expect(h.accountOnRpc.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });

    it("si sigue igual: 'todavía no está lista', y NO el grifo, aunque sea testnet con el grifo prendido", async () => {
      h.wallet = pollar();
      h.seal.mockRejectedValue(noExiste());
      const { error } = await correr(sellar());
      expect((error as Error).message).toBe("account-not-ready");
      expect(h.seal).toHaveBeenCalledTimes(2);
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });

    it("lo mismo si el que lo dice es el servidor de Pollar al recibir la transacción", async () => {
      const enviar = vi.fn().mockRejectedValue(new Error("txNoAccount"));
      h.wallet = pollar(enviar);
      const { error } = await correr(sellar());
      expect((error as Error).message).toBe("account-not-ready");
      expect(enviar).toHaveBeenCalledTimes(2);
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });
  });

  describe("se puede cancelar", () => {
    it("si se cierra la sesión mientras se espera, deja de esperar y deja de preguntarle a la red", async () => {
      const doc = documentoConOyentes();
      h.accountOnRpc.mockResolvedValue(false);
      h.wallet = pollar();
      const corrida = sellar();
      await vi.advanceTimersByTimeAsync(3500);
      const preguntas = h.accountOnRpc.mock.calls.length;
      expect(preguntas).toBeGreaterThanOrEqual(2);
      expect(doc.oyentes("tinkazo:sesion")).toBe(1);
      doc.avisarSesion(null);
      await vi.advanceTimersByTimeAsync(1000);
      const { error } = await corrida;
      expect((error as Error).message).toBe("account-wait-cancelled");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.accountOnRpc.mock.calls.length).toBeLessThanOrEqual(preguntas + 1);
      expect(h.seal).not.toHaveBeenCalled();
      expect(doc.oyentes("tinkazo:sesion")).toBe(0);
    });

    it("si se entra con otra cuenta, también", async () => {
      const doc = documentoConOyentes();
      h.accountOnRpc.mockResolvedValue(false);
      h.wallet = pollar();
      const corrida = sellar();
      await vi.advanceTimersByTimeAsync(2500);
      doc.avisarSesion("GOTRACUENTA");
      await vi.advanceTimersByTimeAsync(1000);
      expect(((await corrida).error as Error).message).toBe("account-wait-cancelled");
    });

    it("repintar la pantalla con la misma cuenta (cambiar de idioma) no cancela nada", async () => {
      const doc = documentoConOyentes();
      h.accountOnRpc.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
      h.wallet = pollar();
      const corrida = sellar();
      await vi.advanceTimersByTimeAsync(1500);
      doc.avisarSesion(DIR);
      const { r } = await correr(corrida);
      expect(r?.txHash).toBe("deadbeef");
    });

    it("no deja oyentes colgados cuando termina, salga como salga", async () => {
      const doc = documentoConOyentes();
      h.wallet = pollar();
      await correr(sellar());
      expect(doc.oyentes("tinkazo:sesion")).toBe(0);
      h.accountOnRpc.mockResolvedValue(false);
      await correr(sellar());
      expect(doc.oyentes("tinkazo:sesion")).toBe(0);
    });
  });
});

/**
 * La caja de fondos es la que pide copiar una dirección y mandarle XLM. Quien entra con Google o
 * con un correo no tiene por qué verla en mainnet, pase lo que pase: ahí ve el mensaje de lo que
 * pasó, y nada más.
 */
describe("en mainnet una cuenta de Pollar nunca ve la caja de fondos", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
  });
  afterEach(() => vi.useRealTimers());

  async function correr<T>(corrida: Promise<T>): Promise<T> {
    let listo = false;
    void corrida.then(
      () => (listo = true),
      () => (listo = true),
    );
    for (let t = 0; t < 200_000 && !listo; t += 250) await vi.advanceTimersByTimeAsync(250);
    return corrida;
  }

  it.each([
    ["sin saldo (como lo guarda Pollar)", () => new Error("txInsufficientBalance")],
    ["sin saldo (como lo dice la red)", () => new Error("tx_insufficient_balance")],
    ["sin saldo (el texto de Pollar)", () => new Error("Insufficient XLM to cover the network fee and minimum reserve.")],
    ["un pago que no alcanza", () => new Error("op_underfunded")],
    ["comisión corta", () => new Error("txInsufficientFee")],
    ["secuencia corrida", () => new Error("tx_bad_seq")],
    ["la cuenta no existe", () => new Error("Account not found: " + DIR)],
    ["la cuenta no existe (al enviar)", () => new Error("txNoAccount")],
    ["la red caída", () => new Error("Failed to fetch")],
    ["la ronda quedó cerca", () => new Error("HostError: Error(Contract, #5)")],
    ["algo que nadie esperaba", () => new Error("boom")],
  ])("%s", async (_nombre, hacer) => {
    h.wallet = pollar(vi.fn().mockRejectedValue(hacer()));
    const { error } = await correr(sellar());
    expect(error).toBeInstanceOf(Error);
    expect(eventos).toEqual([]);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
  });

  it("tampoco con la cuenta sin abrir al cabo de los 90 segundos", async () => {
    h.accountOnRpc.mockResolvedValue(false);
    h.wallet = pollar();
    await correr(sellar());
    expect(eventos).toEqual([]);
  });

  it("la falta de saldo se le dice tal cual, sin mandarla a ningún lado", async () => {
    h.wallet = pollar(vi.fn().mockRejectedValue(new Error("txInsufficientBalance")));
    const { error } = await correr(sellar());
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red.");
  });
});

describe("una comisión corta no es falta de saldo", () => {
  it.each(["tx_insufficient_fee", "txInsufficientFee", "txINSUFFICIENT_FEE"])("%s: no prende el grifo, no reintenta y no sale la caja de fondos", async (codigo) => {
    const enviar = vi.fn().mockRejectedValue(new Error(codigo));
    h.wallet = pollar(enviar);
    const { error } = await sellar();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
    const { anchorErrorText } = await import("./anchor");
    // "La red estaba ocupada": hay que probar de nuevo, no conseguir XLM.
    expect(await anchorErrorText(error)).toBe("La red estaba ocupada y no tomó la transacción. Probá de nuevo en unos segundos.");
  });

  it("y la secuencia corrida (tx_bad_seq) tampoco", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("tx_bad_seq"));
    h.wallet = pollar(enviar);
    await sellar();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });
});

/**
 * El contrato rechaza una ronda que nazca a menos de 30 s de la entrada al ledger. Al empezar a
 * armar el sello tienen que faltar al menos 40: lo que sobra de los 45 que da `freeze.ts` alcanza
 * para simular, firmar y entrar. Con el reloj fijo, para medirlo al segundo.
 */
describe("el margen de la ronda al empezar a armar el sello", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  /** Una ronda y el instante en que faltan exactamente `faltan` segundos para que nazca. */
  function conMargen(faltan: number) {
    const round = targetRound(Math.floor(Date.now() / 1000), 45);
    vi.setSystemTime((roundTime(round) - faltan) * 1000);
    return { ...argsDeAhora(), round };
  }

  it.each([45, 44, 41, 40])("faltan %s s: alcanza, se arma el sello", async (faltan) => {
    h.wallet = pollar();
    const { r } = await sellar(conMargen(faltan));
    expect(r?.txHash).toBe("deadbeef");
  });

  it.each([39.9, 35, 30, 29, 10, 0, -5])("faltan %s s: no alcanza, se pide otra ronda antes de mandar nada", async (faltan) => {
    h.wallet = pollar();
    const { error, pasos } = await sellar(conMargen(faltan));
    expect((error as Error).message).toContain("Error(Contract, #5)");
    expect(pasos).toEqual([]);
    expect(h.seal).not.toHaveBeenCalled();
  });

  it("vale para cualquier wallet, no solo Pollar: el margen se come también con una librería que tarda en bajar", async () => {
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    const { error } = await sellar(conMargen(20));
    expect((error as Error).message).toContain("Error(Contract, #5)");
    expect(h.seal).not.toHaveBeenCalled();
  });

  it("lo reconoce selloSinGrabar y lo cuenta errorKey como 'ronda cerca'", async () => {
    h.wallet = pollar();
    const { error } = await sellar(conMargen(10));
    const { selloSinGrabar, anchorErrorText } = await import("./anchor");
    expect(selloSinGrabar(error)).toBe(true);
    expect(await anchorErrorText(error)).toBe("Esa ronda está demasiado cerca. Probá de nuevo.");
  });
});

describe("con ?grifo=0 (testnet, el grifo apagado a propósito)", () => {
  /** La pestaña con el parámetro en la dirección, como si recién se hubiera abierto la página. */
  const conGrifoApagado = (search = "?grifo=0") => {
    vi.stubGlobal("location", { search });
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  };

  it("sin saldo: el error sale tal cual, sin pedirle nada al grifo, sin reintento, sin 'preparando' y sin caja de fondos", async () => {
    conGrifoApagado();
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { pasos, error } = await sellar();
    expect((error as Error).message).toContain("txInsufficientBalance");
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(h.xlmBalance).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(h.seal).toHaveBeenCalledTimes(1);
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });

  it("el error que ve la persona es el de falta de saldo, tal cual", async () => {
    conGrifoApagado();
    h.wallet = pollar(vi.fn().mockRejectedValue(sinSaldo()));
    const { error } = await sellar();
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red.");
  });

  it("si Pollar paga la comisión, sella igual que siempre: con la cuenta en 0 y sin tocar el grifo", async () => {
    conGrifoApagado();
    h.wallet = pollar();
    const { r, pasos } = await sellar();
    expect(r?.txHash).toBe("deadbeef");
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "sending", "confirmed"]);
    expect(eventos).toEqual([]);
  });

  it("?grifo=1 lo prende de nuevo: el reintento con el grifo vuelve a andar", async () => {
    conGrifoApagado("?grifo=1");
    h.wallet = pollar(vi.fn().mockRejectedValueOnce(sinSaldo()).mockResolvedValueOnce("deadbeef"));
    const { r } = await sellar();
    expect(r?.txHash).toBe("deadbeef");
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
  });

  it("en mainnet el parámetro se ignora, y sigue sin haber grifo ni caja", async () => {
    conGrifoApagado();
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
    h.wallet = pollar(vi.fn().mockRejectedValue(sinSaldo()));
    const { error } = await sellar();
    expect((error as Error).message).toContain("txInsufficientBalance");
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

  it("no espera a que exista la cuenta ni se la pregunta a la red: eso es solo de Pollar", async () => {
    h.wallet = otra;
    h.accountOnRpc.mockResolvedValue(false);
    h.seal.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => ({ result: 9n, sendTransactionResponse: { hash: "ab12" } }) }));
    const { pasos } = await sellar();
    expect(h.accountOnRpc).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("preparing");
  });

  it("una cuenta que no existe sale como 'sin saldo', como siempre: no se espera ni se reintenta", async () => {
    h.wallet = otra;
    h.seal.mockRejectedValue(new Error("Account not found: " + DIR));
    const { error } = await sellar();
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red.");
    expect(h.seal).toHaveBeenCalledTimes(1);
    expect(h.accountOnRpc).not.toHaveBeenCalled();
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

  describe("si la transacción entró a un ledger y falló", () => {
    /**
     * Lo que le pasa al SDK con el protocolo 23 o posterior: la respuesta de una transacción fallida trae
     * `returnValue` como una clave sin valor, y `result` revienta al leerla. Medido contra la testnet el 20 de
     * octubre de 2026 (la ronda quedó cerca con la red lenta).
     */
    const fallada = () => ({
      sendTransactionResponse: { hash: "ab12" },
      getTransactionResponse: { status: "FAILED" },
      get result(): never {
        throw new TypeError("Cannot read properties of undefined (reading 'type')");
      },
    });

    it("el sello lo dice con tx-FAILED y no con el TypeError del SDK, así se reintenta con otra ronda", async () => {
      h.wallet = otra;
      h.seal.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => fallada() }));
      const { error } = await sellar();
      expect((error as Error).message).toBe("tx-FAILED");
      expect(selloSinGrabar(error)).toBe(true);
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });

    it("el sorteo también: sale tx-FAILED", async () => {
      h.wallet = otra;
      h.draw.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => fallada() }));
      const { error } = await sortear();
      expect((error as Error).message).toBe("tx-FAILED");
    });

    it("el TypeError del SDK sin un estado que lo explique sigue saliendo tal cual: no se disfraza lo que no se entiende", async () => {
      h.wallet = otra;
      const sinEstado = { sendTransactionResponse: { hash: "ab12" }, get result(): never { throw new TypeError("otra cosa"); } };
      h.seal.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => sinEstado }));
      const { error } = await sellar();
      expect((error as Error).message).toBe("otra cosa");
      expect(selloSinGrabar(error)).toBe(false);
    });

    it("si entró bien (SUCCESS) se lee el resultado como siempre", async () => {
      h.wallet = otra;
      h.seal.mockImplementation(async () => ({
        ...txSimulada(),
        signAndSend: async () => ({ result: 9n, sendTransactionResponse: { hash: "ab12" }, getTransactionResponse: { status: "SUCCESS" } }),
      }));
      const { r } = await sellar();
      expect(r?.raffleId).toBe(9n);
      expect(r?.txHash).toBe("ab12");
    });
  });
});

describe("el sorteo (drawOnChain) se ayuda igual que el sellado", () => {
  // Es el paso que ocurre frente a la sala, así que vale lo mismo que `seal`: se intenta, y si
  // falta saldo en testnet se carga la cuenta y se reintenta una vez, sin que nadie toque nada.
  beforeEach(() => h.poll.mockImplementation(async () => resultadoDelSorteo()));

  it("Pollar sin saldo en testnet: carga la cuenta una vez, reintenta una vez y devuelve los ganadores", async () => {
    const enviar = vi.fn().mockRejectedValueOnce(sinSaldo()).mockResolvedValueOnce("cafe");
    h.wallet = pollar(enviar);
    const { pasos, r } = await sortear();
    expect(r?.txHash).toBe("cafe");
    expect(r?.winners.map(Number)).toEqual([1, 2]);
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(h.draw).toHaveBeenCalledTimes(2);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "funding", "simulating", "signing", "sending", "confirmed"]);
    // Sin costo a la vista: quizá lo paga la app.
    expect(pasos.some(([, detalle]) => detalle?.includes("XLM"))).toBe(false);
    expect(eventos).toEqual([]);
  });

  it("si Pollar paga la comisión, sale a la primera: sin grifo, sin 'preparando' y sin caja de fondos", async () => {
    h.wallet = pollar(vi.fn(async () => "cafe"));
    const { pasos, r } = await sortear();
    expect(r?.winners.map(Number)).toEqual([1, 2]);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });

  it("si después del grifo sigue sin saldo: dos intentos en total y la caja de fondos", async () => {
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { error } = await sortear();
    expect(error).toBeInstanceOf(Error);
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["tinkazo:sin-fondos"]);
  });

  it("en mainnet nunca hay grifo ni caja de fondos: no se pide nada y el error sale tal cual", async () => {
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
    const enviar = vi.fn().mockRejectedValue(sinSaldo());
    h.wallet = pollar(enviar);
    const { error } = await sortear();
    expect(error).toBeInstanceOf(Error);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual([]);
  });

  it("con otra wallet no cambia nada: el error sale tal cual, sin grifo ni caja de fondos", async () => {
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    h.draw.mockImplementation(async () => ({ ...txSimulada(), signAndSend: async () => Promise.reject(sinSaldo()) }));
    const { pasos, error } = await sortear();
    expect((error as Error).message).toBe("txInsufficientBalance");
    expect(h.draw).toHaveBeenCalledTimes(1);
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

describe("un grifo que no contesta", () => {
  afterEach(() => vi.useRealTimers());

  it("no traba el sellado: a los 20 segundos se sigue con el último recurso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.wallet = pollar(vi.fn().mockRejectedValue(sinSaldo()));
    // El grifo se cuelga: la promesa nunca se resuelve.
    h.fundWithFriendbot.mockImplementation(() => new Promise<void>(() => undefined));
    let listo = false;
    const corrida = sellar().then((r) => {
      listo = true;
      return r;
    });
    // Las piezas de afuera se cargan con import() y el reloj de mentira avanza de a poco.
    for (let i = 0; i < 60 && !listo; i++) await vi.advanceTimersByTimeAsync(1000);
    const { error } = await corrida;
    expect(listo).toBe(true);
    expect((error as Error).message).toContain("txInsufficientBalance");
    expect(h.fundWithFriendbot).toHaveBeenCalledTimes(1);
    expect(eventos).toEqual(["tinkazo:sin-fondos"]);
  });
});
