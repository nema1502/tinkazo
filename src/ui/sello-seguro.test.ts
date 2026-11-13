import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { type IntentoDeSello, SelloIncierto, resolverSello } from "../stellar/envio";
import { AVISO_OTRA_RONDA_MS, CLAVE_PENDIENTE, MARGEN_CON_PORTERO_S, MAS_LEJOS_POR_INTENTO_S, SelloSinConfirmar, averiguarPendiente, guardarPendiente, leerPendiente, margenDelPrimerIntento, rondasDesde, sellarSinDuplicar } from "./sello-seguro";

/**
 * "Ningún reintento puede crear un segundo sello", contra una red de mentira: el
 * contrato con sus reglas (no acepta una ronda a menos de 30 s del ledger), los
 * ledgers cada 5 segundos, envíos que entran al toque, tarde o nunca, respuestas
 * que llegan o se pierden en el camino, y cortes de red. El que averigua es el de
 * verdad (`resolverSello`); lo único de mentira es la red.
 */

const ORG = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const HUELLA = "cd".repeat(32);

type Entra = "ya" | "tarde" | "nunca";
type Respuesta = "vuelve" | "se-pierde";
interface Guion {
  entra: Entra;
  /** Con "tarde": cuántos ms después del envío entra (si el contrato todavía lo acepta). */
  tardeMs?: number;
  respuesta: Respuesta;
  /** Falla antes de mandar nada, con este error. */
  antes?: unknown;
}

