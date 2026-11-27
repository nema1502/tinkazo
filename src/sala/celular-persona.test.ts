import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anotarPersonaEnCampana,
  esLineaDePersona,
  leerAltaDePersona,
  miEstadoDePersona,
  resultadoDeCampanaDePersona,
  type CuerpoDeAltaDePersona,
} from "./celular-persona";
import { resultadoDeCampana, type AltaEnCampana } from "./campana";
import { fetchFalso, type Llamada, type Paso } from "./fetch-falso";

const SERVICIO = "https://servicio.example.org";
const SALA = "ABCDEFGH";
const GOOGLE = `eyJhbGciOiJSUzI1NiJ9.${"c".repeat(40)}.${"f".repeat(40)}`;
const CUERPO: CuerpoDeAltaDePersona = { google: GOOGLE, d: "D".repeat(40), llave: "L".repeat(22), p: "ABCDEFGHIJKL" };
const INICIO = 1_800_000_000_000;
const LINEA = "p1:aaaaaaaaaaaaaaaaaaaaaaaaaa";
const CUENTA = `G${"A".repeat(55)}`;

const error = (estado: number, motivo: string): Paso => ({ estado, cuerpo: { error: motivo } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(INICIO);
});

afterEach(() => {
  vi.useRealTimers();
});

async function alta(
  pasos: Paso[],
  cuerpo: CuerpoDeAltaDePersona = CUERPO,
): Promise<{ resultado: AltaEnCampana; llamadas: Llamada[]; avisos: string[] }> {
  const { f, llamadas } = fetchFalso(pasos);
  const avisos: string[] = [];
  const promesa = anotarPersonaEnCampana(SERVICIO, SALA, cuerpo, { fetch: f, azar: () => 0.5 }, (aviso) => avisos.push(aviso));
  await vi.advanceTimersByTimeAsync(300_000);
  return { resultado: await promesa, llamadas, avisos };
}

describe("esLineaDePersona", () => {
  it("acepta la línea con su única escritura y rechaza lo demás", () => {
    expect(esLineaDePersona(LINEA)).toBe(true);
    expect(esLineaDePersona(`p1:${"a".repeat(25)}b`)).toBe(false);
    expect(esLineaDePersona(`p1:${"A".repeat(26)}`)).toBe(false);
    expect(esLineaDePersona(CUENTA)).toBe(false);
    expect(esLineaDePersona(null)).toBe(false);
  });
});

describe("leerAltaDePersona: lo que contesta la sala", () => {
  it("201 con anotada es un alta nueva y 200 con ya es que ya estaba, sin cuenta ni línea", () => {
    expect(leerAltaDePersona(201, { anotada: true })).toEqual({ tipo: "listo", cuenta: "", ya: false });
    expect(leerAltaDePersona(200, { anotada: true, ya: true })).toEqual({ tipo: "listo", cuenta: "", ya: true });
  });

  it("un éxito mal formado no cuenta", () => {
    expect(leerAltaDePersona(201, {})).toEqual({ tipo: "final", motivo: "otro" });
    expect(leerAltaDePersona(200, { anotada: true })).toEqual({ tipo: "final", motivo: "otro" });
    expect(leerAltaDePersona(201, { anotada: true, ya: true })).toEqual({ tipo: "final", motivo: "otro" });
    expect(leerAltaDePersona(201, null)).toEqual({ tipo: "final", motivo: "otro" });
  });

  it("Google sin contestar se repite como cualquier falla pasajera", () => {
    expect(leerAltaDePersona(502, { error: "google" })).toMatchObject({ tipo: "otra-vez", alFinal: "proveedor" });
  });

  it("la sala con el modo apagado no se arregla esperando", () => {
    expect(leerAltaDePersona(503, { error: "personas-apagadas" })).toEqual({ tipo: "final", motivo: "apagada" });
  });

  it("el identificador de Google mal puesto en la sala tampoco se arregla esperando: dice que no abre desde acá", () => {
    expect(leerAltaDePersona(503, { error: "personas-configuracion" })).toEqual({ tipo: "final", motivo: "apagada" });
  });

  it("lo demás se lee como el alta de siempre", () => {
    expect(leerAltaDePersona(401, { error: "sesion" })).toEqual({ tipo: "final", motivo: "sesion" });
    expect(leerAltaDePersona(409, { error: "pase" })).toEqual({ tipo: "final", motivo: "pase" });
    expect(leerAltaDePersona(409, { error: "cerrada" })).toEqual({ tipo: "final", motivo: "cerro" });
    expect(leerAltaDePersona(409, { error: "quitada" })).toEqual({ tipo: "final", motivo: "quitada" });
    expect(leerAltaDePersona(429, { error: "llena" })).toEqual({ tipo: "final", motivo: "llena" });
    expect(leerAltaDePersona(429, { error: "cupo-conexion" })).toEqual({ tipo: "final", motivo: "wifi" });
    expect(leerAltaDePersona(429, { error: "rechazos" })).toEqual({ tipo: "final", motivo: "espera", porRechazos: true });
    expect(leerAltaDePersona(400, { error: "forma" })).toEqual({ tipo: "final", motivo: "sesion" });
    expect(leerAltaDePersona(429, { error: "rapido" })).toMatchObject({ tipo: "otra-vez", familia: "rapido" });
  });
});

