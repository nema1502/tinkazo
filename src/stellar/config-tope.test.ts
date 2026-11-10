import { describe, expect, it } from "vitest";
import deployments from "./deployments.json";
import { MAX_WINNERS } from "../protocol/select";
import { network, topeDeGanadores, topeDeLaRed } from "./config";

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

  it("mainnet todavía no tiene contrato: cuando lo tenga, ofrece lo que su contrato declare", () => {
    expect((deployments as { mainnet: unknown }).mainnet).toBeNull();
    expect(topeDeLaRed((deployments as { mainnet: null }).mainnet)).toBe(MAX_WINNERS);
  });
});
