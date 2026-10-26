import { afterEach, describe, expect, it, vi } from "vitest";
import { RPC_LISTAS, RPC_URLS } from "./config";
import { SelloIncierto } from "./envio";
import { VUELTA_AL_PRIMERO_MS, crearRpcRed, esFalloDeRpc } from "./rpc-red";

const A = "https://uno.example/rpc";
const B = "https://dos.example/rpc";

/** Un reloj que se mueve a mano. */
function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => void (t += ms) };
}

describe("dos RPC por red", () => {
  it("cada red tiene dos RPC distintos y el primero es el de siempre", () => {
    for (const red of ["testnet", "mainnet"] as const) {
      expect(RPC_LISTAS[red].length).toBeGreaterThanOrEqual(2);
      expect(new Set(RPC_LISTAS[red]).size).toBe(RPC_LISTAS[red].length);
      expect(RPC_URLS[red]).toBe(RPC_LISTAS[red][0]);
    }
    expect(RPC_URLS.mainnet).toBe("https://mainnet.sorobanrpc.com");
    expect(RPC_URLS.testnet).toBe("https://soroban-testnet.stellar.org");
  });

  it("arranca con el primero y cambiar() pasa al otro y vuelve", () => {
    const r = crearRpcRed("testnet", [A, B]);
    expect(r.actual()).toBe(A);
    expect(r.cambiar("prueba")).toBe(B);
    expect(r.actual()).toBe(B);
    expect(r.cambiar("otra")).toBe(A);
    expect(r.ultimoCambio()?.motivo).toBe("otra");
  });

  it("vuelve al primero a los 10 minutos, no antes", () => {
    const t = reloj();
    const r = crearRpcRed("testnet", [A, B], { ahora: t.ahora });
    r.cambiar("se cayó");
    t.avanzar(VUELTA_AL_PRIMERO_MS - 1);
    expect(r.actual()).toBe(B);
    t.avanzar(1);
    expect(r.actual()).toBe(A);
    expect(r.ultimoCambio()?.motivo).toBe("vuelta-al-primero");
  });

  it("con un solo RPC no cambia nada", () => {
    const r = crearRpcRed("testnet", [A]);
    expect(r.cambiar("x")).toBe(A);
    expect(r.fallo(new TypeError("Failed to fetch"))).toBe(false);
    expect(r.actual()).toBe(A);
  });

  it("una lista vacía es un error de programación", () => {
    expect(() => crearRpcRed("testnet", [])).toThrow();
  });
});

describe("qué errores cambian de RPC", () => {
  it("un corte, un tiempo agotado, un 429 y un 5xx sí", () => {
    for (const e of [
      new TypeError("Failed to fetch"),
      new TypeError("Load failed"),
      new Error("The operation timed out."),
      new Error("HTTP 429"),
      new Error("Request failed with status code 429"),
      new Error("HTTP 503"),
      new Error("Request failed with status code 502"),
      Object.assign(new Error("Network Error"), { name: "AxiosError" }),
    ]) {
      expect(esFalloDeRpc(e), String(e)).toBe(true);
    }
  });

  it("lo que la red contesta con sentido no cambia nada", () => {
    for (const e of [
      new Error("HostError: Error(Contract, #5)"),
      new Error("tx_insufficient_balance"),
      new Error("TRY_AGAIN_LATER"),
      new Error("Account not found: GABC"),
      new Error("User rejected this request."),
    ]) {
      expect(esFalloDeRpc(e), String(e)).toBe(false);
    }
  });

  it("un sello incierto no cambia el RPC por sí mismo: primero se averigua", () => {
    const intento = { organizer: "G", listHash: "ab", round: 1, count: 2, numWinners: 1, meta: "", desde: 0 };
    expect(esFalloDeRpc(new SelloIncierto(intento, new TypeError("Load failed")))).toBe(false);
  });

  it("fallo() cambia solo con un error de RPC", () => {
    const r = crearRpcRed("testnet", [A, B]);
    expect(r.fallo(new Error("HostError: Error(Contract, #5)"))).toBe(false);
    expect(r.actual()).toBe(A);
    expect(r.fallo(new TypeError("Failed to fetch"))).toBe(true);
    expect(r.actual()).toBe(B);
  });
});

describe("un intento entero usa un solo RPC", () => {
  it("mientras está fijado el vigente no cambia, y el cambio espera a que se suelte", () => {
    const r = crearRpcRed("testnet", [A, B]);
    const soltar = r.fijar();
    expect(r.fallo(new TypeError("Failed to fetch"))).toBe(true);
    expect(r.actual()).toBe(A);
    soltar();
    expect(r.actual()).toBe(B);
  });

  it("soltar dos veces es lo mismo que una, y con dos intentos a la vez se espera al último", () => {
    const r = crearRpcRed("testnet", [A, B]);
    const uno = r.fijar();
    const dos = r.fijar();
    r.cambiar("corte");
    uno();
    uno();
    expect(r.actual()).toBe(A);
    dos();
    expect(r.actual()).toBe(B);
  });

  it("fijado no vuelve al primero por el paso del tiempo", () => {
    const t = reloj();
    const r = crearRpcRed("testnet", [A, B], { ahora: t.ahora });
    r.cambiar("corte");
    const soltar = r.fijar();
    t.avanzar(VUELTA_AL_PRIMERO_MS * 2);
    expect(r.actual()).toBe(B);
    soltar();
    expect(r.actual()).toBe(A);
  });
});

describe("las lecturas de la verificación cambian de RPC si el primero no sirve", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("si el primero se corta lee del segundo, y el siguiente pedido ya sale por él", async () => {
    vi.resetModules();
    const pedidos: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      pedidos.push(String(url));
      if (String(url) === RPC_LISTAS.testnet[0]) throw new TypeError("Failed to fetch");
      return { status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { sequence: 500, closeTime: "1792600000" } }) };
    });
    const { ultimoLedger } = await import("./seals");
    const { rpcActual } = await import("./rpc-red");
    const r = await ultimoLedger(RPC_LISTAS.testnet[0]);
    expect(r).toEqual({ secuencia: 500, cierre: 1792600000 });
    expect(pedidos).toEqual([RPC_LISTAS.testnet[0], RPC_LISTAS.testnet[1]]);
    expect(rpcActual("testnet")).toBe(RPC_LISTAS.testnet[1]);
  });

  it("un 503 con una página que no es JSON también pasa al segundo", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url) === RPC_LISTAS.mainnet[0]) return { status: 503, json: async () => Promise.reject(new SyntaxError("Unexpected token <")) };
      return { status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, result: { sequence: 9, closeTime: "1792600000" } }) };
    });
    const { ultimoLedger } = await import("./seals");
    expect((await ultimoLedger(RPC_LISTAS.mainnet[0])).secuencia).toBe(9);
  });

  it("si los dos fallan, falla con el error del segundo", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const { ultimoLedger } = await import("./seals");
    await expect(ultimoLedger(RPC_LISTAS.testnet[0])).rejects.toThrow(/fetch/);
  });

  it("un error que contesta el contrato no cambia de RPC", async () => {
    vi.resetModules();
    const pedidos: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      pedidos.push(String(url));
      return { status: 200, json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "invalid params" } }) };
    });
    const { ultimoLedger } = await import("./seals");
    await expect(ultimoLedger(RPC_LISTAS.testnet[0])).rejects.toThrow(/invalid params/);
    expect(pedidos).toEqual([RPC_LISTAS.testnet[0]]);
  });
});
