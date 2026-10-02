/**
 * ¿Quién es?: la mitad pura del juego (sin Pixi, sin DOM, sin Math.random).
 *
 * Todos los nombres están en cartas. En cada turno se pregunta por una letra
 * ("¿tiene la R?") y se dan vuelta las cartas que no coinciden con quien ganó:
 * si su nombre tiene la R, se van las que no la tienen; si no la tiene, se van
 * las que sí. Al final queda su carta sola.
 *
 * No decide nada: el ganador sale del protocolo antes, y las preguntas se
 * eligen sabiendo quién es, para partir el grupo más o menos a la mitad. Así
 * 50 nombres se resuelven en unas seis preguntas y 200 en unas ocho. El nombre
 * escondido no se muestra ni se cuenta su largo: lo que la sala ve son las
 * cartas que se dan vuelta.
 *
 * Nació del Ahorcado que propuso Guido Salazar (PR #1). La horca no podía
 * quedar, y el largo del nombre delataba al ganador antes de la primera letra
 * (agente evaluador, 2 de octubre de 2026). Lo que valía, revelar letra por
 * letra mientras la lista se achica, sigue acá.
 */

/**
 * Lo que se pregunta: las letras sin tildes (la Ñ cuenta como N) y los
 * números, que separan a "Invitado 1" de "Invitado 2", algo común en las
 * listas de los eventos.
 */
export const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `true` si lo que se pregunta es un número y no una letra. */
export const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/** Las letras de un nombre, en mayúsculas, sin tildes ni signos. */
export function lettersOf(name: string): Set<string> {
  const plano = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  return new Set(Array.from(plano).filter((c) => ABC.includes(c)));
}

export interface Question {
  letter: string;
  /** Si el nombre de quien ganó tiene esa letra. */
  has: boolean;
  /** Los que siguen en pie después de esta pregunta (índices de la lista). */
  remaining: number[];
  /** Los que se dan vuelta en esta pregunta. */
  out: number[];
}

export interface Round {
  /** El índice del ganador de esta ronda. */
  winner: number;
  /** Con quiénes arranca la ronda: todos menos los ganadores de rondas anteriores. */
  pool: number[];
  questions: Question[];
  /**
   * Los que siguen después de la última pregunta y no se pueden separar por
   * ninguna letra (tienen exactamente las mismas letras que el ganador, como
   * "José" y "Jose"). Normalmente vacío. Si no, el juego lo dice y la carta
   * del ganador se ilumina sola: el protocolo ya eligió.
   */
  ties: number[];
}

/** Hasta cuántas preguntas por ronda, aunque queden varios. */
export const MAX_QUESTIONS = 10;

/**
 * Elige las preguntas de una ronda. En cada turno toma, entre las letras que
 * todavía separan a alguien, la que deja el grupo más cerca de la mitad, y
 * entre empates decide el `rng`. Nunca deja afuera al ganador.
 */
export function planRound(names: readonly string[], pool: readonly number[], winner: number, rng: () => number): Round {
  if (!pool.includes(winner)) throw new Error("el ganador no está entre los candidatos");
  const letras = names.map(lettersOf);
  const suyas = letras[winner] as Set<string>;
  let quedan = [...pool];
  const usadas = new Set<string>();
  const questions: Question[] = [];
  while (quedan.length > 1 && questions.length < MAX_QUESTIONS) {
    let mejor: { letter: string; score: number; tie: number } | null = null;
    for (const letter of ABC) {
      if (usadas.has(letter)) continue;
      const has = suyas.has(letter);
      const siguen = quedan.filter((i) => (letras[i] as Set<string>).has(letter) === has).length;
      if (siguen === quedan.length) continue; // no separa a nadie
      // Lo ideal es que siga la mitad; un poco más que la mitad también está
      // bien, porque deja cartas para la próxima pregunta.
      const score = Math.abs(siguen - quedan.length / 2);
      const tie = rng();
      if (!mejor || score < mejor.score - 1e-9 || (Math.abs(score - mejor.score) < 1e-9 && tie < mejor.tie)) {
        mejor = { letter, score, tie };
      }
    }
    if (!mejor) break; // los que quedan tienen las mismas letras
    const has = suyas.has(mejor.letter);
    usadas.add(mejor.letter);
    const out = quedan.filter((i) => (letras[i] as Set<string>).has(mejor.letter) !== has);
    quedan = quedan.filter((i) => (letras[i] as Set<string>).has(mejor.letter) === has);
    questions.push({ letter: mejor.letter, has, remaining: [...quedan], out });
  }
  return { winner, pool: [...pool], questions, ties: quedan.filter((i) => i !== winner) };
}

/** Una ronda por ganador, en el orden de `winners`; cada una sin los ganadores anteriores. */
export function planRounds(names: readonly string[], winners: readonly number[], rng: () => number): Round[] {
  if (new Set(winners).size !== winners.length || winners.some((w) => !Number.isInteger(w) || w < 0 || w >= names.length)) {
    throw new Error("ganadores inválidos");
  }
  const rounds: Round[] = [];
  winners.forEach((w, k) => {
    const antes = new Set(winners.slice(0, k));
    const pool = names.map((_, i) => i).filter((i) => !antes.has(i));
    rounds.push(planRound(names, pool, w, rng));
  });
  return rounds;
}
