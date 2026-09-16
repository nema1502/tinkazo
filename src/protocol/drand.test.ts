import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import {
  QUICKNET,
  bytesToHex,
  decompressG1,
  fetchRound,
  randomnessOf,
  roundAt,
  roundMessage,
  roundTime,
  targetRound,
  verifyRound,
} from "./drand";

const { round, signature, randomness } = vectors.quicknet;

// Misma firma sin comprimir que usa contracts/raffle/src/test.rs
const SIG_UNCOMPRESSED =
  "077a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac107dcead72cb133d9242167d8359226b699156f412e370b0850da63cd4ceba93bb81e17107bde7a4018aac91547fa2ac";

describe("quicknet (protocolo §2)", () => {
  it("calcula rondas y tiempos igual que el contrato", () => {
    expect(roundTime(1)).toBe(QUICKNET.genesisTime);
    expect(roundTime(2)).toBe(QUICKNET.genesisTime + 3);
    expect(roundTime(round)).toBe(1_789_568_295);
    expect(roundAt(QUICKNET.genesisTime - 1)).toBe(1);
    expect(roundAt(QUICKNET.genesisTime)).toBe(1);
    expect(roundAt(QUICKNET.genesisTime + 2)).toBe(1);
    expect(roundAt(QUICKNET.genesisTime + 3)).toBe(2);
    expect(roundAt(1_789_568_295)).toBe(round);
    expect(roundAt(1_789_568_297)).toBe(round);
    expect(roundAt(1_789_568_298)).toBe(round + 1);
  });

  it("elige una ronda objetivo que nace al menos `lead` segundos después", () => {
    const now = 1_789_568_295;
    for (const lead of [30, 45, 60, 61]) {
      const r = targetRound(now, lead);
      expect(roundTime(r)).toBeGreaterThanOrEqual(now + lead);
      expect(roundTime(r - 1)).toBeLessThan(now + lead);
    }
  });

  it("el mensaje firmado es sha256(be64(round))", () => {
    expect(bytesToHex(roundMessage(round))).toBe(
      "1e627d36e6f5abdfa5c532c893ad9077aed113c0fa9a7dc6143887ea1646800c",
    );
  });

  it("verifica la firma real de la ronda y rechaza la de otra ronda o basura", () => {
    expect(verifyRound(round, signature)).toBe(true);
    expect(verifyRound(round + 1, signature)).toBe(false);
    expect(verifyRound(round, "00".repeat(48))).toBe(false);
    expect(verifyRound(round, "zz")).toBe(false);
  });

  it("deriva la semilla igual al randomness de drand", () => {
    expect(bytesToHex(randomnessOf(signature))).toBe(randomness);
  });

  it("descomprime la firma al formato de 96 bytes del contrato", () => {
    expect(bytesToHex(decompressG1(signature))).toBe(SIG_UNCOMPRESSED);
  });

  it("obtiene una ronda rotando relays y validando la respuesta", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) return new Response("nope", { status: 503 });
      if (calls.length === 2) return new Response(JSON.stringify({ round, signature: "corta" }), { status: 200 });
      return new Response(JSON.stringify({ round, signature }), { status: 200 });
    }) as typeof fetch;
    const got = await fetchRound(round, { fetchFn, delayMs: 0, attempts: 5 });
    expect(got).toEqual({ round, signature });
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain(QUICKNET.relays[0]);
    expect(calls[1]).toContain(QUICKNET.relays[1]);
    expect(calls[2]).toContain(`/v2/chains/${QUICKNET.chainHash}/rounds/${round}`);
  });

  it("falla con el último error si ningún relay responde", async () => {
    const fetchFn = (async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;
    await expect(fetchRound(round, { fetchFn, delayMs: 0, attempts: 2 })).rejects.toThrow("sin red");
  });
});
