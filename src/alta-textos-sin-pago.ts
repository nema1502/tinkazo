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
  },
  en: {
    altaTexto: "To draw in Live mode, activate your account with your event's coupon.",
    altaYaActivada: "Your account is already active. To draw in Live mode, use your event's coupon.",
    altaErrServicio: "We can't check coupons right now. Try again in a moment.",
    cupoOfCeroTexto: "Your list wasn't sealed. To seal in Live mode, use another coupon. Test mode is still free.",
    cupoOfVencidoTexto: "Your Live draws expired on {fecha}. Use another coupon or keep going for free in Test mode.",
  },
};

/**
 * Las de la caja del acceso y la de «Se te acabaron», con nombre propio y siempre en el diccionario: con la compra en el
 * build, la pantalla las pide cuando el servidor no vende nada ahora (o con un cupón en mano, en la caja), para no
 * nombrar un paquete sin su botón (`cuenta-lista-estado.ts`, `ui/sin-sorteos.ts`). Son las mismas de arriba.
 */
export const TEXTOS_ALTA_SIN_VENTA: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    altaTextoSinVenta: TEXTOS_ALTA_SIN_PAGO.es.altaTexto as string,
    altaYaActivadaSinVenta: TEXTOS_ALTA_SIN_PAGO.es.altaYaActivada as string,
    cupoOfCeroTextoSinVenta: TEXTOS_ALTA_SIN_PAGO.es.cupoOfCeroTexto as string,
  },
  en: {
    altaTextoSinVenta: TEXTOS_ALTA_SIN_PAGO.en.altaTexto as string,
    altaYaActivadaSinVenta: TEXTOS_ALTA_SIN_PAGO.en.altaYaActivada as string,
    cupoOfCeroTextoSinVenta: TEXTOS_ALTA_SIN_PAGO.en.cupoOfCeroTexto as string,
  },
};
