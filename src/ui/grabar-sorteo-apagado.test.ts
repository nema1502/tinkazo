import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";

/**
 * Apagado es hoy. Con `VITE_SORTEO_SERVIDOR` sin poner, el sitio graba el sorteo exactamente como antes: las mismas
 * llamadas a la cadena con los mismos argumentos, y ni siquiera se carga el módulo del sorteo por el servicio ni se
 * toca el servicio. Con la variable en 1 pero sin las demás condiciones (la red de prueba, sin el acceso por cupón, una
 * billetera propia, la demo, pagar con la propia cuenta) pasa lo mismo.
 */

const h = vi.hoisted(() => ({
  drawOnChain: vi.fn(),
  readDraw: vi.fn(),
  cargados: [] as string[],
  cond: { bandera: false, ensayo: false, propia: false, url: "https://pm.example" as string | null, red: "mainnet" },
  pedir: vi.fn(),
}));
vi.mock("./anchor", () => ({
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  readDraw: (...a: unknown[]) => h.readDraw(...a),
  SIN_GRABAR: "ensayo-sin-grabar",
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../stellar/errores", async (orig) => ({ ...(await orig<typeof import("../stellar/errores")>()), errorKey: () => "roundNotReady" }));
// Estos módulos solo se tienen que cargar con la variable prendida: si alguien los evalúa de más, queda anotado.
vi.mock("../stellar/alta-config", async (orig) => {
  h.cargados.push("alta-config");
  return { ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => h.cond.bandera };
});
vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return { ...real, network: new Proxy(real.network, { get: (t, k) => (k === "name" ? h.cond.red : Reflect.get(t, k)) }) };
});
vi.mock("../ensayo-modo", async (orig) => ({ ...(await orig<typeof import("../ensayo-modo")>()), sinGrabar: () => h.cond.ensayo }));
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => (h.cond.propia ? { submitsItself: false } : { submitsItself: true }) }));
vi.mock("../stellar/patrocinio-config", async (orig) => ({ ...(await orig<typeof import("../stellar/patrocinio-config")>()), configDelPortero: () => ({ url: h.cond.url, porDefecto: false }) }));
vi.mock("../stellar/sorteo-servidor-api", async (orig) => {
  h.cargados.push("sorteo-servidor-api");
  return { ...(await orig<typeof import("../stellar/sorteo-servidor-api")>()), pedirElSorteo: (...a: unknown[]) => h.pedir(...a) };
});

const R = 32254977;
const base = { raffleId: 7n, round: R, signature: "ab".repeat(48), esperados: [4, 11, 3], ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined };
const OK = { winners: [4, 11, 3], randomness: "00", txHash: "cd".repeat(32) };

let fetchEspia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  h.cargados.length = 0;
  h.drawOnChain.mockReset();
  h.readDraw.mockReset().mockResolvedValue(null);
  h.pedir.mockReset().mockResolvedValue({ accion: "incierto" });
  Object.assign(h.cond, { bandera: false, ensayo: false, propia: false, url: "https://pm.example", red: "mainnet" });
  vi.stubEnv("VITE_SORTEO_SERVIDOR", "");
  fetchEspia = vi.fn();
  vi.stubGlobal("fetch", fetchEspia);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("con VITE_SORTEO_SERVIDOR apagado, el sitio graba como hoy", () => {
  it("éxito: una sola llamada a la cadena, con los argumentos de siempre, sin tocar el servicio", async () => {
    h.drawOnChain.mockResolvedValue(OK);
    const alPaso = vi.fn();
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, alPaso, pagarConMiCuenta: false });
    expect(fin).toEqual({ estado: "guardado", txHash: OK.txHash, yaEstaba: false });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.drawOnChain).toHaveBeenCalledWith(7n, "ab".repeat(48), alPaso, { pagarConMiCuenta: false });
    expect(h.pedir).not.toHaveBeenCalled();
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(h.cargados).toEqual([]);
  });

  it("reintento por la ronda que la cadena todavía no ve: las mismas llamadas de siempre", async () => {
    h.drawOnChain.mockRejectedValueOnce(new Error("Error(Contract, #5)")).mockResolvedValue(OK);
    const avisos: number[] = [];
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, alReintentar: (n) => avisos.push(n) });
    expect(fin.estado).toBe("guardado");
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
    expect(h.readDraw).toHaveBeenCalledTimes(1);
    expect(avisos).toEqual([2]);
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(h.cargados).toEqual([]);
  });

  it("fallo: los cinco intentos de siempre y el último error", async () => {
    const e = new Error("sin saldo");
    h.drawOnChain.mockRejectedValue(e);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo(base);
    expect(fin).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(5);
    expect(fetchEspia).not.toHaveBeenCalled();
    expect(h.cargados).toEqual([]);
  });
});

describe("con la variable prendida pero sin las demás condiciones, también como hoy", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SORTEO_SERVIDOR", "1");
    h.cond.bandera = true;
  });

  it.each<[string, Record<string, unknown>]>([
    ["sin VITE_ALTA (la bandera de la red principal apagada)", { bandera: false }],
    ["en la red de prueba", { red: "testnet" }],
    ["con una billetera propia", { propia: true }],
    ["en la demo o el ensayo", { ensayo: true }],
    ["sin dirección del servicio", { url: null }],
  ])("%s", async (_nombre, cambio) => {
    Object.assign(h.cond, cambio);
    h.drawOnChain.mockResolvedValue(OK);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo(base);
    expect(fin).toEqual({ estado: "guardado", txHash: OK.txHash, yaEstaba: false });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.pedir).not.toHaveBeenCalled();
    expect(fetchEspia).not.toHaveBeenCalled();
  });

  it("pagando con la propia cuenta", async () => {
    h.drawOnChain.mockResolvedValue(OK);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    await grabarElSorteo({ ...base, pagarConMiCuenta: true });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    expect(h.pedir).not.toHaveBeenCalled();
  });
});
