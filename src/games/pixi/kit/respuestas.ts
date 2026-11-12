import type { LineaGuion } from "./tipos";

/**
 * Las respuestas de la prueba del niño.
 *
 * La regla (26 de octubre de 2026, con la forma desde el 2 de noviembre):
 * **cualquier cuadro del juego, sin leer el relator, muestra si ya ganó alguien,
 * cuánto falta, qué acaba de pasar, adónde mirar y lo propio de su forma** (quién
 * va adelante, quiénes siguen, qué está señalado o quién tiene más). La semilla
 * sabe la respuesta: cada juego la declara desde su plan, en cada segundo, y un
 * auditor (`audit-nino`) saca fotos sin subtítulo (al 25 %, al 60 % y al final) y
 * las compara con esto.
 *
 * Desde la segunda vuelta (2 de noviembre de 2026) la prueba solo exige lo que se
 * ve: `progresoVisible` dice si «cuánto falta» se ve en este cuadro, y `mirar` es
 * siempre una zona de la pantalla (ver `zonaDeMirar` en `scripts/lib/nino.mjs`).
 *
 * - **adelante**: lo propio de la forma. Quién va ganando (carrera); los que siguen
 *   adentro (de pie: adelante es estar adentro, el líder no es el ganador); el que
 *   está bajo la flecha o el foco (rueda); quién tiene más (acumulación). Y en
 *   `lugar`, la zona de la pantalla donde hay que mirar para seguir lo que pasa:
 *   es la respuesta de «¿adónde hay que mirar?» y la mide el propio juego.
 * - **hacia**: un solo sentido por juego, de principio a fin; la cámara no lo cruza.
 *   Es del plan y de las pruebas de la cámara: la prueba del niño ya no lo pregunta.
 * - **progreso**: de 0 (empieza) a 1 (terminó), y solo sube.
 * - **paso**: lo último que pasó, y quién. Cada hecho se ve en el cuerpo a 0,3 s
 *   de su línea, y dos salidas van a 1 s o más: si no, ninguna se ve.
 *
 * Con `?auditar=nino` el juego deja `window.__nino.verdad()`. Puro, sin DOM.
 */
export type Lugar = "arriba" | "abajo" | "izquierda" | "derecha" | "centro";
export type Direccion = Lugar | "alrededor";
export type TipoPaso = "empezo" | "salio" | "adelante" | "freno" | "casi" | "gano" | "nada";

/**
 * La forma del juego, que decide la pregunta propia de la prueba del niño:
 * `carrera` («¿quién va adelante?»), `de-pie` («¿quiénes siguen en juego?»),
 * `rueda` («¿qué nombre está señalado ahora?») y `acumulacion` («¿quién tiene más?»).
 */
export type Forma = "carrera" | "de-pie" | "rueda" | "acumulacion";
export const FORMAS: readonly Forma[] = ["carrera", "de-pie", "rueda", "acumulacion"];

export const LUGARES: readonly Lugar[] = ["arriba", "abajo", "izquierda", "derecha", "centro"];
export const DIRECCIONES: readonly Direccion[] = [...LUGARES, "alrededor"];
export const TIPOS_PASO: readonly TipoPaso[] = ["empezo", "salio", "adelante", "freno", "casi", "gano", "nada"];

export interface Respuestas {
  /** Puestos de la lista de los que van adelante (los que siguen adentro, en una eliminación) y en qué parte de la pantalla. */
  adelante: { quienes: readonly number[]; lugar: Lugar };
  hacia: Direccion;
  /** De 0 (empieza) a 1 (terminó), y solo sube. En de pie y acumulación, `verdadDelNino` lo cambia por la fracción que ya salió. */
  progreso: number;
  /**
   * ¿Se ve en la pantalla cuánto falta? La carrera siempre (la meta está a la vista); de pie y acumulación, desde que salió
   * alguien (lo visible es cuántos quedan, no el tiempo); la rueda, solo cuando ya frena de forma visible. Donde es `false`,
   * la prueba informa `falta` pero no decide con ella. Si el plan no lo dice, lo decide `verdadDelNino` por la forma.
   */
  progresoVisible?: boolean;
  /** Dónde pasa lo que pasa, para `mirar` cuando nadie va adelante (`adelante.quienes` vacío). Sin declarar, `centro`. */
  zonaAccion?: Lugar;
  /** Lo último que pasó: el tipo, quién, desde qué segundo de juego y dónde. */
  paso: { tipo: TipoPaso; quien?: number; desde: number; lugar?: Lugar };
}

/** Cuánto tarda en verse un hecho en el cuerpo, en segundos de juego. */
export const POSE_MAX = 0.3;

/**
 * Los grupos de un juego cuya pantalla los muestra en lugar de las personas: el nombre del grupo de cada
 * persona, por su puesto en la lista. Va en `window.__nino.grupos`, aparte de las respuestas porque no cambia
 * con el tiempo. Un chico mira «Vicuñas ×4» y contesta con el grupo; el juez lo acepta (`coincidePropia`) si
 * todavía sigue en juego alguien de ese grupo.
 */
export type Grupos = readonly string[];

/** Lo que está mal en los grupos de un juego, para sus pruebas: uno por persona y ninguno sin nombre. Vacío si cumple. */
export function problemasDeGrupos(grupos: Grupos, n: number): string[] {
  const p: string[] = [];
  if (grupos.length !== n) p.push(`hay ${grupos.length} grupos y ${n} personas: uno por persona`);
  if (grupos.some((g) => typeof g !== "string" || !g.trim())) p.push("una persona no tiene grupo con nombre");
  if (new Set(grupos).size < 2) p.push("con un solo grupo no hay grupos que mostrar");
  return p;
}
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
  if (primero !== undefined && !fin.adelante.quienes.includes(primero)) falla.add("con el golpe, la persona elegida no va adelante");
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

/**
 * La verdad que expone el juego a la prueba del niño (`window.__nino.verdad()`): las respuestas
 * del plan, completadas por la forma con lo que el plan no dice.
 *
 * - `progresoVisible`: el del plan si lo declara; si no, la carrera `true`; de pie y acumulación,
 *   `true` desde que salió alguien (hay menos nombres que personas); la rueda, `false` (cada juego
 *   de rueda lo afina: solo ve el frenado quien sabe cuándo empieza).
 * - `progreso`: en de pie y acumulación lo visible es cuántos quedan, no el tiempo: es la fracción
 *   de quienes tenían que salir que ya salieron (de 0 a 1), salvo que el plan declare el suyo.
 */
export function verdadDelNino(forma: Forma, r: Respuestas, o: { n: number; ganadores: number }): Respuestas {
  if (r.progresoVisible !== undefined) return r;
  if (forma === "carrera") return { ...r, progresoVisible: true };
  if (forma === "rueda") return { ...r, progresoVisible: false };
  const salieron = Math.max(0, o.n - r.adelante.quienes.length);
  const hayQueSalgan = Math.max(1, o.n - o.ganadores);
  return { ...r, progresoVisible: salieron > 0, progreso: Math.max(0, Math.min(1, salieron / hayQueSalgan)) };
}
