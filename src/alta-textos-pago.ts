/**
 * Los textos del pago de un paquete de sorteos oficiales (las claves `pago…`), en español y en inglés. Salen de la
 * sección 8 del diseño del cobro por uso, acortados el 11 de noviembre: quien compra algo nuevo y ve una pantalla llena
 * de texto se va. A la vista va una sola línea por estado, de 14 palabras como mucho, y lo demás va plegado en Más
 * detalles (`pagoMasDetalles`).
 *
 * Suma los que el servidor pide y el diseño no trae: el paquete que no está a la venta (`pagoNoALaVenta`, que vale para
 * el pago apagado, la venta pausada, el piso de créditos y un producto que el servidor no vende), quien ya tiene acceso
 * (`pagoYaTenes`), la orden que no es de esta cuenta (`pagoErrOrden`), mientras se pide la orden (`pagoPreparando`), la
 * nota vencida (`pagoVencida` y `pagoOtraNota`), cómo pagar cuando haya más de un medio (`pagoComoPagar`, y el nombre de
 * cada medio), las piezas con las que se dice un precio y pagar con el saldo de la cuenta (`pagoMedioSaldo`, `pagoSaldo…`,
 * que dicen dólares digitales y nunca el nombre de la moneda).
 *
 * Solo medios automáticos: ningún texto manda a escribir para pagar ni promete un QR del banco, porque eso dependería de
 * que alguien confirme el pago a mano.
 * `i18n.ts` los suma al diccionario; con la compra de sorteos apagada (`altaPagoActivo()`) no se muestra ninguno.
 *
 * Reglas de escritura (las comprueban `alta-textos-pago.test.ts` y `ui/pago-poco-texto.test.ts`): las mismas de
 * `alta-textos.ts`, sin comillas angulares ni punto y coma, y además: nunca «token», «hash», «transacción» ni
 * «blockchain»; y USDC, Stellar, exchange y memo solo en los renglones que dicen en qué se paga, nunca en un botón.
 *
 * Los datos que lleva cada texto van entre llaves.
 */
