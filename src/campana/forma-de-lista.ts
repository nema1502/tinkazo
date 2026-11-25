/**
 * La forma de una lista de la sala, reconocida en sus propios datos y no en un dato aparte que se pueda perder: una lista es
 * de cuentas si todas sus filas son cuentas, y de personas si todas son líneas de persona. Una mezcla de las dos, o una
 * línea de persona junto a otra cosa, no se sortea nunca.
 *
 * Los dos reconocimientos son los de la sala (`esCuentaValida` y `esLineaDePersona`), importados como el sitio ya importa
 * `logica.ts`, así que el sitio y la sala no pueden discrepar sobre qué es una cuenta ni qué es una línea.
 */
import { esLineaDePersona } from "../../workers/sala/src/linea-persona";
import { esCuentaValida } from "../../workers/sala/src/logica";

/** Lo que es una lista cuando todas sus filas son de lo mismo. */
export type FormaDeLista = "cuenta" | "persona";

/**
 * La forma de las filas:
 * - `cuenta`: todas son cuentas (también una lista vacía, como siempre).
 * - `persona`: todas son líneas de persona.
 * - `mezclada`: hay líneas de persona junto a otra cosa, sean cuentas o filas que no son nada.
 * - `rara`: no hay ninguna línea de persona y alguna fila no es una cuenta. Es lo que ya era antes de las personas.
 */
export function formaDeLista(filas: readonly unknown[]): FormaDeLista | "mezclada" | "rara" {
  const hayPersonas = filas.some((f) => esLineaDePersona(f));
  if (hayPersonas) return filas.every((f) => esLineaDePersona(f)) ? "persona" : "mezclada";
  return filas.every((f) => esCuentaValida(f)) ? "cuenta" : "rara";
}

/** Si la lista es de personas: dos o más, y todas líneas de persona. Una lista de personas ya sellada nunca es de una sola. */
export function esListaDePersonas(lineas: readonly unknown[]): boolean {
  return lineas.length >= 2 && formaDeLista(lineas) === "persona";
}
