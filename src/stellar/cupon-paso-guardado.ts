/**
 * La marca del campo del cupón que atraviesa el cambio de modo.
 * Vive aparte de la interfaz para que decidir el modo no cargue código visual.
 */

export const CLAVE_PASO_CUPON = "tinkazo.cupon.paso";

/** Olvida el campo pedido al volver a Prueba o al arrancar ahí, sin tocar otras entradas pedidas. */
export function limpiarPasoDelCupon(): void {
  try {
    sessionStorage.removeItem(CLAVE_PASO_CUPON);
  } catch {
    /* sin almacenamiento no queda nada pendiente */
  }
}
