import { describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { type IntentoDeSello, type RespuestaConsulta, type RespuestaEnvio, enviarYConfirmar, resolverSello } from "./envio";

/**
 * Un reloj de mentira: `dormir` lo adelanta en el acto. La hora de la red (la de
 * cierre del último ledger) sale de este reloj, con los ledgers cada 5 segundos.
 */
function reloj(inicioMs = 1_792_600_000_000) {
  let t = inicioMs;
  return {
    ahora: () => t,
    dormir: async (ms: number) => void (t += ms),
    avanzar: (ms: number) => void (t += ms),
    /** La hora de cierre del último ledger, en segundos: va unos segundos atrás del reloj. */
    cierre: () => Math.floor((t - 3000) / 5000) * 5,
  };
}

const corte = (): TypeError => new TypeError("Load failed");

describe("enviarYConfirmar: mandar la misma y saber cómo terminó", () => {
  it("la red la toma, tarda en aparecer, y entra: se manda una sola vez y NOT_FOUND no es falla", async () => {
    const r = reloj();
    const enviar = vi.fn(async (): Promise<RespuestaEnvio> => ({ status: "PENDING" }));
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => (++preguntas < 4 ? { status: "NOT_FOUND", cierre: r.cierre() } : { status: "SUCCESS", cierre: r.cierre(), valor: 7n }));
    const d = await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 60, ...r });
    expect(d).toEqual({ estado: "entro", valor: 7n });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("se corta al mandar: pregunta, reenvía la MISMA y la encuentra; nunca arma otra", async () => {
    const r = reloj();
    const enviar = vi.fn<() => Promise<RespuestaEnvio>>().mockRejectedValueOnce(corte()).mockResolvedValue({ status: "DUPLICATE" });
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => {
      preguntas++;
      if (preguntas === 1) throw corte();
      return preguntas < 4 ? { status: "NOT_FOUND", cierre: r.cierre() } : { status: "SUCCESS", cierre: r.cierre() };
    });
    const d = await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 60, ...r });
    expect(d.estado).toBe("entro");
    // `enviar` es la misma transacción firmada: la función no tiene cómo armar otra.
    expect(enviar.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("rechazada al primer envío (sin saldo): lo dice con el código y no reintenta", async () => {
    const r = reloj();
    const enviar = vi.fn(async (): Promise<RespuestaEnvio> => ({ status: "ERROR", codigo: "tx_insufficient_balance" }));
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => ({ status: "NOT_FOUND", cierre: r.cierre() }));
    expect(await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 60, ...r })).toEqual({ estado: "rechazada", codigo: "tx_insufficient_balance" });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("un ERROR al reenviar, cuando la red ya la había tomado, no prueba nada: sigue preguntando y entra", async () => {
    const r = reloj();
    const enviar = vi.fn<() => Promise<RespuestaEnvio>>().mockResolvedValueOnce({ status: "PENDING" }).mockResolvedValue({ status: "ERROR", codigo: "tx_bad_seq" });
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => (++preguntas < 8 ? { status: "NOT_FOUND", cierre: r.cierre() } : { status: "SUCCESS", cierre: r.cierre() }));
    const d = await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 120, reenviarCadaMs: 3000, ...r });
    expect(d.estado).toBe("entro");
  });

  it("un ERROR después de un envío cortado tampoco: quizás la tomó", async () => {
    const r = reloj();
    const enviar = vi.fn<() => Promise<RespuestaEnvio>>().mockRejectedValueOnce(corte()).mockResolvedValue({ status: "ERROR", codigo: "tx_bad_seq" });
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => (++preguntas < 3 ? { status: "NOT_FOUND", cierre: r.cierre() } : { status: "SUCCESS", cierre: r.cierre() }));
    expect((await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 60, ...r })).estado).toBe("entro");
  });

  it("TRY_AGAIN_LATER con la transacción ya aplicada (medido en la testnet): pregunta y la encuentra", async () => {
    const r = reloj();
    const enviar = vi.fn(async (): Promise<RespuestaEnvio> => ({ status: "TRY_AGAIN_LATER" }));
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => ({ status: "SUCCESS", cierre: r.cierre(), valor: 3n }));
    expect(await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 60, ...r })).toEqual({ estado: "entro", valor: 3n });
  });

  it("TRY_AGAIN_LATER (cola llena): la misma, con espera creciente, hasta que la toma", async () => {
    const r = reloj();
    const cuando: number[] = [];
    const enviar = vi.fn(async (): Promise<RespuestaEnvio> => {
      cuando.push(r.ahora());
      return cuando.length < 4 ? { status: "TRY_AGAIN_LATER" } : { status: "PENDING" };
    });
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => {
      preguntas++;
      return cuando.length >= 4 && preguntas > 6 ? { status: "SUCCESS", cierre: r.cierre() } : { status: "NOT_FOUND", cierre: r.cierre() };
    });
    expect((await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 120, ...r })).estado).toBe("entro");
    const entre = cuando.slice(1).map((t, i) => t - (cuando[i] as number));
    expect(entre[1]).toBeGreaterThan(entre[0] as number);
  });

  it("entró y falló: lo dice (no dejó nada grabado)", async () => {
    const r = reloj();
    const d = await enviarYConfirmar({ enviar: async () => ({ status: "PENDING" }), consultar: async () => ({ status: "FAILED", cierre: r.cierre() }), venceEn: r.cierre() + 60, ...r });
    expect(d).toEqual({ estado: "fallo" });
  });

  it("no aparece: mientras la red no pase su maxTime espera, y cuando lo pasa, venció", async () => {
    const r = reloj();
    const venceEn = r.cierre() + 30;
    const vistos: number[] = [];
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => {
      vistos.push(r.cierre());
      return { status: "NOT_FOUND", cierre: r.cierre() };
    });
    const d = await enviarYConfirmar({ enviar: async () => ({ status: "PENDING" }), consultar, venceEn, ...r });
    expect(d).toEqual({ estado: "vencida" });
    // Nunca dijo "venció" con la hora de la red antes de su maxTime.
    expect(vistos.filter((c) => c > venceEn)).toHaveLength(1);
    expect(vistos.length).toBeGreaterThan(3);
  });

  it("sin red: no adivina. A los 30 s sin respuesta dice que no se sabe, nunca que no entró", async () => {
    const r = reloj();
    const enviar = vi.fn(async (): Promise<RespuestaEnvio> => {
      throw corte();
    });
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => {
      throw corte();
    });
    const t0 = r.ahora();
    const d = await enviarYConfirmar({ enviar, consultar, venceEn: r.cierre() + 600, ...r });
    expect(d.estado).toBe("sin-respuesta");
    expect(r.ahora() - t0).toBeGreaterThanOrEqual(30_000);
    expect(r.ahora() - t0).toBeLessThan(40_000);
  });

  it("solo pregunta (Pollar ya la mandó): no manda nada y la encuentra", async () => {
    const r = reloj();
    let preguntas = 0;
    const consultar = vi.fn(async (): Promise<RespuestaConsulta> => (++preguntas < 3 ? { status: "NOT_FOUND", cierre: r.cierre() } : { status: "SUCCESS", cierre: r.cierre(), valor: 9n }));
    expect(await enviarYConfirmar({ consultar, venceEn: r.cierre() + 60, ...r })).toEqual({ estado: "entro", valor: 9n });
  });

  it("un pedido colgado no cuelga el envío: tiene tope", async () => {
    const r = reloj();
    const colgado = () => new Promise<never>(() => undefined);
    const d = await enviarYConfirmar({ enviar: colgado, consultar: colgado, venceEn: r.cierre() + 600, topePedidoMs: 5, ...r });
    expect(d.estado).toBe("sin-respuesta");
  });
});

