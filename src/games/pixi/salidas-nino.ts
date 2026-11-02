import { SALIDAS_APARTE, type Direccion, type Lugar, type Respuestas, type TipoPaso } from "./kit/respuestas";

/**
 * Las respuestas de la prueba del niño para un juego de forma **de pie** cuyo
 * plan ya sabe quién sale y cuándo: la piñata, el teleférico y Oruro. Puro, sin
 * Pixi ni DOM: sale de las horas que el juego ya planeó, no de lo que se ve.
 *
 * - **adelante**: quienes siguen (nadie que salió vuelve). Desde la hora del
 *   golpe, quien gana.
 * - **progreso**: la hora sobre la hora del golpe, el 100 %.
 * - **paso**: el último hecho. Las salidas que caen a menos de un segundo de la
 *   primera de su tanda son una sola (`salio`, con el primero que salió): un chico
 *   ve «salieron», no cada una, y la prueba del plan no deja dos salidas más
 *   cerca que `SALIDAS_APARTE`. Pasados tres segundos, `nada`; el cartel (`gano`)
 *   llega con la hora del golpe, nunca antes.
 * - **adónde mirar** no está acá: lo mide el juego, que conoce la cámara.
 */
export const VENTANA = 3;

export interface Salida {
  /** Puesto en la lista. */
  persona: number;
  /** Hora de juego en que sale. */
  at: number;
}

export interface HechoDelPlan {
  desde: number;
  tipo: TipoPaso;
  quien?: number;
}

export interface PlanDeSalidas {
  /** Cuántas personas hay en la lista. */
  n: number;
  salidas: readonly Salida[];
  /** Lo demás que pasa: cuándo empieza cada tramo, quién casi sale, quién tropieza. */
  hechos: readonly HechoDelPlan[];
  /** Quien gana. */
  ganador: number;
  /** La hora del golpe: el 100 %. */
  duracion: number;
}

/** Las salidas que caen a menos de un segundo de la primera de su tanda son una sola. A igual hora, el orden en que el plan las declara. */
export function tandas(salidas: readonly Salida[]): HechoDelPlan[] {
  const orden = [...salidas].sort((a, b) => a.at - b.at);
  const out: HechoDelPlan[] = [];
  let inicio = -Infinity;
  for (const s of orden) {
    if (s.at - inicio < SALIDAS_APARTE - 1e-9) continue;
    inicio = s.at;
    out.push({ desde: s.at, tipo: "salio", quien: s.persona });
  }
  return out;
}

/** Quienes siguen a la hora `t`: todos menos los que ya salieron, y con el golpe, quien gana. */
export function quienesSiguen(p: PlanDeSalidas, t: number): number[] {
  if (t >= p.duracion) return [p.ganador];
  const siguen = Array.from({ length: p.n }, (_, i) => i).filter((i) => !p.salidas.some((s) => s.persona === i && t >= s.at));
  return siguen.length ? siguen : [p.ganador];
}

export function respuestasDeSalidas(p: PlanDeSalidas, t: number, hacia: Direccion, lugar: Lugar = "centro"): Respuestas {
  const tt = Math.max(0, t);
  const gano: HechoDelPlan = { desde: p.duracion, tipo: "gano", quien: p.ganador };
  // Orden estable por hora: a igual hora manda el que se declaró después (el hecho propio gana a una salida simultánea).
  const hs: HechoDelPlan[] = [...tandas(p.salidas), ...p.hechos, gano].sort((a, b) => a.desde - b.desde);
  let h = hs[0] as HechoDelPlan;
  for (const x of hs) if (x.desde <= tt) h = x;
  const vieja = h.tipo !== "gano" && tt - h.desde > VENTANA;
  const paso: Respuestas["paso"] = vieja ? { tipo: "nada", desde: h.desde } : h.quien !== undefined ? { tipo: h.tipo, quien: h.quien, desde: h.desde } : { tipo: h.tipo, desde: h.desde };
  return { adelante: { quienes: quienesSiguen(p, tt), lugar }, hacia, progreso: Math.min(1, tt / p.duracion), paso };
}
