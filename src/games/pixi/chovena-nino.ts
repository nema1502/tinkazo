import { respuestasDePie, type PlanDeDePie } from "./de-pie-nino";
import type { Respuestas } from "./kit/respuestas";
import { decisivo as momentoDecisivo, primeraQueDejaSoloPremiados } from "./decisivo";

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

/**
 * El momento decisivo de la chovena (`decisivo.ts`), en segundos de juego: el corte de la final (`final`) o, con varios
 * premios, el primer corte que deja solo a premiados (desde que se corta la música en él). En un orden de turnos todos
 * tienen premio y salen del último turno al segundo: cada salida ya dice un puesto, desde el primer corte.
 */
export function decisivoDeLaChovena(n: number, premiados: ReadonlySet<number>, cortes: readonly { kind: string; s0: number; victims: readonly number[] }[], final: number): number {
  const fuera = new Set<number>();
  const conSalidas = cortes.filter((e) => e.kind === "stop" && e.victims.length > 0);
  const tramos = conSalidas.map((e) => {
    for (const v of e.victims) fuera.add(v);
    return { desde: e.s0, siguen: Array.from({ length: n }, (_, i) => i).filter((i) => !fuera.has(i)) };
  });
  const orden = premiados.size >= n && conSalidas[0] ? conSalidas[0].s0 : Infinity;
  return momentoDecisivo(final, orden, primeraQueDejaSoloPremiados(tramos, premiados, n));
}
