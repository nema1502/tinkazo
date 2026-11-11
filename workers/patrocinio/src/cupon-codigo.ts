/**
 * Cómo se lee un cupón de Tinkazo. Sin dependencias a propósito: lo usan el portero
 * (`altas.ts`), el sitio y la herramienta de cupones, y los tres pasan el mismo vector
 * (`cupon-vectores.json`, junto a este archivo).
 */

/** El alfabeto de Crockford, sin I, L, O ni U. */
export const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const LARGO_CUPON = 12;
/**
 * Los sorteos oficiales que puede traer un cupón, como mucho: el paquete de 50 que se vende por fuera. Lo mira el portero
 * al crear el lote y la herramienta antes de mandarlo (`scripts/cupones.mjs` tiene una copia y una prueba que las compara).
 */
export const MAX_SORTEOS_POR_CUPON = 50;
/** Lo más largo que se mira antes de normalizar: un pegado enorme no se recorre. */
const MAX_ENTRADA = 64;
/** Espacios de cualquier tipo y guiones, también los largos que pone el teclado del celular. */
const SEPARADORES = /[\s\-\u2010-\u2015\u2212]/g;
const VALIDO = new RegExp(`^[${ALFABETO}]{${LARGO_CUPON}}$`);

/**
 * El código como lo guarda el servidor: sin espacios ni guiones, en mayúsculas, la O como 0 y la I o la L como 1. Si no
 * da 12 caracteres del alfabeto, null. Solo letras y números ASCII: una letra de otro alfabeto que en mayúsculas se
 * parezca a una nuestra (la ı sin punto) no se acepta.
 */
export function normalizar(entrada: unknown): string | null {
  if (typeof entrada !== "string" || entrada.length > MAX_ENTRADA) return null;
  const limpio = entrada.replace(SEPARADORES, "");
  if (!/^[0-9A-Za-z]*$/.test(limpio)) return null;
  const codigo = limpio.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return VALIDO.test(codigo) ? codigo : null;
}

/** Cómo se muestra un código normalizado: tres grupos de cuatro, `K7M2-9QXA-4HTR`. */
export function mostrar(codigo: string): string {
  if (normalizar(codigo) !== codigo) throw new Error("cupon-forma");
  return `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8)}`;
}
