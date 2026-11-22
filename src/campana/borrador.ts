/**
 * El borrador de una campaña que todavía no está activa: lo que arma crear-campana.html y lo que recoge el panel de quien
 * organiza en la portada. Es solo el JSON de la campaña, sin firma y sin nada personal: la cuenta de quien organiza la pone el
 * panel con la sesión de ese momento, nunca viaja en el borrador. Vive en el almacenamiento de este navegador, que puede no
 * estar (modo privado, datos bloqueados): todo con try, y sin él la página sigue andando.
 */

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** La clave donde crear-campana.html deja el borrador y donde el panel lo busca. */
export const CLAVE_DEL_BORRADOR = "tinkazo.campana.borrador";

/** Lo más pesado que se guarda: una campaña de verdad pesa menos de 90.000 bytes. */
const MAXIMO_DEL_BORRADOR = 200_000;

/** Guarda el borrador. `false` si no hay dónde guardarlo o el navegador no deja. */
export function guardarBorrador(almacen: Almacen | null, texto: string): boolean {
  if (!almacen || texto.length > MAXIMO_DEL_BORRADOR) return false;
  try {
    almacen.setItem(CLAVE_DEL_BORRADOR, texto);
    return almacen.getItem(CLAVE_DEL_BORRADOR) === texto;
  } catch {
    return false;
  }
}

/** El borrador guardado, o `null` si no hay ninguno. */
export function leerBorrador(almacen: Almacen | null): string | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_DEL_BORRADOR);
    return crudo !== null && crudo !== "" && crudo.length <= MAXIMO_DEL_BORRADOR ? crudo : null;
  } catch {
    return null;
  }
}

/** Saca el borrador: ya se activó, o quien organiza lo dejó. */
export function borrarBorrador(almacen: Almacen | null): void {
  if (!almacen) return;
  try {
    almacen.removeItem(CLAVE_DEL_BORRADOR);
  } catch {
    /* sin almacenamiento no queda nada que sacar */
  }
}
