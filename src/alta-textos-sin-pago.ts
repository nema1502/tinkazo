/**
 * Las variantes sin pago de los textos de la sección 8 del diseño del cobro por uso que nombran un paquete, un pago o
 * «sumar sorteos». Mientras la compra de sorteos esté apagada (`altaPagoActivo()`, `alta-config.ts`), no hay dónde
 * comprar: `i18n.ts` pone estas encima de las de `alta-textos.ts`, igual que `clBajada` va en lugar de
 * `clBajadaConPago`. Con el pago prendido, las de la sección 8 tal cual.
 *
 * Las mismas reglas de escritura que `alta-textos.ts`, y además ninguna ofrece comprar (las comprueba
 * `alta-textos-sin-pago.test.ts`). Cada una lleva los mismos datos entre llaves que su versión con pago.
 */
export const TEXTOS_ALTA_SIN_PAGO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaTexto: "Para sortear en modo Oficial, activá tu cuenta con el cupón de tu evento.",
    altaYaActivada: "Tu cuenta ya está activada. Para sortear en modo Oficial, usá el cupón de tu evento.",
    altaErrServicio: "Ahora no podemos revisar cupones. Probá de nuevo en un momento.",
    cupoOfCeroTexto: "Tu lista no se selló. Para sellar en modo Oficial, usá otro cupón. En Prueba seguís gratis.",
    cupoOfVencidoTexto: "Tus sorteos oficiales vencieron el {fecha}. Usá otro cupón o seguí gratis en Prueba.",
    "errAnchor.porteroSinAlta": "Tu cuenta todavía no tiene acceso al modo Oficial. Activala con el cupón de tu evento.",
    "errAnchor.porteroSinSorteos": "Se te acabaron los sorteos oficiales. Usá otro cupón o seguí gratis en Prueba.",
  },
  en: {
    altaTexto: "To draw in Live mode, activate your account with your event's coupon.",
    altaYaActivada: "Your account is already active. To draw in Live mode, use your event's coupon.",
    altaErrServicio: "We can't check coupons right now. Try again in a moment.",
    cupoOfCeroTexto: "Your list wasn't sealed. To seal in Live mode, use another coupon. Test mode is still free.",
    cupoOfVencidoTexto: "Your Live draws expired on {fecha}. Use another coupon or keep going for free in Test mode.",
    "errAnchor.porteroSinAlta": "Your account doesn't have access to Live mode yet. Activate it with your event's coupon.",
    "errAnchor.porteroSinSorteos": "You're out of Live draws. Use another coupon or keep going for free in Test mode.",
  },
};
