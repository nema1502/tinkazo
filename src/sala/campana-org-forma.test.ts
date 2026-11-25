import { describe, expect, it } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "../campana/cuentas-de-prueba";
import { type SalaDeCampana, leerTodasLasAnotadas, resultadoDeSala } from "./campana-org";

/**
 * La lista y el resultado de la sala se leen por la forma de sus datos: toda de cuentas o toda de líneas de persona. Una
 * lista con líneas de persona junto a cuentas, o a otra cosa, es mezclada y no se sortea. Una fila que no es una cuenta,
 * sin ninguna línea de persona, sigue siendo lo que era: no se lee. Con un `fetch` de mentira, sin red ni reloj.
 */

const SALA: SalaDeCampana = {
  id: "AbCd1234",
  token: "T".repeat(22),
  clave: "C".repeat(22),
  vence: 1_900_000_000_000,
  servicio: "https://s.tinkazo.app",
  evento: "evento-uno",
  red: "testnet",
};

interface Llamada {
  ruta: string;
}

/** Un `fetch` que contesta en orden lo que se le diga y anota cada ruta. Sin respuesta que dar, la red cae. */
function conFetch(respuestas: Response[]): { fetch: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const f = (async (url: string) => {
    llamadas.push({ ruta: url.replace("https://s.tinkazo.app/v1/sala/AbCd1234", "") });
    const r = respuestas.shift();
    if (r === undefined) throw new Error("sin red");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, llamadas };
}

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });
const estadoDe = (total: number): Response =>
  json({ fase: "cerrada", total, cierraMs: 5, pase: "sin", quitadas: { repetida: 0, evento: 0, pidio: 0, otro: 0 } });
const fila = (n: number, cuenta: unknown, v = n): Record<string, unknown> => ({ n, cuenta, d: "cifrado", estado: "aceptado", v });

/** Las respuestas de una lectura completa y estable de las filas dadas, en una sola vuelta. */
const lecturaDe = (filas: Record<string, unknown>[]): Response[] => [
  estadoDe(filas.length),
  json(filas),
  json([]),
  estadoDe(filas.length),
  json([]),
];

const DOS_PERSONAS = [lineaDePrueba(1), lineaDePrueba(2)];
const SIN_FINAL_DE_CONTROL = `G${"B".repeat(55)}`;

