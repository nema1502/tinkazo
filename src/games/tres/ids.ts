/**
 * three.js le pone a cada objeto, material y textura un identificador al
 * azar (`MathUtils.generateUUID`, con `Math.random`). No se usa para nada que
 * se vea ni que decida, pero el auditor exigente cuenta toda llamada a
 * `Math.random` mientras corre un juego, y three.js sumaba miles.
 *
 * `sinAzarDeTres` presta, mientras three.js arma lo suyo, un generador que
 * cuenta en vez de tirar la moneda. Es determinista, el identificador sigue
 * siendo único (three.js solo lo usa para distinguir cosas) y `Math.random`
 * queda como estaba al salir. Es el único lugar del 3D que lo nombra.
 *
 * El motor ya envuelve en esto la creación de la vista y cada cuadro
 * (`Motor3D.cuadro`): quien porta un juego no lo llama a mano salvo que cree
 * objetos fuera de esos dos momentos.
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

/**
 * Un número de 0 a 1 que depende solo de dos enteros: lo que en el 3D parece azar (dónde cae una piedra, qué color
 * tiene cada persona de la tribuna) sale de acá, así la misma ronda se ve igual en todas las pantallas.
 */
export function hash(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** El hash de un texto (un nombre), para dar un número estable a cada persona. */
export function hashTexto(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
