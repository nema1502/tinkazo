import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RED_DE_PRUEBA } from "./red";

const despliegues = JSON.parse(readFileSync(new URL("../stellar/deployments.json", import.meta.url), "utf8")) as {
  testnet: { contractId: string; rpcUrl: string; networkPassphrase: string };
};

describe("la red de la prueba", () => {
  it("el contrato, el RPC y la clave de la red son los de la red de prueba de deployments.json", () => {
    expect(RED_DE_PRUEBA.contrato).toBe(despliegues.testnet.contractId);
    expect(RED_DE_PRUEBA.rpc).toBe(despliegues.testnet.rpcUrl);
    expect(RED_DE_PRUEBA.passphrase).toBe(despliegues.testnet.networkPassphrase);
  });

  it("ninguna dirección apunta a la red principal", () => {
    const todo = JSON.stringify(RED_DE_PRUEBA).toLowerCase();
    expect(todo).not.toContain("public global");
    expect(todo).not.toContain("mainnet");
    expect(todo).not.toContain("sorobanrpc.com");
    expect(RED_DE_PRUEBA.contrato).not.toBe(JSON.parse(readFileSync(new URL("../stellar/deployments.json", import.meta.url), "utf8")).mainnet.contractId);
  });

  it("los datos de la cuenta tienen la forma esperada", () => {
    expect(RED_DE_PRUEBA.codigoCuenta).toMatch(/^[0-9a-f]{64}$/);
    expect(RED_DE_PRUEBA.verificador).toMatch(/^C[A-Z2-7]{55}$/);
    expect(RED_DE_PRUEBA.contrato).toMatch(/^C[A-Z2-7]{55}$/);
    expect(RED_DE_PRUEBA.desplegador).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it("no hay ningún índice ajeno: la cuenta se busca en la red", () => {
    expect(Object.keys(RED_DE_PRUEBA)).not.toContain("indice");
    expect(JSON.stringify(RED_DE_PRUEBA).toLowerCase()).not.toMatch(/mercury|indexer/);
  });

  it("ningún archivo de la prueba nombra la red principal", () => {
    const carpeta = new URL("./", import.meta.url);
    const nombres = ["red.ts", "lista.ts", "ronda.ts"];
    for (const n of nombres) {
      const texto = readFileSync(new URL(n, carpeta), "utf8").toLowerCase();
      expect(texto, n).not.toMatch(/mainnet|public global|pubnet/);
    }
  });
});