/* ------------------------------------------------------------- el sello, en una red de mentira */

const ORG = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

/**
 * Una red de mentira con el contrato adentro: los sellos que entraron, la hora de
 * cierre de cada ledger y un RPC que puede ir atrasado o estar cortado.
 */
function redDeMentira(r: ReturnType<typeof reloj>) {
  const sellos: { id: string; organizer: string; listHash: string; round: number; ledger: number }[] = [];
  let cortada = false;
  /** Cuántos ledgers va atrasado el nodo que contesta las lecturas del contrato. */
  let atraso = 0;
  const secuencia = (): number => Math.floor(r.ahora() / 5000);
  return {
    sellos,
    cortar: (si: boolean) => void (cortada = si),
    atrasar: (n: number) => void (atraso = n),
    /** Un sello que entra en el ledger de ahora, si el contrato lo acepta (la ronda a 30 s o más del ledger). */
    sellar(i: IntentoDeSello): string | null {
      if (roundTime(i.round) < r.cierre() + 30) return null;
      const id = String(sellos.length + 100);
      sellos.push({ id, organizer: i.organizer, listHash: i.listHash, round: i.round, ledger: secuencia() });
      return id;
    },
    fuentes: {
      ultimoLedger: async () => {
        if (cortada) throw corte();
        return { secuencia: secuencia(), cierre: r.cierre() };
      },
      buscarSello: async (i: IntentoDeSello) => {
        if (cortada) throw corte();
        const hasta = secuencia() - atraso;
        const s = sellos.find((x) => x.organizer === i.organizer && x.listHash === i.listHash && x.round === i.round && x.ledger <= hasta);
        return { ...(s ? { id: s.id } : {}), secuencia: hasta };
      },
      ...r,
    },
  };
}

