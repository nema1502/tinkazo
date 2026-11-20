import { CLAVE_PASO_CUPON } from "../stellar/cupon-paso-guardado";
import { MARCA_INGRESAR } from "./cuenta-estado";

/**
 * La elección de Tengo un cupón atraviesa la recarga del cambio de modo.
 * Vive solo en esta pestaña. Si todavía no hay cuenta, la marca de ingreso ya
 * conocida pide primero una cuenta y la elección sigue esperando para abrir
 * el campo del cupón cuando esa cuenta esté lista.
 */

/**
 * Deja pedido el campo del cupón para la próxima cuenta de la red principal.
 * La puerta de `#sortear` se pide solo si el cambio de modo va a ese destino y
 * no hay una cuenta para retomar. Con una cuenta, una marca vieja se borra.
 */
export function pedirPasoDelCupon(ingresar: boolean): void {
  try {
    sessionStorage.setItem(CLAVE_PASO_CUPON, "1");
    if (ingresar) sessionStorage.setItem(MARCA_INGRESAR, "1");
    else sessionStorage.removeItem(MARCA_INGRESAR);
  } catch {
    /* sin almacenamiento, el cambio de modo sigue pudiendo hacerse */
  }
}

/** Mira la elección sin consumirla: todavía no se sabe si el paso podrá abrir. */
export function hayPedidoDePasoDelCupon(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_PASO_CUPON) === "1";
  } catch {
    return false;
  }
}

/** El paso abrió: la elección y cualquier pedido de entrar ya cumplieron. */
export function consumirPasoDelCupon(): void {
  try {
    sessionStorage.removeItem(CLAVE_PASO_CUPON);
    sessionStorage.removeItem(MARCA_INGRESAR);
  } catch {
    /* sin almacenamiento no queda nada pendiente */
  }
}
