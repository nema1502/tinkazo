// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cuentaDePrueba, lineaDePrueba } from "../campana/cuentas-de-prueba";
import type { SalaDeCampana } from "../sala/campana-org";
import { depsDelPasoReales } from "./campana-pasar-real";
import { depsDelResultadoReales } from "./campana-resultado-real";

/**
 * Lo que los pasos de pasar la lista y de mostrar el resultado hacen con una lista que la sala devuelve mezclada. Los dos piden
 * distinguir la mezcla, porque reintentar no la cambia y tiene su propio aviso.
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

afterEach(() => vi.unstubAllGlobals());

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });
const estadoDe = (total: number): Response =>
  json({ fase: "cerrada", total, cierraMs: 5, pase: "sin", quitadas: { repetida: 0, evento: 0, pidio: 0, otro: 0 } });
const fila = (n: number, cuenta: string): Record<string, unknown> => ({ n, cuenta, d: "cifrado", estado: "aceptado", v: n });

/** Una sala de mentira que contesta en orden y anota las rutas que le pidieron. */
function conSala(respuestas: Response[]): string[] {
  const rutas: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      rutas.push(url.replace("https://s.tinkazo.app/v1/sala/AbCd1234", ""));
      const r = respuestas.shift();
      if (r === undefined) throw new Error("sin red");
      return r;
    }),
  );
  return rutas;
}

const lectura = (filas: Record<string, unknown>[]): Response[] => [estadoDe(filas.length), json(filas), json([]), estadoDe(filas.length), json([])];

describe("pasar la lista con una lista mezclada", () => {
  it("una lista de cuentas se lee como siempre", async () => {
    conSala(lectura([fila(1, cuentaDePrueba(1)), fila(2, cuentaDePrueba(2))]));
    const leidas = await depsDelPasoReales().leer(SALA);
    expect(Array.isArray(leidas) && leidas.map((f) => f.cuenta)).toEqual([cuentaDePrueba(1), cuentaDePrueba(2)]);
  });

  it("una lista toda de líneas de persona se lee como una lista", async () => {
    conSala(lectura([fila(1, lineaDePrueba(1)), fila(2, lineaDePrueba(2))]));
    const leidas = await depsDelPasoReales().leer(SALA);
    expect(Array.isArray(leidas) && leidas.map((f) => f.cuenta)).toEqual([lineaDePrueba(1), lineaDePrueba(2)]);
  });

  it("una lista mezclada se lee como mezclada, solo después de una lectura estable de punta a punta", async () => {
    const rutas = conSala(lectura([fila(1, cuentaDePrueba(1)), fila(2, lineaDePrueba(1))]));
    expect(await depsDelPasoReales().leer(SALA)).toBe("mezclada");
    expect(rutas).toEqual(["/campana/estado", "/equipos?desde=0", "/equipos?desde=2", "/campana/estado", "/equipos?desde=2"]);
  });

  it("una cuenta mal formada sigue siendo una lectura que falló", async () => {
    conSala(lectura([fila(1, cuentaDePrueba(1)), fila(2, "GBBB")]));
    expect(await depsDelPasoReales().leer(SALA)).toBeNull();
  });
});

describe("mostrar el resultado con ganadoras mezcladas", () => {
  const cuerpo = (ganadoras: unknown[]): Response => json({ sorteo: "9", ganadoras, comprobante: "/verificar.html?x=1" });

  it("el resultado de cuentas se lee como siempre", async () => {
    conSala([cuerpo([cuentaDePrueba(2), cuentaDePrueba(1)])]);
    expect(await depsDelResultadoReales().resultado(SALA)).toEqual({
      sorteo: "9",
      ganadoras: [cuentaDePrueba(2), cuentaDePrueba(1)],
      comprobante: "/verificar.html?x=1",
    });
  });

  it("ganadoras mezcladas se leen como mezcladas y no como un resultado que no se pudo leer", async () => {
    conSala([cuerpo([cuentaDePrueba(1), lineaDePrueba(1)])]);
    expect(await depsDelResultadoReales().resultado(SALA)).toBe("mezclada");
  });

  it("ganadoras que son todas líneas de persona se leen como un resultado", async () => {
    conSala([cuerpo([lineaDePrueba(2), lineaDePrueba(1)])]);
    expect(await depsDelResultadoReales().resultado(SALA)).toEqual({
      sorteo: "9",
      ganadoras: [lineaDePrueba(2), lineaDePrueba(1)],
      comprobante: "/verificar.html?x=1",
    });
  });

  it("una ganadora que no es cuenta ni línea sigue siendo un resultado que no se pudo leer", async () => {
    conSala([cuerpo([cuentaDePrueba(1), "GBBB"])]);
    expect(await depsDelResultadoReales().resultado(SALA)).toBe("red");
  });

  it("las respuestas que no son un resultado siguen igual", async () => {
    conSala([json({ error: "sin-resultado" }, 404)]);
    expect(await depsDelResultadoReales().resultado(SALA)).toBe("sin-resultado");
    conSala([json({ error: "no-existe" }, 404)]);
    expect(await depsDelResultadoReales().resultado(SALA)).toBe("no-existe");
  });
});
