import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVES_DE_MOTIVO, ESPERA_MS, abrir, canjear, estado, fechaDeAlta, minutosDeEspera, precios, textoDelError, type ErrorDeAlta } from "./alta-api";

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const CUENTA = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CODIGO = "K7M29QXA4HTR";

const responder = (estadoHttp: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

interface Llamada {
  url: string;
  init: RequestInit;
}
/** Un fetch de mentira que anota lo que le piden. */
function falso(respuesta: () => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  });
  return { f: f as unknown as typeof fetch, llamadas, espia: f };
}

const sorteos = { quedan: 3, proximoVence: { fecha: Date.UTC(2026, 11, 15, 3, 59), cuantos: 3 } };
const estadoBueno = { acceso: "cupon", cuenta: CUENTA, abierta: false, pedido: null, sorteos, orden: null, fondeo: "inmediato" };
const canjeBueno = { ok: true, repetido: false, sorteosSumados: 3, sorteos, sigue: "activar" };

const fallo = (r: unknown): ErrorDeAlta => {
  const e = r as ErrorDeAlta;
  expect(e.ok).toBe(false);
  return e;
};

let consola: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  consola = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sin servicio, cerrado", () => {
  it("sin red: el error de servicio, sin lanzar", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    for (const r of [await estado(TOKEN, { url: URL, fetch: f as unknown as typeof fetch }), await canjear(TOKEN, CODIGO, { url: URL, fetch: f as unknown as typeof fetch })]) {
      expect(fallo(r)).toMatchObject({ clave: "altaErrServicio", motivo: "sin-red", estado: 0 });
    }
  });

  it("una dirección sin forma de portero (http, con ruta, con consulta o la de Prueba) no recibe el token: no se llama a nadie", async () => {
    for (const url of ["http://pm.tinkazo.app", "https://pm.tinkazo.app/v1", "https://pm.tinkazo.app?x=1", "https://u:c@pm.tinkazo.app", "https://p.tinkazo.app", "no es una direccion"]) {
      const { f, espia } = falso(() => responder(200, estadoBueno));
      expect(fallo(await estado(TOKEN, { url, fetch: f })), url).toMatchObject({ clave: "altaErrServicio", motivo: "sin-portero" });
      expect(fallo(await canjear(TOKEN, CODIGO, { url, fetch: f })), url).toMatchObject({ motivo: "sin-portero" });
      expect(espia, url).not.toHaveBeenCalled();
    }
  });

  it("sin portero configurado no llama a nadie", async () => {
    const { f, espia } = falso(() => responder(200, estadoBueno));
    expect(fallo(await estado(TOKEN, { url: null, fetch: f }))).toMatchObject({ clave: "altaErrServicio", motivo: "sin-portero" });
    expect(espia).not.toHaveBeenCalled();
  });

  it("en este build (Prueba) no hay altas: no llama a nadie ni con el fetch del navegador", async () => {
    const global = vi.fn();
    vi.stubGlobal("fetch", global);
    expect(fallo(await estado(TOKEN))).toMatchObject({ clave: "altaErrServicio", motivo: "sin-portero" });
    expect(fallo(await canjear(TOKEN, CODIGO))).toMatchObject({ motivo: "sin-portero" });
    expect(global).not.toHaveBeenCalled();
  });

  it("sin token no llama a nadie y pide entrar de nuevo", async () => {
    const { f, espia } = falso(() => responder(200, estadoBueno));
    for (const t of ["", "   "]) expect(fallo(await estado(t, { url: URL, fetch: f }))).toMatchObject({ clave: "clErrSesion", motivo: "sin-token" });
    expect(espia).not.toHaveBeenCalled();
  });

  it("espera 8 segundos como mucho", async () => {
    vi.useFakeTimers();
    expect(ESPERA_MS).toBe(8_000);
    let abortado = false;
    const f = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_ok, no) => init?.signal?.addEventListener("abort", () => ((abortado = true), no(new DOMException("aborted", "AbortError")))))) as unknown as typeof fetch;
    const p = estado(TOKEN, { url: URL, fetch: f });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(abortado).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(abortado).toBe(true);
    expect(fallo(await p)).toMatchObject({ clave: "altaErrServicio", motivo: "sin-red" });
  });

  it("una respuesta que no se entiende nunca da un permiso", async () => {
    const malas: [number, unknown][] = [
      [200, null],
      [200, []],
      [200, "ok"],
      [200, {}],
      [200, { ...estadoBueno, acceso: "todos" }],
      [200, { ...estadoBueno, acceso: undefined }],
      [200, { ...estadoBueno, sorteos: { quedan: "3" } }],
      [200, { ...estadoBueno, sorteos: { quedan: -1 } }],
      [200, { ...estadoBueno, abierta: "si" }],
      [200, { ...estadoBueno, fondeo: "ya" }],
      [200, { ...estadoBueno, cuenta: 7 }],
      [200, { ...estadoBueno, orden: { id: 1 } }],
    ];
    for (const [s, cuerpo] of malas) {
      const { f } = falso(() => responder(s, cuerpo));
      expect(fallo(await estado(TOKEN, { url: URL, fetch: f })), JSON.stringify(cuerpo)).toMatchObject({ clave: "altaErrServicio", motivo: "respuesta" });
    }
    const cuerpoRoto = falso(() => new Response("<html>502</html>", { status: 200 }));
    expect(fallo(await estado(TOKEN, { url: URL, fetch: cuerpoRoto.f }))).toMatchObject({ clave: "altaErrServicio", motivo: "respuesta" });
    const canjeRaro = falso(() => responder(200, { ...canjeBueno, sigue: "nada" }));
    expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: canjeRaro.f }))).toMatchObject({ clave: "altaErrServicio" });
    const canjeSinOk = falso(() => responder(200, { ...canjeBueno, ok: false }));
    expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: canjeSinOk.f }))).toMatchObject({ clave: "altaErrServicio" });
  });

  it("un estado o un motivo que no se conocen son error de servicio", async () => {
    for (const [s, cuerpo] of [
      [500, { motivo: "interno" }],
      [418, { motivo: "te-inventaste-esto" }],
      [404, { motivo: "no-existe" }],
      [502, null],
      [503, "texto"],
    ] as [number, unknown][]) {
      const { f } = falso(() => responder(s, cuerpo));
      expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrServicio", estado: s });
    }
  });
});

