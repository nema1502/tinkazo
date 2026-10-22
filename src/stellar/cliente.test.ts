import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El cliente del contrato se arma una vez por cuenta, y de antemano.
 *
 * Armarlo baja la interfaz del contrato de la red. Medido el 21 de octubre de
 * 2026 en la testnet: el primer sello de una página quedaba con el botón
 * apagado y callado de 0,6 a 14 s, todo en esas consultas. Desde ese día se
 * arma al abrir la sesión, y el sello que llega mientras se arma espera ese
 * mismo pedido. Que nunca se quede esperando uno colgado ni guarde uno fallido.
 */
interface Pedido {
  opciones: { publicKey?: string };
  armar: (c: unknown) => void;
  fallar: (e: unknown) => void;
}

const h = vi.hoisted(() => ({
  wallet: null as null | { kind: string; address: string; signTransaction: () => Promise<unknown> },
  pedidos: [] as Pedido[],
}));

vi.mock("@stellar/stellar-sdk", async (orig) => {
  const real = await orig<typeof import("@stellar/stellar-sdk")>();
  return {
    ...real,
    contract: {
      ...real.contract,
      Client: {
        from: (opciones: Pedido["opciones"]) =>
          new Promise((armar, fallar) => {
            h.pedidos.push({ opciones, armar, fallar });
          }),
      },
    },
  };
});

vi.mock("./wallet-lite", async (orig) => {
  const real = await orig<typeof import("./wallet-lite")>();
  return { ...real, activeWallet: () => h.wallet };
});

const cuenta = (address: string): NonNullable<typeof h.wallet> => ({ kind: "guest", address, signTransaction: async () => ({}) });
const A = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const B = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";

/** Deja correr lo que quedó pendiente (los `then` del cliente). */
const soltar = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  h.pedidos = [];
  h.wallet = cuenta(A);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("el cliente del contrato", () => {
  it("mientras se arma, quien lo pide espera ese mismo pedido", async () => {
    const { getClient } = await import("./contract");
    const primero = getClient();
    const segundo = getClient();
    expect(h.pedidos).toHaveLength(1);
    expect(h.pedidos[0]?.opciones.publicKey).toBe(A);
    const cliente = { seal: () => undefined };
    h.pedidos[0]?.armar(cliente);
    await expect(primero).resolves.toBe(cliente);
    await expect(segundo).resolves.toBe(cliente);
  });

  it("ya armado, no vuelve a la red", async () => {
    const { getClient } = await import("./contract");
    const p = getClient();
    h.pedidos[0]?.armar({ id: 1 });
    await p;
    await soltar();
    await expect(getClient()).resolves.toEqual({ id: 1 });
    expect(h.pedidos).toHaveLength(1);
  });

  it("si falla, no queda guardado: el próximo pedido lo vuelve a intentar", async () => {
    const { getClient } = await import("./contract");
    const p = getClient();
    h.pedidos[0]?.fallar(new TypeError("Failed to fetch"));
    await expect(p).rejects.toThrow("Failed to fetch");
    await soltar();
    void getClient();
    expect(h.pedidos).toHaveLength(2);
  });

  it("con otra cuenta, otro cliente", async () => {
    const { getClient } = await import("./contract");
    void getClient();
    h.pedidos[0]?.armar({ de: A });
    await soltar();
    h.wallet = cuenta(B);
    void getClient();
    expect(h.pedidos).toHaveLength(2);
    expect(h.pedidos[1]?.opciones.publicKey).toBe(B);
  });

  it("uno que lleva más de diez segundos sin contestar no se espera: se pide otro", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T22:00:00Z"));
    const { getClient, CLIENTE_VIEJO_MS } = await import("./contract");
    void getClient();
    vi.setSystemTime(Date.now() + CLIENTE_VIEJO_MS - 1);
    void getClient();
    expect(h.pedidos).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2);
    const nuevo = getClient();
    expect(h.pedidos).toHaveLength(2);
    h.pedidos[1]?.armar({ nuevo: true });
    await expect(nuevo).resolves.toEqual({ nuevo: true });
    // El colgado que contesta tarde no pisa al nuevo.
    h.pedidos[0]?.armar({ viejo: true });
    await soltar();
    await expect(getClient()).resolves.toEqual({ nuevo: true });
    expect(h.pedidos).toHaveLength(2);
  });
});
