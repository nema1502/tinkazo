import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorPortero } from "../stellar/patrocinador";
import type { RespuestaDelSorteo } from "../stellar/sorteo-servidor-api";
import {
  DISYUNTOR_CORTO_MS,
  DISYUNTOR_MS,
  type Fuentes,
  type FinDelServicio,
  type Ganadores,
  type QuienSortea,
  reiniciarElServicio,
  sortearPorElServicio,
  usaElSorteoDelServicio,
} from "./sorteo-del-servicio";

/**
 * El sorteo por el servicio de comisiones (`sorteo-del-servicio.ts`), con todas las fuentes de mentira y un reloj
 * simulado: lo que se prueba es qué camino toma y cuánto espera, no la red. Lo que mande el servicio nunca es el
 * resultado: sale siempre de leer el contrato.
 */

const T0 = 1_800_000_000_000;
const H1 = "a1".repeat(32);
const H2 = "b2".repeat(32);
const GANADORES: Ganadores = { winners: [4, 11, 3], randomness: "00ff" };
const FIRMA = new Uint8Array(96).fill(5);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  reiniciarElServicio();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Corre la promesa con el reloj simulado hasta que termina. */
async function correr<T>(p: Promise<T>, topeMs = 900_000): Promise<T> {
  let hecho = false;
  let valor: T | undefined;
  let fallo: unknown;
  let lanzo = false;
  p.then(
    (v) => {
      hecho = true;
      valor = v;
    },
    (e: unknown) => {
      hecho = true;
      lanzo = true;
      fallo = e;
    },
  );
  for (let ms = 0; ms < topeMs && !hecho; ms += 250) await vi.advanceTimersByTimeAsync(250);
  if (!hecho) throw new Error("la prueba no terminó");
  if (lanzo) throw fallo;
  return valor as T;
}

const ahora = (): number => Date.now();
const pasoDe = (r: FinDelServicio): string => r.estado;

interface Mock {
  pedir: ReturnType<typeof vi.fn>;
  consultar: ReturnType<typeof vi.fn>;
  leer: ReturnType<typeof vi.fn>;
  valorDe: ReturnType<typeof vi.fn>;
  alFallar: ReturnType<typeof vi.fn>;
  saturada: ReturnType<typeof vi.fn>;
  olvidar: ReturnType<typeof vi.fn>;
  fuentes: Fuentes;
}

