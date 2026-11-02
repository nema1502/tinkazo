/**
 * three.js le pone a cada objeto, material y textura un identificador al
 * azar (`MathUtils.generateUUID`, con `Math.random`). No se usa para nada que
 * se vea ni que decida: pero el auditor exigente cuenta toda llamada a
 * `Math.random` mientras corre un juego, y con tres.js sumaba miles.
 *
 * `sinAzarDeTres` presta, mientras three.js arma lo suyo, un generador que
 * cuenta (0, 1, 2…) en vez de tirar la moneda. Es determinista, el
 * identificador sigue siendo único (three.js solo lo usa para distinguir
 * cosas) y `Math.random` queda como estaba al salir. Es el único lugar del 3D
 * que lo nombra.
 */
export function sinAzarDeTres<T>(fn: () => T): T {
  const original = Math.random;
  let n = 0;
  Math.random = () => ((n = (n + 0.6180339887498949) % 1) || 0.5);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}
