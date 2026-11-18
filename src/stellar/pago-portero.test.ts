import { describe, expect, it, vi } from "vitest";
import {
  CONSULTA_LENTA_MS,
  CONSULTA_RAPIDA_MS,
  type DepsDelPago,
  ESPERAS_DEL_REENVIO_MS,
  type EstadoEnLaRed,
  type RespuestaDelPago,
  esRechazoClaro,
  estadoEnLaRed,
  leerPagosDelCupo,
  leerRespuestaDelPago,
  mandarElPago,
  mirarPagos,
  pedirElPago,
} from "./pago-portero";

/**
 * El cliente del servicio de comisiones para los pagos de una cuenta de Google: lo que dice `/cupo` de los pagos, el pedido
 * del pago, la red por el hash y el pedido entero con sus reintentos. Sin red ni reloj de verdad: `fetch`, el reloj y la
 * espera son de mentira.
 */

const URL_DEL_PORTERO = "https://portero.prueba";
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "a".repeat(64);
const OTRO_HASH = "b".repeat(64);
/** La hora de las pruebas, en milisegundos, y el sobre que vence a los 240 segundos. */
const T0 = 1_800_000_000_000;
const SOBRE = { hash: HASH, vence: T0 / 1000 + 240 };

const bloque = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  red: "mainnet",
  rige: "portero",
  pagos: { premio: true, retiro: true, altaPremio: false, costoRetiro: { usdc: "0.50", monto: 5_000_000 }, enCurso: null, ...cambios },
});

const respuesta = (estado: number, cuerpo: unknown): Response =>
  new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status: estado });

describe("lo que dice el cupo de los pagos", () => {
  it("lee el bloque entero: las dos formas, el costo en stroops y sin pago en el aire", () => {
    expect(leerPagosDelCupo(200, bloque())).toEqual({
      tipo: "pagos",
      pagos: { premio: true, retiro: true, costoRetiro: 5_000_000n, enCurso: null },
    });
  });

  it("lee el pago que la cuenta tiene en el aire", () => {
    const enCurso = { hash: HASH.toUpperCase(), forma: "retiro", vence: 1_800_000_240 };
    const leido = leerPagosDelCupo(200, bloque({ enCurso }));
    expect(leido).toMatchObject({ tipo: "pagos", pagos: { enCurso: { hash: HASH, forma: "retiro", vence: 1_800_000_240 } } });
  });

  it("sin el bloque de los pagos no hay pagos", () => {
    expect(leerPagosDelCupo(200, { red: "mainnet", rige: "portero" })).toEqual({ tipo: "sin-pagos" });
  });

  it("un costo que no es un entero positivo no se entiende y no hay pagos", () => {
    expect(leerPagosDelCupo(200, bloque({ costoRetiro: { monto: "5000000" } }))).toEqual({ tipo: "sin-pagos" });
    expect(leerPagosDelCupo(200, bloque({ costoRetiro: { monto: 0 } }))).toEqual({ tipo: "sin-pagos" });
  });

  it("un pago en el aire que no se entiende deja sin pagos", () => {
    expect(leerPagosDelCupo(200, bloque({ enCurso: { hash: "corto", forma: "premio", vence: 1 } }))).toEqual({ tipo: "sin-pagos" });
  });

  it("las formas que no dicen sí o no dejan sin pagos", () => {
    expect(leerPagosDelCupo(200, bloque({ premio: "true" }))).toEqual({ tipo: "sin-pagos" });
  });

  it("un servicio de otra red no tiene pagos para esta página", () => {
    expect(leerPagosDelCupo(200, { ...bloque(), red: "testnet" })).toEqual({ tipo: "sin-pagos" });
  });

  it("una respuesta que no es un 200 con cuerpo es que no contestó", () => {
    expect(leerPagosDelCupo(503, bloque())).toEqual({ tipo: "sin-respuesta" });
    expect(leerPagosDelCupo(200, null)).toEqual({ tipo: "sin-respuesta" });
  });

  it("mirarPagos pregunta por la cuenta, sin caché", async () => {
    const f = vi.fn(async () => respuesta(200, bloque()));
    expect((await mirarPagos(URL_DEL_PORTERO, CUENTA, { fetch: f })).tipo).toBe("pagos");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_DEL_PORTERO}/v1/patrocinio/cupo?cuenta=${CUENTA}`);
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
  });

  it("mirarPagos sin respuesta es que no contestó", async () => {
    const f = vi.fn(async (): Promise<Response> => {
      throw new TypeError("sin red");
    });
    expect(await mirarPagos(URL_DEL_PORTERO, CUENTA, { fetch: f })).toEqual({ tipo: "sin-respuesta" });
  });
});

describe("lo que contesta el pago", () => {
  it("un 200 en camino es tomado, con el hash en minúscula", () => {
    const r = leerRespuestaDelPago(200, { hash: HASH.toUpperCase(), forma: "retiro", vence: 9, status: "PENDING", estado: "en-camino" });
    expect(r).toEqual({ tipo: "tomado", hash: HASH, vence: 9, estado: "en-camino" });
  });

  it("un 200 sin el hash o con otro estado no dice nada", () => {
    expect(leerRespuestaDelPago(200, { estado: "ok" })).toEqual({ tipo: "sin-respuesta" });
    expect(leerRespuestaDelPago(200, { hash: HASH, estado: "listo" })).toEqual({ tipo: "sin-respuesta" });
  });

  it("un no trae su motivo, si pudo salir, el hash, el detalle y cuándo reintentar", () => {
    const r = leerRespuestaDelPago(503, { motivo: "fondo", detalle: "ocupado", reintentarEn: 5, pudoSalir: false });
    expect(r).toEqual({ tipo: "no", http: 503, motivo: "fondo", pudoSalir: false, hash: null, detalle: "ocupado", reintentarEn: 5 });
  });

  it("un no sin el campo de si pudo salir lo deja sin saber", () => {
    expect(leerRespuestaDelPago(429, { motivo: "cupo-ip" })).toMatchObject({ tipo: "no", pudoSalir: null });
  });

  it("un error sin cuerpo o sin motivo es que no contestó", () => {
    expect(leerRespuestaDelPago(502, null)).toEqual({ tipo: "sin-respuesta" });
    expect(leerRespuestaDelPago(500, { error: "x" })).toEqual({ tipo: "sin-respuesta" });
  });

  it("pedirElPago manda la forma y el sobre por POST, como JSON", async () => {
    const f = vi.fn(async () => respuesta(200, { hash: HASH, estado: "ok", vence: 1 }));
    expect((await pedirElPago(URL_DEL_PORTERO, "premio", "SOBRE", { fetch: f })).tipo).toBe("tomado");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_DEL_PORTERO}/v1/patrocinio/pago`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ forma: "premio", xdr: "SOBRE" });
  });

  it("pedirElPago con un corte es que no contestó", async () => {
    const f = vi.fn(async (): Promise<Response> => {
      throw new DOMException("tope", "TimeoutError");
    });
    expect(await pedirElPago(URL_DEL_PORTERO, "retiro", "SOBRE", { fetch: f })).toEqual({ tipo: "sin-respuesta" });
  });

  it("pedirElPago con un cuerpo que no es JSON es que no contestó", async () => {
    const f = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await pedirElPago(URL_DEL_PORTERO, "retiro", "SOBRE", { fetch: f })).toEqual({ tipo: "sin-respuesta" });
  });
});

