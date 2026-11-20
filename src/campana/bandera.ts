/**
 * Bandera de construcción para la pantalla previa de campañas.
 * Permanece apagada por defecto hasta que el sitio se construya con la variable indicada.
 */

/** Indica si la funcionalidad de campañas está activa en esta construcción. */
export function campanasActivo(valor: unknown = import.meta.env.VITE_CAMPANAS): boolean {
  return valor === "1" || valor === "true";
}
