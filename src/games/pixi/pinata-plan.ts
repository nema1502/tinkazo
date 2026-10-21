/**
 * El calendario de los palos de la piñata (puro: sin Pixi ni DOM).
 *
 * Cada palo suelta uno o más caramelos, o falla. Al principio caen muchos y al
 * final de a uno. Con poca gente no hay caramelos para tantos palos: antes, con
 * cinco palos y dos o tres caramelos, la mayoría pegaba al aire sin que cayera
 * nadie. Ahora hay tantos palos que sueltan como caramelos, con un fallo antes
 * de cada uno, y con dos personas (ningún caramelo que soltar) el palo falla dos
 * veces antes de la rotura.
 */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface Palo {
  /** `true`: el palo pega al aire (un fallo, sin nadie que caiga). */
  miss: boolean;
  /** Cuántos caramelos suelta este palo; 0 si falla. */
  take: number;
  /** Segundos hasta el palo siguiente. */
  wait: number;
}

/**
 * La lista de palos para `caen` caramelos (todos menos el ganador y la rival que
 * queda para la rotura, o sea los que caen con los palos). `base` es la cantidad
 * de palos con mucha gente; `remontada` mete dos fallos antes del penúltimo palo.
 */
export function planPalos(caen: number, base: number, remontada: boolean): Palo[] {
  const nHits = Math.min(Math.max(0, base), Math.max(0, caen));
  const pocos = caen < base;
  const spare = caen - nHits;
  const weights = Array.from({ length: nHits }, (_, i) => Math.pow(nHits - i, 1.6));
  const wsum = weights.reduce((a, b) => a + b, 0);
  // Cada palo suelta uno como mínimo; el resto, con peso decreciente, y lo que
  // sobra del redondeo va al último.
  const extra = weights.map((w) => Math.floor((spare * w) / wsum));
  if (nHits > 0) extra[nHits - 1] = (extra[nHits - 1] as number) + spare - extra.reduce((a, b) => a + b, 0);
  const out: Palo[] = [];
  for (let i = 0; i < nHits; i++) {
    if (remontada && i === nHits - 2) {
      out.push({ miss: true, take: 0, wait: 1.0 });
      out.push({ miss: true, take: 0, wait: 1.05 });
    }
    if (pocos) out.push({ miss: true, take: 0, wait: 1.1 });
    // Los palos se apuran: de 1,9 a 0,75 s entre uno y otro.
    out.push({ miss: false, take: 1 + (extra[i] as number), wait: clamp(1.9 - i * 0.17, 0.75, 1.9) });
  }
  if (nHits === 0) {
    out.push({ miss: true, take: 0, wait: 1.1 });
    out.push({ miss: true, take: 0, wait: 1.1 });
  }
  return out;
}
