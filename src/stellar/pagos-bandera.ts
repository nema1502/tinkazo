/**
 * La bandera de los premios pagados y del panel de ganadores, apagada en producción: `VITE_PAGOS=1`, o `VITE_EQUIPOS=1`
 * (la del registro de equipos con cupón: el evento prende las dos juntas).
 *
 * Es un archivo propio y mínimo a propósito: la página de verificación lo trae siempre para preguntar, y con la bandera
 * apagada no baja nada más (ni el panel, ni sus textos, ni la lectura de la red).
 */
export function pagosActivos(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_PAGOS === "1" || env.VITE_EQUIPOS === "1";
}
