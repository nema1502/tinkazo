import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Lista canónica (docs/protocolo.md §1).
 *
 * Una línea por participante; de un CSV se toma la primera columna. Se recorta,
 * se descartan líneas de menos de 2 caracteres y los duplicados exactos
 * (sensible a mayúsculas), conservando la primera aparición y el orden.
 */
export function canonicalList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = (raw.split(",")[0] ?? "").trim();
    if (name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Bytes que se hashean: UTF-8 de las entradas unidas por `\n`, sin salto final. */
export function encodeList(names: string[]): Uint8Array {
  return new TextEncoder().encode(names.join("\n"));
}

/** `list_hash = SHA-256(encodeList(names))`. */
export function listHash(names: string[]): Uint8Array {
  return sha256(encodeList(names));
}
