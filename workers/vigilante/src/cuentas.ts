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

export interface OrdenDeCuentas {
  /** El bloque `cuentas` del estado, o lo que haya en ese lugar. */
  cuentas: unknown;
  base: number;
  cupoEvento: number | null;
  recordado: RecordadoDeCuentas;
}

/**
 * Qué desbordes hay que avisar ahora: los motivos que pasan el umbral en la hora más nueva del conteo y que todavía no
 * se avisaron en esa hora. Un motivo cruzado una vez avisa una sola vez por hora: si sigue arriba, vuelve a avisar en la
 * hora siguiente, con la hora nueva a la cabeza. Sin bloque, o con uno que no se entiende, no avisa nada.
 */
export function vigilarCuentas(o: OrdenDeCuentas): { avisar: DesbordeDeCuentas[]; conDatos: boolean; completo: boolean; hora: string | null } {
  const cuentas = cuentasDelEstado({ cuentas: o.cuentas });
  if (cuentas === null) return { avisar: [], conDatos: false, completo: true, hora: null };
  const bin = cuentas.porHora[cuentas.porHora.length - 1]!;;
  const umbral = o.cupoEvento ?? o.base;
  const avisar: DesbordeDeCuentas[] = [];
  const yaEnEstaHora = o.recordado.hora === bin.hora;
  if (bin.nuevas > umbral && !(yaEnEstaHora && o.recordado.motivos.includes("cuentas-nuevas"))) {
    avisar.push({ motivo: "cuentas-nuevas", hubo: bin.nuevas, umbral, hora: bin.hora });
  }
  if (bin.activaciones > umbral && !(yaEnEstaHora && o.recordado.motivos.includes("activaciones"))) {
    avisar.push({ motivo: "activaciones", hubo: bin.activaciones, umbral, hora: bin.hora });
  }
  return { avisar, conDatos: true, completo: cuentas.completo, hora: bin.hora };
}
