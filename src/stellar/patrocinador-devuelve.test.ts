import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El sitio sube sin saber qué portero tiene delante. Solo el portero que devuelve el sorteo de un sello que entró tarde
 * lo dice en `/cupo` (`devuelve: true`), y la pantalla promete esa devolución solo si lo vio. Un portero de antes no
 * manda el campo: con él, la pantalla no promete nada.
 */

const URL = "https://p.ejemplo";
const G = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CUPO = { prendido: true, rige: "portero", sellos: { usados: 0, max: 20, quedan: 20 }, sorteos: { usados: 0, max: 40, quedan: 40 }, liberaEn: Date.UTC(2026, 11, 1) };

const contesta = (estado: number, cuerpo: unknown) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } }));

let p: typeof import("./patrocinador");
beforeEach(async () => {
  vi.resetModules();
  p = await import("./patrocinador");
});

describe("lo que el portero dice de la devolución", () => {
  it("antes de preguntar, no se sabe: no se promete", () => {
    expect(p.porteroDevuelveLosSellosTardios()).toBe(false);
  });

  it("el portero nuevo lo dice en /cupo y se recuerda", async () => {
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve: true }) });
    expect(p.porteroDevuelveLosSellosTardios()).toBe(true);
  });

  it("el portero de antes no manda el campo: no se promete", async () => {
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, CUPO) });
    expect(p.porteroDevuelveLosSellosTardios()).toBe(false);
  });

  it("si después contesta un portero sin el campo (se volvió atrás), deja de prometerse", async () => {
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve: true }) });
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, CUPO), forzar: true });
    expect(p.porteroDevuelveLosSellosTardios()).toBe(false);
  });

  it("el portero nuevo con el tope del día lleno manda devuelve:false: deja de prometerse", async () => {
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve: true }) });
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve: false }), forzar: true });
    expect(p.porteroDevuelveLosSellosTardios()).toBe(false);
  });

  it("solo vale el sí: un texto, un número o un error del portero no cuentan", async () => {
    for (const devuelve of ["true", 1, "si", null]) {
      await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve }), forzar: true });
      expect(p.porteroDevuelveLosSellosTardios(), String(devuelve)).toBe(false);
    }
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(503, { motivo: "apagado", devuelve: true }), forzar: true });
    expect(p.porteroDevuelveLosSellosTardios()).toBe(false);
  });

  it("un portero que no contesta no cambia lo que ya se sabía", async () => {
    await p.estadoDelPatrocinio(G, { url: URL, fetch: contesta(200, { ...CUPO, devuelve: true }) });
    const caido = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await p.estadoDelPatrocinio(G, { url: URL, fetch: caido, forzar: true });
    expect(caido).toHaveBeenCalled();
    expect(p.porteroDevuelveLosSellosTardios()).toBe(true);
  });
});