describe("el token", () => {
  it("va en la cabecera Authorization y nunca en la dirección ni en el cuerpo, en cada ruta con sesión", async () => {
    const llamadas: Llamada[] = [];
    const cuerpos: Record<string, unknown> = { "/v1/alta/estado": estadoBueno, "/v1/alta/cupon": canjeBueno, "/v1/alta/abrir": { estado: "pedido" } };
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return responder(200, cuerpos[String(url).replace(URL, "")]);
    }) as unknown as typeof fetch;
    expect((await estado(TOKEN, { url: URL, fetch: f })).ok).toBe(true);
    expect((await canjear(TOKEN, CODIGO, { url: URL, fetch: f })).ok).toBe(true);
    expect((await abrir(TOKEN, { url: URL, fetch: f })).ok).toBe(true);
    expect(llamadas.map((l) => l.url)).toEqual([`${URL}/v1/alta/estado`, `${URL}/v1/alta/cupon`, `${URL}/v1/alta/abrir`]);
    for (const l of llamadas) {
      expect(l.url).not.toContain(TOKEN);
      expect(l.url).not.toContain("?");
      expect(l.url).not.toContain(CODIGO);
      expect(String(l.init.body)).not.toContain(TOKEN);
      expect(l.init.method).toBe("POST");
      expect(l.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
      expect(l.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    }
  });

  it("el código del cupón va en el cuerpo y en nada más", async () => {
    const { f, llamadas } = falso(() => responder(200, canjeBueno));
    await canjear(TOKEN, CODIGO, { url: URL, fetch: f });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ cupon: CODIGO });
    expect(llamadas[0]?.url).not.toContain(CODIGO);
  });

  it("los precios son abiertos: sin sesión, sin cabecera de autorización", async () => {
    const { f, llamadas } = falso(() => responder(200, { red: "mainnet", pago: false, alta: { usdc: "2", sorteos: 3, dias: 365 }, paquetes: [{ id: "p10", usdc: "5", sorteos: 10, dias: 365 }] }));
    const r = await precios({ url: URL, fetch: f });
    expect(r).toMatchObject({ ok: true, datos: { pago: false, alta: { usdc: "2", sorteos: 3, dias: 365 }, paquetes: [{ id: "p10", sorteos: 10 }] } });
    expect(llamadas[0]?.init.method).toBe("GET");
    expect(llamadas[0]?.init.headers).not.toHaveProperty("Authorization");
    expect(llamadas[0]?.init.body).toBeUndefined();
  });

  it("ningún error lleva el token ni el código, y nada se escribe en la consola", async () => {
    const casos: Response[] = [responder(401, { motivo: "sesion" }), responder(404, { motivo: "cupon-no-existe" }), responder(410, { motivo: "cupon-vencido", vence: 1 }), responder(200, { raro: TOKEN }), responder(429, { motivo: "intentos", reintentarEn: 1 })];
    const resultados: unknown[] = [];
    for (const r of casos) resultados.push(await canjear(TOKEN, CODIGO, { url: URL, fetch: (async () => r) as unknown as typeof fetch }));
    resultados.push(await estado(TOKEN, { url: URL, fetch: (async () => { throw new Error(`Failed ${TOKEN}`); }) as unknown as typeof fetch }));
    const todo = JSON.stringify(resultados);
    expect(todo).not.toContain(TOKEN);
    expect(todo).not.toContain(CODIGO);
    for (const e of consola) expect(e).not.toHaveBeenCalled();
  });
});

