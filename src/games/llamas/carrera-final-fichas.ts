/**
 * Qué pasa con las fichas de nombre del 3D al final de la carrera, como función de la hora del show.
 *
 * La ganadora ya está decidida en el plan, pero nada de lo que se dibuja puede decirlo antes de que cruce
 * la meta: hasta el cruce su ficha es una más. Cuando el cartel de quien ganó está en pantalla, las fichas
 * de las demás dejan de tener destino visible y se apagan con el fundido de siempre
 * (`carrera-fichas-mov.ts`); solo queda la de quien ganó. Esta cuenta no guarda nada entre cuadros: la
 * misma hora da la misma decisión llegando cuadro por cuadro, saltando o yendo hacia atrás.
 *
 * Abajo está además cuántas fichas quedan a la vista en la largada con pantalla angosta: antes de la salida
 * se turnan por la formación, y desde la salida quedan las que van adelante hasta que se abre la recta.
 */

export interface FinalChipDecision {
  /** Si la ficha tiene destino visible en esta hora (el fundido hacia ahí lo hace el movimiento de la ficha). */
  shows: boolean;
  /** Si lleva el dorado de la casa. */
  gold: boolean;
  /** Si se ubica y se dibuja por encima de las demás. */
  onTop: boolean;
}

/**
 * La decisión para la ficha de `persona` en la hora `t`. `winner` es quien gana según el plan, `crossing`
 * la hora en que cruza la meta y `boardOn` si el cartel de quien ganó ya está en pantalla.
 */
export function finalChipDecision(persona: number, winner: number, t: number, crossing: number, boardOn: boolean): FinalChipDecision {
  const shows = !(boardOn && t >= crossing) || persona === winner;
  const gold = t >= crossing && persona === winner;
  return { shows, gold, onTop: gold };
}

/** Cuántas fichas se muestran a la vez en la largada en una pantalla angosta, hasta que el grupo se abre en carriles. */
export const MAX_NARROW_START_CHIPS = 6;

/** Cuánto queda a la vista cada turno de fichas antes de la salida en una pantalla angosta: alcanza para leer los nombres. */
export const START_CHIP_TURN_SECONDS = 1.75;

/**
 * Si la ficha de `persona` se muestra en la largada. `frontFirst` trae, antes de la salida, a las llamas en
 * su lugar de la formación de salida (la de adelante primero) y, desde la salida, en el orden de prioridad
 * de esa hora (la que va adelante en la pista primero).
 *
 * En una pantalla angosta, desde el primer cuadro y hasta que se abre la recta, el grupo va junto y en
 * diagonal y todas las fichas se pisan. Antes de la salida las fichas se turnan recorriendo la formación
 * de adelante hacia atrás: hay tantos turnos como hace falta para que no pasen de
 * `MAX_NARROW_START_CHIPS` por turno, cada turno dura `START_CHIP_TURN_SECONDS` y a cada turno le tocan
 * una de cada tantos lugares de la formación (con 18 personas, una de cada tres: los lugares 0, 3, 6...,
 * después 1, 4, 7...), así las fichas de un mismo turno no son de llamas vecinas y no se pisan. El turno
 * sale solo de la hora del show y del lugar en la formación: la misma hora da el mismo turno en cualquier
 * corrida, sin mirar quién va a ganar ni ningún dato del resultado. Desde la salida quedan solo las
 * primeras de `frontFirst`, como hasta ahora, y las demás entran cuando el grupo se estira en carriles,
 * que es cuando el mismo juego ya las separa bien. Fuera de ese rato, o en una pantalla ancha, se muestran
 * todas. Quien no está en la lista no se muestra en la largada angosta. Esta cuenta no sabe quién va a ganar.
 */
export function startChipShows(persona: number, frontFirst: readonly number[], narrow: boolean, t: number, start: number, lanesOpen: number): boolean {
  if (!narrow || t >= lanesOpen) return true;
  const index = frontFirst.indexOf(persona);
  if (index < 0) return false;
  if (t < start) {
    const turns = Math.max(1, Math.ceil(frontFirst.length / MAX_NARROW_START_CHIPS));
    const turn = Math.floor(Math.max(0, t) / START_CHIP_TURN_SECONDS) % turns;
    return index % turns === turn;
  }
  return index < MAX_NARROW_START_CHIPS;
}
