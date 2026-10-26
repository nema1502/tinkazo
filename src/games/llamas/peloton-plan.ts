/**
 * El plan del pelotón, sin dibujo: "el pelotón se echa".
 *
 * Con 9 a 30 personas salen todas juntas, y a lo largo de unos tramos se van
 * echando de a una o de a dos (la llama que se echa a descansar), cada una con
 * su nombre entero. Quedan las ocho de la final, las mismas de siempre: los
 * finalistas los elige `plan.ts` con el azar de la ronda y acá solo se reciben.
 *
 * Todo es función del tiempo: ninguna cuenta se acumula cuadro a cuadro, así
 * que saltar, estirar el reloj o redibujar tras un cambio de tamaño dan lo
 * mismo. Puro, sin Pixi ni DOM, para probarlo en Node.
 *
 * **No delata a nadie.** El ganador es siempre un finalista y nunca se echa,
 * pero nada de lo que se ve lo separa de los demás finalistas ni, antes de
 * tiempo, de los que se van a echar:
 *
 * - Quién se echa en cada momento sale de un orden sembrado con la ronda: no
 *   hay ninguna regla (por la lista, por la posición) que adelante cuál sigue.
 * - Los tramos tampoco: cuántos se echan en cada uno depende de cuántos son,
 *   no de quiénes.
 * - **Los tambaleos.** Un segundo antes de algunas echadas, una persona se
 *   tambalea ("¡!"). Se sortea **parejo entre todos los que siguen en
 *   carrera** en ese momento: puede ser la que está por echarse, otra que se
 *   echará más tarde o una finalista, con la misma probabilidad que le
 *   corresponde por cantidad. Así "se tambaleó" no dice nada de qué le pasa:
 *   la ganadora se tambalea como cualquiera, y nombrar a alguien tampoco.
 * - La posición en el pelotón (`orden`) es otro sorteo aparte.
 */

/** Cuántos llegan a la final. */
export const FINALISTAS = 8;
/** Con menos de 9 no hay a quién echar; con más de 30 sigue la clasificatoria de siempre. */
export const PELOTON_MIN = 9;
export const PELOTON_MAX = 30;

export type Terreno = "cuesta" | "barro" | "piedras" | "viento";
const TERRENOS: readonly Terreno[] = ["cuesta", "barro", "piedras", "viento"];

export interface Tramo {
  terreno: Terreno;
  /** Segundos de juego desde la largada. */
  t0: number;
  t1: number;
}

export interface Evento {
  /** Cuándo se echa la primera; la segunda, `ESCALON` después. */
  t: number;
  /** Quiénes (índices de la lista): una o dos. */
  personas: number[];
  tramo: number;
  /** Cuántos siguen en carrera una vez que se echaron. */
  quedan: number;
}

export interface Susto {
  persona: number;
  t: number;
  /**
   * Si el relator lo dice ("¡X se tambalea!"). Se sortea con una moneda que no
   * mira de qué tipo es (el que se echa o el finalista que sigue): la línea es
   * la misma para los dos, así que nombrar a alguien no adelanta qué le pasa.
   */
  habla: boolean;
}

export interface PlanPeloton {
  n: number;
  finalistas: number[];
  tramos: Tramo[];
  eventos: Evento[];
  /** Los que se tambalean, uno por tramo de un segundo, siempre un segundo antes de una echada. */
  tambaleos: Susto[];
  /** Cuándo se echa cada uno: `Infinity` para los finalistas. */
  cae: number[];
  /** El orden de los lugares del pelotón: `orden[k]` es quien ocupa el lugar `k`. */
  orden: number[];
  /** Los segundos de la presentación con todos corriendo, antes del primer tramo. */
  intro: number;
  /** Cuándo termina el último tramo: el pelotón se abre en los carriles de la final. */
  fin: number;
  quedanEn(t: number): number;
  vivosEn(t: number): number[];
}

/**
 * Lo que separa a dos líneas del relator: con menos, la segunda pisa a la
 * primera antes de que se alcance a leer (el auditor exigente lo cuenta como
 * tartamudeo).
 */