describe("lo que sale bien", () => {
  it("estado trae el acceso, la cuenta y los sorteos", async () => {
    const { f } = falso(() => responder(200, { ...estadoBueno, pedido: "req-1", orden: { id: "ABCD2345", producto: "alta", usdc: "2", nota: "tk:o:ABCD2345", vence: 5 } }));
    expect(await estado(TOKEN, { url: URL, fetch: f })).toEqual({
      ok: true,
      datos: { acceso: "cupon", cuenta: CUENTA, abierta: false, pedido: "req-1", sorteos, orden: { id: "ABCD2345", producto: "alta", usdc: "2", nota: "tk:o:ABCD2345", vence: 5 }, fondeo: "inmediato" },
    });
  });

  it("estado sin cuenta ni vencimiento", async () => {
    const { f } = falso(() => responder(200, { acceso: "ninguno", cuenta: null, abierta: false, pedido: null, sorteos: { quedan: 0, proximoVence: null }, orden: null, fondeo: "diferido" }));
    expect(await estado(TOKEN, { url: URL, fetch: f })).toMatchObject({ ok: true, datos: { acceso: "ninguno", cuenta: null, sorteos: { quedan: 0, proximoVence: null }, fondeo: "diferido" } });
  });

  it("canjear trae lo que sigue", async () => {
    const { f } = falso(() => responder(200, canjeBueno));
    expect(await canjear(TOKEN, CODIGO, { url: URL, fetch: f })).toEqual({ ok: true, datos: canjeBueno });
  });

  it("abrir dice cómo quedó", async () => {
    for (const e of ["pedido", "abierta", "no-hace-falta"]) {
      const { f } = falso(() => responder(200, { estado: e }));
      expect(await abrir(TOKEN, { url: URL, fetch: f })).toEqual({ ok: true, datos: { estado: e } });
    }
    const { f } = falso(() => responder(200, { estado: "raro" }));
    expect(fallo(await abrir(TOKEN, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrServicio" });
  });
});

describe("cada motivo de la sección 9 tiene su clave", () => {
  // Estado HTTP y motivo de cada error del diseño, y la clave del texto de la sección 8 que lo cuenta.
  const TABLA: [number, string, string][] = [
    // Comunes a las rutas con sesión.
    [401, "sesion", "clErrSesion"],
    [403, "otra-app", "altaErrServicio"],
    [502, "pollar", "altaErrServicio"],
    [503, "apagado", "altaErrServicio"],
    [503, "altas-pausadas", "altaErrServicio"],
    [429, "intentos", "altaErrIntentos"],
    [429, "cupo-ip", "altaErrIntentos"],
    [403, "origen", "altaErrServicio"],
    [400, "cuerpo", "altaErrServicio"],
    // El canje.
    [400, "forma", "altaErrForma"],
    [404, "cupon-no-existe", "altaErrNoExiste"],
    [410, "cupon-vencido", "altaErrVencido"],
    [410, "cupon-anulado", "altaErrAnulado"],
    [409, "cupon-usado", "altaErrUsado"],
    [409, "lote-usado", "altaErrLote"],
    // El estado y el canje, con la cuenta que no coincide con la del acceso.
    [409, "cuenta-de-otro", "altaErrCuentaDeOtro"],
    // Abrir la cuenta.
    [403, "sin-acceso", "errAnchor.porteroSinAlta"],
    [409, "sin-billetera", "altaErrServicio"],
    [503, "sin-creditos", "altaErrServicio"],
    [429, "espera", "altaErrIntentos"],
    // El sello.
    [402, "sin-sorteos", "errAnchor.porteroSinSorteos"],
  ];

  it.each(TABLA)("%i %s da %s", async (s, motivo, clave) => {
    const { f } = falso(() => responder(s, { motivo, vence: Date.UTC(2026, 11, 15, 3, 59), reintentarEn: Date.now() + 5 * 60_000 }));
    // `espera` es siempre un minuto: el texto en singular.
    const esperada = motivo === "espera" ? "altaErrIntentos1" : clave;
    expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f }))).toMatchObject({ ok: false, clave: esperada, motivo, estado: s });
  });

  it("la tabla de arriba es la tabla entera del código, ni más ni menos", () => {
    expect(Object.keys(CLAVES_DE_MOTIVO).sort()).toEqual(TABLA.map((t) => t[1]).sort());
    for (const [, motivo, clave] of TABLA) expect(CLAVES_DE_MOTIVO[motivo]).toBe(clave);
  });

  it("un 401 sin motivo es la sesión que se cerró", async () => {
    const { f } = falso(() => responder(401, {}));
    expect(fallo(await estado(TOKEN, { url: URL, fetch: f }))).toMatchObject({ clave: "clErrSesion", estado: 401 });
  });
});

