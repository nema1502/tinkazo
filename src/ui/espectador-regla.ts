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
 *   hasta ver el sorteo grabado (`espectador-cadena.ts`). El celular puede enterarse antes que la sala: lee la cadena
 *   apenas cierra el ledger, y la sala espera la confirmación de su envío. Medido de verdad en Prueba el 15 de
 *   noviembre de 2026 (`scripts/audit-espectador.mjs`), el juego del celular arrancó 0,8 s antes que el de la sala. Por
 *   eso, después de verlo grabado, espera `retrasoTrasLoGrabadoMs` más. Así va un par de segundos detrás del
 *   proyector, nunca adelante: el ganador lo grita la sala primero.
 * - Si la cadena contesta que el sorteo está sellado y sin resultado, la sala todavía no lo lanzó (quien organiza
 *   tiene que tocar Lanzar el sorteo, o volvió a la página): el celular sigue esperando, sin tope, y lo dice. Jugar
 *   ahí sería coronar antes que la sala.
 * - Si el celular no llega a leer la cadena, no se queda colgado: pasado `largaIgualTrasMs` sin ninguna respuesta
 *   juega igual, con los ganadores que calculó él mismo con el protocolo, que son los mismos que va a grabar el
 *   contrato. Si la cadena contesta pero el sello nunca aparece, pasado ese mismo tope el enlace no es de un sorteo
 *   sellado y no hay show.
 * - Lo que salió, con los nombres grandes, no sale antes de que la sala termine su show (`horaDelFinal`), y el show
 *   del celular no se salta (`solo-mirar.ts`).
 *
 * Si la sala cambia cuándo arranca (por ejemplo, jugar apenas nace el número sin esperar lo grabado), lo que cambia
 * acá es `esperaLoGrabado` y `margenS`, y la prueba de este archivo dice qué tiene que coincidir con la sala.
 */

/** El margen que la sala le da a la cadena antes de sortear: el mismo número que `CHAIN_MARGIN_SECONDS` en `freeze.ts`. */
export const MARGEN_DE_LA_CADENA_S = 8;

/**
 * Lo que el celular espera después de ver el sorteo grabado, para no adelantarse a la confirmación de la sala.
 *
 * Medido una sola vez, el 15 de noviembre de 2026: el sorteo 992 en Prueba, con la cuenta de prueba, que firma en la
 * compu de la sala y se entera de lo grabado por la confirmación de su propio envío. Con 2,5 s el juego del celular
 * arrancó 0,8 s después que el de la sala. Falta medir, y puede pedir más:
 *
 * - En Oficial con una cuenta de Google, la sala se entera de lo grabado por el servidor de Pollar
 *   (`submitElsewhere` en `anchor.ts`), que no es el camino medido. Si ese aviso tarda un segundo más, el celular
 *   arranca primero. Hay que medir varias vueltas y fijar esto con el peor caso.
 * - Una compu de sala que dibuja a menos de 20 cuadros por segundo (un proyector sin placa de video) estira el juego
 *   (el reloj del estadio avanza como mucho 0,05 s por cuadro, `stage.ts`), y un celular a 60 corona antes aunque
 *   haya arrancado después. Lo que salió, con los nombres grandes, igual espera a `horaDelFinal`, que deja la
 *   tarjeta de margen. La coronación dentro del juego no se puede retener: el celular no sabe cómo dibuja la sala.
 *
 * Desde el 16 de noviembre de 2026 el celular mira la cadena cada 3 a 5 s y no cada 1,5 s (`espectador-cadena.ts`):
 * se entera, en promedio, unos 2 s más tarde que en la medida. El peor caso (verlo apenas cierra el ledger) es el
 * mismo, y por eso el retraso no baja.
 */
export const RETRASO_TRAS_LO_GRABADO_MS = 2_500;

/** Lo más que el celular espera a una cadena que no contesta antes de jugar igual (`espectador-cadena.ts`). */
export const LARGA_IGUAL_TRAS_MS = 2 * 60_000;

