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
import { SIN_RESPUESTA } from "../ui/proteger-cuenta";
import type { AccionesDeLaCuenta } from "./celular";
import { SIN_SESION } from "./confirmar-estado";
import { ESPERA_TOKEN_MS } from "./sesion";

/** Lo más que Recibir espera a que la sesión se retome para compararla: con el proveedor lento, sigue sin saber. */
export const TOPE_DE_LA_COMPARACION_MS = 2_500;
/**
 * Pasado ese tope, lo más que se espera a que termine una renovación del token que esté en vuelo. Es el tope de un pedido del
 * proveedor (10 segundos) con un margen: irse de la página en medio deja guardado un token que el servicio ya cambió.
 */
export const TOPE_DE_LA_RENOVACION_MS = 12_000;

/**
 * Si la sesión de este navegador es de `cuenta`. Retoma la sesión guardada (son pedidos al servicio de cuentas: se hace solo
 * al ir a recibir, que es cuando hace falta) y compara. `otra` es la de otra persona en un celular compartido. Sin sesión, con
 * una falla o sin respuesta en 2,5 segundos, `no-se-sabe`. Sin respuesta, antes de contestar espera lo que la sesión tenga a
 * medias, para que la página no se vaya con una renovación del token cortada. No pide el token ni abre ventanas.
 */
export async function laSesionEs(cuenta: string): Promise<"si" | "otra" | "no-se-sabe"> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    const m = await import("../stellar/wallet-pollar");
    const retomada = m.pollarWallet.asegurarLaSesion?.() ?? Promise.resolve(m.pollarWallet.address);
    const tarde = Symbol("tarde");
    const dir = await Promise.race([
      retomada,
      new Promise<typeof tarde>((resolver) => {
        reloj = setTimeout(() => resolver(tarde), TOPE_DE_LA_COMPARACION_MS);
      }),
    ]);
    if (dir === tarde) {
      retomada.catch(() => undefined);
      await m.pollarWallet.esperarLaRetomada?.(TOPE_DE_LA_RENOVACION_MS);
      return "no-se-sabe";
    }
    if (!cuentaValida(dir)) return "no-se-sabe";
    return dir === cuenta ? "si" : "otra";
  } catch {
    return "no-se-sabe";
  } finally {
    clearTimeout(reloj);
  }
}

export async function accionesDeLaCuenta(cuenta: string): Promise<AccionesDeLaCuenta> {
  const m = await import("../stellar/wallet-pollar");
  const billetera = m.pollarWallet;
  /**
   * Sin la sesión de la cuenta de la tarjeta. Es definitivo solo si la sesión es de otra cuenta o si el proveedor ya no tiene
   * ninguna que retomar (la cerró al frenar su renovación, o venció): ahí la tarjeta se va. Si la retomada no terminó a tiempo
   * o la sesión sigue guardada sin verificar (un límite, la red lenta), es pasajero: la tarjeta dice que tarda y se puede
   * repetir, que la sesión se vuelve a pedir en el toque siguiente.
   */
  const sinLaSesion = (): Error => {
    const dir = billetera.address;
    return (cuentaValida(dir) && dir !== cuenta) || billetera.sesionPerdida?.() === true ? new Error(SIN_SESION) : SIN_RESPUESTA;
  };
  const esLaCuenta = (): void => {
    if (billetera.address !== cuenta) throw sinLaSesion();
  };
  /**
   * La página no retoma la sesión del proveedor mientras nadie la use (después de anotarse, o al recargar): al tocar la
   * tarjeta se retoma, una vez, y recién ahí se mira que sea la cuenta de la tarjeta.
   */
  const conLaSesion = async (): Promise<void> => {
    await billetera.asegurarLaSesion?.();
    esLaCuenta();
    // Sin sesión viva no hay nada que esperar: el aviso sale ahora y no a los 20 segundos de esperar un token que no va a
    // llegar. Si el proveedor la cerró, la tarjeta no pide repetir lo que no sirve.
    if (billetera.sesionViva?.() === false) throw sinLaSesion();
  };
  return {
    puedeDesbloqueo: () => m.puedeUsarDesbloqueo(),
    mandarCodigo: async () => {
      await conLaSesion();
      // La sesión verificada y su correo: sin ellas no sale nada.
      if ((await billetera.tokenDeSesion(ESPERA_TOKEN_MS)) === null) throw sinLaSesion();
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
    // Los segundos del límite que vio la billetera: con ellos la tarjeta dice cuánto falta y no inventa una espera.
    segundosDeLimite: () => billetera.segundosDeLimite?.() ?? null,
  };
}
