import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/**
 * drand quicknet sin la curva (docs/protocolo.md §2).
 *
 * Parámetros públicos de la cadena, cálculo de rondas, obtención de una ronda
 * rotando relays y la semilla que sale de una firma. La verificación BLS vive
 * en `drand.ts`, aparte, porque pesa unos 75 KB: la portada, la cuenta
 * regresiva y la lista no la necesitan, y se carga con `import()` recién al
 * sortear o al verificar.
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

/** Uno de los relays de `QUICKNET.relays`. */
export type Relay = (typeof QUICKNET.relays)[number];

/**
 * Las dos rutas por las que un relay entrega una ronda. Las dos devuelven
 * `round` y `signature`; la v1 agrega `randomness`, que acá no se lee: la
 * semilla sale de la firma, y la firma se verifica antes de usarla (§2).
 */
export type RoundRoute = "v2" | "v1";

/**
 * La ruta que se le pide primero a cada relay. Los tres de drand.sh sirven
 * las dos; el de Cloudflare responde 404 a la v2 y sirve la v1 (medido el 21
 * de octubre de 2026 con la ronda 1000000). Hasta entonces se le pedía la v2 a
 * los cuatro, y el respaldo de los otros tres fallaba siempre.
 */
const FIRST_ROUTE: Readonly<Record<Relay, RoundRoute>> = {
  "https://api.drand.sh": "v2",
  "https://api2.drand.sh": "v2",
  "https://api3.drand.sh": "v2",
  "https://drand.cloudflare.com": "v1",
};

/** La dirección de una ronda en un relay; sin `route`, la que ese relay sirve. */
export function roundEndpoint(relay: Relay, round: number, route: RoundRoute = FIRST_ROUTE[relay]): string {
  return route === "v2"
    ? `${relay}/v2/chains/${QUICKNET.chainHash}/rounds/${round}`
    : `${relay}/${QUICKNET.chainHash}/public/${round}`;
}

/**
 * La firma que trae la respuesta de cualquiera de las dos rutas, en hex y en
 * minúsculas, o `null` si no es la de esa ronda o no tiene forma de firma. No
 * la verifica: eso es `verifyRound`, en `drand.ts`.
 */
export function readRound(body: unknown, round: number): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { round: r, signature } = body as { round?: unknown; signature?: unknown };
  // El número de ronda llega como número; un relay que lo mande como texto también sirve.
  if ((typeof r !== "number" && typeof r !== "string") || Number(r) !== round) return null;
  return typeof signature === "string" && /^[0-9a-f]{96}$/i.test(signature) ? signature.toLowerCase() : null;
}

/** URL legible de una ronda (API v1, incluye `randomness`). */
export function roundUrl(round: number): string {
  return `${QUICKNET.relays[0]}/${QUICKNET.chainHash}/public/${round}`;
}

/**
 * Obtiene la firma de una ronda rotando relays. Reintenta hasta `attempts`
 * veces en total, esperando `delayMs` entre intentos: la ronda puede tardar
 * unos segundos en propagarse tras su `roundTime`.
 *
 * A cada relay le pide la ruta que sirve. Si contesta 404, en el mismo
 * intento le pide la otra: así un relay que deja de servir una ruta no apaga
 * el respaldo. Una ronda que todavía no nació también da 404 en Cloudflare, y
 * entonces son dos pedidos en vez de uno, nada más.
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
    const relay = QUICKNET.relays[i % QUICKNET.relays.length] as Relay;
    opts.onAttempt?.(i + 1, attempts);
    const first = FIRST_ROUTE[relay];
    for (const route of [first, first === "v2" ? "v1" : "v2"] as const) {
      try {
        const res = await doFetch(roundEndpoint(relay, round, route), {
          signal: opts.signal ?? null,
          cache: "no-store",
        });
        if (res.ok) {
          const signature = readRound(await res.json(), round);
          if (signature) return { round, signature };
          lastError = new Error("respuesta inesperada del relay");
        } else {
          lastError = new Error(`relay ${res.status}`);
          // Esta ruta no está en este relay: la otra, sin esperar.
          if (res.status === 404) continue;
        }
      } catch (e) {
        lastError = e;
        if (opts.signal?.aborted) throw e;
      }
      break;
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

/** Semilla del sorteo: `sha256(firma comprimida)`, igual al `randomness` de drand. */
export function randomnessOf(signatureHex: string): Uint8Array {
  return sha256(hexToBytes(signatureHex));
}

export { bytesToHex, hexToBytes };
