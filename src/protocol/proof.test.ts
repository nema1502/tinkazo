import { describe, expect, it } from "vitest";
import vectors from "../../docs/vectors.json";
import {
  PROOF_VERSION,
  type Proof,
  conHashesValidos,
  decodePreview,
  decodeProof,
  encodeFragment,
  encodeProof,
  hashDeTx,
  isAnchored,
  previewUrl,
  proofFile,
  proofUrl,
} from "./proof";

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

/**
 * Los hashes de las transacciones del sello y del sorteo (`stx`, `dtx`). Con el del
 * sello la verificación sigue dando verde cuando el estado del contrato ya venció
 * (`stellar/historial.ts`); sin ellos, un comprobante se verifica como siempre.
 */
describe("comprobante con los hashes de las transacciones", () => {
  const STX = "66f498d7b937e20209f765bc995121c9e4c85567cd70232e9890c4e2f07cae0e";
  const DTX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const conHashes: Proof = { ...anclado, stx: STX, dtx: DTX };

  it("van y vuelven por el enlace, y por el archivo del comprobante", async () => {
    expect(await decodeProof(await encodeProof(conHashes))).toEqual(conHashes);
    const url = await proofUrl(conHashes, "https://tinkazo.app");
    expect(await decodeProof(url.slice(url.indexOf("#")))).toEqual(conHashes);
    const archivo = JSON.parse(await proofFile(conHashes).text()) as Proof;
    expect(archivo.stx).toBe(STX);
    expect(archivo.dtx).toBe(DTX);
    expect(archivo.names).toEqual(anclado.names);
  });

  it("uno solo también va: el del sello sin el del sorteo (un sorteo pendiente)", async () => {
    const soloSello: Proof = { ...anclado, stx: STX };
    const leido = await decodeProof(await encodeProof(soloSello));
    expect(leido).toEqual(soloSello);
    expect("dtx" in leido).toBe(false);
  });

  it("un comprobante anterior, sin ellos, se lee igual y no los inventa", async () => {
    for (const viejo of [libre, anclado]) {
      const leido = await decodeProof(await encodeProof(viejo));
      expect(leido).toEqual(viejo);
      expect("stx" in leido).toBe(false);
      expect("dtx" in leido).toBe(false);
    }
    // Y uno armado a mano antes de que existieran, sin pasar por `encodeProof`.
    const crudo = await decodeProof(await encodeFragment({ v: 2, names: ["Ana", "Beto"], round: 5, net: "testnet", contract: "C", id: "1" }));
    expect(Object.keys(crudo).sort()).toEqual(["contract", "id", "names", "net", "round", "v"]);
  });

  it("lo que no son 64 hexadecimales se descarta, sin tirar el comprobante", async () => {
    const basura: unknown[] = [
      "",
      "abc",
      STX.slice(1),
      `${STX}0`,
      ` ${STX}`,
      `${STX}\n`,
      STX.replace(/.$/, "g"),
      `0x${STX.slice(2)}`,
      "<script>alert(1)</script>",
      12345,
      true,
      null,
      [STX],
      { hash: STX },
    ];
    for (const valor of basura) {
      const fragmento = await encodeFragment({ ...anclado, stx: valor, dtx: valor });
      const leido = await decodeProof(fragmento);
      expect("stx" in leido, JSON.stringify(valor)).toBe(false);
      expect("dtx" in leido, JSON.stringify(valor)).toBe(false);
      // Lo demás del comprobante sigue.
      expect(leido.names).toEqual(anclado.names);
      expect(leido.id).toBe(anclado.id);
    }
    // Uno bueno y uno malo: se queda el bueno.
    const mixto = await decodeProof(await encodeFragment({ ...anclado, stx: STX, dtx: "no" }));
    expect(mixto.stx).toBe(STX);
    expect("dtx" in mixto).toBe(false);
  });

  it("al armarlo tampoco viaja lo mal formado: ni en el enlace ni en el archivo", async () => {
    const roto = { ...anclado, stx: "no soy un hash", dtx: 7 } as unknown as Proof;
    const leido = await decodeProof(await encodeProof(roto));
    expect("stx" in leido || "dtx" in leido).toBe(false);
    const archivo = JSON.parse(await proofFile(roto).text()) as Record<string, unknown>;
    expect("stx" in archivo || "dtx" in archivo).toBe(false);
  });

  it("las mayúsculas se pasan a minúsculas: es el mismo hash", () => {
    expect(hashDeTx(STX.toUpperCase())).toBe(STX);
    expect(conHashesValidos({ stx: STX.toUpperCase() }).stx).toBe(STX);
    expect(hashDeTx(undefined)).toBeNull();
    expect(hashDeTx(STX)).toBe(STX);
  });

  it("no cambia nada más: los demás campos quedan como estaban", () => {
    const original = { ...conHashes, signature: "ab", prize: "Una polera" };
    const limpio = conHashesValidos(original);
    expect(limpio).toEqual(original);
    expect(limpio).not.toBe(original);
  });
});

describe("la lista para revisar antes de sellar", () => {
  it("va y vuelve por el enlace, con tildes y todo", async () => {
    const names = ["María Quispe", "Jorge Mamani", "Ñusta Condori"];
    const url = await previewUrl(names, "Una polera", "https://tinkazo.app");
    expect(url.startsWith("https://tinkazo.app/lista.html#")).toBe(true);
    const back = await decodePreview(url.slice(url.indexOf("#")));
    expect(back.names).toEqual(names);
    expect(back.prize).toBe("Una polera");
    expect(back.kind).toBe("lista");
  });

  it("no confunde un comprobante con una lista", async () => {
    const proof = { v: PROOF_VERSION, names: ["A", "B"], round: 1, sealedAt: 1 } as Proof;
    await expect(decodePreview(await encodeProof(proof))).rejects.toThrow();
  });
});
