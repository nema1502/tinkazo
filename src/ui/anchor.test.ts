import { nativeToScVal } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { type SelloIncierto, esSelloIncierto } from "../stellar/envio";
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
  /** `server.sendTransaction`: lo que contesta la red al mandar. */
  send: vi.fn(),
  /** `server.getTransaction`: lo que contesta la red al preguntar por el hash. */
  getTx: vi.fn(),
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
    server: { sendTransaction: (...a: unknown[]) => h.send(...a), getTransaction: (...a: unknown[]) => h.getTx(...a) },
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

/** El hash (en hex) de la transacción que se arma (`built`) y de la que se firma acá (`signed`), en las de mentira. */
const HASH_ARMADA = "01".repeat(32);
const HASH_FIRMADA = "02".repeat(32);
/** La hora de la red de mentira: la del reloj, en segundos. */
const cierre = () => Math.floor(Date.now() / 1000);

/**
 * La transacción ya simulada: con su tope de comisión (0,75 XLM), su hash y su vencimiento, lista para
 * entregar (Pollar) o para firmar acá (`sign` deja la firmada en `signed`, como el SDK).
 */
const txSimulada = () => {
  const tx = {
    built: { fee: "7500000", hash: () => new Uint8Array(32).fill(1), timeBounds: { maxTime: String(cierre() + 60) } },
    simulationData: {},
    toXDR: () => "AAAA",
    signed: undefined as undefined | { hash: () => Uint8Array; timeBounds: { maxTime: string } },
    sign: vi.fn(async () => {
      tx.signed = { hash: () => new Uint8Array(32).fill(2), timeBounds: { maxTime: String(cierre() + 60) } };
    }),
  };
  return tx;
};
/** Lo que contesta `getTransaction` cuando entró: con el valor que devolvió el contrato. */
const entro = (valor: unknown) => ({ status: "SUCCESS", latestLedgerCloseTime: cierre(), returnValue: valor });
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
  signed: undefined,
  // Como el SDK: firmar lee la simulación, y si falló, lanza.
  sign: vi.fn(async function (this: { simulationData: unknown }) {
    void this.simulationData;
  }),
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
const resultadoDelSorteo = () => entro(nativeToScVal({ winners: [1, 2], randomness: new Uint8Array(32) }));

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
  h.getTx.mockReset().mockImplementation(async () => entro(nativeToScVal(7n, { type: "u64" })));
  h.send.mockReset().mockImplementation(async () => ({ status: "PENDING", hash: HASH_FIRMADA, latestLedgerCloseTime: cierre() }));
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

  it("un corte al mandar no se reintenta ni toca el grifo: sale como sello incierto, con el hash de lo que se entregó", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    h.wallet = pollar(enviar);
    const { error } = await sellar();
    // No se sabe si Pollar llegó a mandarlo: freeze.ts lo averigua antes de mandar otro.
    expect(esSelloIncierto(error)).toBe(true);
    const incierto = error as SelloIncierto;
    expect(incierto.intento.hash).toBe(HASH_ARMADA);
    expect(incierto.intento.organizer).toBe(DIR);
    expect((incierto.cause as Error).message).toBe("Failed to fetch");
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
  });

  it.each([
    ["el corte de Safari", "Load failed"],
    ["el tope de 30 s de Pollar", "Request timed out after 30000ms"],
    ["un rechazo sin motivo", "pollar-submit-failed"],
    ["la red ocupada, que también contesta así cuando ya entró", "TRY_AGAIN_LATER"],
  ])("Pollar no pudo y no se sabe si mandó (%s): sello incierto", async (_nombre, mensaje) => {
    h.wallet = pollar(vi.fn().mockRejectedValue(new Error(mensaje)));
    const { error } = await sellar();
    expect(esSelloIncierto(error)).toBe(true);
  });

  it.each([
    ["sin saldo", "txInsufficientBalance"],
    ["entró y falló", "txFailed"],
    ["la secuencia", "txBadSeq"],
  ])("Pollar contestó con el resultado de la red (%s): eso no es incierto, es la red diciendo que no", async (_nombre, mensaje) => {
    h.wallet = pollar(vi.fn().mockRejectedValue(new Error(mensaje)));
    h.red.name = "mainnet";
    h.red.friendbotUrl = null;
    const { error } = await sellar();
    expect(esSelloIncierto(error)).toBe(false);
    expect((error as Error).message).toBe(mensaje);
  });

  it("Pollar la mandó y la red tarda en mostrarla: NOT_FOUND mientras sigue viva no es una falla", async () => {
    h.wallet = pollar();
    h.getTx
      .mockResolvedValueOnce({ status: "NOT_FOUND", latestLedgerCloseTime: cierre() })
      .mockResolvedValueOnce({ status: "NOT_FOUND", latestLedgerCloseTime: cierre() })
      .mockImplementation(async () => entro(nativeToScVal(7n, { type: "u64" })));
    const { r } = await sellar();
    expect(r?.raffleId).toBe(7n);
    expect(h.getTx).toHaveBeenCalledTimes(3);
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
    expect(await anchorErrorText(error)).toBe("No pude conectarme con la red de Stellar. Revisá tu conexión y probá de nuevo.");
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
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red. Cargale XLM y probá de nuevo.");
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
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red. Cargale XLM y probá de nuevo.");
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
    const { pasos } = await sellar();
    const firma = pasos.find(([p]) => p === "signing");
    expect(firma?.[1]).toMatch(/0,75|0\.75/);
    expect(firma?.[1]).toContain("XLM");
  });

  it("firma una vez, manda esa misma y lee el número del sorteo que devolvió el contrato", async () => {
    h.wallet = otra;
    const tx = txSimulada();
    h.seal.mockImplementation(async () => tx);
    h.getTx.mockImplementation(async () => entro(nativeToScVal(9n, { type: "u64" })));
    const { r, pasos } = await sellar();
    expect(r).toEqual({ raffleId: 9n, txHash: HASH_FIRMADA });
    expect(tx.sign).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.getTx).toHaveBeenCalledWith(HASH_FIRMADA);
    expect(pasos.map(([p]) => p)).toEqual(["simulating", "signing", "sending", "confirmed"]);
  });

  it("la simulación fallida la descubre el SDK al firmar: sale el error del contrato y no se manda nada", async () => {
    h.wallet = otra;
    const lecturas = { n: 0 };
    h.seal.mockImplementation(async () => txConSimulacionFallida("HostError: Error(Contract, #5)", lecturas));
    const { error } = await sellar();
    expect((error as Error).message).toContain("Error(Contract, #5)");
    expect(selloSinGrabar(error)).toBe(true);
    // Una sola lectura, la del SDK al firmar: esta capa no la lee antes con estas wallets.
    expect(lecturas.n).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("no espera a que exista la cuenta ni se la pregunta a la red: eso es solo de Pollar", async () => {
    h.wallet = otra;
    h.accountOnRpc.mockResolvedValue(false);
    const { pasos } = await sellar();
    expect(h.accountOnRpc).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("preparing");
  });

  describe("'Account not found' al armar: el SDK lo dice también ante un corte", () => {
    it("si la red dice que la cuenta no existe, es 'sin saldo', como siempre: no se espera ni se reintenta", async () => {
      h.wallet = otra;
      h.accountOnRpc.mockResolvedValue(false);
      h.seal.mockRejectedValue(new Error("Account not found: " + DIR));
      const { error } = await sellar();
      const { anchorErrorText } = await import("./anchor");
      expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red. Cargale XLM y probá de nuevo.");
      expect(h.seal).toHaveBeenCalledTimes(1);
      expect(h.accountOnRpc).toHaveBeenCalledTimes(1);
    });

    it("si la cuenta existe, fue un corte pasajero: se arma de nuevo una vez y sella", async () => {
      h.wallet = otra;
      h.accountOnRpc.mockResolvedValue(true);
      h.seal.mockRejectedValueOnce(new Error("Account not found: " + DIR)).mockImplementation(async () => txSimulada());
      const { r } = await sellar();
      expect(r?.raffleId).toBe(7n);
      expect(h.seal).toHaveBeenCalledTimes(2);
    });

    it("si la red no contesta ni para eso, es un corte de red y no 'sin saldo'", async () => {
      h.wallet = otra;
      h.accountOnRpc.mockRejectedValue(new TypeError("Failed to fetch"));
      h.seal.mockRejectedValue(new Error("Account not found: " + DIR));
      const { error } = await sellar();
      const { anchorErrorText } = await import("./anchor");
      expect(await anchorErrorText(error)).not.toBe("Tu cuenta no tiene saldo para pagar la comisión de la red. Cargale XLM y probá de nuevo.");
      const { errorKey } = await import("../stellar/errores");
      expect(errorKey(error, { enLinea: true })).toBe("rpcDown");
    });
  });

  it("una respuesta del RPC que no se entiende al armar (un portal cautivo) es un corte, no 'la red rechazó'", async () => {
    h.wallet = otra;
    h.seal.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'headerXdr')"));
    const { error } = await sellar();
    const { errorKey } = await import("../stellar/errores");
    expect(errorKey(error, { enLinea: true })).toBe("rpcDown");
  });

  it("sin saldo, la red la rechaza al recibirla: el error sale tal cual, sin grifo, sin reintento y sin caja de fondos", async () => {
    h.wallet = otra;
    h.send.mockResolvedValue({ status: "ERROR", hash: HASH_FIRMADA, errorResult: { fee_charged: "100", result: "tx_insufficient_balance", ext: "v0" } });
    const { pasos, error } = await sellar();
    expect((error as Error).message).toBe("tx-REJECTED tx_insufficient_balance");
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(error)).toBe("Tu cuenta no tiene saldo para pagar la comisión de la red. Cargale XLM y probá de nuevo.");
    expect(h.seal).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });

  describe("si la transacción entró a un ledger y falló", () => {
    beforeEach(() => h.getTx.mockResolvedValue({ status: "FAILED", latestLedgerCloseTime: cierre() }));

    it("el sello lo dice con tx-FAILED (el SDK reventaba con un TypeError), así se reintenta con otra ronda", async () => {
      h.wallet = otra;
      const { error } = await sellar();
      expect((error as Error).message).toBe("tx-FAILED");
      expect(selloSinGrabar(error)).toBe(true);
      expect(h.fundWithFriendbot).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });

    it("el sorteo también: sale tx-FAILED", async () => {
      h.wallet = otra;
      const { error } = await sortear();
      expect((error as Error).message).toBe("tx-FAILED");
    });
  });

  describe("con la red que se corta después de mandar", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
    afterEach(() => vi.useRealTimers());

    async function correr<T>(corrida: Promise<T>): Promise<T> {
      let listo = false;
      void corrida.then(
        () => (listo = true),
        () => (listo = true),
      );
      for (let t = 0; t < 120_000 && !listo; t += 250) await vi.advanceTimersByTimeAsync(250);
      return corrida;
    }

    it("un corte al mandar: reenvía la MISMA transacción firmada (sin otra ventana de la billetera) y la encuentra", async () => {
      h.wallet = otra;
      const tx = txSimulada();
      h.seal.mockImplementation(async () => tx);
      h.send.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ status: "DUPLICATE", hash: HASH_FIRMADA });
      h.getTx.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockImplementation(async () => entro(nativeToScVal(11n, { type: "u64" })));
      const { r } = await correr(sellar());
      expect(r?.raffleId).toBe(11n);
      expect(tx.sign).toHaveBeenCalledTimes(1);
      expect(h.seal).toHaveBeenCalledTimes(1);
      // Todo lo que se mandó fue lo mismo: la transacción firmada una sola vez.
      expect(new Set(h.send.mock.calls.map((c) => c[0])).size).toBe(1);
    });

    it("si la red no contesta más, el sello sale como incierto, con el hash de lo que se firmó: nunca como 'no entró'", async () => {
      h.wallet = otra;
      h.send.mockRejectedValue(new TypeError("Load failed"));
      h.getTx.mockRejectedValue(new TypeError("Load failed"));
      const { error } = await correr(sellar());
      expect(esSelloIncierto(error)).toBe(true);
      expect((error as SelloIncierto).intento.hash).toBe(HASH_FIRMADA);
      expect(selloSinGrabar(error)).toBe(false);
    });

    it("el sorteo, igual: sin red, sale 'sin confirmar' y draw.ts lo reintenta (es seguro)", async () => {
      h.wallet = otra;
      h.send.mockRejectedValue(new TypeError("Load failed"));
      h.getTx.mockRejectedValue(new TypeError("Load failed"));
      const { error } = await correr(sortear());
      const { errorKey } = await import("../stellar/errores");
      expect(errorKey(error, { enLinea: true })).toBe("unconfirmed");
    });
  });

  it("si al aprobar en la billetera la ronda ya no alcanza, no la manda: entraría y fallaría con la comisión cobrada", async () => {
    h.wallet = otra;
    const tx = txSimulada();
    // La persona tardó: cuando aprueba, a la ronda le faltan menos de 35 s.
    tx.sign.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 15_000);
      tx.signed = { hash: () => new Uint8Array(32).fill(2), timeBounds: { maxTime: String(cierre() + 60) } };
    });
    h.seal.mockImplementation(async () => tx);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { error } = await sellar();
      expect((error as Error).message).toContain("Error(Contract, #5)");
      expect(selloSinGrabar(error)).toBe(true);
      expect(h.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("el sorteo (drawOnChain) se ayuda igual que el sellado", () => {
  // Es el paso que ocurre frente a la sala, así que vale lo mismo que `seal`: se intenta, y si
  // falta saldo en testnet se carga la cuenta y se reintenta una vez, sin que nadie toque nada.
  beforeEach(() => h.getTx.mockImplementation(async () => resultadoDelSorteo()));

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
    h.send.mockResolvedValue({ status: "ERROR", hash: HASH_FIRMADA, errorResult: { fee_charged: "100", result: "tx_insufficient_balance", ext: "v0" } });
    const { pasos, error } = await sortear();
    expect((error as Error).message).toBe("tx-REJECTED tx_insufficient_balance");
    expect(h.draw).toHaveBeenCalledTimes(1);
    expect(h.fundWithFriendbot).not.toHaveBeenCalled();
    expect(pasos.map(([p]) => p)).not.toContain("funding");
    expect(eventos).toEqual([]);
  });

  it("con otra wallet, entra y devuelve los ganadores de la transacción firmada acá", async () => {
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    const { r } = await sortear();
    expect(r?.winners.map(Number)).toEqual([1, 2]);
    expect(r?.txHash).toBe(HASH_FIRMADA);
  });

  it("el sorteo vale un minuto si la cuenta firma sola y tres si hay que aprobar a mano", async () => {
    h.wallet = pollar(vi.fn(async () => "cafe"));
    await sortear();
    expect(h.draw.mock.calls[0]?.[1]).toEqual({ timeoutInSeconds: 60 });
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    await sortear();
    expect(h.draw.mock.calls[1]?.[1]).toEqual({ timeoutInSeconds: 180 });
  });
});

