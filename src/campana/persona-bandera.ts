/**
 * Las banderas de construcción de anotarse sin billetera. Sin imports.
 *
 * Con todo apagado, que es como nacen, ninguna página cambia: una campaña de personas que se abre en un sitio así dice que
 * todavía no se puede abrir acá, y el armador de campañas no ofrece el modo.
 */

/** Lo que el sitio lee al construir. */
export interface EntornoDePersonas {
  VITE_ANOTARSE_SIN_BILLETERA?: unknown;
  VITE_GOOGLE_CLIENT_ID?: unknown;
}

/**
 * Cada variable se lee por su nombre: así el armado reemplaza solo esas dos y no mete en la página el objeto entero con todas
 * las variables del sitio.
 */
const ENTORNO_DEL_BUILD = (): EntornoDePersonas => ({
  VITE_ANOTARSE_SIN_BILLETERA: import.meta.env.VITE_ANOTARSE_SIN_BILLETERA,
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
});

/** Si el sitio se construyó con el interruptor en 1. Solo ese valor exacto lo prende. */
export function anotarseSinBilleteraActivo(entorno: EntornoDePersonas = ENTORNO_DEL_BUILD()): boolean {
  return entorno.VITE_ANOTARSE_SIN_BILLETERA === "1";
}

/**
 * El identificador de cliente de Google (público) con que el sitio abre las campañas de personas, o null si el interruptor
 * está apagado o falta el identificador. Hacen falta las dos cosas.
 */
export function clienteDeGoogleDelSitio(entorno: EntornoDePersonas = ENTORNO_DEL_BUILD()): string | null {
  if (!anotarseSinBilleteraActivo(entorno)) return null;
  const cliente = entorno.VITE_GOOGLE_CLIENT_ID;
  if (typeof cliente !== "string") return null;
  const limpio = cliente.trim();
  return limpio === "" ? null : limpio;
}
