/**
 * Las marcas de quien participa en el sorteo de una empresa, sin DOM y sin red.
 *
 * - La de invitada vive 48 horas en `localStorage` (vale para todas las pestañas): mientras está, la herramienta no abre
 *   sola el paso de la cuenta, que es para quien organiza.
 * - La de la ventana vive 10 minutos en `sessionStorage`: la pone la página de la campaña justo antes de abrir la ventana
 *   de Google y la borra de su propia pestaña justo después, en el mismo toque. Como el navegador copia el
 *   `sessionStorage` a la ventana que se abre en ese instante, solo esa ventana sabe que es la de Google.
 * - La del premio vive 30 minutos en `sessionStorage`: la deja la entrada de quien ganó. Sin cuenta, espera a la primera
 *   sesión de la pestaña. Con cuenta, vale solo para esa cuenta. Así sobrevive a una recarga y se copia a la ventana de
 *   Google que abre esa pestaña.
 */
export const CLAVE_INVITADA = "tinkazo.campana.invitada";
export const VIDA_INVITADA_MS = 48 * 3_600_000;
export const CLAVE_VENTANA = "tinkazo.campana.ventana";
export const VIDA_VENTANA_MS = 10 * 60_000;
export const CLAVE_PREMIO = "tinkazo.campana.premio";
export const VIDA_PREMIO_MS = 30 * 60_000;

/** Guarda el valor bajo la clave. Si el almacenamiento lanza, no hace nada: la herramienta se porta como siempre. */
function guardar(almacen: Pick<Storage, "setItem">, clave: string, valor: string): void {
  try {
    almacen.setItem(clave, valor);
  } catch {
    /* sin almacenamiento, la herramienta se porta como siempre */
  }
}

function borrar(almacen: Pick<Storage, "removeItem">, clave: string): void {
  try {
    almacen.removeItem(clave);
  } catch {
    /* sin almacenamiento, no hay nada que borrar */
  }
}

/** Vigente solo si lo guardado es un entero mayor que ahora: un valor raro o vencido no cuenta. */
function vigente(almacen: Pick<Storage, "getItem">, clave: string, ahora: number): boolean {
  try {
    const crudo = almacen.getItem(clave);
    if (crudo === null || !/^\d{1,16}$/.test(crudo)) return false;
    return Number(crudo) > ahora;
  } catch {
    return false;
  }
}

export function marcarInvitada(almacen: Pick<Storage, "setItem">, ahora: number): void {
  guardar(almacen, CLAVE_INVITADA, String(ahora + VIDA_INVITADA_MS));
}

export const esInvitada = (almacen: Pick<Storage, "getItem">, ahora: number): boolean => vigente(almacen, CLAVE_INVITADA, ahora);
export const soltarInvitada = (almacen: Pick<Storage, "removeItem">): void => borrar(almacen, CLAVE_INVITADA);

export function marcarVentana(almacen: Pick<Storage, "setItem">, ahora: number): void {
  guardar(almacen, CLAVE_VENTANA, String(ahora + VIDA_VENTANA_MS));
}

export const esVentanaDeGoogle = (almacen: Pick<Storage, "getItem">, ahora: number): boolean => vigente(almacen, CLAVE_VENTANA, ahora);
export const soltarVentana = (almacen: Pick<Storage, "removeItem">): void => borrar(almacen, CLAVE_VENTANA);

/** Lo que dice la marca del premio: de qué cuenta es, o `null` si todavía espera a la primera sesión. */
export interface MarcaDelPremio {
  cuenta: string | null;
}

/** Deja la marca del premio por 30 minutos, con la cuenta si ya se sabe. */
export function marcarPremio(almacen: Pick<Storage, "setItem">, ahora: number, cuenta: string | null = null): void {
  const vence = String(ahora + VIDA_PREMIO_MS);
  guardar(almacen, CLAVE_PREMIO, cuenta ? `${vence}:${cuenta}` : vence);
}

/** La marca del premio si está vigente y se entiende. Un valor raro o vencido da `null`. */
export function leerPremio(almacen: Pick<Storage, "getItem">, ahora: number): MarcaDelPremio | null {
  try {
    const crudo = almacen.getItem(CLAVE_PREMIO);
    const m = crudo === null ? null : /^(\d{1,16})(?::([A-Za-z0-9]{1,64}))?$/.exec(crudo);
    if (!m || Number(m[1]) <= ahora) return null;
    return { cuenta: m[2] ?? null };
  } catch {
    return null;
  }
}

export const soltarPremio = (almacen: Pick<Storage, "removeItem">): void => borrar(almacen, CLAVE_PREMIO);
