import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAVES_DEL_PAGO, type ErrorDeAlta, estado, memoIdDe, orden, pago } from "./alta-api";
import { USDC_MAINNET } from "./pagos";
import { CLAVES_DE_LA_VENTA, claveDeLaOrden } from "./venta-oficial";

/**
 * El cliente de la orden y del pago (`POST /v1/alta/orden` y `POST /v1/alta/pago`) con un servidor de mentira: sin red.
 * Lo que no se negocia: un dato de pago que no cuadra es plata perdida de alguien, así que una orden se acepta solo si
 * la cuenta, el monto, la nota, la nota numérica y el enlace dicen lo mismo; si no, es un error y no se muestra nada.
 */

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const DESTINO = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const OTRA = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
const ID = "ABCD2345";
const NOTA = `tk:o:${ID}`;

const responder = (estadoHttp: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

interface Llamada {
  url: string;
  init: RequestInit;
}
function falso(respuesta: () => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  });
  return { f: f as unknown as typeof fetch, llamadas, espia: f };
}

/** El enlace de pago como lo arma el servidor (`enlaceDePago`, `workers/patrocinio/src/cobros.ts`). */
function enlace(o: { destino: string; usdc: string; nota: string }, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ destination: o.destino, amount: o.usdc, asset_code: "USDC", asset_issuer: USDC_MAINNET.issuer, memo: o.nota, memo_type: "MEMO_TEXT", ...extra });
  return `web+stellar:pay?${q.toString()}`;
}

/** La orden que devuelve el servidor (`vistaDeOrden`, `workers/patrocinio/src/rutas-altas.ts`). */
const ordenBuena = (o: Partial<Record<string, unknown>> = {}) => ({ id: ID, producto: "alta", usdc: "3", sorteos: 3, destino: DESTINO, nota: NOTA, memoId: memoIdDe(ID), enlace: enlace({ destino: DESTINO, usdc: "3", nota: NOTA }), vence: 1_800_000_000_000, ...o });

const fallo = (r: unknown): ErrorDeAlta => {
  const e = r as ErrorDeAlta;
  expect(e.ok).toBe(false);
  return e;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la nota numérica", () => {
  it("es el id de la orden como número de 40 bits, como la arma el servidor", () => {
    expect(memoIdDe("00000000")).toBe("0");
    expect(memoIdDe("00000001")).toBe("1");
    expect(memoIdDe("0000000Z")).toBe("31");
    expect(memoIdDe("00000010")).toBe("32");
    expect(memoIdDe("ZZZZZZZZ")).toBe(String(2 ** 40 - 1));
    expect(memoIdDe(ID)).toBe(String(((((((10 * 32 + 11) * 32 + 12) * 32 + 13) * 32 + 2) * 32 + 3) * 32 + 4) * 32 + 5));
  });

  it("un id sin forma no tiene nota numérica", () => {
    for (const id of ["", "ABCD234", "ABCD23456", "abcd2345", "ABCD234U", "ABCD234I"]) expect(memoIdDe(id), id).toBeNull();
  });
});

