import { describe, expect, it } from "vitest";
import { errorDeRespuesta } from "../stellar/patrocinador";
import { entroYFalloEnLaCadena } from "./sello-tarde-aviso";

/**
 * Qué cuenta como un intento que entró a la cadena y falló ahí. Solo eso pudo gastar un sorteo oficial: lo que falló en
 * la simulación (antes de firmar) o lo que el portero rechazó antes de reservar no gastó nada, y decirle a la persona que
 * ese intento usó un sorteo sería falso.
 */
describe("lo que entró a un ledger y falló ahí", () => {
  it("lo que dice cada camino de un sello que entró y falló", () => {
    for (const m of ["tx-FAILED", "Transaction failed!", "txFailed", "tx_failed", "TX_CONTRACT_FAILED", "Error: tx-FAILED (ronda 33939006)"]) expect(entroYFalloEnLaCadena(new Error(m)), m).toBe(true);
  });
});

describe("lo que no entró a ningún ledger", () => {
  it("el error 5 del contrato suelto, sin que diga que entró: puede ser de la simulación", () => {
    expect(entroYFalloEnLaCadena(new Error("HostError: Error(Contract, #5)"))).toBe(false);
  });

  it("la simulación que falló antes de firmar, aunque nombre el error 5", () => {
    expect(entroYFalloEnLaCadena(new Error("Transaction simulation failed: Error(Contract, #5)"))).toBe(false);
    expect(entroYFalloEnLaCadena(new Error("Transaction simulation failed: HostError: Error(Contract, #5) txFailed"))).toBe(false);
  });

  it("el portero que dijo que no antes de reservar (fallaria con el error 5, o rechazada)", () => {
    expect(entroYFalloEnLaCadena(errorDeRespuesta(400, { motivo: "fallaria", detalle: "HostError: Error(Contract, #5)" }))).toBe(false);
    expect(entroYFalloEnLaCadena(errorDeRespuesta(400, { motivo: "rechazada", codigo: "txFeeBumpInnerFailed/txFailed" }))).toBe(false);
    expect(entroYFalloEnLaCadena(errorDeRespuesta(402, { motivo: "sin-sorteos", vencieron: 0 }))).toBe(false);
  });

  it("el que se frenó antes de mandar, vencido, la secuencia, un corte", () => {
    const frenado = Object.assign(new Error("la ronda quedó cerca antes de mandar el sello (faltan 31 s): Error(Contract, #5)"), { name: "RondaMuyCerca" });
    expect(entroYFalloEnLaCadena(frenado)).toBe(false);
    for (const m of ["tx-EXPIRED", "tx_bad_seq", "tx_too_late", "Failed to fetch", "rpc-sin-respuesta: 503"]) expect(entroYFalloEnLaCadena(new Error(m)), m).toBe(false);
    expect(entroYFalloEnLaCadena(null)).toBe(false);
    expect(entroYFalloEnLaCadena("tx-FAILED")).toBe(false);
  });
});
