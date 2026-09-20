import { bls12_381 } from "@noble/curves/bls12-381.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * drand quicknet en el navegador (docs/protocolo.md §2 y §6).
 *
 * Parámetros públicos de la cadena, cálculo de rondas, obtención de una ronda
 * rotando relays, verificación de la firma BLS y descompresión del punto G1
 * que el contrato necesita.
 */

export const QUICKNET = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  /** Clave pública en G2, comprimida (96 bytes). */
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisTime: 1_692_803_367,
  period: 3,
  scheme: "bls-unchained-g1-rfc9380",
  relays: [
    "https://api.drand.sh",
    "https://api2.drand.sh",
    "https://api3.drand.sh",
    "https://drand.cloudflare.com",
  ],
} as const;

/** DST de RFC 9380 para firmas cortas en G1. */
export const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

/** Instante (Unix, segundos) en que se publica una ronda. La ronda 1 nace en el génesis. */
export function roundTime(round: number): number {
  return QUICKNET.genesisTime + (Math.max(1, round) - 1) * QUICKNET.period;
}

/** Ronda vigente en un instante (Unix, segundos). */
export function roundAt(timestamp: number): number {
  if (timestamp < QUICKNET.genesisTime) return 1;
  return Math.floor((timestamp - QUICKNET.genesisTime) / QUICKNET.period) + 1;
}

/** Primera ronda cuya publicación ocurre al menos `leadSeconds` después de `now`. */
export function targetRound(nowSeconds: number, leadSeconds: number): number {
  let r = roundAt(nowSeconds + leadSeconds);
  while (roundTime(r) < nowSeconds + leadSeconds) r++;
  return r;
}

export interface RoundSignature {
  round: number;
  /** Firma G1 comprimida, 48 bytes en hex. */
  signature: string;
}

/** URL legible de una ronda (API v1, incluye `randomness`). */
export function roundUrl(round: number): string {
  return `${QUICKNET.relays[0]}/${QUICKNET.chainHash}/public/${round}`;
}

/**
 * Obtiene la firma de una ronda rotando relays. Reintenta hasta `attempts`
 * veces en total, esperando `delayMs` entre intentos: la ronda puede tardar
 * unos segundos en propagarse tras su `roundTime`.
 */
export async function fetchRound(
  round: number,
  opts: {
    attempts?: number;
    delayMs?: number;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
    /** Se llama antes de cada intento, para que la interfaz no quede muda. */
    onAttempt?: (attempt: number, total: number) => void;
  } = {},
): Promise<RoundSignature> {
  const attempts = opts.attempts ?? 12;
  const delayMs = opts.delayMs ?? 2_000;
  const doFetch = opts.fetchFn ?? fetch;
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    const relay = QUICKNET.relays[i % QUICKNET.relays.length];
    opts.onAttempt?.(i + 1, attempts);
    try {
      const res = await doFetch(`${relay}/v2/chains/${QUICKNET.chainHash}/rounds/${round}`, {
        signal: opts.signal ?? null,
        cache: "no-store",
      });
      if (res.ok) {
        const body = (await res.json()) as { round?: number; signature?: string };
        if (body.round === round && typeof body.signature === "string" && body.signature.length === 96) {
          return { round, signature: body.signature };
        }
        lastError = new Error("respuesta inesperada del relay");
      } else {
        lastError = new Error(`relay ${res.status}`);
      }
    } catch (e) {
      lastError = e;
      if (opts.signal?.aborted) throw e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw lastError instanceof Error ? lastError : new Error("no se pudo obtener la ronda");
}

/** Mensaje firmado por quicknet: `sha256(be64(round))`. */
export function roundMessage(round: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(round));
  return sha256(b);
}

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;

/** Verifica que la firma (48 bytes hex) pertenece a la ronda dada. Nunca lanza. */
export function verifyRound(round: number, signatureHex: string): boolean {
  try {
    const sig = G1.fromHex(signatureHex);
    const pk = G2.fromHex(QUICKNET.publicKey);
    const h = bls12_381.shortSignatures.hash(roundMessage(round), DST);
    return bls12_381.shortSignatures.verify(sig, h, pk);
  } catch {
    return false;
  }
}

/** Semilla del sorteo: `sha256(firma comprimida)`, igual al `randomness` de drand. */
export function randomnessOf(signatureHex: string): Uint8Array {
  return sha256(hexToBytes(signatureHex));
}

/** Firma en formato G1 sin comprimir (96 bytes, `x || y`), el que acepta el contrato. */
export function decompressG1(signatureHex: string): Uint8Array {
  return G1.fromHex(signatureHex).toBytes(false);
}

export { bytesToHex, hexToBytes };