/** Desde cuándo el celular dice que la sala todavía no lanzó el sorteo, si la cadena lo muestra sellado y sin resultado. */
export const AVISO_TARDE_MS = 45_000;

export interface ReglaDelShow {
  /** Los segundos después de que nace la ronda en que el celular va a buscar el número. */
  margenS: number;
  /** Si el juego espera a ver el sorteo grabado en la cadena antes de arrancar. */
  esperaLoGrabado: boolean;
  /** Lo que se espera después de verlo grabado, antes de que la tarjeta siga con la cuenta. */
  retrasoTrasLoGrabadoMs: number;
  /** Lo más que se espera a una cadena que no contesta: pasado eso, se juega igual. */
  largaIgualTrasMs: number;
  /** Desde cuándo se avisa que la sala todavía no lo lanzó. */
  avisoTardeMs: number;
}

/** La regla para un sorteo sellado en Stellar (`sellado`) o no. */
export function reglaDelShow(sellado: boolean): ReglaDelShow {
  return sellado
    ? {
        margenS: MARGEN_DE_LA_CADENA_S,
        esperaLoGrabado: true,
        retrasoTrasLoGrabadoMs: RETRASO_TRAS_LO_GRABADO_MS,
        largaIgualTrasMs: LARGA_IGUAL_TRAS_MS,
        avisoTardeMs: AVISO_TARDE_MS,
      }
    : { margenS: 0, esperaLoGrabado: false, retrasoTrasLoGrabadoMs: 0, largaIgualTrasMs: 0, avisoTardeMs: 0 };
}

/** La hora (en segundos, la de la ronda) en que el celular termina la cuenta y va a buscar el número. */
export function horaDeBuscarElNumero(round: number, sellado: boolean): number {
  return roundTime(round) + reglaDelShow(sellado).margenS;
}

/** Lo que Lo que salió espera, como mínimo, después de que termina el show del celular. */
export const MARGEN_DEL_FINAL_MS = 3_000;
/** Y si el show del celular fue largo, una parte de lo que duró: una sala que dibuja más lento tarda más en proporción. */
export const MARGEN_DEL_FINAL_PARTE = 0.1;

/**
 * Lo más temprano (en milisegundos del reloj del teléfono) que el celular muestra Lo que salió, si lanzó el show en
 * `lanzadoMs`, el ritmo del enlace promete `segundosDelShow` para este juego (`paceSeconds` de `state.ts`: la tarjeta,
 * la cuenta y el juego) y el show del celular terminó en `terminoMs`. Lo más tarde de dos cosas:
 *
 * - Lo que promete el ritmo, desde que lanzó. La sala, desde que ve el sorteo grabado, hace la cuenta y el juego: lo
 *   mismo menos la tarjeta, que leyó mientras se grababa. El celular lanza después de verlo grabado, así que su final
 *   cae después del de la sala, con la tarjeta de margen. Cubre al celular que no muestra el juego (pidió menos
 *   movimiento: el juego termina en el acto y el final salía unos 40 s antes que en la sala).
 * - Un margen después de que terminó el show del celular: 3 s, o un 10 % de lo que duró si es más. Una sala que dibuja
 *   más lento que el celular estira su juego (medido el 16 de noviembre de 2026 sin placa de video: 60,8 s en la sala
 *   y 56,3 s en el celular, con el celular 2,1 s detrás al arrancar). Cubre una sala hasta un 10 % más lenta.
 */
export function horaDelFinal(lanzadoMs: number, segundosDelShow: number, terminoMs: number = lanzadoMs): number {
  const prometido = lanzadoMs + segundosDelShow * 1000;
  const margen = Math.max(MARGEN_DEL_FINAL_MS, (terminoMs - lanzadoMs) * MARGEN_DEL_FINAL_PARTE);
  return Math.max(prometido, terminoMs + margen);
}
