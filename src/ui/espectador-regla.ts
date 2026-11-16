import { roundTime } from "../protocol/quicknet";
import { LECTURA_DE_LA_TARJETA_S, MARGEN_DE_LA_CADENA_S as MARGEN_PARA_GRABAR_S } from "../arranque-del-show";

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
 *   sigue esperando a ver el sorteo grabado, que siempre llega después de que la sala tiene el resultado, y después
 *   espera lo que dice `esperaTrasLoGrabadoMs`. Cuánto queda detrás depende de cuándo lanzó la sala:
 *   - Con la espera en grande, o con el botón tocado apenas nace el número, la sala tiene su resultado varios segundos
 *     antes de que la cadena acepte grabarlo, y juega mientras tanto. El celular espera solo
 *     `RETRASO_TRAS_LO_GRABADO_MS` y arranca muy detrás (medido en Prueba el 16 de noviembre de 2026: 16 s).
 *   - Si la sala lanza tarde (el botón tocado mucho después del número, el Reintentar de la espera o una compuerta de
 *     Oficial que tardó), ese colchón no está. La sala abre la tarjeta al lanzar y la lee después de traer el número,
 *     y lo grabado se ve apenas r + L después de lanzar (r es traer y comprobar el número, L lo que tarda en verse lo
 *     grabado, en el mejor caso un segundo y medio). La tarjeta del celular, en cambio, está leída desde que nació el
 *     número. Con el retraso solo, el celular arrancaba r + L - 1 s detrás, que puede ser casi nada, y con una sala que
 *     dibuja más lento coronaba antes. Por eso, si ve lo grabado más de `LANZADO_TARDE_TRAS_MS` después de que la
 *     cadena lo acepta, cuenta también la lectura de la tarjeta y un 10 % del show (`MARGEN_DEL_FINAL_PARTE`): arranca
 *     al menos el retraso y ese 10 % detrás, y una sala hasta un 10 % más lenta corona primero.
 *   - Entre los dos, la sala que lanza entre unos 6 y unos 16 s después del número, el celular ve lo grabado antes
 *     del tope y no la distingue de una sala que lanzó a tiempo y grabó lento: arranca al menos r + L - 1 s detrás, y
 *     con lo grabado lento varios segundos más. Es lo único que no queda cubierto del todo. Cubrirlo pide contar la
 *     lectura siempre, entre 5,5 y 8,5 s más de atraso en cada sorteo según el ritmo: basta con
 *     `LANZADO_TARDE_TRAS_MS` en cero.
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
 * `miraLaCadenaDesdeS`, el retraso y `esperaTrasLoGrabadoMs`, y la prueba de este archivo dice qué tiene que coincidir
 * con la sala.
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
 * sala tiene su resultado. Con la sala a tiempo el celular ya va muy detrás y este retraso es margen de más. Con la sala
 * que lanza poco después de que la cadena acepta grabar (ver arriba) es casi todo el margen que queda: no bajarlo.
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

/**
 * Si el celular ve lo grabado más de esto después de que la cadena acepta el sorteo grabado (`horaDeMirarLaCadena`), la
 * sala lo lanzó tarde. Con la sala a tiempo suele verse antes: medido en Prueba el 16 de noviembre de 2026, 5,9 s
 * después, con la lectura de la cadena cada 3 a 5 s. Cuando grabar tarda (la red ocupada, una cuenta de Google en
 * Oficial) pasa el tope aunque la sala haya lanzado a tiempo, y es solo más atraso: el mismo día, en otro sorteo, lo
 * grabado se vio unos 12,6 s después y el celular arrancó 30,5 s detrás de la sala, en vez de unos 23. Quien abre el
 * enlace tarde también espera de más, porque no se sabe si la sala acaba de lanzar.
 */
export const LANZADO_TARDE_TRAS_MS = 10_000;

/**
 * Lo que el celular espera después de ver el sorteo grabado, antes de que su tarjeta siga con la cuenta.
 * `vistoTrasMirarMs` es cuánto después de `horaDeMirarLaCadena` lo vio, en el reloj del teléfono, y `segundosDelShow` lo
 * que promete el ritmo (`paceSeconds` de `state.ts`: la tarjeta, la cuenta y el juego).
 *
 * Con la sala a tiempo, el retraso de siempre. Con la sala que lanzó tarde, además la lectura de la tarjeta, que la sala
 * hace después de lanzar y el celular ya hizo, y un 10 % del show, para una sala que dibuja más lento.
 */
export function esperaTrasLoGrabadoMs(vistoTrasMirarMs: number, segundosDelShow: number): number {
  if (vistoTrasMirarMs <= LANZADO_TARDE_TRAS_MS) return RETRASO_TRAS_LO_GRABADO_MS;
  return RETRASO_TRAS_LO_GRABADO_MS + LECTURA_DE_LA_TARJETA_S * 1000 + segundosDelShow * 1000 * MARGEN_DEL_FINAL_PARTE;
}

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
 *   tarjeta de margen. Si la sala lanzó tarde, lee la tarjeta después del número y su final cae a lo más el show entero
 *   después de su resultado: el del celular cae igual después, con la espera tras lo grabado de margen. Cubre al
 *   celular que no muestra el juego (pidió menos movimiento: el juego termina en el acto y el final salía unos 40 s
 *   antes que en la sala).
 * - Un margen después de que terminó el show del celular: 3 s, o un 10 % de lo que duró si es más. Una sala que dibuja
 *   más lento que el celular estira su juego (medido el 16 de noviembre de 2026 sin placa de video: 60,8 s en la sala
 *   y 56,3 s en el celular, con el celular 2,1 s detrás al arrancar). Cubre una sala hasta un 10 % más lenta.
 */
export function horaDelFinal(lanzadoMs: number, segundosDelShow: number, terminoMs: number = lanzadoMs): number {
  const prometido = lanzadoMs + segundosDelShow * 1000;
  const margen = Math.max(MARGEN_DEL_FINAL_MS, (terminoMs - lanzadoMs) * MARGEN_DEL_FINAL_PARTE);
  return Math.max(prometido, terminoMs + margen);
}
