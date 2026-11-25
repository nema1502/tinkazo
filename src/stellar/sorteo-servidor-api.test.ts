import { describe, expect, it, vi } from "vitest";
import { ErrorPortero } from "./patrocinador";
import { ESPERA_RONDA_NO_LISTA_MS, leerRespuestaDelSorteo, pedirElSorteo, type RespuestaDelSorteo } from "./sorteo-servidor-api";

/**
 * El pedido del sorteo al servicio de comisiones y la tabla de lo que significa cada respuesta, con un `fetch` de
 * mentira y sin red. El cuerpo de la respuesta nunca se usa como resultado del sorteo.
 */

const URL = "https://pm.example";
const HASH = "ab".repeat(32);
const FIRMA = Uint8Array.from({ length: 96 }, (_, i) => (i * 7 + 3) % 256);
const FIRMA_HEX = Array.from(FIRMA, (n) => n.toString(16).padStart(2, "0")).join("");

const responder = (estado: number, cuerpo: unknown): Response => new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });

describe("el pedido", () => {
  it("manda un POST a /v1/sorteo con el cuerpo exacto y nada del navegador", async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => responder(200, { hash: HASH, status: "PENDING" }));
    const r = await pedirElSorteo({ url: `${URL}/`, raffleId: 1234n, firma96: FIRMA, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ accion: "mandado", hash: HASH, pendiente: true });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL}/v1/sorteo`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ sorteo: "1234", firma: FIRMA_HEX });
    expect(FIRMA_HEX).toHaveLength(192);
    expect(FIRMA_HEX).toBe(FIRMA_HEX.toLowerCase());
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.cache).toBe("no-store");
  });

  it("pasa la señal para poder abandonar el pedido", async () => {
    const ac = new AbortController();
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => responder(200, { ya: true }));
    await pedirElSorteo({ url: URL, raffleId: 1n, firma96: FIRMA, fetch: f as unknown as typeof fetch, signal: ac.signal });
    expect((f.mock.calls[0] as [string, RequestInit])[1].signal).toBe(ac.signal);
  });

  it.each([null, undefined, "", "http://pm.example", "https://pm.example/ruta", "https://p.tinkazo.app", "https://u:p@pm.example"])("sin una dirección con forma de portero (%s) no llama a fetch", async (url) => {
    const f = vi.fn();
    const r = await pedirElSorteo({ url, raffleId: 1n, firma96: FIRMA, fetch: f as unknown as typeof fetch });
    expect(r).toEqual({ accion: "hoy", marca: false, disyuntor: false, olvidar: false });
    expect(f).not.toHaveBeenCalled();
  });

  it("un fetch que lanza es incierto, y un cuerpo que no es JSON se juzga por su estado", async () => {
    const corte = await pedirElSorteo({ url: URL, raffleId: 1n, firma96: FIRMA, fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch });
    expect(corte).toEqual({ accion: "incierto" });
    const roto = await pedirElSorteo({ url: URL, raffleId: 1n, firma96: FIRMA, fetch: (async () => responder(200, "<html>")) as unknown as typeof fetch });
    expect(roto).toEqual({ accion: "incierto" });
    const html403 = await pedirElSorteo({ url: URL, raffleId: 1n, firma96: FIRMA, fetch: (async () => responder(403, "<html>")) as unknown as typeof fetch });
    expect(html403).toEqual({ accion: "hoy", marca: false, disyuntor: true, olvidar: false });
  });
});

const hoy = (m: Partial<{ marca: boolean; disyuntor: boolean; olvidar: boolean }> = {}): RespuestaDelSorteo => ({ accion: "hoy", marca: false, disyuntor: false, olvidar: false, ...m });

describe("la tabla de respuestas", () => {
  const filas: [string, number, unknown, RespuestaDelSorteo][] = [
    ["200 PENDING", 200, { hash: HASH, status: "PENDING" }, { accion: "mandado", hash: HASH, pendiente: true }],
    ["200 DUPLICATE", 200, { hash: HASH.toUpperCase(), status: "DUPLICATE" }, { accion: "mandado", hash: HASH, pendiente: false }],
    ["200 ya", 200, { ya: true }, { accion: "ya" }],
    ["200 sin hash válido", 200, { hash: "ab", status: "PENDING" }, { accion: "incierto" }],
    ["200 con otro status", 200, { hash: HASH, status: "ERROR" }, { accion: "incierto" }],
    ["200 sin cuerpo", 200, null, { accion: "incierto" }],
    ["409 ronda-no-lista", 409, { motivo: "ronda-no-lista", reintentarEn: 1 }, { accion: "espera", fijaMs: ESPERA_RONDA_NO_LISTA_MS, causa: "ronda" }],
    ["502 lectura-sorteo", 502, { motivo: "red", detalle: "lectura-sorteo" }, { accion: "espera", causa: "lectura" }],
    ["502 simulacion", 502, { motivo: "red", detalle: "simulacion" }, { accion: "espera", causa: "lectura" }],
    ["502 secuencia", 502, { motivo: "red", detalle: "secuencia" }, { accion: "espera", causa: "lectura" }],
    ["502 ocupada", 502, { motivo: "red", detalle: "ocupada" }, { accion: "espera", causa: "ocupada" }],
    ["502 rpc-corte", 502, { motivo: "red", detalle: "rpc-corte" }, { accion: "red-del-servicio" }],
    ["502 rpc-503", 502, { motivo: "red", detalle: "rpc-503" }, { accion: "red-del-servicio" }],
    ["502 rpc-error", 502, { motivo: "red", detalle: "rpc-error" }, { accion: "red-del-servicio" }],
    ["502 sin-rpc", 502, { motivo: "red", detalle: "sin-rpc" }, { accion: "red-del-servicio" }],
    ["502 de otro motivo con detalle de rpc", 502, { motivo: "otro", detalle: "rpc-corte" }, { accion: "incierto" }],
    ["502 desconocido", 502, { motivo: "red" }, { accion: "incierto" }],
    ["502 sin cuerpo", 502, null, { accion: "incierto" }],
    ["500 interno", 500, { motivo: "interno" }, { accion: "incierto" }],
    ["520 de Cloudflare", 520, null, { accion: "incierto" }],
    ["503 sin motivo", 503, null, { accion: "incierto" }],
    ["400 fee-alta", 400, { motivo: "fee-alta", detalle: "simulacion" }, hoy()],
    ["400 fallaria", 400, { motivo: "fallaria", detalle: "Error(Contract, #4)" }, hoy({ marca: true })],
    ["403 no-es-nuestro", 403, { motivo: "no-es-nuestro" }, hoy({ marca: true })],
    ["503 apagado", 503, { motivo: "apagado" }, hoy({ disyuntor: true, olvidar: true })],
    ["503 apagado con rige", 503, { motivo: "apagado", rige: "pollar" }, hoy({ disyuntor: true, olvidar: true })],
    ["503 fondo", 503, { motivo: "fondo" }, hoy({ disyuntor: true, olvidar: true })],
    ["503 fondo con detalle", 503, { motivo: "fondo", detalle: "sorteadora" }, hoy({ disyuntor: true, olvidar: true })],
    ["503 fondo con codigo", 503, { motivo: "fondo", codigo: "txInsufficientBalance" }, hoy({ disyuntor: true, olvidar: true })],
    ["403 origen", 403, { motivo: "origen" }, hoy({ disyuntor: true })],
    ["400 cuerpo", 400, { motivo: "cuerpo" }, hoy({ disyuntor: true })],
    ["400 rechazada", 400, { motivo: "rechazada", codigo: "txBadAuth" }, hoy({ disyuntor: true })],
    ["404 no-existe", 404, { motivo: "no-existe" }, hoy({ disyuntor: true })],
    ["405", 405, null, hoy({ disyuntor: true })],
    ["429 cupo-ip", 429, { motivo: "cupo-ip" }, hoy({ disyuntor: true })],
    ["409 de otro motivo", 409, { motivo: "otro" }, hoy({ disyuntor: true })],
    ["otro 4xx", 418, null, hoy({ disyuntor: true })],
  ];
  it.each(filas)("%s", (_nombre, estado, cuerpo, esperado) => {
    expect(leerRespuestaDelSorteo(estado, cuerpo)).toEqual(esperado);
  });

  it("429 cupo-cuenta es un no que se muestra: los sorteos y cuándo se libera", () => {
    const r = leerRespuestaDelSorteo(429, { motivo: "cupo-cuenta", que: "sorteos", liberaEn: 1_800_000_000_000, max: 20 });
    expect(r.accion).toBe("error");
    const e = (r as { error: ErrorPortero }).error;
    expect(e).toBeInstanceOf(ErrorPortero);
    expect(e.motivo).toBe("cupo-cuenta");
    expect(e.que).toBe("sorteos");
    expect(e.liberaEn).toBe(1_800_000_000_000);
    expect(e.max).toBe(20);
  });

  it("los ganadores o el número al azar que traiga el cuerpo no se leen", () => {
    const r = leerRespuestaDelSorteo(200, { hash: HASH, status: "PENDING", winners: [9, 9, 9], randomness: "ff", ya: false });
    expect(r).toEqual({ accion: "mandado", hash: HASH, pendiente: true });
  });
});
