import { describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { type IntentoDeSello, SelloIncierto } from "../stellar/envio";
import { SelloSinConfirmar, sellarSinDuplicar } from "./sello-seguro";
import { CADA_REINTENTO_MS, MARGEN_DEL_REINTENTO_S, hastaDelReintento, reintentarSello } from "./sin-sello";

/**
 * "Seguir sin sello" y volver a intentarlo: la ronda es una sola. El sello que entra
 * tarde es el de la misma lista y la misma ronda (el mismo ganador); sellar otra ronda
 * sería otro sorteo, y de eso el único ataque abierto contra Tinkazo hace su negocio.
 */

const ORG = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const T0 = 1_792_990_000_000;
const RONDA = targetRound(Math.floor(T0 / 1000), 90);
const intento = (round = RONDA): IntentoDeSello => ({ organizer: ORG, listHash: "ab".repeat(32), round, count: 8, numWinners: 1, meta: "x", desde: Math.floor(T0 / 1000), hash: "tx1" });

function reloj() {
  let t = T0;
  return { ahora: () => t, dormir: async (ms: number) => void (t += ms), avanzar: (ms: number) => void (t += ms) };
}

const sinGrabar = (e: unknown): boolean => /tx-FAILED|Error\(Contract, #5\)/.test(e instanceof Error ? e.message : String(e));

function parametros(sellar: (round: number) => Promise<{ raffleId: bigint; txHash: string }>, r = reloj(), extra: Record<string, unknown> = {}) {
  const pendientes: (IntentoDeSello | null)[] = [];
  return {
    r,
    pendientes,
    p: {
      round: RONDA,
      ts: Math.floor(T0 / 1000),
      sellar,
      resolver: vi.fn(async () => ({ estado: "no-entro" as const })),
      sinGrabar,
      guardarPendiente: (i: IntentoDeSello | null) => void pendientes.push(i),
      ahora: r.ahora,
      dormir: r.dormir,
      ...extra,
    },
  };
}

describe("el reintento del sello", () => {
  it("vence 40 segundos antes de la ronda, que nace a 90: unos 50 para intentar", () => {
    expect(MARGEN_DEL_REINTENTO_S).toBe(40);
    expect(hastaDelReintento(RONDA)).toBe(roundTime(RONDA) - 40);
    expect(roundTime(RONDA) - Math.floor(T0 / 1000)).toBeGreaterThanOrEqual(90);
    expect(hastaDelReintento(RONDA) - Math.floor(T0 / 1000)).toBeGreaterThanOrEqual(50);
  });

  it("entra al primer intento: la misma lista, la misma ronda", async () => {
    const sellar = vi.fn(async (_round: number) => ({ raffleId: 777n, txHash: "tx777" }));
    const { p } = parametros(sellar);
    const r = await reintentarSello(p).fin;
    expect(r.estado).toBe("entro");
    if (r.estado === "entro") expect([r.hecho.raffleId, r.hecho.round, r.hecho.txHash]).toEqual([777n, RONDA, "tx777"]);
    expect(sellar).toHaveBeenCalledTimes(1);
    expect(sellar).toHaveBeenCalledWith(RONDA);
  });

  it("la red vuelve después de varios cortes: entra, y todos los intentos fueron con la misma ronda", async () => {
    let n = 0;
    const sellar = vi.fn(async (_round: number) => {
      // Cada intento prueba tres veces (un corte antes de mandar se reintenta dos veces): vuelve en el tercero.
      if (++n < 7) throw new TypeError("Failed to fetch");
      return { raffleId: 12n, txHash: "tx12" };
    });
    const { p, r } = parametros(sellar);
    const alIntento = vi.fn();
    const fin = await reintentarSello({ ...p, alIntento }).fin;
    expect(fin.estado).toBe("entro");
    expect(new Set(sellar.mock.calls.map((c) => c[0]))).toEqual(new Set([RONDA]));
    expect(alIntento.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    // Seguía antes de que venciera.
    expect(r.ahora() / 1000).toBeLessThan(hastaDelReintento(RONDA));
  });

  it("si la red no vuelve, vence a los 40 s de la ronda sin haber probado otra", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new TypeError("Failed to fetch");
    });
    const { p, r } = parametros(sellar);
    const alFallar = vi.fn();
    const fin = await reintentarSello({ ...p, alFallar }).fin;
    expect(fin).toEqual({ estado: "vencio" });
    expect(new Set(sellar.mock.calls.map((c) => c[0]))).toEqual(new Set([RONDA]));
    expect(r.ahora() / 1000).toBeGreaterThanOrEqual(hastaDelReintento(RONDA));
    expect(alFallar).toHaveBeenCalled();
  });

  it("cada intento espera 15 s: en 50 s son unos cuatro, no cientos", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new Error("HTTP 503");
    });
    const { p } = parametros(sellar);
    const alIntento = vi.fn();
    await reintentarSello({ ...p, alIntento }).fin;
    expect(CADA_REINTENTO_MS).toBe(15_000);
    expect(alIntento.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(alIntento.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("si la ronda quedó cerca (el contrato la rechaza), se terminó: no hay otra ronda", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new Error("la ronda quedó cerca antes de mandar el sello (faltan 31 s): Error(Contract, #5)");
    });
    const { p } = parametros(sellar);
    const fin = await reintentarSello(p).fin;
    expect(fin).toEqual({ estado: "vencio" });
    expect(sellar).toHaveBeenCalledTimes(1);
  });

  it("si no se pudo saber si entró, queda incierto con su intento y no se manda otro", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new SelloIncierto(intento(), new TypeError("Load failed"));
    });
    const { p, pendientes } = parametros(sellar, reloj(), { resolver: vi.fn(async () => ({ estado: "no-se-sabe" as const, error: new Error("sin red") })) });
    const fin = await reintentarSello(p).fin;
    expect(fin.estado).toBe("incierto");
    expect(sellar).toHaveBeenCalledTimes(1);
    expect(pendientes[0]?.round).toBe(RONDA);
  });

  it("si se mandó y entró aunque la respuesta se perdió, lo encuentra: es el mismo sello", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new SelloIncierto(intento(), new TypeError("Load failed"));
    });
    const { p } = parametros(sellar, reloj(), { resolver: vi.fn(async () => ({ estado: "entro" as const, raffleId: "55", hash: "tx1" })) });
    const fin = await reintentarSello(p).fin;
    expect(fin.estado).toBe("entro");
    if (fin.estado === "entro") expect([fin.hecho.raffleId, fin.hecho.round]).toEqual([55n, RONDA]);
    expect(sellar).toHaveBeenCalledTimes(1);
  });

  it("cancelar corta antes del próximo intento", async () => {
    const r = reloj();
    const sellar = vi.fn(async (_round: number) => {
      throw new TypeError("Failed to fetch");
    });
    // Las esperas cortas de un intento pasan; la de 15 s entre intentos no termina nunca.
    const { p } = parametros(sellar, r, { dormir: (ms: number) => (ms < 10_000 ? Promise.resolve() : new Promise<void>(() => undefined)) });
    const re = reintentarSello(p);
    await new Promise((x) => setTimeout(x, 5));
    re.cancelar();
    await expect(re.fin).resolves.toEqual({ estado: "cancelado" });
    expect(sellar).toHaveBeenCalledTimes(3);
  });

  it("'Volver a intentar el sello' no espera los 15 s", async () => {
    const r = reloj();
    let intentos = 0;
    const sellar = vi.fn(async (_round: number) => {
      intentos++;
      // Un error que no es de la red ni de la ronda: el intento termina y espera al próximo.
      if (intentos < 2) throw new Error("la billetera no contestó");
      return { raffleId: 3n, txHash: "tx3" };
    });
    // Las esperas cortas de un intento pasan; la de 15 s entre intentos solo la termina el botón.
    const { p } = parametros(sellar, r, { dormir: (ms: number) => (ms < 10_000 ? Promise.resolve() : new Promise<void>(() => undefined)) });
    const re = reintentarSello(p);
    await new Promise((x) => setTimeout(x, 5));
    expect(intentos).toBe(1);
    expect(re.enCurso()).toBe(false);
    re.reintentarYa();
    const fin = await re.fin;
    expect(fin.estado).toBe("entro");
    expect(intentos).toBe(2);
  });
});

