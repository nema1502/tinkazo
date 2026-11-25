/**
 * El aviso por las cuentas nuevas y las activaciones por hora (issue 177). El número no lo cuenta el vigilante:
 * el portero lo cuenta desde los movimientos de los créditos de Pollar (`billing/credits`, ver `lectura-cuentas.ts`) y lo
 * manda en el bloque `cuentas` de `/estado`, como manda todas sus cifras. Acá vive lo que le toca al vigilante: el
 * umbral configurable (fuera de un evento, `CUENTAS_UMBRAL`, 200 por hora si no está, para que un evento de 150 personas no dé falsa alarma; el día de un evento, el cupo del
 * evento en `CUENTAS_EVENTO_CUPO` toma su lugar mientras esté puesto) y la cadencia del aviso: un solo correo por
 * hora y por motivo, armado con el patrón de los avisos de `mensaje.ts`.
 */
import type { ConteoDeHora } from "../../../workers/patrocinio/src/lectura-cuentas";
import type { Entorno } from "./vuelta";

/** El umbral de cuentas por hora de siempre: por encima de lo que abre un evento de 150 personas en una hora. */
export const CUENTAS_UMBRAL_POR_DEFECTO = 200;

/** Los dos motivos del aviso: abrir cuentas y activarlas. */
export const MOTIVOS_CUENTAS = ["cuentas-nuevas", "activaciones"] as const;
export type MotivoCuentas = (typeof MOTIVOS_CUENTAS)[number];

/** Un entero de un campo del bloque, o cero: lo que no se entiende no es una cifra. */
const entero = (x: unknown): number => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : 0);

/** Un entero de una variable, o el de siempre si falta, está mal escrita o queda por debajo del mínimo. */
export function enteroDe(variable: string | undefined, porDefecto: number, minimo: number): number {
  const limpio = (variable ?? "").trim();
  if (!/^\d{1,5}$/.test(limpio)) return porDefecto;
  const n = Number(limpio);
  return n >= minimo ? n : porDefecto;
}

export interface UmbralesDeCuentas {
  /** El umbral por horas sin evento. */
  base: number;
  /** El cupo del evento, que toma el lugar del umbral mientras la variable esté puesta. null es que no hay evento. */
  cupoEvento: number | null;
}

/** El umbral del aviso, tal como lo escriben las variables. Un valor raro vuelve al de siempre. */
export function umbralDeCuentas(env: Pick<Entorno, "CUENTAS_UMBRAL" | "CUENTAS_EVENTO_CUPO">): UmbralesDeCuentas {
  const cupo = (env.CUENTAS_EVENTO_CUPO ?? "").trim();
  return {
    base: enteroDe(env.CUENTAS_UMBRAL, CUENTAS_UMBRAL_POR_DEFECTO, 1),
    cupoEvento: cupo === "" ? null : enteroDe(cupo, 0, 1) || null,
  };
}

/** El bloque `cuentas` del estado, tal como se espera que lo manda el portero. */
export interface ConteoDelPortero {
  porHora: ConteoDeHora[];
  completo: boolean;
}

/**
 * Lo que el portero manda del conteo en `/estado`, o null si no viene o si no se entiende. Con cualquier hora sin
 * entender o con un número raro, el bloque entero vale nada: mejor sin datos que con un dato inventado.
 */
export function cuentasDelEstado(estado: unknown): ConteoDelPortero | null {
  if (!estado || typeof estado !== "object" || Array.isArray(estado)) return null;
  const bloque = (estado as Record<string, unknown>).cuentas;
  if (!bloque || typeof bloque !== "object" || Array.isArray(bloque)) return null;
  const filas = (bloque as Record<string, unknown>).porHora;
  if (!Array.isArray(filas)) return null;
  const porHora: ConteoDeHora[] = [];
  for (const fila of filas) {
    if (!fila || typeof fila !== "object" || Array.isArray(fila)) return null;
    const f = fila as Record<string, unknown>;
    if (typeof f.hora !== "string" || f.hora.length > 40 || Number.isNaN(Date.parse(f.hora))) return null;
    porHora.push({ hora: f.hora, nuevas: entero(f.nuevas), activaciones: entero(f.activaciones) });
  }
  // Sin filas no se sabe nada: el conteo tiene que traer por lo menos la hora del reloj del portero.
  if (porHora.length === 0) return null;
  return { porHora, completo: (bloque as Record<string, unknown>).completo !== false };
}

export interface DesbordeDeCuentas {
  motivo: MotivoCuentas;
  /** Cuántas cuentan en la hora. */
  hubo: number;
  /** El umbral que cruzó: el cupo del evento si está, o el de siempre. */
  umbral: number;
  /** La hora del conteo, tal como la escribió el portero: es la que marca el paso de un aviso a otro. */
  hora: string;
}

