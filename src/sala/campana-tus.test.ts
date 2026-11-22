import { describe, expect, it } from "vitest";
import {
  type MotivoDeRecuperar,
  type MotivoDeTus,
  PLAZO_DE_TUS_MS,
  guardarOrg,
  leerOrg,
  misCampanas,
  recuperarCampana,
  salaTieneTusCampanas,
} from "./campana-org";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";

/**
 * El cliente de Tus campañas contra un `fetch` de mentira: la ruta, el cuerpo, que la sesión no vaya a ningún lado más que al
 * cuerpo, cada respuesta con su motivo y que una ruta que todavía no existe se lea como una función que no está.
 */

const SERVICIO = "https://s.test";
const SESION = "token-de-la-sesion-de-prueba";
const EVENTO = "flor-k3f9-2026-11-21-1400";
const TOKEN = "T".repeat(22);
const FIRMA = "F".repeat(86);
const TEXTO = '{"v":1,"evento":"flor-k3f9-2026-11-21-1400"}';

interface Llamada {
  url: string;
  init: RequestInit;
}

function conRespuesta(estado: number, cuerpo?: unknown, textoPlano = false): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    const dicho = cuerpo === undefined ? null : textoPlano ? String(cuerpo) : JSON.stringify(cuerpo);
    return new Response(dicho, { status: estado });
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

/** Un `fetch` que falla como falla un 404 sin permisos de origen o una red caída: el navegador lo ve como una falla de red. */
const sinRed = { fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch };

const fila = (cambios: Record<string, unknown> = {}): Record<string, unknown> => ({
  evento: EVENTO,
  empresa: "Flor de Tarija",
  zona: "America/La_Paz",
  abreMs: 1_764_340_200_000,
  cierraMs: 1_764_351_000_000,
  sorteoMs: 1_764_352_800_000,
  estado: "activada",
  ...cambios,
});

