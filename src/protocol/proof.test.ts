import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import { PROOF_VERSION, type Proof, decodeProof, encodeProof, isAnchored } from "./proof";

const libre: Proof = {
  v: PROOF_VERSION,
  names: vectors.list,
  round: vectors.quicknet.round,
  signature: vectors.quicknet.signature,
  prize: "Una polera de Tinkazo",
  sealedAt: 1_789_568_200,
};

const anclado: Proof = {
  v: PROOF_VERSION,
  names: vectors.list,
  round: vectors.quicknet.round,
  net: "testnet",
  contract: "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH",
  id: "4",
};

describe("comprobante", () => {
  it("va y vuelve sin perder nada", async () => {
    for (const p of [libre, anclado]) {
      expect(await decodeProof(await encodeProof(p))).toEqual(p);
    }
  });

  it("tolera el numeral adelante", async () => {
    const frag = await encodeProof(anclado);
    expect(await decodeProof("#" + frag)).toEqual(anclado);
  });

  it("comprime una lista larga bastante más que el JSON crudo", async () => {
    const grande: Proof = {
      v: PROOF_VERSION,
      names: Array.from({ length: 200 }, (_, i) => `Participante número ${i}`),
      round: 32_254_977,
    };
    const frag = await encodeProof(grande);
    expect(frag[0]).toBe("z");
    expect(frag.length).toBeLessThan(JSON.stringify(grande).length / 2);
  });

  it("usa base64url: el enlace no se rompe al compartirlo", async () => {
    const frag = await encodeProof(libre);
    expect(frag.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("distingue un sorteo anclado de uno en modo libre", () => {
    expect(isAnchored(anclado)).toBe(true);
    expect(isAnchored(libre)).toBe(false);
  });

  it("rechaza basura en vez de inventar un sorteo", async () => {
    await expect(decodeProof("")).rejects.toThrow();
    await expect(decodeProof("x")).rejects.toThrow();
    await expect(decodeProof("qZZZZ")).rejects.toThrow();
    await expect(decodeProof("r" + btoa('{"v":2}'))).rejects.toThrow("proof-malformed");
  });
});
