import type { Lugar, Respuestas } from "../pixi/kit/respuestas";

/**
 * Las respuestas de la prueba del niño para la carrera de llamas **de hoy**
 * (`kit/respuestas.ts`), la que no se entendía: es el caso de control de
 * `audit-nino --control`. Puro, sin Pixi ni DOM; sale del plan (`plan.ts`,
 * `peloton-plan.ts`) y de los relojes del show, no de lo que se ve.
 *
 * El show tiene cuatro fases: el pelotón y la entrada de los carriles (`pre`),
 * la cuenta (`count`), la carrera (`race`) y el cartel (`done`). La hora única
 * de la prueba las encadena: `horaDeLaCarrera`.
 *
 * - **adelante**: en el pelotón, los que siguen corriendo (adelante es estar
 *   adentro); en la pista, la que va primera y las que están a un cuerpo; con
 *   el cartel, la ganadora.
 * - **hacia**: la derecha, hacia la meta. En el pelotón corren en el lugar y el
 *   suelo se corre hacia atrás: es lo que declara el código; si la foto dice
 *   otra cosa, ese es justamente el hallazgo.
 * - **progreso**: la hora sobre la duración total (pelotón, cuenta y carrera).
 * - **paso**: la última echada, el último momento de la historia o el último
 *   cambio de punta.
 */
export type FaseDeLaCarrera = "pre" | "count" | "race" | "done";

/** Los relojes del show: tal cual los lleva `pixi-race.ts`. */
export interface RelojDeLaCarrera {
  fase: FaseDeLaCarrera;
  tPre: number;
  tPhase: number;
  tRace: number;
  tFreeze: number;
}

export interface PelotonDeLaCarrera {
  /** Cuándo termina el pelotón y se abren los carriles. */
  fin: number;
  /** Cuándo se echa cada uno: `Infinity` para los finalistas. */
  cae: readonly number[];
  vivosEn(t: number): number[];
}

export interface PlanDeLaCarrera {
  /** Puesto de la lista que corre en cada carril. */
  lanes: readonly number[];
  /** El carril de la ganadora. */
  ganador: number;
  /** Dónde va el carril `k` a la altura `q` de la pista (0 a 1). */
  pos(k: number, q: number): number;
  beats: readonly { kind: string; actor: number; target?: number | undefined; at: number }[];
  /** Todo lo de antes de la cuenta, en segundos de juego. */
  pre: number;
  /** Los segundos de la cuenta propia: 3, o 0 si la sala ya contó. */
  cuenta: number;
  /** Lo que dura la carrera, en segundos de juego. */
  dur: number;
  peloton: PelotonDeLaCarrera | null;
}

/** Cuánto es «a un cuerpo» de la que va primera, en fracción de pista. */
export const CUERPO = 0.03;
/** «Qué acaba de pasar» es lo de hace tres segundos o menos; pasado eso, «nada nuevo». */
export const VENTANA = 3;

/** La hora del golpe: el 100 % de la prueba. */
export const duracionDeLaCarrera = (p: PlanDeLaCarrera): number => p.pre + p.cuenta + p.dur;

/** La hora del show, en segundos de juego, desde que aparece el pelotón. */
export function horaDeLaCarrera(p: PlanDeLaCarrera, r: RelojDeLaCarrera): number {
  if (r.fase === "pre") return Math.min(r.tPre, p.pre);
  if (r.fase === "count") return p.pre + Math.max(0, Math.min(p.cuenta, r.tPhase - (3 - p.cuenta)));
  if (r.fase === "race") return p.pre + p.cuenta + Math.min(r.tRace, p.dur);
  return duracionDeLaCarrera(p) + r.tFreeze;
}

export function respuestasCarrera(p: PlanDeLaCarrera, r: RelojDeLaCarrera): Respuestas {
  const t = horaDeLaCarrera(p, r);
  const total = duracionDeLaCarrera(p);
  const progreso = Math.max(0, Math.min(1, t / total));
  const persona = (k: number): number => p.lanes[k] as number;
  const todas = p.lanes.map((_, k) => persona(k));
  const hacia = "derecha" as const;
  const respuesta = (quienes: number[], lugar: Lugar, paso: Respuestas["paso"]): Respuestas => ({ adelante: { quienes, lugar }, hacia, progreso, paso });
  const reciente = (paso: Respuestas["paso"]): Respuestas["paso"] => (t - paso.desde > VENTANA ? { tipo: "nada", desde: paso.desde } : paso);

  if (r.fase === "done") return respuesta([persona(p.ganador)], "derecha", { tipo: "gano", quien: persona(p.ganador), desde: duracionDeLaCarrera(p) });

  if (r.fase === "pre") {
    const pelo = p.peloton;
    if (pelo && r.tPre < pelo.fin) {
      // Quien se echó más tarde es lo último que pasó.
      let ultimo = -1;
      let desde = -Infinity;
      pelo.cae.forEach((c, i) => {
        if (Number.isFinite(c) && c <= r.tPre && c > desde) {
          desde = c;
          ultimo = i;
        }
      });
      const paso: Respuestas["paso"] = ultimo < 0 ? { tipo: "empezo", desde: 0 } : reciente({ tipo: "salio", quien: ultimo, desde });
      return respuesta(pelo.vivosEn(r.tPre), "centro", paso);
    }
    // Se abren los carriles: la final empieza y nadie va adelante todavía.
    return respuesta(todas, "centro", reciente({ tipo: "empezo", desde: pelo ? pelo.fin : 0 }));
  }

  if (r.fase === "count") return respuesta(todas, "centro", reciente({ tipo: "empezo", desde: p.pre }));

  // La carrera.
  const q = Math.max(0, Math.min(1, r.tRace / p.dur));
  const horaDe = (qq: number): number => p.pre + p.cuenta + qq * p.dur;
  const lider = (qq: number): number => {
    let mejor = 0;
    let x = -Infinity;
    p.lanes.forEach((_, k) => {
      const v = p.pos(k, qq);
      if (v > x) {
        x = v;
        mejor = k;
      }
    });
    return mejor;
  };
  const punta = lider(q);
  const xp = p.pos(punta, q);
  const quienes = p.lanes.map((_, k) => k).filter((k) => k === punta || xp - p.pos(k, q) <= CUERPO).map(persona);

  let paso: Respuestas["paso"] = { tipo: "empezo", desde: p.pre + p.cuenta };
  for (const bt of p.beats) {
    if (bt.at > q) continue;
    const desde = horaDe(bt.at);
    if (desde < paso.desde) continue;
    // Un tropiezo o una plantada frenan a quien los hace; una escupida, a quien la recibe; un pique pasa adelante.
    const quien = persona(bt.kind === "escupida" && bt.target !== undefined ? bt.target : bt.actor);
    paso = { tipo: bt.kind === "pique" ? "adelante" : "freno", quien, desde };
  }
  // Un cambio de punta: la última vez que fue otra la primera.
  for (let qq = q - 0.01; qq >= 0; qq -= 0.01) {
    if (lider(qq) === punta) continue;
    const desde = horaDe(qq + 0.01);
    if (desde > paso.desde) paso = { tipo: "adelante", quien: persona(punta), desde };
    break;
  }
  return respuesta(quienes, "derecha", reciente(paso));
}