export const TEXTOS_ALTA_PAGO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    pagoNoALaVenta: "Este paquete no se vende ahora. Lo que ya compraste sigue siendo tuyo.",
    pagoYaTenes: "Tu cuenta ya tiene acceso al modo Oficial: no hace falta este paquete.",
    pagoErrOrden: "No encontramos esa compra en esta cuenta. Si ya pagaste, escribinos a hola@tinkazo.app.",
    pagoErrRed: "No pudimos buscar tu pago ahora. Probá de nuevo en un momento.",

    // Las piezas del precio de un producto, para `{sorteos}` y `{precio}` (`alta-oferta.ts`, `varsDelProducto`).
    pagoSorteosN: "{n} sorteos oficiales",
    pagoSorteo1: "1 sorteo oficial",
    pagoDolares: "{usdc} dólares",
    pagoUnDolar: "1 dólar",

    // Antes de la orden: cómo pagar, solo si hay más de un medio (hoy hay uno y no se pregunta).
    pagoComoPagar: "¿Cómo querés pagar?",
    pagoMedioApp: "Desde una app de pagos",
    pagoPreparando: "Preparando tu pago…",

    // Pagando: el título, la única línea de ayuda (la única vez que se dice en qué se paga) y los datos de la orden.
    pagoTitulo: "Tu primer paquete",
    pagoComo: "Mandá el monto en USDC por Stellar, con esta nota.",
    pagoCuenta: "Cuenta",
    pagoMonto: "Monto",
    pagoNota: "Nota (memo), obligatoria",
    pagoCopiar: "Copiar",
    pagoCopiado: "Copiado",
    pagoQrAlt: "Código QR para pagar desde tu app",
    pagoQrAyuda: "Escaneá con tu app de pagos",
    pagoAbrirApp: "Abrir en mi app de pagos",
    // Plegado en Más detalles.
    pagoMasDetalles: "Más detalles",
    pagoParaCuenta: "Este pago es para la cuenta {correo}.",
    pagoSirve: "Sirve cualquier app o exchange que tenga USDC en Stellar.",
    pagoNotaImporta: "Sin la nota no sabemos que el pago es tuyo.",
    pagoVence: "Esta nota vale hasta el {fecha}.",
    pagoDeMas: "Si mandaste de más, escribinos y te lo devolvemos.",
    // Lo que pasó con el pago: una sola línea a la vez.
    pagoYaPague: "Ya pagué",
    pagoBuscando: "Buscando tu pago…",
    pagoNoLlego: "Todavía no vemos tu pago. Suele tardar menos de un minuto.",
    pagoTarda: "Algunas apps tardan más. Podés cerrar y volver a entrar más tarde.",
    pagoNoLlegoBoton: "No llegó",
    pagoRedEquivocada: "Si no lo mandaste por Stellar, no va a llegar. Escribinos a hola@tinkazo.app.",
    pagoFalta: "Llegaron {recibido} de {total} USDC. Mandá lo que falta con la misma nota.",
    pagoListo: "Recibimos tu pago.",
    pagoListoQuedan: "Recibimos tu pago. Te quedan {n} sorteos oficiales.",
    pagoListoQueda1: "Recibimos tu pago. Te queda 1 sorteo oficial.",
    pagoVencida: "Esta nota venció el {fecha}. Pedí una nueva antes de pagar.",
    pagoOtraNota: "Pedir una nota nueva",

    // Pagar con el saldo de la cuenta (`ui/pago-saldo.ts`): el medio, cómo se pregunta, la confirmación y cada falla.
    pagoMedioSaldo: "Pagar con mi saldo",
    pagoSaldoTenes: "Tenés {saldo} dólares digitales en tu cuenta.",
    pagoSaldoTenesUno: "Tenés 1 dólar digital en tu cuenta.",
    pagoSaldoConfirmar: "Vas a pagar {precio} a Tinkazo por {sorteos}.",
    pagoSaldoPagar: "Pagar {precio}",
    pagoSaldoPagando: "Pagando…",
    pagoSaldoOtroMedio: "Pagar desde una app de pagos",
    pagoSaldoSalio: "Tu pago salió. Estamos viendo que llegue.",
    pagoSaldoIncierto: "No sabemos si salió tu pago. Lo estamos buscando.",
    pagoSaldoBuscar: "Buscar mi pago",
    pagoSaldoNoAlcanza: "Tu saldo no alcanza. Tenés {tiene} y faltan {falta}.",
    pagoSaldoCancelado: "No se hizo el pago. Tus dólares digitales siguen en tu cuenta.",
    pagoSaldoNoSalio: "No se pudo pagar. Tus dólares digitales siguen en tu cuenta.",
    pagoSaldoSinLinea: "Tu cuenta todavía no tiene activados los dólares digitales.",
    pagoSaldoRaro: "No coincidía con tu orden y no se hizo. Tu saldo sigue igual.",
    pagoSaldoSinPatrocinio: "Ahora no podemos pagar desde tu saldo. Probá desde una app de pagos.",
    pagoSaldoDestino: "Ahora no podemos recibir pagos. Tus dólares digitales siguen en tu cuenta.",
    // El renglón de datos del panel cuando hay saldo y no alcanza.
    pagoSaldoEt: "Con tu saldo",
    pagoSaldoCorto: "Tenés {tiene} dólares digitales, faltan {falta}",
    pagoSaldoCortoUno: "Tenés 1 dólar digital, faltan {falta}",
  },
  en: {
    pagoNoALaVenta: "This pack isn't on sale right now. What you already bought is still yours.",
    pagoYaTenes: "Your account already has access to Live mode, so you don't need this pack.",
    pagoErrOrden: "That purchase isn't on this account. If you already paid, email hola@tinkazo.app.",
    pagoErrRed: "We couldn't look for your payment right now. Try again in a moment.",

    pagoSorteosN: "{n} Live draws",
    pagoSorteo1: "1 Live draw",
    pagoDolares: "US${usdc}",
    pagoUnDolar: "US$1",

    pagoComoPagar: "How do you want to pay?",
    pagoMedioApp: "From a payments app",
    pagoPreparando: "Getting your payment ready…",

    pagoTitulo: "Your first pack",
    pagoComo: "Send the amount in USDC on Stellar, with this memo.",
    pagoCuenta: "Account",
    pagoMonto: "Amount",
    pagoNota: "Memo (required)",
    pagoCopiar: "Copy",
    pagoCopiado: "Copied",
    pagoQrAlt: "QR code to pay from your app",
    pagoQrAyuda: "Scan it with your payments app",
    pagoAbrirApp: "Open in my payments app",
    pagoMasDetalles: "More details",
    pagoParaCuenta: "This payment is for the account {correo}.",
    pagoSirve: "Any app or exchange that holds USDC on Stellar works.",
    pagoNotaImporta: "Without the memo we can't tell the payment is yours.",
    pagoVence: "This memo is valid until {fecha}.",
    pagoDeMas: "If you sent too much, write to us and we'll send it back.",
    pagoYaPague: "I've paid",
    pagoBuscando: "Looking for your payment…",
    pagoNoLlego: "We don't see your payment yet. It usually takes under a minute.",
    pagoTarda: "Some apps take longer. You can close this and come back later.",
    pagoNoLlegoBoton: "It didn't arrive",
    pagoRedEquivocada: "If you didn't send it on Stellar, it won't arrive. Email us at hola@tinkazo.app.",
    pagoFalta: "{recibido} of {total} USDC arrived. Send the rest with the same memo.",
    pagoListo: "We got your payment.",
    pagoListoQuedan: "We got your payment. You have {n} Live draws left.",
    pagoListoQueda1: "We got your payment. You have 1 Live draw left.",
    pagoVencida: "This memo expired on {fecha}. Get a new one before you pay.",
    pagoOtraNota: "Get a new one",

    pagoMedioSaldo: "Pay with my balance",
    pagoSaldoTenes: "You have {saldo} digital dollars in your account.",
    pagoSaldoTenesUno: "You have 1 digital dollar in your account.",
    pagoSaldoConfirmar: "You're paying {precio} to Tinkazo for {sorteos}.",
    pagoSaldoPagar: "Pay {precio}",
    pagoSaldoPagando: "Paying…",
    pagoSaldoOtroMedio: "Pay from a payments app",
    pagoSaldoSalio: "Your payment went out. We're checking that it arrives.",
    pagoSaldoIncierto: "We don't know if your payment went out. We're looking for it.",
    pagoSaldoBuscar: "Look for my payment",
    pagoSaldoNoAlcanza: "Your balance isn't enough. You have {tiene} and need {falta} more.",
    pagoSaldoCancelado: "The payment wasn't made. Your digital dollars are still in your account.",
    pagoSaldoNoSalio: "The payment didn't go through. Your digital dollars are still in your account.",
    pagoSaldoSinLinea: "Your account doesn't have digital dollars turned on yet.",
    pagoSaldoRaro: "It didn't match your order, so it wasn't made. Your balance is unchanged.",
    pagoSaldoSinPatrocinio: "We can't pay from your balance right now. Try a payments app.",
    pagoSaldoDestino: "We can't receive payments right now. Your digital dollars are still in your account.",
    pagoSaldoEt: "With your balance",
    pagoSaldoCorto: "You have {tiene} digital dollars, {falta} short",
    pagoSaldoCortoUno: "You have 1 digital dollar, {falta} short",
  },
};
