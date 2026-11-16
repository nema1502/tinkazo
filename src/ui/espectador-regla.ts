import { roundTime } from "../protocol/quicknet";
import { MARGEN_DE_LA_CADENA_S as MARGEN_PARA_GRABAR_S } from "../arranque-del-show";

/**
 * Cuándo arranca el show en el celular de quien mira (`espectador.ts`), respecto de la ronda y de la sala.
 *
 * La regla de la decisión: el celular nunca muestra al ganador antes que la sala. Puede ir detrás, nunca adelante.
 *
 * - Sin sello en Stellar (el modo libre), la sala busca el número apenas nace la ronda y juega enseguida
 *   (`draw.ts`, con `secondsToRound` de `freeze.ts` sin margen). El celular, igual.
 * - Con el sorteo sellado, desde el 16 de noviembre de 2026 la sala tampoco espera: busca el número apenas nace la
 *   ronda, calcula el resultado en el navegador y juega (`draw.ts`, `arranque-del-show.ts`). El sorteo se graba aparte,
 *   y solo después de que la sala tiene el resultado: la grabación arranca con el resultado ya fijado, y la cadena
 *   no la acepta antes de `MARGEN_DE_LA_CADENA_S` después de la ronda (`grabar-sorteo.ts`). Con la billetera propia,
 *   recién al terminar el show. El celular no sabe cuándo lanzó la sala: lo único que ve es la cadena. Por eso
 *   sigue esperando a ver el sorteo grabado, que siempre llega después de que la sala tiene el resultado, más
 *   `retrasoTrasLoGrabadoMs`. Así queda detrás de la sala, más que antes (la sala ya no espera lo grabado), y nunca
 *   adelante: el ganador lo grita la sala primero.
 * - La cuenta del celular termina cuando la de la sala, al nacer la ronda, y ahí trae el número (`margenS`, cero). La
 *   cadena la empieza a mirar recién cuando acepta el sorteo grabado (`miraLaCadenaDesdeS`): antes no hay nada que
 *   ver, y cada lectura de más de cada celular de la sala es carga para el RPC.
 * - Si la cadena contesta que el sorteo está sellado y sin resultado, la sala todavía no lo lanzó o todavía no lo
 *   guardó (lo lanzó y se está guardando, con la billetera propia se guarda al final del show, o no se pudo guardar):
 *   el celular sigue esperando, sin tope, y lo dice. Jugar ahí podría ser coronar antes que la sala.
 * - Si el celular no llega a leer la cadena, no se queda colgado: pasado `largaIgualTrasMs` sin ninguna respuesta
 *   juega igual, con los ganadores que calculó él mismo con el protocolo, que son los mismos que va a grabar el
 *   contrato. Si la cadena contesta pero el sello nunca aparece, pasado ese mismo tope el enlace no es de un sorteo
 *   sellado y no hay show.
 * - Lo que salió, con los nombres grandes, no sale antes de que la sala termine su show (`horaDelFinal`), y el show
 *   del celular no se salta (`solo-mirar.ts`).
 *
 * Si la sala cambia cuándo arranca o cuándo graba, lo que cambia acá es `esperaLoGrabado`, `margenS`,
 * `miraLaCadenaDesdeS` y el retraso, y la prueba de este archivo dice qué tiene que coincidir con la sala.
 */

/**
 * Desde cuándo, en segundos después de la ronda, la cadena acepta grabar el sorteo: el mismo número que usa la
 * grabación de la sala (`arranque-del-show.ts`). Ni la sala ni la cuenta del celular lo esperan. El celular empieza a
 * mirar la cadena recién ahí: antes no puede haber nada grabado que ver.
 */
export const MARGEN_DE_LA_CADENA_S = MARGEN_PARA_GRABAR_S;

