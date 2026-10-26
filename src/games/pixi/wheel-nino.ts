import type { Respuestas } from "./kit/respuestas";
import { T_CROWN, T_HOLD, T_LOCK, T_WIND } from "./wheel-beats";

/**
 * Las respuestas de la prueba del niño para la ruleta (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale del plan de la rueda (`wheel-motion.ts`), no de lo
 * que se ve.
 *
 * - **adelante**: el gajo que está bajo la flecha, y su vecino si la flecha está
 *   cerca del borde. Con el cartel, quien gana. (En la ruleta, adelante no es
 *   ganar: pasan por la flecha todos.)
 * - **hacia**: «alrededor»: la rueda gira. Adónde mirar para saber quién gana, la
 *   flecha, lo dice `adelante.lugar`: el juego (`wheel.ts`) mide en qué parte de la
 *   pantalla cae el gajo de la flecha, que depende de la cámara y el plan no la conoce.
 * - **progreso**: la hora sobre la hora del cartel, como De pie.
 * - **paso**: que la rueda empezó a girar (`empezo`, y pasada la ventana `nada`),
 *   el amague de la parada falsa (`casi`), la traba (`freno`) y el cartel (`gano`).
 *   Que la flecha pase de un gajo a otro no cuenta: es la rueda girando.
 */
export interface PlanDeLaRuleta {
  /** Cuántas personas hay. */
  n: number;
  /** Cuántos gajos tiene la rueda. */
  segs: number;
  /** Con más de veinticuatro, cada gajo reúne a un grupo seguido de la lista. */
  grupos: readonly (readonly number[])[] | null;
  /** Dónde está la flecha al arrancar, en gajos. */
  startSeg: number;
  mov: { pos(t: number): number };
  /** El puesto de la lista que gana. */
  ganador: number;
  /** El arco «susto»: la parada falsa. */
  falsa: boolean;
}

/** La rueda gira: «alrededor». La flecha, arriba de la rueda, es dónde se ve quién va adelante. */
export const SENTIDO_RULETA = "alrededor" as const;
/** Cuánto de un gajo, pegado al borde, cuenta como «cerca» del vecino. */
export const CERCA_DEL_BORDE = 0.12;
/** «Qué acaba de pasar» es lo de hace tres segundos o menos; pasado eso, «nada nuevo». */
export const VENTANA = 3;

const mod = (a: number, m: number): number => ((a % m) + m) % m;

export function respuestasRuleta(p: PlanDeLaRuleta, t: number): Respuestas {
  const tt = Math.max(0, t);
  /** Las personas de un gajo: una, o el grupo entero si son más de veinticuatro. */
  const unidad = (k: number): number[] => {
    const s = mod(k, p.segs);
    return p.grupos ? [...(p.grupos[s] ?? [])] : [mod(s, p.n)];
  };
  const bajoLaFlecha = (hora: number): { seg: number; f: number } => {
    const s = mod(p.startSeg + p.mov.pos(hora), p.segs);
    const seg = Math.floor(s);
    return { seg, f: s - seg };
  };
  const ahora = bajoLaFlecha(tt);

  let quienes: number[];
  if (tt >= T_CROWN) quienes = [p.ganador];
  else {
    quienes = unidad(ahora.seg);
    if (ahora.f < CERCA_DEL_BORDE) quienes = quienes.concat(unidad(ahora.seg - 1));
    else if (ahora.f > 1 - CERCA_DEL_BORDE) quienes = quienes.concat(unidad(ahora.seg + 1));
    quienes = quienes.filter((x, i, a) => a.indexOf(x) === i);
  }

  let paso: Respuestas["paso"];
  if (tt >= T_CROWN) paso = { tipo: "gano", quien: p.ganador, desde: T_CROWN };
  else if (tt >= T_LOCK) paso = { tipo: "freno", quien: p.ganador, desde: T_LOCK };
  else if (p.falsa && tt >= T_HOLD) paso = { tipo: "casi", quien: unidad(bajoLaFlecha(T_HOLD).seg)[0] ?? 0, desde: T_HOLD };
  else if (tt < T_WIND) paso = { tipo: "empezo", desde: 0 };
  // Girando, que la flecha pase de un gajo al siguiente no es un hecho: es la rueda. Lo último que pasó es que empezó a girar y, pasada la ventana, nada nuevo.
  else paso = tt - T_WIND > VENTANA ? { tipo: "nada", desde: T_WIND } : { tipo: "empezo", desde: T_WIND };

  return {
    adelante: { quienes, lugar: "arriba" },
    hacia: SENTIDO_RULETA,
    progreso: Math.min(1, tt / T_CROWN),
    paso,
  };
}