export const SEPARACION = 1.0;

/**
 * Cuándo dice el pelotón sus líneas fijas, en segundos de juego: la
 * presentación, el cartel de cada tramo, el "¡Quedan 8!" (`ANUNCIO`
 * antes del fin) y la línea con que se abren los carriles.
 */
export const ANUNCIO = 1.3;
export function lineasFijas(tramos: readonly Tramo[], fin: number): number[] {
  return [0.2, ...tramos.map((x) => x.t0 + 0.15), fin - ANUNCIO, fin + 0.05];
}

/** Lo que tarda la segunda de una pareja en echarse después de la primera. */
export const ESCALON = 0.3;
/** Cuánto antes de caer se tambalea la que avisa. */
export const AVISO = 1;
/** La presentación con todos corriendo. */
const INTRO = 4;
/** Entre que arranca un tramo y se echa la primera: el cartel del terreno y que se asiente. */
const ENTRADA = 2.4;
/** Entre la última que se echa de un tramo y el siguiente. */
const SALIDA = 1.8;
/** Después de la última del último tramo: el "¡Quedan 8!". */
const REMATE = 2.6;
/** Separación entre echadas según cuántos tramos hay: a menos gente, más lento. */
const ESPACIO: Record<number, readonly number[]> = {
  1: [2.4],
  2: [2.0, 3.0],
  3: [1.8, 2.5, 3.2],
  4: [1.8, 2.3, 2.9, 3.6],
};
const PESOS: Record<number, readonly number[]> = {
  1: [1],
  2: [0.62, 0.38],
  3: [0.5, 0.32, 0.18],
  4: [0.4, 0.32, 0.18, 0.1],
};

/** Cuántos tramos según a cuántos hay que echar. */
export function tramosPara(echan: number): number {
  return echan <= 3 ? 1 : echan <= 8 ? 2 : echan <= 14 ? 3 : 4;
}

function barajar<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

/** Reparte `total` entre tramos según los pesos, con al menos uno en cada uno. */
export function repartir(total: number, pesos: readonly number[]): number[] {
  const out = pesos.map((p) => Math.max(1, Math.round(total * p)));
  let suma = out.reduce((a, b) => a + b, 0);
  // Sobra o falta: se ajusta de los tramos del medio hacia los costados, sin dejar ninguno en cero.
  const orden = pesos.map((_, i) => i).sort((a, b) => (pesos[b] as number) - (pesos[a] as number));
  for (let i = 0; suma !== total && i < 100; i++) {
    const k = orden[i % orden.length] as number;
    if (suma > total && (out[k] as number) > 1) {
      out[k] = (out[k] as number) - 1;
      suma--;
    } else if (suma < total) {
      out[k] = (out[k] as number) + 1;
      suma++;
    }
  }
  return out;
}

/**
 * Cuánto dura el pelotón (hasta que se abre en los carriles) con `n`
 * personas, sin sortear nada: sirve para anunciar la duración del show antes
 * de armarlo. Es el promedio de `planPeloton(n, ...).fin`: el desorden de cada
 * echada suma y resta, y en una ronda cualquiera se aparta menos de un segundo.
 */
export function duracionPeloton(n: number): number {
  const echan = n - FINALISTAS;
  if (echan < 1) return 0;
  const K = tramosPara(echan);
  const reparto = repartir(echan, PESOS[K] as readonly number[]);
  let t = INTRO;
  reparto.forEach((cuantos, k) => {
    const dobles = k < K - 1 && cuantos >= 4 ? Math.floor(cuantos / 3) : 0;
    const eventosK = cuantos - dobles;
    const paso = (ESPACIO[K] as readonly number[])[k] as number;
    t += ENTRADA + (eventosK - 1) * paso + dobles * ESCALON + (k === K - 1 ? REMATE : SALIDA);
  });
  return t;
}

