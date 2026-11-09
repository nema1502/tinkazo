import { throwTime, type Throw } from "./sapo-plan";

/**
 * Los tiempos del sapo, en segundos de juego: lo que dura cada parte de la
 * entrada, de cada tiro y de lo que pasa después. Puro, sin Pixi ni DOM: lo usan
 * el dibujo (`sapo.ts`) y las respuestas de la prueba del niño (`sapo-nino.ts`),
 * así los dos cuentan la misma hora.
 */
export const Q_SHOW = 1.0;
export const Q_WAVE = 1.25;
export const Q_FLY = 1.1;
export const HANG_FIRST = 0.9;
export const HANG_FINAL = 1.8;
export const HANG_SMALL = 0.5;
/** Después de caer: el rebote y la salida, el baile en el borde, o hundirse en el agujero. */
export const AFTER_MISS = 0.8;
export const AFTER_NEAR = 1.3;
export const AFTER_HIT = 1.0;
/**
 * No se acorta: "¡ADENTRO!" abre el remate de la música al caer, y el remate
 * rasguea casi dos segundos. Con 1,3 y con 1,6 el cartel llegaba encima del
 * rasgueo y el golpe del ganador sonaba más bajo que lo de antes (auditor de
 * mezcla, 7 de octubre de 2026: −4,6 y −8,1 LU).
 */
export const AFTER_FINAL = 2.0;
/** La parte de AFTER_NEAR que la argolla baila en el borde antes de salir. */
export const WOBBLE = 0.8;
export const SINK = 0.5;
/**
 * La boca (un fallo que entra a la rana, una vez por show): cuánto tarda en
 * hundirse la argolla, cuándo sale escupida y cuánto vuela hasta el aro.
 */
export const BOCA_IN = 0.3;
export const BOCA_SPIT = 0.45;
export const BOCA_FLY = 0.5;
/** Lo que dura la boca entera: tragar, escupir, y rodar afuera como cualquier fallo. */
export const BOCA_AFTER = BOCA_SPIT + BOCA_FLY + AFTER_MISS;

/** Cuándo empieza, cae y termina cada tiro, y cuándo termina el último (la corona). */
export interface TiempoDeTiro {
  start: number;
  land: number;
  end: number;
  flight: number;
  grand: boolean;
  final: boolean;
}

/** El guion de tiempos de los tiros, uno detrás de otro, a partir de que los nombres ya están sentados (`tSeated`). */
export function tiemposDeTiros(throws: readonly Throw[], ultimoTurno: number, tSeated: number): { tiros: TiempoDeTiro[]; corona: number } {
  const tiros: TiempoDeTiro[] = [];
  let tt = tSeated;
  throws.forEach((th, i) => {
    const final = i === throws.length - 1;
    const grand = th.turn === ultimoTurno;
    tt += i === 0 ? HANG_FIRST : final ? HANG_FINAL : HANG_SMALL;
    const flight = throwTime(th.kind, grand);
    const after = th.boca ? BOCA_AFTER : th.kind === "miss" ? AFTER_MISS : th.kind === "near" ? AFTER_NEAR : final ? AFTER_FINAL : AFTER_HIT;
    const start = tt;
    tiros.push({ start, land: start + flight, end: start + flight + after, flight, grand, final });
    tt = start + flight + after;
  });
  return { tiros, corona: tt };
}
