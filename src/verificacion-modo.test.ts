import { describe, expect, it } from "vitest";
import { anclaDe, type Ancla } from "./protocol/verificacion";
import deployments from "./stellar/deployments.json";
import { detalleDeLaRed, rotuloDelModo } from "./verificacion-modo";

/**
 * El modo que dice la verificación arriba de las comprobaciones. "Oficial" avala: solo puede decirlo un contrato de la
 * lista oficial, nunca el `net` que trae un enlace armado a mano. Y sin modo Oficial, el rótulo es el de siempre.
 */

const nombres: Record<string, string> = { netTest: "Prueba", netMain: "Oficial" };
const t = (k: string): string => nombres[k] ?? k;

const contrato = (red: "testnet" | "mainnet") =>
  ({ red, contractId: "CAAA", wasmSha256: "00", rpcUrl: "https://x", passphrase: "p", vigente: true }) as const;
const oficial = (red: "testnet" | "mainnet"): Ancla => ({ tipo: "oficial", contrato: contrato(red), id: "12" });
const ajeno: Ancla = { tipo: "ajeno", red: "mainnet", contrato: "CAJENO" };

describe("rotuloDelModo", () => {
  it("un comprobante de un contrato oficial de la red real dice Oficial, sin la marca de Prueba", () => {
    expect(rotuloDelModo(oficial("mainnet"), "mainnet", "#12", true, t)).toEqual({ texto: "Oficial, #12", marca: false });
  });

  it("un comprobante de un contrato oficial de testnet dice Prueba y lleva la marca naranja", () => {
    expect(rotuloDelModo(oficial("testnet"), "testnet", "#12", true, t)).toEqual({ texto: "Prueba, #12", marca: true });
  });

  it("un enlace con net mainnet y un contrato que no es de la lista no dice Oficial: queda lo que trae el enlace", () => {
    const r = rotuloDelModo(ajeno, "mainnet", "#12", true, t);
    expect(r.texto).not.toContain("Oficial");
    expect(r).toEqual({ texto: "mainnet, #12", marca: false });
  });

  it("un enlace con net testnet y un contrato ajeno tampoco lleva la marca de Prueba", () => {
    expect(rotuloDelModo({ tipo: "ajeno", red: "testnet", contrato: "CX" }, "testnet", "#7", true, t)).toEqual({ texto: "testnet, #7", marca: false });
  });

  it("un enlace deforme queda como vino", () => {
    expect(rotuloDelModo({ tipo: "deforme" }, "mainnet", "#", true, t)).toEqual({ texto: "mainnet, #", marca: false });
  });

  it("sin modo Oficial es lo de siempre: el nombre de la red del enlace y sin marca, aunque el contrato sea de la lista", () => {
    expect(rotuloDelModo(oficial("testnet"), "testnet", "#12", false, t)).toEqual({ texto: "testnet, #12", marca: false });
  });

  it("con un comprobante real contra la lista de verdad: el contrato de testnet vigente es Prueba y uno ajeno de mainnet no es Oficial", () => {
    const vigente = deployments.testnet.contractId;
    const a = anclaDe({ net: "testnet", contract: vigente, id: "12" });
    expect(a.tipo).toBe("oficial");
    expect(rotuloDelModo(a, "testnet", "#12", true, t)).toEqual({ texto: "Prueba, #12", marca: true });
    const b = anclaDe({ net: "mainnet", contract: vigente, id: "12" });
    expect(b.tipo).not.toBe("oficial");
    expect(rotuloDelModo(b, "mainnet", "#12", true, t).texto).not.toContain("Oficial");
  });
});

describe("detalleDeLaRed", () => {
  it("con modo Oficial, la comprobación de la cadena nombra el modo y no la red", () => {
    expect(detalleDeLaRed({ id: "12", net: "mainnet" }, true, t)).toBe("#12, Oficial");
    expect(detalleDeLaRed({ id: "12", net: "testnet" }, true, t)).toBe("#12, Prueba");
  });

  it("sin modo Oficial queda como siempre", () => {
    expect(detalleDeLaRed({ id: "12", net: "testnet" }, false, t)).toBe("#12, testnet");
  });
});
