import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { CADA_MS, DURANTE_MS, vigilarPago } from "./pago-sondeo";

/**
 * «Ya pagué» pregunta por el pago enseguida y después sola, cada 10 segundos durante 5 minutos, de a una pregunta por
 * vez. Quien la usa decide con cada respuesta si sigue o para; a los 5 minutos avisa que tarda y no pregunta más.
 */

const NO_LLEGO: ResultadoDeAlta<PagoDeOrden> = { ok: true, datos: { pagada: false, recibido: "0", total: "3", minimo: "2.85" } };
const LLEGO: ResultadoDeAlta<PagoDeOrden> = { ok: true, datos: { pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" } };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("el sondeo del pago", () => {
  it("son 10 segundos y 5 minutos", () => {
    expect(CADA_MS).toBe(10_000);
    expect(DURANTE_MS).toBe(300_000);
  });

  it("pregunta enseguida, después cada 10 segundos, y a los 5 minutos avisa que tarda y deja de preguntar", async () => {
    const preguntar = vi.fn(async () => NO_LLEGO);
    const alTardar = vi.fn();
    const alResultado = vi.fn(() => "seguir" as const);
    vigilarPago({ preguntar, alResultado, alTardar });
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(preguntar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(preguntar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DURANTE_MS);
    // Una enseguida y una cada 10 segundos hasta los 5 minutos: 31.
    expect(preguntar).toHaveBeenCalledTimes(31);
    expect(alTardar).toHaveBeenCalledTimes(1);
    expect(alResultado).toHaveBeenCalledTimes(31);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(preguntar).toHaveBeenCalledTimes(31);
    expect(alTardar).toHaveBeenCalledTimes(1);
  });

  it("apenas llega, quien lo usa para: ni una pregunta más ni el aviso de que tarda", async () => {
    const respuestas = [NO_LLEGO, NO_LLEGO, LLEGO];
    const preguntar = vi.fn(async () => respuestas.shift() ?? LLEGO);
    const alTardar = vi.fn();
    const vistos: boolean[] = [];
    vigilarPago({
      preguntar,
      alTardar,
      alResultado: (r) => {
        const pagada = r.ok && r.datos.pagada;
        vistos.push(pagada);
        return pagada ? "parar" : "seguir";
      },
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(vistos).toEqual([false, false, true]);
    await vi.advanceTimersByTimeAsync(DURANTE_MS);
    expect(preguntar).toHaveBeenCalledTimes(3);
    expect(alTardar).not.toHaveBeenCalled();
  });

  it("nunca dos preguntas a la vez: la siguiente espera a que vuelva la anterior", async () => {
    let soltar!: (r: ResultadoDeAlta<PagoDeOrden>) => void;
    const preguntar = vi.fn(() => new Promise<ResultadoDeAlta<PagoDeOrden>>((r) => (soltar = r)));
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(preguntar).toHaveBeenCalledTimes(1);
    soltar(NO_LLEGO);
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CADA_MS);
    expect(preguntar).toHaveBeenCalledTimes(2);
  });

  it("si la pregunta se rompe, llega como sin servicio: nunca lanza", async () => {
    const preguntar = vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => Promise.reject(new Error("corte")));
    const alResultado = vi.fn(() => "parar" as const);
    vigilarPago({ preguntar, alResultado, alTardar: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(alResultado).toHaveBeenCalledWith({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 });
  });

  it("parar corta todo: lo que vuelve después no llega, y no se pregunta más", async () => {
    let soltar!: (r: ResultadoDeAlta<PagoDeOrden>) => void;
    const preguntar = vi.fn(() => new Promise<ResultadoDeAlta<PagoDeOrden>>((r) => (soltar = r)));
    const alResultado = vi.fn(() => "seguir" as const);
    const alTardar = vi.fn();
    const s = vigilarPago({ preguntar, alResultado, alTardar });
    await vi.advanceTimersByTimeAsync(0);
    s.parar();
    soltar(LLEGO);
    await vi.advanceTimersByTimeAsync(DURANTE_MS * 2);
    expect(alResultado).not.toHaveBeenCalled();
    expect(alTardar).not.toHaveBeenCalled();
    expect(preguntar).toHaveBeenCalledTimes(1);
  });
});
