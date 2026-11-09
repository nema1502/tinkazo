import { respuestasDePie, type PlanDeDePie } from "./de-pie-nino";
import type { Respuestas } from "./kit/respuestas";

/**
 * Las respuestas de la prueba del niño para el trompo (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale de las horas de los golpes que el juego ya planeó
 * (`trompo.ts`), no de lo que se ve.
 *
 * La forma es **de pie**: los trompos se sacan del ruedo uno a uno hasta que
 * queda el último bailando. Lo que un chico mira en un cuadro es quiénes siguen
 * girando; el trompo no apunta a nadie (no es una rueda). Lo común a los juegos
 * de esta forma, en `de-pie-nino.ts`.
 *
 * - **adelante**: los trompos que siguen bailando. Con el cartel, quien gana.
 * - **hacia**: «centro». Todo pasa dentro del ruedo y termina en el mano a mano
 *   del medio; la cámara no lo cruza. Adónde mirar en cada instante,
 *   `adelante.lugar`, lo mide el juego, que conoce la cámara.
 * - **paso**: que sacaron a alguien (`salio`, una tanda es un solo hecho), que a
 *   uno lo mandaron contra la tiza o cabeceó y se enderezó (`casi`), que empezó
 *   la pelea o el mano a mano (`empezo`) y el cartel (`gano`).
 */
export const SENTIDO_TROMPO = "centro" as const;
/** La forma: trompos que van saliendo y los que siguen. */
export const FORMA_TROMPO = "de-pie" as const;

export type PlanDelTrompo = PlanDeDePie;

export const respuestasTrompo = (p: PlanDelTrompo, t: number): Respuestas => respuestasDePie(p, t, SENTIDO_TROMPO);