describe("mis campañas: el pedido", () => {
  it("manda solo la sesión, en el cuerpo, a la ruta de la lista y sin cabeceras de autorización", async () => {
    const x = conRespuesta(200, { campanas: [] });
    await misCampanas(SESION, { fetch: x.fetch }, SERVICIO);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/mis-campanas`);
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual({ sesion: SESION });
    expect(JSON.stringify(x.llamadas[0]?.init.headers)).not.toContain(SESION);
  });

  it("espera hasta 15 segundos", async () => {
    expect(PLAZO_DE_TUS_MS).toBe(15_000);
    const x = conRespuesta(200, { campanas: [] });
    let plazo = 0;
    await misCampanas(SESION, { fetch: x.fetch, senal: () => ((plazo++), AbortSignal.timeout(1_000)) }, SERVICIO);
    expect(plazo).toBe(1);
  });

  it("una cuenta sin campañas recibe la lista vacía", async () => {
    const r = await misCampanas(SESION, { fetch: conRespuesta(200, { campanas: [] }).fetch }, SERVICIO);
    expect(r).toEqual({ ok: true, campanas: [] });
  });

  it("devuelve cada campaña con lo que dice la sala, y la viva con su fase y su total", async () => {
    const cuerpo = { campanas: [fila({ estado: "viva", fase: "abierta", total: 37 }), fila({ evento: "otra-k3f9", estado: "terminada" })] };
    const r = await misCampanas(SESION, { fetch: conRespuesta(200, cuerpo).fetch }, SERVICIO);
    expect(r.ok && r.campanas.map((c) => [c.evento, c.estado, c.fase, c.total])).toEqual([
      [EVENTO, "viva", "abierta", 37],
      ["otra-k3f9", "terminada", undefined, undefined],
    ]);
  });

  it("descarta las filas con una zona inventada, un campo de otra forma o una fase que no existe, y deja las demás", async () => {
    const cuerpo = {
      campanas: [
        fila({ evento: "mala-zona-k3f9", zona: "Marte/Olympus" }),
        fila({ evento: "sin-empresa-k3f9", empresa: "  " }),
        fila({ evento: "hora-texto-k3f9", abreMs: "ayer" }),
        fila({ evento: "estado-raro-k3f9", estado: "borrada" }),
        fila({ evento: "viva-sin-fase-k3f9", estado: "viva" }),
        fila({ evento: "viva-fase-rara-k3f9", estado: "viva", fase: "dormida" }),
        fila({ evento: "total-raro-k3f9", estado: "viva", fase: "abierta", total: -1 }),
        fila({ evento: "Evento Malo" }),
        "no es una fila",
        fila(),
      ],
    };
    const r = await misCampanas(SESION, { fetch: conRespuesta(200, cuerpo).fetch }, SERVICIO);
    expect(r.ok && r.campanas.map((c) => c.evento)).toEqual([EVENTO]);
  });

  it("no repite un evento y no lee más de 20 filas", async () => {
    const muchas = Array.from({ length: 30 }, (_, i) => fila({ evento: `evento-${String(i).padStart(2, "0")}-k3f9` }));
    const r = await misCampanas(SESION, { fetch: conRespuesta(200, { campanas: [fila(), fila(), ...muchas] }).fetch }, SERVICIO);
    expect(r.ok && r.campanas).toHaveLength(20);
    expect(r.ok && new Set(r.campanas.map((c) => c.evento)).size).toBe(20);
  });

  it("una respuesta buena sin la lista, o con otra cosa, no es una lista", async () => {
    for (const cuerpo of [{}, { campanas: "ninguna" }, [], null]) {
      const r = await misCampanas(SESION, { fetch: conRespuesta(200, cuerpo).fetch }, SERVICIO);
      expect(r).toEqual({ ok: false, motivo: "sin-funcion" });
    }
  });

  it.each<[number, string, MotivoDeTus]>([
    [401, "sesion", "sesion"],
    [403, "no-google", "no-google"],
    [409, "sin-billetera", "sin-billetera"],
    [429, "cupo-cuenta", "limite"],
    [429, "cupo-conexion", "limite"],
    [429, "rechazos", "limite"],
    [400, "forma", "forma"],
  ])("el %i %s se lee como %s", async (estado, error, motivo) => {
    const r = await misCampanas(SESION, { fetch: conRespuesta(estado, { error }).fetch }, SERVICIO);
    expect(r).toEqual({ ok: false, motivo });
  });

  it("una sala sin la ruta se lee como una función que no está: el 404 de texto plano, el 503 apagada, el 502 y la falla de red", async () => {
    const sinLaRuta = [
      conRespuesta(404, "no encontrada", true).fetch,
      conRespuesta(404, { error: "no-existe" }).fetch,
      conRespuesta(503, { error: "apagada" }).fetch,
      conRespuesta(503, { error: "sin-pollar" }).fetch,
      conRespuesta(502, { error: "red" }).fetch,
      conRespuesta(500).fetch,
      sinRed.fetch,
    ];
    for (const f of sinLaRuta) expect(await misCampanas(SESION, { fetch: f }, SERVICIO)).toEqual({ ok: false, motivo: "sin-funcion" });
  });

  it("un pedido que no contesta a tiempo se lee como sin la función", async () => {
    const colgado = ((_u: string, init: RequestInit) =>
      new Promise((_s, no) => (init.signal as AbortSignal).addEventListener("abort", () => no(new DOMException("tarde", "TimeoutError"))))) as unknown as typeof fetch;
    const r = await misCampanas(SESION, { fetch: colgado, senal: () => AbortSignal.timeout(20) }, SERVICIO);
    expect(r).toEqual({ ok: false, motivo: "sin-funcion" });
  });
});

describe("si la sala tiene Tus campañas, antes de ofrecerla", () => {
  it("manda el cuerpo vacío a la ruta de la lista, sin ninguna sesión, y con 400 forma dice que sí", async () => {
    const x = conRespuesta(400, { error: "forma", campo: "sesion" });
    expect(await salaTieneTusCampanas({ fetch: x.fetch }, SERVICIO)).toBe(true);
    expect(x.llamadas).toHaveLength(1);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/mis-campanas`);
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual({});
  });

  it("una sala sin la función dice que no: el 404 con cuerpo, el 503 apagada o cualquier otra respuesta", async () => {
    expect(await salaTieneTusCampanas({ fetch: conRespuesta(404, { error: "no-existe" }).fetch }, SERVICIO)).toBe(false);
    expect(await salaTieneTusCampanas({ fetch: conRespuesta(503, { error: "apagada" }).fetch }, SERVICIO)).toBe(false);
    expect(await salaTieneTusCampanas({ fetch: conRespuesta(200, { campanas: [] }).fetch }, SERVICIO)).toBe(false);
    expect(await salaTieneTusCampanas({ fetch: conRespuesta(400, "Bad Request", true).fetch }, SERVICIO)).toBe(false);
    expect(await salaTieneTusCampanas({ fetch: conRespuesta(400, { error: "otra-cosa" }).fetch }, SERVICIO)).toBe(false);
  });

  it("sin respuesta (el 404 de texto plano sin permisos de origen, o la red caída) no se sabe: vuelve null para poder preguntar de nuevo", async () => {
    expect(await salaTieneTusCampanas(sinRed, SERVICIO)).toBeNull();
  });

  it("espera hasta 15 segundos", async () => {
    let plazo = 0;
    await salaTieneTusCampanas({ fetch: conRespuesta(400, { error: "forma" }).fetch, senal: () => ((plazo++), AbortSignal.timeout(1_000)) }, SERVICIO);
    expect(plazo).toBe(1);
  });
});

