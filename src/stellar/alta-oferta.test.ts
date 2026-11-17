import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_ALTA } from "../alta-textos";
import { TEXTOS_ALTA_PAGO } from "../alta-textos-pago";
import { CACHE_OFERTA_MS, SIN_OFERTA, leerOferta, montoVisible, ofertaDe, olvidarOferta, textoDelProducto, varsDelProducto } from "./alta-oferta";
import type { PreciosDeAlta, ResultadoDeAlta } from "./alta-api";
import { productoPausado } from "./venta-oficial";

/**
 * Qué se puede comprar, leído de `GET /v1/alta/precios` y nunca escrito a mano. Lo que no se negocia: si el servidor no
 * contesta, dice que el pago está apagado, no es de la red principal o un producto viene pausado, ese producto no se
 * ofrece; y el precio que se dice es el del servidor, número por número.
 */

const URL = "https://pm.example";
const responder = (estadoHttp: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

const PRECIOS = { red: "mainnet", pago: true, alta: { usdc: "3", sorteos: 3, dias: 90 }, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] };
const ok = (datos: PreciosDeAlta): ResultadoDeAlta<PreciosDeAlta> => ({ ok: true, datos });
const conPausa = (p: { usdc: string; sorteos: number; dias: number }, pausado = false) => ({ ...p, pausado });

function servidor(cuerpo: () => unknown, estadoHttp = 200) {
  const f = vi.fn(async () => responder(estadoHttp, cuerpo()));
  return { f: f as unknown as typeof fetch, espia: f };
}

beforeEach(() => olvidarOferta());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("qué se ofrece", () => {
  it("con el pago prendido en el servidor, el primer paquete y los paquetes, con sus números", () => {
    const o = ofertaDe(ok({ ...PRECIOS, alta: conPausa(PRECIOS.alta), paquetes: [{ id: "p10", ...conPausa({ usdc: "9", sorteos: 10, dias: 365 }) }] }));
    expect(o).toEqual({ alta: { id: "alta", usdc: "3", sorteos: 3, dias: 90 }, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] });
  });

  it("sin respuesta, con el pago apagado o fuera de la red principal: nada", () => {
    expect(ofertaDe({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 })).toEqual(SIN_OFERTA);
    expect(ofertaDe(ok({ ...PRECIOS, pago: false, alta: conPausa(PRECIOS.alta), paquetes: [] }))).toEqual(SIN_OFERTA);
    expect(ofertaDe(ok({ ...PRECIOS, red: "testnet", alta: conPausa(PRECIOS.alta), paquetes: [] }))).toEqual(SIN_OFERTA);
  });

  it("un producto pausado no se ofrece, y los demás sí", () => {
    const o = ofertaDe(ok({ ...PRECIOS, alta: conPausa(PRECIOS.alta, true), paquetes: [{ id: "p10", ...conPausa({ usdc: "9", sorteos: 10, dias: 365 }) }, { id: "p50", ...conPausa({ usdc: "25", sorteos: 50, dias: 365 }, true) }] }));
    expect(o).toEqual({ alta: null, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] });
  });

  it("lo pausado se lee igual que en la venta frenada del control de costos (`productoPausado`)", async () => {
    for (const pausado of [true, false, "si", null, 0, undefined]) {
      olvidarOferta();
      const p10 = pausado === undefined ? { id: "p10", usdc: "9", sorteos: 10, dias: 365 } : { id: "p10", usdc: "9", sorteos: 10, dias: 365, pausado };
      const { f } = servidor(() => ({ ...PRECIOS, paquetes: [p10] }));
      const o = await leerOferta({ pago: true, url: URL, fetch: f });
      expect(o.paquetes.length === 0, String(pausado)).toBe(productoPausado(p10));
    }
  });

  it("el servidor sin primer paquete: solo los paquetes", () => {
    expect(ofertaDe(ok({ ...PRECIOS, alta: null, paquetes: [{ id: "p10", ...conPausa({ usdc: "9", sorteos: 10, dias: 365 }) }] }))).toEqual({ alta: null, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] });
  });
});

