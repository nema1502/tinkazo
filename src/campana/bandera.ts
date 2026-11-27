/**
 * Bandera de construcción para la pantalla previa de campañas.
 * Permanece apagada por defecto hasta que el sitio se construya con la variable indicada.
 */

/** Indica si la funcionalidad de campañas está activa en esta construcción. */
export function campanasActivo(valor: unknown = import.meta.env.VITE_CAMPANAS): boolean {
  return valor === "1" || valor === "true";
}

/**
 * Los enlaces a la campaña de una empresa (la cabecera, el pie, la puerta de la portada y el aviso de Sortear) se ven solo con
 * las campañas abiertas, y eso se decide antes del primer pintado y sin JavaScript: index.html lleva el valor de esta misma
 * variable en el atributo `data-campanas` del elemento html (Vite lo reemplaza al construir) y una regla de styles.css esconde
 * lo marcado con `data-campana-enlace` cuando el atributo no vale `1` ni `true`. Con la bandera sin definir o cerrada no se ve
 * ninguno y la portada se reparte entre las puertas que quedan.
 */
