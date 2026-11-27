import { describe, expect, it } from "vitest";
import { PLAZO_DE_PERSONAS_MS, crearCampanaEnSala, personasSePuedenAbrir } from "./campana-org";

/**
 * Lo que el cliente de quien organiza sabe de las campañas de personas, contra un `fetch` de mentira: la sala que no las
 * tiene prendidas contesta con su motivo y no como una falta de conexión, y antes de abrir se le puede preguntar si están
 * prendidas con el mismo identificador de Google que usa el sitio. Sin red ni reloj.
 */

const SERVICIO = "https://s.test";
const TOKEN = "T".repeat(22);
const ARCHIVO = { texto: '{"v":1,"identidad":"persona"}', firma: "F".repeat(86) };
const CLIENTE = "123-abc.apps.googleusercontent.com";

interface Llamada {
  url: string;
  init: RequestInit;
}

function conRespuesta(estado: number, cuerpo?: unknown): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), { status: estado });
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

describe("crear una campaña de personas en una sala que no las tiene prendidas", () => {
  it.each(["personas-apagadas", "personas-configuracion"])("el 503 %s vuelve con su motivo, nunca como falta de conexión", async (error) => {
    const x = conRespuesta(503, { error });
    const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: x.fetch }, SERVICIO);
    expect(r).toEqual({ ok: false, motivo: "personas-apagadas" });
  });

  it("los demás 503 siguen siendo de conexión, y una sala creada sigue creada", async () => {
    for (const error of ["sin-llave", "ocupado", "apagada"]) {
      const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: conRespuesta(503, { error }).fetch }, SERVICIO);
      expect(r, error).toEqual({ ok: false, motivo: "red" });
    }
    const buena = conRespuesta(201, { id: "AbCd1234", token: TOKEN, vence: 1_800_000_000_000 });
    const r = await crearCampanaEnSala(ARCHIVO, { evento: "evento-uno", red: "testnet" }, { fetch: buena.fetch }, SERVICIO);
    expect(r.ok).toBe(true);
  });
});

describe("preguntar si una campaña de personas se puede abrir", () => {
  it("si el sitio no las sabe abrir, no se puede y a la sala no se le pregunta nada", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    expect(await personasSePuedenAbrir(null, { fetch: x.fetch }, SERVICIO)).toBe(false);
    expect(x.llamadas).toHaveLength(0);
  });

  it("le pregunta a la sala con un GET sin cuerpo ni credenciales, y con su plazo", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: x.fetch }, SERVICIO)).toBe(true);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/personas/estado`);
    expect(x.llamadas[0]?.init.method ?? "GET").toBe("GET");
    expect(x.llamadas[0]?.init.body).toBeUndefined();
    expect(x.llamadas[0]?.init.headers).toBeUndefined();
    expect(x.llamadas[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(PLAZO_DE_PERSONAS_MS).toBeLessThanOrEqual(10_000);
  });

  it("con la sala apagada no se puede", async () => {
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: conRespuesta(200, { prendido: false, cliente: "" }).fetch }, SERVICIO)).toBe(false);
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: conRespuesta(200, { prendido: false, cliente: CLIENTE }).fetch }, SERVICIO)).toBe(false);
  });

  it("con otro identificador en la sala no se puede: nadie podría entrar", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: "otro.apps.googleusercontent.com" });
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: x.fetch }, SERVICIO)).toBe(false);
  });

  it.each<[number, unknown]>([
    [500, undefined],
    [404, { error: "no-existe" }],
    [429, { error: "limite" }],
    [200, undefined],
    [200, { prendido: "si", cliente: CLIENTE }],
    [200, { prendido: true }],
    [200, []],
  ])("con %i y %j no se sabe", async (estado, cuerpo) => {
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: conRespuesta(estado, cuerpo).fetch }, SERVICIO)).toBeNull();
  });

  it("sin red no se sabe", async () => {
    const cortado = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await personasSePuedenAbrir(CLIENTE, { fetch: cortado }, SERVICIO)).toBeNull();
  });

  it("una sala que nunca contesta se corta por tiempo y no se sabe", async () => {
    const corte = new AbortController();
    const colgado = ((_url: string, init: RequestInit) =>
      new Promise((_resolver, rechazar) => {
        init.signal?.addEventListener("abort", () => rechazar(new Error("cortada")));
      })) as unknown as typeof fetch;
    const pendiente = personasSePuedenAbrir(CLIENTE, { fetch: colgado, senal: () => corte.signal }, SERVICIO);
    corte.abort();
    expect(await pendiente).toBeNull();
  });
});
