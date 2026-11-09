import { SALIDAS_APARTE, type Direccion, type Respuestas, type TipoPaso } from "./kit/respuestas";

/**
 * Las respuestas de la prueba del niño para un juego de forma **de pie**: gente
 * que va saliendo, uno o varios a la vez, hasta que queda quien gana (el trompo
 * y la chovena). Puro, sin Pixi ni DOM: sale de las horas que el juego ya planeó.
 *
 * - **adelante**: quienes siguen (nadie que salió vuelve). Con el cartel, quien gana.
 * - **progreso**: la hora sobre la hora del cartel.
 * - **paso**: el último hecho de `hechos` o de las salidas. Las que caen a menos
 *   de un segundo de la primera de su tanda son una sola (`salio`, con el primero
 *   que salió): un chico ve «salieron», no cada una, y la prueba del plan no deja
 *   dos salidas más cerca que `SALIDAS_APARTE`. Pasados tres segundos, `nada`; el
 *   cartel (`gano`) llega con la hora del golpe, nunca antes.
 * - **adónde mirar** no está acá: lo mide el juego, que conoce la cámara.
 */
export const VENTANA = 3;

export interface PlanDeDePie {
  /** Cuántas personas hay en la lista. */
  n: number;
  /** Quiénes salen y cuándo (puesto en la lista, hora de juego). */
  salidas: readonly { persona: number; at: number }[];
  /** Lo demás que pasa: cuándo empieza cada tramo, quién casi sale, a quién lo mandan contra el borde. */
  hechos: readonly { desde: number; tipo: TipoPaso; quien?: number }[];
  /** Quien gana. */
  ganador: number;
  /** La hora del cartel: el 100 %. */
  duracion: number;
}

interface Hecho {
  desde: number;
  tipo: TipoPaso;
  quien?: number;
}

/** Las salidas que caen a menos de un segundo de la primera de su tanda son una sola. */
function tandas(salidas: PlanDeDePie["salidas"]): Hecho[] {
  const orden = [...salidas].sort((a, b) => a.at - b.at || a.persona - b.persona);
  const out: Hecho[] = [];
  let inicio = -Infinity;
  for (const s of orden) {
    if (s.at - inicio < SALIDAS_APARTE - 1e-9) continue;
    inicio = s.at;
    out.push({ desde: s.at, tipo: "salio", quien: s.persona });
  }
  return out;
}

export function respuestasDePie(p: PlanDeDePie, t: number, hacia: Direccion): Respuestas {
  const tt = Math.max(0, t);
  const gano: Hecho = { desde: p.duracion, tipo: "gano", quien: p.ganador };
  const hs: Hecho[] = [...p.hechos, ...tandas(p.salidas), gano].sort((a, b) => a.desde - b.desde);
  let h = hs[0] as Hecho;
  for (const x of hs) if (x.desde <= tt) h = x;
  const vieja = h.tipo !== "gano" && tt - h.desde > VENTANA;
  const quienes = tt >= p.duracion ? [p.ganador] : Array.from({ length: p.n }, (_, i) => i).filter((i) => !p.salidas.some((s) => s.persona === i && tt >= s.at));
  return {
    adelante: { quienes: quienes.length ? quienes : [p.ganador], lugar: "centro" },
    hacia,
    progreso: Math.min(1, tt / p.duracion),
    paso: vieja ? { tipo: "nada", desde: h.desde } : h.quien !== undefined ? { tipo: h.tipo, quien: h.quien, desde: h.desde } : { tipo: h.tipo, desde: h.desde },
  };
}
