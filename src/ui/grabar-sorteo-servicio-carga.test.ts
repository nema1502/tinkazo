import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";

/**
 * Si el módulo del servicio no se puede bajar (una pieza más que puede fallar en el celular), la grabación sigue por el
 * camino de siempre y no se corta.
 */

const h = vi.hoisted(() => ({ drawOnChain: vi.fn(), readDraw: vi.fn() }));
vi.mock("./anchor", () => ({
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  readDraw: (...a: unknown[]) => h.readDraw(...a),
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => `96:${s}` }));
vi.mock("../stellar/alta-config", async (orig) => ({ ...(await orig<typeof import("../stellar/alta-config")>()), sorteoPorServidor: () => true }));
vi.mock("./sorteo-del-servicio", () => {
  throw new Error("no se pudo bajar el módulo");
});

const R = 32254977;
const base = { raffleId: 7n, round: R, signature: "ab".repeat(48), esperados: [4, 11, 3], ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined };
const GANADORES = { winners: [4, 11, 3], randomness: "00ff" };
const HASH = "cd".repeat(32);

beforeEach(() => {
  vi.resetModules();
  h.drawOnChain.mockReset().mockResolvedValue({ ...GANADORES, txHash: HASH });
  h.readDraw.mockReset().mockResolvedValue(null);
  vi.stubEnv("VITE_SORTEO_SERVIDOR", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("el módulo del servicio no baja", () => {
  it("graba por el camino de siempre, una vez", async () => {
    const { grabarElSorteo } = await import("./grabar-sorteo");
    expect(await grabarElSorteo(base)).toEqual({ estado: "guardado", txHash: HASH, yaEstaba: false });
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
  });
});
