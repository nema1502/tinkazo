/**
 * Qué forma del nombre lleva cada ficha de la carrera, como función de la hora del show. Puro: no importa PixiJS.
 *
 * El nivel del nombre (`games/nombres.ts`: 2 el de pila, 3 con la inicial del apellido, 4 entero) sale de cuántas siguen en carrera
 * (`nivelPorVivas`), todas a la vez y nunca por quién. Esa cuenta solo cambia cuando una se echa (o en la salida, o cuando se abre
 * la recta), así que los cambios de nivel son horas que el plan ya conoce: `nivelesDe` las saca una vez. En cada una el nombre
 * de todas pasa de una forma a la otra con un fundido de `FUNDIDO_NOMBRE` segundos, en vez de cambiar de golpe en un cuadro.
 *
 * La que se echa lleva su nombre con la inicial del apellido (`NIVEL_ECHADA`), y su cambio también se funde, desde la hora en que se
 * echa. Nada se guarda entre cuadros: la forma en una hora es la misma llegando cuadro por cuadro, saltando o yendo hacia atrás.
 */

import type { Nivel } from "../nombres";
import type { Datos } from "./carrera-show";

/** Cuánto dura el fundido de una forma del nombre a la siguiente, en segundos. */
export const FUNDIDO_NOMBRE = 0.4;

/** El nivel de la ficha de una que se echó: el nombre con la inicial del apellido. */
export const NIVEL_ECHADA: Nivel = 3;

/** El nivel de todas según cuántas siguen en carrera: hasta 8, el nombre entero; hasta 14, con la inicial del apellido; con más, el de pila. */
export const nivelPorVivas = (vivas: number): Nivel => (vivas <= 8 ? 4 : vivas <= 14 ? 3 : 2);

/** Cuántas siguen en carrera en `t`: la cuenta que decide el nivel. */
export const vivasEn = (d: Datos, t: number): number => (d.tiempos.echadas.length ? d.vivas(t).length : d.lanes.length);

/** Un cambio del nivel de todas: en la hora `t` pasa de `de` a `a`. */
export interface CambioNivel {
  t: number;
  de: Nivel;
  a: Nivel;
}

export interface NivelesCarrera {
  /** El nivel antes del primer cambio. */
  inicial: Nivel;
  /** Los cambios, en orden. */
  cambios: CambioNivel[];
}

const EPS = 1e-6;

/** Las horas en que cambia el nivel de todas, sacadas del plan una vez: la cuenta de las que siguen solo cambia en estas horas. */
export function nivelesDe(d: Datos): NivelesCarrera {
  const nivel = (t: number): Nivel => nivelPorVivas(vivasEn(d, t));
  const horas = [...new Set([d.tSalida, d.tAbre, ...d.tiempos.echadas.map((e) => e.t)])].filter(Number.isFinite).sort((a, b) => a - b);
  const cambios: CambioNivel[] = [];
  for (const t of horas) {
    const de = nivel(t - EPS), a = nivel(t);
    if (de !== a) cambios.push({ t, de, a });
  }
  return { inicial: nivel((horas[0] ?? 0) - 1), cambios };
}

/** El nivel de todas en `t`, sin fundido. */
export function nivelGeneral(n: NivelesCarrera, t: number): Nivel {
  let v = n.inicial;
  for (const c of n.cambios) {
    if (c.t > t) break;
    v = c.a;
  }
  return v;
}

/** La forma de una ficha en una hora: el nombre en el nivel `de` se va mientras llega el del nivel `a` (`mezcla` de 0 a 1; con 1 solo se ve `a`). */
export interface FormaEn {
  de: Nivel;
  a: Nivel;
  mezcla: number;
}

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/**
 * La forma del nombre de una ficha en la hora `t`. `echadaDesde` es la hora en que se echó (`Infinity` si sigue en carrera): desde
 * ahí su nivel es `NIVEL_ECHADA` y no sigue al de todas. El fundido arranca en la hora del último cambio y dura `dur`.
 */
export function formaEn(n: NivelesCarrera, t: number, echadaDesde = Infinity, dur = FUNDIDO_NOMBRE): FormaEn {
  let desde: number, de: Nivel, a: Nivel;
  if (t >= echadaDesde) {
    desde = echadaDesde;
    de = nivelGeneral(n, echadaDesde - EPS);
    a = NIVEL_ECHADA;
  } else {
    let ultimo: CambioNivel | undefined;
    for (const c of n.cambios) {
      if (c.t > t) break;
      ultimo = c;
    }
    if (!ultimo) return { de: n.inicial, a: n.inicial, mezcla: 1 };
    ({ t: desde, de, a } = ultimo);
  }
  const mezcla = suave((t - desde) / dur);
  return de === a || mezcla >= 1 ? { de: a, a, mezcla: 1 } : { de, a, mezcla };
}
