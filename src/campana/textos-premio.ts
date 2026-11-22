/**
 * Los textos de Ganaste según cómo está la cuenta de este navegador, en español y en inglés.
 *
 * Es un diccionario propio y no va con los de la página: se baja con `import()` (`premio.ts`) recién cuando alguien llega a
 * Ganaste, y casi todos ven la línea de siempre. No pasa por el armado del sitio, que mete en el HTML solo las claves que
 * nombran los archivos de la página: se lee desde acá, con `TEXTOS_PREMIO[idioma][clave]`.
 */

export const TEXTOS_PREMIO: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    cgListo: "Para recibirlo, dejá tu cuenta lista.",
    cgOtro: "Para recibirlo, te mandamos un código a tu correo.",
    cgDesbloqueo: "Para recibirlo, usá el desbloqueo de tu celular.",
    cgAlla: "Probá recibirlo en el otro navegador donde usaste esta cuenta.",
    cgMandarme: "Mandarme el enlace",
  },
  en: {
    cgListo: "To receive it, get your account ready.",
    cgOtro: "To receive it, we'll email you a code.",
    cgDesbloqueo: "To receive it, use your phone unlock.",
    cgAlla: "Try getting it in the other browser where you used this account.",
    cgMandarme: "Send me the link",
  },
};
