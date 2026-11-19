import { ingresoPlanB, ingresoPlanBPrendida } from "./ingreso-plan-b";

/**
 * Seguir sin cuenta: la elección de la persona cuando el ingreso falla y el plan B del ingreso está prendido
 * (`ingreso-plan-b.ts`). Es el modo libre que ya existe: sin cuenta no hay sello en la cadena, la lista se cierra en el
 * navegador y el comprobante dice que falta un testigo. Lo único que cambia es que el botón de sellar deja de pedir
 * entrar (`wallet-ui.ts`).
 *
 * Vive en la pestaña (`sessionStorage`) y también en la memoria de la página, como el ensayo: recargar no la tira, y
 * cerrar la pestaña sí. Solo vale con la bandera prendida y en Prueba, y se mira en cada llamada: la marca que quedó
 * escrita no abre nada en Oficial ni con la bandera apagada.
 *
 * No importa la billetera ni la página: la usan `wallet-ui.ts` y `freeze.ts`, y sus pruebas corren sin navegador.
 */

const CLAVE = "tinkazo.sin-cuenta";

/** Se dispara en `document` cuando la elección cambia: la puerta, el botón de sellar y la franja se vuelven a pintar. */
export const AVISO_SIN_CUENTA = "tinkazo:sin-cuenta";

let enMemoria = false;

function marcaEnLaPestana(): boolean {
  try {
    return sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

function avisar(): void {
  if (typeof document !== "undefined") document.dispatchEvent(new CustomEvent(AVISO_SIN_CUENTA));
}

/** La persona eligió seguir sin cuenta, y el plan B sigue valiendo. */
export function sinCuentaElegido(): boolean {
  if (!ingresoPlanB()) return false;
  return enMemoria || marcaEnLaPestana();
}

/**
 * Elige seguir sin cuenta. Con la bandera apagada, en Oficial o con una cuenta ya abierta (`hayCuenta`: un aviso viejo
 * puede seguir en pantalla después de entrar por otro lado) no hace nada y devuelve `false`.
 */
export function elegirSinCuenta(hayCuenta = false): boolean {
  if (hayCuenta || !ingresoPlanB()) return false;
  const yaEstaba = sinCuentaElegido();
  enMemoria = true;
  try {
    sessionStorage.setItem(CLAVE, "1");
  } catch {
    /* sin almacenamiento, dura lo que la página */
  }
  if (!yaEstaba) avisar();
  return true;
}

/**
 * Deja de seguir sin cuenta: al entrar con una cuenta, o por la franja. Sin elección, no avisa. Con la bandera apagada no
 * toca nada, ni el almacenamiento de la pestaña: la herramienta se comporta como si esto no existiera. Con la bandera
 * prendida limpia en cualquier modo, también en Oficial: la marca que se dejó en Prueba no tiene que revivir al volver.
 */
export function salirDeSinCuenta(): void {
  if (!ingresoPlanBPrendida()) return;
  const estaba = enMemoria || marcaEnLaPestana();
  enMemoria = false;
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* ya no está */
  }
  if (estaba) avisar();
}
