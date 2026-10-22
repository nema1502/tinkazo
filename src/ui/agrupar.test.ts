import { describe, expect, it } from "vitest";
import { PAUSA_EVENTO, type Sorteado, agrupar, enOrdenDeSalida, fechaLarga, tieneComprobante } from "./agrupar";

const HORA = 3600;
const T0 = Date.UTC(2026, 9, 20, 15) / 1000;

/** Un sorteo con comprobante de verdad (el enlace a verificar.html con su fragmento). */
const con = (organizer: string, sealedAt: number, id: number): Sorteado & { id: number } => ({
  organizer,
  sealedAt,
  proof: `https://tinkazo.app/verificar.html#r${id}`,
  id,
});

const ids = (grupo: Array<{ id: number }>): number[] => grupo.map((x) => x.id);

describe("eventos: los sorteos de una cuenta, a doce horas o menos", () => {
  it("sorteos con pausas de una hora son un solo evento, en orden de sello", () => {
    const grupos = agrupar([con("A", T0 + 2 * HORA, 2), con("A", T0, 0), con("A", T0 + HORA, 1)]);
    expect(grupos.map(ids)).toEqual([[0, 1, 2]]);
  });

  it("una pausa de más de doce horas parte el evento en dos", () => {
    const grupos = agrupar([con("A", T0, 0), con("A", T0 + HORA, 1), con("A", T0 + HORA + 12 * HORA + 1, 2)]);
    expect(grupos.map(ids)).toEqual([[0, 1], [2]]);
  });

  it("con doce horas exactas sigue siendo el mismo evento", () => {
    expect(PAUSA_EVENTO).toBe(12 * HORA);
    const grupos = agrupar([con("A", T0, 0), con("A", T0 + 12 * HORA, 1)]);
    expect(grupos.map(ids)).toEqual([[0, 1]]);
  });

  it("las cuentas no se mezclan, aunque sellen a la misma hora", () => {
    const grupos = agrupar([con("A", T0, 0), con("B", T0, 1), con("A", T0 + HORA, 2), con("B", T0 + HORA, 3)]);
    expect(grupos).toHaveLength(2);
    for (const g of grupos) expect(new Set(g.map((x) => x.organizer)).size).toBe(1);
    expect(grupos.map(ids).sort()).toEqual([[0, 2], [1, 3]]);
  });

  it("un solo sorteo es un evento de uno", () => {
    expect(agrupar([con("A", T0, 7)]).map(ids)).toEqual([[7]]);
  });

  it("los sorteos sin comprobante no entran en ningún evento", () => {
    const sinNada: Sorteado & { id: number } = { organizer: "A", sealedAt: T0, id: 8 };
    const enlaceRonda: Sorteado & { id: number } = { organizer: "A", sealedAt: T0 + 1, proof: "https://api.drand.sh/public/1", id: 9 };
    expect(agrupar([sinNada, enlaceRonda])).toEqual([]);
    expect(agrupar([con("A", T0, 0), enlaceRonda]).map(ids)).toEqual([[0]]);
  });

  it("reconoce el comprobante por el enlace a verificar.html con su fragmento", () => {
    expect(tieneComprobante({ proof: "https://tinkazo.app/verificar.html#rABC" })).toBe(true);
    expect(tieneComprobante({ proof: "https://api.drand.sh/public/1" })).toBe(false);
    expect(tieneComprobante({})).toBe(false);
  });
});

describe("fecha del evento", () => {
  it("se escribe en largo y en el idioma de la página", () => {
    expect(fechaLarga(T0, "es")).toBe("20 de octubre de 2026");
    expect(fechaLarga(T0, "en")).toBe("October 20, 2026");
  });
});

describe("el orden en que salieron los sorteos de un evento (hallazgo 10)", () => {
  const ids = (l: Array<{ id?: string; prize?: string }>): string[] => l.map((s) => s.id ?? s.prize ?? "");

  it("por el número en el contrato, aunque se hayan sumado al revés, y comparado como número", () => {
    const sumados = [{ id: "753", sealedAt: 30 }, { id: "100", sealedAt: 10 }, { id: "99", sealedAt: 5 }];
    expect(ids(enOrdenDeSalida(sumados))).toEqual(["99", "100", "753"]);
    // La lista que recibe no cambia.
    expect(ids(sumados)).toEqual(["753", "100", "99"]);
  });

  it("si alguno no tiene número, o vienen de contratos distintos, por la hora del sello y después por la ronda", () => {
    expect(ids(enOrdenDeSalida([{ prize: "B", sealedAt: 20, round: 2 }, { id: "5", sealedAt: 10 }, { prize: "A", sealedAt: 20, round: 1 }]))).toEqual(["5", "A", "B"]);
    // Un contrato vuelto a desplegar empieza de nuevo en 1: el número no dice qué salió antes.
    const redesplegado = [{ id: "1", contract: "CNUEVO", sealedAt: 90 }, { id: "40", contract: "CVIEJO", sealedAt: 10 }];
    expect(ids(enOrdenDeSalida(redesplegado))).toEqual(["40", "1"]);
  });
});
