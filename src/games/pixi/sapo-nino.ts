import type { Respuestas, TipoPaso } from "./kit/respuestas";
import { SINK } from "./sapo-tiempos";

/**
 * Las respuestas de la prueba del niño para el sapo (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale del plan (la clasificatoria, los tiros y sus horas),
 * no de lo que se ve.
 *
 * La forma es **de pie**: lo que un chico ve en un cuadro es gente que va saliendo
 * y quienes siguen. Primero los nombres que se tachan en la clasificatoria, hasta
 * que quedan los de la mesa; después, con varios premios, cada agujero que gana se
 * cierra con su medalla y esa persona ya no sigue. La argolla no es una flecha que
 * apunte a un nombre (casi todo el tiempo está en la mano o en el aire), así que
 * no es una rueda.
 *
 * - **adelante**: quienes siguen. Con el cartel, quien gana.
 * - **hacia**: «centro». Los nombres vuelan a sus agujeros y las argollas van a la
 *   mesa, que está en el medio; la cámara no lo cruza. Adónde mirar en cada
 *   instante, `adelante.lugar`, lo mide el juego (`sapo.ts`), que conoce la cámara.
 * - **progreso**: la hora sobre la hora del cartel.
 * - **paso**: una oleada que tacha nombres (`salio`), que los nombres vuelan a la
 *   mesa (`empezo`), una argolla que baila en el borde de un agujero (`casi`, con
 *   el nombre de ese agujero), una medalla que no es la última (`adelante`), la
 *   argolla que entra en el agujero del último premio (`gano`) y una argolla a la
 *   madera o a la boca de la rana (`nada`). Pasados tres segundos, `nada`.
 */
export const SENTIDO_SAPO = "centro" as const;
/** La forma: gente que va saliendo y quienes siguen. */
export const FORMA_SAPO = "de-pie" as const;
/** «Qué acaba de pasar» es lo de hace tres segundos o menos; pasado eso, «nada nuevo». */
export const VENTANA = 3;

export interface TiroDelSapo {
  /** Cuándo cae la argolla. */
  land: number;
  kind: "miss" | "near" | "hit";
  /** El último tiro: el agujero de quien gana. */
  final: boolean;
  /** `hit`: quién tiene ese agujero (puesto en la lista). */
  persona?: number;
  /** `near`: de quién es el agujero en cuyo borde baila (puesto en la lista). */
  borde?: number;
}

export interface PlanDelSapo {
  /** Cuántas personas hay en la lista. */
  n: number;
  /** Las oleadas de la clasificatoria: cuándo se tacha cada nombre. */
  oleadas: readonly (readonly { persona: number; at: number }[])[];
  /** Cuándo los finalistas vuelan a sus agujeros. */
  tFly: number;
  tiros: readonly TiroDelSapo[];
  /** La hora del golpe: el 100 %. */
  duracion: number;
}

interface Hecho {
  desde: number;
  tipo: TipoPaso;
  quien?: number;
}

function hechosDe(p: PlanDelSapo): Hecho[] {
  const hs: Hecho[] = [{ desde: 0, tipo: "empezo" }];
  for (const o of p.oleadas) {
    const primera = o.reduce((a, b) => (b.at < a.at ? b : a));
    hs.push({ desde: primera.at, tipo: "salio", quien: primera.persona });
  }
  hs.push({ desde: p.tFly, tipo: "empezo" });
  for (const t of p.tiros) {
    if (t.kind === "near" && t.borde !== undefined) hs.push({ desde: t.land, tipo: "casi", quien: t.borde });
    else if (t.kind === "hit" && t.persona !== undefined) {
      hs.push({ desde: t.land, tipo: "adelante", quien: t.persona });
      // Gana con el cartel, no cuando la argolla entra: hasta ahí la mesa sigue entera, con sus medallas.
      if (t.final) hs.push({ desde: p.duracion, tipo: "gano", quien: t.persona });
    } else hs.push({ desde: t.land, tipo: "nada" });
  }
  return hs.sort((a, b) => a.desde - b.desde);
}

/** Quienes siguen en la hora `t`: los que no se tacharon ni tienen ya su medalla. Con el cartel, quien gana. */
function siguen(p: PlanDelSapo, t: number): number[] {
  const fuera = new Set<number>();
  for (const o of p.oleadas) for (const x of o) if (t >= x.at) fuera.add(x.persona);
  const ultimo = p.tiros.find((x) => x.final);
  if (ultimo && ultimo.persona !== undefined && t >= p.duracion) return [ultimo.persona];
  for (const x of p.tiros) if (x.kind === "hit" && !x.final && x.persona !== undefined && t >= x.land + SINK) fuera.add(x.persona);
  return Array.from({ length: p.n }, (_, i) => i).filter((i) => !fuera.has(i));
}

export function respuestasSapo(p: PlanDelSapo, t: number): Respuestas {
  const tt = Math.max(0, t);
  const hs = hechosDe(p);
  let h = hs[0] as Hecho;
  for (const x of hs) if (x.desde <= tt) h = x;
  const vieja = h.tipo !== "gano" && tt - h.desde > VENTANA;
  return {
    adelante: { quienes: siguen(p, tt), lugar: "centro" },
    hacia: SENTIDO_SAPO,
    progreso: Math.min(1, tt / p.duracion),
    paso: vieja ? { tipo: "nada", desde: h.desde } : h.quien !== undefined ? { tipo: h.tipo, quien: h.quien, desde: h.desde } : { tipo: h.tipo, desde: h.desde },
  };
}
