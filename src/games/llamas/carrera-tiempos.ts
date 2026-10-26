/**
 * Los tiempos del grupo, puros: cuándo cambia el terreno y cuándo se echa cada
 * una. Se reparte un presupuesto: una echada cada `pasoEntre(echan)` segundos
 * (nunca menos de 1,5 con el desorden de ±0,15 s: dos salidas quedan a 1,2 s o
 * más, la regla del niño pide 1 s), con el terreno nuevo entre tramo y tramo.
 *
 * Es el grupo de la carrera: salen todas juntas y se van echando hasta que
 * quedan las ocho de la final (las mismas que sortea `planRace`). Nadie se echa
 * en pareja: una echada por vez, siempre a la vista.
 *
 * Todo es función del tiempo; el azar es el que llega (sembrado con la ronda) y
 * no mira quién es nadie: quién se echa sale de una fila barajada.
 */

export type Terreno = "cuesta" | "barro" | "piedras" | "viento";
export const TERRENOS: readonly Terreno[] = ["cuesta", "barro", "piedras", "viento"];

/** De la salida a la primera echada: el grupo corre y se ve quién va adelante. */
export const ENTRADA_0 = 4;
/** Del cartel de un terreno nuevo a su primera echada: hay lugar para decir el terreno y quién va adelante. */
export const ENTRADA_K = 3;
/** De la última echada de un tramo al terreno siguiente. */
export const CIERRE_TRAMO = 1.2;
/** De la última echada a que se abra la recta: lo que tarda el grupo en acomodarse en el orden de la final. */
export const REMATE = 3.2;
/** Lo menos que separa dos echadas (la regla del niño pide 1 s). */
export const ESP_MIN = 1.2;
/** El desorden de cada echada, en segundos, para que no suene a metrónomo. */
export const DESORDEN = 0.15;

const PESOS: Record<number, readonly number[]> = {
  1: [1],
  2: [0.62, 0.38],
  3: [0.5, 0.32, 0.18],
  4: [0.4, 0.32, 0.18, 0.1],
};

/** Cuántos tramos según a cuántas hay que echar. */
export function tramosPara(echan: number): number {
  return echan <= 3 ? 1 : echan <= 8 ? 2 : echan <= 14 ? 3 : 4;
}

/** Cuánto separa una echada de la siguiente: más despacio con pocas, más seguido con muchas. */
export function pasoEntre(echan: number): number {
  return Math.max(1.5, Math.min(2.9, 2.9 - 0.07 * (echan - 1)));
}

/** Reparte `total` entre tramos según los pesos, con al menos uno en cada uno. */
export function repartir(total: number, pesos: readonly number[]): number[] {
  const out = pesos.map((p) => Math.max(1, Math.round(total * p)));
  let suma = out.reduce((a, b) => a + b, 0);
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

export interface Nominal {
  /** Cuándo se echa cada una, en segundos desde la salida, sin desorden. */
  echadas: { t: number; tramo: number }[];
  /** Dónde empieza cada tramo, desde la salida. */
  tramos: { desde: number }[];
  /** Cuándo se abre la recta, desde la salida. */
  abre: number;
}

/** Los tiempos sin desorden: lo que sirve para anunciar la duración antes de armar nada. */
export function nominalDe(echan: number): Nominal {
  if (echan < 1) return { echadas: [], tramos: [], abre: 0 };
  const K = tramosPara(echan);
  const reparto = repartir(echan, PESOS[K] as readonly number[]);
  const paso = pasoEntre(echan);
  const echadas: Nominal["echadas"] = [];
  const tramos: Nominal["tramos"] = [];
  let ultima = 0;
  reparto.forEach((cuantas, k) => {
    const desde = k === 0 ? 0 : ultima + CIERRE_TRAMO;
    tramos.push({ desde });
    const primera = k === 0 ? ENTRADA_0 : desde + ENTRADA_K;
    for (let e = 0; e < cuantas; e++) {
      const t = primera + e * paso;
      echadas.push({ t, tramo: k });
      ultima = t;
    }
  });
  return { echadas, tramos, abre: ultima + REMATE };
}

/** Cuánto dura el grupo, de la salida a la apertura de la recta, con `echan` echadas. */
export const duracionGrupo = (echan: number): number => nominalDe(echan).abre;

export interface Tramo {
  terreno: Terreno;
  t0: number;
  t1: number;
}

export interface Echada {
  t: number;
  /** Índice en la lista de nombres. */
  quien: number;
  tramo: number;
  /** Cuántas siguen en carrera una vez echada. */
  quedan: number;
}

export interface Tiempos {
  tramos: Tramo[];
  echadas: Echada[];
  /** Cuándo se echa cada una (`Infinity`: no se echa). */
  cae: Map<number, number>;
  /** La última echada (la salida si no hay ninguna). */
  ultima: number;
  /** Cuándo se abre la recta. */
  abre: number;
}

/**
 * Los tiempos de una carrera: `fila` son las que se echan, en orden; `total`
 * cuántas salen. El azar `rng` solo mueve cada echada unos décimos.
 */
export function armarTiempos(o: { t0: number; fila: readonly number[]; total: number; rng: () => number }): Tiempos {
  const echan = o.fila.length;
  if (echan < 1) return { tramos: [], echadas: [], cae: new Map(), ultima: o.t0, abre: o.t0 };
  const nom = nominalDe(echan);
  const cae = new Map<number, number>();
  const echadas: Echada[] = nom.echadas.map((e, j) => {
    const t = o.t0 + e.t + (o.rng() - 0.5) * 2 * DESORDEN;
    const quien = o.fila[j] as number;
    cae.set(quien, t);
    return { t, quien, tramo: e.tramo, quedan: o.total - 1 - j };
  });
  const ultima = (echadas[echadas.length - 1] as Echada).t;
  const abre = o.t0 + nom.abre;
  const tramos: Tramo[] = nom.tramos.map((tr, k) => ({
    terreno: TERRENOS[Math.min(k, TERRENOS.length - 1)] as Terreno,
    t0: o.t0 + tr.desde,
    t1: k + 1 < nom.tramos.length ? o.t0 + (nom.tramos[k + 1] as { desde: number }).desde : abre,
  }));
  return { tramos, echadas, cae, ultima, abre };
}