describe("qué es un rechazo claro", () => {
  const no = (http: number, motivo: string, pudoSalir: boolean | null): Extract<RespuestaDelPago, { tipo: "no" }> => ({
    tipo: "no",
    http,
    motivo,
    pudoSalir,
    hash: null,
    detalle: null,
    reintentarEn: null,
  });

  it("con pudoSalir en falso sí", () => {
    expect(esRechazoClaro(no(400, "no-permitida", false), false)).toBe(true);
  });

  it("con pudoSalir en verdadero no", () => {
    expect(esRechazoClaro(no(502, "red", true), false)).toBe(false);
  });

  it("una respuesta de la puerta sin el campo y con su código sí", () => {
    expect(esRechazoClaro(no(404, "no-existe", null), false)).toBe(true);
    expect(esRechazoClaro(no(429, "cupo-ip", null), false)).toBe(true);
  });

  it("una de la puerta con otro código, u otro motivo sin el campo, no", () => {
    expect(esRechazoClaro(no(500, "cupo-ip", null), false)).toBe(false);
    expect(esRechazoClaro(no(500, "interno", null), false)).toBe(false);
  });

  it("con el sobre que ya estuvo en duda, nunca", () => {
    expect(esRechazoClaro(no(400, "no-permitida", false), true)).toBe(false);
    expect(esRechazoClaro(no(404, "no-existe", null), true)).toBe(false);
  });
});

