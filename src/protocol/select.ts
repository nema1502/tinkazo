import { sha256 } from "@noble/hashes/sha2.js";

/** Cota superior de ganadores, igual que `MAX_WINNERS` en el contrato. */
export const MAX_WINNERS = 32;

/**
 * Selección determinista (docs/protocolo.md §5). Idéntica a
 * `contracts/raffle/src/select.rs`; ambas pasan `docs/vectors.json`.
 *
 * ```text
 * ctr = 0
 * mientras faltan ganadores:
 *   h   = sha256(randomness || list_hash || be32(ctr))
 *   idx = be64(h[0..8]) mod count
 *   si idx no fue elegido: agregarlo
 *   ctr += 1
 * ```
 */
export function select(randomness: Uint8Array, listHash: Uint8Array, count: number, k: number): number[] {
  if (randomness.length !== 32 || listHash.length !== 32) {
    throw new RangeError("randomness y list_hash deben tener 32 bytes");
  }
  if (!Number.isInteger(count) || count < 2) throw new RangeError("count debe ser un entero >= 2");
  if (!Number.isInteger(k) || k < 1 || k > count || k > MAX_WINNERS) {
    throw new RangeError(`k debe estar entre 1 y min(count, ${MAX_WINNERS})`);
  }
  const pre = new Uint8Array(68);
  pre.set(randomness, 0);
  pre.set(listHash, 32);
  const ctrView = new DataView(pre.buffer);
  const out: number[] = [];
  let ctr = 0;
  while (out.length < k) {
    ctrView.setUint32(64, ctr);
    const h = sha256(pre);
    const first8 = new DataView(h.buffer, h.byteOffset, 8).getBigUint64(0);
    const idx = Number(first8 % BigInt(count));
    if (!out.includes(idx)) out.push(idx);
    ctr++;
  }
  return out;
}
