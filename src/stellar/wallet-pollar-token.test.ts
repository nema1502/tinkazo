import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, emitirSesion, reiniciar } from "./pollar-falso";

/**
 * El token de la sesión de Pollar para el servidor de las altas (`tokenDeSesion`): solo con la sesión verificada, con una
 * espera corta si todavía no lo está, y nunca guardado ni anotado. Con el cliente simulado (`pollar-falso.ts`).
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, TOPE_TOKEN_MS } = await import("./wallet-pollar");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const TOKEN = "eyJ0b2tlbi1kZS1wcnVlYmEtbm8tZXMtcmVhbA.parte-dos.parte-tres";

beforeEach(async () => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
  h.token = TOKEN;
  // Arma el cliente, como al entrar.
  await pollarWallet.estadoOficial(false);
});

afterEach(async () => {
  vi.useRealTimers();
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el token de la sesión", () => {
  it("con la sesión verificada, el token, enseguida", async () => {
    h.verificada = true;
    await expect(pollarWallet.tokenDeSesion()).resolves.toBe(TOKEN);
  });

  it("retomada y sin verificar: espera a que Pollar la verifique", async () => {
    vi.useFakeTimers();
    const p = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(1_000);
    emitirSesion(h, { verificada: true });
    await expect(p).resolves.toBe(TOKEN);
    // Ya no escucha.
    expect(h.oyentes.sesion.size).toBe(0);
  });

  it("con la red lenta de un stand, Pollar puede tardar en verificarla: a los 6 segundos todavía hay token", async () => {
    vi.useFakeTimers();
    const p = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(6_000);
    emitirSesion(h, { verificada: true });
    await expect(p).resolves.toBe(TOKEN);
  });

  it("si no se verifica en 8 segundos, no hay token (y no queda escuchando)", async () => {
    vi.useFakeTimers();
    const p = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS - 10);
    emitirSesion(h, { verificada: false });
    await vi.advanceTimersByTimeAsync(20);
    await expect(p).resolves.toBeNull();
    expect(TOPE_TOKEN_MS).toBe(8_000);
    expect(h.oyentes.sesion.size).toBe(0);
  });

  it("sin sesión abierta, o con un token vacío, no hay token", async () => {
    vi.useFakeTimers();
    h.verificada = true;
    h.paso = "idle";
    const sinSesion = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS + 10);
    await expect(sinSesion).resolves.toBeNull();
    h.paso = "authenticated";
    h.token = "   ";
    const vacio = pollarWallet.tokenDeSesion();
    await vi.advanceTimersByTimeAsync(TOPE_TOKEN_MS + 10);
    await expect(vacio).resolves.toBeNull();
  });

  it("sin el cliente de Pollar armado (cerró sesión), no hay token y no se arma uno", async () => {
    await pollarWallet.disconnect();
    const antes = h.construidos;
    h.verificada = true;
    await expect(pollarWallet.tokenDeSesion()).resolves.toBeNull();
    expect(h.construidos).toBe(antes);
  });

  it("no se anota en ningún lado ni se guarda en el navegador", async () => {
    const consola = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    h.verificada = true;
    await pollarWallet.tokenDeSesion();
    for (const c of consola) for (const llamada of c.mock.calls) expect(JSON.stringify(llamada)).not.toContain(TOKEN);
    for (const almacen of [sessionStorage, localStorage]) for (let i = 0; i < almacen.length; i++) expect(almacen.getItem(almacen.key(i) ?? "")).not.toContain(TOKEN);
  });
});
