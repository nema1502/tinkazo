/**
 * Las decisiones del auditor de mezcla que no necesitan navegador: cuándo se puede dejar de grabar, si lo grabado
 * cubre todo lo que sonó y si hay que repetir la medición.
 *
 * Todo en segundos del reloj del audio (el `currentTime` del contexto), que avanza con lo que suena y no con lo que
 * tarda la página: con la máquina cargada el reloj de la pared se atrasa respecto del audio y las cuentas por pared
 * (que fue lo que hacía el auditor) caían corridas.
 */

/** Cuánto sigue grabando después de que sale el cartel del ganador, para llegar a medir el golpe y su cola. */
export const DESPUES_DEL_CARTEL = 2;

/** Cuánto menos puede haber grabado de lo que sonó antes de decir que la grabación quedó corta. */
export const TOLERANCIA_CORTA = 0.25;

/**
 * `true` si ya se puede dejar de grabar: el show cerró y, si se vio el cartel, pasaron `extra` segundos desde él
 * (si el show cierra antes, igual se espera: el golpe del ganador sale justo al final).
 */
export function puedeParar({ cerro, cartelSeg, ahoraSeg, extra = DESPUES_DEL_CARTEL }) {
  if (!cerro) return false;
  if (cartelSeg === null || cartelSeg === undefined || !(cartelSeg >= 0)) return true;
  return ahoraSeg >= cartelSeg + extra;
}

/** El cartel, en milisegundos desde el comienzo de la grabación (`primerCuadro` en cuadros de audio). */
export function cartelEnGrabacion({ cartelSeg, primerCuadro, sr }) {
  if (cartelSeg === null || cartelSeg === undefined || !(cartelSeg >= 0)) return -1;
  return (cartelSeg - primerCuadro / sr) * 1000;
}

/** `true` si lo grabado quedó más corto que lo que sonó desde que empezó a grabar. */
export function grabacionCorta({ grabadoSeg, sonadoSeg, tolerancia = TOLERANCIA_CORTA }) {
  return grabadoSeg < sonadoSeg - tolerancia;
}

/**
 * Si hay que repetir la medición una vez: la grabación quedó corta, o se vio el cartel pero el golpe no se pudo medir
 * (no entra medio segundo antes y después). Sin cartel, no hay golpe que medir y no se repite por eso.
 */
export function hayQueRepetir({ corta, cartelMs, golpe }) {
  if (corta) return true;
  return cartelMs > 0 && (golpe === null || golpe === undefined);
}
