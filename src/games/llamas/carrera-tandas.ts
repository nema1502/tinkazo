import { DUR_FINAL, FIJOS, FINALISTAS, PELOTON_MAX, TARJETA, TOPE_NORMAL, T_VUELO, alfabetico, barajar } from "./carrera-base";
import { duracionGrupo } from "./carrera-tiempos";

/**
 * Las tandas, puras: de 31 a 200 personas la lista se reparte en tandas de 25 o
 * menos, y de cada una pasa el mismo número de personas por el portón; las que
 * pasan se juntan en el corral y corren el grupo de siempre. "Adelante" es el
 * corral.
 *
 * **No delata a nadie** (`audit-delatores`: ni la tanda, ni el portón):
 *
 * - Todas las tandas tienen las mismas plazas (`pasan`) y casi el mismo tamaño
 *   (±1), así que "pasar" cuesta igual en cualquiera: sin plazas distintas, la
 *   probabilidad de que quien pasa sea finalista es la misma en todas.
 * - Las finalistas se reparten por el barajado de la lista; si una tanda se
 *   queda con más finalistas que plazas, una cambia de lugar con una que no es
 *   finalista de una tanda con lugar, sorteado. Ninguna tanda es "la de las
 *   finalistas".
 * - Pasan todas las finalistas de la tanda y, hasta completar las plazas, otras
 *   sorteadas de la misma tanda. El orden de salida por el portón es otro
 *   sorteo: no mira si es finalista.
 * - Cada una ve su nombre entero, en el cartel de su tanda, en orden
 *   alfabético, 3 s o más, y el cartel sigue mientras corre su tanda.
 *
 * Todo es función del tiempo y del azar sembrado que llega.
 */

/** Cuántas personas hay como mucho en una tanda. */
export const TANDA_MAX = 25;
/** El cartel de la tanda antes de la primera salida: en Rápido (0,86 del plan) son 3 s de verdad, y nadie lee su nombre en menos. */
export const CARTEL_S = 3.7;
/** Entre una salida por el portón y la siguiente (la regla del niño pide 1 s o más, también en Rápido: 1,2 × 0,86). */
export const SALIDA_PORTON = 1.2;
/** Entre que sale la última y se cierra el portón (el cierre es otro hecho: también 1 s o más en Rápido). */
export const CIERRE_PORTON = 1.2;
/** Del cierre al cartel de la tanda siguiente. */
export const ENTRE_TANDAS = 0.4;
/** Del cierre de la última tanda a la salida del grupo: lo que tarda el relator en decir "¡Salida!" sin pisar el cierre. */
export const ENTRE_FINAL = 1;

/** Lo que dura una tanda con `pasan` plazas, del cartel a que arranque la siguiente. */
export const durTanda = (pasan: number): number => CARTEL_S + (pasan - 1) * SALIDA_PORTON + CIERRE_PORTON + ENTRE_TANDAS;

/**
 * Cuántas plazas por tanda entran en el presupuesto con `T` tandas, o 0 si ninguna
 * (menos de 86 s de show con la tarjeta y lo que no se estira, así que
 * `normalCarrera` queda por debajo de 90), con 16 en el grupo como mucho y al
 * menos las ocho de la final. Con muchas tandas pasa una sola de cada una y el
 * grupo son las ocho.
 */
function plazasQueEntran(T: number): number {
  for (let p = 7; p >= 1; p--) {
    const g = T * p;
    if (g > 16 || g < FINALISTAS) continue;
    const total = T_VUELO + T * durTanda(p) + duracionGrupo(g - FINALISTAS) + DUR_FINAL * 1.014 + FIJOS + TARJETA;
    if (total <= TOPE_NORMAL - 4) return p;
  }
  return 0;
}

/**
 * Cuántas tandas hay con `n` personas (0: ninguna, es un solo grupo): las justas
 * para que ninguna pase de 25 y, si con esas no entra en el presupuesto ninguna
 * cantidad de plazas igual para todas, una más y otra más, más chicas, hasta que
 * entre (de 151 a 175, con siete tandas el cartel de cada una no deja lugar y
 * pasan ocho tandas de una).
 */
export function tandasPara(n: number): number {
  if (n <= PELOTON_MAX) return 0;
  const justas = Math.ceil(n / TANDA_MAX);
  for (let T = justas; T <= 2 * FINALISTAS; T++) if (plazasQueEntran(T) > 0) return T;
  return justas;
}

