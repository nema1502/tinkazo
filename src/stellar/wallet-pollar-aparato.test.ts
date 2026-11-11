import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * Otro celular u otra compu (N6 y N7 del diseño de «Dejá tu cuenta lista»): la cuenta de la red principal no reconoce
 * este navegador hasta que la persona confirma que es ella, con un código al correo de la cuenta o con una llave
 * guardada. Si se sumó en esta pestaña, al cerrar sesión se lo saca de la cuenta: una compu prestada no queda adentro.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, MARCAS_DE_LA_CUENTA } = await import("./wallet-pollar");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const LLAVE = "02aa11";
const OTRA_LLAVE = "03bb22";
const conDispositivos = (...llaves: string[]) => ({ required: true, configured: true, devices: llaves.map((publicKey, i) => ({ apiKeyId: `k${i}`, name: "", publicKey, createdAt: "" })) });
const inscrito = (): string | null => sessionStorage.getItem(MARCAS_DE_LA_CUENTA.inscrito);

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
  h.impl.publicKeyHex = async () => LLAVE;
  h.impl.devices = async () => ({ devices: [{ id: "d-otro", publicKey: OTRA_LLAVE }, { id: "d-este", publicKey: LLAVE }] });
});

afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("confirmar que es la persona en este navegador", () => {
  it("con el código al correo de la cuenta: manda, confirma y queda la marca si la llave de acá quedó en la cuenta", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => conDispositivos(OTRA_LLAVE, LLAVE);
    await pollarWallet.mandarCodigoParaEsteAparato();
    await expect(pollarWallet.confirmarCodigoParaEsteAparato("123456")).resolves.toBe(true);
    expect(h.llamadas).toContain("recovery.startEmailRecovery");
    expect(h.argumentos["recovery.recoverWithEmailCode"]).toEqual([["123456"]]);
    expect(inscrito()).toBe("1");
  });

  it("si la llave de acá no quedó en la cuenta, no hay marca", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => conDispositivos(OTRA_LLAVE);
    await expect(pollarWallet.confirmarCodigoParaEsteAparato("123456")).resolves.toBe(false);
    expect(inscrito()).toBeNull();
  });

  it("con una llave guardada (el desbloqueo)", async () => {
    h.impl["recovery.recoverWithPasskey"] = async () => conDispositivos(LLAVE);
    await expect(pollarWallet.confirmarAparatoConDesbloqueo()).resolves.toBe(true);
    expect(inscrito()).toBe("1");
  });

  it("un código malo sale con el error del kit y no deja marca", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => {
      throw new Error("SDK_COSIGN_OTP_INVALID");
    };
    await expect(pollarWallet.confirmarCodigoParaEsteAparato("000000")).rejects.toThrow();
    expect(inscrito()).toBeNull();
  });
});

describe("al cerrar sesión, este navegador sale de la cuenta si se sumó en esta pestaña", () => {
  it("con la marca: revokeDevice, a la fuerza y con el de acá, antes de logout", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => conDispositivos(OTRA_LLAVE, LLAVE);
    await pollarWallet.confirmarCodigoParaEsteAparato("123456");
    h.llamadas = [];
    await pollarWallet.disconnect();
    expect(h.argumentos.revokeDevice).toEqual([["d-este", { force: true }]]);
    expect(h.llamadas.indexOf("revokeDevice")).toBeLessThan(h.llamadas.indexOf("logout"));
    expect(pollarWallet.ultimoCierreDejoNavegador).toBe(false);
    expect(inscrito()).toBeNull();
  });

  it("sin la marca: no se toca ningún navegador", async () => {
    await pollarWallet.estadoOficial();
    h.llamadas = [];
    await pollarWallet.disconnect();
    expect(h.llamadas).not.toContain("devices");
    expect(h.llamadas).not.toContain("revokeDevice");
    expect(h.llamadas).toContain("logout");
  });

  it("si revokeDevice falla, la sesión se cierra igual y queda el aviso", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => conDispositivos(LLAVE);
    await pollarWallet.confirmarCodigoParaEsteAparato("123456");
    h.impl.revokeDevice = async () => {
      throw new Error("Failed to fetch");
    };
    h.llamadas = [];
    await pollarWallet.disconnect();
    expect(h.llamadas).toContain("logout");
    expect(pollarWallet.ultimoCierreDejoNavegador).toBe(true);
    expect(pollarWallet.address).toBeNull();
  });

  it("si la cuenta ya no tiene este navegador, no hay nada que sacar", async () => {
    h.impl["recovery.recoverWithEmailCode"] = async () => conDispositivos(LLAVE);
    await pollarWallet.confirmarCodigoParaEsteAparato("123456");
    h.impl.devices = async () => ({ devices: [{ id: "d-otro", publicKey: OTRA_LLAVE }] });
    await pollarWallet.disconnect();
    expect(h.llamadas).not.toContain("revokeDevice");
    expect(pollarWallet.ultimoCierreDejoNavegador).toBe(false);
  });

  it("con una confirmación en curso, la espera antes de sacar el navegador", async () => {
    let terminar: (v: unknown) => void = () => undefined;
    h.impl["recovery.recoverWithEmailCode"] = () => new Promise((r) => (terminar = r));
    const confirmando = pollarWallet.confirmarCodigoParaEsteAparato("123456");
    await vi.waitFor(() => expect(h.llamadas).toContain("recovery.recoverWithEmailCode"));
    const cerrando = pollarWallet.disconnect();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.llamadas).not.toContain("logout");
    terminar(conDispositivos(LLAVE));
    await expect(confirmando).resolves.toBe(true);
    await cerrando;
    expect(h.argumentos.revokeDevice).toEqual([["d-este", { force: true }]]);
    expect(h.llamadas.indexOf("revokeDevice")).toBeLessThan(h.llamadas.indexOf("logout"));
  });

  it("cerrar sesión borra el contador de votos y las marcas", async () => {
    for (const clave of Object.values(MARCAS_DE_LA_CUENTA)) sessionStorage.setItem(clave, "1");
    h.impl.devices = async () => ({ devices: [] });
    await pollarWallet.disconnect();
    for (const clave of Object.values(MARCAS_DE_LA_CUENTA)) expect(sessionStorage.getItem(clave)).toBeNull();
  });
});
