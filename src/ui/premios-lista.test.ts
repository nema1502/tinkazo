import { describe, expect, it } from "vitest";
import { type VistaDeLosPremios } from "../campana/premios-de-la-cuenta";
import { filasDeLosPremios, montoLegible } from "./premios-lista";

/**
 * La lista «Tus premios» de quien ganó, sin DOM ni red (`premios-lista.ts`): cada premio de la cuenta
 * con su estado como texto y su monto como se ve. La fecha la escribe quien llama, para que no dependa
 * de la zona ni del reloj.
 */

const fechaDeLaPrueba = (ms: number): string => (ms === 1_800_000_000_000 ? "16/12/2026" : String(ms));

const lista = (premios: VistaDeLosPremios) => filasDeLosPremios({ premios, idioma: "es", fecha: fechaDeLaPrueba });

describe("la lista de Tus premios", () => {
  it("un premio recibido: Recibido, con su monto como se ve en pantalla", () => {
    expect(lista({ ok: true, premios: [{ puesto: 0, monto: "100000000", estado: "recibido", hastaMs: null }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoRecibido" }, monto: "10" }],
    });
  });

  it("un premio por recibir: Por recibir hasta la fecha de la campaña, con su monto", () => {
    expect(lista({ ok: true, premios: [{ puesto: 1, monto: "5000000", estado: "por-recibir", hastaMs: 1_800_000_000_000 }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoPorRecibir", vars: { fecha: "16/12/2026" } }, monto: "0,5" }],
    });
  });

  it("el premio que volvió a la empresa, y un premio sin monto se ve igual sin el número", () => {
    expect(lista({ ok: true, premios: [{ puesto: 0, monto: "100000000", estado: "volvio", hastaMs: null }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoVolvio" }, monto: "10" }],
    });
    expect(lista({ ok: true, premios: [{ puesto: null, monto: null, estado: "por-recibir", hastaMs: 1_800_000_000_000 }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoPorRecibir", vars: { fecha: "16/12/2026" } }, monto: null }],
    });
  });

  it("un premio vencido o sin confirmar tiene su propio texto, sin fecha", () => {
    expect(lista({ ok: true, premios: [{ puesto: 0, monto: "100000000", estado: "vencido", hastaMs: null }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoVencido" }, monto: "10" }],
    });
    expect(lista({ ok: true, premios: [{ puesto: 0, monto: "100000000", estado: "sin-confirmar", hastaMs: null }] })).toEqual({
      filas: [{ texto: { clave: "prEstadoSinConfirmar" }, monto: "10" }],
    });
  });

  it("un plazo que no se puede escribir no se inventa: ni la fecha de 1970 ni una pantalla rota", () => {
    // La fecha de verdad (Intl) lanza con un número que no es finito: la lista no puede romperse por eso.
    const conIntl = (premios: VistaDeLosPremios) => filasDeLosPremios({ premios, idioma: "es", fecha: (ms) => new Intl.DateTimeFormat("es").format(ms) });
    for (const hastaMs of [Number.NaN, Number.POSITIVE_INFINITY, null, 8.64e15 + 1]) {
      const r = conIntl({ ok: true, premios: [{ puesto: 0, monto: "5000000", estado: "por-recibir", hastaMs }] });
      expect(r, String(hastaMs)).toEqual({ filas: [{ texto: { clave: "prEstadoSinConfirmar" }, monto: "0,5" }] });
    }
  });

  it("varios premios en el orden en que la promoción los guarda", () => {
    const r = lista({
      ok: true,
      premios: [
        { puesto: 3, monto: "100000000", estado: "recibido", hastaMs: null },
        { puesto: 5, monto: "1000000", estado: "por-recibir", hastaMs: 1_800_000_000_000 },
      ],
    });
    expect(r.filas.map((f) => f.texto.clave)).toEqual(["prEstadoRecibido", "prEstadoPorRecibir"]);
    expect(r.filas[0]?.monto).toBe("10");
    expect(r.filas[1]?.monto).toBe("0,1");
  });

  it("sin premios o sin promoción: la lista va vacía y no dice más", () => {
    expect(lista({ ok: true, premios: [] })).toEqual({ filas: [] });
    expect(lista({ ok: false, error: "red-caida" })).toEqual({ filas: [] });
  });

  it("el monto no pierde cifras: sale del texto, sin pasar por un número de coma flotante", () => {
    expect(montoLegible("123456789012345678901234567", "en")).toBe("12,345,678,901,234,567,890.1234567");
    expect(montoLegible("123456789012345678901234567", "es")).toBe("12.345.678.901.234.567.890,1234567");
    expect(montoLegible("50000000", "en")).toBe("5");
    expect(montoLegible("1", "es")).toBe("0,0000001");
    expect(montoLegible("0", "es")).toBe("0");
    expect(montoLegible("12x", "es")).toBeNull();
  });

  it("el idioma: los montos con coma decimal y los mismos estados", () => {
    const r = filasDeLosPremios({
      premios: { ok: true, premios: [{ puesto: 1, monto: "5000000", estado: "por-recibir", hastaMs: 1_800_000_000_000 }] },
      idioma: "en",
      fecha: fechaDeLaPrueba,
    });
    expect(r.filas).toEqual([{ texto: { clave: "prEstadoPorRecibir", vars: { fecha: "16/12/2026" } }, monto: "0.5" }]);
  });
});