function armar(o: { pedir?: (n: number) => Promise<RespuestaDelSorteo>; consultar?: (h: string, n: number) => Promise<{ status: string; cierre: number; valor?: unknown }>; leer?: (n: number) => Promise<Ganadores | null>; valorDe?: (v: unknown) => Promise<Ganadores | null> } = {}): Mock {
  let np = 0;
  let nc = 0;
  let nl = 0;
  const pedir = vi.fn(async () => (o.pedir ? o.pedir(np++) : ({ accion: "incierto" } as RespuestaDelSorteo)));
  const consultar = vi.fn(async (h: string) => (o.consultar ? o.consultar(h, nc++) : { status: "NOT_FOUND", cierre: Date.now() / 1000 }));
  const leer = vi.fn(async () => (o.leer ? o.leer(nl++) : null));
  const valorDe = vi.fn(async (v: unknown) => (o.valorDe ? o.valorDe(v) : GANADORES));
  const alFallar = vi.fn();
  const saturada = vi.fn();
  const olvidar = vi.fn();
  const fuentes: Fuentes = {
    clave: (id) => `prueba|${id}`,
    rechazoSinGrabar: async () => null,
    pedir: pedir as unknown as Fuentes["pedir"],
    consultar: consultar as unknown as Fuentes["consultar"],
    leer: leer as unknown as Fuentes["leer"],
    valorDe: valorDe as unknown as Fuentes["valorDe"],
    alFallar,
    saturada,
    fijar: () => () => undefined,
    olvidarElEstado: olvidar,
    horaDeLaRed: () => Date.now() / 1000,
  };
  return { pedir, consultar, leer, valorDe, alFallar, saturada, olvidar, fuentes };
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function sortear(m: Mock, pasos: [string, string?][] = [], id = 7n): Promise<FinDelServicio> {
  return sortearPorElServicio({ raffleId: id, firma96: FIRMA, alPaso: (s, d) => void pasos.push(d === undefined ? [s] : [s, d]), ahora, dormir }, m.fuentes);
}
const mandado = (hash: string, pendiente = true): RespuestaDelSorteo => ({ accion: "mandado", hash, pendiente });
const hoy = (m: Partial<{ marca: boolean; disyuntor: boolean; olvidar: boolean; disyuntorCorto: true }> = {}): RespuestaDelSorteo => ({ accion: "hoy", marca: false, disyuntor: false, olvidar: false, ...m });
const transcurrido = (): number => Date.now() - T0;
const entro = async (): Promise<{ status: string; cierre: number; valor: unknown }> => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" });

describe("cuándo lo manda el servicio", () => {
  const todo: QuienSortea = { bandera: true, red: "mainnet", ensayo: false, cuentaDelProveedor: true, pagarConMiCuenta: false, url: "https://pm.example", apagadoPorAhora: false, noParaEsteSorteo: false };
  it("con las ocho condiciones, sí", () => {
    expect(usaElSorteoDelServicio(todo)).toBe(true);
  });
  it.each<[string, Partial<QuienSortea>]>([
    ["la bandera apagada", { bandera: false }],
    ["la red de prueba", { red: "testnet" }],
    ["la demo o el ensayo", { ensayo: true }],
    ["una billetera propia", { cuentaDelProveedor: false }],
    ["pagar con la propia cuenta", { pagarConMiCuenta: true }],
    ["sin dirección del servicio", { url: null }],
    ["el servicio apagado por un rato", { apagadoPorAhora: true }],
    ["un sorteo que ya quedó por el camino de siempre", { noParaEsteSorteo: true }],
  ])("con %s, no", (_n, cambio) => {
    expect(usaElSorteoDelServicio({ ...todo, ...cambio })).toBe(false);
  });
});

describe("el servicio manda y la red confirma", () => {
  it("PENDING, después NOT_FOUND y después SUCCESS: los ganadores salen del contrato, con el enlace, y solo se ven dos pasos", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async (_h, n) => (n < 2 ? { status: "NOT_FOUND", cierre: Date.now() / 1000 } : { status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => GANADORES,
    });
    const pasos: [string, string?][] = [];
    const r = await correr(sortear(m, pasos));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(pasos).toEqual([["sending"], ["sending", H1], ["confirmed", H1]]);
    expect(m.olvidar).toHaveBeenCalled();
  });

  it("lo que devuelve la transacción no coincide con el contrato: se da por hecho, sin enlace", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => GANADORES,
      valorDe: async () => ({ winners: [1, 2, 3], randomness: "00ff" }),
    });
    const pasos: [string, string?][] = [];
    const r = await correr(sortear(m, pasos));
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(pasos.some(([s]) => s === "confirmed")).toBe(false);
  });

  it("un sello gemelo: entró otra transacción y el contrato no tiene este sorteo. Pide una vez más y confirma el de este número", async () => {
    const m = armar({
      pedir: async (n) => (n === 0 ? mandado(H1, false) : mandado(H2)),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async (n) => (n < 3 ? null : GANADORES),
    });
    const pasos: [string, string?][] = [];
    const r = await correr(sortear(m, pasos));
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H2 }, yaEstaba: false });
    expect(pasos).not.toContainEqual(["confirmed", H1]);
  });

  it("si el gemelo vuelve a pasar, camino de siempre y el sorteo queda marcado", async () => {
    // El segundo es un repetido y no un propio: un propio que entró con el contrato vacío se da por hecho con su valor.
    const m = armar({
      pedir: async (n) => (n === 0 ? mandado(H1, false) : mandado(H2, false)),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => null,
    });
    const r = await correr(sortear(m));
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ estado: "camino-de-hoy" });
  });

  it("entró pero el contrato no se deja leer y el valor de la transacción no se entiende: no se manda nada más, sigue mirando y termina sin confirmar con el enlace", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => Promise.reject(new Error("rpc caído")),
      valorDe: async () => null,
    });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: Error & { txHash?: string } }).error.message).toBe("sin-confirmar");
    expect((r as { error: { txHash?: string } }).error.txHash).toBe(H1);
    expect(m.alFallar).toHaveBeenCalled();
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(30_000);
    expect(transcurrido()).toBeLessThanOrEqual(95_000);
  });

  it("una transacción de este sorteo que entró y un contrato que todavía se lee vacío: se muestra lo que devolvió, con el enlace", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => null,
    });
    const pasos: [string, string?][] = [];
    const r = await correr(sortear(m, pasos));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(pasos).toContainEqual(["confirmed", H1]);
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("PENDING y después FAILED: con el contrato sin el sorteo, camino de siempre", async () => {
    const m = armar({ pedir: async () => mandado(H1), consultar: async () => ({ status: "FAILED", cierre: Date.now() / 1000 }), leer: async () => null });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("PENDING y después FAILED: si el sorteo ya está, se da por hecho sin enlace", async () => {
    const m = armar({ pedir: async () => mandado(H1), consultar: async () => ({ status: "FAILED", cierre: Date.now() / 1000 }), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });

  it("PENDING que la red tarda más de un minuto y el contrato sigue sin el sorteo: sigue el camino de siempre, una sola vez, sin avisar al RPC", async () => {
    const m = armar({ pedir: async () => mandado(H1), leer: async () => null });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    expect(transcurrido()).toBeGreaterThanOrEqual(55_000);
    expect(transcurrido()).toBeLessThanOrEqual(70_000);
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(m.alFallar).not.toHaveBeenCalled();
  });

  it("PENDING que tarda más de un minuto con la red mal de leer: no se manda nada más, se sigue mirando y se da por hecho cuando el contrato aparece", async () => {
    const m = armar({ pedir: async () => mandado(H1), leer: async () => (Date.now() - T0 < 75_000 ? Promise.reject(new Error("rpc caído")) : GANADORES) });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(transcurrido()).toBeGreaterThanOrEqual(75_000);
    expect(transcurrido()).toBeLessThanOrEqual(90_000);
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("PENDING que tarda más de un minuto y el contrato nunca se deja leer: sin confirmar con el enlace a los noventa segundos, sin el camino de siempre", async () => {
    const m = armar({ pedir: async () => mandado(H1), leer: async () => Promise.reject(new Error("rpc caído")) });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: Error & { txHash?: string } }).error.message).toBe("sin-confirmar");
    expect((r as { error: { txHash?: string } }).error.txHash).toBe(H1);
    expect(transcurrido()).toBeGreaterThanOrEqual(85_000);
    expect(transcurrido()).toBeLessThanOrEqual(95_000);
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("PENDING que la red tarda en cerrar pero el contrato ya tiene el sorteo al vencer el tope: se da por hecho, sin enlace", async () => {
    const m = armar({ pedir: async () => mandado(H1), leer: async () => (Date.now() - T0 < 50_000 ? null : GANADORES) });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });

  it("PENDING con la red muda 15 segundos: una última vuelta corta y error sin confirmar con el enlace, sin el camino de siempre", async () => {
    const m = armar({ pedir: async () => mandado(H1), consultar: async () => Promise.reject(new Error("sin red")), leer: async () => null });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: { txHash?: string } }).error.txHash).toBe(H1);
    expect(m.alFallar).toHaveBeenCalled();
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(15_000);
    expect(transcurrido()).toBeLessThanOrEqual(95_000);
  });

  it("hash fantasma: un repetido que la red, contestando, nunca encuentra. Entre 15 y 21 segundos y el camino de siempre", async () => {
    const m = armar({ pedir: async () => mandado(H1, false), leer: async () => null });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "camino-de-hoy" });
    expect(transcurrido()).toBeGreaterThanOrEqual(15_000);
    expect(transcurrido()).toBeLessThanOrEqual(21_000);
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("hash fantasma con el sorteo ya hecho en el contrato: se da por hecho", async () => {
    const m = armar({ pedir: async () => mandado(H1, false), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });

  it("el mismo número fue PENDING en un grabar y es repetido en el siguiente: se le aplica la regla del PENDING", async () => {
    const primero = armar({ pedir: async () => mandado(H1), consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }), leer: async () => GANADORES });
    await correr(sortear(primero));
    const salida = Date.now();
    const segundo = armar({
      pedir: async () => mandado(H1, false),
      consultar: async () => (Date.now() - salida < 12_000 ? { status: "NOT_FOUND", cierre: Date.now() / 1000 } : { status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    const r = await correr(sortear(segundo));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
  });
});

describe("el servicio dice que ya está", () => {
  it("ya: los de la red, con yaEstaba y sin enlace", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });
  it("ya, pero la red no lo ve en 10 segundos: camino de siempre, un solo envío por ese camino", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async () => null });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeLessThanOrEqual(12_000);
  });
});

