/**
 * Si el celular le avisa a la sala que el correo de su cuenta está confirmado. Sin imports.
 *
 * Cuando está encendida, el celular suma `c: true` a la consulta propia (`POST yo`) solo si la lectura de la cuenta dice
 * que el correo confirmado es el de la sesión, una vez por carga y enseguida después de confirmar, no en cada consulta. La
 * sala la usa para elegir qué dice el correo a quien gana: la versión que promete entrar desde otro celular o compu con un
 * código solo es cierta con el correo confirmado.
 *
 * Está APAGADA a propósito. Se prende a mano, con este valor en `true`, recién cuando la prueba con dos navegadores pase
 * (el enlace real del correo, abierto en el otro navegador, entra con un código) y el servidor de la sala ya acepte la marca.
 * Apagada, el celular no manda nada nuevo ni hace ninguna consulta de más.
 */
export const MARCA_DE_CORREO_ENCENDIDA: boolean = false;
