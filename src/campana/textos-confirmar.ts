/**
 * Los textos de la tarjeta Confirmar mi correo, en español y en inglés.
 *
 * Es un diccionario propio y no va con los de la página: la tarjeta se baja con `import()` solo cuando la cuenta lo
 * necesita, y sus textos con ella. No pasa por el armado del sitio (que mete en el HTML solo las claves que nombran los
 * archivos de la página): se lee desde acá, con `TEXTOS_CONFIRMAR[idioma][clave]`. Donde el sitio ya tenía la frase
 * (`src/i18n.ts`, Dejá tu cuenta lista) se copió su redacción: la página del celular no puede importar ese diccionario.
 *
 * Las frases que prometen entrar desde otro celular o compu (`ccLinea`, `ccDesbloqueoListo` y `ccConfirmado`) tienen su
 * versión que solo dice lo que se sabe (`ccLineaSolo`, `ccDesbloqueoListoSolo` y `ccConfirmadoSolo`): `PROMESA_VERIFICADA`,
 * en `confirmar-estado.ts`, decide cuál se ve, y mientras esté apagada no sale ninguna de las que prometen.
 */

export const TEXTOS_CONFIRMAR: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    ccLinea: "Confirmá tu correo: así recibís el premio desde cualquier celular o compu.",
    ccLineaSolo: "Confirmá tu correo para dejar tu cuenta lista.",
    ccConfirmar: "Confirmar mi correo",
    ccDesbloqueo: "Usar el desbloqueo del celular",
    ccDesbloqueoAyuda: "Es tu huella, tu cara o tu clave del celular. Tinkazo no la ve.",
    ccEsperandoDesbloqueo: "Esperando tu huella o tu clave. Si no aparece nada, probá con el correo.",
    ccDesbloqueoBloqueado: "Acá no se puede usar el desbloqueo. Usá el código del correo.",
    ccDesbloqueoListo: "Listo en este celular. Para entrar desde otro, confirmá tu correo.",
    ccDesbloqueoListoSolo: "Listo en este celular. Falta confirmar tu correo.",
    ccMandando: "Mandando el código…",
    ccCodigoT: "Mirá tu correo",
    ccCodigoLinea: "Te mandamos un código a {mail}.",
    ccCodigoCampo: "Código de letras y números",
    ccCodigoConfirmar: "Confirmar",
    ccConfirmando: "Confirmando…",
    ccSpam: "¿No llegó? Mirá en Spam. Puede venir en inglés y con otro nombre.",
    ccOtroCodigoEn: "Otro código en {s} segundos",
    ccOtroCodigo: "Mandar otro código",
    ccUsaElUltimo: "Usá el código del correo más nuevo.",
    ccCodigoMalo: "Ese código no sirve. Revisalo o pedí otro.",
    ccCodigoVencido: "Ese código venció. Pedí otro.",
    ccCodigoViejo: "Ese código ya no sirve. Pedí otro.",
    ccCodigoRecargado: "La página se recargó y ese código ya no sirve. Pedí otro.",
    ccTarda: "Está tardando más de lo normal. Probá de nuevo.",
    ccFalla: "No pudimos mandar el código. Probá de nuevo en un momento.",
    ccNoQuedo: "Todavía no quedó confirmado. Probá de nuevo.",
    ccMuchos: "Pediste muchos códigos. Probá en unos minutos.",
    ccConfirmado: "Listo. Ya podés entrar desde cualquier celular o compu.",
    ccConfirmadoSolo: "Listo. Tu correo quedó confirmado.",
  },
  en: {
    ccLinea: "Confirm your email so you can get the prize on any phone or computer.",
    ccLineaSolo: "Confirm your email to get your account ready.",
    ccConfirmar: "Confirm my email",
    ccDesbloqueo: "Use your phone unlock",
    ccDesbloqueoAyuda: "It's your fingerprint, face or phone passcode. Tinkazo never sees it.",
    ccEsperandoDesbloqueo: "Waiting for your fingerprint or passcode. If nothing shows up, try the email.",
    ccDesbloqueoBloqueado: "Unlock can't be used here. Use the email code.",
    ccDesbloqueoListo: "Done on this phone. To sign in from another one, confirm your email.",
    ccDesbloqueoListoSolo: "Done on this phone. Your email still needs confirming.",
    ccMandando: "Sending the code…",
    ccCodigoT: "Check your email",
    ccCodigoLinea: "We sent a code to {mail}.",
    ccCodigoCampo: "Code with letters and numbers",
    ccCodigoConfirmar: "Confirm",
    ccConfirmando: "Confirming…",
    ccSpam: "Not there? Check Spam. It may come from a different name.",
    ccOtroCodigoEn: "Another code in {s} seconds",
    ccOtroCodigo: "Send another code",
    ccUsaElUltimo: "Use the code from the newest email.",
    ccCodigoMalo: "That code doesn't work. Check it or ask for another.",
    ccCodigoVencido: "That code expired. Ask for another.",
    ccCodigoViejo: "That code no longer works. Ask for another.",
    ccCodigoRecargado: "The page reloaded and that code no longer works. Ask for another.",
    ccTarda: "This is taking longer than usual. Try again.",
    ccFalla: "We couldn't send the code. Try again in a moment.",
    ccNoQuedo: "It isn't confirmed yet. Try again.",
    ccMuchos: "You asked for a lot of codes. Try again in a few minutes.",
    ccConfirmado: "Done. You can now sign in from any phone or computer.",
    ccConfirmadoSolo: "Done. Your email is confirmed.",
  },
};
