/**
 * El borrador de una campaña que todavía no está activa: lo que arma crear-campana.html y lo que recoge el panel de quien
 * organiza en la portada. Es solo el JSON de la campaña, sin firma y sin nada personal: la cuenta de quien organiza la pone el
 * panel con la sesión de ese momento, nunca viaja en el borrador. Vive en el almacenamiento de este navegador, que puede no
 * estar (modo privado, datos bloqueados): todo con try, y sin él la página sigue andando.
 *
 * De quién es se anota aparte, en la clave `CLAVE_DE_LA_CUENTA_DEL_BORRADOR`, cuando el panel lo toma con una sesión. Sin
 * esa clave el borrador vale para quien entre primero. Otra cuenta no lo ve ni se le ofrece, pero tampoco se borra.
 */
import { seVeDesde } from "./de-quien";

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** La clave donde crear-campana.html deja el borrador y donde el panel lo busca. */
export const CLAVE_DEL_BORRADOR = "tinkazo.campana.borrador";

/** La cuenta a la que se anotó el borrador. La lee también `campana-arranque.ts` sin traer este módulo (una prueba las ata). */
export const CLAVE_DE_LA_CUENTA_DEL_BORRADOR = "tinkazo.campana.borrador.cuenta";

/** Lo más pesado que se guarda: una campaña de verdad pesa menos de 90.000 bytes. */
const MAXIMO_DEL_BORRADOR = 200_000;

/** Guarda el borrador. `false` si no hay dónde guardarlo o el navegador no deja. */
export function guardarBorrador(almacen: Almacen | null, texto: string): boolean {
  if (!almacen || texto.length > MAXIMO_DEL_BORRADOR) return false;
  try {
    almacen.setItem(CLAVE_DEL_BORRADOR, texto);
    // Un borrador nuevo todavía no es de nadie: quien lo arma no sabe con qué cuenta lo va a activar.
    almacen.removeItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR);
    return almacen.getItem(CLAVE_DEL_BORRADOR) === texto;
  } catch {
    return false;
  }
}

/** La cuenta a la que se anotó el borrador, o `null` si no se anotó a ninguna. */
function duenaDelBorrador(almacen: Almacen): string | null {
  try {
    const cuenta = almacen.getItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR);
    return cuenta !== null && cuenta !== "" ? cuenta : null;
  } catch {
    return null;
  }
}

/**
 * El borrador guardado, o `null` si no hay ninguno o es de otra cuenta. `cuenta` es la cuenta conectada: sin sesión se ve el
 * borrador, y con otra cuenta no.
 */
export function leerBorrador(almacen: Almacen | null, cuenta: string | null): string | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_DEL_BORRADOR);
    if (crudo === null || crudo === "" || crudo.length > MAXIMO_DEL_BORRADOR) return null;
    return seVeDesde(duenaDelBorrador(almacen), cuenta) ? crudo : null;
  } catch {
    return null;
  }
}

/** Si el borrador guardado está anotado a otra cuenta que la conectada. Sin borrador o sin dueña anotada, no. */
export function borradorEsDeOtra(almacen: Almacen | null, cuenta: string | null): boolean {
  if (!almacen) return false;
  try {
    return almacen.getItem(CLAVE_DEL_BORRADOR) !== null && !seVeDesde(duenaDelBorrador(almacen), cuenta);
  } catch {
    return false;
  }
}

/** Anota el borrador a la cuenta con que se tomó. Con otro borrador ya anotado a otra cuenta, no hace nada. */
export function anotarDuenaDelBorrador(almacen: Almacen | null, cuenta: string): void {
  if (!almacen) return;
  try {
    if (almacen.getItem(CLAVE_DEL_BORRADOR) === null) return;
    if (duenaDelBorrador(almacen) === null) almacen.setItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR, cuenta);
  } catch {
    /* sin lugar: el borrador sigue valiendo para quien entre primero */
  }
}

/** Saca el borrador: ya se activó, o quien organiza lo dejó. */
export function borrarBorrador(almacen: Almacen | null): void {
  if (!almacen) return;
  try {
    almacen.removeItem(CLAVE_DEL_BORRADOR);
    almacen.removeItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR);
  } catch {
    /* sin almacenamiento no queda nada que sacar */
  }
}
