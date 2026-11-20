import { afterEach, describe, expect, it, vi } from "vitest";
import { admitirPorPremio, altaPremioAbierta } from "./alta-api";

/**
 * El cliente del alta de quien ganó (`POST /v1/alta/premio`), con un servidor de mentira: sin red. Las respuestas son las de
 * `workers/patrocinio/src/rutas-altas.ts` (`premio`): cada estado bueno y cada motivo, uno por uno.
 */

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const PEDIDO = { sorteo: "777", puesto: 1, cuenta: "G".padEnd(56, "A") };

const responder = (estadoHttp: number, cuerpo: unknown): Response =>
  new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

function falso(respuesta: () => Response | Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

/** Pide el alta con una respuesta fija del servicio. */
const pedir = (r: Response) => admitirPorPremio(TOKEN, PEDIDO, { url: URL, fetch: falso(() => r).f });

afterEach(() => vi.restoreAllMocks());

describe("el alta de quien ganó", () => {
  it("pide con la sesión en la cabecera y el sorteo como texto, el puesto y la cuenta en el cuerpo", async () => {
    const { f, llamadas } = falso(() => responder(200, { estado: "admitida", repetido: false }));
    await admitirPorPremio(TOKEN, PEDIDO, { url: URL, fetch: f });
    expect(llamadas[0]?.url).toBe(`${URL}/v1/alta/premio`);
    const init = llamadas[0]?.init;
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({ sorteo: "777", puesto: 1, cuenta: PEDIDO.cuenta });
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });

  it.each(["admitida", "ya-tiene-acceso", "no-hace-falta"] as const)("el 200 con estado %s es ese estado", async (estado) => {
    const { f } = falso(() => responder(200, { estado, repetido: true }));
    expect(await admitirPorPremio(TOKEN, PEDIDO, { url: URL, fetch: f })).toEqual({ estado });
  });

  it("un 200 con otra forma es red", async () => {
    expect(await pedir(responder(200, { estado: "raro" }))).toEqual({ error: "red" });
    expect(await pedir(responder(200, []))).toEqual({ error: "red" });
  });

  it("la ruta apagada contesta 404 y es apagado", async () => {
    expect(await pedir(responder(404, { motivo: "no-existe" }))).toEqual({ error: "apagado" });
  });

  it("un 503 con motivo apagado es apagado y uno con altas-pausadas es altas-pausadas", async () => {
    expect(await pedir(responder(503, { motivo: "apagado", detalle: "config" }))).toEqual({ error: "apagado" });
    expect(await pedir(responder(503, { motivo: "altas-pausadas" }))).toEqual({ error: "altas-pausadas" });
  });

  it.each([
    [400, "forma"],
    [400, "puesto"],
    [401, "sesion"],
    [403, "sin-acceso"],
    [403, "sorteo-ajeno"],
    [403, "no-es-nuestro"],
    [403, "otra-app"],
    [409, "sin-sortear"],
    [409, "puesto-usado"],
    [409, "cuenta-de-otro"],
    [429, "cupo"],
    [502, "red"],
    [502, "pollar"],
  ] as const)("el %i con motivo %s es ese motivo", async (estado, motivo) => {
    expect(await pedir(responder(estado, { motivo }))).toEqual({ error: motivo });
  });

  it("un 401 sin motivo es sesion", async () => {
    expect(await pedir(responder(401, {}))).toEqual({ error: "sesion" });
  });

  it("intentos y cupo-ip traen cuándo reintentar", async () => {
    const t = 1_800_000_000_000;
    expect(await pedir(responder(429, { motivo: "intentos", reintentarEn: t }))).toEqual({ error: "intentos", reintentarEn: t });
    expect(await pedir(responder(429, { motivo: "cupo-ip", reintentarEn: t }))).toEqual({ error: "cupo-ip", reintentarEn: t });
  });

  it.each(["origen", "cuerpo", "metodo", "algo-nuevo"])("el motivo %s es red", async (motivo) => {
    expect(await pedir(responder(403, { motivo }))).toEqual({ error: "red" });
  });

  it("ya-tiene-acceso como error no existe: se lee como red", async () => {
    expect(await pedir(responder(409, { motivo: "ya-tiene-acceso" }))).toEqual({ error: "red" });
  });

  it("sin servicio (testnet) es apagado y sin llamar a nada", async () => {
    const { f, llamadas } = falso(() => responder(200, {}));
    expect(await admitirPorPremio(TOKEN, PEDIDO, { url: null, fetch: f })).toEqual({ error: "apagado" });
    expect(llamadas).toHaveLength(0);
  });

  it("con la red caída no lanza y dice red", async () => {
    const f = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await admitirPorPremio(TOKEN, PEDIDO, { url: URL, fetch: f })).toEqual({ error: "red" });
  });

  it("con un token vacío no llama a nada", async () => {
    const { f, llamadas } = falso(() => responder(200, {}));
    expect(await admitirPorPremio("  ", PEDIDO, { url: URL, fetch: f })).toEqual({ error: "sesion" });
    expect(llamadas).toHaveLength(0);
  });
});

describe("si el servicio atiende el alta de quien ganó", () => {
  it("lo lee de pagos.altaPremio de /cupo", async () => {
    const { f, llamadas } = falso(() => responder(200, { pagos: { premio: true, altaPremio: true } }));
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: f })).toBe(true);
    expect(llamadas[0]?.url).toBe(`${URL}/v1/patrocinio/cupo?cuenta=GABC`);
  });

  it("con pagos.altaPremio falso, sin el bloque o con otra respuesta, no está abierta", async () => {
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: falso(() => responder(200, { pagos: { altaPremio: false } })).f })).toBe(false);
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: falso(() => responder(200, {})).f })).toBe(false);
    expect(await altaPremioAbierta("GABC", { url: null })).toBe(false);
  });

  it("si no se pudo saber (un error del servicio, un corte o una respuesta rara), no dice apagada: dice que no sabe", async () => {
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: falso(() => responder(500, {})).f })).toBeNull();
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: falso(() => responder(503, { motivo: "apagado" })).f })).toBeNull();
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: falso(() => responder(200, [])).f })).toBeNull();
    const cortada = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await altaPremioAbierta("GABC", { url: URL, fetch: cortada })).toBeNull();
  });
});