describe("los datos del texto", () => {
  it("un cupón que venció el 14 de diciembre a las 23:59 de Bolivia dice 14, no 15", async () => {
    const vence = Date.UTC(2026, 11, 15, 3, 59);
    expect(fechaDeAlta(vence, "es")).toBe("14 de diciembre");
    expect(fechaDeAlta(vence, "en")).toBe("December 14");
    const { f } = falso(() => responder(410, { motivo: "cupon-vencido", vence }));
    const e = fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f, idioma: "es" }));
    expect(e).toMatchObject({ clave: "altaErrVencido", vars: { fecha: "14 de diciembre" } });
    expect(textoDelError(e, () => "Ese cupón venció el {fecha}. Pedile otro.")).toBe("Ese cupón venció el 14 de diciembre. Pedile otro.");
  });

  it("un cupón vencido sin fecha no deja un hueco en el texto", async () => {
    const { f } = falso(() => responder(410, { motivo: "cupon-vencido" }));
    expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrAnulado", vars: {} });
  });

  it("los minutos de espera: del instante en ms que manda el portero, de 1 a 60", async () => {
    const AHORA = 1_800_000_000_000;
    expect(minutosDeEspera(AHORA + 5 * 60_000 - 1, AHORA)).toBe(5);
    expect(minutosDeEspera(Date.now() + 61 * 60_000, Date.now())).toBe(60);
    expect(minutosDeEspera(Date.now() - 5, Date.now())).toBe(1);
    // Una espera en segundos o un instante en segundos no es lo que manda el portero: como si no hubiera venido.
    expect(minutosDeEspera(120, AHORA)).toBe(60);
    expect(minutosDeEspera(AHORA / 1000 + 300, AHORA)).toBe(60);
    for (const raro of [undefined, null, "5", NaN, 0, -3]) expect(minutosDeEspera(raro, 0)).toBe(60);
    const { f } = falso(() => responder(429, { motivo: "intentos", reintentarEn: 1_800_000_000_000 + 7 * 60_000 }));
    const e = fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f, ahora: () => 1_800_000_000_000 }));
    expect(e.vars).toEqual({ min: "7" });
    expect(textoDelError(e, () => "Esperá {min} minutos.")).toBe("Esperá 7 minutos.");
  });

  it("el tope por dirección no trae instante: se dice la hora entera", async () => {
    const { f } = falso(() => responder(429, { motivo: "cupo-ip" }));
    expect(fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f })).vars).toEqual({ min: "60" });
  });

  it("abrir dos veces seguidas espera un minuto", async () => {
    const { f } = falso(() => responder(429, { motivo: "espera" }));
    expect(fallo(await abrir(TOKEN, { url: URL, fetch: f }))).toMatchObject({ clave: "altaErrIntentos1", vars: { min: "1" } });
  });

  it("con un minuto, el texto va en singular en los dos idiomas: «en 1 minuto», no «en 1 minutos»", async () => {
    const { T } = await import("../i18n");
    const { f } = falso(() => responder(429, { motivo: "intentos", reintentarEn: 1_800_000_000_000 + 30_000 }));
    const e = fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: f, ahora: () => 1_800_000_000_000 }));
    expect(e).toMatchObject({ clave: "altaErrIntentos1", vars: { min: "1" } });
    expect(textoDelError(e, (k) => String(T.es[k]))).toBe("El canje de cupones quedó en pausa por un rato. Probá de nuevo en 1 minuto o pedile ayuda a quien organiza el evento.");
    expect(textoDelError(e, (k) => String(T.en[k]))).toBe("Coupon redemption is paused for a while. Try again in 1 minute or ask the event organizer for help.");
    // Con más de uno, el plural de siempre.
    const { f: g } = falso(() => responder(429, { motivo: "intentos", reintentarEn: 1_800_000_000_000 + 2 * 60_000 }));
    const e2 = fallo(await canjear(TOKEN, CODIGO, { url: URL, fetch: g, ahora: () => 1_800_000_000_000 }));
    expect(textoDelError(e2, (k) => String(T.es[k]))).toBe("El canje de cupones quedó en pausa por un rato. Probá de nuevo en 2 minutos o pedile ayuda a quien organiza el evento.");
    expect(textoDelError(e2, (k) => String(T.en[k]))).toBe("Coupon redemption is paused for a while. Try again in 2 minutes or ask the event organizer for help.");
  });
});
