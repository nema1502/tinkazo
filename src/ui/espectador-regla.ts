import { roundTime } from "../protocol/quicknet";

/**
 * Cuándo arranca el show en el celular de quien mira (`espectador.ts`), respecto de la ronda.
 *
 * Es la regla de la sala, copiada en un solo lugar para que las dos digan lo mismo:
 *
 * - Sin sello en Stellar (el modo libre), la sala busca el número apenas nace la ronda y juega enseguida
 *   (`draw.ts`, con `secondsToRound` de `freeze.ts` sin margen). El celular, igual.
 * - Con el sorteo sellado, la sala espera unos segundos de margen después de que nace la ronda (`CHAIN_MARGIN_SECONDS`
 *   en `freeze.ts`), busca el número, saca la tarjeta del juego y recién juega cuando el sorteo quedó grabado en la
 *   cadena (`draw.ts`: la tarjeta espera a `grabado()`). El celular espera el mismo margen y después mira la cadena
 *   hasta ver el sorteo grabado (`espectador-cadena.ts`). Así puede ir un par de segundos detrás del proyector, nunca
 *   adelante: el ganador lo grita la sala primero.
 * - Si lo grabado no aparece (quien organiza no lo lanza, o el celular no llega a leer la cadena), el celular no se
 *   queda colgado: pasado `largaIgualTrasMs` juega igual, con los ganadores que calculó él mismo con el protocolo,
 *   que son los mismos que va a grabar el contrato.
 *
 * Si la sala cambia cuándo arranca (por ejemplo, jugar apenas nace el número sin esperar lo grabado), lo que cambia
 * acá es `esperaLoGrabado` y `margenS`, y la prueba de este archivo dice qué tiene que coincidir con la sala.
 */

/** El margen que la sala le da a la cadena antes de sortear: el mismo número que `CHAIN_MARGIN_SECONDS` en `freeze.ts`. */
export const MARGEN_DE_LA_CADENA_S = 8;

/** Lo más que el celular espera a ver el sorteo grabado antes de jugar igual. */
export const LARGA_IGUAL_TRAS_MS = 2 * 60_000;

/** Desde cuándo el celular dice que la sala todavía no lanzó el sorteo, mientras espera lo grabado. */
export const AVISO_TARDE_MS = 45_000;

export interface ReglaDelShow {
  /** Los segundos después de que nace la ronda en que el celular va a buscar el número. */
  margenS: number;
  /** Si el juego espera a ver el sorteo grabado en la cadena antes de arrancar. */
  esperaLoGrabado: boolean;
  /** Lo más que se espera lo grabado: pasado eso, se juega igual. */
  largaIgualTrasMs: number;
  /** Desde cuándo se avisa que la sala todavía no lo lanzó. */
  avisoTardeMs: number;
}

/** La regla para un sorteo sellado en Stellar (`sellado`) o no. */
export function reglaDelShow(sellado: boolean): ReglaDelShow {
  return sellado
    ? { margenS: MARGEN_DE_LA_CADENA_S, esperaLoGrabado: true, largaIgualTrasMs: LARGA_IGUAL_TRAS_MS, avisoTardeMs: AVISO_TARDE_MS }
    : { margenS: 0, esperaLoGrabado: false, largaIgualTrasMs: 0, avisoTardeMs: 0 };
}

/** La hora (en segundos, la de la ronda) en que el celular termina la cuenta y va a buscar el número. */
export function horaDeBuscarElNumero(round: number, sellado: boolean): number {
  return roundTime(round) + reglaDelShow(sellado).margenS;
}
