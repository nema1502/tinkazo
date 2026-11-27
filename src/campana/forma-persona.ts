/**
 * La forma de una línea de persona, sin ninguna importación. El sitio solo necesita reconocerla (para no mostrarla nunca tal
 * cual y para saber de qué forma es una lista), y la sala, que la calcula, trae la librería de firmas. Importar la sala desde
 * las páginas habría metido esa librería en el paquete principal, así que el reconocimiento vive acá, en un archivo que no
 * importa nada.
 *
 * Es la misma expresión que usa `esLineaDePersona` de la sala (`workers/sala/src/linea-persona.ts`) y una prueba exige que
 * den lo mismo sobre los vectores de `docs/vectors-persona.json` y sobre lo que no es una línea. Si cambia la forma, cambia
 * en los dos archivos.
 */

export const PREFIJO_DE_PERSONA = "p1:";

/**
 * Prefijo, 25 letras de base32 en minúsculas y una letra de cierre que termina en dos bits en cero: 16 bytes son 128 bits y
 * 26 letras son 130, así que solo ocho letras dan una línea canónica.
 */
const ES_LINEA_DE_PERSONA = /^p1:[a-z2-7]{25}[aeimquy4]$/;

/** Si el texto tiene la forma de una línea de persona. No dice de quién es ni si está en alguna lista. */
export function esLineaDePersona(texto: unknown): texto is string {
  return typeof texto === "string" && ES_LINEA_DE_PERSONA.test(texto);
}
