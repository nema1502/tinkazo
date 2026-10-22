import { sha256 } from "@noble/hashes/sha2.js";
import { listHash } from "./protocol/canonical";
import { hexToBytes } from "./protocol/quicknet";
import { MAX_WINNERS, select } from "./protocol/select";

/**
 * Quiénes ganan en la escena fija (`?pose=`, `poseScene` en src/main.ts).
 *
 * La escena fija es para capturas y auditores: no sella, no sortea y no toca
 * la red, así que siempre es modo libre. Sin `?ganador=` ganan los de siempre:
 * el puesto 3 (desde cero) y, con varios premios (`?nw=`), los que siguen de a
 * siete por la lista. Con el ganador siempre en el mismo puesto, el auditor de
 * delatores no puede medir si un juego lo delata por dónde está.
 *
 * Con `?ganador=<semilla>` ganan los que elegiría el protocolo (§5) con esa
 * semilla en lugar del número del faro: `select(semilla, listHash(lista), n,
 * premios)`, hasta 32 como en un sorteo de verdad. Doscientas semillas dan
 * ganadores repartidos por toda la lista, sin `Math.random` ni red. La semilla
 * son 64 caracteres hex, la misma forma que `?semilla=` (con el mismo valor en
 * los dos, ganan los mismos y se cuenta lo mismo que en un sorteo de verdad
 * con ese número), o cualquier otro texto, que se pasa por SHA-256:
 * `?ganador=17` es la semilla "17", no el puesto 17.
 *
 * Un sorteo de verdad, anclado o libre, nunca pasa por acá: elige con el
 * número del faro (src/ui/draw.ts) o lee los ganadores del contrato.
 */
export function poseWinners(names: readonly string[], prizes: number, ganador: string | null): number[] {
  const n = names.length;
  const seed = poseSeed(ganador);
  if (seed && n >= 2) return select(seed, listHash([...names]), n, Math.max(1, Math.min(prizes, n, MAX_WINNERS)));
  // Los de siempre, como antes de `?ganador=`: con un premio la escena no cambia.
  const fixed: number[] = [Math.min(3, n - 1)];
  for (let i = 1; fixed.length < prizes && i < n * 7; i++) {
    const w = (3 + i * 7) % n;
    if (!fixed.includes(w)) fixed.push(w);
  }
  for (let w = 0; fixed.length < prizes; w++) if (!fixed.includes(w)) fixed.push(w);
  return fixed;
}

/** La semilla de `?ganador=`: 64 hex tal cual y cualquier otro texto por SHA-256. `null` sin el parámetro o vacío. */
export function poseSeed(raw: string | null): Uint8Array | null {
  const v = raw?.trim() ?? "";
  if (!v) return null;
  return /^[0-9a-f]{64}$/i.test(v) ? hexToBytes(v.toLowerCase()) : sha256(new TextEncoder().encode(v));
}