describe("el servicio asegura que no mandó", () => {
  it("409 repetido: espera 5 segundos y vuelve a pedir, y al no caber otro pedido, camino de siempre", async () => {
    const m = armar({ pedir: async () => ({ accion: "espera", fijaMs: 5000 }) });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(3);
    expect(transcurrido()).toBeLessThanOrEqual(20_000);
  });

  it("una lectura, simulación, secuencia u ocupada que se repite: reintenta y baja antes de 20 segundos", async () => {
    const m = armar({ pedir: async () => ({ accion: "espera" }) });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(transcurrido()).toBeLessThanOrEqual(20_000);
  });

  it("una espera y después el servicio manda: sigue con ese envío", async () => {
    const m = armar({
      pedir: async (n) => (n === 0 ? { accion: "espera" } : mandado(H1)),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(m.pedir).toHaveBeenCalledTimes(2);
  });

  it("el tope del organizador es un no que se muestra, sin el camino de siempre", async () => {
    const error = new ErrorPortero("cupo-cuenta", 429, { que: "sorteos", liberaEn: 1_800_000_000_000 });
    const m = armar({ pedir: async () => ({ accion: "error", error }) });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "error", error });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["apagado", hoy({ disyuntor: true, olvidar: true }), true],
    ["fee-alta", hoy(), false],
    ["fallaria", hoy({ marca: true }), false],
    ["origen", hoy({ disyuntor: true }), false],
    ["ocupado", hoy(), false],
    ["tarde", hoy({ disyuntor: true }), false],
    ["interno sin mandar", hoy({ disyuntorCorto: true }), false],
  ])("%s: camino de siempre en el acto, un solo pedido, sin leer la red", async (_n, resp, olvida) => {
    const m = armar({ pedir: async () => resp });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(m.leer).not.toHaveBeenCalled();
    expect(m.olvidar.mock.calls.length > 0).toBe(olvida);
    expect(transcurrido()).toBeLessThan(1000);
  });
});

