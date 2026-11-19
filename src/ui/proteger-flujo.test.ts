import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveWallet } from "../stellar/wallet-lite";
import { pollarWallet } from "../stellar/wallet-pollar";
import type { WalletAdapter } from "../stellar/wallet";

/**
 * El predicado que decide si se abre "Protegé tu cuenta" (`pideProtegerLaCuenta`), sin reemplazar el módulo: las pruebas
 * del sello y del sorteo (`freeze-proteger.test.ts`, `draw-proteger.test.ts`) lo simulan, así que nada más lo cubre.
 * Se abre solo con una cuenta de Pollar y el error de recuperación, y con ningún otro.
 */

const recuperacion = () => new Error("SDK_WALLET_RECOVERY_REQUIRED");
/** Una cuenta que firma por separado, como Freighter: no es de Pollar. */
const freighter = { address: "GAAA", name: "Freighter" } as unknown as WalletAdapter;

const red = vi.hoisted(() => ({ name: "mainnet" as "mainnet" | "testnet" }));
vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: red.name };
    },
  };
});

beforeEach(() => {
  red.name = "mainnet";
});
afterEach(() => setActiveWallet(null));

describe("pideProtegerLaCuenta", () => {
  it("con una cuenta de Pollar y el error de recuperación, sí", async () => {
    setActiveWallet(pollarWallet);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(recuperacion())).toBe(true);
  });

  it.each(["tx_bad_seq", "boom", "txInsufficientBalance"])("con una cuenta de Pollar y otro error (%s), no", async (msg) => {
    setActiveWallet(pollarWallet);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(new Error(msg))).toBe(false);
  });

  it("con una cuenta que no es de Pollar, no, aunque el error sea el de recuperación", async () => {
    setActiveWallet(freighter);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(recuperacion())).toBe(false);
  });

  it("con una cuenta de Pollar y un navegador que la cuenta todavía no reconoce, sí", async () => {
    setActiveWallet(pollarWallet);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(new Error("SDK_COSIGN_DEVICE_NOT_ENROLLED"))).toBe(true);
  });

  it.each(["SDK_WALLET_RECOVERY_REQUIRED", "SDK_COSIGN_DEVICE_NOT_ENROLLED", "account-not-ready"])("en Prueba, ninguno de los de la cuenta (%s) entra al camino del paso", async (msg) => {
    red.name = "testnet";
    setActiveWallet(pollarWallet);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(new Error(msg))).toBe(false);
  });

  it("sin cuenta, no, aunque el error sea el de recuperación", async () => {
    setActiveWallet(null);
    const { pideProtegerLaCuenta } = await import("./proteger-flujo");
    expect(await pideProtegerLaCuenta(recuperacion())).toBe(false);
  });
});