/** Cuántas pasan por tanda con `n` personas: las que entran en el presupuesto (`plazasQueEntran`). */
export function pasanPorTanda(n: number): number {
  const T = tandasPara(n);
  if (!T) return 0;
  return plazasQueEntran(T) || Math.max(1, Math.ceil(FINALISTAS / T));
}

/** Cuántas corren el grupo con `n` personas, después de las tandas. */
export const grupoDeTandas = (n: number): number => {
  const T = tandasPara(n);
  return T ? Math.max(FINALISTAS, T * pasanPorTanda(n)) : 0;
};

export interface Tanda {
  indice: number;
  /** Las de la tanda, en orden alfabético. */
  miembros: number[];
  /** Las que pasan, en el orden en que salen por el portón. */
  pasan: number[];
  /** Las que no pasan, en orden alfabético. */
  noPasan: number[];
  /** Cuándo aparece el cartel de la tanda. */
  t0: number;
  /** Cuándo sale cada una de las que pasan (de a una, a 1,1 s). */
  salidas: number[];
  /** Cuándo se cierra el portón y las demás se echan juntas. */
  tCierra: number;
  /** Cuándo termina la tanda: ahí entra la siguiente. */
  tFin: number;
}

export interface Tandas {
  tandas: Tanda[];
  /** Las que llegan al corral, en el orden en que salieron por el portón. */
  gente: number[];
  /** Cuándo termina la última tanda y se arma el grupo. */
  tFin: number;
}

export function armarTandas(o: { n: number; nombres: readonly string[]; finalistas: readonly number[]; t0: number; rng: () => number }): Tandas {
  const { n } = o;
  const T = tandasPara(n);
  const p = pasanPorTanda(n);
  const esFinal = new Set(o.finalistas);
  // Un reparto parejo: de a `base` o `base + 1`, en un orden barajado.
  const orden = barajar(Array.from({ length: n }, (_, i) => i), o.rng);
  const base = Math.floor(n / T), resto = n % T;
  const reparto: number[][] = [];
  let desde = 0;
  for (let h = 0; h < T; h++) {
    const tam = base + (h < resto ? 1 : 0);
    reparto.push(orden.slice(desde, desde + tam));
    desde += tam;
  }
  // Ninguna tanda con más finalistas que plazas: una sobra cambia de lugar con una que no lo es de una tanda con lugar.
  const finalistasDe = (h: number): number[] => (reparto[h] as number[]).filter((i) => esFinal.has(i));
  for (let vuelta = 0; vuelta < 200; vuelta++) {
    const llena = reparto.findIndex((_, h) => finalistasDe(h).length > p);
    if (llena < 0) break;
    const conLugar = reparto.map((_, h) => h).filter((h) => finalistasDe(h).length < p);
    if (!conLugar.length) break;
    const sobra = barajar(finalistasDe(llena), o.rng)[0] as number;
    const destino = conLugar[Math.floor(o.rng() * conLugar.length)] as number;
    const cambia = barajar((reparto[destino] as number[]).filter((i) => !esFinal.has(i)), o.rng)[0] as number;
    const a = reparto[llena] as number[], b = reparto[destino] as number[];
    a[a.indexOf(sobra)] = cambia;
    b[b.indexOf(cambia)] = sobra;
  }
  const tandas: Tanda[] = [];
  const gente: number[] = [];
  let t = o.t0;
  for (let h = 0; h < T; h++) {
    const miembros = alfabetico(o.nombres, reparto[h] as number[]);
    const fin = miembros.filter((i) => esFinal.has(i));
    const otras = barajar(miembros.filter((i) => !esFinal.has(i)), o.rng).slice(0, Math.max(0, p - fin.length));
    // El orden de salida es otro sorteo: no mira si es finalista.
    const pasan = barajar([...fin, ...otras], o.rng);
    const salidas = pasan.map((_, j) => t + CARTEL_S + j * SALIDA_PORTON);
    const tCierra = t + CARTEL_S + (pasan.length - 1) * SALIDA_PORTON + CIERRE_PORTON;
    const tFin = tCierra + ENTRE_TANDAS;
    const quedan = new Set(pasan);
    tandas.push({ indice: h, miembros, pasan, noPasan: miembros.filter((i) => !quedan.has(i)), t0: t, salidas, tCierra, tFin });
    gente.push(...pasan);
    t = tFin;
  }
  return { tandas, gente, tFin: t };
}