describe("lo incierto nunca manda por los dos caminos", () => {
  it("incierto con el sorteo ya en la red: se da por hecho y no se pide más", async () => {
    const m = armar({ pedir: async () => ({ accion: "incierto" }), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("incierto porque el pedido colgado se abortó a los 10 segundos: se aborta y se mira la red", async () => {
    let senal: AbortSignal | undefined;
    const m = armar();
    m.pedir.mockImplementation(((_id: bigint, _f: Uint8Array, s: AbortSignal) => {
      senal = s;
      return new Promise(() => undefined);
    }) as never);
    m.leer.mockResolvedValue(GANADORES);
    const r = await correr(sortear(m));
    expect(senal?.aborted).toBe(true);
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(transcurrido()).toBeGreaterThanOrEqual(10_000);
  });

  it("incierto y el contrato vacío: ningún pedido más, y el camino de siempre llega a los 8 segundos o algo más", async () => {
    const m = armar({ pedir: async () => ({ accion: "incierto" }), leer: async () => null });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(8_000);
    expect(transcurrido()).toBeLessThanOrEqual(9_500);
  });

  it("con el servicio colgado, el camino de siempre arranca antes de 30 segundos", async () => {
    const m = armar({ leer: async () => null });
    m.pedir.mockImplementation((() => new Promise(() => undefined)) as never);
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(transcurrido()).toBeLessThan(30_000);
  });

  it("incierto con el contrato que no se deja leer: sigue mirando sin mandar nada hasta lo que da el camino de siempre y termina sin confirmar", async () => {
    const m = armar({ pedir: async () => ({ accion: "incierto" }), leer: async () => Promise.reject(new Error("rpc caído")) });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: Error }).error.message).toBe("sin-confirmar");
    expect(m.alFallar).toHaveBeenCalled();
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(85_000);
    expect(transcurrido()).toBeLessThanOrEqual(91_000);
  });

  it("incierto porque se cortó la red del celular unos 60 segundos: sigue mirando y, al volver, se da por hecho sin mandar nada más", async () => {
    const m = armar({
      pedir: async () => ({ accion: "incierto" }),
      leer: async () => {
        if (Date.now() - T0 < 60_000) throw new Error("sin red");
        return GANADORES;
      },
    });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(60_000);
    expect(transcurrido()).toBeLessThanOrEqual(70_000);
  });

  it("incierto con la red del celular cortada y de vuelta con el contrato vacío: camino de siempre, una vez pasado el respiro", async () => {
    const m = armar({
      pedir: async () => ({ accion: "incierto" }),
      leer: async () => {
        if (Date.now() - T0 < 20_000) throw new Error("sin red");
        return null;
      },
    });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });
});

describe("una cola larga en el servicio no es una falla", () => {
  it("el primer pedido tarda más de 10 segundos: se vuelve a pedir, el servicio dice que ya lo tiene en camino y se confirma, sin mandar por el camino de siempre", async () => {
    const m = armar({
      pedir: async (n) => (n === 0 ? new Promise<RespuestaDelSorteo>(() => undefined) : mandado(H1, false)),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    const r = await correr(sortear(m));
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(transcurrido()).toBeLessThan(20_000);
  });

  it("dos pedidos seguidos que se cortan por el tope: se mira la red y, vacía, sigue el camino de siempre antes de 30 segundos", async () => {
    const m = armar({ leer: async () => null });
    m.pedir.mockImplementation((() => new Promise(() => undefined)) as never);
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(transcurrido()).toBeLessThan(30_000);
  });

  it("un incierto que no es por el tope (un corte al instante) no vuelve a pedir: mira la red", async () => {
    const m = armar({ pedir: async () => ({ accion: "incierto" }), leer: async () => null });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("la red ocupada hasta agotar la etapa: antes de pasar al camino de siempre se mira el contrato, y si el sorteo ya está, se da por hecho", async () => {
    const m = armar({ pedir: async () => ({ accion: "espera" }), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(m.leer).toHaveBeenCalledTimes(1);
  });
});

describe("un servicio lento que dice que no manda: el segundo pedido recibe su respuesta", () => {
  it.each([
    ["tarde", hoy({ disyuntor: true })],
    ["ocupado", hoy()],
  ])("el primer pedido no contesta nunca y el segundo recibe %s: camino de siempre antes de los 20 segundos, sin leer la red", async (_n, resp) => {
    const m = armar({ pedir: async (n) => (n === 0 ? new Promise<RespuestaDelSorteo>(() => undefined) : resp) });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(transcurrido()).toBeLessThan(20_000);
    expect(m.leer).not.toHaveBeenCalled();
  });
});

describe("el servicio dice que ya está, pero la red no se deja leer", () => {
  it("ya y el contrato que no se deja leer: sigue mirando hasta los noventa segundos y termina sin confirmar, sin el camino de siempre ni marca", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async () => Promise.reject(new Error("rpc caído")) });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: Error }).error.message).toBe("sin-confirmar");
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(85_000);
    expect(transcurrido()).toBeLessThanOrEqual(95_000);
    expect(m.alFallar).toHaveBeenCalled();
  });

  it("ya, la red que se deja leer a los 40 segundos: se da por hecho sin mandar nada más", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async () => (Date.now() - T0 < 40_000 ? Promise.reject(new Error("rpc caído")) : GANADORES) });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(m.pedir).toHaveBeenCalledTimes(1);
  });

  it("ya, un corte de la red y después el contrato limpio y vacío: se mira de nuevo y recién ahí camino de siempre", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async (n) => (n === 0 ? Promise.reject(new Error("rpc caído")) : null) });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
  });

  it("ya, un corte al principio y después el contrato ya tiene el sorteo: se da por hecho", async () => {
    const m = armar({ pedir: async () => ({ accion: "ya" }), leer: async (n) => (n === 0 ? Promise.reject(new Error("rpc caído")) : GANADORES) });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });
});

