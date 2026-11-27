/**
 * La bandera de construcción de las campañas con Google. Sin imports.
 *
 * Con ella prendida, el armador de campañas arma de personas toda campaña nueva con premio en dólares: la gente se anota con
 * Google y quien organiza le manda el premio a cada persona que gana. Solo vale junto con la de anotarse sin billetera: sola no
 * cambia nada. Apagada, que es como nace, el armador es el de siempre.
 *
 * Vive en su propio archivo y no con las banderas de anotarse sin billetera: aquellas las carga la página del celular, que tiene
 * un tope de peso, y esta solo la lee la página para armar campañas.
 */

/** Lo que el sitio lee al construir. */
export interface EntornoDeCampanasConGoogle {
  VITE_CAMPANAS_CON_GOOGLE?: unknown;
  VITE_ANOTARSE_SIN_BILLETERA?: unknown;
}

/**
 * Cada variable se lee por su nombre: así el armado reemplaza solo esas dos y no mete en la página el objeto entero con todas
 * las variables del sitio.
 */
const ENTORNO_DEL_BUILD = (): EntornoDeCampanasConGoogle => ({
  VITE_CAMPANAS_CON_GOOGLE: import.meta.env.VITE_CAMPANAS_CON_GOOGLE,
  VITE_ANOTARSE_SIN_BILLETERA: import.meta.env.VITE_ANOTARSE_SIN_BILLETERA,
});

/** Si el sitio se construyó con los dos interruptores en 1. Solo ese valor exacto, en cada uno, la prende. */
export function campanasConGoogleActivo(entorno: EntornoDeCampanasConGoogle = ENTORNO_DEL_BUILD()): boolean {
  return entorno.VITE_CAMPANAS_CON_GOOGLE === "1" && entorno.VITE_ANOTARSE_SIN_BILLETERA === "1";
}
