/**
 * El momento decisivo de cada juego: desde ahí lo que se ve empieza a decir quién gana.
 *
 * El celular de quien mira juega a la par de la sala y retiene su juego en ese momento hasta saber que la sala ya lo
 * pasó (`games/en-hora.ts`). Por eso cada juego lo dice con los hechos de su propio plan, en su propio reloj
 * (`decisivoEn` del estadio), y no con un porcentaje: lo que pasa antes de ese momento no nombra a nadie que gane.
 *
 * Qué cuenta como nombrar a alguien que gana:
 *
 * - **El golpe del primer premio**: el último choque del trompo, la rotura de la piñata, la argolla que entra, el
 *   colibrí que se decide, el salto que cae. Antes, los dos que quedan son mitad y mitad.
 * - **Con varios premios, cualquier premio**: una persona que se va con su premio (el Toborochi, el sapo), una salida
 *   que deja solo a quienes ganan (la chovena, el Guajojó, la carrera con tantos premios como finalistas), una salida
 *   que es toda de premiados (La Entrada).
 *
 * Que alguien siga en juego no lo nombra mientras haya con él alguien que no gana: quedar entre dos es mitad y mitad.
 */

/** Lo que el momento decisivo se adelanta al hecho, en segundos del juego: lo que ese hecho anuncia antes de pasar. */
export const MARGEN_DECISIVO = 0.3;

/** Si quienes siguen son todos premiados (y queda alguien): desde ahí, lo que se ve ya los nombra. */
export function soloPremiados(quedan: Iterable<number>, premiados: ReadonlySet<number>): boolean {
  let alguno = false;
  for (const q of quedan) {
    if (!premiados.has(q)) return false;
    alguno = true;
  }
  return alguno;
}

/**
 * La hora del primer tramo que deja solo a premiados, o `Infinity`. `tramos` son las salidas en orden, cada una con la
 * hora en que empieza a verse quién sale y quiénes siguen después. Con tantos premios como personas (un orden de
 * turnos) seguir en juego no dice nada: el orden lo dice el juego, y esto no cuenta.
 */
export function primeraQueDejaSoloPremiados(tramos: readonly { desde: number; siguen: readonly number[] }[], premiados: ReadonlySet<number>, personas: number): number {
  if (premiados.size >= personas) return Infinity;
  for (const t of tramos) if (soloPremiados(t.siguen, premiados)) return t.desde;
  return Infinity;
}

/** El momento decisivo: el primero de los dados, con su margen, nunca antes de empezar. */
export function decisivo(...horas: readonly number[]): number {
  const h = Math.min(...horas.filter((x) => Number.isFinite(x)));
  return Number.isFinite(h) ? Math.max(0, h - MARGEN_DECISIVO) : 0;
}
