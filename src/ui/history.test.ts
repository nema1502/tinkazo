import { describe, expect, it } from "vitest";
import { mergeWithChain, type Entry } from "./history";
import type { ChainRaffle } from "../stellar/seals";

const WHO = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";

const local = (over: Partial<Entry>): Entry => ({
  organizer: WHO,
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  ...over,
});

const onChain = (over: Partial<ChainRaffle>): ChainRaffle => ({
  id: "1",
  organizer: WHO,
  listHash: "aa",
  count: 10,
  numWinners: 1,
  round: 100,
  sealedAt: 1_000,
  prize: "",
  drawn: false,
  ...over,
});

describe("mergeWithChain", () => {
  it("un sorteo que este equipo ya tiene no se duplica, y gana la fila con nombres", () => {
    const got = mergeWithChain(
      [local({ id: "7", winners: ["Ana"] })],
      [onChain({ id: "7", drawn: true, winners: [3] })],
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.winners).toEqual(["Ana"]);
    expect(got[0]!.fromChain).toBeUndefined();
  });

  it("lo que solo está en la cadena entra marcado, con el puesto de quien ganó", () => {
    const got = mergeWithChain([], [onChain({ id: "9", drawn: true, winners: [5], prize: "Libro" })]);
    expect(got).toEqual([
      expect.objectContaining({ id: "9", fromChain: true, winnerIdx: [5], prize: "Libro" }),
    ]);
  });

  it("si acá quedó pendiente y se sorteó en otro lado, la cadena lo completa", () => {
    const got = mergeWithChain([local({ id: "7" })], [onChain({ id: "7", drawn: true, winners: [2] })]);
    expect(got).toHaveLength(1);
    expect(got[0]!.winnerIdx).toEqual([2]);
    expect(got[0]!.fromChain).toBeUndefined();
  });

  it("el mismo id con otra lista es otro sorteo: el contrato se redesplegó", () => {
    const got = mergeWithChain([local({ id: "3", listHash: "aa" })], [onChain({ id: "3", listHash: "bb" })]);
    expect(got).toHaveLength(2);
  });

  it("los sorteos sin anclar del equipo quedan, y todo sale del más nuevo al más viejo", () => {
    const got = mergeWithChain(
      [local({ sealedAt: 2_000 }), local({ id: "1", sealedAt: 1_000 })],
      [onChain({ id: "2", listHash: "cc", sealedAt: 3_000 })],
    );
    expect(got.map((e) => e.sealedAt)).toEqual([3_000, 2_000, 1_000]);
  });
});
