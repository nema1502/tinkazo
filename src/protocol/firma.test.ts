import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { prepararFirma, verifyRoundAsync } from "./firma";

const { round, signature } = vectors.quicknet;

/**
 * Sin `Worker` (Node no lo tiene) la verificación cae al hilo de la página:
 * tiene que dar lo mismo que `verifyRound`. Un solo emparejamiento, que es lo
 * caro: rechazar la firma de otra ronda ya lo prueba `drand.test.ts`, y dos
 * archivos verificando a la vez se pasaban del tiempo en una máquina cargada.
 */
describe("firma sin trabar la página (protocolo §6)", () => {
  it("acepta la firma de los vectores", async () => {
    prepararFirma();
    expect(await verifyRoundAsync(round, signature)).toBe(true);
  }, 20_000);

  it("rechaza una firma rota sin lanzar", async () => {
    expect(await verifyRoundAsync(round, "zz")).toBe(false);
  }, 20_000);
});
