/**
 * La forma del zoom de emoción, aparte de la cámara para poder probarla sin
 * una placa de video.
 *
 * Un juego pide dos cosas (ver `Camera.tension` y `Camera.golpe`): un empuje
 * lento que sube el acercamiento hasta el golpe, y el golpe mismo, un
 * acercamiento corto y firme sobre el ganador que vuelve suave. Todo se mide en
 * la hora de la cámara, que es la hora del juego: la misma ronda da la misma
 * curva. El zoom es presentación; no cambia a quién mira la cámara ni cuándo.
 */

/** El empuje: desde `t0`, sube `amt` (una fracción del zoom) en `dur` segundos, con una curva suave, y se queda. */
export interface Empuje {
  t0: number;
  dur: number;
  amt: number;
}

/**
 * El golpe: desde `t0`, llega en una décima de segundo a `amt` (una fracción del
 * zoom), se sostiene `hold` segundos y vuelve a cero en `vuelta` segundos.
 */
export interface Golpe {
  t0: number;
  amt: number;
  hold: number;
  vuelta: number;
}

/** Suave de verdad: 0 al empezar, 1 al terminar, sin pendiente en los extremos. */
export const suave = (p: number): number => {
  const q = Math.min(1, Math.max(0, p));
  return q * q * (3 - 2 * q);
};

/** Cuánto tarda el golpe en llegar a su acercamiento, en segundos. */
export const ATAQUE_GOLPE = 0.1;

/**
 * El zoom extra que dan el empuje y el golpe en la hora `t` de la cámara, como
 * fracción del zoom (0,1 suma un 10 %). Cero si no hay ni empuje ni golpe.
 *
 * La vuelta del golpe se lleva también el empuje: al terminar la vuelta, la
 * cámara queda en el encuadre que pidió el juego, sin escalón.
 */
export function zoomDeEmocion(t: number, empuje: Empuje | null, golpe: Golpe | null): number {
  let subida = 0;
  if (empuje) subida = empuje.amt * suave((t - empuje.t0) / Math.max(0.05, empuje.dur));
  let extra = 0;
  let vuelta = 1;
  if (golpe && t >= golpe.t0) {
    const s = t - golpe.t0;
    const ataque = Math.min(1, s / ATAQUE_GOLPE);
    vuelta = s <= golpe.hold ? 1 : 1 - suave((s - golpe.hold) / Math.max(0.05, golpe.vuelta));
    extra = golpe.amt * ataque * vuelta;
  }
  return subida * vuelta + extra;
}
