import type { Lugar, Respuestas } from "./kit/respuestas";
import { respuestasDeSalidas, type HechoDelPlan, type PlanDeSalidas } from "./salidas-nino";
import type { PaloConHora } from "./pinata-plan";

/**
 * Las respuestas de la prueba del niño para la piñata (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale del calendario de palos que el juego ya planeó
 * (`pinata-plan.ts`), no de lo que se ve.
 *
 * La forma es **de pie**: cada nombre es un caramelo adentro de la piñata, con
 * cada palo caen unos y quedan afuera, y gana el último que sigue adentro. Un
 * chico mira quiénes siguen adentro; la piñata no apunta a nadie (no es una
 * rueda) y nadie va primero (no es una carrera). Lo común, en `salidas-nino.ts`.
 *
 * - **adelante**: los caramelos que siguen adentro. Con la rotura cae la rival y
 *   queda quien gana; con el cartel, quien gana.
 * - **hacia**: «abajo», adonde caen los caramelos; la cámara no lo cruza. Adónde
 *   mirar en cada instante, `adelante.lugar`, lo mide el juego, que conoce la cámara.
 * - **paso**: que cayeron unos con un palo (`salio`; los palos al aire no cuentan,
 *   no sale nadie), que un caramelo se asomó por la rajadura y volvió (`casi`, el
 *   arco del susto), la rotura, que deja caer a la rival (`salio`), y el cartel (`gano`).
 */
export const SENTIDO_PINATA = "abajo" as const;

export interface PlanDeLaPinata {
  n: number;
  ganador: number;
  /** La rival, que sigue adentro hasta la rotura (igual al ganador con una sola persona). */
  rival: number;
  palos: readonly Pick<PaloConHora, "at" | "miss" | "drop">[];
  /** La hora de la rotura. */
  tRotura: number;
  /** La hora del cartel: el 100 %. */
  tCartel: number;
  /** El caramelo que se asoma en el susto y desde cuándo; `null` en los demás arcos. */
  asoma: { idx: number; desde: number } | null;
}

/** Cuánto después de que el palo suelta a los demás se ve el caramelo asomado (la línea del relator sale ahí). */
export const ASOMA_DESPUES = 0.35;

export function planDeSalidasDeLaPinata(p: PlanDeLaPinata): PlanDeSalidas {
  const salidas = p.palos.filter((s) => !s.miss).flatMap((s) => s.drop.map((persona) => ({ persona, at: s.at })));
  if (p.rival !== p.ganador) salidas.push({ persona: p.rival, at: p.tRotura });
  const hechos: HechoDelPlan[] = [{ desde: 0, tipo: "empezo" }];
  if (p.asoma) hechos.push({ desde: p.asoma.desde, tipo: "casi", quien: p.asoma.idx });
  return { n: p.n, salidas, hechos, ganador: p.ganador, duracion: p.tCartel };
}

export function respuestasPinata(p: PlanDeLaPinata, t: number, lugar: Lugar = "centro"): Respuestas {
  return respuestasDeSalidas(planDeSalidasDeLaPinata(p), t, SENTIDO_PINATA, lugar);
}