describe("la red ocupada y el aviso de red saturada", () => {
  it("cada vez que el servicio dice que la red está ocupada se anota, y cuando no lo está, no", async () => {
    const ocupada = armar({ pedir: async (n) => (n < 2 ? { accion: "espera", causa: "ocupada" } : mandado(H1)), consultar: entro, leer: async () => GANADORES });
    await correr(sortear(ocupada));
    expect(ocupada.saturada).toHaveBeenCalledTimes(2);
    const otra = armar({ pedir: async (n) => (n < 2 ? { accion: "espera", causa: "lectura" } : mandado(H1)), consultar: entro, leer: async () => GANADORES });
    await correr(sortear(otra));
    expect(otra.saturada).not.toHaveBeenCalled();
  });
});

describe("el servicio no pudo hablar con su red", () => {
  it("un error del RPC del servicio antes de enviar: se vuelve a pedir y sigue el envío, sin el camino de siempre", async () => {
    const m = armar({ pedir: async (n) => (n === 0 ? { accion: "red-del-servicio" } : mandado(H1)), consultar: entro, leer: async () => GANADORES });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(m.leer).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeLessThanOrEqual(5_000);
  });

  it("un error del RPC del servicio en la etapa de envío: el servicio dice repetido con el mismo número y se confirma", async () => {
    const m = armar({
      pedir: async (n) => (n === 0 ? { accion: "red-del-servicio" } : mandado(H1, false)),
      consultar: async (_h, n) => (n < 2 ? { status: "NOT_FOUND", cierre: Date.now() / 1000 } : { status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
    expect(m.pedir).toHaveBeenCalledTimes(2);
  });

  it("si el error persiste toda la etapa, se mira la red y, vacía, camino de siempre antes de 30 segundos", async () => {
    const m = armar({ pedir: async () => ({ accion: "red-del-servicio" }), leer: async () => null });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(transcurrido()).toBeLessThan(30_000);
  });

  it("si el error persiste y el contrato ya tiene el sorteo, se da por hecho", async () => {
    const m = armar({ pedir: async () => ({ accion: "red-del-servicio" }), leer: async () => GANADORES });
    expect(await correr(sortear(m))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });
});

describe("la vuelta por un sello gemelo no estira la espera de la sala", () => {
  it("si la vuelta ya no cabe en el minuto de la sala, se sigue por el camino de siempre y se pide una sola vez", async () => {
    const m = armar({
      pedir: async (n) => {
        if (n === 0) return new Promise<RespuestaDelSorteo>(() => undefined);
        await dormir(9_000);
        return mandado(H1, false);
      },
      consultar: entro,
      leer: async () => {
        await dormir(11_000);
        return null;
      },
    });
    expect(await correr(sortear(m))).toEqual({ estado: "camino-de-hoy" });
    expect(m.pedir).toHaveBeenCalledTimes(2);
    expect(transcurrido()).toBeLessThanOrEqual(62_000);
  });
});

describe("el resultado de una transacción que ya entró", () => {
  it("el contrato tarda 8 segundos en contestar: se espera esa lectura y se muestra con el enlace", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => {
        await dormir(8000);
        return GANADORES;
      },
    });
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(m.alFallar).not.toHaveBeenCalled();
  });

  it("el contrato no se deja leer pero la transacción es de este sorteo y devolvió los ganadores: se muestran, con el enlace", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => Promise.reject(new Error("rpc caído")),
    });
    const pasos: [string, string?][] = [];
    const r = await correr(sortear(m, pasos));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(pasos).toContainEqual(["confirmed", H1]);
  });

  it("lo mismo con un repetido: no se sabe de quién es la transacción, así que no se toma su valor y se sigue mirando el contrato", async () => {
    const m = armar({
      pedir: async () => mandado(H1, false),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "scval" }),
      leer: async () => Promise.reject(new Error("rpc caído")),
    });
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect((r as { error: { txHash?: string } }).error.txHash).toBeUndefined();
    expect(transcurrido()).toBeGreaterThanOrEqual(30_000);
  });

  it("el enlace es solo de un número que el servicio dijo pendiente para ESTE sorteo: el de un sello gemelo no se muestra", async () => {
    const del8 = armar({
      pedir: async () => mandado(H1),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    expect(await correr(sortear(del8, [], 8n))).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    // Después, el sorteo 7 (mismo sello) recibe como repetido el número del 8: el resultado es el mismo, el enlace no.
    const del7 = armar({
      pedir: async () => mandado(H1, false),
      consultar: async () => ({ status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => GANADORES,
    });
    expect(await correr(sortear(del7, [], 7n))).toEqual({ estado: "listo", valor: GANADORES, yaEstaba: true });
  });

  it("con el reloj del aparato 4 minutos atrasado, el vencimiento sale de la hora de la red: no se da por vencida una transacción que sigue viva", async () => {
    const m = armar({
      pedir: async () => mandado(H1),
      consultar: async () => (Date.now() - T0 < 45_000 ? { status: "NOT_FOUND", cierre: Date.now() / 1000 } : { status: "SUCCESS", cierre: Date.now() / 1000, valor: "x" }),
      leer: async () => (Date.now() - T0 < 45_000 ? null : GANADORES),
    });
    m.fuentes.horaDeLaRed = () => Date.now() / 1000 - 250;
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "listo", valor: { ...GANADORES, txHash: H1 }, yaEstaba: false });
    expect(m.pedir).toHaveBeenCalledTimes(1);
    expect(transcurrido()).toBeGreaterThanOrEqual(45_000);
  });
});

