import { respuestasDePie, type PlanDeDePie } from "./de-pie-nino";
import type { Respuestas } from "./kit/respuestas";

/**
 * Las respuestas de la prueba del niño para la chovena (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale de la línea de tiempo que el juego ya planeó (los
 * cortes de la música y quiénes se sueltan en cada uno), no de lo que se ve.
 *
 * La forma es **de pie**: en cada corte de la música se suelta y se va a sentar
 * al borde quien no alcanzó a frenar, y baila hasta el final el último que
 * queda. Nadie suma nada: lo que un chico mira en un cuadro es quiénes siguen en
 * la rueda (el contador de arriba lo dice con una cifra). Lo común a los juegos
 * de esta forma, en `de-pie-nino.ts`.
 *
 * - **adelante**: quienes siguen en la rueda. Con el cartel, quien gana.
 * - **hacia**: «alrededor». La rueda gira (y después de cada corte, para el otro
 *   lado); adónde mirar en cada instante, `adelante.lugar`, lo mide el juego.
 * - **paso**: que se cortó la música y se soltaron (`salio`, con el primero de
 *   cada corte), que alguien trastabilló o se soltó antes de tiempo y volvió
 *   (`casi`), que empezó el baile (`empezo`) y el cartel (`gano`).
 */
export const SENTIDO_CHOVENA = "alrededor" as const;
/** La forma: gente que sale de la rueda en cada corte y los que siguen. */
export const FORMA_CHOVENA = "de-pie" as const;

export type PlanDeLaChovena = PlanDeDePie;

export const respuestasChovena = (p: PlanDeLaChovena, t: number): Respuestas => respuestasDePie(p, t, SENTIDO_CHOVENA);
