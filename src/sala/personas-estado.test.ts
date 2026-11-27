import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAZO_DE_PERSONAS_MS, personasListas } from "./personas-estado";

/**
 * La pregunta que el panel le hace a la sala antes de cobrar una campaña de personas: si las tiene prendidas y con el mismo
 * identificador de Google (público) que el sitio. Contra un `fetch` de mentira, sin red ni reloj. Solo un sí completo es un sí:
 * con cualquier otra cosa no se cobra.
 */

const SERVICIO = "https://s.test";
const CLIENTE = "1234567890-ejemplo.apps.googleusercontent.com";

interface Llamada {
  url: string;
  init: RequestInit | undefined;
}

function conRespuesta(estado: number, cuerpo?: unknown): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    const texto = cuerpo === undefined ? null : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
    return new Response(texto, { status: estado });
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const delSitio = (): string => CLIENTE;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("preguntar si la sala tiene las personas listas", () => {
  it("le pide el estado a la sala con un GET, sin cuerpo y sin nada que autorice", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    await personasListas({ fetch: x.fetch, cliente: delSitio }, SERVICIO);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/personas/estado`);
    expect(x.llamadas[0]?.init?.method ?? "GET").toBe("GET");
    expect(x.llamadas[0]?.init?.body).toBeUndefined();
    expect(x.llamadas[0]?.init?.headers).toBeUndefined();
  });

  it("con 200, prendido y el mismo identificador que el sitio, dice que sí", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    expect(await personasListas({ fetch: x.fetch, cliente: delSitio }, SERVICIO)).toBe(true);
  });

  it.each<[string, number, unknown]>([
    ["con las personas apagadas", 200, { prendido: false, cliente: CLIENTE }],
    ["con otro identificador de Google", 200, { prendido: true, cliente: "9999-otro.apps.googleusercontent.com" }],
    ["con el identificador vacío", 200, { prendido: true, cliente: "" }],
    ["sin identificador", 200, { prendido: true }],
    ["con un identificador que no es texto", 200, { prendido: true, cliente: 7 }],
    ["con prendido escrito como texto", 200, { prendido: "true", cliente: CLIENTE }],
    ["con prendido en 1", 200, { prendido: 1, cliente: CLIENTE }],
    ["con una respuesta que no es un objeto", 200, [true, CLIENTE]],
    ["con una respuesta vacía", 200, undefined],
    ["con una respuesta que no se puede leer", 200, "no es json"],
    ["con null", 200, "null"],
    ["con un 201, aunque diga que sí", 201, { prendido: true, cliente: CLIENTE }],
    ["con un 404 de una sala que todavía no tiene la ruta", 404, { error: "no-existe" }],
    ["con un 503", 503, { error: "personas-apagadas" }],
    ["con un 500", 500, undefined],
  ])("%s dice que no", async (_nombre, estado, cuerpo) => {
    const x = conRespuesta(estado, cuerpo);
    expect(await personasListas({ fetch: x.fetch, cliente: delSitio }, SERVICIO)).toBe(false);
  });

  it("si el sitio no tiene identificador, dice que no sin preguntarle nada a la sala", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    expect(await personasListas({ fetch: x.fetch, cliente: () => null }, SERVICIO)).toBe(false);
    expect(x.llamadas).toEqual([]);
  });

  it("sin red dice que no, y no lanza", async () => {
    const cortado = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    await expect(personasListas({ fetch: cortado, cliente: delSitio }, SERVICIO)).resolves.toBe(false);
  });

  it("si leer el identificador del sitio falla, dice que no, y no lanza", async () => {
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    const roto = (): string => {
      throw new Error("sin entorno");
    };
    await expect(personasListas({ fetch: x.fetch, cliente: roto }, SERVICIO)).resolves.toBe(false);
  });

  it("espera diez segundos como mucho: con la señal cortada dice que no", async () => {
    expect(PLAZO_DE_PERSONAS_MS).toBe(10_000);
    const x = conRespuesta(200, { prendido: true, cliente: CLIENTE });
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new Error("cortada");
      return x.fetch(url, init);
    }) as unknown as typeof fetch;
    expect(await personasListas({ fetch: f, cliente: delSitio, senal: () => AbortSignal.abort() }, SERVICIO)).toBe(false);
    // Sin decirle nada, el pedido lleva su propia señal: nunca queda esperando sin tope.
    await personasListas({ fetch: x.fetch, cliente: delSitio }, SERVICIO);
    expect(x.llamadas[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("el identificador con que se compara es el del sitio", () => {
  it("con el sitio construido para las campañas de personas, compara con su identificador", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "1");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", ` ${CLIENTE} `);
    expect(await personasListas({ fetch: conRespuesta(200, { prendido: true, cliente: CLIENTE }).fetch }, SERVICIO)).toBe(true);
    expect(await personasListas({ fetch: conRespuesta(200, { prendido: true, cliente: "9999-otro.apps.googleusercontent.com" }).fetch }, SERVICIO)).toBe(false);
  });

  it("con el sitio sin el interruptor de las campañas de personas, dice que no aunque la sala las tenga prendidas", async () => {
    vi.stubEnv("VITE_ANOTARSE_SIN_BILLETERA", "0");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", CLIENTE);
    expect(await personasListas({ fetch: conRespuesta(200, { prendido: true, cliente: CLIENTE }).fetch }, SERVICIO)).toBe(false);
  });
});