describe("leerTodasLasAnotadas con la forma de la lista", () => {
  it("una lista toda de líneas de persona se lee igual que una de cuentas, con los mismos pedidos", async () => {
    const deCuentas = conFetch(lecturaDe([fila(1, cuentaDePrueba(1)), fila(2, cuentaDePrueba(2))]));
    const dePersonas = conFetch(lecturaDe(DOS_PERSONAS.map((l, i) => fila(i + 1, l))));
    const cuentas = await leerTodasLasAnotadas(SALA, { fetch: deCuentas.fetch });
    const personas = await leerTodasLasAnotadas(SALA, { fetch: dePersonas.fetch });
    expect(personas).not.toBe("mezclada");
    expect(personas).not.toBeNull();
    expect((personas as { cuenta: string }[]).map((f) => f.cuenta)).toEqual(DOS_PERSONAS);
    expect((cuentas as { cuenta: string }[]).map((f) => f.cuenta)).toEqual([cuentaDePrueba(1), cuentaDePrueba(2)]);
    expect(dePersonas.llamadas).toEqual(deCuentas.llamadas);
  });

  it("una línea de persona entre cuentas da mezclada, y solo al final de una lectura estable", async () => {
    const m = conFetch(lecturaDe([fila(1, cuentaDePrueba(1)), fila(2, lineaDePrueba(1)), fila(3, cuentaDePrueba(3))]));
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBe("mezclada");
    expect(m.llamadas.map((l) => l.ruta)).toEqual(["/campana/estado", "/equipos?desde=0", "/equipos?desde=3", "/campana/estado", "/equipos?desde=3"]);
  });

  it("una línea de persona junto a una fila que no es nada también da mezclada", async () => {
    const m = conFetch(lecturaDe([fila(1, lineaDePrueba(1)), fila(2, "hola")]));
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBe("mezclada");
  });

  it("una mezcla repartida en dos vueltas también da mezclada", async () => {
    const m = conFetch([
      estadoDe(3),
      json([fila(1, cuentaDePrueba(1)), fila(2, cuentaDePrueba(2))]),
      json([fila(3, lineaDePrueba(1))]),
      json([]),
      estadoDe(3),
      json([]),
    ]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBe("mezclada");
  });

  it("una mezcla que se movió mientras se leía no se declara: da null, para volver a leer", async () => {
    const m = conFetch([estadoDe(2), json([fila(1, cuentaDePrueba(1)), fila(2, lineaDePrueba(1))]), json([]), estadoDe(3), json([])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
  });

  it("una cuenta mal formada sin líneas de persona sigue sin leerse, y no pide nada más que la primera vuelta", async () => {
    const m = conFetch([estadoDe(2), json([fila(1, SIN_FINAL_DE_CONTROL), fila(2, cuentaDePrueba(2))])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
    expect(m.llamadas.map((l) => l.ruta)).toEqual(["/campana/estado", "/equipos?desde=0"]);
  });

  it("una fila rara que llega después de unas cuentas, en otra vuelta, corta la lectura al llegar", async () => {
    const m = conFetch([estadoDe(3), json([fila(1, cuentaDePrueba(1)), fila(2, cuentaDePrueba(2))]), json([fila(3, "GBBB")])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toBeNull();
    expect(m.llamadas).toHaveLength(3);
  });

  it("una fila cuya cuenta no es texto no tiene la forma de una fila", async () => {
    for (const mala of [7, null, undefined, { a: 1 }]) {
      const m = conFetch([estadoDe(1), json([fila(1, mala)])]);
      expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch }), String(mala)).toBeNull();
    }
  });

  it("una lista vacía sigue dando una lista vacía", async () => {
    const m = conFetch([estadoDe(0), json([]), estadoDe(0), json([])]);
    expect(await leerTodasLasAnotadas(SALA, { fetch: m.fetch })).toEqual([]);
  });
});

describe("resultadoDeSala con la forma de las ganadoras", () => {
  const cuerpo = (ganadoras: unknown): Response => json({ sorteo: "9", ganadoras, comprobante: "/verificar.html?x=1" });

  it("ganadoras todas líneas de persona devuelven el resultado, con la misma lectura que las cuentas", async () => {
    const m = conFetch([cuerpo([lineaDePrueba(2), lineaDePrueba(1)])]);
    expect(await resultadoDeSala(SALA, { fetch: m.fetch })).toEqual({
      sorteo: "9",
      ganadoras: [lineaDePrueba(2), lineaDePrueba(1)],
      comprobante: "/verificar.html?x=1",
    });
    expect(m.llamadas).toEqual([{ ruta: "/campana/resultado" }]);
  });

  it("una sola ganadora de persona también se lee", async () => {
    const m = conFetch([cuerpo([lineaDePrueba(3)])]);
    expect(await resultadoDeSala(SALA, { fetch: m.fetch })).toMatchObject({ ganadoras: [lineaDePrueba(3)] });
  });

  it("una mezcla de cuentas y líneas de persona da mezclada", async () => {
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo([cuentaDePrueba(1), lineaDePrueba(1)])]).fetch })).toBe("mezclada");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo([lineaDePrueba(1), cuentaDePrueba(1)])]).fetch })).toBe("mezclada");
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo([lineaDePrueba(1), "hola"])]).fetch })).toBe("mezclada");
  });

  it("una cuenta mal formada, o algo que no es texto, sin líneas de persona, sigue dando red", async () => {
    for (const mala of [SIN_FINAL_DE_CONTROL, "GBBB", 7, null]) {
      const m = conFetch([cuerpo([cuentaDePrueba(1), mala])]);
      expect(await resultadoDeSala(SALA, { fetch: m.fetch }), String(mala)).toBe("red");
    }
  });

  it("algo que no es texto junto a una línea de persona es red: no se entiende ni como mezcla", async () => {
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo([lineaDePrueba(1), 7])]).fetch })).toBe("red");
  });

  it("el resultado de cuentas y la lista vacía no cambian", async () => {
    const ganadoras = [cuentaDePrueba(2), cuentaDePrueba(1)];
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo(ganadoras)]).fetch })).toEqual({
      sorteo: "9",
      ganadoras,
      comprobante: "/verificar.html?x=1",
    });
    expect(await resultadoDeSala(SALA, { fetch: conFetch([cuerpo([])]).fetch })).toMatchObject({ ganadoras: [] });
  });
});
