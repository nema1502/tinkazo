import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { canonicalList, listHash } from "../protocol/canonical";
import { datosDeLaLista, GANADORES, LISTA_DE_EJEMPLO } from "./lista";

describe("la lista de ejemplo", () => {
  it("son tres nombres de muestra y gana una persona", () => {
    expect([...LISTA_DE_EJEMPLO]).toEqual(["Ana", "Nora", "Beto"]);
    expect(GANADORES).toBe(1);
  });

  it("la huella es la de la lista canónica, de 32 bytes", () => {
    const d = datosDeLaLista();
    expect(d.nombres).toEqual(["Ana", "Nora", "Beto"]);
    expect(d.cantidad).toBe(3);
    expect(d.huella).toHaveLength(32);
    expect(bytesToHex(d.huella)).toBe(bytesToHex(listHash(canonicalList("Ana\nNora\nBeto"))));
  });
});
