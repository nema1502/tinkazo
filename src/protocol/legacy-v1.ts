/**
 * Protocolo v1: el del demo original (agosto de 2026).
 *
 * Cadena *default* de drand (30 s, firmas encadenadas), ronda más reciente
 * después del sello y selección por hash de texto. Se conserva íntegro para
 * que la migración a Vite no cambie ningún resultado. Lo reemplaza el
 * protocolo v2 (docs/protocolo.md) en las historias 2.2 y 2.3.
 */

export interface Beacon {
  round: number;
  randomness: string;
  signature?: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getLatestBeacon(): Promise<Beacon> {
  const res = await fetch("https://api.drand.sh/public/latest");
  if (!res.ok) throw new Error("drand " + res.status);
  return (await res.json()) as Beacon;
}

export function roundUrl(round: number): string {
  return `https://api.drand.sh/public/${round}`;
}

/** `sha256(randomness|digest|p) mod pool`, extrayendo sin reemplazo. */
export async function selectV1(
  randomness: string,
  digest: string,
  count: number,
  k: number,
): Promise<number[]> {
  const winners: number[] = [];
  const pool = Array.from({ length: count }, (_, i) => i);
  for (let p = 0; p < k && pool.length > 0; p++) {
    const h = await sha256Hex(`${randomness}|${digest}|${p}`);
    const idx = Number(BigInt("0x" + h) % BigInt(pool.length));
    winners.push(pool.splice(idx, 1)[0] as number);
  }
  return winners;
}
