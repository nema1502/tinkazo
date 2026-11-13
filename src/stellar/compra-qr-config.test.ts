import { describe, expect, it } from "vitest";
import { problemasDeAlta } from "./alta-build";
import { banderasDeAlta, compraQrActiva } from "./alta-config";

/**
 * La bandera de la compra con el QR del banco (`VITE_COMPRA_QR`): nace apagada, vale solo en la red principal y solo con
 * la compra y el pago con el saldo prendidos (la compra con QR termina pagando el paquete con lo que llegó al saldo), y el
 * build no sale con ella a medio poner.
 */

const COMPRA = { VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" };

describe("compraQrActiva", () => {
  it("apagada sin la variable, aunque todo lo demás esté prendido", () => {
    expect(compraQrActiva(COMPRA, "mainnet")).toBe(false);
    expect(compraQrActiva({}, "mainnet")).toBe(false);
    expect(banderasDeAlta(COMPRA, "mainnet").qr).toBe(false);
  });

  it("prendida con la compra, el pago con el saldo y la variable en 1, solo en la red principal", () => {
    expect(compraQrActiva({ ...COMPRA, VITE_COMPRA_QR: "1" }, "mainnet")).toBe(true);
    expect(banderasDeAlta({ ...COMPRA, VITE_COMPRA_QR: "1" }, "mainnet")).toEqual({ alta: true, libre: false, pago: true, sorteoServidor: false, qr: true });
    expect(compraQrActiva({ ...COMPRA, VITE_COMPRA_QR: "1" }, "testnet")).toBe(false);
  });

  it("sin la compra, sin el pago con el saldo, sin el acceso o sin el portero no vale", () => {
    for (const falta of ["VITE_ALTA_PAGO", "VITE_PAGO_CON_SALDO", "VITE_ALTA", "VITE_PATROCINIO_URL_MAINNET"]) {
      expect(compraQrActiva({ ...COMPRA, [falta]: "", VITE_COMPRA_QR: "1" }, "mainnet"), falta).toBe(false);
    }
    expect(compraQrActiva({ VITE_COMPRA_QR: "1" }, "mainnet")).toBe(false);
  });

  it("solo el valor 1 la prende", () => {
    for (const v of ["true", "on", " 1", "1 ", "0", "", "2", "si"]) expect(compraQrActiva({ ...COMPRA, VITE_COMPRA_QR: v }, "mainnet"), v).toBe(false);
  });

  it("en este build (Prueba y sin variables) está apagada", () => {
    expect(compraQrActiva()).toBe(false);
    expect(banderasDeAlta().qr).toBe(false);
  });
});

describe("el build no sale con la bandera a medio poner", () => {
  it("VITE_COMPRA_QR=1 sin el pago con el saldo frena el build: lo cargado no tendría cómo pagar la compra", () => {
    const p = problemasDeAlta({ ...COMPRA, VITE_PAGO_CON_SALDO: "", VITE_COMPRA_QR: "1" });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("VITE_COMPRA_QR");
    expect(p[0]).toContain("VITE_PAGO_CON_SALDO=1");
  });

  it("con todo prendido sale bien, y apagada no dice nada", () => {
    expect(problemasDeAlta({ ...COMPRA, VITE_COMPRA_QR: "1" })).toEqual([]);
    expect(problemasDeAlta({ ...COMPRA, VITE_COMPRA_QR: "0" })).toEqual([]);
    expect(problemasDeAlta({ ...COMPRA })).toEqual([]);
    expect(problemasDeAlta({})).toEqual([]);
  });

  it("VITE_VENTA_ABIERTA=1, que saca el piloto, necesita la compra prendida, y acepta solo 1 o 0", () => {
    expect(problemasDeAlta({ ...COMPRA, VITE_COMPRA_QR: "1", VITE_VENTA_ABIERTA: "1" })).toEqual([]);
    expect(problemasDeAlta({ ...COMPRA, VITE_VENTA_ABIERTA: "0" })).toEqual([]);
    const sinCompra = problemasDeAlta({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app", VITE_VENTA_ABIERTA: "1" });
    expect(sinCompra).toHaveLength(1);
    expect(sinCompra[0]).toContain("VITE_VENTA_ABIERTA=1 necesita VITE_ALTA_PAGO=1");
    const mal = problemasDeAlta({ ...COMPRA, VITE_VENTA_ABIERTA: "si" });
    expect(mal.some((x) => x.includes("VITE_VENTA_ABIERTA") && x.includes("solo acepta 1 o 0"))).toBe(true);
  });

  it("un valor que no es 1 ni 0 también frena, sin escribir el valor", () => {
    const p = problemasDeAlta({ ...COMPRA, VITE_COMPRA_QR: "on" });
    expect(p.some((x) => x.includes("VITE_COMPRA_QR") && x.includes("solo acepta 1 o 0"))).toBe(true);
    expect(p.join(" ")).not.toContain("=on");
  });
});
