import type { Textos } from "./kit";

/**
 * Lo que dice el relator de Bolillas, en los dos idiomas. Viven acá y no en
 * el diccionario del sitio para que el juego viaje solo. Una clave en un idioma
 * y no en el otro la atrapa la prueba del plan (`bolillas-plan.test.ts`).
 *
 * La regla del niño: seis palabras o menos, un nombre por línea y ningún número
 * (los números van en el marcador). Los nombres van pegados a las canicas, como
 * en la carrera de autos: el relator no los repite encima.
 *
 * El juego se llama Bolillas, que es como se dice en Santa Cruz; en los textos
 * se nombra la troya (el círculo de tiza en la tierra), que es la variante que
 * juega: canicas adentro y la pegadora que las saca de a una. Nada de casino
 * ni de palabras de casino, y nada técnico durante el show.
 */
export const TEXTOS = {
  es: {
    intro: "¡Busquen su nombre!",
    canicas: "¡Cada quien saca su canica!",
    tanda: "Los primeros quedan afuera.",
    troya: "¡La troya arranca!",
    fuera: "¡Afuera va una canica!",
    casi: "¡Va a salir… y no sale!",
    ultima: "¡Una sola canica queda!",
  },
  en: {
    intro: "Find your name!",
    canicas: "Each one picks a marble!",
    tanda: "First names sit out.",
    troya: "The troya begins!",
    fuera: "Out goes a marble!",
    casi: "Almost out… and it stays!",
    ultima: "Only one marble stays!",
  },
} satisfies Textos;
