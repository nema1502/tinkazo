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
/** Y lo que baja cuando los ticks ya vuelven a tiempo, con el adelgazado prendido: el margen grande no queda cargando el equipo. */
const BAJADA_RAPIDA = 0.06;

/**
 * El margen que sigue al reloj. `bajadaRapida` es parte del adelgazado (ver `adelgazadoPrendido`): apagado, el margen
 * baja siempre de a 0,01 por tick, como en producción.
 */
export function margenMusica(margen: number, intervaloMs: number, bajadaRapida = false): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) return margen;
  const necesario = Math.min(MARGEN_MAX, Math.max(MARGEN_BASE, 1.5 * (intervaloMs / 1000) + 0.05));
  if (necesario >= margen) return necesario;
  const bajada = bajadaRapida && intervaloMs <= FRENO_MS ? BAJADA_RAPIDA : BAJADA;
  return Math.max(necesario, margen - bajada);
}

/* ------------------------------------------------------ el adelgazado, apagado */

/**
 * El interruptor del adelgazado de capas. Con el procesador frenado, el adelgazado hace que suenen menos capas y que el
 * margen baje rápido cuando el equipo se recupera. Cambia lo que se oye en todos los sorteos y nadie lo midió con el
 * procesador frenado ni lo escuchó: por eso nace apagado y producción suena como siempre. La página de escucha y quien
 * quiera probarlo lo prenden con `?musicagracia=1`, igual que `?sonidoarchivo=1` prende los efectos de archivo. Las
 * pruebas usan `prenderAdelgazado`.
 */
let forzado: boolean | null = null;

/** Para las pruebas y la escucha: `true` prende, `false` apaga, `null` vuelve a lo de siempre. */
export function prenderAdelgazado(v: boolean | null): void {
  forzado = v;
}

/** ¿Hoy se adelgazan las capas cuando el procesador frena? Apagado salvo que la dirección lo pida. */
export function adelgazadoPrendido(busqueda?: string): boolean {
  if (forzado !== null) return forzado;
  try {
    const v = new URLSearchParams(busqueda ?? location.search).get("musicagracia");
    return v === "1";
  } catch {
    return false;
  }
}

/**
 * Cuánto frenó el procesador (o la batería): 0 es un equipo que respira, y mientras más grande, más frenado. Lo mide
 * `tick` con el intervalo entre ticks, como el margen: en un navegador celular sano el tick llega cada 40 ms. Con el
 * procesador frenado 4 veces llega cada 160 ms y todavía alcanza. Con 8 y 16 veces, ya no. La gracia no abre silencios:
 * mientras más frenado, menos capas suenan y más por delante queda programado (`horizonteDeMusica`).
 */
/** El intervalo a partir del cual el procesador está frenado: 4 veces el freno todavía respira. */
export const FRENO_MS = 160;
/** Cuánto baja la gracia por tick, cuando el equipo ya vuelve a respirar. */
const BAJADA_DE_GRACIA = 0.03;

export function nivelDeGracia(gracia: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0) return gracia;
  const quiero = intervaloMs <= 2 * FRENO_MS ? (intervaloMs <= FRENO_MS ? 0 : 0.5) : 1;
  // Frenado se nota al toque. La recuperación va de a poco, para que las capas no salten.
  if (quiero > gracia) return quiero;
  if (quiero === gracia) return gracia;
  return Math.max(quiero, gracia - BAJADA_DE_GRACIA);
}

/**
 * Cuánto por delante programa el tick cuando el procesador está frenado: hasta cubrir el intervalo que tardó el último
 * tick, que es lo que va a tardar el próximo. El margen (`MARGEN_MAX`) se queda en 1 s para no quedar atrás de lo que
 * dice el relator. La gracia suma por encima, hasta un techo, porque un show que se calla a la mitad es peor que una
 * música que va un poco atrás. Equipos sanos: el margen de siempre.
 */
export const MARGEN_GRACIA_MAX = 2;

export function horizonteDeMusica(margen: number, intervaloMs: number): number {
  if (!Number.isFinite(intervaloMs) || intervaloMs <= 0 || intervaloMs <= FRENO_MS) return margen;
  return Math.min(MARGEN_GRACIA_MAX, Math.max(margen, 1.2 * (intervaloMs / 1000) + 0.08));
}

/**
 * Lo que recuerda la música entre un tick y el siguiente para decidir la gracia: cuánto frenó el procesador, cuántos
 * ticks seguidos llegaron tarde y si el último tick fue con la pestaña escondida.
 */
export interface EstadoDeGracia {
  gracia: number;
  lentos: number;
  veniaEscondida: boolean;
}

export const GRACIA_EN_REPOSO: Readonly<EstadoDeGracia> = { gracia: 0, lentos: 0, veniaEscondida: false };

/**
 * La gracia después de un tick, con el adelgazado prendido. Tres cuidados para no castigar a un equipo sano:
 * un solo tick tarde (una pausa de la memoria, un cuadro pesado) es un tropiezo y no baja nada, la gracia empieza con
 * el segundo seguido y desde ahí sigue a cada tick, y el primer tick que se ve al volver de la pestaña escondida
 * no mide el equipo, porque su intervalo es de la pestaña y no del procesador. Escondida no cuenta nada.
 * Devuelve también el intervalo que tiene que usar el margen (al volver de escondida, uno sano).
 */
export function seguirLaGracia(e: EstadoDeGracia, intervaloMs: number, escondida: boolean): EstadoDeGracia & { intervalo: number } {
  if (escondida) return { gracia: 0, lentos: 0, veniaEscondida: true, intervalo: intervaloMs };
  if (e.veniaEscondida) return { gracia: 0, lentos: 0, veniaEscondida: false, intervalo: Math.min(intervaloMs, FRENO_MS) };
  const lentos = intervaloMs > FRENO_MS ? e.lentos + 1 : 0;
  const tropiezo = lentos === 1 && e.gracia === 0;
  return { gracia: nivelDeGracia(e.gracia, tropiezo ? FRENO_MS : intervaloMs), lentos, veniaEscondida: false, intervalo: intervaloMs };
}