function escenario(guiones: Guion[]) {
  let t = 1_792_600_000_000;
  const ahora = (): number => t;
  const cierre = (): number => Math.floor((t - 3000) / 5000) * 5;
  const secuencia = (): number => Math.floor(t / 5000);
  const sellos: { id: string; intento: IntentoDeSello; ledger: number }[] = [];
  const porEntrar: { cuando: number; intento: IntentoDeSello }[] = [];
  let cortada = false;
  const envios: IntentoDeSello[] = [];

  /** El contrato: acepta el sello si la ronda nace a 30 s o más de la hora del ledger. */
  const aplicar = (i: IntentoDeSello): string | null => {
    if (roundTime(i.round) < cierre() + 30) return null;
    const id = String(500 + sellos.length);
    sellos.push({ id, intento: i, ledger: secuencia() });
    return id;
  };
  /** Lo que estaba en la cola y ya es hora de que entre. */
  const avanzarCola = (): void => {
    for (const p of porEntrar.splice(0)) {
      if (p.cuando <= t) aplicar(p.intento);
      else porEntrar.push(p);
    }
  };
  const dormir = async (ms: number): Promise<void> => {
    t += ms;
    avanzarCola();
  };

  const sellar = vi.fn(async (round: number) => {
    const g = guiones.shift();
    if (!g) throw new Error("el guion no preveía otro envío");
    t += 2500; // armar, simular y firmar
    avanzarCola();
    if (g.antes) throw g.antes;
    const intento: IntentoDeSello = { organizer: ORG, listHash: HUELLA, round, count: 8, numWinners: 1, meta: "premio", desde: Math.floor(t / 1000), hash: `tx${envios.length}` };
    envios.push(intento);
    t += 1500;
    let id: string | null = null;
    if (g.entra === "ya") id = aplicar(intento);
    else if (g.entra === "tarde") porEntrar.push({ cuando: t + (g.tardeMs ?? 8000), intento });
    if (g.respuesta === "se-pierde") throw new SelloIncierto(intento, new TypeError("Load failed"));
    if (!id) throw new Error("tx-FAILED");
    return { raffleId: BigInt(id), txHash: intento.hash as string };
  });

  const fuentes = {
    ultimoLedger: async () => {
      avanzarCola();
      if (cortada) throw new TypeError("Load failed");
      return { secuencia: secuencia(), cierre: cierre() };
    },
    buscarSello: async (i: IntentoDeSello) => {
      if (cortada) throw new TypeError("Load failed");
      const s = sellos.find((x) => x.intento.organizer === i.organizer && x.intento.listHash === i.listHash && x.intento.round === i.round);
      return { ...(s ? { id: s.id } : {}), secuencia: secuencia() };
    },
    ahora,
    dormir,
  };
  const pendientes: (IntentoDeSello | null)[] = [];
  const pasos = {
    sellar,
    resolver: (i: IntentoDeSello) => resolverSello(i, fuentes),
    rondaNueva: () => ({ round: targetRound(Math.floor(t / 1000), 45), ts: Math.floor(t / 1000) }),
    sinGrabar: (e: unknown) => /tx-FAILED|Error\(Contract, #5\)/.test(e instanceof Error ? e.message : String(e)),
    guardarPendiente: (i: IntentoDeSello | null) => void pendientes.push(i),
    dormir,
  };
  return {
    pasos,
    sellos,
    envios,
    pendientes,
    cortar: (si: boolean) => void (cortada = si),
    inicial: () => ({ round: targetRound(Math.floor(t / 1000), 45), ts: Math.floor(t / 1000) }),
    /** Cuántos sellos de esta lista hay en el contrato. Nunca más de uno. */
    sellosDeLaLista: () => sellos.filter((s) => s.intento.listHash === HUELLA).length,
    avanzar: (ms: number) => void dormir(ms),
  };
}

describe("sellarSinDuplicar: el sello no se duplica nunca", () => {
  it("todo bien: un envío, un sello", async () => {
    const e = escenario([{ entra: "ya", respuesta: "vuelve" }]);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(r.raffleId).toBe(500n);
    expect(e.sellosDeLaLista()).toBe(1);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
  });

  it("el envío anterior entró y la respuesta se perdió: lo encuentra y no manda otro", async () => {
    const e = escenario([{ entra: "ya", respuesta: "se-pierde" }]);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(r.raffleId).toBe(500n);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
    expect(e.sellosDeLaLista()).toBe(1);
    // Mientras se averiguaba quedó guardado, y al saberlo se borró.
    expect(e.pendientes.at(0)).not.toBeNull();
    expect(e.pendientes.at(-1)).toBeNull();
  });

  it("el envío anterior venció sin entrar: recién cuando el contrato ya no lo aceptaría, manda otro con otra ronda", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "se-pierde" },
      { entra: "ya", respuesta: "vuelve" },
    ]);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(2);
    const [primera, segunda] = e.pasos.sellar.mock.calls.map((c) => c[0]);
    expect(segunda).not.toBe(primera);
    expect(r.round).toBe(segunda);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("el envío anterior sigue pendiente y entra tarde: lo espera, lo encuentra y no manda otro", async () => {
    const e = escenario([{ entra: "tarde", tardeMs: 7000, respuesta: "se-pierde" }]);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(r.raffleId).toBe(500n);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("entra tan tarde que el contrato ya no lo acepta: no quedó nada, y el segundo es el único", async () => {
    const e = escenario([
      { entra: "tarde", tardeMs: 60_000, respuesta: "se-pierde" },
      { entra: "ya", respuesta: "vuelve" },
    ]);
    await sellarSinDuplicar(e.inicial(), e.pasos);
    e.avanzar(120_000);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("sin red para averiguar: no manda otro, guarda el intento y lo dice", async () => {
    const e = escenario([{ entra: "ya", respuesta: "se-pierde" }]);
    const corrida = sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      sellar: async (round) => {
        const r = e.pasos.sellar(round);
        e.cortar(true);
        return r;
      },
    });
    await expect(corrida).rejects.toBeInstanceOf(SelloSinConfirmar);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
    expect(e.pendientes.at(-1)).not.toBeNull();
  });

  it("y al volver a apretar, con la red de nuevo: si el primero había entrado, retoma ese y no sella otra vez", async () => {
    const e = escenario([{ entra: "ya", respuesta: "se-pierde" }]);
    let pendiente: IntentoDeSello | null = null;
    e.cortar(false);
    await sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      sellar: async (round) => {
        const r = e.pasos.sellar(round);
        e.cortar(true);
        return r;
      },
      guardarPendiente: (i) => void (pendiente = i ?? pendiente),
    }).catch(() => undefined);
    expect(pendiente).not.toBeNull();
    e.cortar(false);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos, pendiente);
    expect(r.retomado).toEqual(pendiente);
    expect(r.raffleId).toBe(500n);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("y si el primero no había entrado, sella una sola vez", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "se-pierde" },
      { entra: "ya", respuesta: "vuelve" },
    ]);
    let pendiente: IntentoDeSello | null = null;
    await sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      sellar: async (round) => {
        const r = e.pasos.sellar(round);
        e.cortar(true);
        return r;
      },
      guardarPendiente: (i) => void (pendiente = i ?? pendiente),
    }).catch(() => undefined);
    e.cortar(false);
    e.avanzar(90_000);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos, pendiente);
    expect(r.retomado).toBeUndefined();
    expect(e.pasos.sellar).toHaveBeenCalledTimes(2);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("un pendiente que todavía no se puede averiguar: no se manda nada", async () => {
    const e = escenario([{ entra: "ya", respuesta: "vuelve" }]);
    e.cortar(true);
    const i: IntentoDeSello = { organizer: ORG, listHash: HUELLA, round: e.inicial().round, count: 8, numWinners: 1, meta: "premio", desde: 0 };
    await expect(sellarSinDuplicar(e.inicial(), e.pasos, i)).rejects.toBeInstanceOf(SelloSinConfirmar);
    expect(e.pasos.sellar).not.toHaveBeenCalled();
  });

  it("un corte antes de mandar nada (al simular) se reintenta solo, con espera creciente", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "vuelve", antes: new TypeError("Failed to fetch") },
      { entra: "nunca", respuesta: "vuelve", antes: Object.assign(new Error("Request failed with status code 503"), { name: "AxiosError", response: { status: 503 } }) },
      { entra: "ya", respuesta: "vuelve" },
    ]);
    const avisos: string[] = [];
    const r = await sellarSinDuplicar(e.inicial(), { ...e.pasos, avisar: (q) => void avisos.push(q) });
    expect(r.raffleId).toBe(500n);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(3);
    expect(avisos).toEqual(["reintentando", "reintentando"]);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("después de cada corte antes de mandar elige la ronda de nuevo, con el margen entero: no gasta un cambio de ronda en 'quedó cerca'", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "vuelve", antes: new TypeError("Load failed") },
      { entra: "nunca", respuesta: "vuelve", antes: new TypeError("Load failed") },
      { entra: "ya", respuesta: "vuelve" },
    ]);
    const rondaNueva = vi.fn(e.pasos.rondaNueva);
    const r = await sellarSinDuplicar(e.inicial(), { ...e.pasos, rondaNueva });
    expect(rondaNueva).toHaveBeenCalledTimes(2);
    // Cada intento sale con la ronda recién elegida: 45 s o más desde que se eligió.
    const rondas = e.pasos.sellar.mock.calls.map(([round]) => round);
    expect(new Set(rondas).size).toBe(3);
    expect(r.round).toBe(rondas[2]);
    expect(e.sellosDeLaLista()).toBe(1);
  });

  it("a la tercera vez sin red antes de mandar, se rinde y dice que no hay red", async () => {
    const corte = (): TypeError => new TypeError("Load failed");
    const e = escenario([
      { entra: "nunca", respuesta: "vuelve", antes: corte() },
      { entra: "nunca", respuesta: "vuelve", antes: corte() },
      { entra: "nunca", respuesta: "vuelve", antes: corte() },
    ]);
    await expect(sellarSinDuplicar(e.inicial(), e.pasos)).rejects.toThrow("Load failed");
    expect(e.sellosDeLaLista()).toBe(0);
  });

  it("la espera de la cuenta de Pollar sin red ya esperó 90 s: no se vuelve a esperar", async () => {
    const e = escenario([{ entra: "nunca", respuesta: "vuelve", antes: new Error("account-check-network") }]);
    await expect(sellarSinDuplicar(e.inicial(), e.pasos)).rejects.toThrow("account-check-network");
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
  });

  it("la ronda quedó cerca (entró y falló): otra ronda, hasta tres intentos, como siempre", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "vuelve" },
      { entra: "nunca", respuesta: "vuelve" },
      { entra: "nunca", respuesta: "vuelve" },
    ]);
    await expect(sellarSinDuplicar(e.inicial(), e.pasos)).rejects.toThrow("tx-FAILED");
    expect(e.pasos.sellar).toHaveBeenCalledTimes(3);
    expect(e.sellosDeLaLista()).toBe(0);
  });

  it("una mezcla de todo: nunca más de un sello de la lista", async () => {
    const e = escenario([
      { entra: "nunca", respuesta: "vuelve", antes: new TypeError("Failed to fetch") },
      { entra: "tarde", tardeMs: 90_000, respuesta: "se-pierde" },
      { entra: "tarde", tardeMs: 4000, respuesta: "se-pierde" },
    ]);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    e.avanzar(200_000);
    expect(e.sellosDeLaLista()).toBe(1);
    expect(r.raffleId).toBe(500n);
  });
});

