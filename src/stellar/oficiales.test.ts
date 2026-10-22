import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import deployments from "./deployments.json";
import { network } from "./config";
import { contratosOficiales } from "./oficiales";

/**
 * Una sola fuente para el contrato de cada red. El sitio sella con el de
 * `config.ts` y la verificación cree en los de `deployments.json`: si se
 * despegan, los comprobantes nuevos salen "no es el registro de Tinkazo"
 * (escéptico C, 22 de octubre de 2026).
 */
describe("el contrato con el que sella el sitio es el vigente de la lista oficial", () => {
  it("en la red de este build", () => {
    const vigente = contratosOficiales(network.name).find((c) => c.vigente);
    expect(network.contractId).toBe(vigente?.contractId ?? null);
  });

  it("el día que deployments.json tenga mainnet, config.ts tiene que leerlo de ahí", () => {
    const dep = deployments as unknown as { mainnet?: { contractId?: string } | null };
    if (!dep.mainnet?.contractId) return;
    expect(readFileSync("src/stellar/config.ts", "utf8")).toMatch(/deployments\.mainnet/);
  });
});
