import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import {
  QUICKNET,
  bytesToHex,
  decompressG1,
  fetchRound,
  randomnessOf,
  readRound,
  roundAt,
  roundEndpoint,
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

/**
 * Las respuestas de verdad de la ronda de los vectores, tal como las mandaron
 * los relays el 21 de octubre de 2026. La v2 trae la ronda y la firma; la v1,
 * además, `randomness`, y en otro orden según el relay. Cloudflare contesta 404
 * a la v2, con texto y no JSON.
 */
const V2 = `{"round":${round},"signature":"${signature}"}`;
const V1_CLOUDFLARE = `{"round":${round},"signature":"${signature}","randomness":"${randomness}"}`;
const V1_DRAND_SH = `{"round":${round},"randomness":"${randomness}","signature":"${signature}"}`;
const V2_PATH = `/v2/chains/${QUICKNET.chainHash}/rounds/${round}`;
const V1_PATH = `/${QUICKNET.chainHash}/public/${round}`;
const CLOUDFLARE = "https://drand.cloudflare.com";

/** Lo que contesta cada relay hoy: drand.sh, las dos rutas; Cloudflare, solo la v1. */
function relayDeVerdad(url: string): Response {
  if (url.startsWith(CLOUDFLARE)) {
    return url.endsWith(V1_PATH) ? new Response(V1_CLOUDFLARE, { status: 200 }) : new Response("404 page not found", { status: 404 });
  }
  return new Response(url.endsWith(V2_PATH) ? V2 : V1_DRAND_SH, { status: 200 });
}

describe("los relays del faro (protocolo §2)", () => {
  it.each(QUICKNET.relays.map((relay, i) => [relay, i] as const))(
    "%s entrega la ronda por la ruta que sirve, al primer pedido",
    async (relay, i) => {
      const calls: string[] = [];
      // Los de antes no contestan: la rotación tiene que llegar a este.
      const fetchFn = (async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        return url.startsWith(relay) ? relayDeVerdad(url) : new Response("caído", { status: 503 });
      }) as typeof fetch;
      const got = await fetchRound(round, { fetchFn, delayMs: 0, attempts: QUICKNET.relays.length });
      expect(got).toEqual({ round, signature });
      const alRelay = calls.filter((u) => u.startsWith(relay));
      expect(alRelay).toEqual([relay === CLOUDFLARE ? `${relay}${V1_PATH}` : `${relay}${V2_PATH}`]);
      expect(calls).toHaveLength(i + 1);
    },
  );

  it("la dirección de cada relay es la de su ruta", () => {
    expect(roundEndpoint("https://api.drand.sh", round)).toBe(`https://api.drand.sh${V2_PATH}`);
    expect(roundEndpoint("https://api2.drand.sh", round)).toBe(`https://api2.drand.sh${V2_PATH}`);
    expect(roundEndpoint("https://api3.drand.sh", round)).toBe(`https://api3.drand.sh${V2_PATH}`);
    expect(roundEndpoint(CLOUDFLARE, round)).toBe(`${CLOUDFLARE}${V1_PATH}`);
    expect(roundEndpoint(CLOUDFLARE, round, "v2")).toBe(`${CLOUDFLARE}${V2_PATH}`);
  });

  it("si un relay deja de servir su ruta (404), pide la otra en el mismo intento", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith(V2_PATH) ? new Response("404 page not found", { status: 404 }) : new Response(V1_DRAND_SH, { status: 200 });
    }) as typeof fetch;
    // Un solo intento: la otra ruta no espera al próximo.
    const got = await fetchRound(round, { fetchFn, delayMs: 60_000, attempts: 1 });
    expect(got).toEqual({ round, signature });
    expect(calls).toEqual([`${QUICKNET.relays[0]}${V2_PATH}`, `${QUICKNET.relays[0]}${V1_PATH}`]);
  });

  it("una ronda que todavía no nació: 425 en drand.sh, 404 por las dos rutas en Cloudflare, y se sigue rotando", async () => {
    const calls: string[] = [];
    let nacio = false;
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (nacio) return relayDeVerdad(url);
      // Después del pedido a Cloudflare, la ronda ya está.
      if (url.startsWith(CLOUDFLARE) && url.endsWith(V2_PATH)) nacio = true;
      return url.startsWith(CLOUDFLARE) ? new Response("", { status: 404 }) : new Response("Requested future beacon", { status: 425 });
    }) as typeof fetch;
    const got = await fetchRound(round, { fetchFn, delayMs: 0, attempts: 6 });
    expect(got).toEqual({ round, signature });
    expect(calls).toEqual([
      `${QUICKNET.relays[0]}${V2_PATH}`,
      `${QUICKNET.relays[1]}${V2_PATH}`,
      `${QUICKNET.relays[2]}${V2_PATH}`,
      `${CLOUDFLARE}${V1_PATH}`,
      `${CLOUDFLARE}${V2_PATH}`,
      `${QUICKNET.relays[0]}${V2_PATH}`,
    ]);
  });

  it("las dos rutas dan la misma firma, y de ella la misma semilla", () => {
    const porV2 = readRound(JSON.parse(V2), round);
    const porV1 = readRound(JSON.parse(V1_CLOUDFLARE), round);
    expect(porV2).toBe(signature);
    expect(porV1).toBe(porV2);
    expect(readRound(JSON.parse(V1_DRAND_SH), round)).toBe(porV2);
    // La semilla sale de la firma, verificada, nunca del campo `randomness`
    // de la v1; que coincidan es lo que dice el protocolo.
    expect(verifyRound(round, porV1 as string)).toBe(true);
    expect(bytesToHex(randomnessOf(porV1 as string))).toBe(bytesToHex(randomnessOf(porV2 as string)));
    expect(bytesToHex(randomnessOf(porV1 as string))).toBe(JSON.parse(V1_CLOUDFLARE).randomness);
    expect(bytesToHex(randomnessOf(porV1 as string))).toBe(randomness);
  });

  it("lee bien cada respuesta y rechaza lo que no es la firma de esa ronda", () => {
    expect(readRound({ round: String(round), signature }, round)).toBe(signature);
    expect(readRound({ round, signature: signature.toUpperCase() }, round)).toBe(signature);
    expect(readRound({ round: round + 1, signature }, round)).toBeNull();
    expect(readRound({ signature }, round)).toBeNull();
    expect(readRound({ round, sig: signature }, round)).toBeNull();
    expect(readRound({ round, signature: signature.slice(2) }, round)).toBeNull();
    expect(readRound({ round, signature: `zz${signature.slice(2)}` }, round)).toBeNull();
    expect(readRound({ round, randomness }, round)).toBeNull();
    expect(readRound(null, round)).toBeNull();
    expect(readRound("texto", round)).toBeNull();
  });
});
