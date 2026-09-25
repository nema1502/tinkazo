/**
 * El director de emoción.
 *
 * Los juegos contaban el resultado con parámetros: cada corredor con una
 * velocidad que subía y bajaba sola, el ganador siempre haciendo lo mismo. Se
 * veía como una simulación, no como una carrera: nadie tropezaba, nadie se
 * plantaba, no había duelos ni llegadas por una nariz. Y como el ganador
 * remontaba siempre desde atrás, a los dos sorteos la sala ya sabía mirar al
 * último.
 *
 * Este módulo escribe la historia antes de que el juego arranque, sembrada con
 * la ronda como todo lo demás: el arco del ganador, quién es su rival, y los
 * momentos chicos del resto. El juego después la actúa en su idioma. Nada de
 * esto decide nada: el ganador llega dado, y la historia se escribe alrededor
 * de él.
 *
 * Tres reglas, que salen de cómo se relata un partido y no del gusto:
 *
 * - **El final no se anuncia.** Cuatro arcos distintos para el ganador, y
 *   ninguno se delata antes del último cuarto.
 * - **Siempre pasa algo.** Los momentos se reparten con separación mínima: la
 *   sala nunca espera más de dos o tres segundos sin novedad.
 * - **Cada persona es un personaje.** Una que se planta, otra que tropieza,
 *   otra que pega un pique y se desinfla. Se recuerda "la de Jorge que se
 *   plantó", no "el corredor del carril cuatro".
 */

/** El arco del ganador. */
export type Arc =
  /** Viene de atrás y pasa a todos al final. */
  | "remontada"
  /** Va adelante, tropieza, queda atrás y recupera. */
  | "susto"
  /** Mano a mano con la rival desde la mitad; gana por una nariz. */
  | "duelo"
  /** Dos se pelean adelante; la que nadie miraba se cuela entre las dos. */
  | "tapada";

export const ARCS: readonly Arc[] = ["remontada", "susto", "duelo", "tapada"];

/** Un momento chico de la historia. */
export type BeatKind =
  /** Se queda quieta un rato: terca. */
  | "plantada"
  /** Pierde el paso un instante. */
  | "tropiezo"
  /** Pega un pique y después se desinfla. */
  | "pique"
  /** Le escupe a la de al lado, que se frena. */
  | "escupida";

export interface Beat {
  kind: BeatKind;
  /** Quién lo protagoniza: un índice de actor, no de la lista de nombres. */
  actor: number;
  /** A quién le toca, si le toca a alguien. */
  target?: number;
  /** Cuándo, como fracción del juego. */
  at: number;
}

export interface Story {
  arc: Arc;
  /** El actor que gana. */
  winner: number;
  /** La rival principal: la que la sala cree que gana hasta el final. */
  rival: number;
  /** En la tapada, la segunda de las dos que se pelean adelante. */
  rival2: number;
  beats: Beat[];
}

/**
 * Escribe la historia.
 *
 * `actors` es cuántos personajes hay en escena y `winner` cuál de ellos gana.
 * El azar es el sembrado del juego: la misma ronda escribe la misma historia.
 * Con dos actores no hay tapada, que necesita tres.
 */
export function writeStory(rng: () => number, actors: number, winner: number): Story {
  const others = Array.from({ length: actors }, (_, i) => i).filter((i) => i !== winner);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [others[i], others[j]] = [others[j] as number, others[i] as number];
  }
  const posibles = ARCS.filter((a) => a !== "tapada" || others.length >= 2);
  const arc = posibles[Math.floor(rng() * posibles.length)] ?? "remontada";
  const rival = others[0] ?? winner;
  const rival2 = others[1] ?? rival;

  // Los momentos chicos, para los que no están en el arco. En la tapada, las
  // dos de adelante ya tienen su escena al final.
  const libres = others.filter((i) => i !== rival && !(arc === "tapada" && i === rival2));
  const cuantos = Math.min(libres.length, actors <= 3 ? 1 : actors <= 5 ? 2 : 3);
  const kinds: BeatKind[] = ["plantada", "tropiezo", "pique", "escupida"];
  const beats: Beat[] = [];
  // Repartidos entre el 20% y el 72% del juego, con al menos 0,11 entre uno y
  // otro: antes la carrera arranca y después ya es del arco.
  const huecos = spread(rng, cuantos, 0.2, 0.72, 0.11);
  for (let k = 0; k < cuantos; k++) {
    const actor = libres[k] as number;
    let kind = kinds[Math.floor(rng() * kinds.length)] ?? "tropiezo";
    // Escupir necesita a alguien al lado que no sea del arco.
    const vecino = libres.find((i) => i !== actor);
    if (kind === "escupida" && vecino === undefined) kind = "plantada";
    beats.push({ kind, actor, at: huecos[k] ?? 0.4, ...(kind === "escupida" ? { target: vecino } : {}) });
  }
  // La tapada termina en una escupida entre las dos que se pelean adelante: es
  // lo que abre el hueco por donde se cuela la ganadora.
  if (arc === "tapada") beats.push({ kind: "escupida", actor: rival, target: rival2, at: 0.8 });
  // En el susto, la ganadora tropieza cuando más cómoda iba.
  if (arc === "susto") beats.push({ kind: "tropiezo", actor: winner, at: 0.56 });
  beats.sort((a, b) => a.at - b.at);
  return { arc, winner, rival, rival2, beats };
}

/** `n` instantes entre `a` y `b`, sembrados, separados por al menos `gap`. */
function spread(rng: () => number, n: number, a: number, b: number, gap: number): number[] {
  if (n <= 0) return [];
  const libre = Math.max(0, b - a - gap * (n - 1));
  const cortes = Array.from({ length: n }, () => rng() * libre).sort((x, y) => x - y);
  return cortes.map((c, i) => a + c + i * gap);
}

/**
 * La tensión de la historia, de 0 a 1, a lo largo del juego.
 *
 * Sube despacio, tiene un escalón en la mitad (el primer golpe de la historia)
 * y se dispara en el último cuarto. La usan el sonido y el relator: la misma
 * curva para los dos, así el oído y el ojo cuentan lo mismo.
 */
export function tension(story: Story, p: number): number {
  const base = 0.15 + 0.35 * Math.min(1, p / 0.7);
  const final = p > 0.75 ? ((p - 0.75) / 0.25) * 0.5 : 0;
  const duelo = story.arc === "duelo" && p > 0.5 ? 0.1 : 0;
  return Math.min(1, base + final + duelo);
}
