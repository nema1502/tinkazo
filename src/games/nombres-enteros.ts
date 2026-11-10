/**
 * Los nombres que no son de una persona y por eso no se acortan: el de un equipo ("Las Wawas") se escribe entero, nunca
 * "Las W." como si "Wawas" fuera un apellido.
 *
 * Los pone la herramienta antes de cada show (`playGame` en `src/ui/draw.ts`, con las etiquetas de los equipos con
 * cupón) y los cambia el show siguiente: sin equipos queda vacío y nada cambia. Vive aparte de `nombres.ts` para que
 * la herramienta lo use sin cargar las formas de los nombres, que son de los juegos.
 */

let enteros: ReadonlySet<string> = new Set();

/** Los nombres del show que viene que se escriben siempre enteros. Reemplaza a los del show anterior. */
export function ponerNombresEnteros(nombres: Iterable<string>): void {
  enteros = new Set(nombres);
}

/** Si este nombre se escribe siempre entero (es el de un equipo). */
export const esNombreEntero = (nombre: string): boolean => enteros.size > 0 && enteros.has(nombre);
