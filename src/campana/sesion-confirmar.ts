/**
 * Lo que la tarjeta Confirmar mi correo le pide a la sesión de Google. Se baja junto con la tarjeta y no antes: la página
 * del celular no carga nada de esto si la cuenta no lo necesita.
 *
 * Reglas que se cumplen acá:
 *  - El código se manda SOLO al correo del perfil de la sesión, y recién con la sesión verificada por el proveedor. Ninguna
 *    de estas funciones recibe un correo: no hay forma de mandarlo a otro.
 *  - Todo es de la cuenta que se pidió. Si la sesión cambió de cuenta mientras tanto (otra pestaña), no se hace nada.
 *  - Solo se confirma el correo y se usa el desbloqueo de este navegador. Nunca se pide una firma ni se suma otro aparato.
 */

import { cuentaValida } from "../sala/campana";
import type { LecturaDelCelular } from "../stellar/wallet-pollar";
import type { AccionesDeLaCuenta } from "./celular";
import { SIN_SESION } from "./confirmar-estado";
import { ESPERA_TOKEN_MS } from "./sesion";

/**
 * Si la sesión de este navegador es de `cuenta`. Retoma la sesión guardada (son pedidos al servicio de cuentas: se hace solo
 * al ir a recibir, que es cuando hace falta) y compara. `otra` es la de otra persona en un celular compartido. Sin sesión, o con
 * una falla, `no-se-sabe`. No pide el token ni abre ventanas.
 */
export async function laSesionEs(cuenta: string): Promise<"si" | "otra" | "no-se-sabe"> {
  try {
    const m = await import("../stellar/wallet-pollar");
    const dir = await m.pollarWallet.asegurarLaSesion?.();
    if (!cuentaValida(dir)) return "no-se-sabe";
    return dir === cuenta ? "si" : "otra";
  } catch {
    return "no-se-sabe";
  }
}

export async function accionesDeLaCuenta(cuenta: string): Promise<AccionesDeLaCuenta> {
  const m = await import("../stellar/wallet-pollar");
  const billetera = m.pollarWallet;
  const esLaCuenta = (): void => {
    if (billetera.address !== cuenta) throw new Error(SIN_SESION);
  };
  /**
   * La página no retoma la sesión del proveedor mientras nadie la use (después de anotarse, o al recargar): al tocar la
   * tarjeta se retoma, una vez, y recién ahí se mira que sea la cuenta de la tarjeta.
   */
  const conLaSesion = async (): Promise<void> => {
    await billetera.asegurarLaSesion?.();
    esLaCuenta();
    // El kit cierra la sesión si el servicio de cuentas frena su renovación. Sin sesión viva no hay nada que esperar: el aviso
    // sale ahora y no a los 20 segundos de esperar un token que no va a llegar, y la tarjeta no pide repetir lo que no sirve.
    if (billetera.sesionViva?.() === false) throw new Error(SIN_SESION);
  };
  return {
    puedeDesbloqueo: () => m.puedeUsarDesbloqueo(),
    mandarCodigo: async () => {
      await conLaSesion();
      // La sesión verificada y su correo: sin ellas no sale nada.
      if ((await billetera.tokenDeSesion(ESPERA_TOKEN_MS)) === null) throw new Error(SIN_SESION);
      esLaCuenta();
      const correo = billetera.profile()?.mail ?? "";
      if (correo === "") throw new Error("sin-correo");
      await billetera.mandarCodigoDeProteccion(correo);
    },
    confirmarCodigo: async (codigo): Promise<LecturaDelCelular> => {
      await conLaSesion();
      return billetera.confirmarCorreoDelCelular(codigo);
    },
    usarDesbloqueo: async () => {
      await conLaSesion();
      return billetera.protegerConPasskey();
    },
    // Oír los cambios no retoma la sesión: la tarjeta puede estar a la vista sin que se haya pedido nada al proveedor. El aviso
    // lleva su origen (el canal, el kit o la vista) para que la página no lea de más por una vuelta a la pestaña.
    alCambiar: (aviso) => billetera.alCambiarLaCuenta(aviso, { armar: false }),
  };
}
