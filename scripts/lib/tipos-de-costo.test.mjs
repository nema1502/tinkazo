import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COST_TYPE_NAMES, costTypeName } from "./tipos-de-costo.mjs";

describe("los nombres de los tipos de costo de Soroban", () => {
  it("son los 86 del protocolo 29, sin repetir", () => {
    expect(COST_TYPE_NAMES).toHaveLength(86);
    expect(new Set(COST_TYPE_NAMES).size).toBe(86);
    for (const name of COST_TYPE_NAMES) expect(name).toMatch(/^[a-z][A-Za-z0-9]+$/);
  });

  it("coinciden uno por uno con ContractCostType del SDK instalado", async () => {
    const { xdr } = await import("@stellar/stellar-sdk");
    // El SDK puede conocer más tipos que la red (los de un protocolo que viene); de menos, no.
    COST_TYPE_NAMES.forEach((name, i) => {
      expect(xdr.ContractCostType.fromValue(i).name, `posición ${i}`).toBe(name);
    });
  });

  it("cubren todas las posiciones de las listas de costo de la línea base commiteada", () => {
    const base = JSON.parse(readFileSync(new URL("../vigilar-red.base.json", import.meta.url), "utf8"));
    for (const [network, { params }] of Object.entries(base.networks)) {
      for (const list of ["contract_cost_params_cpu_instructions", "contract_cost_params_memory_bytes"]) {
        expect(
          params[list].length,
          `${network}.${list} tiene más elementos que nombres: regenerar la lista (ver el comentario de tipos-de-costo.mjs)`,
        ).toBeLessThanOrEqual(COST_TYPE_NAMES.length);
      }
    }
  });

  it("una posición que la lista no conoce no tiene nombre", () => {
    expect(costTypeName(0)).toBe("wasmInsnExec");
    expect(costTypeName(85)).toBe("bn254G1Msm");
    expect(costTypeName(86)).toBeUndefined();
    expect(costTypeName(-1)).toBeUndefined();
    expect(costTypeName(1.5)).toBeUndefined();
  });
});