describe("anotarPersonaEnCampana", () => {
  it("manda el token de Google, el nombre cifrado, la llave y el pase a la ruta del alta, y nada más", async () => {
    const { resultado, llamadas } = await alta([{ estado: 201, cuerpo: { anotada: true } }]);
    expect(resultado).toEqual({ ok: true, cuenta: "", ya: false });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/alta`);
    expect(llamadas[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ google: GOOGLE, d: CUERPO.d, llave: CUERPO.llave, p: CUERPO.p });
    // Sin cabecera de tipo: el pedido es simple y no necesita la consulta previa.
    expect(new Headers(llamadas[0]?.init.headers).has("content-type")).toBe(false);
  });

  it("Google caído una vez y bueno la siguiente: repite sola y avisa", async () => {
    const { resultado, llamadas, avisos } = await alta([error(502, "google"), { estado: 201, cuerpo: { anotada: true } }]);
    expect(resultado.ok).toBe(true);
    expect(llamadas).toHaveLength(2);
    expect(avisos).toEqual(["mucha"]);
  });

  it("Google caído siempre termina diciendo que no se pudo, con el tope de reintentos de siempre", async () => {
    const { resultado, llamadas } = await alta([error(502, "google")]);
    expect(resultado).toEqual({ ok: false, motivo: "proveedor" });
    expect(llamadas).toHaveLength(4);
  });

  it("un token rechazado termina enseguida, sin repetir", async () => {
    const { resultado, llamadas } = await alta([error(401, "sesion")]);
    expect(resultado).toEqual({ ok: false, motivo: "sesion" });
    expect(llamadas).toHaveLength(1);
  });

  it("el identificador mal puesto termina enseguida, sin repetir", async () => {
    const { resultado, llamadas } = await alta([error(503, "personas-configuracion")]);
    expect(resultado).toEqual({ ok: false, motivo: "apagada" });
    expect(llamadas).toHaveLength(1);
  });

  it("el modo apagado termina enseguida", async () => {
    const { resultado, llamadas } = await alta([error(503, "personas-apagadas")]);
    expect(resultado).toEqual({ ok: false, motivo: "apagada" });
    expect(llamadas).toHaveLength(1);
  });

  it("un pedido sin respuesta se repite una vez y un alta nueva que se perdió no se festeja de nuevo", async () => {
    const { resultado, llamadas } = await alta(["corte", { estado: 200, cuerpo: { anotada: true, ya: true } }]);
    expect(llamadas).toHaveLength(2);
    expect(resultado).toEqual({ ok: true, cuenta: "", ya: false });
  });
});

describe("anotarPersonaEnCampana: el permiso para guardar el perfil", () => {
  const DE_SIEMPRE = `{"google":"${GOOGLE}","d":"${CUERPO.d}","llave":"${CUERPO.llave}","p":"${CUERPO.p}"}`;
  const LISTO: Paso = { estado: 201, cuerpo: { anotada: true } };

  it("sin el permiso, el cuerpo es byte a byte el de siempre", async () => {
    const { llamadas } = await alta([LISTO]);
    expect(String(llamadas[0]?.init.body)).toBe(DE_SIEMPRE);
  });

  it("con el permiso suma perfil: true al final, y es lo único que cambia", async () => {
    const { resultado, llamadas } = await alta([LISTO], { ...CUERPO, perfil: true });
    expect(resultado).toEqual({ ok: true, cuenta: "", ya: false });
    expect(String(llamadas[0]?.init.body)).toBe(`${DE_SIEMPRE.slice(0, -1)},"perfil":true}`);
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/alta`);
    expect(new Headers(llamadas[0]?.init.headers).has("content-type")).toBe(false);
  });

  it("un permiso que no es el true exacto no viaja: el cuerpo es el de siempre", async () => {
    for (const valor of [false, "true", 1, null, undefined, {}]) {
      const cuerpo = { ...CUERPO, perfil: valor } as unknown as CuerpoDeAltaDePersona;
      const { llamadas } = await alta([LISTO], cuerpo);
      expect(String(llamadas[0]?.init.body), String(valor)).toBe(DE_SIEMPRE);
    }
  });

  it("el pedido que se repite lleva el mismo cuerpo, con su permiso", async () => {
    const { llamadas } = await alta([error(502, "google"), LISTO], { ...CUERPO, perfil: true });
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]?.init.body).toBe(llamadas[0]?.init.body);
    expect(String(llamadas[1]?.init.body)).toContain('"perfil":true');
  });
});

