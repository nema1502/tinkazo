import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime } from "../protocol/quicknet";

/**
 * La grabación del sorteo, aparte del show (`grabar-sorteo.ts`): espera a que la cadena lo acepte, reintenta como
 * siempre, y compara lo que devuelve el contrato con lo que ya vio la sala.
 */

const h = vi.hoisted(() => ({ drawOnChain: vi.fn(), readDraw: vi.fn(), firma: "" }));
vi.mock("./anchor", () => ({
  drawOnChain: (...a: unknown[]) => h.drawOnChain(...a),
  readDraw: (...a: unknown[]) => h.readDraw(...a),
}));
vi.mock("../protocol/drand", () => ({ decompressG1: (s: string) => s }));
vi.mock("../stellar/errores", async (orig) => ({ ...(await orig<typeof import("../stellar/errores")>()), errorKey: () => "rpcDown" }));
vi.mock("../protocol/firma", () => ({ verifyRoundAsync: async (_r: number, s: string) => s !== "00".repeat(48) }));
vi.mock("../protocol/quicknet", async (orig) => ({
  ...(await orig<typeof import("../protocol/quicknet")>()),
  fetchRound: async (round: number) => ({ round, signature: h.firma }),
}));

const R = 32254977;
const base = { raffleId: 7n, round: R, signature: "ab".repeat(48), esperados: [4, 11, 3] };

beforeEach(() => {
  h.drawOnChain.mockReset();
  h.readDraw.mockReset().mockResolvedValue(null);
});

describe("grabar el sorteo aparte del show", () => {
  it("espera a que la cadena lo acepte: ocho segundos después de nacer el número", async () => {
    h.drawOnChain.mockResolvedValue({ winners: [4, 11, 3], randomness: "00", txHash: "cd".repeat(32) });
    const esperas: number[] = [];
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora: () => roundTime(R) * 1000, dormir: async (ms) => void esperas.push(ms) });
    expect(esperas[0]).toBe(8000);
    expect(fin).toEqual({ estado: "guardado", txHash: "cd".repeat(32), yaEstaba: false });
  });

  it("si falla, reintenta, y el ganador que guarda es el mismo que vio la sala", async () => {
    h.drawOnChain.mockRejectedValueOnce(new Error("la red no contestó")).mockResolvedValue({ winners: [4, 11, 3], randomness: "00", txHash: "ef".repeat(32) });
    const avisos: number[] = [];
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined, alReintentar: (n) => avisos.push(n) });
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
    expect(avisos).toEqual([2]);
    expect(fin.estado).toBe("guardado");
  });

  it("si ya estaba grabado (otro intento u otra persona), lo da por guardado sin enlace", async () => {
    h.drawOnChain.mockRejectedValue(new Error("cortado"));
    h.readDraw.mockResolvedValue({ winners: [4, 11, 3], randomness: "00" });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined });
    expect(fin).toEqual({ estado: "guardado", yaEstaba: true });
  });

  it("si el contrato devuelve otros ganadores, lo dice: no lo da por guardado", async () => {
    h.drawOnChain.mockResolvedValue({ winners: [4, 3, 11], randomness: "00", txHash: "cd".repeat(32) });
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined });
    expect(fin).toEqual({ estado: "no-coincide", esperados: [4, 11, 3], grabados: [4, 3, 11] });
  });

  it("lo que no se arregla esperando vuelve como fallo, con su error", async () => {
    const e = new Error("sin saldo");
    h.drawOnChain.mockRejectedValue(e);
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const fin = await grabarElSorteo({ ...base, ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined });
    // `rpcDown` es reintentable: se agotan los cinco intentos y vuelve el último error.
    expect(fin).toEqual({ estado: "fallo", error: e });
    expect(h.drawOnChain).toHaveBeenCalledTimes(5);
  });

  it("Mis sorteos lo termina más tarde: rehace el resultado con lo sellado y el número, y lo graba comparando", async () => {
    const V = JSON.parse(readFileSync(new URL("../../docs/vectors.json", import.meta.url), "utf8")) as { list_hash: string; count: number; quicknet: { round: number; signature: string }; cases: { k: number; winners: number[] }[] };
    h.firma = V.quicknet.signature;
    const esperados = V.cases.find((c) => c.k === 3)?.winners ?? [];
    h.drawOnChain.mockResolvedValue({ winners: esperados, randomness: "00", txHash: "ab".repeat(32) });
    const { terminarDeGrabar } = await import("./grabar-sorteo");
    const fin = await terminarDeGrabar({ id: "7", round: V.quicknet.round, listHash: V.list_hash, count: V.count, numWinners: 3 });
    expect(fin).toEqual({ estado: "guardado", txHash: "ab".repeat(32), yaEstaba: false });
    expect(h.drawOnChain.mock.calls[0]?.[0]).toBe(7n);
    // Con un número que no se comprueba, no graba nada.
    h.firma = "00".repeat(48);
    h.drawOnChain.mockClear();
    const mal = await terminarDeGrabar({ id: "7", round: V.quicknet.round, listHash: V.list_hash, count: V.count, numWinners: 3 });
    expect(mal.estado).toBe("fallo");
    expect(h.drawOnChain).not.toHaveBeenCalled();
  });

  it("dos pedidos del mismo sorteo a la vez (el show y Mis sorteos) mandan uno solo, y los dos saben cómo terminó", async () => {
    let soltar: (v: unknown) => void = () => undefined;
    h.drawOnChain.mockReturnValue(new Promise((r) => (soltar = r)));
    const { grabarElSorteo } = await import("./grabar-sorteo");
    const o = { ...base, ahora: () => (roundTime(R) + 60) * 1000, dormir: async () => undefined };
    // El show ya está esperando a la cadena cuando Mis sorteos lo pide.
    const delShow = grabarElSorteo(o);
    await vi.waitFor(() => expect(h.drawOnChain).toHaveBeenCalledTimes(1));
    const deMisSorteos = grabarElSorteo(o);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.drawOnChain).toHaveBeenCalledTimes(1);
    soltar({ winners: [4, 11, 3], randomness: "00", txHash: "cd".repeat(32) });
    const guardado = { estado: "guardado", txHash: "cd".repeat(32), yaEstaba: false };
    expect(await delShow).toEqual(guardado);
    expect(await deMisSorteos).toEqual(guardado);
    // Terminada esa, otro pedido del mismo sorteo vuelve a ir.
    h.drawOnChain.mockResolvedValue({ winners: [4, 11, 3], randomness: "00", txHash: "ef".repeat(32) });
    expect((await grabarElSorteo(o)).estado).toBe("guardado");
    expect(h.drawOnChain).toHaveBeenCalledTimes(2);
  });

  it("compara los puestos en orden: el orden es el de los premios", async () => {
    const { mismosGanadores } = await import("./grabar-sorteo");
    expect(mismosGanadores([1, 2], [1, 2])).toBe(true);
    expect(mismosGanadores([1, 2], [2, 1])).toBe(false);
    expect(mismosGanadores([1], [1, 2])).toBe(false);
  });
});
