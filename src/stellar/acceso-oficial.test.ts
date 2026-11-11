import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { consultarAcceso, decidirAcceso, errorDelAcceso, exigirAcceso, sorteosDelSello } from "./acceso-oficial";
import { errorKey, esNoQueBloquea } from "./errores";
import { ErrorPortero, type EstadoDelPatrocinio, errorDeRespuesta, leerCupo } from "./patrocinador";

/**
 * Lo que decide si se puede pedir una firma con el cobro por uso del modo Oficial: el bloque `oficial` de `/cupo`
 * (sección 9 del diseño), leído por `leerCupo`, y la decisión de `acceso-oficial.ts`. También el 402 `sin-sorteos` del
 * portero. En Prueba `/cupo` no trae `oficial` y todo se lee como siempre.
 */

const base = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  prendido: true,
  rige: "portero",
  red: "mainnet",
  sellos: { usados: 1, max: 100, quedan: 9 },
  sorteos: { usados: 1, max: 100, quedan: 99 },
  liberaEn: Date.UTC(2026, 11, 1),
  ...extra,
});
const VENCE = Date.UTC(2027, 0, 14);
const oficial = (quedan: number) => ({ acceso: true, sorteos: { quedan, proximoVence: { fecha: VENCE, cuantos: 3 } } });

describe("leerCupo con el bloque oficial", () => {
  it("lo lee tal cual: acceso, sorteos que quedan y el próximo vencimiento", () => {
    const e = leerCupo(200, base({ oficial: oficial(13) }), "mainnet");
    expect(e).toMatchObject({ rige: "portero", oficial: { acceso: true, sorteos: { quedan: 13, proximoVence: { fecha: VENCE, cuantos: 3 } } } });
  });

  it("sin acceso, los sorteos quedan en null aunque vengan", () => {
    expect(leerCupo(200, base({ oficial: { acceso: false, sorteos: { quedan: 5 } } }), "mainnet")).toMatchObject({ oficial: { acceso: false, sorteos: null } });
  });

  it("un próximo vencimiento que no se entiende queda en null, sin tocar lo demás", () => {
    expect(leerCupo(200, base({ oficial: { acceso: true, sorteos: { quedan: 2, proximoVence: { fecha: "mañana", cuantos: 1 } } } }), "mainnet")).toMatchObject({ oficial: { sorteos: { quedan: 2, proximoVence: null } } });
  });

  it("un bloque oficial que vino y no se entiende es cerrado", () => {
    for (const o of [null, "si", 1, { acceso: "si" }, {}]) expect(leerCupo(200, base({ oficial: o }), "mainnet"), JSON.stringify(o)).toEqual({ rige: "cerrado", motivo: "sin-respuesta" });
  });

  it("también cuando rige Pollar lo lleva", () => {
    expect(leerCupo(200, { prendido: false, motivo: "pollar", rige: "pollar", red: "mainnet", oficial: oficial(1) }, "mainnet")).toEqual({ rige: "pollar", configurado: true, oficial: oficial(1) });
  });

  it("sin el bloque, lo de siempre: nada nuevo en el estado (Prueba)", () => {
    const e = leerCupo(200, base({ red: "testnet" }), "testnet");
    expect(e).toEqual({ rige: "portero", cupo: { sellos: { usados: 1, max: 100, quedan: 9 }, sorteos: { usados: 1, max: 100, quedan: 99 }, liberaEn: Date.UTC(2026, 11, 1) } });
    expect("oficial" in e).toBe(false);
  });
});