/** Un intento de sellar ahora, con la ronda a `segundos` (como elige `freeze.ts`). */
const intento = (r: ReturnType<typeof reloj>, segundos = 45): IntentoDeSello => {
  const ahora = Math.floor(r.ahora() / 1000);
  return { organizer: ORG, listHash: "ab".repeat(32), round: targetRound(ahora, segundos), count: 5, numWinners: 1, meta: "premio", desde: ahora };
};

describe("resolverSello: el sello no se duplica nunca", () => {
  it("el envío anterior entró: lo encuentra en el contrato y ese es el sorteo", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r);
    const id = red.sellar(i);
    expect(id).not.toBeNull();
    r.avanzar(6000);
    expect(await resolverSello(i, red.fuentes)).toEqual({ estado: "entro", raffleId: id });
  });

  it("el envío anterior entra un rato después de cortarse: espera, y lo encuentra", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r);
    let vueltas = 0;
    const res = await resolverSello(i, {
      ...red.fuentes,
      alEsperar: () => {
        if (++vueltas === 2) red.sellar(i);
      },
    });
    expect(res.estado).toBe("entro");
  });

  it("el envío anterior venció: cuando la red pasa round_time - 30 y el contrato no lo tiene, no entró ni puede entrar", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r);
    const res = await resolverSello(i, red.fuentes);
    expect(res).toEqual({ estado: "no-entro" });
    // Y lo dijo recién con la hora de la red pasada del límite del contrato.
    expect(r.cierre()).toBeGreaterThanOrEqual(roundTime(i.round) - 30);
    // A esa altura, el contrato ya no lo aceptaría.
    expect(red.sellar(i)).toBeNull();
  });

  it("el envío anterior sigue pendiente: mientras pueda entrar no dice que no entró", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r, 60);
    const respuestas: number[] = [];
    const res = await resolverSello(i, {
      ...red.fuentes,
      alEsperar: () => void respuestas.push(r.cierre()),
    });
    expect(res.estado).toBe("no-entro");
    // Todas las vueltas en que esperó fueron antes del límite: no se apuró.
    expect(respuestas.every((c) => c < roundTime(i.round) - 30)).toBe(true);
    expect(respuestas.length).toBeGreaterThan(3);
  });

  it("si el nodo que lee el contrato va atrasado, no saca conclusiones con esa lectura", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r);
    red.atrasar(3);
    // Entra justo antes del límite: el nodo atrasado todavía no lo ve.
    r.avanzar((roundTime(i.round) - 32) * 1000 - r.ahora());
    const id = red.sellar(i);
    expect(id).not.toBeNull();
    const res = await resolverSello(i, red.fuentes);
    expect(res).toEqual({ estado: "entro", raffleId: id });
  });

  it("sin red: no sabe, y lo dice; nunca 'no entró'", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    red.cortar(true);
    const res = await resolverSello(intento(r), red.fuentes);
    expect(res.estado).toBe("no-se-sabe");
  });

  it("si la hora de la red llega pero el contrato no se deja leer, a los 20 s no sabe: no se queda esperando 3 minutos", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const t0 = r.ahora();
    const res = await resolverSello(intento(r), {
      ...red.fuentes,
      buscarSello: async () => {
        throw new Error("rpc-sin-respuesta: demasiados sellos para mirar");
      },
    });
    expect(res.estado).toBe("no-se-sabe");
    expect(r.ahora() - t0).toBeLessThan(30_000);
  });

  it("la red vuelve antes de rendirse: averigua igual", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = intento(r);
    red.sellar(i);
    red.cortar(true);
    let vueltas = 0;
    const res = await resolverSello(i, { ...red.fuentes, alEsperar: () => void (++vueltas === 4 && red.cortar(false)) });
    expect(res.estado).toBe("entro");
  });

  it("por el hash: si su transacción falló adentro de un ledger, no entró", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const res = await resolverSello({ ...intento(r), hash: "aa" }, { ...red.fuentes, consultarHash: async () => ({ status: "FAILED" }) });
    expect(res).toEqual({ estado: "no-entro" });
  });

  it("por el hash: si entró y devolvió el número, ese es el sorteo", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const res = await resolverSello({ ...intento(r), hash: "aa" }, { ...red.fuentes, consultarHash: async () => ({ status: "SUCCESS", raffleId: "42" }) });
    expect(res).toEqual({ estado: "entro", raffleId: "42", hash: "aa" });
  });

  it("un hash que no aparece (Pollar pudo cambiar la transacción) no prueba que no entró: manda el contrato", async () => {
    const r = reloj();
    const red = redDeMentira(r);
    const i = { ...intento(r), hash: "no-es-el-de-pollar" };
    const id = red.sellar(i);
    const res = await resolverSello(i, { ...red.fuentes, consultarHash: async () => ({ status: "NOT_FOUND" }) });
    expect(res).toEqual({ estado: "entro", raffleId: id });
  });
});