describe("miEstadoDePersona", () => {
  it("pregunta solo con la llave del celular y lee lo mismo que con una cuenta", async () => {
    const { f, llamadas } = fetchFalso([
      { estado: 200, cuerpo: { fase: "sorteada", total: 40, cierraMs: INICIO, anotada: true, gano: true, puesto: 0, ronda: 12, sorteo: "5" } },
    ]);
    const r = await miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: f });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ llave: CUERPO.llave });
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/yo`);
    expect(r).toMatchObject({ fase: "sorteada", total: 40, anotada: true, gano: true, ronda: 12, sorteo: "5" });
  });

  it("lee el código de entrega de quien ganó, y solo si son cuatro cifras", async () => {
    const base = { fase: "sorteada", total: 40, cierraMs: INICIO, anotada: true, gano: true, puesto: 1 };
    const con = async (codigo: unknown, resto: Record<string, unknown> = {}) =>
      miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: fetchFalso([{ estado: 200, cuerpo: { ...base, ...resto, codigo } }]).f });
    expect(await con("0421")).toMatchObject({ gano: true, codigo: "0421" });
    for (const malo of ["042", "04211", "12a4", " 421", 4211, null, ["0421"]]) expect(await con(malo)).not.toHaveProperty("codigo");
    // A quien no ganó no se le toma ningún código, aunque la respuesta lo traiga.
    expect(await con("0421", { gano: false })).not.toHaveProperty("codigo");
  });

  it("lee que quitaron a la persona y que no está anotada", async () => {
    const quitada = fetchFalso([{ estado: 200, cuerpo: { fase: "abierta", total: 3, cierraMs: INICIO, anotada: false, quitada: "pidio" } }]);
    expect(await miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: quitada.f })).toMatchObject({ anotada: false, quitada: "pidio" });
  });

  it("sin sala dice terminada, y con una falla dice red", async () => {
    expect(await miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: fetchFalso([error(404, "no-existe")]).f })).toBe("terminada");
    expect(await miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: fetchFalso([error(400, "forma")]).f })).toBe("red");
    expect(await miEstadoDePersona(SERVICIO, SALA, CUERPO.llave, { fetch: fetchFalso(["corte"]).f })).toBe("red");
  });
});

describe("resultadoDeCampanaDePersona", () => {
  const cuerpo = (ganadoras: unknown): Paso => ({ estado: 200, cuerpo: { sorteo: "5", ganadoras, comprobante: "/verificar.html?x=1" } });

  it("lee las líneas de las ganadoras y el comprobante", async () => {
    const { f, llamadas } = fetchFalso([cuerpo([LINEA])]);
    expect(await resultadoDeCampanaDePersona(SERVICIO, SALA, { fetch: f })).toEqual({ ganadoras: [LINEA], comprobante: "/verificar.html?x=1" });
    expect(llamadas[0]?.url).toBe(`${SERVICIO}/v1/sala/${SALA}/campana/resultado`);
  });

  it("no acepta cuentas entre las ganadoras de una campaña de personas, ni líneas entre las de una de cuentas", async () => {
    expect(await resultadoDeCampanaDePersona(SERVICIO, SALA, { fetch: fetchFalso([cuerpo([CUENTA])]).f })).toBe("red");
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([cuerpo([LINEA])]).f })).toBe("red");
    expect(await resultadoDeCampana(SERVICIO, SALA, { fetch: fetchFalso([cuerpo([CUENTA])]).f })).toEqual({
      ganadoras: [CUENTA],
      comprobante: "/verificar.html?x=1",
    });
  });

  it("antes del resultado da null", async () => {
    expect(await resultadoDeCampanaDePersona(SERVICIO, SALA, { fetch: fetchFalso([error(404, "sin-resultado")]).f })).toBeNull();
  });
});
