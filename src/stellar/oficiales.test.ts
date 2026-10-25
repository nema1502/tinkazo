import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import deployments from "./deployments.json";
import { network } from "./config";
import { contratosOficiales, passphraseDe } from "./oficiales";

/**
 * Una sola fuente para el contrato de cada red. El sitio sella con el de
 * `config.ts` y la verificación cree en los de `deployments.json`: si se
 * despegan, los comprobantes nuevos salen "no es el registro de Tinkazo"
 * (escéptico C, 22 de octubre de 2026).
 */
describe("el tope de los contratos anteriores", () => {
  it("cada anterior trae el número y el ledger de su último sello oficial, y el vigente no lleva tope", () => {
    for (const c of contratosOficiales()) {
      if (c.vigente) {
        expect(c.ultimoId, c.contractId).toBeUndefined();
        expect(c.ultimoLedger, c.contractId).toBeUndefined();
      } else {
        expect(Number.isSafeInteger(c.ultimoId), c.contractId).toBe(true);
        expect(Number.isSafeInteger(c.ultimoLedger) && (c.ultimoLedger as number) > 0, c.contractId).toBe(true);
      }
    }
  });

  it("los dos anteriores de testnet: el ledger del sorteo 936 y el del 1 (get_raffle(ultimoId).sealed_ledger, 25 de octubre de 2026)", () => {
    const tope = (id: string): [number | undefined, number | undefined] => {
      const c = contratosOficiales("testnet").find((x) => x.contractId === id);
      return [c?.ultimoId, c?.ultimoLedger];
    };
    expect(tope("CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH")).toEqual([936, 5_381_472]);
    expect(tope("CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ")).toEqual([1, 4_709_441]);
  });

  it("la passphrase de cada red es la de siempre: es parte del hash de sus transacciones", () => {
    expect(passphraseDe("testnet")).toBe("Test SDF Network ; September 2015");
    expect(passphraseDe("mainnet")).toBe("Public Global Stellar Network ; September 2015");
  });
});

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
