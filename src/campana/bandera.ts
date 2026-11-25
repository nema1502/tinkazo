/**
 * Bandera de construcción para la pantalla previa de campañas.
 * Permanece apagada por defecto hasta que el sitio se construya con la variable indicada.
 */

/** Indica si la funcionalidad de campañas está activa en esta construcción. */
export function campanasActivo(valor: unknown = import.meta.env.VITE_CAMPANAS): boolean {
  return valor === "1" || valor === "true";
}

/**
 * Muestra los enlaces a la campaña de una empresa (la cabecera, el pie y la puerta de la portada) solo con las campañas
 * abiertas. Todos nacen con `data-campana-enlace` y `hidden`: sin la bandera, o sin JavaScript, no se ve ninguno y la portada
 * se reparte entre las puertas que quedan.
 */
export function mostrarEnlacesDeCampana(raiz: ParentNode, activo: boolean = campanasActivo()): void {
  if (!activo) return;
  for (const enlace of raiz.querySelectorAll<HTMLElement>("[data-campana-enlace]")) enlace.hidden = false;
}
