import { DUR_FINAL } from "./carrera-base";

/**
 * El reloj de la recta, puro: cuántos segundos pasan entre que se abre y cada
 * punto de la pista (`q`, de 0 a 1).
 *
 * La recta no corre a una sola velocidad. Hasta el 78 % la pista pasa pareja y
 * de ahí frena sin saltos, como la cámara que se acerca a la meta, hasta que el
 * último tramo pasa a poco menos de la mitad de la velocidad. Así el final se
 * ve más tiempo y lo que le pasa a la ganadora se reparte en segundos y no en
 * un cuadro: del 90 % a la meta son unos tres segundos (con la pista pareja
 * eran uno y medio), y la recta entera dura casi lo mismo.
 *
 * El duelo, además, tiene su llegada en cámara lenta desde la foto (`foto`).
 *
 * Todo es función de `q` o del tiempo: saltar o redibujar da lo mismo.
 */

/** Desde dónde empieza a frenar la pista, hasta dónde sigue frenando y a cuánta velocidad llega (fracción de la inicial). */
const FRENA_DESDE = 0.78;
const FRENA_HASTA = 0.92;
const VEL_FINAL = 0.45;
/** La llegada del duelo, en cámara lenta desde la foto: a esta fracción de la velocidad que ya llevaba. */
export const LENTO = 0.75;

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

const PASOS = 4000;
/** Los segundos hasta cada `q = i / PASOS`, con la pista parejo-frenada (sin la cámara lenta del duelo), normalizados a `DUR_FINAL`. */
const TABLA: Float64Array = (() => {
  const t = new Float64Array(PASOS + 1);
  const f = (q: number): number => 1 - (1 - VEL_FINAL) * suave((q - FRENA_DESDE) / (FRENA_HASTA - FRENA_DESDE));
  for (let i = 1; i <= PASOS; i++) t[i] = (t[i - 1] as number) + 1 / f((i - 0.5) / PASOS) / PASOS;
  const total = t[PASOS] as number;
  for (let i = 0; i <= PASOS; i++) t[i] = ((t[i] as number) / total) * DUR_FINAL;
  return t;
})();

/** Los segundos de la pista pareja-frenada hasta `q` (sin cámara lenta). */
function segundosBase(q: number): number {
  const x = Math.max(0, Math.min(1, q)) * PASOS;
  const i = Math.min(PASOS - 1, Math.floor(x));
  return (TABLA[i] as number) + ((TABLA[i + 1] as number) - (TABLA[i] as number)) * (x - i);
}

/** Cuántos segundos pasan desde que se abre la recta hasta `q`; con `foto` (el duelo), la llegada desde ahí va más lenta. */
export function segundosDeQ(q: number, foto = 2): number {
  const base = segundosBase(q);
  if (q <= foto) return base;
  const f = segundosBase(foto);
  return f + (base - f) / LENTO;
}

/** El inverso de `segundosDeQ`: en qué punto de la pista está la recta `s` segundos después de abrirse. */
export function qDeSegundos(s: number, foto = 2): number {
  if (s <= 0) return 0;
  if (s >= segundosDeQ(1, foto)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (segundosDeQ(m, foto) < s) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * Cuánto dura la recta en promedio entre los cuatro arcos: el duelo (uno de cada cuatro) suma la cámara lenta de la
 * llegada. Es lo que usa la duración que se anuncia.
 */
export const RECTA_MEDIA: number = (() => {
  const foto = 0.962;
  const extra = segundosDeQ(1, foto) - segundosDeQ(1);
  return DUR_FINAL + extra / 4;
})();
