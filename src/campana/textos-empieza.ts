/**
 * Los textos de El sorteo está por empezar, en español y en inglés.
 *
 * Es un diccionario propio y no va con los de la página: se baja con `import()` (`empieza.ts`) recién cuando la lista está
 * sellada y la sala dice la ronda, y no pasa por el armado del sitio, que mete en el HTML solo las claves que nombran los
 * archivos de la página. Se lee desde acá, con `TEXTOS_EMPIEZA[idioma][clave]`. El rótulo Sorteo a las {hora} es de la página.
 */

export const TEXTOS_EMPIEZA: { es: Record<string, string>; en: Record<string, string> } = {
  es: {
    ceTitulo: "El sorteo está por empezar",
    ceEmpiezaEn: "Empieza en {t}",
    ceMira: "Mirá la pantalla grande. Acá te contamos cómo salió.",
    ceTarda: "Está tardando un poco. Acá te avisamos.",
  },
  en: {
    ceTitulo: "The draw is about to start",
    ceEmpiezaEn: "Starts in {t}",
    ceMira: "Watch the big screen. We'll tell you here how it went.",
    ceTarda: "It's taking a little while. We'll let you know here.",
  },
};