describe("averiguarPendiente: saber si un sello entró sin mandar ninguno", () => {
  it("si entró, lo dice y no lo borra: quien sigue lo retoma", async () => {
    const e = escenario([{ entra: "ya", respuesta: "se-pierde" }]);
    let pendiente: IntentoDeSello | null = null;
    await sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      sellar: async (round) => {
        const r = e.pasos.sellar(round);
        e.cortar(true);
        return r;
      },
      guardarPendiente: (i) => void (pendiente = i ?? pendiente),
    }).catch(() => undefined);
    e.cortar(false);
    const avisos: string[] = [];
    const r = await averiguarPendiente(pendiente as unknown as IntentoDeSello, { resolver: e.pasos.resolver, guardarPendiente: e.pasos.guardarPendiente, avisar: (q) => void avisos.push(q) });
    expect(r.estado).toBe("entro");
    expect(avisos).toEqual(["verificando"]);
    // No se borró nada: el que sigue lo retoma y lo borra al saber cómo terminó.
    expect(e.pendientes).toEqual([]);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
  });

  it("si no entró ni puede entrar, lo borra y no manda nada", async () => {
    const e = escenario([{ entra: "nunca", respuesta: "se-pierde" }]);
    let pendiente: IntentoDeSello | null = null;
    await sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      sellar: async (round) => {
        const r = e.pasos.sellar(round);
        e.cortar(true);
        return r;
      },
      guardarPendiente: (i) => void (pendiente = i ?? pendiente),
    }).catch(() => undefined);
    e.cortar(false);
    e.avanzar(90_000);
    const r = await averiguarPendiente(pendiente as unknown as IntentoDeSello, { resolver: e.pasos.resolver, guardarPendiente: e.pasos.guardarPendiente });
    expect(r.estado).toBe("no-entro");
    expect(e.pendientes.at(-1)).toBeNull();
    expect(e.pasos.sellar).toHaveBeenCalledTimes(1);
  });

  it("si no se puede averiguar, lo dice y deja el intento guardado", async () => {
    const e = escenario([{ entra: "ya", respuesta: "vuelve" }]);
    e.cortar(true);
    const i: IntentoDeSello = { organizer: ORG, listHash: HUELLA, round: e.inicial().round, count: 8, numWinners: 1, meta: "premio", desde: 0 };
    const r = await averiguarPendiente(i, { resolver: e.pasos.resolver, guardarPendiente: e.pasos.guardarPendiente });
    expect(r.estado).toBe("no-se-sabe");
    expect(e.pendientes).toEqual([]);
    expect(e.pasos.sellar).not.toHaveBeenCalled();
  });
});

