import type { Direccion, Lugar, Respuestas } from "./kit/respuestas";
import { T_BOARD, T_RUN, type CableCarPlan } from "./cablecar-plan";
import { respuestasDeSalidas, type HechoDelPlan, type PlanDeSalidas } from "./salidas-nino";

/**
 * Las respuestas de la prueba del niño para el teleférico (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale del plan (`cablecar-plan.ts`), no de lo que se ve.
 *
 * La forma es **de pie**, no una carrera: el convoy sube parejo, todas las
 * cabinas a la vez, y nadie va adelante de nadie. Lo que cambia es quién sigue
 * arriba: en cada estación se baja un grupo entero, en la última se bajan de a
 * uno, y suben dos. Un chico mira quiénes siguen. La cabina de adelante no es la
 * ganadora (en la carrera «adelante» es ganar; acá no), así que preguntar «¿quién
 * va adelante?» daría una respuesta que no dice nada. Lo común, en `salidas-nino.ts`.
 *
 * - **adelante**: quienes siguen arriba. Con el golpe, quien gana.
 * - **hacia**: la cumbre. En horizontal el cable sube hacia la derecha; en el
 *   celular, hacia arriba. Un solo sentido de principio a fin. Adónde mirar en
 *   cada instante, `adelante.lugar`, lo mide el juego, que conoce la cámara.
 * - **paso**: que se bajó un grupo en una estación (`salio`, con el primero que
 *   baja), el susto de la puerta (`casi`), la mordaza que suelta la cabina y la
 *   vuelve a subir y el apagón que frena el convoy (`freno`), y el cartel (`gano`).
 */
export interface PlanDelTeleferico {
  n: number;
  ganador: number;
  /** Los puestos en el orden de bajada: los dos que llegan arriba, primero. */
  rank: readonly number[];
  /** Cuántos quedan después de cada parada (la primera cuenta es la lista entera). */
  left: readonly number[];
  /** Cada parada: su ronda y la hora en que se baja el grupo. */
  paradas: readonly { round: number; tOff: number }[];
  /** A quién nombra el relator en la puerta, la mordaza y el apagón: uno de los que van en la cabina final. */
  nombrado: number;
  puerta: boolean;
  puertaA: number;
  mordaza: boolean;
  mA: number;
  apagon: boolean;
  quieto: number;
  /** Cuando el convoy arranca. */
  tBoard: number;
  /** Cuando arranca el último tramo, el de la cabina sola con los dos. */
  tRun: number;
  /** La hora del golpe: el 100 %. */
  tCartel: number;
}

/** El plan de la prueba, sacado del plan del juego (`planCableCar`); `golpe` es la hora del golpe. */
export function planDelTelefericoDe(P: CableCarPlan, ganador: number, golpe: number): PlanDelTeleferico {
  return {
    n: P.n, ganador, rank: P.rank, left: P.left, paradas: P.stops.map((st) => ({ round: st.round, tOff: st.tOff })),
    nombrado: P.nombrado, puerta: P.puerta, puertaA: P.puertaA, mordaza: P.mordaza, mA: P.mA, apagon: P.apagon, quieto: P.quieto,
    tBoard: T_BOARD, tRun: T_RUN, tCartel: golpe,
  };
}

/** Hacia dónde sube el cable: a la derecha en horizontal, hacia arriba en el celular. */
export const sentidoDelTeleferico = (retrato: boolean): Direccion => (retrato ? "arriba" : "derecha");

export function planDeSalidasDelTeleferico(p: PlanDelTeleferico): PlanDeSalidas {
  const salidas = p.paradas.flatMap((s) => {
    const hasta = p.left[s.round] ?? p.n;
    const desde = p.left[s.round + 1] ?? hasta;
    return p.rank.slice(desde, hasta).map((persona) => ({ persona, at: s.tOff }));
  });
  const hechos: HechoDelPlan[] = [
    { desde: 0, tipo: "empezo" },
    { desde: p.tBoard, tipo: "empezo" },
    { desde: p.tRun, tipo: "empezo" },
  ];
  if (p.puerta) hechos.push({ desde: p.puertaA, tipo: "casi", quien: p.nombrado });
  if (p.mordaza) hechos.push({ desde: p.mA, tipo: "freno", quien: p.nombrado });
  if (p.apagon) hechos.push({ desde: p.quieto, tipo: "freno", quien: p.nombrado });
  return { n: p.n, salidas, hechos, ganador: p.ganador, duracion: p.tCartel };
}

export function respuestasTeleferico(p: PlanDelTeleferico, t: number, hacia: Direccion, lugar: Lugar = "centro"): Respuestas {
  return respuestasDeSalidas(planDeSalidasDelTeleferico(p), t, hacia, lugar);
}
