/**
 * Los tiempos que cuidan un toque cuando la pantalla cambia sola bajo el dedo. Viven acá, en un archivo sin imports, porque
 * la página del celular no puede traer los del sitio: `cuenta-lista.ts` es pesado.
 */

/** Un toque en un botón recién cambiado no cuenta: la persona apuntó a lo que había antes. Es el mismo valor que usa el sitio. */
export const GUARDA_DE_TOQUE_MS = 500;
/** Un botón principal no cambia de acción mientras alguien toca la pantalla: espera esta quietud desde el último toque. */
export const QUIETUD_PARA_CAMBIAR_MS = 1_500;
