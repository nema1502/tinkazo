import { afterEach, describe, expect, it, vi } from "vitest";
import deployments from "./deployments.json";
import { MAX_WINNERS } from "../protocol/select";
import { network, topeDeGanadores, topeDeLaRed } from "./config";

/** La entrada de mainnet de la lista, leída como lo que será: hoy es `null` y el tipo del JSON no deja leerle campos. */
const mainnetEnLista = (deployments as unknown as { mainnet: { contractId?: string; maxWinners?: unknown } | null }).mainnet;
const conContratoEnMainnet = !!mainnetEnLista?.contractId;

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

/**
 * Cuántos ganadores ofrece el sitio en cada red. El protocolo permite `MAX_WINNERS` (300), pero cada contrato desplegado
 * trae el tope de su versión: el de testnet de hoy admite 32, y el sitio no promete en producción lo que la red todavía
 * no tiene (se actualiza `maxWinners` en `deployments.json` junto con el contrato nuevo).
 */
describe("el tope de ganadores de una red", () => {
  it("el contrato de testnet de hoy declara 32, y el sitio no ofrece más en testnet", () => {
    expect((deployments.testnet as { maxWinners?: number }).maxWinners).toBe(32);
    expect(topeDeLaRed(deployments.testnet)).toBe(32);
    // Esta compilación es de testnet (sin VITE_STELLAR_NETWORK): lo que ofrece es lo de su contrato.
    expect(network.name).toBe("testnet");
    expect(topeDeGanadores()).toBe(32);
    expect(network.maxWinners).toBe(32);
  });

  it("un despliegue nuevo sin declararlo admite lo del protocolo: es el contrato de este repositorio, con 300", () => {
    expect(MAX_WINNERS).toBe(300);
    expect(topeDeLaRed({})).toBe(MAX_WINNERS);
    expect(topeDeLaRed({ maxWinners: 300 })).toBe(300);
    expect(topeDeLaRed(null)).toBe(MAX_WINNERS);
    expect(topeDeLaRed(undefined)).toBe(MAX_WINNERS);
  });

  it("nunca pasa del protocolo ni baja de uno, ni se deja engañar por un dato torcido", () => {
    expect(topeDeLaRed({ maxWinners: 500 })).toBe(MAX_WINNERS);
    expect(topeDeLaRed({ maxWinners: 1 })).toBe(1);
    for (const raro of [0, -5, 3.5, Number.NaN, "32", null, [], {}]) expect(topeDeLaRed({ maxWinners: raro }), String(raro)).toBe(MAX_WINNERS);
  });

  it.runIf(!conContratoEnMainnet)("mainnet todavía no tiene contrato: sin entrada, vale lo del protocolo", () => {
    expect(mainnetEnLista).toBeNull();
    expect(topeDeLaRed(mainnetEnLista)).toBe(MAX_WINNERS);
  });

  // El día que la lista tenga contrato en mainnet, corre esta en vez de la de arriba: es el contrato de este repositorio,
  // y el commit del día pone 300 o no pone el campo.
  it.runIf(conContratoEnMainnet)("con contrato en mainnet, ofrece lo que su contrato declare: el de este repositorio, 300", () => {
    expect(mainnetEnLista?.contractId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(topeDeLaRed(mainnetEnLista)).toBe(300);
  });

  describe("con una lista que trae contrato en mainnet (simulada: corre siempre)", () => {
    afterEach(() => {
      vi.doUnmock("./deployments.json");
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    /** El tope que ofrece el sitio en Oficial (`?red=oficial`) con esta entrada de mainnet en la lista. */
    const topeEnOficial = async (entrada: Record<string, unknown>) => {
      vi.resetModules();
      vi.doMock("./deployments.json", () => ({ default: { ...deployments, mainnet: entrada } }));
      vi.stubGlobal("location", { search: "?red=oficial" });
      const config = await import("./config");
      expect(config.network.name).toBe("mainnet");
      return [config.network.maxWinners, config.topeDeGanadores()];
    };

    it("el tope sale de la entrada de mainnet de la lista, y sin el campo vale el del protocolo", async () => {
      expect(await topeEnOficial({ ...ENTRADA_SIMULADA, maxWinners: 300 })).toEqual([300, 300]);
      expect(await topeEnOficial({ ...ENTRADA_SIMULADA, maxWinners: 40 })).toEqual([40, 40]);
      const sinCampo: Record<string, unknown> = { ...ENTRADA_SIMULADA };
      delete sinCampo.maxWinners;
      expect(await topeEnOficial(sinCampo)).toEqual([MAX_WINNERS, MAX_WINNERS]);
    });
  });
});