describe("la orden", () => {
  it("pide la orden con la sesión en la cabecera y el producto en el cuerpo, y la trae entera", async () => {
    const { f, llamadas } = falso(() => responder(200, { orden: ordenBuena() }));
    const r = await orden(TOKEN, "alta", { url: URL, fetch: f });
    expect(r).toEqual({ ok: true, datos: ordenBuena() });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toBe(`${URL}/v1/alta/orden`);
    expect(llamadas[0]?.init.method).toBe("POST");
    expect(llamadas[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ producto: "alta" });
    expect(llamadas[0]?.url).not.toContain(TOKEN);
    expect(String(llamadas[0]?.init.body)).not.toContain(TOKEN);
    expect(llamadas[0]?.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  });

  it("un paquete con decimales y otro producto", async () => {
    const o = ordenBuena({ producto: "p10", usdc: "8.5", sorteos: 10, enlace: enlace({ destino: DESTINO, usdc: "8.5", nota: NOTA }) });
    const { f } = falso(() => responder(200, { orden: o }));
    expect(await orden(TOKEN, "p10", { url: URL, fetch: f })).toEqual({ ok: true, datos: o });
  });

  it("una orden que no cuadra no se acepta: ningún dato de pago que no vino entero y parejo del servidor", async () => {
    const malas: [string, unknown][] = [
      ["sin orden", {}],
      ["orden nula", { orden: null }],
      ["id corto", { orden: ordenBuena({ id: "ABCD234" }) }],
      ["id con letra que no es del alfabeto", { orden: ordenBuena({ id: "ABCD234U" }) }],
      ["otro producto que el pedido", { orden: ordenBuena({ producto: "p10" }) }],
      ["monto cero", { orden: ordenBuena({ usdc: "0" }) }],
      ["monto con coma", { orden: ordenBuena({ usdc: "3,5" }) }],
      ["monto negativo", { orden: ordenBuena({ usdc: "-3" }) }],
      ["monto como número", { orden: ordenBuena({ usdc: 3 }) }],
      ["sin sorteos", { orden: ordenBuena({ sorteos: 0 }) }],
      ["sorteos con decimales", { orden: ordenBuena({ sorteos: 2.5 }) }],
      ["cuenta sin control", { orden: ordenBuena({ destino: `${DESTINO.slice(0, 55)}${DESTINO.endsWith("A") ? "B" : "A"}` }) }],
      ["cuenta que no es G", { orden: ordenBuena({ destino: `M${DESTINO.slice(1)}` }) }],
      ["nota de otra orden", { orden: ordenBuena({ nota: "tk:o:ABCD2346" }) }],
      ["nota sin prefijo", { orden: ordenBuena({ nota: ID }) }],
      ["nota numérica de otra orden", { orden: ordenBuena({ memoId: "12" }) }],
      ["enlace a otra cuenta", { orden: ordenBuena({ enlace: enlace({ destino: OTRA, usdc: "3", nota: NOTA }) }) }],
      ["enlace con otro monto", { orden: ordenBuena({ enlace: enlace({ destino: DESTINO, usdc: "30", nota: NOTA }) }) }],
      ["enlace con otra nota", { orden: ordenBuena({ enlace: enlace({ destino: DESTINO, usdc: "3", nota: "tk:o:ZZZZZZZZ" }) }) }],
      ["enlace con otro emisor", { orden: ordenBuena({ enlace: enlace({ destino: DESTINO, usdc: "3", nota: NOTA }, { asset_issuer: OTRA }) }) }],
      ["enlace con un aviso a otro lado", { orden: ordenBuena({ enlace: enlace({ destino: DESTINO, usdc: "3", nota: NOTA }, { callback: "url:https://ejemplo.example" }) }) }],
      ["enlace que no es de pago", { orden: ordenBuena({ enlace: `https://ejemplo.example/?${enlace({ destino: DESTINO, usdc: "3", nota: NOTA }).split("?")[1]}` }) }],
      ["sin vencimiento", { orden: ordenBuena({ vence: null }) }],
    ];
    for (const [quien, cuerpo] of malas) {
      const { f } = falso(() => responder(200, cuerpo));
      expect(fallo(await orden(TOKEN, "alta", { url: URL, fetch: f })), quien).toMatchObject({ clave: "altaErrServicio", motivo: "respuesta" });
    }
  });

  it("un producto sin forma ni se pide", async () => {
    for (const producto of ["", "ALTA", "a/../b", "x".repeat(40)]) {
      const { f, espia } = falso(() => responder(200, { orden: ordenBuena() }));
      expect(fallo(await orden(TOKEN, producto, { url: URL, fetch: f })), producto).toMatchObject({ clave: "altaErrServicio", motivo: "producto" });
      expect(espia).not.toHaveBeenCalled();
    }
  });

  it("sin token, sin portero o en Prueba no se llama a nadie", async () => {
    const { f, espia } = falso(() => responder(200, { orden: ordenBuena() }));
    expect(fallo(await orden("  ", "alta", { url: URL, fetch: f }))).toMatchObject({ clave: "clErrSesion", motivo: "sin-token" });
    expect(fallo(await orden(TOKEN, "alta", { url: null, fetch: f }))).toMatchObject({ motivo: "sin-portero" });
    const global = vi.fn();
    vi.stubGlobal("fetch", global);
    expect(fallo(await orden(TOKEN, "alta"))).toMatchObject({ motivo: "sin-portero" });
    expect(espia).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });
});

describe("el pago", () => {
  it("pregunta por la orden con la sesión en la cabecera y el id en el cuerpo", async () => {
    const { f, llamadas } = falso(() => responder(200, { pagada: false, recibido: "0", total: "3", minimo: "2.85" }));
    expect(await pago(TOKEN, ID, { url: URL, fetch: f })).toEqual({ ok: true, datos: { pagada: false, recibido: "0", total: "3", minimo: "2.85" } });
    expect(llamadas[0]?.url).toBe(`${URL}/v1/alta/pago`);
    expect(llamadas[0]?.init.method).toBe("POST");
    expect(llamadas[0]?.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ orden: ID });
    expect(llamadas[0]?.url).not.toContain(ID);
  });

  it("pagada: los sorteos y lo que sigue", async () => {
    const sorteos = { quedan: 3, proximoVence: { fecha: 1_900_000_000_000, cuantos: 3 } };
    const { f } = falso(() => responder(200, { pagada: true, sorteos, sigue: "activar" }));
    expect(await pago(TOKEN, ID, { url: URL, fetch: f })).toEqual({ ok: true, datos: { pagada: true, sorteos, sigue: "activar" } });
  });

  it("a medias: lo que llegó, el total y el mínimo, tal cual", async () => {
    const { f } = falso(() => responder(200, { pagada: false, recibido: "1.5", total: "3", minimo: "2.85" }));
    expect(await pago(TOKEN, ID, { url: URL, fetch: f })).toEqual({ ok: true, datos: { pagada: false, recibido: "1.5", total: "3", minimo: "2.85" } });
  });

  it("una respuesta que no se entiende nunca dice que se pagó", async () => {
    const malas: unknown[] = [
      {},
      { pagada: "si" },
      { pagada: 1, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" },
      { pagada: true },
      { pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "nada" },
      { pagada: true, sorteos: { quedan: -1, proximoVence: null }, sigue: "activar" },
      { pagada: false, recibido: 1, total: "3", minimo: "2.85" },
      { pagada: false, recibido: "1", total: "0", minimo: "0" },
      { pagada: false, recibido: "1", total: "3" },
    ];
    for (const cuerpo of malas) {
      const { f } = falso(() => responder(200, cuerpo));
      expect(fallo(await pago(TOKEN, ID, { url: URL, fetch: f })), JSON.stringify(cuerpo)).toMatchObject({ clave: "altaErrServicio", motivo: "respuesta" });
    }
  });

  it("un id sin forma ni se pregunta", async () => {
    for (const id of ["", "abcd", "ABCD234U", "tk:o:ABCD2345", "ABCD2345?x=1"]) {
      const { f, espia } = falso(() => responder(200, { pagada: false, recibido: "0", total: "3", minimo: "2.85" }));
      expect(fallo(await pago(TOKEN, id, { url: URL, fetch: f })), id).toMatchObject({ clave: "altaErrServicio", motivo: "forma" });
      expect(espia).not.toHaveBeenCalled();
    }
  });
});

describe("cada motivo del servidor tiene su clave", () => {
  // Los motivos propios de cada ruta, leídos uno por uno de `workers/patrocinio/src/rutas-altas.ts` (`orden` y `pago`)
  // y de `cobros.ts` (`crearOrden`), y la clave del texto que lo cuenta.
  const ORDEN: [number, string, string][] = [
    [503, "pago-apagado", "pagoNoALaVenta"],
    [503, "venta-pausada", "pagoPausado"],
    [503, "altas-pausadas", "pagoNoALaVenta"],
    [400, "producto", "pagoNoALaVenta"],
    [409, "ya-tiene-acceso", "pagoYaTenes"],
    // Con la lista del piloto puesta en el servidor, una cuenta que no está en ella no saca una orden nueva.
    [503, "fuera-del-piloto", "pagoNoALaVenta"],
  ];
  const PAGO: [number, string, string][] = [
    [503, "pago-apagado", "pagoErrRed"],
    [400, "forma", "altaErrServicio"],
    [404, "orden", "pagoErrOrden"],
    [502, "red", "pagoErrRed"],
    // Una orden cerrada (devuelta, o reemplazada por el aviso de una compra con QR): probar de nuevo no la abre.
    [410, "orden-cerrada", "pagoErrOrden"],
    [409, "cuenta-de-otro", "altaErrCuentaDeOtro"],
  ];
  // Los comunes a las rutas con sesión siguen con la clave de siempre.
  const COMUNES: [number, string, string][] = [
    [401, "sesion", "clErrSesion"],
    [403, "otra-app", "altaErrServicio"],
    [502, "pollar", "altaErrServicio"],
    [503, "apagado", "altaErrServicio"],
    [403, "origen", "altaErrServicio"],
    [400, "cuerpo", "altaErrServicio"],
    [429, "cupo-ip", "altaErrIntentos"],
  ];

  it.each([...ORDEN, ...COMUNES])("la orden: %i %s da %s", async (s, motivo, clave) => {
    const { f } = falso(() => responder(s, { motivo, detalle: "techo" }));
    expect(fallo(await orden(TOKEN, "alta", { url: URL, fetch: f }))).toMatchObject({ clave, motivo, estado: s });
  });

  it.each([...PAGO, ...COMUNES])("el pago: %i %s da %s", async (s, motivo, clave) => {
    const { f } = falso(() => responder(s, { motivo }));
    expect(fallo(await pago(TOKEN, ID, { url: URL, fetch: f }))).toMatchObject({ clave, motivo, estado: s });
  });

  it("la venta pausada se dice igual que la venta frenada del control de costos (`venta-oficial.ts`)", () => {
    expect(CLAVES_DEL_PAGO.orden["venta-pausada"]).toBe(CLAVES_DE_LA_VENTA["venta-pausada"]);
    for (const [motivo, clave] of Object.entries(CLAVES_DE_LA_VENTA)) expect(claveDeLaOrden(503, { motivo }), motivo).toBe(clave);
  });

  it("las tablas de arriba son las del código, ni más ni menos", () => {
    expect(CLAVES_DEL_PAGO.orden).toEqual(Object.fromEntries(ORDEN.map(([, m, c]) => [m, c])));
    expect(CLAVES_DEL_PAGO.pago).toEqual(Object.fromEntries(PAGO.filter(([, m]) => m !== "cuenta-de-otro").map(([, m, c]) => [m, c])));
  });

  it("lo que el servidor no dice, o la puerta sin las rutas del pago, es el error de servicio", async () => {
    for (const [s, cuerpo] of [
      [404, { motivo: "no-existe" }],
      [405, { motivo: "metodo" }],
      [500, { motivo: "interno" }],
      [503, null],
    ] as [number, unknown][]) {
      const { f } = falso(() => responder(s, cuerpo));
      expect(fallo(await orden(TOKEN, "alta", { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrServicio", estado: s });
      expect(fallo(await pago(TOKEN, ID, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrServicio", estado: s });
    }
  });

  it("los motivos del pago no cambian lo que dicen el estado y el canje", async () => {
    const { f } = falso(() => responder(400, { motivo: "forma" }));
    expect(fallo(await estado(TOKEN, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrForma" });
    const { f: g } = falso(() => responder(503, { motivo: "altas-pausadas" }));
    expect(fallo(await estado(TOKEN, { url: URL, fetch: g }))).toMatchObject({ clave: "altaErrServicio" });
  });
});

describe("la orden abierta que trae el estado", () => {
  const base = { acceso: "ninguno", cuenta: DESTINO, abierta: false, pedido: null, sorteos: { quedan: 0, proximoVence: null }, fondeo: "inmediato" };

  it("con lo que ya llegó", async () => {
    const { f } = falso(() => responder(200, { ...base, orden: { id: ID, producto: "alta", usdc: "3", nota: NOTA, vence: 5, recibido: "1.5" } }));
    expect(await estado(TOKEN, { url: URL, fetch: f })).toMatchObject({ ok: true, datos: { orden: { id: ID, producto: "alta", usdc: "3", nota: NOTA, vence: 5, recibido: "1.5" } } });
  });

  it("un `recibido` que no se entiende se deja de lado: no traba el acceso", async () => {
    for (const recibido of [undefined, 1, "uno", "-1"]) {
      const { f } = falso(() => responder(200, { ...base, orden: { id: ID, producto: "alta", usdc: "3", nota: NOTA, vence: 5, recibido } }));
      const r = await estado(TOKEN, { url: URL, fetch: f });
      expect(r.ok, String(recibido)).toBe(true);
      if (r.ok) expect(r.datos.orden, String(recibido)).toEqual({ id: ID, producto: "alta", usdc: "3", nota: NOTA, vence: 5 });
    }
  });
});
