import { afterEach, describe, expect, it, vi } from "vitest";
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

  describe("en Oficial (`?red=oficial`)", () => {
    afterEach(() => {
      vi.doUnmock("./deployments.json");
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    /** `./config` y `./oficiales` cargados de nuevo con la dirección en `?red=oficial` (y la lista que se haya simulado). */
    const enOficial = async () => {
      vi.stubGlobal("location", { search: "?red=oficial" });
      return { config: await import("./config"), oficiales: await import("./oficiales") };
    };

    it("con la lista real: sella con el vigente de mainnet, o cae a Prueba si todavía no hay", async () => {
      vi.resetModules();
      const { config, oficiales } = await enOficial();
      const vigente = oficiales.contratosOficiales("mainnet").find((c) => c.vigente);
      expect(config.network.name).toBe(vigente ? "mainnet" : "testnet");
      expect(config.network.contractId).toBe(vigente?.contractId ?? deployments.testnet.contractId);
    });

    it("con una lista que trae contrato en mainnet (simulada: corre siempre): sella con el contrato de esa entrada", async () => {
      vi.resetModules();
      vi.doMock("./deployments.json", () => ({ default: { ...deployments, mainnet: ENTRADA_SIMULADA } }));
      const { config, oficiales } = await enOficial();
      const vigente = oficiales.contratosOficiales("mainnet").find((c) => c.vigente);
      expect(vigente?.contractId).toBe(ENTRADA_SIMULADA.contractId);
      expect(config.network.name).toBe("mainnet");
      expect(config.network.contractId).toBe(ENTRADA_SIMULADA.contractId);
      expect(config.network.networkPassphrase).toBe(oficiales.passphraseDe("mainnet"));
    });
  });
});

/** Una entrada de mainnet inventada, con la forma de la real. La dirección son 32 bytes en cero: nunca un contrato real. */
const ENTRADA_SIMULADA = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  deployedAt: "2026-01-01",
  wasmSha256: "0".repeat(64),
  maxWinners: 300,
  rpcUrl: "https://mainnet.sorobanrpc.com",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  anteriores: [],
};
