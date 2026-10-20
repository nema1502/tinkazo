/**
 * Los sorteos de un mismo evento, y la fecha con que se nombran.
 *
 * Funciones puras: sin DOM ni diccionario de textos, para que las pruebas las
 * recorran sin navegador y para que la página de evento las pueda importar sin
 * traerse el diccionario entero.
 */

/** La fecha larga del sello, en el idioma de la página: "20 de octubre de 2026" o "October 20, 2026". */
export function fechaLarga(secs: number, lang: "es" | "en"): string {
  return new Date(secs * 1000).toLocaleDateString(lang === "es" ? "es-BO" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
