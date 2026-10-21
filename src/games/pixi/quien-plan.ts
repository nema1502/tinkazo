/**
 * De pie (antes ¿Quién es?): la mitad pura del juego (sin Pixi, sin DOM, sin Math.random).
 *
 * La sala está de pie. En cada turno se pregunta algo sobre el nombre de cada
 * uno ("¿tu nombre tiene la R?", "¿empieza de la A a la M?", "¿tiene más de diez
 * letras?") y se sientan los que no siguen: los que no cumplen lo que cumplió
 * quien ganó. Así siempre se queda de pie el ganador, y el último de pie es el
 * premio.
 *
 * No decide nada: el ganador sale del protocolo antes, y las preguntas se
 * eligen sabiendo quién es, para partir el grupo más o menos a la mitad. Así
 * 50 nombres se resuelven en unas seis preguntas y 200 en unas ocho. Como las
 * preguntas son de varios tipos (letras, dígitos, la mitad del abecedario, el
 * largo), dos nombres parecidos se separan aunque tengan las mismas letras.
 *
 * Nació del Ahorcado que propuso Guido Salazar (@GuidoSV7). La horca no podía
 * quedar, y el largo del nombre delataba al ganador antes de la primera letra
 * (revisión visual, 2 de octubre de 2026). Lo que valía, revelar letra por
 * letra mientras la lista se achica, sigue acá.
 */

/**
 * Lo que se pregunta por letra: las letras sin tildes (la Ñ cuenta como N) y los
 * números, que separan a "Invitado 1" de "Invitado 2", algo común en las
 * listas de los eventos.
 */
export const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `true` si lo que se pregunta es un número y no una letra. */
export const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/** El nombre sin tildes ni signos, en mayúsculas. */
const plano = (name: string): string => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Las letras de un nombre, en mayúsculas, sin tildes ni signos. */
export function lettersOf(name: string): Set<string> {
  return new Set(Array.from(plano(name)).filter((c) => ABC.includes(c)));
}

/** Cuántas letras tiene el nombre, sin contar números: "Ana" 3, "Anna" 4. */
export function largoOf(name: string): number {
  return Array.from(plano(name)).filter((c) => c >= "A" && c <= "Z").length;
}

/** El número al final del nombre ("Invitado 12" → 12), o null si no termina en número. */
export function numeroDe(name: string): number | null {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? Number(m[1]) : null;
}

/** `true` si el nombre empieza con una letra de la A a la M. Sin letras, no. */
export function enAM(name: string): boolean {
  const m = /[A-Z]/.exec(plano(name));
  return !!m && m[0] <= "M";
}

/** Lo que el juego sabe de cada nombre para contestar cualquier pregunta. */
export interface Rasgos {
  letras: Set<string>;
  enAM: boolean;
  largo: number;
  numero: number | null;
}

export const rasgosOf = (name: string): Rasgos => ({ letras: lettersOf(name), enAM: enAM(name), largo: largoOf(name), numero: numeroDe(name) });

/**
 * Los tipos de pregunta. "letra" y "numero" preguntan si el nombre tiene esa
 * letra o ese dígito; "mitad", si empieza de la A a la M; "largo", si tiene más
 * de `valor` letras; "orden", si el número del final es mayor que `valor`
 * ("Invitado 12" con un 7 es mayor). Sin el "orden", una lista numerada
 * ("Participante 1" a "Participante 200") se separaba de a un dígito.
 */
export type Tipo = "letra" | "numero" | "mitad" | "largo" | "orden";

export interface Question {
  tipo: Tipo;
  /** La letra o el dígito; "M" para la mitad (de la A a la M); el número de letras para el largo; el número para el orden. */
  valor: string;
  /** Si quien ganó cumple la pregunta. */
  has: boolean;
  /** Los que siguen en pie después de esta pregunta (índices de la lista). */
  remaining: number[];
  /** Los que se sientan en esta pregunta (índices de la lista). */
  out: number[];
}

export interface Round {
  /** El índice del ganador de esta ronda. */
  winner: number;
  /** Con quiénes arranca la ronda: todos menos los ganadores de rondas anteriores. */
  pool: number[];
  questions: Question[];
  /**
   * Los que siguen de pie después de la última pregunta y no se pueden separar
   * con ninguna pregunta. Normalmente vacío. Si no, el juego lo dice y se
   * sientan solos: el protocolo ya eligió.
   */
  ties: number[];
  /**
   * Por qué quedaron `ties`: "iguales" si ninguna pregunta los separa (tienen
   * las mismas letras, el mismo largo y la misma mitad), "tope" si se llegó al
   * máximo de preguntas con nombres que todavía se podían separar. Sin empate, null.
   */
  empate: "iguales" | "tope" | null;
}

/**
 * Hasta cuántas preguntas por ronda, aunque queden varios. Con 200 nombres
 * alcanzan unas ocho; el tope es para que una lista de homónimos no dure más
 * de lo que aguanta la sala.
 */
export const MAX_QUESTIONS = 12;

/** Hasta cuántas cartas la ronda arranca con una pregunta de calentamiento. */
export const WARMUP_UP_TO = 3;

/** El rango de "más de N letras" que se pregunta. */
export const LARGO_MIN = 3;
export const LARGO_MAX = 20;

/**
 * Cuánto cuesta repetir el tipo de la pregunta anterior, en nombres. Con el
 * mismo tipo otra vez, la pregunta tiene que partir mejor que la otra opción
 * por más de esto. Así las preguntas varían y no son ocho ciclos iguales.
 */
const PENAL_TIPO = 1;