describe("la red, por el hash", () => {
  const conLaRed = (estado: number, cuerpo?: unknown) => vi.fn(async (_url: string | URL | Request) => respuesta(estado, cuerpo));

  it("pregunta a Horizon por la transacción", async () => {
    const f = conLaRed(200, { hash: HASH, successful: true });
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: f, horizon: "https://horizon.prueba/" })).toBe("entro");
    expect(String(f.mock.calls[0]?.[0])).toBe(`https://horizon.prueba/transactions/${HASH}`);
  });

  it("una que entró y falló es fallo", async () => {
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(200, { hash: HASH, successful: false }) })).toBe("fallo");
  });

  it("un 404 es que no está", async () => {
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(404, { status: 404 }) })).toBe("no-esta");
  });

  it("otro error, otro hash o un corte no dicen nada", async () => {
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(503, {}) })).toBe("no-se-sabe");
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(200, { hash: OTRO_HASH, successful: true }) })).toBe("no-se-sabe");
    const corte = vi.fn(async (): Promise<Response> => {
      throw new TypeError("sin red");
    });
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: corte })).toBe("no-se-sabe");
  });

  it("una envuelta que viene con el hash de afuera se reconoce por el de la de adentro", async () => {
    const envuelta = { hash: OTRO_HASH, successful: true, inner_transaction: { hash: HASH } };
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(200, envuelta) })).toBe("entro");
    const ajena = { hash: OTRO_HASH, successful: true, inner_transaction: { hash: OTRO_HASH } };
    expect(await estadoEnLaRed("mainnet", HASH, { fetch: conLaRed(200, ajena) })).toBe("no-se-sabe");
  });

  it("un hash que no tiene la forma no se pregunta", async () => {
    const f = conLaRed(200, { successful: true });
    expect(await estadoEnLaRed("mainnet", "no-es-un-hash", { fetch: f })).toBe("no-se-sabe");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("el pedido entero, con sus reintentos", () => {
  /** El portero y la red de mentira, con un reloj que avanza solo cuando se duerme. */
  function mundo(o: { respuestas: RespuestaDelPago[]; red?: (hash: string, ms: number) => EstadoEnLaRed }) {
    let ahora = T0;
    const pedidos: number[] = [];
    const consultas: Array<{ hash: string; ms: number }> = [];
    const esperas: number[] = [];
    const deps: DepsDelPago = {
      pedir: async () => {
        pedidos.push(ahora);
        return o.respuestas.shift() ?? { tipo: "sin-respuesta" };
      },
      enLaRed: async (hash) => {
        consultas.push({ hash, ms: ahora - T0 });
        return o.red ? o.red(hash, ahora - T0) : "no-esta";
      },
      dormir: async (ms) => {
        esperas.push(ms);
        ahora += ms;
      },
      ahora: () => ahora,
    };
    return { deps, pedidos, consultas, esperas, reloj: () => ahora };
  }
  const tomado = (estado: "en-camino" | "ok" | "fallo", hash = HASH): RespuestaDelPago => ({ tipo: "tomado", hash, vence: SOBRE.vence, estado });
  const no = (http: number, motivo: string, extra: Partial<Extract<RespuestaDelPago, { tipo: "no" }>> = {}): RespuestaDelPago => ({
    tipo: "no",
    http,
    motivo,
    pudoSalir: false,
    hash: null,
    detalle: null,
    reintentarEn: null,
    ...extra,
  });
  const HASTA = T0 + 45_000;

  it("tomado y ya entró: salió, con un solo pedido", async () => {
    const m = mundo({ respuestas: [tomado("ok")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.pedidos).toHaveLength(1);
  });

  it("tomado y entró y falló: fallo, sin seguir", async () => {
    const m = mundo({ respuestas: [tomado("fallo")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "fallo", hash: HASH });
    expect(m.consultas).toEqual([]);
  });

  it("en camino se sigue en la red por el hash, sin reenviar, hasta que aparece", async () => {
    const m = mundo({ respuestas: [tomado("en-camino")], red: (_h, ms) => (ms >= 9_000 ? "entro" : "no-esta") });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.pedidos).toHaveLength(1);
    expect(m.consultas.map((c) => c.ms)).toEqual([3_000, 6_000, 9_000]);
  });

  it("en camino y la red no lo muestra: cada 3 s los primeros 30 s, después cada 10 s, y al final duda", async () => {
    const m = mundo({ respuestas: [tomado("en-camino")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "duda", hash: HASH });
    const rapidas = m.esperas.filter((e) => e === CONSULTA_RAPIDA_MS).length;
    expect(rapidas).toBe(10);
    expect(m.esperas.slice(rapidas)).toEqual([CONSULTA_LENTA_MS]);
    expect(m.reloj()).toBeLessThanOrEqual(HASTA);
  });

  it("nunca se sigue más allá del vencimiento más un minuto", async () => {
    const m = mundo({ respuestas: [tomado("en-camino")] });
    await mandarElPago(SOBRE, T0 + 3_600_000, m.deps);
    expect(m.reloj()).toBeLessThanOrEqual((SOBRE.vence + 60) * 1000);
  });

  it("sin respuesta se reenvía el mismo sobre después de 3 s, y con la respuesta no se reenvía más", async () => {
    const m = mundo({ respuestas: [{ tipo: "sin-respuesta" }, tomado("ok")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.pedidos.map((t) => t - T0)).toEqual([0, 3_000]);
  });

  it("sin respuesta nunca: como mucho ocho reenvíos mientras el sobre tenga vida, y queda en duda", async () => {
    const m = mundo({ respuestas: [] });
    const r = await mandarElPago(SOBRE, T0 + 3_600_000, m.deps);
    expect(r).toEqual({ que: "duda", hash: HASH });
    expect(m.pedidos.length).toBeLessThanOrEqual(1 + ESPERAS_DEL_REENVIO_MS.length);
    for (const t of m.pedidos) expect(t).toBeLessThan(SOBRE.vence * 1000);
  });

  it("un rechazo claro en el primer envío dice que no salió, con el motivo del servicio", async () => {
    const m = mundo({ respuestas: [no(403, "cuenta-ajena")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "no-salio", motivo: "cuenta-ajena", detalle: null });
    expect(m.consultas).toEqual([]);
  });

  it("un rechazo después de un envío sin respuesta sigue en duda", async () => {
    const m = mundo({ respuestas: [{ tipo: "sin-respuesta" }, no(404, "no-existe", { pudoSalir: null })] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "duda", hash: HASH });
  });

  it("un no que dice que el sobre puede salir, sin pedir reenvío, se sigue en la red y queda en duda", async () => {
    const m = mundo({ respuestas: [no(502, "red", { pudoSalir: true, detalle: "horizon" })] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "duda", hash: HASH });
    expect(m.consultas.length).toBeGreaterThan(0);
    expect(m.pedidos).toHaveLength(1);
  });

  it.each(["TRY_AGAIN_LATER", "ocupada", "sin-confirmar"])("con la red cargada (%s) se reenvía el mismo sobre y entra", async (detalle) => {
    const m = mundo({ respuestas: [no(502, "red", { pudoSalir: true, detalle }), tomado("ok")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.pedidos.map((t) => t - T0)).toEqual([0, 3_000]);
  });

  it("con la red cargada siempre, se reenvía con las esperas de siempre mientras el sobre tenga vida y queda en duda", async () => {
    const carga = no(502, "red", { pudoSalir: true, detalle: "TRY_AGAIN_LATER" });
    const m = mundo({ respuestas: Array.from({ length: 30 }, () => carga) });
    expect(await mandarElPago(SOBRE, T0 + 3_600_000, m.deps)).toEqual({ que: "duda", hash: HASH });
    expect(m.pedidos.length).toBeLessThanOrEqual(1 + ESPERAS_DEL_REENVIO_MS.length);
    expect(m.pedidos.length).toBeGreaterThan(2);
    for (const t of m.pedidos) expect(t).toBeLessThan(SOBRE.vence * 1000);
  });

  it("un rechazo seguro después de una red cargada sigue en duda", async () => {
    const carga = no(502, "red", { pudoSalir: true, detalle: "ocupada" });
    const m = mundo({ respuestas: [carga, no(400, "rechazada", { pudoSalir: false })] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "duda", hash: HASH });
  });

  it("el puesto ya pagado por esta ruta se sigue por el hash de ese pago, sin armar otro", async () => {
    const m = mundo({ respuestas: [no(409, "puesto-usado", { hash: OTRO_HASH })], red: (h) => (h === OTRO_HASH ? "entro" : "no-esta") });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: OTRO_HASH });
    expect(m.pedidos).toHaveLength(1);
  });

  it("con el servicio ocupado se espera lo que pide y se reenvía el mismo sobre", async () => {
    const m = mundo({ respuestas: [no(503, "fondo", { detalle: "ocupado", reintentarEn: T0 + 5_000 }), tomado("ok")] });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.pedidos.map((t) => t - T0)).toEqual([0, 5_000]);
  });

  it("ocupado sin vida para reenviar dice que no salió", async () => {
    const corto = { hash: HASH, vence: T0 / 1000 + 10 };
    const m = mundo({ respuestas: [no(503, "fondo", { detalle: "ocupado", reintentarEn: T0 + 5_000 })] });
    expect(await mandarElPago(corto, HASTA, m.deps)).toEqual({ que: "no-salio", motivo: "fondo", detalle: "ocupado" });
    expect(m.pedidos).toHaveLength(1);
  });

  it("tomado con un hash que no es el del sobre se sigue por el propio", async () => {
    const m = mundo({ respuestas: [tomado("ok", OTRO_HASH)], red: (h) => (h === HASH ? "entro" : "no-esta") });
    expect(await mandarElPago(SOBRE, HASTA, m.deps)).toEqual({ que: "salio", hash: HASH });
    expect(m.consultas.every((c) => c.hash === HASH)).toBe(true);
  });
});