describe("la lectura", () => {
  it("con la compra apagada en el build no se le pregunta nada a nadie", async () => {
    const { f, espia } = servidor(() => PRECIOS);
    expect(await leerOferta({ pago: false, url: URL, fetch: f })).toEqual(SIN_OFERTA);
    // El build de las pruebas es el de Prueba: ahí la compra está apagada siempre, y ni el fetch del navegador se llama.
    const global = vi.fn();
    vi.stubGlobal("fetch", global);
    expect(await leerOferta()).toEqual(SIN_OFERTA);
    expect(espia).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it("lee lo que dice el servidor, tal cual, sin sesión", async () => {
    const { f, espia } = servidor(() => PRECIOS);
    expect(await leerOferta({ pago: true, url: URL, fetch: f })).toEqual({ alta: { id: "alta", usdc: "3", sorteos: 3, dias: 90 }, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] });
    expect(espia).toHaveBeenCalledTimes(1);
    const [url, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL}/v1/alta/precios`);
    expect(init.method).toBe("GET");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("lo que viene pausado o mal escrito no se ofrece", async () => {
    const casos: [unknown, unknown][] = [
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, pausado: true } }, { alta: null, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] }],
      // Un `pausado` que no se entiende es que no se vende.
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, pausado: "no" } }, { alta: null, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }] }],
      [{ ...PRECIOS, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365, pausado: 1 }] }, { alta: { id: "alta", usdc: "3", sorteos: 3, dias: 90 }, paquetes: [] }],
      [{ ...PRECIOS, pago: false }, SIN_OFERTA],
      [{ ...PRECIOS, pago: "true" }, SIN_OFERTA],
      // Un precio a medias rechaza todo, como en el servidor.
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, usdc: "0" } }, SIN_OFERTA],
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, usdc: "3,5" } }, SIN_OFERTA],
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, usdc: 3 } }, SIN_OFERTA],
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, sorteos: 0 } }, SIN_OFERTA],
      [{ ...PRECIOS, alta: { ...PRECIOS.alta, dias: 1.5 } }, SIN_OFERTA],
      [{ ...PRECIOS, paquetes: [{ id: "p10", usdc: "-9", sorteos: 10, dias: 365 }] }, SIN_OFERTA],
      [{ ...PRECIOS, paquetes: [{ id: "alta", usdc: "9", sorteos: 10, dias: 365 }] }, SIN_OFERTA],
      [{ ...PRECIOS, paquetes: [{ id: "p10", usdc: "9", sorteos: 10, dias: 365 }, { id: "p10", usdc: "1", sorteos: 10, dias: 365 }] }, SIN_OFERTA],
      [{ ...PRECIOS, paquetes: "p10" }, SIN_OFERTA],
      [{ ...PRECIOS, alta: undefined }, SIN_OFERTA],
    ];
    for (const [cuerpo, esperado] of casos) {
      olvidarOferta();
      const { f } = servidor(() => cuerpo);
      expect(await leerOferta({ pago: true, url: URL, fetch: f }), JSON.stringify(cuerpo)).toEqual(esperado);
    }
  });

  it("sin red, con un error o sin portero: nada, sin lanzar", async () => {
    const roto = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await leerOferta({ pago: true, url: URL, fetch: roto })).toEqual(SIN_OFERTA);
    for (const [s, cuerpo] of [
      [503, { motivo: "apagado" }],
      [429, { motivo: "cupo-ip" }],
      [500, null],
    ] as [number, unknown][]) {
      olvidarOferta();
      const { f } = servidor(() => cuerpo, s);
      expect(await leerOferta({ pago: true, url: URL, fetch: f })).toEqual(SIN_OFERTA);
    }
    const { f, espia } = servidor(() => PRECIOS);
    expect(await leerOferta({ pago: true, url: null, fetch: f })).toEqual(SIN_OFERTA);
    expect(espia).not.toHaveBeenCalled();
  });

  it("se recuerda 5 minutos, como el servidor; un error no se recuerda", async () => {
    vi.useFakeTimers();
    let ahora = 1_800_000_000_000;
    const reloj = () => ahora;
    let cuerpo: unknown = PRECIOS;
    let estadoHttp = 200;
    const f = vi.fn(async () => responder(estadoHttp, cuerpo)) as unknown as typeof fetch;
    expect(CACHE_OFERTA_MS).toBe(300_000);
    expect((await leerOferta({ pago: true, url: URL, fetch: f, ahora: reloj })).alta?.usdc).toBe("3");
    cuerpo = { ...PRECIOS, alta: { usdc: "4", sorteos: 3, dias: 90 } };
    ahora += CACHE_OFERTA_MS - 1;
    expect((await leerOferta({ pago: true, url: URL, fetch: f, ahora: reloj })).alta?.usdc).toBe("3");
    ahora += 2;
    expect((await leerOferta({ pago: true, url: URL, fetch: f, ahora: reloj })).alta?.usdc).toBe("4");
    expect(f).toHaveBeenCalledTimes(2);
    // Un error no queda: la próxima vez se pregunta de nuevo.
    olvidarOferta();
    estadoHttp = 503;
    expect(await leerOferta({ pago: true, url: URL, fetch: f, ahora: reloj })).toEqual(SIN_OFERTA);
    estadoHttp = 200;
    expect((await leerOferta({ pago: true, url: URL, fetch: f, ahora: reloj })).alta?.usdc).toBe("4");
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("dos lecturas a la vez son un solo pedido", async () => {
    const { f, espia } = servidor(() => PRECIOS);
    const [a, b] = await Promise.all([leerOferta({ pago: true, url: URL, fetch: f }), leerOferta({ pago: true, url: URL, fetch: f })]);
    expect(a).toEqual(b);
    expect(espia).toHaveBeenCalledTimes(1);
  });
});

describe("cómo se dice el precio", () => {
  it("el monto del servidor, con la coma en español y el punto en inglés, sin redondear nunca", () => {
    const casos: [string, string, string][] = [
      ["2", "2", "2"],
      ["25", "25", "25"],
      ["02", "2", "2"],
      ["2.0", "2", "2"],
      ["2.5", "2,50", "2.50"],
      ["2.50", "2,50", "2.50"],
      ["8.99", "8,99", "8.99"],
      ["0.5", "0,50", "0.50"],
      ["8.5000001", "8,5000001", "8.5000001"],
      ["1500", "1500", "1500"],
    ];
    for (const [usdc, es, en] of casos) {
      expect(montoVisible(usdc, "es"), usdc).toBe(es);
      expect(montoVisible(usdc, "en"), usdc).toBe(en);
    }
  });

  it("los textos del diseño salen de los números del servidor", () => {
    expect(textoDelProducto({ id: "alta", usdc: "2", sorteos: 3, dias: 365 }, "es")).toBe("3 sorteos oficiales por 2 dólares");
    expect(textoDelProducto({ id: "alta", usdc: "2", sorteos: 3, dias: 365 }, "en")).toBe("3 Live draws for US$2");
    expect(textoDelProducto({ id: "p10", usdc: "5", sorteos: 10, dias: 365 }, "es")).toBe("Organizá 10 sorteos oficiales por 5 dólares");
    expect(textoDelProducto({ id: "p10", usdc: "5", sorteos: 10, dias: 365 }, "en")).toBe("Run 10 Live draws for US$5");
    expect(textoDelProducto({ id: "p50", usdc: "25", sorteos: 50, dias: 365 }, "es")).toBe("Organizá 50 sorteos oficiales por 25 dólares");
  });

  it("con un sorteo o un dólar, en singular", () => {
    expect(textoDelProducto({ id: "alta", usdc: "1", sorteos: 1, dias: 30 }, "es")).toBe("1 sorteo oficial por 1 dólar");
    expect(textoDelProducto({ id: "alta", usdc: "1", sorteos: 1, dias: 30 }, "en")).toBe("1 Live draw for US$1");
    expect(textoDelProducto({ id: "p10", usdc: "1.0", sorteos: 10, dias: 30 }, "es")).toBe("Organizá 10 sorteos oficiales por 1 dólar");
    expect(textoDelProducto({ id: "p10", usdc: "1.5", sorteos: 10, dias: 30 }, "es")).toBe("Organizá 10 sorteos oficiales por 1,50 dólares");
  });

  it("el número que se dice es el del servidor: para cualquier precio, las cifras del texto son las suyas", () => {
    for (const usdc of ["3", "9", "17", "2.25", "120.5"]) {
      for (const sorteos of [3, 10, 50, 777]) {
        for (const l of ["es", "en"] as const) {
          const texto = textoDelProducto({ id: "p10", usdc, sorteos, dias: 365 }, l);
          const cifras = texto.match(/\d+(?:[.,]\d+)?/g) ?? [];
          expect(cifras.map((c) => Number(c.replace(",", "."))), texto).toEqual([sorteos, Number(usdc)]);
        }
      }
    }
  });

  it("los datos de los textos se arman con los textos del diccionario", () => {
    expect(varsDelProducto({ id: "alta", usdc: "3", sorteos: 3, dias: 90 }, "es")).toEqual({ sorteos: "3 sorteos oficiales", precio: "3 dólares" });
    expect(TEXTOS_ALTA.es.altaPrimerPaquete).toBe("{sorteos} por {precio}");
    expect(TEXTOS_ALTA_PAGO.es.pagoSorteosN).toBe("{n} sorteos oficiales");
  });
});
