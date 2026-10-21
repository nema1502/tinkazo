import { describe, expect, it, vi } from "vitest";
import { errorKey } from "../stellar/errores";
import { ESPERAS_DEL_SORTEO_MS, SORTEO_REINTENTABLE, sortearConReintentos } from "./sorteo-seguro";

/** Un reloj de mentira: `dormir` lo adelanta en el acto. */
function reloj() {
  let t = 0;
  return { ahora: () => t, dormir: vi.fn(async (ms: number) => void (t += ms)) };
}

const reintentable = (e: unknown): boolean => SORTEO_REINTENTABLE.has(errorKey(e, { enLinea: true }));
const GANADORES = { winners: [3, 1] };

describe("sortearConReintentos: el sorteo reintenta", () => {
  it("un corte de red: vuelve a probar solo y sale", async () => {
    const r = reloj();
    const intentar = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(GANADORES);
    const fin = await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, ...r });
    expect(fin).toEqual({ ok: true, valor: GANADORES, yaEstaba: false });
    expect(intentar).toHaveBeenCalledTimes(2);
  });

  it("con espera creciente: 2, 4, 8 y 16 segundos", async () => {
    const r = reloj();
    const intentar = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const fin = await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, ...r });
    expect(fin.ok).toBe(false);
    expect(intentar).toHaveBeenCalledTimes(5);
    expect(r.dormir.mock.calls.map((c) => c[0])).toEqual([...ESPERAS_DEL_SORTEO_MS]);
  });

  it("la red ocupada, la ronda que la cadena todavía no ve y lo que no se sabe también se reintentan", async () => {
    for (const error of [new Error("Sending the transaction to the network failed!\n{\"status\": \"TRY_AGAIN_LATER\"}"), new Error("Transaction simulation failed: \"HostError: Error(Contract, #7)\""), new Error("tx-FAILED"), new Error("sin-confirmar"), { code: -32603, message: "internal error" }]) {
      const r = reloj();
      const intentar = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(GANADORES);
      expect((await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, ...r })).ok).toBe(true);
    }
  });

  it("antes de reintentar mira si ya quedó registrado: un intento cortado que sí entró no se manda de nuevo", async () => {
    const r = reloj();
    const intentar = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    const yaEsta = vi.fn().mockResolvedValue(GANADORES);
    const fin = await sortearConReintentos({ intentar, yaEsta, reintentable, ...r });
    expect(fin).toEqual({ ok: true, valor: GANADORES, yaEstaba: true });
    expect(intentar).toHaveBeenCalledTimes(1);
  });

  it("si mirar también falla (sin red), sigue reintentando: el botón no se traba", async () => {
    const r = reloj();
    const intentar = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockResolvedValue(GANADORES);
    const yaEsta = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    expect((await sortearConReintentos({ intentar, yaEsta, reintentable, ...r })).ok).toBe(true);
  });

  it.each([
    ["la persona canceló en Freighter", new Error("wallet-rejected", { cause: { code: -4, message: "The user rejected this request." } })],
    ["sin saldo", new Error("txInsufficientBalance")],
    ["la cuenta de Pollar no está lista", new Error("account-not-ready")],
    ["el contrato no encuentra el sorteo", new Error("HostError: Error(Contract, #1)")],
    ["el contrato no acepta la prueba de la ronda", new Error("HostError: Error(Contract, #8)")],
  ])("no reintenta lo que no se arregla esperando: %s", async (_nombre, error) => {
    const r = reloj();
    const intentar = vi.fn().mockRejectedValue(error);
    const fin = await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, ...r });
    expect(fin).toEqual({ ok: false, error });
    expect(intentar).toHaveBeenCalledTimes(1);
  });

  it("no espera más de 90 segundos en total: la sala está mirando", async () => {
    let t = 0;
    const intentar = vi.fn(async () => {
      t += 25_000; // cada intento tarda en rendirse
      throw new TypeError("Load failed");
    });
    const fin = await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, ahora: () => t, dormir: async (ms) => void (t += ms) });
    expect(fin.ok).toBe(false);
    expect(intentar.mock.calls.length).toBeLessThan(5);
    expect(t).toBeLessThanOrEqual(90_000 + 25_000);
  });

  it("avisa cada reintento con su número, para la línea de estado", async () => {
    const r = reloj();
    const avisos: [number, number][] = [];
    const intentar = vi.fn().mockRejectedValueOnce(new TypeError("Load failed")).mockRejectedValueOnce(new Error("tx-FAILED")).mockResolvedValue(GANADORES);
    await sortearConReintentos({ intentar, yaEsta: async () => null, reintentable, alReintentar: (i, n) => void avisos.push([i, n]), ...r });
    expect(avisos).toEqual([
      [2, 5],
      [3, 5],
    ]);
  });
});
