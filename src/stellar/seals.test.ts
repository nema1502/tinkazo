import { describe, expect, it } from "vitest";
import { parseRaffle, sealsOnChain } from "./seals";
import { RPC_URLS } from "./config";
import deployments from "./deployments.json";

/** Un `Raffle` como lo devuelve `scValToNative`: u64 como bigint, bytes como Uint8Array. */
const RAW = {
  id: 40n,
  organizer: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY",
  list_hash: new Uint8Array([0xab, 0x01, 0x00, 0xff]),
  count: 18,
  num_winners: 1,
  round: 32_300_000n,
  sealed_at: 1_789_957_797n,
  sealed_ledger: 123,
  meta: "Sorteo de comunidad",
  status: ["Drawn"],
};

describe("parseRaffle", () => {
  it("pasa los tipos del contrato a los de acá", () => {
    expect(parseRaffle(RAW)).toEqual({
      id: "40",
      organizer: RAW.organizer,
      listHash: "ab0100ff",
      count: 18,
      numWinners: 1,
      round: 32_300_000,
      sealedAt: 1_789_957_797,
      prize: "Sorteo de comunidad",
      drawn: true,
    });
  });

  it("lee el estado de un enum sin datos, que llega como arreglo", () => {
    expect(parseRaffle({ ...RAW, status: ["Sealed"] })?.drawn).toBe(false);
  });

  it("salta una fila a la que le falta la cuenta o el id, en vez de inventarla", () => {
    expect(parseRaffle({ ...RAW, organizer: undefined })).toBeNull();
    expect(parseRaffle({ ...RAW, id: undefined })).toBeNull();
    expect(parseRaffle(null)).toBeNull();
  });
});

/**
 * Contra el contrato de testnet de verdad. Se corre a mano, con red:
 *   TINKAZO_RED=1 pnpm test
 * Los sorteos 39 y 40 se hicieron el 20 de septiembre de 2026 y se sortearon.
 */
describe.skipIf(!process.env.TINKAZO_RED)("sealsOnChain contra testnet", () => {
  const who = RAW.organizer;
  const contractId = deployments.testnet.contractId;

  it("trae los sorteos de la cuenta, con sus ganadores, del más nuevo al más viejo", async () => {
    const got = await sealsOnChain(who, contractId, RPC_URLS.testnet);
    expect(got).not.toBeNull();
    const list = got!.raffles;
    expect(list.every((r) => r.organizer === who)).toBe(true);
    const byId = new Map(list.map((r) => [r.id, r]));
    expect(byId.get("40")?.winners).toEqual([6]);
    expect(byId.get("39")?.winners).toEqual([4]);
    expect(byId.get("40")?.count).toBe(18);
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.sealedAt).toBeGreaterThanOrEqual(list[i]!.sealedAt);
  }, 60_000);

  it("no trae nada de una cuenta que nunca selló", async () => {
    const got = await sealsOnChain(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      contractId,
      RPC_URLS.testnet,
    );
    expect(got?.raffles).toEqual([]);
  }, 60_000);
});