describe("cuántos sorteos oficiales usa un sello", () => {
  it("uno hasta 50 ganadores, dos de 51 a 300, y lo que no se lee cuenta como lo más caro", () => {
    expect([1, 2, 50].map(sorteosDelSello)).toEqual([1, 1, 1]);
    expect([51, 60, 300].map(sorteosDelSello)).toEqual([2, 2, 2]);
    expect([0, -1, 1.5, Number.NaN, undefined, null].map((x) => sorteosDelSello(x as number))).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

describe("la decisión", () => {
  const leer = (o: unknown, sellos = 9): EstadoDelPatrocinio => leerCupo(200, base({ oficial: o, sellos: { usados: 1, max: 100, quedan: sellos } }), "mainnet");

  it("el sello: con 0 no, con 1 sí; con 60 ganadores y 1, no; con 2, sí", () => {
    expect(decidirAcceso(leer(oficial(0), 0), "sello", 1)).toEqual({ que: "sin-sorteos", quedan: 0, hacenFalta: 1 });
    expect(decidirAcceso(leer(oficial(1), 1), "sello", 1)).toEqual({ que: "sigue" });
    expect(decidirAcceso(leer(oficial(1), 1), "sello", 60)).toEqual({ que: "sin-sorteos", quedan: 1, hacenFalta: 2 });
    expect(decidirAcceso(leer(oficial(2), 2), "sello", 60)).toEqual({ que: "sigue" });
  });

  it("sin acceso, ni el sello ni el sorteo", () => {
    expect(decidirAcceso(leer({ acceso: false }, 0), "sello", 1)).toEqual({ que: "sin-acceso" });
    expect(decidirAcceso(leer({ acceso: false }, 0), "sorteo")).toEqual({ que: "sin-acceso" });
  });

  it("el sorteo pide solo el acceso: sin sorteos oficiales igual se sortea lo sellado", () => {
    expect(decidirAcceso(leer(oficial(0), 0), "sorteo")).toEqual({ que: "sigue" });
  });

  it("con sorteos pero sin sellos del mes, el tope del mes", () => {
    expect(decidirAcceso(leer(oficial(5), 0), "sello", 1)).toEqual({ que: "tope-mes", liberaEn: Date.UTC(2026, 11, 1), max: 100 });
  });

  it("sin el bloque oficial, sin portero, cerrado o con acceso y sin sorteos que contar: cerrado", () => {
    expect(decidirAcceso(leerCupo(200, base(), "mainnet"), "sello", 1).que).toBe("cerrado");
    expect(decidirAcceso(leerCupo(200, base(), "mainnet"), "sorteo").que).toBe("cerrado");
    expect(decidirAcceso({ rige: "pollar", configurado: false }, "sorteo")).toEqual({ que: "cerrado", motivo: "sin-portero" });
    expect(decidirAcceso({ rige: "cerrado", motivo: "apagado" }, "sello", 1)).toEqual({ que: "cerrado", motivo: "apagado" });
    expect(decidirAcceso(leer({ acceso: true, sorteos: null }), "sello", 1).que).toBe("cerrado");
  });

  it("rige Pollar con acceso (el plan B de la regla de contrato): sigue", () => {
    expect(decidirAcceso({ rige: "pollar", configurado: true, oficial: oficial(1) }, "sello", 1)).toEqual({ que: "sigue" });
  });

  it("consultar nunca lanza: lo que falla, o sin cuenta, es cerrado", async () => {
    expect(await consultarAcceso("GAAA", "sello", 1, { consultar: async () => Promise.reject(new Error("caído")) })).toEqual({ que: "cerrado", motivo: "sin-respuesta" });
    expect(await consultarAcceso(null, "sello", 1, { consultar: async () => leer(oficial(3)) })).toEqual({ que: "cerrado", motivo: "sin-cuenta" });
    expect(await consultarAcceso("GAAA", "sello", 1, { consultar: async () => leer(oficial(3)) })).toEqual({ que: "sigue" });
  });

  it("el candado lanza el no del portero que la pantalla ya entiende", async () => {
    const caso = async (o: unknown, sellos = 9, ganadores = 1): Promise<unknown> => exigirAcceso("GAAA", "sello", ganadores, { consultar: async () => leer(o, sellos) }).then(() => "sigue", (e: unknown) => e);
    expect(await caso(oficial(3))).toBe("sigue");
    expect(await caso({ acceso: false }, 0)).toMatchObject({ name: "ErrorPortero", motivo: "sin-alta", estado: 403 });
    expect(await caso(oficial(0), 0)).toMatchObject({ motivo: "sin-sorteos", estado: 402 });
    expect(await caso(oficial(1), 1, 60)).toMatchObject({ motivo: "sin-sorteos" });
    expect(await caso(oficial(5), 0)).toMatchObject({ motivo: "cupo-cuenta", que: "sellos", estado: 429 });
    expect(await exigirAcceso("GAAA", "sorteo", undefined, { consultar: async () => Promise.reject(new Error("x")) }).catch((e: unknown) => e)).toMatchObject({ motivo: "cerrado" });
  });
});

describe("los errores", () => {
  it("errorDeRespuesta reconoce el 402 sin-sorteos, con los que se vencieron", () => {
    const e = errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 2 });
    expect(e).toBeInstanceOf(ErrorPortero);
    expect(e.motivo).toBe("sin-sorteos");
    expect(e.estado).toBe(402);
    expect(e.vencieron).toBe(2);
    expect(e.reintentable).toBe(false);
  });

  it("cada no del acceso tiene su texto, en los dos idiomas", () => {
    expect(errorKey(errorDeRespuesta(402, { motivo: "sin-sorteos" }))).toBe("porteroSinSorteos");
    expect(errorKey(errorDelAcceso({ que: "sin-acceso" }))).toBe("porteroSinAlta");
    expect(errorKey(errorDelAcceso({ que: "sin-sorteos", quedan: 0, hacenFalta: 1 }))).toBe("porteroSinSorteos");
    expect(errorKey(errorDelAcceso({ que: "cerrado", motivo: "sin-respuesta" }))).toBe("porteroFondo");
    for (const clave of ["errAnchor.porteroSinSorteos", "errAnchor.porteroSinAlta"]) {
      expect(T.es[clave]).toBeTruthy();
      expect(T.en[clave]).toBeTruthy();
    }
  });

  it("sin acceso bloquea como una cuenta que el portero no cubre; sin sorteos tiene su ventana aparte", () => {
    expect(esNoQueBloquea(errorDelAcceso({ que: "sin-acceso" }))).toBe(true);
    expect(esNoQueBloquea(errorDeRespuesta(402, { motivo: "sin-sorteos" }))).toBe(false);
  });
});
