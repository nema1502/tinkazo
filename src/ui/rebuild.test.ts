import { describe, expect, it } from "vitest";
import { rearmar } from "./rebuild";
import { canonicalList, listHash } from "../protocol/canonical";
import { bytesToHex } from "../protocol/drand";
import { decodeProof } from "../protocol/proof";
import type { Entry } from "./history";

const LISTA = "María Quispe\nJorge Mamani\nLucía Flores";
const BASE = "https://tinkazo.vercel.app";

const fila = (over: Partial<Entry> = {}): Entry => ({
  id: "7",
  organizer: "GBZ3H2GDQV73TUPY4DFGQYPUXWUUPVJHP77VXSRF6N5P66DWPDR35KWW",
  listHash: bytesToHex(listHash(canonicalList(LISTA))),
  count: 3,
  numWinners: 1,
  round: 32_430_533,
  sealedAt: 1_789_957_797,
  prize: "Un libro",
  fromChain: true,
  ...over,
});

describe("rearmar el comprobante", () => {
  it("con la lista de verdad devuelve un comprobante que se puede abrir", async () => {
    const r = await rearmar(fila(), LISTA, BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url.startsWith(`${BASE}/verificar.html#`)).toBe(true);
    const proof = await decodeProof(r.url.slice(r.url.indexOf("#")));
    expect(proof.names).toEqual(canonicalList(LISTA));
    expect(proof.round).toBe(32_430_533);
    expect(proof.prize).toBe("Un libro");
    expect(proof.id).toBe("7");
  });

  it("con otra lista del mismo tamaño no arma nada: la huella no coincide", async () => {
    const r = await rearmar(fila(), "María Quispe\nJorge Mamani\nAna Vargas", BASE);
    expect(r).toEqual({ ok: false, motivo: "huella" });
  });

  it("un nombre de más se avisa como lo que es, y dice cuántos había", async () => {
    const r = await rearmar(fila(), `${LISTA}\nDiego Rojas`, BASE);
    expect(r).toEqual({ ok: false, motivo: "cantidad", cuantos: 4 });
  });

  it("el orden importa: es la lista canónica, no un conjunto", async () => {
    const r = await rearmar(fila(), "Jorge Mamani\nMaría Quispe\nLucía Flores", BASE);
    expect(r).toEqual({ ok: false, motivo: "huella" });
  });

  it("las líneas vacías y los espacios de más no rompen nada", async () => {
    const r = await rearmar(fila(), `  María Quispe  \n\nJorge Mamani\n  Lucía Flores\n\n`, BASE);
    expect(r.ok).toBe(true);
  });
});
