import { beforeEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * Mandar el premio de una ganadora desde el panel de quien organiza, con todo lo de afuera de mentira: la red, la billetera,
 * la marca de un envío en camino, el saldo y la ventana de Mandar. Lo que se comprueba es cuándo se puede mandar desde el panel
 * y lo que no se hace: con un envío en camino no se abre nada, y sin poder leer el saldo tampoco.
 */

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  permitido: true,
  /** La billetera entrada, o `null` sin sesión. */
  billetera: null as Record<string, unknown> | null,
  /** Si mirar la billetera lanza. */
  billeteraRota: false,
  /** Hasta cuándo vale la marca del envío en camino (segundos Unix), o `null` si no hay. */
  marca: null as number | null,
  saldo: null as bigint | null,
  llamadas: [] as string[],
  abiertas: [] as unknown[],
}));

vi.mock("../stellar/config", async (original) => {
  const real = await original<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" ? h.red : Reflect.get(t, k)) }) };
});
vi.mock("./mandar-usdc", () => ({
  mandarPermitido: () => h.permitido,
  abrirMandar: (o: unknown) => {
    h.llamadas.push("abrir");
    h.abiertas.push(o);
  },
}));
vi.mock("../stellar/wallet-pollar", () => ({
  MARCA_DEL_RETIRO: "marca-del-retiro",
  leerMarcaDeLaCuenta: (clave: string) => {
    h.llamadas.push(`marca:${clave}`);
    return h.marca;
  },
  submitsItself: (w: Record<string, unknown> | null) => w?.submitsItself === true,
}));
vi.mock("../stellar/wallet-lite", () => ({
  activeWallet: () => {
    if (h.billeteraRota) throw new Error("sin billetera");
    return h.billetera;
  },
}));
vi.mock("./pagar-premio", () => ({
  saldoDeLaCuenta: async (red: string, cuenta: string) => {
    h.llamadas.push(`saldo:${red}:${cuenta}`);
    return h.saldo;
  },
}));

import { mandarPremioReal } from "./campana-mandar-real";

const CUENTA = cuentaDePrueba(5);
const CUARENTA = 400_000_000n;
/** Una cuenta de Google que vota a mano: manda sola y vota por contenido. */
const deGoogle = (): Record<string, unknown> => ({ address: CUENTA, submitsItself: true, votaPorContenido: () => true, label: "Google" });
const ahoraEnSegundos = (): number => Math.floor(Date.now() / 1000);

beforeEach(() => {
  h.red = "mainnet";
  h.permitido = true;
  h.billetera = deGoogle();
  h.billeteraRota = false;
  h.marca = null;
  h.saldo = 1_215_000_000n;
  h.llamadas = [];
  h.abiertas = [];
});

describe("cuándo se puede mandar un premio desde el panel", () => {
  it("en la red principal, con Mandar permitido y una cuenta de Google que vota a mano", async () => {
    expect(await mandarPremioReal().puede()).toBe(true);
  });

  it("en la red de prueba no", async () => {
    h.red = "testnet";
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("con Mandar apagado en el sitio no", async () => {
    h.permitido = false;
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("sin sesión no", async () => {
    h.billetera = null;
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("con una billetera propia, que no manda por Tinkazo, no", async () => {
    h.billetera = { address: CUENTA };
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("con una cuenta de Google que no vota a mano no", async () => {
    h.billetera = { ...deGoogle(), votaPorContenido: () => false };
    expect(await mandarPremioReal().puede()).toBe(false);
    h.billetera = { address: CUENTA, submitsItself: true };
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("con una cuenta que entró con correo no: se mira igual que para cobrar el servicio", async () => {
    h.billetera = { ...deGoogle(), label: "Email" };
    expect(await mandarPremioReal().puede()).toBe(false);
  });

  it("si mirar la billetera falla dice que no, y no lanza", async () => {
    h.billeteraRota = true;
    await expect(mandarPremioReal().puede()).resolves.toBe(false);
  });

  it("preguntar no lee el saldo ni abre nada", async () => {
    await mandarPremioReal().puede();
    expect(h.llamadas.filter((l) => l.startsWith("saldo") || l === "abrir")).toEqual([]);
  });
});

describe("abrir Mandar con el premio puesto", () => {
  it("mira la marca, lee el saldo de la cuenta en la red principal y abre con la cuenta, el saldo, lo que llega y para quién", async () => {
    const r = await mandarPremioReal().abrir({ llega: CUARENTA, para: "Ana P." });
    expect(r).toBe("abierta");
    expect(h.llamadas).toEqual(["marca:marca-del-retiro", `saldo:mainnet:${CUENTA}`, "abrir"]);
    expect(h.abiertas).toEqual([{ address: CUENTA, saldo: 1_215_000_000n, llega: CUARENTA, para: "Ana P." }]);
  });

  it("con otro envío en camino no abre nada ni lee el saldo: dice que está ocupada", async () => {
    h.marca = ahoraEnSegundos() + 300;
    expect(await mandarPremioReal().abrir({ llega: CUARENTA, para: "Ana P." })).toBe("ocupada");
    expect(h.llamadas).toEqual(["marca:marca-del-retiro"]);
    expect(h.abiertas).toEqual([]);
  });

  it("una marca que ya venció no frena nada", async () => {
    h.marca = ahoraEnSegundos() - 5;
    expect(await mandarPremioReal().abrir({ llega: CUARENTA, para: "Beto R." })).toBe("abierta");
    expect(h.abiertas).toHaveLength(1);
  });

  it("sin poder leer el saldo no abre nada: dice que no hubo lectura", async () => {
    h.saldo = null;
    expect(await mandarPremioReal().abrir({ llega: CUARENTA, para: "Ana P." })).toBe("sin-lectura");
    expect(h.abiertas).toEqual([]);
  });

  it("con el saldo en cero abre igual: la ventana dice cuánto falta, no el panel", async () => {
    h.saldo = 0n;
    expect(await mandarPremioReal().abrir({ llega: CUARENTA, para: "Ana P." })).toBe("abierta");
    expect(h.abiertas).toEqual([{ address: CUENTA, saldo: 0n, llega: CUARENTA, para: "Ana P." }]);
  });

  it.each<[string, () => void]>([
    ["en la red de prueba", () => void (h.red = "testnet")],
    ["con Mandar apagado en el sitio", () => void (h.permitido = false)],
    ["sin sesión", () => void (h.billetera = null)],
    ["con una cuenta que entró con correo", () => void (h.billetera = { ...deGoogle(), label: "Email" })],
    ["si mirar la billetera falla", () => void (h.billeteraRota = true)],
  ])("%s no lee el saldo ni abre nada", async (_nombre, preparar) => {
    preparar();
    expect(await mandarPremioReal().abrir({ llega: CUARENTA, para: "Ana P." })).toBe("sin-lectura");
    expect(h.llamadas.filter((l) => l.startsWith("saldo") || l === "abrir")).toEqual([]);
    expect(h.abiertas).toEqual([]);
  });

  it("cada premio abre con su monto y su nombre, uno por vez", async () => {
    const mandar = mandarPremioReal();
    await mandar.abrir({ llega: CUARENTA, para: "Ana P." });
    await mandar.abrir({ llega: 250_000_000n, para: "Ganadora 2" });
    expect(h.abiertas).toEqual([
      { address: CUENTA, saldo: 1_215_000_000n, llega: CUARENTA, para: "Ana P." },
      { address: CUENTA, saldo: 1_215_000_000n, llega: 250_000_000n, para: "Ganadora 2" },
    ]);
  });
});