describe("cuánto vale cada envío", () => {
  it("el sello vale hasta 15 s después de que el contrato ya no lo aceptaría (round_time - 30)", async () => {
    const { vidaDelSello } = await import("./anchor");
    const ahora = 1_792_600_000;
    const round = targetRound(ahora, 45);
    expect(ahora + vidaDelSello(round, ahora)).toBe(roundTime(round) - 15);
    // Nunca menos de 20 s, aunque la ronda esté cerca.
    expect(vidaDelSello(round, roundTime(round) - 10)).toBe(20);
  });

  it("se lo pasa al SDK al armar el sello", async () => {
    h.wallet = pollar();
    const args = argsDeAhora();
    await sellar(args);
    const opciones = h.seal.mock.calls[0]?.[1] as { timeoutInSeconds: number };
    expect(opciones.timeoutInSeconds).toBeGreaterThanOrEqual(20);
    expect(opciones.timeoutInSeconds).toBeLessThanOrEqual(roundTime(args.round) - 15 - Math.floor(Date.now() / 1000) + 1);
  });

  it("con Freighter la ronda va con 45 s más de margen, para aprobar sin apuro; con las demás, nada", async () => {
    const { margenParaAprobar } = await import("./anchor");
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    expect(await margenParaAprobar()).toBe(45);
    h.wallet = pollar();
    expect(await margenParaAprobar()).toBe(0);
    h.wallet = { kind: "guest", address: DIR, signTransaction: vi.fn() };
    expect(await margenParaAprobar()).toBe(0);
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

describe("escribirError: sin conexión, igual dice algo", () => {
  afterEach(() => vi.doUnmock("./detalle-error"));

  it("si el detalle no se puede bajar (sin red, la página no alcanza ni sus archivos), escribe el mensaje igual", async () => {
    vi.doMock("./detalle-error", () => {
      throw new TypeError("Failed to fetch dynamically imported module");
    });
    const { escribirError } = await import("./anchor");
    const status = { id: "seal-status", textContent: "" } as unknown as HTMLElement;
    vi.stubGlobal("document", { getElementById: () => null, dispatchEvent: () => true });
    vi.stubGlobal("navigator", { onLine: false });
    await escribirError(status, new TypeError("Failed to fetch"), "sello");
    expect(status.textContent).toBe("Estás sin internet. Conectate y probá de nuevo.");
    vi.stubGlobal("navigator", { onLine: true });
    await escribirError(status, new TypeError("Failed to fetch"), "sorteo");
    expect(status.textContent).toBe("No pude conectarme con la red de Stellar. Revisá tu conexión y probá de nuevo.");
  });
});

describe("entró pero no se pudo leer el número que devolvió", () => {
  /** SUCCESS sin `returnValue`: lo que contestaría un RPC que no lo trae. */
  const entroSinValor = () => ({ status: "SUCCESS", latestLedgerCloseTime: cierre() });

  it("con Freighter o la cuenta de prueba: sello incierto (lo dice el contrato), nunca 'otra ronda', que serían dos sellos", async () => {
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    h.getTx.mockResolvedValue(entroSinValor());
    const { error } = await sellar();
    expect(esSelloIncierto(error)).toBe(true);
    expect((error as SelloIncierto).intento.hash).toBe(HASH_FIRMADA);
    expect(selloSinGrabar(error)).toBe(false);
  });

  it("con Pollar: lo mismo, con el hash que dio Pollar", async () => {
    h.wallet = pollar(vi.fn(async () => "cafe"));
    h.getTx.mockResolvedValue(entroSinValor());
    const { error } = await sellar();
    expect(esSelloIncierto(error)).toBe(true);
    expect((error as SelloIncierto).intento.hash).toBe("cafe");
    expect(selloSinGrabar(error)).toBe(false);
  });

  it("con el sorteo no hace falta: draw.ts lee el resultado del contrato (readDraw)", async () => {
    h.wallet = { kind: "external", address: DIR, signTransaction: vi.fn() };
    h.getTx.mockResolvedValue(entroSinValor());
    const { error } = await sortear();
    expect(esSelloIncierto(error)).toBe(false);
    expect((error as Error).message).toBe("tx-FAILED");
  });
});
