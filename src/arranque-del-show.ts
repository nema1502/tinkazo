import { roundTime } from "./protocol/quicknet";

/**
 * Cuándo arranca el show respecto del número que decide, en un solo lugar: el de la sala y el del celular de quien mira.
 *
 * El resultado lo fijan el sello y el número público de la ronda: apenas el número nace y se comprueba, el navegador
 * calcula quién gana con la misma cuenta del contrato (`sorteo-local.ts`). Por eso el show no espera a que el sorteo
 * quede grabado: la tarjeta de cómo se juega (que no dice quién gana) sale en los últimos segundos de la espera, la
 * sala cuenta 3, 2, 1 y el sorteo se graba aparte, cuando la cadena lo acepta.
 *
 * Desde el 16 de noviembre de 2026 hay una sola línea de tiempo, la del nacimiento del número, y cada aparato la sigue
 * desde la llegada de su propio número (`reloj-de-la-ronda.ts`, el ancla), que nunca es antes de que nazca. La sala
 * arranca su juego `juegoTrasLaLlegada` después de esa llegada; el celular, lo mismo más `ATRASO_DEL_CELULAR_S`. Así el
 * celular arranca casi a la par y nunca antes, sin depender del reloj de ninguno de los dos.
 */

/** Lo que dura la lectura de la tarjeta de cómo se juega. */
export const LECTURA_DE_LA_TARJETA_S = 3.5;

/** Lo que dura el 3, 2, 1 de la sala, cuando la duración lo lleva (`conCuenta` en `state.ts`). */
export const CUENTA_DE_LA_SALA_S = 3;

/**
 * Lo que tiene la sala, desde que nace el número, para traerlo, comprobarlo y calcular quién gana antes de empezar a
 * contar. Suele tardar unas décimas. Si tarda más, la cuenta arranca cuando el resultado está, y la sala ya no va a la
 * par (`espectadores-de-la-sala.ts`).
 */
export const MARGEN_DEL_NUMERO_S = 1.5;

/** Lo que suele tardar el número en llegar después de nacer (medido el 16 de noviembre de 2026: 0,07 a 0,11 s). */
export const LLEGADA_TIPICA_S = 0.1;

/**
 * Sin cuenta (Rápido), lo que tiene el estadio para armarse después del resultado: el juego se arma con los ganadores, y
 * sin la cuenta no hay otro momento para hacerlo.
 */
export const MARGEN_DEL_ESTADIO_S = 1.5;

/**
 * Lo que el celular va detrás de la sala cuando las dos van a la par. Cubre que el número de la sala le haya llegado
 * hasta la ida y vuelta máxima después de nacer (`IDA_Y_VUELTA_MAX_MS`) y el del celular en el acto, y deja más de
 * medio segundo de margen. Con los dos números a la vez, el celular arranca 1,2 s detrás: dentro de los 2 s pedidos.
 */
export const ATRASO_DEL_CELULAR_S = 1.2;

/** Cuántos segundos después de nacer el número empieza, como muy temprano, el 3, 2, 1, si la sala va a la par. */
export const CUENTA_TRAS_LA_RONDA_S = MARGEN_DEL_NUMERO_S;

/**
 * Los segundos después de nacer el número en que la cadena ya acepta grabar el sorteo. El contrato compara la hora de
 * la ronda con la hora de cierre del ledger, que va unos segundos detrás del reloj. Es parte de la espera de la
 * grabación, que va aparte: la sala ya no la espera.
 */
export const MARGEN_DE_LA_CADENA_S = 8;

/**
 * Cuántos segundos después de la llegada de su número arranca el juego la sala (o el celular, con `celular`). Con la
 * cuenta: el margen del número y los 3 s de la cuenta. Sin ella: el margen del número y el del estadio.
 */
export function juegoTrasLaLlegada(conCuenta = true, celular = false): number {
  const sala = MARGEN_DEL_NUMERO_S - LLEGADA_TIPICA_S + (conCuenta ? CUENTA_DE_LA_SALA_S : MARGEN_DEL_ESTADIO_S);
  return Math.round((sala + (celular ? ATRASO_DEL_CELULAR_S : 0)) * 1000) / 1000;
}

/**
 * Una tarjeta que abre con menos de esto de lectura por delante (una compuerta del modo Oficial que tardó, un toque
 * tarde) no se acorta: lee sus 3,5 s, y esa sala ya no va a la par.
 */
export const lecturaMinimaS = (): number => 1.5;

/** Los momentos del show, en segundos Unix (con decimales), con el número llegando a su hora típica. */
export interface ArranqueDelShow {
  /** Nace el número de la ronda. */
  nace: number;
  /** Sale la tarjeta de cómo se juega, cuando el sorteo se lanza solo: se lee entera y termina con la cuenta a horario. */
  tarjeta: number;
  /** Empieza el 3, 2, 1 (sin cuenta, arranca el juego). */
  cuenta: number;
  /** Arranca el juego. */
  juego: number;
  /** Desde cuándo se puede grabar el sorteo. */
  grabable: number;
}

/** Los momentos del show para una ronda. `conCuenta`: si la duración elegida lleva el 3, 2, 1. `celular`: los del celular. */
export function arranqueDelShow(round: number, conCuenta = true, celular = false): ArranqueDelShow {
  const nace = roundTime(round);
  const juego = nace + LLEGADA_TIPICA_S + juegoTrasLaLlegada(conCuenta, celular);
  const cuenta = juego - (conCuenta ? CUENTA_DE_LA_SALA_S : 0);
  return {
    nace,
    tarjeta: cuenta - LECTURA_DE_LA_TARJETA_S,
    cuenta,
    juego,
    grabable: nace + MARGEN_DE_LA_CADENA_S,
  };
}

/** Cuántos segundos después de nacer el número arranca el juego de la sala, con el número llegando a su hora típica. */
export function juegoTrasLaRonda(conCuenta = true): number {
  return LLEGADA_TIPICA_S + juegoTrasLaLlegada(conCuenta);
}

/** Milisegundos que faltan para un momento (en segundos Unix). Cero si ya pasó. */
export function msHasta(momento: number, ahoraMs = Date.now()): number {
  return Math.max(0, Math.ceil(momento * 1000 - ahoraMs));
}
