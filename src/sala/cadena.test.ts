import { Address, Keypair, xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../stellar/deployments.json";
import { ganadoresDeLaRed, leerSorteoEnLaRed, selloDeLaRed } from "../../workers/sala/src/cadena";

/** Una cuenta de Stellar de verdad, la de quien selló en estas pruebas. */
const ORGANIZADORA = Keypair.random().publicKey();

function entradaInstancia(): string {
  const val = xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({
      executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(deployments.mainnet.wasmSha256, "hex")),
      storage: null,
    }),
  );
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: new Address(deployments.mainnet.contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val,
    }),
  ).toXdr("base64");
}

describe("el sello y los ganadores leídos del contrato", () => {
  it("convierte la huella a hexadecimal y reconoce los estados Sealed y Drawn", () => {
    const listHash = Uint8Array.from({ length: 32 }, (_, i) => i);
    const base = { list_hash: listHash, count: 3, num_winners: 2, organizer: ORGANIZADORA, round: 30_000_000n };
    expect(selloDeLaRed({ ...base, status: ["Sealed"] })).toEqual({
      listHash: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      count: 3,
      numWinners: 2,
      sorteado: false,
      organizador: ORGANIZADORA,
      ronda: 30_000_000,
    });
    expect(selloDeLaRed({ ...base, status: ["Drawn"] }).sorteado).toBe(true);
  });

  it("una ronda que no se entiende deja el sello sin leer: sin ronda no se sabe si la semilla ya existe", () => {
    const base = { list_hash: new Uint8Array(32), count: 3, num_winners: 2, status: ["Sealed"], organizer: ORGANIZADORA };
    for (const round of [undefined, null, 0n, -1n, 0, 1.5, "30000000", 2n ** 60n]) {
      expect(() => selloDeLaRed({ ...base, round }), String(round)).toThrow();
    }
  });

  it("lee quién selló como una cuenta, y lo que no es una cuenta queda en null", () => {
    const base = { list_hash: new Uint8Array(32), count: 3, num_winners: 2, status: ["Sealed"], round: 30_000_000n };
    expect(selloDeLaRed({ ...base, organizer: ORGANIZADORA }).organizador).toBe(ORGANIZADORA);
    for (const organizer of [undefined, null, 12, "", "no es una cuenta", `G${"A".repeat(55)}`, `C${"A".repeat(55)}`]) {
      expect(selloDeLaRed({ ...base, organizer }).organizador, String(organizer)).toBeNull();
    }
  });

  it("rechaza una huella de 31 bytes", () => {
    const sello = { list_hash: new Uint8Array(31), count: 3, num_winners: 2, status: ["Sealed"] };
    expect(() => selloDeLaRed(sello)).toThrow();
  });

  it("conserva el orden de los índices ganadores y rechaza uno negativo", () => {
    expect(ganadoresDeLaRed({ winners: [2, 0] })).toEqual([2, 0]);
    expect(() => ganadoresDeLaRed({ winners: [-1] })).toThrow();
  });

  it("prueba el segundo RPC si el primero falla y da red cuando fallan los dos", async () => {
    const urls: string[] = [];
    const conRespaldo = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (urls.length === 1) throw new Error("corte de prueba");
      const { params } = JSON.parse(String(init?.body)) as { params: { keys: string[] } };
      const instancia = params.keys[0];
      if (!instancia) throw new Error("falta la clave de instancia");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { entries: [{ key: instancia, xdr: entradaInstancia() }], latestLedger: 100 },
        }),
      );
    }) as typeof fetch;
    const leido = await leerSorteoEnLaRed("mainnet", "1", ["https://uno.invalid", "https://dos.invalid"], conRespaldo);
    expect(urls).toEqual(["https://uno.invalid", "https://dos.invalid"]);
    expect(leido).toEqual({ sello: null, ganadores: null });
    let intentos = 0;
    const sinRed = (async () => {
      intentos++;
      throw new Error("corte de prueba");
    }) as typeof fetch;
    await expect(leerSorteoEnLaRed("mainnet", "1", ["https://uno.invalid", "https://dos.invalid"], sinRed)).resolves.toBe(
      "red",
    );
    expect(intentos).toBe(2);
  });

  it("pide instancia, Raffle y Draw, y la segunda clave es del contrato oficial y del número pedido", async () => {
    let claves: string[] = [];
    const pedir = (async (_url: string, init?: RequestInit) => {
      const { params } = JSON.parse(String(init?.body)) as { params: { keys: string[] } };
      claves = params.keys;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries: [], latestLedger: 100 } }));
    }) as typeof fetch;
    await leerSorteoEnLaRed("mainnet", "165", ["https://uno.invalid"], pedir);
    expect(claves).toHaveLength(3);
    const segunda = claves[1];
    if (!segunda) throw new Error("falta la clave del sello");
    const clave = xdr.LedgerKey.fromXdr(segunda, "base64");
    expect(clave.type).toBe("contractData");
    if (clave.type !== "contractData") throw new Error("la clave no es contractData");
    const contrato = new Address(deployments.mainnet.contractId).toScAddress();
    expect(clave.contractData.contract.toXdr("base64")).toBe(contrato.toXdr("base64"));
    const esperada = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Raffle"), xdr.ScVal.scvU64(165n)]);
    expect(clave.contractData.key.toXdr("base64")).toBe(esperada.toXdr("base64"));
    expect(clave.contractData.durability).toBe(xdr.ContractDataDurability.persistent);
  });
});
