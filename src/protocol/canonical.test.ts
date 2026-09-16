import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import vectors from "../../docs/vectors.json";
import { canonicalList, encodeList, listHash } from "./canonical";

describe("lista canónica (protocolo §1)", () => {
  it("reproduce la lista y el hash de docs/vectors.json", () => {
    const names = canonicalList(vectors.list.join("\n"));
    expect(names).toEqual(vectors.list);
    expect(names.length).toBe(vectors.count);
    expect(bytesToHex(listHash(names))).toBe(vectors.list_hash);
  });

  it("recorta, toma la primera columna de un CSV y descarta líneas cortas", () => {
    const text = "  Ana Vargas , ana@x.bo\r\nJ\n\nDiego Rojas,diego\n   \n";
    expect(canonicalList(text)).toEqual(["Ana Vargas", "Diego Rojas"]);
  });

  it("descarta duplicados exactos conservando la primera aparición y el orden", () => {
    expect(canonicalList("Ana\nDiego\nAna\nana\nDiego")).toEqual(["Ana", "Diego", "ana"]);
  });

  it("codifica sin salto de línea final", () => {
    expect(new TextDecoder().decode(encodeList(["a1", "b2"]))).toBe("a1\nb2");
  });
});
