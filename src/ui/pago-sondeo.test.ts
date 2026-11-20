import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { CADA_MS, DURANTE_MS, DURANTE_SOLO_MS, ritmoSolo, vigilarPago } from "./pago-sondeo";

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

/** Mirar solo, como lo pide la ventana de la venta por unidad. */
const SOLO = { ritmo: ritmoSolo, duranteMs: DURANTE_SOLO_MS };

/** Una pestaña de mentira: se oculta y se vuelve a ella a mano. */
function pestanaFalsa() {
  let visible = true;
  const oyentes = new Set<() => void>();
  return {
    pestana: {
      visible: () => visible,
      alVolver(f: () => void) {
        oyentes.add(f);
        return () => oyentes.delete(f);
      },
    },
    ocultar() {
      visible = false;
    },
    volver() {
      visible = true;
      for (const f of [...oyentes]) f();
    },
    oyentes,
  };
}

describe("mirar solo, en la venta por unidad", () => {
  it("son 10 segundos los primeros 2 minutos, después 30, hasta 30 minutos", () => {
    expect(ritmoSolo(0)).toBe(10_000);
    expect(ritmoSolo(119_999)).toBe(10_000);
    expect(ritmoSolo(120_000)).toBe(30_000);
    expect(DURANTE_SOLO_MS).toBe(1_800_000);
  });

  it("pregunta cada 10 segundos los primeros 2 minutos y después cada 30", async () => {
    const preguntar = vi.fn(async () => NO_LLEGO);
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn(), ...SOLO });
    await vi.advanceTimersByTimeAsync(110_000);
    // Una enseguida y una cada 10 segundos hasta los 110: 12.
    expect(preguntar).toHaveBeenCalledTimes(12);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(preguntar).toHaveBeenCalledTimes(13);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(preguntar).toHaveBeenCalledTimes(13);
    await vi.advanceTimersByTimeAsync(1);
    expect(preguntar).toHaveBeenCalledTimes(14);
  });

  it("a los 30 minutos avisa que tarda y no pregunta más", async () => {
    const preguntar = vi.fn(async () => NO_LLEGO);
    const alTardar = vi.fn();
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar, ...SOLO });
    await vi.advanceTimersByTimeAsync(DURANTE_SOLO_MS - 1);
    expect(alTardar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(alTardar).toHaveBeenCalledTimes(1);
    const n = preguntar.mock.calls.length;
    await vi.advanceTimersByTimeAsync(DURANTE_SOLO_MS);
    expect(preguntar).toHaveBeenCalledTimes(n);
    expect(alTardar).toHaveBeenCalledTimes(1);
  });

  it("con la pestaña oculta no pregunta, y al volver pregunta enseguida", async () => {
    const p = pestanaFalsa();
    const preguntar = vi.fn(async () => NO_LLEGO);
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn(), ...SOLO, pestana: p.pestana });
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(1);
    p.ocultar();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    // La que tocaba a los 10 segundos quedó pendiente y no hubo otra.
    expect(preguntar).toHaveBeenCalledTimes(1);
    p.volver();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(2);
    // Y sigue con el ritmo que corresponde a lo que pasó: cada 30 segundos.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(preguntar).toHaveBeenCalledTimes(3);
  });

  it("vuelve también con el foco, sin dos preguntas seguidas cuando el foco y la vista llegan juntos", async () => {
    const p = pestanaFalsa();
    const preguntar = vi.fn(async () => NO_LLEGO);
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn(), ...SOLO, pestana: p.pestana });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(preguntar).toHaveBeenCalledTimes(1);
    // A los 5 segundos de la última, volver al foco pregunta ya.
    p.volver();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(2);
    // Enseguida otra vuelta (la vista después del foco): no pregunta de nuevo.
    p.volver();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(2);
  });

  it("oculta pasados los 30 minutos: al volver, una última pregunta y el aviso de que tarda", async () => {
    const p = pestanaFalsa();
    const preguntar = vi.fn(async () => NO_LLEGO);
    const alTardar = vi.fn();
    vigilarPago({ preguntar, alResultado: () => "seguir", alTardar, ...SOLO, pestana: p.pestana });
    await vi.advanceTimersByTimeAsync(0);
    p.ocultar();
    await vi.advanceTimersByTimeAsync(DURANTE_SOLO_MS + 60_000);
    expect(alTardar).not.toHaveBeenCalled();
    p.volver();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(2);
    expect(alTardar).toHaveBeenCalledTimes(1);
  });

  it("mirarYa pregunta enseguida, nunca dos a la vez, y sigue con el ritmo desde ahí", async () => {
    let soltar!: (r: ResultadoDeAlta<PagoDeOrden>) => void;
    const preguntar = vi.fn(() => new Promise<ResultadoDeAlta<PagoDeOrden>>((r) => (soltar = r)));
    const s = vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn(), ...SOLO });
    await vi.advanceTimersByTimeAsync(0);
    s.mirarYa();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(1);
    soltar(NO_LLEGO);
    await vi.advanceTimersByTimeAsync(3_000);
    s.mirarYa();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(2);
    soltar(NO_LLEGO);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(preguntar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(preguntar).toHaveBeenCalledTimes(3);
  });

  it("parar suelta la pestaña: volver a ella no pregunta más", async () => {
    const p = pestanaFalsa();
    const preguntar = vi.fn(async () => NO_LLEGO);
    const s = vigilarPago({ preguntar, alResultado: () => "seguir", alTardar: vi.fn(), ...SOLO, pestana: p.pestana });
    await vi.advanceTimersByTimeAsync(0);
    s.parar();
    expect(p.oyentes.size).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    p.volver();
    await vi.advanceTimersByTimeAsync(0);
    expect(preguntar).toHaveBeenCalledTimes(1);
  });
});