describe("usar una campaña en esta compu: el pedido", () => {
  it("manda la sesión y el evento en el cuerpo, a la ruta de recuperar", async () => {
    const x = conRespuesta(404, { error: "no-existe" });
    await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: x.fetch }, SERVICIO);
    expect(x.llamadas[0]?.url).toBe(`${SERVICIO}/v1/campana/recuperar`);
    expect(x.llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(x.llamadas[0]?.init.body))).toEqual({ sesion: SESION, evento: EVENTO });
    expect(JSON.stringify(x.llamadas[0]?.init.headers)).not.toContain(SESION);
  });

  it("con la sala viva trae su id, su token nuevo y la fase, y dice de qué sala de campañas salió", async () => {
    const cuerpo = { estado: "viva", id: "Ab3dEf7h", token: TOKEN, vence: 1_764_400_000_000, fase: "abierta" };
    const r = await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(200, cuerpo).fetch }, SERVICIO);
    expect(r).toEqual({ ok: true, estado: "viva", sala: { id: "Ab3dEf7h", token: TOKEN, vence: 1_764_400_000_000, servicio: SERVICIO }, fase: "abierta" });
  });

  it("con la campaña activada trae el archivo firmado, y el token anterior solo si la sala de antes murió", async () => {
    const sin = await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(200, { estado: "activada", texto: TEXTO, firma: FIRMA }).fetch }, SERVICIO);
    expect(sin).toEqual({ ok: true, estado: "activada", archivo: { texto: TEXTO, firma: FIRMA }, anterior: null });
    const con = await recuperarCampana(
      { sesion: SESION, evento: EVENTO },
      { fetch: conRespuesta(200, { estado: "activada", texto: TEXTO, firma: FIRMA, anterior: TOKEN }).fetch },
      SERVICIO,
    );
    expect(con).toEqual({ ok: true, estado: "activada", archivo: { texto: TEXTO, firma: FIRMA }, anterior: TOKEN });
  });

  it("una respuesta buena mal formada no se usa", async () => {
    const malas = [
      { estado: "viva", id: "corto", token: TOKEN, vence: 1, fase: "abierta" },
      { estado: "viva", id: "Ab3dEf7h", token: "corto", vence: 1, fase: "abierta" },
      { estado: "viva", id: "Ab3dEf7h", token: TOKEN, vence: "mañana", fase: "abierta" },
      { estado: "viva", id: "Ab3dEf7h", token: TOKEN, vence: 1, fase: "dormida" },
      { estado: "activada", texto: "", firma: FIRMA },
      { estado: "activada", texto: TEXTO, firma: "corta" },
      { estado: "activada", texto: TEXTO, firma: FIRMA, anterior: "corto" },
      { estado: "otra" },
      {},
    ];
    for (const cuerpo of malas) {
      expect(await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(200, cuerpo).fetch }, SERVICIO)).toEqual({ ok: false, motivo: "red" });
    }
  });

  it.each<[number, string, MotivoDeRecuperar]>([
    [404, "no-existe", "no-existe"],
    [409, "terminada", "terminada"],
    [409, "sellada", "sellada"],
    [409, "ocupado", "ocupado"],
    [409, "sin-billetera", "sin-billetera"],
    [429, "pausa", "limite"],
    [429, "cupo-cuenta", "limite"],
    [429, "cupo-conexion", "limite"],
    [401, "sesion", "sesion"],
    [403, "no-google", "no-google"],
    [400, "forma", "forma"],
    [502, "red", "red"],
    [503, "ocupado", "red"],
  ])("el %i %s se lee como %s", async (estado, error, motivo) => {
    const r = await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(estado, { error }).fetch }, SERVICIO);
    expect(r).toEqual({ ok: false, motivo });
  });

  it("una sala sin la ruta no rompe nada: el 404 de texto plano y el 503 apagada se leen como sin la función, y la falla de red como red", async () => {
    expect(await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(404, "no encontrada", true).fetch }, SERVICIO)).toEqual({ ok: false, motivo: "sin-funcion" });
    expect(await recuperarCampana({ sesion: SESION, evento: EVENTO }, { fetch: conRespuesta(503, { error: "apagada" }).fetch }, SERVICIO)).toEqual({ ok: false, motivo: "sin-funcion" });
    expect(await recuperarCampana({ sesion: SESION, evento: EVENTO }, sinRed, SERVICIO)).toEqual({ ok: false, motivo: "red" });
  });
});

describe("lo que recuerda la compu de una campaña tomada", () => {
  const almacen = (): Storage => {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
  };

  it("la marca recuperada se guarda y se lee, y sin ella no aparece", () => {
    const a = almacen();
    const cuenta = cuentaDePrueba(3);
    const sala = { id: "Ab3dEf7h", token: TOKEN, clave: "C".repeat(22), vence: 2_000, servicio: "https://s.tinkazo.app", evento: EVENTO, red: "mainnet" as const };
    guardarOrg(a, { sala, fase: "abierta", cuenta, recuperada: true });
    expect(leerOrg(a, 1_000, "mainnet", cuenta)?.recuperada).toBe(true);
    guardarOrg(a, { sala, fase: "abierta", cuenta });
    expect(leerOrg(a, 1_000, "mainnet", cuenta)?.recuperada).toBeUndefined();
  });
});
