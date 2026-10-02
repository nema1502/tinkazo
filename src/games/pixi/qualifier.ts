/**
 * La clasificatoria: cómo un juego que se lee hasta 12 nombres cuenta un
 * sorteo de 50 o de 200.
 *
 * Al empezar aparecen todos los nombres, y en una a tres oleadas se van
 * tachando hasta que quedan los finalistas, que siempre incluyen a los
 * ganadores. Después el juego se juega con los finalistas. No decide nada: los
 * ganadores ya salieron del protocolo antes de que arranque la animación, y
 * quiénes acompañan a los ganadores en la final se elige con el `rng` sembrado
 * de la ronda, así que la misma ronda dibuja la misma clasificatoria.
 *
 * Puro, sin Pixi ni DOM, para probarlo en Node.
 */

export interface Qualifier {
  /** Los índices (en la lista original) de los finalistas, en el orden en que se sientan en el juego. */
  finalists: number[];
  /** Los que se van en cada oleada, en orden. Vacío si todos son finalistas. */
  waves: number[][];
  /** Dónde quedó cada ganador dentro de `finalists`, en el orden de `winners`. */
  finalWinners: number[];
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** Cuántas oleadas según cuántos se van: una sola si son pocos, tres si son muchos. */
export function wavesFor(out: number): number {
  if (out <= 0) return 0;
  if (out <= 16) return 1;
  if (out <= 60) return 2;
  return 3;
}

/**
 * Arma la clasificatoria de `n` nombres hasta `cap` finalistas. Con `n <= cap`
 * no hay oleadas: todos son finalistas, en el orden de la lista.
 */
export function planQualifier(n: number, winners: readonly number[], cap: number, rng: () => number): Qualifier {
  if (cap < 1) throw new Error("cap inválido");
  if (new Set(winners).size !== winners.length || winners.some((w) => !Number.isInteger(w) || w < 0 || w >= n)) {
    throw new Error("ganadores inválidos");
  }
  if (winners.length > cap) throw new Error("más ganadores que lugares en la final");
  if (n <= cap) {
    return { finalists: Array.from({ length: n }, (_, i) => i), waves: [], finalWinners: [...winners] };
  }
  const ganadores = new Set(winners);
  const otros = shuffle(Array.from({ length: n }, (_, i) => i).filter((i) => !ganadores.has(i)), rng);
  const acompanan = otros.slice(0, cap - winners.length);
  const afuera = otros.slice(cap - winners.length);
  const finalists = shuffle([...winners, ...acompanan], rng);
  // Las oleadas se achican: la primera se lleva a la mayoría y la última a
  // pocos, así el final de la clasificatoria tiene suspenso.
  const W = wavesFor(afuera.length);
  const pesos = W === 1 ? [1] : W === 2 ? [2, 1] : [3, 2, 1];
  const suma = pesos.reduce((a, b) => a + b, 0);
  const waves: number[][] = [];
  let desde = 0;
  pesos.forEach((p, i) => {
    const cuantos = i === pesos.length - 1 ? afuera.length - desde : Math.round((afuera.length * p) / suma);
    waves.push(afuera.slice(desde, desde + cuantos));
    desde += cuantos;
  });
  return { finalists, waves, finalWinners: winners.map((w) => finalists.indexOf(w)) };
}
