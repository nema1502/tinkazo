/**
 * Los textos del acceso al modo Oficial con una cuenta de Google o de correo (cupones, paquetes de sorteos y cuánto
 * queda), en español y en inglés. Son los de la sección 8 del diseño del cobro por uso, con tres que se decidieron
 * después: qué hacer con un cupón ya usado (`altaErrUsado`) o con uno del mismo evento (`altaErrLote`), y el QR en la
 * ayuda del campo (`altaCuponAyuda`). `i18n.ts` los suma al diccionario del sitio; mientras la compra de sorteos esté
 * apagada, los que nombran un pago van con su variante sin pago (`alta-textos-sin-pago.ts`).
 *
 * Los textos del pago (las claves `pago…`) están en `alta-textos-pago.ts`. Los que ofrecen un producto
 * (`altaPrimerPaquete`, `cupoOfSumarPaquete`) no llevan ningún precio escrito: `{sorteos}` y `{precio}` se arman con los
 * números de `GET /v1/alta/precios` (`alta-oferta.ts`, `varsDelProducto`).
 *
 * Reglas de escritura (las comprueba `alta-textos.test.ts`): sin signos de exclamación, sin punto medio, sin rayas
 * largas ni flechas; nunca «rifa», «lotería», «raffle», «ticket», «boleto» ni «apuesta» (se dice «sorteo» y «draw»); y
 * nada de USDC, Stellar, exchange ni memo fuera de las claves `pago…`. Para Oficial, en inglés, «Live».
 *
 * Los datos que lleva cada texto van entre llaves: `{codigo}`, `{n}`, `{fecha}`, `{min}`, `{max}`, `{sorteos}` y `{precio}`.
 */
