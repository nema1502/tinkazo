import { describe, expect, it } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import { type MotivoDeActivar, activarCampana, salaPuedeActivar } from "./campana-org";

/**
 * El pedido de activar una campaña contra un `fetch` de mentira: la ruta, el cuerpo, cada respuesta de la sala por su
 * motivo y que el token de la sesión no vaya a ningún lado más que al cuerpo. Sin red ni reloj.
 */

const SERVICIO = "https://s.test";
const SESION = "token-de-la-sesion-de-prueba";
const TEXTO = '{"v":1,"evento":"flor-k3f9-2026-11-21-1400"}';
const CUENTA = cuentaDePrueba(5);
const FIRMA_B64 = "F".repeat(86);

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

const buena = { texto: TEXTO, firma: FIRMA_B64, evento: "flor-k3f9-2026-11-21-1400", organizadora: CUENTA };

describe("activar la campaña", () => {
  it("manda el texto y la sesión en el cuerpo, a la ruta de activar y sin cabeceras de autorización", async () => {
    const x = conRespuesta(200, buena);
    await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/activar`);
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual({ texto: TEXTO, sesion: SESION });
    expect(JSON.stringify(x.llamadas[0]?.init.headers)).not.toContain(SESION);
  });

  it("con la respuesta buena devuelve el archivo firmado, el evento y la cuenta", async () => {
    const x = conRespuesta(200, buena);
    const r = await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO);
    expect(r).toEqual({ ok: true, archivo: { texto: TEXTO, firma: FIRMA_B64 }, evento: buena.evento, organizadora: CUENTA });
  });

  it("acepta también la firma en hexadecimal de 128 caracteres y la pasa tal cual", async () => {
    const hex = "ab".repeat(64);
    const x = conRespuesta(200, { ...buena, firma: hex });
    const r = await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO);
    expect(r.ok && r.archivo.firma).toBe(hex);
  });

  it.each<[number, string, MotivoDeActivar]>([
    [400, "forma", "forma"],
    [400, "red", "red-principal"],
    [401, "sesion", "sesion"],
    [403, "no-google", "no-google"],
    [403, "organizadora", "organizadora"],
    [402, "no-pagada", "no-pagada"],
    [402, "sin-fondos", "sin-fondos"],
    [502, "red", "red"],
    [502, "acceso", "acceso"],
    [503, "apagada", "apagada"],
    [503, "sin-llave", "sin-llave"],
    [503, "sin-pollar", "sin-pollar"],
  ])("el %i con %s se cuenta como %s", async (estado, error, motivo) => {
    const x = conRespuesta(estado, { error });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo });
  });

  it("un 429 es el límite, diga lo que diga", async () => {
    const x = conRespuesta(429, { error: "lo-que-sea" });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "limite" });
  });

  it("la forma trae el campo que la sala dijo", async () => {
    const x = conRespuesta(400, { error: "forma", campo: "premios" });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "forma", campo: "premios" });
  });

  it("un error que la sala no usa para esto es sin respuesta", async () => {
    const x = conRespuesta(500, { error: "raro" });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "sin-respuesta" });
  });

  it("sin red o con la conexión cortada es sin respuesta", async () => {
    const cortado = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: cortado }, SERVICIO)).toEqual({ ok: false, motivo: "sin-respuesta" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["sin firma", { ...buena, firma: undefined }],
    ["con una firma que no es firma", { ...buena, firma: "corta" }],
    ["con un evento que no es un evento", { ...buena, evento: "X" }],
    ["con una cuenta que no es cuenta", { ...buena, organizadora: "nadie" }],
    ["sin texto", { ...buena, texto: 5 }],
  ])("una respuesta buena %s no se acepta", async (_nombre, cuerpo) => {
    const x = conRespuesta(200, cuerpo);
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "sin-respuesta" });
  });

  it("el plazo es el que dice la prueba: con la señal cortada, sin respuesta", async () => {
    const x = conRespuesta(200, buena);
    const cortada = (): AbortSignal => AbortSignal.abort();
    const f = (async (url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new Error("cortada");
      return x.fetch(url, init);
    }) as unknown as typeof fetch;
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: f, senal: cortada }, SERVICIO)).toEqual({ ok: false, motivo: "sin-respuesta" });
  });

  it("el 503 sin-portero se cuenta como apagada", async () => {
    const x = conRespuesta(503, { error: "sin-portero" });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "apagada" });
  });

  it("el 503 personas-apagadas de una campaña de personas se cuenta como apagada", async () => {
    const x = conRespuesta(503, { error: "personas-apagadas" });
    expect(await activarCampana({ texto: TEXTO, sesion: SESION }, { fetch: x.fetch }, SERVICIO)).toEqual({ ok: false, motivo: "apagada" });
  });
});

describe("preguntar antes de cobrar si la sala puede activar", () => {
  it("manda el cuerpo vacío a la ruta de activar y con 400 forma dice que sí", async () => {
    const x = conRespuesta(400, { error: "forma", campo: "texto" });
    expect(await salaPuedeActivar({ fetch: x.fetch }, SERVICIO)).toBe(true);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/activar`);
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(x.llamadas[0]?.init.body).toBe("{}");
  });

  it.each<[number, unknown]>([
    [503, { error: "apagada" }],
    [503, { error: "sin-llave" }],
    [503, { error: "sin-portero" }],
    [404, { error: "no-existe" }],
    [400, { error: "red" }],
    [200, { texto: "{}", firma: "F".repeat(86) }],
    [500, undefined],
  ])("con %i y %j dice que no", async (estado, cuerpo) => {
    expect(await salaPuedeActivar({ fetch: conRespuesta(estado, cuerpo).fetch }, SERVICIO)).toBe(false);
  });

  it("sin red dice que no", async () => {
    const cortado = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    expect(await salaPuedeActivar({ fetch: cortado }, SERVICIO)).toBe(false);
  });
});
