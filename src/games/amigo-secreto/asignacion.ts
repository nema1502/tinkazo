/**
 * Amigo secreto: la asignación, pura.
 *
 * Dada la lista de participantes y la semilla del faro (`beacon.randomness`),
 * devuelve la asignación: `asignacion[i]` es el puesto de la persona a quien la
 * persona `i` le regala. Es una permutación completa (todos dan, todos
 * reciben) y nadie se autoasigna: es un derangement por construcción.
 *
 * La misma función la usará la verificación del comprobante (T3): show y
 * verificación recalculan lo mismo desde la misma lista sellada y la misma
 * semilla, y por eso este módulo no importa nada del sitio ni del motor: es
 * puro, sin DOM, sin reloj y sin `Math.random`. La misma semilla da siempre la
 * misma asignación; nadie la elige.
 *
 * El generador es mulberry32 sembrado con la semilla (hash FNV-1a de la
 * cadena), el mismo esquema de `src/ui/azar.ts` y de `kit/azar.ts`, copiado
 * acá para que la verificación pueda compartir este archivo sin arrastrar el
 * kit ni PixiJS.
 *
 * Cómo sale un derangement: se mezclan los puestos con Fisher-Yates sembrado y
 * el resultado se lee como un único ciclo (cada uno le regala al siguiente del
 * ciclo, y el último al primero). Con dos o más personas un ciclo completo no
 * tiene puntos fijos por construcción; de todos modos se verifica y, si
 * hubiera uno (no debería), se rota hasta que no quede ninguno.
 */

/** Un número de 32 bits para un texto (FNV-1a): misma semilla, mismo número. */
function hashTexto(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** El generador sembrado (mulberry32): de la misma semilla, la misma secuencia. */
function sembrado(semilla: number): () => number {
  let s = semilla | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La asignación del amigo secreto: `resultado[i]` es a quién le regala la
 * persona del puesto `i`. Con menos de dos personas no hay juego: devuelve
 * `null`. Determinista: la misma lista y la misma semilla dan la misma
 * asignación, y nadie se autoasigna nunca.
 */
export function asignarAmigos(nombres: readonly string[], semilla: string): readonly number[] | null {
  const n = nombres.length;
  if (n < 2) return null;
  const rng = sembrado(hashTexto(semilla));
  // Fisher-Yates sembrado sobre los puestos.
  const ciclo = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ciclo[i], ciclo[j]] = [ciclo[j] as number, ciclo[i] as number];
  }
  // El ciclo: cada uno le regala al siguiente, y el último al primero.
  const asignacion = new Array<number>(n);
  for (let k = 0; k < n; k++) asignacion[ciclo[k] as number] = ciclo[(k + 1) % n] as number;
  // Defensa en profundidad: un punto fijo no debería existir (el ciclo es
  // completo con n ≥ 2), pero si entrara uno se rota ese aro hasta que no quede.
  const fijos = asignacion.filter((destino, i) => destino === i).length;
  if (fijos > 0) {
    for (let i = 0; i < n; i++) {
      if (asignacion[i] === i) {
        const j = (i + 1) % n;
        [asignacion[i], asignacion[j]] = [asignacion[j] as number, i];
      }
    }
  }
  return asignacion;
}
