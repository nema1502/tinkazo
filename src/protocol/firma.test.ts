import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { prepararFirma, verifyRoundAsync } from "./firma";

const { round, signature } = vectors.quicknet;

/**
 * Sin `Worker` (Node no lo tiene) la verificación cae al hilo de la página:
 * tiene que dar exactamente lo mismo que `verifyRound`.
 */
describe("firma sin trabar la página (protocolo §6)", () => {
  it("acepta la firma de los vectores", async () => {
    prepararFirma();
    expect(await verifyRoundAsync(round, signature)).toBe(true);
  });

  it("rechaza la firma de otra ronda y una firma rota, sin lanzar", async () => {
    expect(await verifyRoundAsync(round + 1, signature)).toBe(false);
    expect(await verifyRoundAsync(round, "zz")).toBe(false);
  });
});
