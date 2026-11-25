/**
 * El aviso por las cuentas nuevas por hora (issue 177). El número no lo cuenta el vigilante: el portero se lo pide al
 * proveedor de cuentas con la consulta de uso por ventana de tiempo (los últimos 60 minutos corridos, una sola consulta,
 * exacta aunque haya miles de cobros de firma) y lo manda en el bloque `cuentas` de `/estado`, como manda todas sus
 * cifras. Acá vive lo que le toca al vigilante: el umbral configurable (fuera de un evento, `CUENTAS_UMBRAL`, 200 por
 * hora si no está, para que un evento de 150 personas no dé falsa alarma; el día de un evento, el cupo del evento en
 * `CUENTAS_EVENTO_CUPO` toma su lugar mientras esté puesto) y la cadencia del aviso: un solo correo por oleada, sin
 * repetirlo durante los 60 minutos siguientes, cambie o no la hora de reloj.
 */
import type { Entorno } from "./vuelta";

/** El umbral de cuentas por hora de siempre: por encima de lo que abre un evento de 150 personas en una hora. */
export const CUENTAS_UMBRAL_POR_DEFECTO = 200;

/** Los minutos que cubre el conteo del portero, corridos hacia atrás desde ahora. Es también lo que dura un aviso sin repetirse. */
export const VENTANA_CUENTAS_MINUTOS = 60;
const VENTANA_MS = VENTANA_CUENTAS_MINUTOS * 60_000;

/** Los dos motivos del aviso: abrir cuentas y activarlas. */
export const MOTIVOS_CUENTAS = ["cuentas-nuevas", "activaciones"] as const;
export type MotivoCuentas = (typeof MOTIVOS_CUENTAS)[number];

/** Un entero de un campo del bloque, o null: lo que no es un entero seguro mayor o igual a cero no es una cifra. */
const entero = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null);

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

/** Las cuentas de los últimos 60 minutos corridos, tal como las manda el portero en `/estado`. */
export interface ConteoDelPortero {
  nuevas: number;
  activaciones: number;
}

/**
 * Lo que el portero manda del conteo en `/estado`, o null si no viene o si no se entiende. El bloque es
 * `{ minutos: 60, nuevas, activaciones }`: con otra ventana, o con cualquier campo que no sea un entero seguro mayor o
 * igual a cero, el bloque entero vale nada. Mejor sin datos que con un dato inventado: un cero que no es cero apagaría el aviso.
 */
export function cuentasDelEstado(estado: unknown): ConteoDelPortero | null {
  if (!estado || typeof estado !== "object" || Array.isArray(estado)) return null;
  const bloque = (estado as Record<string, unknown>).cuentas;
  if (!bloque || typeof bloque !== "object" || Array.isArray(bloque)) return null;
  const b = bloque as Record<string, unknown>;
  if (b.minutos !== VENTANA_CUENTAS_MINUTOS) return null;
  const nuevas = entero(b.nuevas);
  const activaciones = entero(b.activaciones);
  if (nuevas === null || activaciones === null) return null;
  return { nuevas, activaciones };
}

export interface DesbordeDeCuentas {
  motivo: MotivoCuentas;
  /** Cuántas cuentan en los últimos 60 minutos. */
  hubo: number;
  /** El umbral que cruzó: el cupo del evento si está, o el de siempre. */
  umbral: number;
}

/** Cuándo se avisó cada motivo por última vez, en ISO. Un motivo que falta es que no se avisó. */
export type RecordadoDeCuentas = Partial<Record<MotivoCuentas, string>>;

export interface OrdenDeCuentas {
  /** El bloque `cuentas` del estado, o lo que haya en ese lugar. */
  cuentas: unknown;
  base: number;
  cupoEvento: number | null;
  /**
   * Si también avisa por las activaciones. Apagado por defecto: el nombre del cobro de la activación no está confirmado
   * contra una lectura real, y si fuera un cobro mensual de todas las cuentas activas caería junto y daría falsa alarma
   * en pleno evento.
   */
  conActivaciones?: boolean;
  recordado: RecordadoDeCuentas;
  /** La hora de la vuelta en ms. */
  ahoraMs: number;
}

/** Si un motivo se avisó hace menos de 60 minutos. Un aviso con fecha en el futuro (un reloj que volvió atrás) no calla. */
function avisadoHace60(recordado: RecordadoDeCuentas, motivo: MotivoCuentas, ahoraMs: number): boolean {
  const cuando = Date.parse(recordado[motivo] ?? "");
  if (!Number.isFinite(cuando)) return false;
  const pasado = ahoraMs - cuando;
  return pasado >= 0 && pasado < VENTANA_MS;
}

/**
 * Qué desbordes hay que avisar ahora: los motivos que pasan el umbral en los últimos 60 minutos y que no se avisaron en
 * los 60 minutos anteriores. Una oleada avisa una sola vez: si sigue arriba, el aviso vuelve a salir recién pasada esa
 * hora, como recordatorio. Sin bloque, o con uno que no se entiende, no avisa nada. Las activaciones solo avisan con
 * `conActivaciones`.
 */
export function vigilarCuentas(o: OrdenDeCuentas): { avisar: DesbordeDeCuentas[]; conDatos: boolean } {
  const cuentas = cuentasDelEstado({ cuentas: o.cuentas });
  if (cuentas === null) return { avisar: [], conDatos: false };
  const umbral = o.cupoEvento ?? o.base;
  const avisar: DesbordeDeCuentas[] = [];
  if (cuentas.nuevas > umbral && !avisadoHace60(o.recordado, "cuentas-nuevas", o.ahoraMs)) {
    avisar.push({ motivo: "cuentas-nuevas", hubo: cuentas.nuevas, umbral });
  }
  if (o.conActivaciones === true && cuentas.activaciones > umbral && !avisadoHace60(o.recordado, "activaciones", o.ahoraMs)) {
    avisar.push({ motivo: "activaciones", hubo: cuentas.activaciones, umbral });
  }
  return { avisar, conDatos: true };
}
