/**
 * La bandera de los premios pagados y del panel de ganadores, apagada en producción: solo `VITE_PAGOS=1`.
 * La del registro de equipos con cupón (`VITE_EQUIPOS`) no la prende: en un stand los premios se suelen entregar en
 * mano, y el comprobante no tiene que decir «Pendiente» ni «Vencido» de un premio que nunca se iba a pagar en la red.
 *
 * Es un archivo propio y mínimo a propósito: la página de verificación lo trae siempre para preguntar, y con la bandera
 * apagada no baja nada más (ni el panel, ni sus textos, ni la lectura de la red).
 */
export function pagosActivos(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_PAGOS === "1";
}
