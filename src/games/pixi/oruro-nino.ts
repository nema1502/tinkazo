import type { EntradaPlan } from "./entrada-plan";
import type { Direccion, Grupos, Lugar, Respuestas } from "./kit/respuestas";
import { respuestasDeSalidas, type HechoDelPlan, type PlanDeSalidas } from "./salidas-nino";

/**
 * Las respuestas de la prueba del niño para Oruro, La Entrada (`kit/respuestas.ts`).
 * Puro, sin Pixi ni DOM: sale del plan (`entrada-plan.ts`), no de lo que se ve.
 *
 * La forma es **de pie**, no una rueda: nada ni nadie señala un nombre. La
 * comparsa va avanzando por la calle, en cada arco se queda en la vereda una
 * fraternidad entera (y en la última, de a varios) y sigue bailando quien no se
 * quedó, hasta que quedan dos frente al Socavón y uno cae. Un chico mira quiénes
 * siguen en la comparsa. Lo común, en `salidas-nino.ts`.
 *
 * - **adelante**: quienes siguen bailando. Con el golpe, quien gana.
 * - **hacia**: «derecha». La comparsa avanza por la calle hacia el Socavón, un
 *   solo sentido de principio a fin. Adónde mirar en cada instante,
 *   `adelante.lugar`, lo mide el juego, que conoce la cámara.
 * - **paso**: que se quedó una fraternidad o unos cuantos en la vereda (`salio`,
 *   con el primero de la formación), que arrancó la marcha o el contrapunto
 *   (`empezo`), que una fraternidad hace como que se queda y vuelve o que a
 *   alguien casi se le cae la máscara (`casi`), un trastabillón del contrapunto
 *   (`freno`), la caída del que pierde (`salio`), que quien queda llega a la
 *   puerta (`adelante`) y el cartel (`gano`).
 */
export const SENTIDO_ORURO = "derecha" as const;

/** Cuánto dura el salto `i` del contrapunto: hasta el siguiente. */
export const largoDelSalto = (jumps: EntradaPlan["jumps"], i: number): number => {
  const a = jumps[i], b = jumps[i + 1];
  return a && b ? b.t - a.t : 0.8;
};

/** Cuándo cae sentado el que pierde el contrapunto (-1 sin contrapunto). */
export function horaDeCaer(jumps: EntradaPlan["jumps"]): number {
  const i = jumps.findIndex((j) => j.stumble === "fall");
  if (i < 0) return -1;
  const a = jumps[i] as { t: number };
  return a.t + largoDelSalto(jumps, i) * 0.55;
}

export interface PlanDeOruro {
  /** El plan de la entrada (`planEntrada`). */
  plan: Pick<EntradaPlan, "n" | "winner" | "rival" | "arches" | "jumps" | "twists" | "T_GO" | "T_SOCAVON" | "T_ARRIVE" | "frats">;
  /** La hora del golpe: el 100 %. */
  tCartel: number;
}

export function planDeSalidasDeOruro({ plan: P, tCartel }: PlanDeOruro): PlanDeSalidas {
  const salidas = P.arches.flatMap((a) => a.exit.ids.map((persona) => ({ persona, at: a.tExit })));
  const cae = horaDeCaer(P.jumps);
  if (P.rival >= 0 && cae >= 0) salidas.push({ persona: P.rival, at: cae });
  const hechos: HechoDelPlan[] = [
    { desde: 0, tipo: "empezo" },
    { desde: P.T_GO, tipo: "empezo" },
    { desde: P.T_SOCAVON, tipo: "empezo" },
  ];
  const fake = P.twists.fake;
  const quienFake = fake ? fake.ids[0] : undefined;
  if (fake && quienFake !== undefined) hechos.push({ desde: fake.t0, tipo: "casi", quien: quienFake });
  if (P.twists.scare) hechos.push({ desde: P.twists.scare.t, tipo: "casi", quien: P.twists.scare.who });
  P.jumps.forEach((j, i) => {
    if (j.stumble === "small" || j.stumble === "big") hechos.push({ desde: j.t + largoDelSalto(P.jumps, i) * 0.55, tipo: "freno", quien: j.who });
  });
  if (P.rival >= 0) hechos.push({ desde: P.T_ARRIVE, tipo: "adelante", quien: P.winner });
  return { n: P.n, salidas, hechos, ganador: P.winner, duracion: tCartel };
}

/**
 * Los grupos que muestra la pantalla: las pastillas de arriba son las fraternidades («Vicuñas 4»), no las personas.
 * El nombre de la fraternidad de cada persona, por su puesto en la lista.
 */
export function gruposDeOruro(P: Pick<EntradaPlan, "n" | "frats">): Grupos {
  const out: string[] = Array.from({ length: P.n }, () => "");
  for (const f of P.frats) for (const i of f.members) if (i >= 0 && i < P.n) out[i] = f.name;
  return out;
}

export function respuestasOruro(p: PlanDeOruro, t: number, lugar: Lugar = "centro", hacia: Direccion = SENTIDO_ORURO): Respuestas {
  return respuestasDeSalidas(planDeSalidasDeOruro(p), t, hacia, lugar);
}
