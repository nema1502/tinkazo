/**
 * De quién es lo que la compu recuerda de una campaña (la sala, su token, la lista pasada al sorteo, el borrador) y qué se ve
 * y qué se mueve desde la cuenta con que se entró. Son reglas sin dependencias, que comparten `sala/campana-org.ts` y
 * `campana/en-curso.ts` (este último lo importa la página de siempre y no puede traer nada pesado).
 *
 * Atar lo guardado a la cuenta evita el cruce entre dos cuentas en una misma compu. No es una frontera de seguridad: el token
 * y la clave siguen en el almacenamiento del navegador. Por eso se dice que una cuenta ajena "no lo ve ni lo ofrece" y no que
 * está protegido, y por eso lo de otra cuenta nunca se borra al cambiar de cuenta.
 */

/**
 * Si algo guardado para esa cuenta se ve desde la cuenta conectada. Sin cuenta guardada (la campaña no nombra a nadie, o es
 * una memoria de antes) lo ve cualquiera. Sin cuenta conectada se ve todo: la sala se muestra para mirar y toda acción pide
 * entrar. Con otra cuenta conectada, no.
 */
export function seVeDesde(duena: string | null | undefined, conectada: string | null): boolean {
  return typeof duena !== "string" || conectada === null || duena === conectada;
}

/**
 * Si la cuenta conectada puede mover la sala: es la que la organiza, o la campaña no nombra a nadie y queda a cargo de quien
 * tenga el token. Una memoria de antes (sin la cuenta guardada) todavía no se sabe de quién es: no se mueve nada hasta
 * completarla con la sesión.
 */
export function puedeMoverLaSala(duena: string | null | undefined, conectada: string | null): boolean {
  return duena === null || (typeof duena === "string" && duena === conectada);
}
