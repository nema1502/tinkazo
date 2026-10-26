import type { LineaGuion } from "./tipos";

/**
 * Las respuestas de la prueba del niño.
 *
 * La regla (26 de octubre de 2026): **cualquier cuadro del juego, sin leer, dice
 * quién va adelante, hacia dónde van, cuánto falta y qué acaba de pasar.** La
 * semilla sabe la respuesta: cada juego la declara desde su plan, en cada
 * segundo, y un auditor (`audit-nino`) saca tres capturas sin subtítulo (al 25 %,
 * al 60 % y al final) y las compara con esto.
 *
 * - **adelante**: quién va ganando; en una eliminación, los que siguen adentro
 *   (adelante es estar adentro: el líder no es el ganador).
 * - **hacia**: un solo sentido por juego, de principio a fin; la cámara no lo cruza.
 * - **progreso**: de 0 (empieza) a 1 (terminó), y solo sube.
 * - **paso**: lo último que pasó, y quién. Cada hecho se ve en el cuerpo a 0,3 s
 *   de su línea, y dos salidas van a 1 s o más: si no, ninguna se ve.
 *
 * Con `?auditar=nino` el juego deja `window.__nino.verdad()`. Puro, sin DOM.
 */
export type Lugar = "arriba" | "abajo" | "izquierda" | "derecha" | "centro";
export type Direccion = Lugar | "alrededor";
export type TipoPaso = "empezo" | "salio" | "adelante" | "freno" | "casi" | "gano" | "nada";

export const LUGARES: readonly Lugar[] = ["arriba", "abajo", "izquierda", "derecha", "centro"];
export const DIRECCIONES: readonly Direccion[] = [...LUGARES, "alrededor"];
export const TIPOS_PASO: readonly TipoPaso[] = ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"];

export interface Respuestas {
  /** Puestos de la lista de los que van adelante (los que siguen adentro, en una eliminación) y en qué parte de la pantalla. */
  adelante: { quienes: readonly number[]; lugar: Lugar };
  hacia: Direccion;
  progreso: number;
  /** Lo último que pasó: el tipo, quién, desde qué segundo de juego y dónde. */
  paso: { tipo: TipoPaso; quien?: number; desde: number; lugar?: Lugar };
}

/** Cuánto tarda en verse un hecho en el cuerpo, en segundos de juego. */
export const POSE_MAX = 0.3;
/** Lo menos que separa dos salidas, en segundos de juego. */
export const SALIDAS_APARTE = 1;

/** En qué parte de una pantalla de `w` por `h` cae un punto: el tercio del medio es el centro. */
export function lugarDe(x: number, y: number, w: number, h: number): Lugar {
  const dx = x / w - 0.5;
  const dy = y / h - 0.5;
  if (Math.abs(dx) < 1 / 6 && Math.abs(dy) < 1 / 6) return "centro";
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "izquierda" : "derecha";
  return dy < 0 ? "arriba" : "abajo";
}

export interface PlanDeRespuestas {
  duracion: number;
  sentido: Direccion;
  respuestas(t: number): Respuestas;
  guion?: readonly Pick<LineaGuion<unknown>, "t" | "hecho">[];
}

/**
 * Lo que está mal en las respuestas de un plan, para las pruebas de cada juego.
 * Las recorre cada `paso` segundos hasta tres después del golpe. Vacío si cumple.
 */
export function problemasDeRespuestas(plan: PlanDeRespuestas, o: { n: number; ganadores: readonly number[]; paso?: number }): string[] {
  const falla = new Set<string>();
  const paso = o.paso ?? 0.1;
  const valido = (i: unknown): boolean => Number.isInteger(i) && (i as number) >= 0 && (i as number) < o.n;
  let previo = 0;
  const salidas = new Set<number>();
  for (let t = 0; t <= plan.duracion + 3 + 1e-9; t += paso) {
    const r = plan.respuestas(t);
    if (!(r.progreso >= 0 && r.progreso <= 1)) falla.add("el progreso se sale de 0 a 1");
    if (r.progreso < previo - 1e-9) falla.add("el progreso baja: lo que falta solo se achica");
    previo = Math.max(previo, r.progreso);
    const q = r.adelante.quienes;
    if (q.length === 0) falla.add("en algún cuadro nadie va adelante");
    if (!q.every(valido) || new Set(q).size !== q.length) falla.add("«adelante» trae puestos que no existen o repetidos");
    if (!LUGARES.includes(r.adelante.lugar)) falla.add("«adelante» trae un lugar que no existe");
    if (!DIRECCIONES.includes(r.hacia)) falla.add("«hacia» trae una dirección que no existe");
    if (r.hacia !== plan.sentido) falla.add(`«hacia» cambia: el juego avanza hacia ${plan.sentido}, un solo sentido de principio a fin`);
    const s = r.paso;
    if (!TIPOS_PASO.includes(s.tipo)) falla.add("«paso» trae un tipo que no existe");
    if (!(s.desde >= 0 && s.desde <= t + 1e-9)) falla.add("«paso» viene de un momento que todavía no pasó");
    if (s.tipo !== "empezo" && s.tipo !== "nada" && !valido(s.quien)) falla.add(`«${s.tipo}» tiene que decir quién`);
    if (s.tipo === "salio") salidas.add(+s.desde.toFixed(3));
  }
  if (plan.respuestas(0).progreso > 0.1) falla.add("al empezar, el progreso ya pasó de 0,1");
  const fin = plan.respuestas(plan.duracion);
  if (fin.progreso < 0.99) falla.add("con el golpe el progreso no llega a 1");
  const primero = o.ganadores[0];
  if (primero !== undefined && !fin.adelante.quienes.includes(primero)) falla.add("con el golpe, quien gana no va adelante");
  const orden = [...salidas].sort((a, b) => a - b);
  for (let i = 1; i < orden.length; i++) {
    if ((orden[i] as number) - (orden[i - 1] as number) < SALIDAS_APARTE - 1e-9) {
      falla.add(`dos salidas a menos de ${SALIDAS_APARTE} s: ninguna se ve`);
      break;
    }
  }
  for (const l of plan.guion ?? []) {
    if (!l.hecho) continue;
    const r = plan.respuestas(l.t + POSE_MAX);
    if (r.paso.tipo !== l.hecho.tipo || (l.hecho.quien !== undefined && r.paso.quien !== l.hecho.quien)) {
      falla.add(`la línea de los ${l.t.toFixed(1)} s dice «${l.hecho.tipo}» y a los ${POSE_MAX} s el cuerpo no lo muestra`);
    }
  }
  return [...falla];
}