type Candidata = { tipo: Tipo; valor: string; cumple: (r: Rasgos) => boolean };

/**
 * Las preguntas fijas, en un orden fijo (así la elección es reproducible). Las
 * de "orden" dependen de la lista y se arman en `ordenes`.
 */
const CANDIDATAS: Candidata[] = [
  ...[...ABC.slice(0, 26)].map((l) => ({ tipo: "letra" as const, valor: l, cumple: (r: Rasgos): boolean => r.letras.has(l) })),
  ...[...ABC.slice(26)].map((d) => ({ tipo: "numero" as const, valor: d, cumple: (r: Rasgos): boolean => r.letras.has(d) })),
  { tipo: "mitad" as const, valor: "M", cumple: (r: Rasgos): boolean => r.enAM },
  ...Array.from({ length: LARGO_MAX - LARGO_MIN + 1 }, (_, i) => {
    const k = LARGO_MIN + i;
    return { tipo: "largo" as const, valor: String(k), cumple: (r: Rasgos): boolean => r.largo > k };
  }),
];

/**
 * Las preguntas de orden: "¿tu número es mayor que K?", para cada número de la
 * ronda menos el mayor. Quien no tiene número cuenta como cero: así una lista
 * con algunos numerados y otros no también se parte en mitades.
 */
function ordenes(rasgos: readonly Rasgos[], pool: readonly number[]): Candidata[] {
  const numeroDeI = (i: number): number => (rasgos[i] as Rasgos).numero ?? 0;
  const distintos = [...new Set(pool.map(numeroDeI))].sort((a, b) => a - b);
  return distintos.slice(0, -1).map((k) => ({ tipo: "orden" as const, valor: String(k), cumple: (r: Rasgos): boolean => (r.numero ?? 0) > k }));
}

/**
 * Elige las preguntas de una ronda. En cada turno toma la que deja el grupo más
 * cerca de la mitad, con una penalidad por repetir el tipo de la anterior, y
 * entre empates decide el `rng`. Nunca deja afuera al ganador.
 */
export function planRound(names: readonly string[], pool: readonly number[], winner: number, rng: () => number): Round {
  if (!pool.includes(winner)) throw new Error("el ganador no está entre los candidatos");
  const rasgos = names.map(rasgosOf);
  const suyos = rasgos[winner] as Rasgos;
  const candidatas: Candidata[] = [...CANDIDATAS, ...ordenes(rasgos, pool)];
  let quedan = [...pool];
  const usadas = new Set<string>();
  const questions: Question[] = [];
  let ultimoTipo: Tipo | null = null;
  // Con dos o tres cartas una sola pregunta lo resolvía todo y el juego era
  // un subtítulo quieto. Primero va una de calentamiento que no saca a nadie:
  // una letra que tienen todas ("¡las dos la tienen!"), o si no hay, una que no
  // tiene ninguna.
  if (pool.length > 1 && pool.length <= WARMUP_UP_TO) {
    const todas = [...ABC.slice(0, 26)].filter((l) => pool.every((i) => (rasgos[i] as Rasgos).letras.has(l)));
    const ninguna = [..."AEIOULRNSTM"].filter((l) => pool.every((i) => !(rasgos[i] as Rasgos).letras.has(l)));
    const opciones = todas.length ? todas : ninguna;
    if (opciones.length) {
      const valor = opciones[Math.floor(rng() * opciones.length)] as string;
      usadas.add(`letra:${valor}`);
      questions.push({ tipo: "letra", valor, has: todas.length > 0, remaining: [...quedan], out: [] });
      ultimoTipo = "letra";
    }
  }
  let motivo: Round["empate"] = null;
  while (quedan.length > 1) {
    if (questions.length >= MAX_QUESTIONS) {
      motivo = "tope";
      break;
    }
    let mejor: { c: Candidata; has: boolean; score: number; tie: number } | null = null;
    const tipoAnterior: Tipo | null = ultimoTipo;
    for (const c of candidatas) {
      if (usadas.has(`${c.tipo}:${c.valor}`)) continue;
      const has: boolean = c.cumple(suyos);
      const siguen: number = quedan.filter((i) => c.cumple(rasgos[i] as Rasgos) === has).length;
      if (siguen === quedan.length) continue; // no separa a nadie
      // Lo ideal es que siga la mitad; un poco más que la mitad también está
      // bien, porque deja cartas para la próxima pregunta.
      const score: number = Math.abs(siguen - quedan.length / 2) + (c.tipo === tipoAnterior ? PENAL_TIPO : 0);
      const tie: number = rng();
      if (!mejor || score < mejor.score - 1e-9 || (Math.abs(score - mejor.score) < 1e-9 && tie < mejor.tie)) {
        mejor = { c, has, score, tie };
      }
    }
    if (!mejor) {
      motivo = "iguales";
      break;
    }
    const elegida: { c: Candidata; has: boolean; score: number; tie: number } = mejor;
    const c: Candidata = elegida.c;
    const has: boolean = elegida.has;
    usadas.add(`${c.tipo}:${c.valor}`);
    const out = quedan.filter((i) => c.cumple(rasgos[i] as Rasgos) !== has);
    quedan = quedan.filter((i) => c.cumple(rasgos[i] as Rasgos) === has);
    questions.push({ tipo: c.tipo, valor: c.valor, has, remaining: [...quedan], out });
    ultimoTipo = c.tipo;
  }
  return {
    winner,
    pool: [...pool],
    questions,
    ties: quedan.filter((i) => i !== winner),
    empate: quedan.length > 1 ? motivo ?? "iguales" : null,
  };
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