/**
 * Lo que el celular espera después de ver el sorteo grabado, un margen más para no adelantarse a la sala.
 *
 * Desde el 16 de noviembre de 2026 la sala juega sin esperar lo grabado, y lo grabado llega siempre después de que la
 * sala tiene su resultado: este retraso queda de margen. Se deja como estaba: el celular ya va detrás, y bajarlo no
 * adelanta nada que importe.
 *
 * Se midió una sola vez, el 15 de noviembre de 2026, cuando la sala todavía esperaba lo grabado: el sorteo 992 en
 * Prueba, con la cuenta de prueba, que firma en la compu de la sala y se entera de lo grabado por la confirmación de su
 * propio envío. Con 2,5 s el juego del celular arrancó 0,8 s después que el de la sala. Lo que se anotó entonces:
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

/** Desde cuándo el celular dice que el sorteo todavía no quedó guardado, si la cadena lo muestra sellado y sin resultado. */
export const AVISO_TARDE_MS = 45_000;

export interface ReglaDelShow {
  /** Los segundos después de que nace la ronda en que el celular termina la cuenta y va a buscar el número. */
  margenS: number;
  /** Los segundos después de que nace la ronda en que el celular empieza a mirar la cadena. */
  miraLaCadenaDesdeS: number;
  /** Si el juego espera a ver el sorteo grabado en la cadena antes de arrancar. */
  esperaLoGrabado: boolean;
  /** Lo que se espera después de verlo grabado, antes de que la tarjeta siga con la cuenta. */
  retrasoTrasLoGrabadoMs: number;
  /** Lo más que se espera a una cadena que no contesta: pasado eso, se juega igual. */
  largaIgualTrasMs: number;
  /** Desde cuándo se avisa que el sorteo todavía no quedó guardado (la sala no lo lanzó o no lo guardó). */
  avisoTardeMs: number;
}

/** La regla para un sorteo sellado en Stellar (`sellado`) o no. */
export function reglaDelShow(sellado: boolean): ReglaDelShow {
  return sellado
    ? {
        // Como la sala, que desde el 16 de noviembre de 2026 no suma margen: la cuenta de los dos dice lo mismo.
        margenS: 0,
        miraLaCadenaDesdeS: MARGEN_DE_LA_CADENA_S,
        esperaLoGrabado: true,
        retrasoTrasLoGrabadoMs: RETRASO_TRAS_LO_GRABADO_MS,
        largaIgualTrasMs: LARGA_IGUAL_TRAS_MS,
        avisoTardeMs: AVISO_TARDE_MS,
      }
    : { margenS: 0, miraLaCadenaDesdeS: 0, esperaLoGrabado: false, retrasoTrasLoGrabadoMs: 0, largaIgualTrasMs: 0, avisoTardeMs: 0 };
}

/** La hora (en segundos, la de la ronda) en que el celular termina la cuenta y va a buscar el número. */
export function horaDeBuscarElNumero(round: number, sellado: boolean): number {
  return roundTime(round) + reglaDelShow(sellado).margenS;
}

/** La hora (en segundos, la de la ronda) desde la que el celular mira la cadena para ver el sorteo grabado. */
export function horaDeMirarLaCadena(round: number): number {
  return roundTime(round) + reglaDelShow(true).miraLaCadenaDesdeS;
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
 * - Lo que promete el ritmo, desde que lanzó. La sala, desde que tiene el resultado, hace la cuenta y el juego: lo
 *   mismo menos la tarjeta, que leyó mientras llegaba el número. El celular lanza después de verlo grabado, y lo
 *   grabado llega después de que la sala tiene el resultado, así que su final cae después del de la sala, con la
 *   tarjeta de margen. Cubre al celular que no muestra el juego (pidió menos movimiento: el juego termina en el acto y
 *   el final salía unos 40 s antes que en la sala).
 * - Un margen después de que terminó el show del celular: 3 s, o un 10 % de lo que duró si es más. Una sala que dibuja
 *   más lento que el celular estira su juego (medido el 16 de noviembre de 2026 sin placa de video: 60,8 s en la sala
 *   y 56,3 s en el celular, con el celular 2,1 s detrás al arrancar). Cubre una sala hasta un 10 % más lenta.
 */
export function horaDelFinal(lanzadoMs: number, segundosDelShow: number, terminoMs: number = lanzadoMs): number {
  const prometido = lanzadoMs + segundosDelShow * 1000;
  const margen = Math.max(MARGEN_DEL_FINAL_MS, (terminoMs - lanzadoMs) * MARGEN_DEL_FINAL_PARTE);
  return Math.max(prometido, terminoMs + margen);
}