describe("sellarSinDuplicar sin rondaNueva: la ronda es una sola", () => {
  const base = () => {
    const dormir = vi.fn(async () => undefined);
    return { dormir, guardarPendiente: vi.fn(), sinGrabar, resolver: vi.fn(async () => ({ estado: "no-entro" as const })) };
  };

  it("un corte antes de mandar se reintenta con la misma ronda (dos veces) y después sale el error", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new TypeError("Failed to fetch");
    });
    await expect(sellarSinDuplicar({ round: RONDA, ts: 1 }, { ...base(), sellar }, null)).rejects.toThrow("Failed to fetch");
    expect(sellar.mock.calls.map((c) => c[0])).toEqual([RONDA, RONDA, RONDA]);
  });

  it("un sello que falló por la ronda no pide otra: sale el error", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new Error("tx-FAILED");
    });
    await expect(sellarSinDuplicar({ round: RONDA, ts: 1 }, { ...base(), sellar }, null)).rejects.toThrow("tx-FAILED");
    expect(sellar).toHaveBeenCalledTimes(1);
  });

  it("un sello que se mandó, no entró y ya no puede entrar, tampoco pide otra ronda", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new SelloIncierto(intento(), new Error("tx-EXPIRED"));
    });
    await expect(sellarSinDuplicar({ round: RONDA, ts: 1 }, { ...base(), sellar }, null)).rejects.toThrow("tx-EXPIRED");
    expect(sellar).toHaveBeenCalledTimes(1);
  });

  it("si no se puede averiguar, sigue siendo SelloSinConfirmar", async () => {
    const sellar = vi.fn(async (_round: number) => {
      throw new SelloIncierto(intento(), new TypeError("Load failed"));
    });
    const b = base();
    const resolver = vi.fn(async () => ({ estado: "no-se-sabe" as const, error: new Error("x") }));
    await expect(sellarSinDuplicar({ round: RONDA, ts: 1 }, { ...b, resolver, sellar }, null)).rejects.toBeInstanceOf(SelloSinConfirmar);
  });

  it("con rondaNueva sigue como siempre (hasta tres intentos con otras rondas)", async () => {
    let n = 0;
    const sellar = vi.fn(async (_round: number) => {
      if (++n < 3) throw new Error("tx-FAILED");
      return { raffleId: 9n, txHash: "t" };
    });
    const nuevas: number[] = [];
    const r = await sellarSinDuplicar({ round: RONDA, ts: 1 }, { ...base(), sellar, rondaNueva: () => (nuevas.push(1), { round: RONDA + 20 + nuevas.length, ts: 2 }) }, null);
    expect(r.raffleId).toBe(9n);
    expect(nuevas).toHaveLength(2);
  });
});
