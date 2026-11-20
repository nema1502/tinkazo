/**
 * Cuánto por delante se programa la música (segundos del reloj del audio).
 *
 * La música se arma nota por nota desde un temporizador de la página (`tick` en `music.ts`, cada 40 ms). Con 0,22 s
 * por delante alcanza mientras el temporizador llegue a tiempo. En un equipo lento, o con ahorro de batería, un
 * cuadro tarda 200 o 300 ms y la página no corre el temporizador mientras dibuja: lo programado se acababa antes del
 * próximo tick y la música sonaba y se paraba (5 de noviembre de 2026, también en tinkazo.app).
 *
 * El margen mira el intervalo entre ticks: si llegan tarde, sube enseguida a una vez y media ese intervalo (más un
 * resto); si vuelven a llegar a tiempo, baja de a poco hasta 0,22 s. Nunca pasa de un segundo, para que la música no
 * quede muy atrás de lo que dice el relator. En un equipo normal queda en 0,22 s, como siempre.
 */
export const MARGEN_BASE = 0.22;
export const MARGEN_MAX = 1;
/** Lo que baja el margen por tick cuando el equipo se recuperó. */
const BAJADA = 0.01;

export function margenMusica(margen: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) return margen;
  const necesario = Math.min(MARGEN_MAX, Math.max(MARGEN_BASE, 1.5 * (intervaloMs / 1000) + 0.05));
  if (necesario >= margen) return necesario;
  return Math.max(necesario, margen - BAJADA);
}
