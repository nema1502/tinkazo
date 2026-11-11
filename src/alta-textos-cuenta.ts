/**
 * Los textos del acceso al modo Oficial que la sección 8 del diseño del cobro por uso no trae y el servidor sí necesita,
 * en español y en inglés, con las mismas reglas de escritura que `alta-textos.ts` (las comprueba
 * `alta-textos-cuenta.test.ts`). Van aparte para que `alta-textos.ts` siga siendo la sección 8 tal cual.
 *
 * - `altaErrCuentaDeOtro`: el portero contesta `409 cuenta-de-otro` en el estado y en el canje cuando la cuenta que
 *   Pollar dice que es de la persona no coincide con la que quedó atada a su acceso (o ya está atada al acceso de otra
 *   persona). No lo provoca nadie desde el navegador, porque la cuenta la dice Pollar, y no se arregla probando de nuevo:
 *   hay que revisarlo a mano. El cupón no se gasta.
 * - `altaErrIntentos1`: lo mismo que `altaErrIntentos` cuando la espera es de un minuto, en singular.
 * - `cupoOfVence1` y `cupoOfVenceSolo`: lo mismo que `cupoOfVencen` y `cupoOfVencenTodos` cuando vence un solo sorteo,
 *   en singular («1 vence el 14 de enero», y con uno solo, «Vence el 14 de enero»).
 */
export const TEXTOS_ALTA_CUENTA: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaErrCuentaDeOtro: "No pudimos unir esta cuenta con tu acceso al modo Oficial y tenemos que revisarlo a mano. Escribinos a hola@tinkazo.app y lo arreglamos. En Prueba seguís gratis.",
    altaErrIntentos1: "Probaste muchas veces. Esperá 1 minuto y volvé a intentar.",
    cupoOfVence1: "1 vence el {fecha}.",
    cupoOfVenceSolo: "Vence el {fecha}.",
  },
  en: {
    altaErrCuentaDeOtro: "We couldn't link this account to your Live mode access and need to check it by hand. Write to us at hola@tinkazo.app and we'll fix it. Test mode is still free.",
    altaErrIntentos1: "Too many tries. Wait 1 minute and try again.",
    cupoOfVence1: "1 expires on {fecha}.",
    cupoOfVenceSolo: "It expires on {fecha}.",
  },
};
