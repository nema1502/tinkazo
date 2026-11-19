import { describe, expect, it } from "vitest";
import { cuentaDePrueba } from "../campana/cuentas-de-prueba";
import {
  type SalaDeCampana,
  avisarEnSala,
  estadoConToken,
  guardarResultadoEnSala,
  leerOrganizadora,
  leerTodasLasAnotadas,
  ponerSellada,
  resultadoDeSala,
} from "./campana-org";

/**
 * Los pedidos que une la herramienta con la sala de una campaña: leer la lista completa, avisar el sello, avisar el
 * resultado y leerlo. Cada ruta, cuerpo y respuesta se comprueba contra lo que contesta la sala de verdad
 * (`workers/sala/src/index.ts`). Con un `fetch` de mentira, sin red ni reloj.
 */

const TOKEN = "T".repeat(22);
const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: TOKEN,
  clave: "C".repeat(22),
  vence: 1_900_000_000_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

interface Llamada {
  metodo: string;
  url: string;
  cuerpo: string | undefined;
  auth: string | undefined;
}
type Respuesta = Response | "caida";

/** Un `fetch` que contesta en orden lo que se le diga y anota cada llamada. */
function conFetch(respuestas: Respuesta[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({
      metodo: init?.method ?? "GET",
      url,
      cuerpo: init?.body === undefined ? undefined : String(init.body),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    });
    const r = respuestas.shift();
    if (r === undefined || r === "caida") throw new Error("sin red");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const json = (cuerpo: unknown, estado = 200, cabeceras: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras });
const vacia = (estado: number): Response => new Response(null, { status: estado });
const estadoDe = (fase: string, total: number, quitadas = 0): Response =>
  json({ fase, total, cierraMs: 5, pase: "sin", quitadas: { repetida: quitadas, evento: 0, pidio: 0, otro: 0 } });
const fila = (n: number, v: number): { n: number; cuenta: string; d: string; estado: string; v: number } => ({
  n,
  cuenta: cuentaDePrueba(n),
  d: "cifrado",
  estado: "aceptado",
  v,
});

describe("leer la lista completa de la sala", () => {
  it("lee de a una vuelta con la versión más alta hasta una vacía y compara con el total", async () => {
    const m = conFetch([estadoDe("cerrada", 3), json([fila(1, 1), fila(2, 2)]), json([fila(3, 3)]), json([]), estadoDe("cerrada", 3), json([])]);
    const r = await leerTodasLasAnotadas(SALA, { fetch: m.fetch });
    expect(r?.map((f) => f.n)).toEqual([1, 2, 3]);
    expect(m.llamadas.map((l) => l.url.replace("https://s.tinkazo.app/v1/sala/AbCd1234", ""))).toEqual([
      "/campana/estado",
      "/equipos?desde=0",
      "/equipos?desde=2",
      "/equipos?desde=3",
      "/campana/estado",
      "/equipos?desde=3",
    ]);
    expect(m.llamadas.every((l) => l.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("lee 250 personas en dos vueltas de 200 y 50", async () => {
    const primera = Array.from({ length: 200 }, (_, i) => fila(i + 1, i + 1));
    const segunda = Array.from({ length: 50 }, (_, i) => fila(i + 201, i + 201));
    const m = conFetch([estadoDe("cerrada", 250), json(primera), json(segunda), json([]), estadoDe("cerrada", 250), json([])]);
    expect((await leerTodasLasAnotadas(SALA, { fetch: m.fetch }))?.length).toBe(250);
  });

  it("si la sala dice 251 y se leyeron 250, no devuelve nada", async () => {
    const primera = Array.from({ length: 200 }, (_, i) => fila(i + 1, i + 1));
    const segunda = Array.from({ length: 50 }, (_, i) => fila(i + 201, i + 201));
    const m = conFetch([estadoDe("cerrada", 251), json(primera), json(segunda), json([]), estadoDe("cerrada", 251), json([])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("con la sala abierta no lee ninguna vuelta", async () => {
    const m = conFetch([estadoDe("abierta", 3)]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
    expect(m.llamadas).toHaveLength(1);
  });

  it("si entre las páginas se quitó a alguien, el estado de después no coincide y no pasa", async () => {
    const m = conFetch([estadoDe("cerrada", 2, 0), json([fila(1, 1), fila(2, 2)]), json([]), estadoDe("cerrada", 2, 1)]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("si entre las páginas alguien volvió a abrir y la fase cambió, no pasa", async () => {
    const m = conFetch([estadoDe("cerrada", 2), json([fila(1, 1), fila(2, 2)]), json([]), estadoDe("abierta", 2)]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("si la última página no viene vacía, no pasa", async () => {
    const m = conFetch([estadoDe("cerrada", 1), json([fila(1, 1)]), json([]), estadoDe("cerrada", 1), json([fila(2, 2)])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("una fila con una cuenta que no tiene forma de cuenta hace fallar la lectura", async () => {
    const mala = { ...fila(1, 1), cuenta: `G${"B".repeat(55)}` };
    const m = conFetch([estadoDe("cerrada", 1), json([mala])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("con la red caída en cualquier pedido no devuelve nada ni lanza", async () => {
    expect(await leerTodasLasAnotadas(SALA, { fetch: conFetch(["caida"]).fetch })).toBeNull();
    expect(await leerTodasLasAnotadas(SALA, { fetch: conFetch([estadoDe("cerrada", 1), "caida"]).fetch })).toBeNull();
  });

  it("el estado con token suma las quitadas por motivo", async () => {
    const m = conFetch([estadoDe("cerrada", 4, 2)]);
    expect(await estadoConToken(SALA, { fetch: m.fetch })).toEqual({ fase: "cerrada", total: 4, cierraMs: 5, quitadas: 2 });
  });
});

describe("avisar que quedó sellada", () => {
  it("manda la fase sellada con el número como texto y el token", async () => {
    const m = conFetch([vacia(204)]);
    expect((await ponerSellada(SALA, "777", { fetch: m.fetch })).r).toBe("ok");
    expect(m.llamadas[0]).toMatchObject({ metodo: "PUT", auth: `Bearer ${TOKEN}`, cuerpo: '{"fase":"sellada","sorteo":"777"}' });
    expect(m.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234/campana/fase");
  });

  it.each([
    [409, "fase", "fase"],
    [409, "ronda-pasada", "ronda-pasada"],
    [409, "lista-distinta", "lista-distinta"],
    [409, "ganadores-distintos", "ganadores-distintos"],
    [409, "organizador-distinto", "organizador-distinto"],
    [409, "sin-sorteo", "sin-sorteo"],
    [404, "no-existe", "no-existe"],
    [403, "token", "token"],
    [400, "forma", "forma"],
    [502, "red", "red"],
    [500, "otra-cosa", "red"],
  ] as const)("el %i con motivo %s se lee como %s", async (estado, motivo, esperado) => {
    const m = conFetch([json({ error: motivo }, estado)]);
    expect((await ponerSellada(SALA, "1", { fetch: m.fetch })).r).toBe(esperado);
  });

  it("sin respuesta se cuenta como red y no lanza", async () => {
    expect((await ponerSellada(SALA, "1", { fetch: conFetch(["caida"]).fetch })).r).toBe("red");
  });

  it("lee la hora de la sala de la cabecera Date, si se puede leer", async () => {
    const m = conFetch([new Response(null, { status: 204, headers: { Date: "Sat, 21 Nov 2026 18:00:00 GMT" } })]);
    expect((await ponerSellada(SALA, "1", { fetch: m.fetch })).horaSala).toBe(Date.UTC(2026, 10, 21, 18, 0, 0));
  });

  it("sin la cabecera Date la hora de la sala es null", async () => {
    expect((await ponerSellada(SALA, "1", { fetch: conFetch([vacia(204)]).fetch })).horaSala).toBeNull();
  });
});

describe("avisar y leer el resultado", () => {
  it("manda el número y el comprobante sin dominio", async () => {
    const m = conFetch([vacia(204)]);
    expect(await guardarResultadoEnSala(SALA, "777", "/verificar.html#abc", { fetch: m.fetch })).toBe("ok");
    expect(m.llamadas[0]).toMatchObject({ metodo: "PUT", cuerpo: '{"sorteo":"777","comprobante":"/verificar.html#abc"}' });
    expect(m.llamadas[0]?.url).toBe("https://s.tinkazo.app/v1/sala/AbCd1234/campana/resultado");
  });

  it.each([
    [409, "sin-resultado", "sin-resultado"],
    [409, "fase", "fase"],
    [409, "distinto", "distinto"],
    [404, "no-existe", "no-existe"],
    [403, "token", "token"],
    [400, "forma", "forma"],
    [502, "red", "red"],
  ] as const)("el %i con motivo %s del resultado se lee como %s", async (estado, motivo, esperado) => {
    const m = conFetch([json({ error: motivo }, estado)]);
    expect(await guardarResultadoEnSala(SALA, "1", "/verificar.html", { fetch: m.fetch })).toBe(esperado);
  });

  it("lee el resultado con las ganadoras en orden de puesto y sin token", async () => {
    const m = conFetch([json({ sorteo: "777", ganadoras: [cuentaDePrueba(2), cuentaDePrueba(1)], comprobante: "/verificar.html" })]);
    const r = await resultadoDeSala(SALA, { fetch: m.fetch });
    expect(r).toEqual({ sorteo: "777", ganadoras: [cuentaDePrueba(2), cuentaDePrueba(1)], comprobante: "/verificar.html" });
    expect(m.llamadas[0]?.auth).toBeUndefined();
  });

  it("en la lectura, un 404 con sin-resultado es sin-resultado y cualquier otro es no-existe", async () => {
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ error: "sin-resultado" }, 404)]).fetch })).toBe("sin-resultado");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ error: "no-existe" }, 404)]).fetch })).toBe("no-existe");
  });

  it("una ganadora sin forma de cuenta o un cuerpo raro se leen como red", async () => {
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ sorteo: "1", ganadoras: ["x"], comprobante: "/v" })]).fetch })).toBe("red");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([json({ nada: 1 })]).fetch })).toBe("red");
    expect(await resultadoDeSala(SALA, { fetch: conFetch(["caida"]).fetch })).toBe("red");
  });

  it("avisar a una ganadora manda su cuenta con el token", async () => {
    const m = conFetch([vacia(204)]);
    expect(await avisarEnSala(SALA, cuentaDePrueba(1), { fetch: m.fetch })).toBe("ok");
    expect(m.llamadas[0]).toMatchObject({ metodo: "POST", auth: `Bearer ${TOKEN}`, cuerpo: JSON.stringify({ cuenta: cuentaDePrueba(1) }) });
  });

  it("avisar a quien no ganó dice no-gano y sin respuesta dice red", async () => {
    expect(await avisarEnSala(SALA, cuentaDePrueba(1), { fetch: conFetch([json({ error: "no-gano" }, 400)]).fetch })).toBe("no-gano");
    expect(await avisarEnSala(SALA, cuentaDePrueba(1), { fetch: conFetch(["caida"]).fetch })).toBe("red");
  });
});

describe("la cuenta que la campaña nombra para sellar", () => {
  const archivo = (texto: unknown): Response => json({ texto: JSON.stringify(texto), firma: "F" });

  it("la lee del texto firmado", async () => {
    const m = conFetch([archivo({ organizadora: cuentaDePrueba(5) })]);
    expect(await leerOrganizadora(SALA, { fetch: m.fetch })).toBe(cuentaDePrueba(5));
  });

  it("sin el campo no hay organizadora", async () => {
    expect(await leerOrganizadora(SALA, { fetch: conFetch([archivo({ evento: "x" })]).fetch })).toBeNull();
  });

  it("con un campo que no es una cuenta, o sin red, no se decide", async () => {
    expect(await leerOrganizadora(SALA, { fetch: conFetch([archivo({ organizadora: "hola" })]).fetch })).toBe("rechazo");
    expect(await leerOrganizadora(SALA, { fetch: conFetch(["caida"]).fetch })).toBe("red");
  });
});
