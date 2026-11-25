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
/** Y lo que baja cuando los ticks ya vuelven a tiempo: la vuelta de la pestaña escondida no queda cargando el equipo con un horizonte grande. */
const BAJADA_RAPIDA = 0.06;

export function margenMusica(margen: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) return margen;
  const necesario = Math.min(MARGEN_MAX, Math.max(MARGEN_BASE, 1.5 * (intervaloMs / 1000) + 0.05));
  if (necesario >= margen) return necesario;
  const bajada = intervaloMs <= FRENO_MS ? BAJADA_RAPIDA : BAJADA;
  return Math.max(necesario, margen - bajada);
}

/**
 * Cuánto frenó el procesador (o la batería, o la pestaña escondida): 0 es un equipo que respira, y mientras más
 * grande, más frenado. Lo mide `tick` con el intervalo entre ticks, como el margen: en un navegador celular sane
 * el tick llega cada 40 ms; con el procesador frenado 4 veces (la primera medida del audit-harness) llega cada
 * 160 ms y todavía alcanza; con 8 y 16 veces, y con la pestaña escondida (los temporizadores bajan a uno por
 * segundo), ya no. La gracia no abre silencios: mientras más frenado, menos capas suenan (E en `music.ts`) y más
 * por delante queda programado (`horizonteDeMusica`).
 */
/** El intervalo a partir del cual el procesador está frenado: 4 veces el frena del audit-harness todavía respira. */
export const FRENO_MS = 160;
/** Cada cuanto baja la gracia por tick, cuando el equipo ya vuelve a respirar. */
const BAJADA_DE_GRACIA = 0.03;

export function nivelDeGracia(gracia: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) return gracia;
  const quiero = intervaloMs <= 2 * FRENO_MS ? (intervaloMs <= FRENO_MS ? 0 : 0.5) : 1;
  // Frenado se nota al toque; recuperación, de a poco, que las capas no vayan a brincar.
  if (quiero > gracia) return quiero;
  if (quiero === gracia) return gracia;
  return Math.max(quiero, gracia - BAJADA_DE_GRACIA);
}

/**
 * Cuánto por delante programa el tick cuando el procesador está frenado o la pestaña escondida: hasta cubrir el
 * intervalo que tardó el último tick, que es lo que va a tardar el próximo. El margen (`MARGEN_MAX`) se queda en
 * 1 s para no quedar atrás del relator; la gracia suma por encima, hasta un techo, porque un show que se calla a
 * la mitad es peor que una música que va un pelí­n atrás (S1). Equipos sanos: el margen de siempre.
 */
export const MARGEN_GRACIA_MAX = 2;

export function horizonteDeMusica(margen: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0 || intervaloMs <= FRENO_MS) return margen;
  return Math.min(MARGEN_GRACIA_MAX, Math.max(margen, 1.2 * (intervaloMs / 1000) + 0.08));
}
