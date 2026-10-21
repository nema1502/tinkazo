import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roundTime, targetRound } from "../protocol/quicknet";
import { type IntentoDeSello, SelloIncierto, resolverSello } from "../stellar/envio";
import { CLAVE_PENDIENTE, SelloSinConfirmar, guardarPendiente, leerPendiente, sellarSinDuplicar } from "./sello-seguro";

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
    faltan: (round: number) => roundTime(round) - t / 1000,
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

  it("lo guarda con la red, el contrato y el premio, y lo devuelve solo para la misma cuenta, lista, red y contrato", () => {
    guardarPendiente(i, "testnet", "CCONTRATO", "Una bici");
    expect(JSON.parse(datos.get(CLAVE_PENDIENTE) as string)).toEqual({ intento: i, red: "testnet", contrato: "CCONTRATO", premio: "Una bici" });
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toEqual({ intento: i, premio: "Una bici" });
    expect(leerPendiente("GOTRA", HUELLA, "testnet", "CCONTRATO")).toBeNull();
    expect(leerPendiente(ORG, "ef".repeat(32), "testnet", "CCONTRATO")).toBeNull();
    expect(leerPendiente(ORG, HUELLA, "mainnet", "CCONTRATO")).toBeNull();
    expect(leerPendiente(ORG, HUELLA, "testnet", "COTRO")).toBeNull();
  });

  it("con null lo borra", () => {
    guardarPendiente(i, "testnet", "CCONTRATO", "");
    guardarPendiente(null, "testnet", "CCONTRATO", "");
    expect(datos.has(CLAVE_PENDIENTE)).toBe(false);
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toBeNull();
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
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")?.intento).toEqual(i);
  });

  it("algo que no se entiende en el almacenamiento no es un pendiente", () => {
    guardarPendiente(null, "", "", "");
    datos.set(CLAVE_PENDIENTE, "{roto");
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toBeNull();
    datos.set(CLAVE_PENDIENTE, JSON.stringify({ intento: { organizer: ORG } }));
    expect(leerPendiente(ORG, HUELLA, "testnet", "CCONTRATO")).toBeNull();
  });
});