/** Lo que ya se avisó de cuentas: la última hora avisada y qué motivos se avisaron en ella. */
export interface RecordadoDeCuentas {
  hora: string | null;
  motivos: string[];
}

const HORA_MS = 3_600_000;

/**
 * Cuántas cuentas hubo en la última hora corrida, a partir del conteo por horas de reloj. El conteo viene partido por
 * horas fijas, y una oleada repartida entre dos de ellas (190 a las 9:50 y 190 a las 10:05) no pasaría nunca del umbral
 * en ninguna. Con la hora de reloj de la vuelta, a las cuentas de la hora que corre se les suma la parte de la hora
 * anterior que todavía cae dentro de los últimos 60 minutos, repartida pareja. Sin la hora de la vuelta, o si la hora
 * anterior no viene pegada a la de ahora, vale la hora de ahora sola. Nunca suma más que lo que hubo en las dos.
 */
function enLaUltimaHora(porHora: ConteoDeHora[], campo: "nuevas" | "activaciones", ahoraMs: number | undefined): number {
  const actual = porHora[porHora.length - 1]!;
  const anterior = porHora[porHora.length - 2];
  if (ahoraMs === undefined || anterior === undefined) return actual[campo];
  const desdeActual = Date.parse(actual.hora);
  if (Date.parse(anterior.hora) !== desdeActual - HORA_MS) return actual[campo];
  const corrido = ahoraMs - desdeActual;
  if (!Number.isFinite(corrido)) return actual[campo];
  const queda = 1 - Math.min(1, Math.max(0, corrido / HORA_MS));
  return actual[campo] + Math.round(anterior[campo] * queda);
}

export interface OrdenDeCuentas {
  /** El bloque `cuentas` del estado, o lo que haya en ese lugar. */
  cuentas: unknown;
  base: number;
  cupoEvento: number | null;
  /**
   * Si también avisa por las activaciones. Apagado por defecto: el nombre del cobro de la activación no está confirmado
   * contra una lectura real, y si fuera un cobro mensual de todas las cuentas activas caería junto en una sola hora y
   * daría falsa alarma en pleno evento.
   */
  conActivaciones?: boolean;
  recordado: RecordadoDeCuentas;
  /** La hora de la vuelta en ms, para contar la última hora corrida y no solo la hora de reloj. Sin ella, la hora de reloj sola. */
  ahoraMs?: number;
}

/**
 * Qué desbordes hay que avisar ahora: los motivos que pasan el umbral en la hora más nueva del conteo y que todavía no
 * se avisaron en esa hora. Un motivo cruzado una vez avisa una sola vez por hora: si sigue arriba, vuelve a avisar en la
 * hora siguiente, con la hora nueva a la cabeza. Sin bloque, o con uno que no se entiende, no avisa nada. Las activaciones solo avisan con `conActivaciones`.
 */
export function vigilarCuentas(o: OrdenDeCuentas): { avisar: DesbordeDeCuentas[]; conDatos: boolean; completo: boolean; hora: string | null } {
  const cuentas = cuentasDelEstado({ cuentas: o.cuentas });
  if (cuentas === null) return { avisar: [], conDatos: false, completo: true, hora: null };
  const bin = cuentas.porHora[cuentas.porHora.length - 1]!;
  const umbral = o.cupoEvento ?? o.base;
  const avisar: DesbordeDeCuentas[] = [];
  const yaEnEstaHora = o.recordado.hora === bin.hora;
  // Una página llena (`completo: false`) es un piso: la lista de movimientos se corta en `MAX_MOVIMIENTOS`, y con un
  // umbral de ese mismo tamaño no se lo podría pasar nunca. Ahí llegar al umbral ya cuenta.
  const pasa = (n: number): boolean => (cuentas.completo ? n > umbral : n >= umbral);
  const nuevas = enLaUltimaHora(cuentas.porHora, "nuevas", o.ahoraMs);
  if (pasa(nuevas) && !(yaEnEstaHora && o.recordado.motivos.includes("cuentas-nuevas"))) {
    avisar.push({ motivo: "cuentas-nuevas", hubo: nuevas, umbral, hora: bin.hora });
  }
  const activaciones = enLaUltimaHora(cuentas.porHora, "activaciones", o.ahoraMs);
  if (o.conActivaciones === true && pasa(activaciones) && !(yaEnEstaHora && o.recordado.motivos.includes("activaciones"))) {
    avisar.push({ motivo: "activaciones", hubo: activaciones, umbral, hora: bin.hora });
  }
  return { avisar, conDatos: true, completo: cuentas.completo, hora: bin.hora };
}
