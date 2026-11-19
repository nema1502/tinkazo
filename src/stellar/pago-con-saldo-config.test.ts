import { describe, expect, it } from "vitest";
import { problemasDeAlta } from "./alta-build";
import { pagoConSaldoActivo } from "./alta-config";

/**
 * La bandera de pagar con el saldo de la cuenta (`VITE_PAGO_CON_SALDO`): nace apagada, vale solo en la red principal y
 * solo con la compra prendida, y el build no sale con ella a medio poner.
 */

const COMPRA = { VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" };

describe("pagoConSaldoActivo", () => {
  it("apagada sin la variable, aunque la compra esté prendida", () => {
    expect(pagoConSaldoActivo(COMPRA, "mainnet")).toBe(false);
    expect(pagoConSaldoActivo({}, "mainnet")).toBe(false);
  });

  it("prendida con la compra y la variable en 1, solo en la red principal", () => {
    expect(pagoConSaldoActivo({ ...COMPRA, VITE_PAGO_CON_SALDO: "1" }, "mainnet")).toBe(true);
    expect(pagoConSaldoActivo({ ...COMPRA, VITE_PAGO_CON_SALDO: "1" }, "testnet")).toBe(false);
  });

  it("sin la compra no vale, ni sin el acceso ni sin el portero", () => {
    expect(pagoConSaldoActivo({ ...COMPRA, VITE_ALTA_PAGO: "", VITE_PAGO_CON_SALDO: "1" }, "mainnet")).toBe(false);
    expect(pagoConSaldoActivo({ ...COMPRA, VITE_ALTA: "", VITE_PAGO_CON_SALDO: "1" }, "mainnet")).toBe(false);
    expect(pagoConSaldoActivo({ ...COMPRA, VITE_PATROCINIO_URL_MAINNET: "", VITE_PAGO_CON_SALDO: "1" }, "mainnet")).toBe(false);
  });

  it("solo el valor 1 la prende", () => {
    for (const v of ["true", "on", " 1", "1 ", "0", "", "2"]) expect(pagoConSaldoActivo({ ...COMPRA, VITE_PAGO_CON_SALDO: v }, "mainnet"), v).toBe(false);
  });

  it("en este build (Prueba y sin variables) está apagada", () => {
    expect(pagoConSaldoActivo()).toBe(false);
  });
});

describe("el build no sale con la bandera a medio poner", () => {
  it("VITE_PAGO_CON_SALDO=1 sin VITE_ALTA_PAGO=1 frena el build", () => {
    const p = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app", VITE_PAGO_CON_SALDO: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO");
    expect(p[0]).toContain("VITE_ALTA_PAGO=1");
  });

  it("con la compra prendida sale bien, y apagada no dice nada", () => {
    expect(problemasDeAlta({ ...COMPRA, VITE_PAGO_CON_SALDO: "1" })).toEqual([]);
    expect(problemasDeAlta({ ...COMPRA, VITE_PAGO_CON_SALDO: "0" })).toEqual([]);
    expect(problemasDeAlta({ ...COMPRA })).toEqual([]);
  });

  it("un valor que no es 1 ni 0 también frena, sin escribir el valor", () => {
    const p = problemasDeAlta({ ...COMPRA, VITE_PAGO_CON_SALDO: "on" });
    expect(p.some((x) => x.includes("VITE_PAGO_CON_SALDO") && x.includes("solo acepta 1 o 0"))).toBe(true);
    expect(p.join(" ")).not.toContain("=on");
  });
});
