/**
 * El papel picado del cartel del ganador.
 *
 * Antes eran motas de 9 por 5 píxeles que caían en balística pura: al segundo
 * y medio ya habían salido de la pantalla, y en 720 se veían como polvo, no
 * como fiesta (revisión de calidad gráfica, 21 de octubre de 2026). Ahora es
 * papel: sale de atrás del cartel, el aire lo frena, baja meciéndose y dando
 * vueltas, y sigue en el aire mientras está el cartel. Hay tiras de varios
 * tamaños y algunas serpentinas, y al darse vuelta muestran el revés en un tono
 * más oscuro del mismo color: colores planos, sin degradados (docs/marca.md).
 *
 * Todo sale de la hora y del número de la tira, nada se acumula: la misma
 * ronda dibuja el mismo papel, cuadro por cuadro, y saltar a cualquier
 * momento da lo mismo que llegar mirando.
 */
export interface Tira {
  x: number;
  y: number;
  /** El largo y el ancho que se ven en este cuadro (el ancho se achica al darse vuelta). */
  w: number;
  h: number;
  /** El giro en el plano de la pantalla, en radianes. */
  rot: number;
  /** Si se ve el revés del papel. */
  reves: boolean;
}

/** Un azar que depende solo de sus argumentos (el mismo de `stage.ts`). */
const h = (a: number, b: number): number => {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  return (x >>> 0) / 4294967296;
};

/** Una de cada siete tiras es una serpentina: larga y finita. */
export const esSerpentina = (i: number): boolean => i % 7 === 3;

/**
 * Dónde está la tira `i` a `tt` segundos del cartel, en una pantalla de `W`
 * por `H` con la unidad `k`; null si todavía no salió o ya cayó.
 *
 * Con un aire que frena en proporción a la velocidad, la cuenta es cerrada:
 * la velocidad va de la del disparo a la de caída con `e^(-c·q)`, y la
 * posición es su integral. El vaivén crece a medida que el aire la frena.
 */
export function tira(i: number, tt: number, k: number, W: number, H: number): Tira | null {
  const q = tt - h(i, 7) * 0.35;
  if (q < 0) return null;
  const c = 2 + h(i, 6) * 1.2;
  const e = Math.exp(-c * q);
  const f = (1 - e) / c;
  const vx = (h(i, 1) - 0.5) * 2000 * k;
  const vy = -(280 + h(i, 2) * 560) * k;
  const caida = (140 + h(i, 8) * 110) * k;
  const amp = (8 + h(i, 9) * 20) * k * (1 - e);
  const vaiven = (1.4 + h(i, 10) * 1.6) * Math.PI;
  const x = W / 2 + (h(i, 3) - 0.5) * W * 0.4 + vx * f + amp * Math.sin(q * vaiven + h(i, 11) * 6.283);
  const y = H * 0.3 + caida * q + (vy - caida) * f;
  if (y > H + 40 * k) return null;
  const serp = esSerpentina(i);
  const largo = (serp ? 20 + h(i, 12) * 10 : 10 + h(i, 12) * 7) * k;
  const ancho = (serp ? 3 : 5.5 + h(i, 13) * 3) * k;
  const vuelta = Math.cos(h(i, 14) * 6.283 + q * (5 + h(i, 15) * 8));
  return {
    x,
    y,
    w: largo,
    h: Math.max(1, ancho * Math.max(0.15, Math.abs(vuelta))),
    rot: h(i, 4) * 6.283 + q * (h(i, 5) - 0.5) * 7,
    reves: vuelta < 0,
  };
}

/** El revés de un color: el mismo, más oscuro. Plano, sin degradado. */
export const reves = (c: number): number => {
  const r = Math.round(((c >> 16) & 255) * 0.68);
  const g = Math.round(((c >> 8) & 255) * 0.68);
  const b = Math.round((c & 255) * 0.68);
  return (r << 16) | (g << 8) | b;
};
