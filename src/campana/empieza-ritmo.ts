/**
 * Cuándo mira el celular y qué dice la cuenta regresiva, sin pantalla ni reloj propio: recibe la hora en cada llamada.
 *
 * Con la lista sellada la sala dice cuál es la ronda de la semilla, y la hora de esa ronda es la hora a la que puede empezar
 * el sorteo. El celular no usa su propio reloj para eso: usa cuánto adelanta o atrasa respecto de la sala (sale de la
 * cabecera `Date` de lo que contesta), así un celular con la hora corrida muestra lo mismo que uno bien puesto.
 *
 * Los tramos (T es la hora de la ronda en la hora de la sala, L cuándo el celular supo que la lista estaba sellada):
 *  - hasta max(T + 20 s, L): consulta propia cada 24 a 36 s, como siempre.
 *  - los 150 segundos siguientes: el resultado, cada 8 s con un azar de 20 %.
 *  - hasta 10 minutos después: el resultado, cada 15 s con un azar de 20 %.
 *  - después: consulta propia cada 24 a 36 s, como siempre.
 *
 * T + 20 s porque antes la sala no puede tener el resultado: el botón de lanzar se enciende en T, el show arranca unos
 * segundos después y dura 20, 38 o 45. La sala guarda el resultado recién cuando la pantalla grande coronó: por eso el
 * celular nunca lo muestra antes que ella. Sin la hora de la sala (no llegó la cabecera) todo queda como siempre.
 */

import { roundTime } from "../protocol/quicknet-hora";

/** Cuánto después de la hora de la ronda empieza a mirar el resultado: el show dura al menos esto. */
export const MARGEN_DEL_SHOW_MS = 20_000;
/** Cuánto dura la ventana rápida, contada desde que empieza. */
export const VENTANA_RAPIDA_MS = 150_000;
/** Hasta cuándo se sigue mirando el resultado, contado desde que empieza la ventana rápida. */
export const VENTANA_LENTA_HASTA_MS = 600_000;
/** Cada cuánto mira el resultado en la ventana rápida y después de ella, antes del azar de 20 %. */
export const CADA_RAPIDA_MS = 8_000;
export const CADA_LENTA_MS = 15_000;
/** Con más tiempo que esto por delante no se muestran números: una cuenta de una hora no sirve y un reloj corrido se notaría. */
export const NUMEROS_DESDE_MS = 600_000;

/** La hora de una ronda de la semilla en milisegundos, en la hora de la sala. */
export const horaDeLaRondaMs = (ronda: number): number => roundTime(ronda) * 1000;

/**
 * Cuánto adelanta la sala sobre este aparato: la mediana de las últimas muestras (hora de la sala menos hora de este aparato
 * al recibir cada respuesta; la página guarda las últimas tres), o null si no hay ninguna. La cabecera `Date` llega unos
 * instantes después de generarse, así que la muestra más alta es la que menos demora trae.
 */
export function desfaseDe(muestras: readonly number[]): number | null {
  if (muestras.length === 0) return null;
  const ordenadas = [...muestras].sort((a, b) => a - b);
  return ordenadas[Math.floor(ordenadas.length / 2)] ?? null;
}

export type TramoDeConsulta = "propia" | "rapida" | "lenta";

export interface RitmoDeConsulta {
  tramo: TramoDeConsulta;
  /** Cada cuánto, antes del azar. Solo en los tramos que miran el resultado. */
  cadaMs: number | null;
  /** Dentro de cuánto cambia el tramo, o null si no cambia más. */
  cambiaEn: number | null;
}

export interface DatosDelRitmo {
  /** La hora de la ronda, en la hora de la sala. */
  objetivoMs: number;
  /** Lo que adelanta la sala sobre este aparato, o null si no se sabe. */
  desfase: number | null;
  /** Cuándo supo este aparato que la lista estaba sellada, en su propio reloj. */
  supoEn: number;
}

/** Cuándo empieza la ventana rápida, en el reloj de este aparato. */
export const inicioDeLaVentana = (d: DatosDelRitmo): number | null =>
  d.desfase === null ? null : Math.max(d.objetivoMs - d.desfase + MARGEN_DEL_SHOW_MS, d.supoEn);

/**
 * Qué consulta toca ahora y cuándo cambia. Sin la hora de la sala, o con la ventana rápida apagada (`ventana-rapida.ts`),
 * siempre la propia.
 */
export function ritmoDe(ahora: number, d: DatosDelRitmo, ventanaRapida = true): RitmoDeConsulta {
  const inicio = inicioDeLaVentana(d);
  if (!ventanaRapida || inicio === null) return { tramo: "propia", cadaMs: null, cambiaEn: null };
  if (ahora < inicio) return { tramo: "propia", cadaMs: null, cambiaEn: inicio - ahora };
  if (ahora < inicio + VENTANA_RAPIDA_MS) return { tramo: "rapida", cadaMs: CADA_RAPIDA_MS, cambiaEn: inicio + VENTANA_RAPIDA_MS - ahora };
  if (ahora < inicio + VENTANA_LENTA_HASTA_MS) return { tramo: "lenta", cadaMs: CADA_LENTA_MS, cambiaEn: inicio + VENTANA_LENTA_HASTA_MS - ahora };
  return { tramo: "propia", cadaMs: null, cambiaEn: null };
}

export interface VistaDeLaCuenta {
  /** Un número (con menos de diez minutos por delante), la hora del sorteo (sin la hora de la sala o con más tiempo), o nada (ya es la hora). */
  cuenta: { tipo: "numero"; texto: string } | { tipo: "hora" } | { tipo: "nada" };
  /** Pasada la ventana rápida sin resultado, la línea de apoyo dice que está tardando. */
  tardando: boolean;
}

/** Los segundos que faltan como minutos y segundos (0:40, 12:05). */
export function minutosYSegundos(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Lo que dice la pantalla de El sorteo está por empezar en este instante. */
export function vistaDeLaCuenta(ahora: number, d: DatosDelRitmo): VistaDeLaCuenta {
  const inicio = inicioDeLaVentana(d);
  if (d.desfase === null || inicio === null) return { cuenta: { tipo: "hora" }, tardando: false };
  const faltan = d.objetivoMs - (ahora + d.desfase);
  const tardando = ahora >= inicio + VENTANA_RAPIDA_MS;
  if (faltan > NUMEROS_DESDE_MS) return { cuenta: { tipo: "hora" }, tardando };
  if (faltan > 0) return { cuenta: { tipo: "numero", texto: minutosYSegundos(faltan) }, tardando };
  return { cuenta: { tipo: "nada" }, tardando };
}