describe("ninguna espera sin tope", () => {
  it("con todas las fuentes colgadas y nada aceptado, termina con un tope: el de siempre, 90 segundos desde la entrada", async () => {
    const colgada = (() => new Promise(() => undefined)) as never;
    const m = armar();
    m.pedir.mockImplementation(colgada);
    m.leer.mockImplementation(colgada);
    m.consultar.mockImplementation(colgada);
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect(transcurrido()).toBeLessThanOrEqual(90_500);
  });

  it("con el servicio aceptado y la red colgada, termina con un tope de 90 segundos", async () => {
    const colgada = (() => new Promise(() => undefined)) as never;
    const m = armar({ pedir: async () => mandado(H1) });
    m.leer.mockImplementation(colgada);
    m.consultar.mockImplementation(colgada);
    const r = await correr(sortear(m));
    expect(pasoDe(r)).toBe("error");
    expect(transcurrido()).toBeLessThanOrEqual(95_000);
  });
});

describe("la demo y el ensayo", () => {
  it("se niega a grabar y no llama a nadie", async () => {
    const m = armar();
    m.fuentes.rechazoSinGrabar = async () => new Error("ensayo-sin-grabar");
    const r = await correr(sortear(m));
    expect(r).toEqual({ estado: "error", error: new Error("ensayo-sin-grabar") });
    expect(m.pedir).not.toHaveBeenCalled();
  });
});

describe("lo que se recuerda", () => {
  it("el disyuntor dura diez minutos", () => {
    expect(DISYUNTOR_MS).toBe(600_000);
  });
  it("el corto, de una red ocupada o de una ronda que no llega, dura un minuto", () => {
    expect(DISYUNTOR_CORTO_MS).toBe(60_000);
  });
});