describe("sellarSinDuplicar: con la red lenta, cada ronda nueva nace más lejos", () => {
  /**
   * Una red lenta como la del 8 de noviembre de 2026 (testnet, portero en local): del
   * momento en que se elige la ronda hasta el ledger que la incluye pasan 20 s. El
   * contrato pide 30 s entre ese ledger y la ronda, así que con 45 s de margen siempre
   * falla (`RoundTooSoon`) y con 65 entra.
   */
  function redLenta(demoraS = 20) {
    let t = 1_792_600_000;
    const sellos: number[] = [];
    const rondaNueva = vi.fn((masLejosS = 0) => ({ round: targetRound(t, 45 + masLejosS), ts: t }));
    const sellar = vi.fn(async (round: number) => {
      t += demoraS;
      if (roundTime(round) < t + 30) throw new Error("HostError: Error(Contract, #5)");
      sellos.push(round);
      return { raffleId: BigInt(600 + sellos.length), txHash: `tx${sellos.length}` };
    });
    const avisos: string[] = [];
    const pasos = {
      sellar,
      resolver: async () => ({ estado: "no-entro" as const }),
      rondaNueva,
      sinGrabar: (e: unknown) => /Error\(Contract, #5\)|tx-FAILED/.test(e instanceof Error ? e.message : String(e)),
      guardarPendiente: () => undefined,
      dormir: async () => undefined,
      avisar: (q: string) => void avisos.push(q),
    };
    return { pasos, sellos, avisos, rondaNueva, inicial: () => rondaNueva(0) };
  }

  it("la primera ronda queda cerca y la segunda, 20 s más lejos, entra; se avisa que se prueba con otra", async () => {
    const e = redLenta();
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(e.pasos.sellar).toHaveBeenCalledTimes(2);
    expect(e.rondaNueva.mock.calls.map((c) => c[0])).toEqual([0, 20]);
    expect(e.avisos).toEqual(["otra-ronda"]);
    expect(e.sellos).toEqual([r.round]);
    expect(r.raffleId).toBe(601n);
  });

  it("si la red está todavía más lenta, la tercera va 40 s más lejos", async () => {
    const e = redLenta(38);
    const r = await sellarSinDuplicar(e.inicial(), e.pasos);
    expect(e.rondaNueva.mock.calls.map((c) => c[0])).toEqual([0, 20, 40]);
    expect(e.avisos).toEqual(["otra-ronda", "otra-ronda"]);
    expect(e.sellos).toEqual([r.round]);
  });

  it("y si ni así alcanza, se rinde a la tercera con el error del contrato, sin grabar nada", async () => {
    const e = redLenta(60);
    await expect(sellarSinDuplicar(e.inicial(), e.pasos)).rejects.toThrow("Error(Contract, #5)");
    expect(e.pasos.sellar).toHaveBeenCalledTimes(3);
    expect(e.sellos).toEqual([]);
  });

  it("un sello que se cortó y no entró también vuelve con la ronda más lejos", async () => {
    let t = 1_792_600_000;
    const rondaNueva = vi.fn((masLejosS = 0) => ({ round: targetRound(t, 45 + masLejosS), ts: t }));
    let vez = 0;
    const sellar = vi.fn(async (round: number) => {
      t += 5;
      vez++;
      const intento: IntentoDeSello = { organizer: ORG, listHash: HUELLA, round, count: 8, numWinners: 1, meta: "premio", desde: t, hash: `tx${vez}` };
      if (vez === 1) throw new SelloIncierto(intento, new TypeError("Load failed"));
      return { raffleId: 700n, txHash: "tx2" };
    });
    const avisos: string[] = [];
    const r = await sellarSinDuplicar(rondaNueva(0), {
      sellar,
      resolver: async () => ({ estado: "no-entro" as const }),
      rondaNueva,
      sinGrabar: () => false,
      guardarPendiente: () => undefined,
      dormir: async () => undefined,
      avisar: (q) => void avisos.push(q),
    });
    expect(r.raffleId).toBe(700n);
    expect(rondaNueva.mock.calls.map((c) => c[0])).toEqual([0, 20]);
    expect(avisos).toEqual(["verificando", "otra-ronda"]);
  });

  it("el aviso de otra ronda queda a la vista 1,5 s antes de seguir, y la espera no le quita margen a la ronda", async () => {
    const e = redLenta();
    const orden: string[] = [];
    const rondaNueva = vi.fn((masLejosS = 0) => {
      orden.push(`ronda:${masLejosS}`);
      return e.rondaNueva(masLejosS);
    });
    await sellarSinDuplicar(e.inicial(), {
      ...e.pasos,
      rondaNueva,
      avisar: (q) => void orden.push(`aviso:${q}`),
      dormir: async (ms) => void orden.push(`espera:${ms}`),
    });
    expect(AVISO_OTRA_RONDA_MS).toBeGreaterThanOrEqual(1500);
    // Primero el aviso, después la espera y recién ahí se elige la ronda, contada desde ese momento.
    expect(orden).toEqual(["aviso:otra-ronda", `espera:${AVISO_OTRA_RONDA_MS}`, "ronda:20"]);
  });

  it("un corte antes de mandar nada no aleja la ronda: no fue la red lenta, se elige con el margen del camino", async () => {
    const e = redLenta(0);
    let vez = 0;
    const sellar = vi.fn(async (round: number) => {
      vez++;
      if (vez === 1) throw new TypeError("Failed to fetch");
      return e.pasos.sellar(round);
    });
    await sellarSinDuplicar(e.inicial(), { ...e.pasos, sellar });
    expect(e.rondaNueva.mock.calls.map((c) => c[0])).toEqual([0, 0]);
    expect(e.avisos).toEqual(["reintentando"]);
  });

  it("un corte después de una ronda que no quedó grabada conserva lo que ya se había alejado", async () => {
    const e = redLenta(0);
    let vez = 0;
    const sellar = vi.fn(async (round: number) => {
      vez++;
      if (vez === 1) throw new Error("HostError: Error(Contract, #5)");
      if (vez === 2) throw new TypeError("Failed to fetch");
      return e.pasos.sellar(round);
    });
    await sellarSinDuplicar(e.inicial(), { ...e.pasos, sellar });
    expect(e.rondaNueva.mock.calls.map((c) => c[0])).toEqual([0, 20, 20]);
    expect(e.avisos).toEqual(["otra-ronda", "reintentando"]);
  });
});

describe("el margen de cada intento según quién paga la comisión", () => {
  it("con portero el primer intento pide 65 s; sin portero, 45; con Freighter, 45 más", () => {
    expect(MARGEN_CON_PORTERO_S).toBe(65);
    expect(margenDelPrimerIntento(45, { conPortero: true, paraAprobar: 0 })).toBe(65);
    expect(margenDelPrimerIntento(45, { conPortero: false, paraAprobar: 0 })).toBe(45);
    expect(margenDelPrimerIntento(45, { conPortero: false, paraAprobar: 45 })).toBe(90);
    // Si la URL pide más (`?lead=`), manda la URL también con portero.
    expect(margenDelPrimerIntento(80, { conPortero: true, paraAprobar: 0 })).toBe(80);
  });

  /** Una red donde nada entra hasta la tercera ronda: se miran los márgenes que se pidieron. */
  function margenesPedidos(margen: number) {
    const t = 1_792_600_000;
    const rondas = rondasDesde(margen, () => t);
    const pedidas: number[] = [];
    const sellar = vi.fn(async (round: number) => {
      pedidas.push(roundTime(round) - t);
      if (pedidas.length < 3) throw new Error("HostError: Error(Contract, #5)");
      return { raffleId: 1n, txHash: "tx" };
    });
    return Object.assign(pedidas, {
      correr: () =>
        sellarSinDuplicar(rondas(), {
          sellar,
          resolver: async () => ({ estado: "no-entro" as const }),
          rondaNueva: rondas,
          sinGrabar: () => true,
          guardarPendiente: () => undefined,
          dormir: async () => undefined,
        }),
    });
  }

  it.each([
    ["con portero", 65],
    ["sin portero", 45],
  ])("%s, los reintentos suman 20 s cada uno sobre el margen del camino", async (_, margen) => {
    const pedidas = margenesPedidos(margen);
    await pedidas.correr();
    expect(MAS_LEJOS_POR_INTENTO_S).toBe(20);
    // La ronda de quicknet nace cada 3 s: la elegida cae a lo sumo 3 s después del margen.
    expect(pedidas).toHaveLength(3);
    pedidas.forEach((s, i) => {
      expect(s).toBeGreaterThanOrEqual(margen + 20 * i);
      expect(s).toBeLessThan(margen + 20 * i + 3);
    });
  });

  it("la ronda sale del reloj de ese momento, no de una constante", () => {
    let t = 1_792_600_000;
    const rondas = rondasDesde(65, () => t);
    const a = rondas();
    t += 30;
    const b = rondas();
    expect(a.round).toBe(targetRound(1_792_600_000, 65));
    expect(b).toEqual({ round: targetRound(1_792_600_030, 65), ts: 1_792_600_030 });
  });
});

describe("el intento pendiente se guarda para después de recargar", () => {
  const datos = new Map<string, string>();
  beforeEach(() => {
    datos.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    });
  });
  afterEach(() => {
    guardarPendiente(null, "", "", "");
    vi.unstubAllGlobals();
  });

  const i: IntentoDeSello = { organizer: ORG, listHash: HUELLA, round: 33_300_000, count: 8, numWinners: 2, meta: "Una bici", desde: 1_792_600_000, hash: "ab12" };
  // La hora de estas pruebas es fija: el pendiente vence a las 6 h de su ronda y, con la
  // hora real, esta ronda ya venció y las pruebas fallaban solo por el paso del tiempo.
  const AHORA = roundTime(i.round) + 60;

  it("lo guarda con la red, el contrato y el premio, y lo devuelve solo para la misma cuenta, lista, red y contrato", () => {
    guardarPendiente(i, "testnet", "CCONTRATO", "Una bici");
    expect(JSON.parse(datos.get(CLAVE_PENDIENTE) as string)).toEqual({ intento: i, red: "testnet", contrato: "CCONTRATO", premio: "Una bici" });
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO", AHORA)).toEqual({ intento: i, premio: "Una bici" });
    expect(leerPendiente("GOTRA", HUELLA, "testnet", "CCONTRATO", AHORA)).toBeNull();
    expect(leerPendiente(ORG, "ef".repeat(32), "testnet", "CCONTRATO", AHORA)).toBeNull();
    expect(leerPendiente(ORG, HUELLA, "mainnet", "CCONTRATO", AHORA)).toBeNull();
    expect(leerPendiente(ORG, HUELLA, "testnet", "COTRO", AHORA)).toBeNull();
  });

  it("vence seis horas después de su ronda: si había entrado, se retoma desde Mis sorteos", () => {
    guardarPendiente(i, "testnet", "CCONTRATO", "");
    const ronda = roundTime(i.round);
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO", ronda + 5 * 3600)).not.toBeNull();
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO", ronda + 6 * 3600 + 1)).toBeNull();
  });

  it("con null lo borra", () => {
    guardarPendiente(i, "testnet", "CCONTRATO", "");
    guardarPendiente(null, "testnet", "CCONTRATO", "");
    expect(datos.has(CLAVE_PENDIENTE)).toBe(false);
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO", AHORA)).toBeNull();
  });

  it("sin almacenamiento, dura en memoria mientras dure la pestaña", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    guardarPendiente(i, "testnet", "CCONTRATO", "x");
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO", AHORA)?.intento).toEqual(i);
  });

  it("algo que no se entiende en el almacenamiento no es un pendiente", () => {
    guardarPendiente(null, "", "", "");
    datos.set(CLAVE_PENDIENTE, "{roto");
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toBeNull();
    datos.set(CLAVE_PENDIENTE, JSON.stringify({ intento: { organizer: ORG } }));
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toBeNull();
  });
});
