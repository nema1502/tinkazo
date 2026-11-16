import { roundTime } from "./protocol/quicknet";

/**
 * Cuándo arranca el show respecto del número que decide, en un solo lugar.
 *
 * El resultado lo fijan el sello y el número público de la ronda: apenas el número nace y se comprueba, el navegador
 * calcula quién gana con la misma cuenta del contrato (`sorteo-local.ts`). Por eso el show no espera a que el sorteo
 * quede grabado: la tarjeta de cómo se juega (que no dice quién gana) sale en los últimos segundos de la espera, la
 * sala cuenta 3, 2, 1 apenas hay resultado y el sorteo se graba aparte, cuando la cadena lo acepta.
 *
 * Lo usa la sala, y lo puede usar cualquier otra pantalla que muestre el mismo sorteo (por ejemplo, el celular de
 * quien mira) para no adelantarse a la sala: ninguna puede empezar a contar antes de `cuenta`.
 */

/** Lo que dura la lectura de la tarjeta de cómo se juega. */
export const LECTURA_DE_LA_TARJETA_S = 3.5;

/** Lo que dura el 3, 2, 1 de la sala, cuando la duración lo lleva (`conCuenta` en `state.ts`). */
export const CUENTA_DE_LA_SALA_S = 3;

/**
 * Cuántos segundos después de nacer el número empieza, como muy temprano, el 3, 2, 1. Es cero: la sala empieza a
 * contar en cuanto el número llegó y se comprobó, que suele tardar unas décimas. Nunca antes de que nazca.
 */
export const CUENTA_TRAS_LA_RONDA_S = 0;

/**
 * Los segundos después de nacer el número en que la cadena ya acepta grabar el sorteo. El contrato compara la hora de
 * la ronda con la hora de cierre del ledger, que va unos segundos detrás del reloj. Es parte de la espera de la
 * grabación, que va aparte: la sala ya no la espera.
 */
export const MARGEN_DE_LA_CADENA_S = 8;

/** Los momentos del show, en segundos Unix (con decimales). */
export interface ArranqueDelShow {
  /** Nace el número de la ronda. */
  nace: number;
  /** Sale la tarjeta de cómo se juega, cuando el sorteo se lanza solo: termina de leerse justo cuando nace el número. */
  tarjeta: number;
  /** Lo más temprano que la sala empieza a contar 3, 2, 1. */
  cuenta: number;
  /** Lo más temprano que arranca el juego. */
  juego: number;
  /** Desde cuándo se puede grabar el sorteo. */
  grabable: number;
}

/** Los momentos del show para una ronda. `conCuenta`: si la duración elegida lleva el 3, 2, 1. */
export function arranqueDelShow(round: number, conCuenta = true): ArranqueDelShow {
  const nace = roundTime(round);
  const cuenta = nace + CUENTA_TRAS_LA_RONDA_S;
  return {
    nace,
    tarjeta: nace - LECTURA_DE_LA_TARJETA_S,
    cuenta,
    juego: cuenta + (conCuenta ? CUENTA_DE_LA_SALA_S : 0),
    grabable: nace + MARGEN_DE_LA_CADENA_S,
  };
}

/** Cuántos segundos después de nacer el número arranca el juego, como muy temprano. */
export function juegoTrasLaRonda(conCuenta = true): number {
  return CUENTA_TRAS_LA_RONDA_S + (conCuenta ? CUENTA_DE_LA_SALA_S : 0);
}

/** Milisegundos que faltan para un momento (en segundos Unix). Cero si ya pasó. */
export function msHasta(momento: number, ahoraMs = Date.now()): number {
  return Math.max(0, Math.ceil(momento * 1000 - ahoraMs));
}