export function planPeloton(n: number, finalistas: readonly number[], rng: () => number): PlanPeloton {
  const fin = [...finalistas];
  const esFinalista = new Set(fin);
  const echan = n - fin.length;
  if (echan < 1) throw new Error("el pelotón necesita a alguien que se eche");
  const K = tramosPara(echan);
  const reparto = repartir(echan, PESOS[K] as readonly number[]);
  const fila = barajar(Array.from({ length: n }, (_, i) => i).filter((i) => !esFinalista.has(i)), rng);

  const tramos: Tramo[] = [];
  const eventos: Evento[] = [];
  const cae = new Array<number>(n).fill(Infinity);
  let desde = 0;
  let t = INTRO;
  let quedan = n;
  reparto.forEach((cuantos, k) => {
    const dobles = k < K - 1 && cuantos >= 4 ? Math.floor(cuantos / 3) : 0;
    const eventosK = cuantos - dobles;
    // Cuáles de los eventos son de a dos: sorteado, nunca el primero del tramo.
    const parejas = new Set(barajar(Array.from({ length: eventosK - 1 }, (_, i) => i + 1), rng).slice(0, dobles));
    const t0 = t;
    const paso = (ESPACIO[K] as readonly number[])[k] as number;
    let ultimo = t0 + ENTRADA;
    for (let e = 0; e < eventosK; e++) {
      // Un poquito de desorden para que no suene a metrónomo, sin pasarse de ±0,15.
      const te = (e === 0 ? t0 + ENTRADA : ultimo + paso) + (rng() - 0.5) * 0.3;
      const personas = fila.slice(desde, desde + (parejas.has(e) ? 2 : 1));
      desde += personas.length;
      quedan -= personas.length;
      personas.forEach((p, j) => {
        cae[p] = te + j * ESCALON;
      });
      eventos.push({ t: te, personas, tramo: k, quedan });
      ultimo = te + (personas.length - 1) * ESCALON;
    }
    // Un tramo con una sola pareja no puede quedar sin echadas: ya se cubrió arriba.
    t = ultimo + (k === K - 1 ? REMATE : SALIDA);
    tramos.push({ terreno: TERRENOS[Math.min(k, TERRENOS.length - 1)] as Terreno, t0, t1: t });
  });

  const orden = barajar(Array.from({ length: n }, (_, i) => i), rng);
  const finT = (tramos[tramos.length - 1] as Tramo).t1;
  // Los tambaleos: un segundo antes de cada echada que sale sorteada (55 %), se
  // tambalea alguien sorteado parejo entre todos los que siguen en ese momento.
  const tambaleos: Susto[] = [];
  for (const ev of eventos) {
    if (rng() >= 0.55) continue;
    const ts = ev.t - AVISO;
    // No encima del cartel del terreno que recién entra.
    if (ts < (tramos[ev.tramo] as Tramo).t0 + 1.2) continue;
    const vivos = orden.filter((p) => (cae[p] as number) > ts && !tambaleos.some((x) => x.persona === p && ts - x.t < 4));
    if (!vivos.length) continue;
    tambaleos.push({ persona: vivos[Math.floor(rng() * vivos.length)] as number, t: ts, habla: false });
  }
  // Quién habla: las líneas fijas del relator (la presentación, el cartel de
  // cada tramo, el "¡Quedan 8!" y la entrada a los carriles) y las echadas
  // mandan, y entre los que se tambalean habla uno de cada dos, por moneda y
  // en orden de hora. Todos tienen la misma estructura (un segundo antes de
  // una echada) y la misma línea: lo único que decide es la hora.
  const dicen = [...lineasFijas(tramos, finT), ...eventos.map((e) => e.t)];
  for (const w of tambaleos) {
    const cara = rng() < 0.5;
    if (!cara || dicen.some((d) => Math.abs(d - w.t) < SEPARACION - 1e-6)) continue;
    w.habla = true;
    dicen.push(w.t);
  }

  return {
    n,
    finalistas: fin,
    tramos,
    eventos,
    tambaleos,
    cae,
    orden,
    intro: INTRO,
    fin: finT,
    quedanEn: (tt) => n - cae.filter((c) => c <= tt).length,
    vivosEn: (tt) => orden.filter((p) => (cae[p] as number) > tt),
  };
}