export const TEXTOS_ALTA: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    // La portada y el enlace del cupón.
    altaFranja: "Tenés un cupón de Tinkazo. Entrá con Google o con tu correo para usarlo.",
    altaAbrirAfuera: "Para usar tu cupón, abrí este enlace en Chrome o Safari.",
    altaCopiarEnlace: "Copiar el enlace",
    altaConBilleteraPropia: "Con tu billetera propia no necesitás cupón. Guardalo o pasáselo a alguien.",

    // El acceso, en la primera parte de «Dejá tu cuenta lista».
    altaTexto: "Para sortear en modo Oficial necesitás un cupón o tu primer paquete de sorteos.",
    altaTengoCupon: "Tengo un cupón",
    altaPrimerPaquete: "{sorteos} por {precio}",
    altaPrimerPaqueteNota: "Tu cuenta queda activada sin costo extra.",
    altaNoTengo: "¿No tenés cupón? Pedile uno a quien organiza tu evento, o escribinos a hola@tinkazo.app. En Prueba podés sortear gratis.",
    altaCuponListo: "Tenés un cupón listo para usar: {codigo}.",
    altaActivarConCupon: "Activar con mi cupón",
    altaOtroCupon: "Usar otro cupón",
    altaCuponLabel: "Tu cupón",
    altaCuponAyuda: "Son 12 letras y números. Están en la tarjeta o en el mensaje que te dieron. Si la tarjeta tiene un QR, es más fácil escanearlo con la cámara del celular.",
    altaRevisando: "Revisando tu cupón…",
    altaCuponOk: "Tu cupón trae {n} sorteos oficiales y cubre la activación de tu cuenta.",
    altaCuponOk1: "Tu cupón trae 1 sorteo oficial y cubre la activación de tu cuenta.",
    altaActivarCupon: "Tu cupón cubre la activación. Un toque y listo.",
    altaActivarPago: "Ya pagaste tu primer paquete. Un toque y listo.",
    // Con la compra en el build va solo junto al botón del primer paquete: corto, una sola línea.
    altaYaActivada: "Tu cuenta ya está activada. Para sortear, usá un cupón o sumá sorteos.",
    altaCuponGuardado: "Tu cupón ya quedó en tu cuenta: no lo perdiste. Probá de nuevo.",
    clBajadaConPago: "Primero, tus sorteos oficiales. Después, dos pasos que llevan un minuto.",
    altaErrForma: "Faltan o sobran letras. El cupón tiene 12 letras y números: revisalo en la tarjeta.",
    altaErrNoExiste: "Ese cupón no existe. Revisá las letras y probá de nuevo.",
    altaErrVencido: "Ese cupón venció el {fecha}. Pedile otro a quien te lo dio.",
    altaErrAnulado: "Ese cupón ya no vale. Pedile otro a quien te lo dio.",
    altaErrUsado: "Ese cupón ya se usó. Si lo usaste vos, entrá con la cuenta con la que lo activaste y tus sorteos van a estar ahí. Si no, pedile otro a quien te lo dio.",
    altaErrLote: "Ya usaste un cupón de este evento: va uno por persona. Los sorteos de ese cupón están en esta misma cuenta.",
    altaErrIntentos: "El canje de cupones quedó en pausa por un rato. Probá de nuevo en {min} minutos o pedile ayuda a quien organiza el evento.",
    altaErrServicio: "Ahora no podemos revisar cupones ni pagos. Probá de nuevo en un momento.",

    // El cupo, en Oficial.
    cupoOfQuedan: "Te quedan {n} sorteos oficiales.",
    cupoOfQueda1: "Te queda 1 sorteo oficial.",
    cupoOfVencen: "{n} vencen el {fecha}.",
    cupoOfVencenTodos: "Vencen el {fecha}.",
    cupoOfPocos: "Te quedan {n} sorteos oficiales. Sumá más antes de tu próximo evento.",
    cupoOfUnoPorPremio: "Cada premio que sorteás de a uno usa un sorteo. Si son iguales, poné cuántos ganan y es uno solo.",
    cupoOfDoble: "Con más de 50 ganadores, este sorteo usa 2.",
    cupoOfSumar: "Sumar sorteos",
    cupoOfCeroTitulo: "Se te acabaron los sorteos oficiales",
    // Solo en «Se te acabaron», junto al botón de sumar (sin un paquete a la venta va `cupoOfCeroTextoSinVenta`). Corto:
    // Pasar a Prueba ya está al lado.
    cupoOfCeroTexto: "Tu lista no se selló. Usá un cupón o sumá sorteos para sellarla.",
    cupoOfVencidoTexto: "Tus sorteos oficiales vencieron el {fecha}. Usá un cupón o sumá sorteos. En Prueba seguís gratis.",
    cupoOfSumarPaquete: "Organizá {sorteos} por {precio}",
    cupoOfCeroSumar: "Se te acabaron los sorteos oficiales. Usá un cupón o sumá sorteos.",
    cupoOfUsarCupon: "Usar un cupón",
    cupoOfTopeMes: "Llegaste al tope de {max} sorteos oficiales de este mes. Se libera el {fecha}. Si necesitás más, escribinos a hola@tinkazo.app.",
    // Los dos que dicen un no del portero van donde no hay un botón de comprar (la caja de la red, el error del sorteo,
    // «Siguiente premio»): no ofrecen comprar ni con la compra en el build. El que sí, junto a su botón, es `cupoOfCeroSumar`.
    "errAnchor.porteroSinAlta": "Tu cuenta todavía no tiene acceso al modo Oficial. Activala con el cupón de tu evento.",
    "errAnchor.porteroSinSorteos": "Se te acabaron los sorteos oficiales. Usá otro cupón o seguí gratis en Prueba.",
  },
  en: {
    altaFranja: "You have a Tinkazo coupon. Sign in with Google or email to use it.",
    altaAbrirAfuera: "To use your coupon, open this link in Chrome or Safari.",
    altaCopiarEnlace: "Copy the link",
    altaConBilleteraPropia: "With your own wallet you don't need a coupon. Keep it or pass it on.",

    altaTexto: "To draw in Live mode, you need a coupon or your first pack.",
    altaTengoCupon: "I have a coupon",
    altaPrimerPaquete: "{sorteos} for {precio}",
    altaPrimerPaqueteNota: "Your account gets activated at no extra cost.",
    altaNoTengo: "No coupon? Ask your event's organizer for one, or write to us at hola@tinkazo.app. In Test mode you can draw for free.",
    altaCuponListo: "You have a coupon ready to use: {codigo}.",
    altaActivarConCupon: "Activate with my coupon",
    altaOtroCupon: "Use another coupon",
    altaCuponLabel: "Your coupon",
    altaCuponAyuda: "It's 12 letters and numbers, on the card or in the message you got. If the card has a QR code, scanning it with your phone camera is easier.",
    altaRevisando: "Checking your coupon…",
    altaCuponOk: "Your coupon comes with {n} Live draws and covers activating your account.",
    altaCuponOk1: "Your coupon comes with 1 Live draw and covers activating your account.",
    altaActivarCupon: "Your coupon covers activation. One tap and you're done.",
    altaActivarPago: "You've paid for your first pack. One tap and you're done.",
    altaYaActivada: "Your account is already active. To draw, use a coupon or add draws.",
    altaCuponGuardado: "Your coupon is already on your account, so you haven't lost it. Try again.",
    clBajadaConPago: "First, your Live draws. Then two steps that take a minute.",
    altaErrForma: "Some characters are missing or extra. The coupon has 12 letters and numbers: check it on the card.",
    altaErrNoExiste: "That coupon doesn't exist. Check the letters and try again.",
    altaErrVencido: "That coupon expired on {fecha}. Ask whoever gave it to you for a new one.",
    altaErrAnulado: "That coupon is no longer valid. Ask whoever gave it to you for a new one.",
    altaErrUsado: "That coupon has already been used. If you used it, sign in with the account you activated it with and your draws will be there. If not, ask whoever gave it to you for a new one.",
    altaErrLote: "You've already used a coupon from this event: it's one per person. That coupon's draws are on this same account.",
    altaErrIntentos: "Coupon redemption is paused for a while. Try again in {min} minutes or ask the event organizer for help.",
    altaErrServicio: "We can't check coupons or payments right now. Try again in a moment.",

    cupoOfQuedan: "You have {n} Live draws left.",
    cupoOfQueda1: "You have 1 Live draw left.",
    cupoOfVencen: "{n} expire on {fecha}.",
    cupoOfVencenTodos: "They expire on {fecha}.",
    cupoOfPocos: "You have {n} Live draws left. Add more before your next event.",
    cupoOfUnoPorPremio: "Each prize you draw on its own uses one draw. If the prizes are the same, set how many win and it's just one.",
    cupoOfDoble: "With more than 50 winners, this draw uses 2.",
    cupoOfSumar: "Add draws",
    cupoOfCeroTitulo: "You're out of Live draws",
    cupoOfCeroTexto: "Your list wasn't sealed. Use a coupon or add draws to seal it.",
    cupoOfVencidoTexto: "Your Live draws expired on {fecha}. Use a coupon or add draws. Test mode is still free.",
    cupoOfSumarPaquete: "Run {sorteos} for {precio}",
    cupoOfCeroSumar: "You're out of Live draws. Use a coupon or add draws.",
    cupoOfUsarCupon: "Use a coupon",
    cupoOfTopeMes: "You've reached this month's cap of {max} Live draws. It resets on {fecha}. If you need more, write to us at hola@tinkazo.app.",
    "errAnchor.porteroSinAlta": "Your account doesn't have access to Live mode yet. Activate it with your event's coupon.",
    "errAnchor.porteroSinSorteos": "You're out of Live draws. Use another coupon or keep going for free in Test mode.",
  },
};
