/**
 * Los textos del acceso al modo Oficial con una cuenta de Google o de correo (cupones, paquetes de sorteos y cuánto
 * queda), en español y en inglés. `i18n.ts` los suma al diccionario del sitio; mientras la compra de sorteos esté
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
    altaTexto: "Usá un cupón o comprá tu primer paquete.",
    altaTengoCupon: "Tengo un cupón",
    altaPrimerPaquete: "{sorteos} por {precio}",
    altaPrimerPaqueteNota: "Tu cuenta queda activada sin costo extra.",
    altaNoTengoResumen: "¿No tenés cupón?",
    altaNoTengo: "Pedile uno a quien organiza tu evento, o escribinos a hola@tinkazo.app.",
    altaCuponListo: "Tenés un cupón listo para usar: {codigo}.",
    altaActivarConCupon: "Activar con mi cupón",
    altaOtroCupon: "Usar otro cupón",
    altaCuponLabel: "Tu cupón",
    altaCuponAyuda: "Son 12 letras y números, en tu tarjeta o mensaje. Si hay QR, escanealo.",
    altaRevisando: "Revisando tu cupón…",
    altaCuponOk: "Tu cupón trae {n} sorteos oficiales.",
    altaCuponOk1: "Tu cupón trae 1 sorteo oficial.",
    altaActivarCupon: "Tu cupón cubre la activación. Un toque y listo.",
    altaActivarPago: "Ya pagaste tu primer paquete. Un toque y listo.",
    // Con la compra en el build va solo junto al botón del primer paquete: corto, una sola línea.
    altaYaActivada: "Usá un cupón o sumá sorteos.",
    altaCuponGuardado: "Tu cupón quedó en tu cuenta, probá de nuevo.",
    altaErrForma: "El cupón tiene 12 letras y números, revisalo en tu tarjeta.",
    altaErrNoExiste: "Ese cupón no existe, revisá las letras y probá de nuevo.",
    altaErrVencido: "Ese cupón venció el {fecha}, pedile otro a quien te lo dio.",
    altaErrAnulado: "Ese cupón ya no vale, pedile otro a quien te lo dio.",
    altaErrUsado: "Ese cupón ya se usó, entrá con la cuenta que lo usó o pedí otro.",
    altaErrLote: "Ya usaste un cupón de este evento, y sus sorteos están en esta cuenta.",
    altaErrIntentos: "Hay una pausa con los cupones, probá de nuevo en {min} minutos.",
    altaErrServicio: "Ahora no podemos revisar cupones ni pagos, probá de nuevo en un momento.",

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
    // Sortear en Prueba ya está al lado.
    cupoOfCeroTexto: "Sumá más para que este cuente. En Prueba no cuenta.",
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

    altaTexto: "Use a coupon or buy your first pack.",
    altaTengoCupon: "I have a coupon",
    altaPrimerPaquete: "{sorteos} for {precio}",
    altaPrimerPaqueteNota: "Your account gets activated at no extra cost.",
    altaNoTengoResumen: "No coupon?",
    altaNoTengo: "Ask your event's organizer for one, or write to us at hola@tinkazo.app.",
    altaCuponListo: "You have a coupon ready to use: {codigo}.",
    altaActivarConCupon: "Activate with my coupon",
    altaOtroCupon: "Use another coupon",
    altaCuponLabel: "Your coupon",
    altaCuponAyuda: "It's 12 letters and numbers, on your card or message. Got a QR? Scan it.",
    altaRevisando: "Checking your coupon…",
    altaCuponOk: "Your coupon comes with {n} Live draws.",
    altaCuponOk1: "Your coupon comes with 1 Live draw.",
    altaActivarCupon: "Your coupon covers activation. One tap and you're done.",
    altaActivarPago: "Your first pack is paid. One tap and done.",
    altaYaActivada: "Use a coupon or add draws.",
    altaCuponGuardado: "Your coupon is on your account, try again.",
    altaErrForma: "The coupon has 12 letters and numbers, check it on your card.",
    altaErrNoExiste: "That coupon doesn't exist, check the letters and try again.",
    altaErrVencido: "That coupon expired on {fecha}, ask whoever gave it to you for a new one.",
    altaErrAnulado: "That coupon is no longer valid, ask whoever gave it to you for a new one.",
    altaErrUsado: "That coupon was already used, sign in with the account that used it or get another.",
    altaErrLote: "You already used a coupon from this event, and its draws are on this account.",
    altaErrIntentos: "Coupons are paused for now, try again in {min} minutes.",
    altaErrServicio: "We can't check coupons or payments right now, try again in a moment.",

    cupoOfQuedan: "You have {n} Live draws left.",
    cupoOfQueda1: "You have 1 Live draw left.",
    cupoOfVencen: "{n} expire on {fecha}.",
    cupoOfVencenTodos: "They expire on {fecha}.",
    cupoOfPocos: "You have {n} Live draws left. Add more before your next event.",
    cupoOfUnoPorPremio: "Each prize you draw on its own uses one draw. If the prizes are the same, set how many win and it's just one.",
    cupoOfDoble: "With more than 50 winners, this draw uses 2.",
    cupoOfSumar: "Add draws",
    cupoOfCeroTitulo: "You're out of Live draws",
    cupoOfCeroTexto: "Add more so this one counts. In Test it doesn't count.",
    cupoOfVencidoTexto: "Your Live draws expired on {fecha}. Use a coupon or add draws. Test mode is still free.",
    cupoOfSumarPaquete: "Run {sorteos} for {precio}",
    cupoOfCeroSumar: "You're out of Live draws. Use a coupon or add draws.",
    cupoOfUsarCupon: "Use a coupon",
    cupoOfTopeMes: "You've reached this month's cap of {max} Live draws. It resets on {fecha}. If you need more, write to us at hola@tinkazo.app.",
    "errAnchor.porteroSinAlta": "Your account doesn't have access to Live mode yet. Activate it with your event's coupon.",
    "errAnchor.porteroSinSorteos": "You're out of Live draws. Use another coupon or keep going for free in Test mode.",
  },
};
