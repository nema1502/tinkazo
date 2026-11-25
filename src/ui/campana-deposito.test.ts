import { describe, expect, it } from "vitest";
import { DOLAR } from "../campana/comision";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import { estadoDelDeposito } from "./campana-deposito";

const saldo = (monto: string): SaldoDeDolares => ({ tipo: "saldo", saldo: monto });

describe("estadoDelDeposito: el premio está en la cuenta si el saldo libre lo cubre", () => {
  it("con el saldo justo alcanza", () => {
    expect(estadoDelDeposito(saldo("40.0000000"), 40n * DOLAR)).toEqual({ tipo: "alcanza", total: 40n * DOLAR });
  });

  it("con más saldo que premio alcanza", () => {
    expect(estadoDelDeposito(saldo("120.5000000"), 40n * DOLAR)).toEqual({ tipo: "alcanza", total: 40n * DOLAR });
  });

  it("con un centavo menos falta ese centavo", () => {
    expect(estadoDelDeposito(saldo("39.9900000"), 40n * DOLAR)).toEqual({ tipo: "falta", falta: 100_000n });
  });

  it("con saldo cero falta todo el premio", () => {
    expect(estadoDelDeposito(saldo("0.0000000"), 40n * DOLAR)).toEqual({ tipo: "falta", falta: 40n * DOLAR });
  });

  it("una cuenta que todavía no existe falta todo el premio", () => {
    expect(estadoDelDeposito({ tipo: "sin-cuenta" }, 40n * DOLAR)).toEqual({ tipo: "falta", falta: 40n * DOLAR });
  });

  it("una cuenta sin la línea de los dólares digitales, o con la línea sin autorizar, falta todo el premio", () => {
    expect(estadoDelDeposito({ tipo: "sin-linea" }, 40n * DOLAR)).toEqual({ tipo: "falta", falta: 40n * DOLAR });
  });

  it("si no se pudo leer no afirma nada, ni que alcanza ni que falta", () => {
    expect(estadoDelDeposito({ tipo: "sin-red" }, 40n * DOLAR)).toEqual({ tipo: "sin-lectura" });
  });

  it("un saldo que no se lee como monto tampoco afirma nada", () => {
    expect(estadoDelDeposito(saldo("mucho"), 40n * DOLAR)).toEqual({ tipo: "sin-lectura" });
  });

  it("un premio de cero no dice nada", () => {
    expect(estadoDelDeposito(saldo("10.0000000"), 0n)).toEqual({ tipo: "sin-lectura" });
  });
});
