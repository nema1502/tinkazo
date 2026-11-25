// El conteo de cuentas nuevas y de activaciones de la última hora (issue 177): desde la consulta de uso del proveedor por
// ventana de tiempo, como la lee pollar.ts. Módulo puro: ninguna prueba toca una red. Los nombres y las cifras son inventados.
import { describe, expect, it } from "vitest";
import { contarCuentasEnUso } from "./lectura-cuentas";

describe("contarCuentasEnUso: las cuentas nuevas y las activaciones de la consulta de uso por ventana", () => {
  // Los nombres reales del proveedor llevan sufijo: el evento se reconoce por su comienzo, nunca por igualdad.
  it("reconoce los nombres con sufijo y suma todos los eventos que empiezan igual", () => {
    expect(
      contarCuentasEnUso([
        { event: "wallet.created:STELLAR:COSIGNED", count: 7, credits: "105" },
        { event: "wallet.created:STELLAR", count: 2, credits: "30" },
        { event: "wallet.created", count: 1, credits: "15" },
        { event: "account.active:monthly", count: 4, credits: "40" },
        { event: "cosign.signature:STELLAR", count: 900, credits: "18000" },
      ]),
    ).toEqual({ nuevas: 10, activaciones: 4 });
  });

  it("un nombre que solo se parece al comienzo no cuenta", () => {
    expect(contarCuentasEnUso([{ event: "wallet.createdX", count: 5 }, { event: "wallet.creat", count: 5 }, { event: "x.wallet.created", count: 5 }, { event: "account.activeX", count: 5 }])).toEqual({
      nuevas: 0,
      activaciones: 0,
    });
  });

  it("sin cuentas en la ventana da cero, que es un dato: la lista de eventos puede venir vacía", () => {
    expect(contarCuentasEnUso([])).toEqual({ nuevas: 0, activaciones: 0 });
    expect(contarCuentasEnUso([{ event: "cosign.signature:STELLAR", count: 3 }])).toEqual({ nuevas: 0, activaciones: 0 });
  });

  it("si falta la lista, o un count no es un entero seguro mayor o igual a cero, no hay conteo: null, nunca un cero inventado", () => {
    expect(contarCuentasEnUso(undefined)).toBeNull();
    expect(contarCuentasEnUso(null)).toBeNull();
    expect(contarCuentasEnUso("no")).toBeNull();
    expect(contarCuentasEnUso({ wallet: 3 })).toBeNull();
    for (const count of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "7", null, undefined]) {
      expect(contarCuentasEnUso([{ event: "wallet.created:STELLAR:COSIGNED", count }]), String(count)).toBeNull();
      // Un count malo de otro evento también invalida: la forma no es la esperada.
      expect(contarCuentasEnUso([{ event: "wallet.created:STELLAR:COSIGNED", count: 2 }, { event: "cosign.signature:STELLAR", count }]), String(count)).toBeNull();
    }
    expect(contarCuentasEnUso([null])).toBeNull();
    expect(contarCuentasEnUso([{ count: 2 }])).toBeNull();
    expect(contarCuentasEnUso([{ event: 7, count: 2 }])).toBeNull();
  });

  it("una suma que no cabe en un entero seguro tampoco es un conteo", () => {
    const m = Number.MAX_SAFE_INTEGER;
    expect(contarCuentasEnUso([{ event: "wallet.created:A", count: m }, { event: "wallet.created:B", count: 1 }])).toBeNull();
  });
});
