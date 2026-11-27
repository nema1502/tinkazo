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
  VITE_GUARDAR_PERFIL?: unknown;
}

/**
 * Cada variable se lee por su nombre: así el armado reemplaza solo esas tres y no mete en la página el objeto entero con todas
 * las variables del sitio.
 */
const ENTORNO_DEL_BUILD = (): EntornoDePersonas => ({
  VITE_ANOTARSE_SIN_BILLETERA: import.meta.env.VITE_ANOTARSE_SIN_BILLETERA,
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  VITE_GUARDAR_PERFIL: import.meta.env.VITE_GUARDAR_PERFIL,
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

/**
 * Si el sitio se construyó para guardar el perfil de quien se anota con su cuenta de Google (el correo, el nombre y la foto).
 * Hacen falta anotarse sin billetera y este interruptor, que nace apagado y solo prende con el 1 exacto. De esto dependen dos
 * cosas que van siempre juntas: los textos que le dicen a la persona qué se guarda y el permiso que el celular manda en el
 * alta. Una página construida sin el interruptor no muestra esos textos y no manda el permiso.
 */
export function guardarPerfilActivo(entorno: EntornoDePersonas = ENTORNO_DEL_BUILD()): boolean {
  return anotarseSinBilleteraActivo(entorno) && entorno.VITE_GUARDAR_PERFIL === "1";
}

/**
 * Los dos textos de una campaña de personas que cambian cuando la página guarda el perfil, con la clave de siempre y la clave
 * del texto que dice qué se guarda. Van escritas enteras acá porque el armado de la página busca en el código las claves que
 * usa. La pantalla de la campaña no sabe nada de esto: pide la clave de siempre y el celular de personas la cambia al armarse.
 */
const CLAVES_CON_PERFIL: ReadonlyMap<string, string> = new Map([
  ["cpEntrarNotaPersona", "cpEntrarNotaPerfil"],
  ["cpQueGuardamosPersona", "cpQueGuardamosPerfil"],
]);

/** La clave que se pide, o la de su texto con el perfil si la página se construyó para guardarlo y esa clave tiene uno. */
export function claveConPerfil(clave: string, entorno?: EntornoDePersonas): string {
  return guardarPerfilActivo(entorno) ? (CLAVES_CON_PERFIL.get(clave) ?? clave) : clave;
}

/**
 * El permiso que el alta lleva para guardar el perfil: `true` si la página se construyó para guardarlo y sin definir si no, que
 * es lo que el cuerpo del pedido deja afuera. Así el pedido de una página sin la bandera no cambia ni en una letra.
 */
export function permisoDePerfil(entorno?: EntornoDePersonas): true | undefined {
  return guardarPerfilActivo(entorno) || undefined;
}
