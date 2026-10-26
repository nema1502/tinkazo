import type { Textos } from "./kit";

/**
 * Lo que dice el relator de __NOMBRE__, en los dos idiomas. Viven acá y no en
 * el diccionario del sitio para que el juego viaje solo. Una clave en un idioma
 * y no en el otro la atrapa la prueba del plan (`__ID__-plan.test.ts`).
 *
 * La regla del niño: seis palabras o menos, un nombre por línea y ningún número
 * (los números van en el marcador). El ritmo lo llevan el cuerpo y el sonido.
 *
 * Son borradores del generador: reemplazalos por los del juego. Nada de
 * apuestas ni de palabras de casino, y nada técnico durante el show.
 */
export const TEXTOS = {
  es: {
    intro: "¡Busquen su nombre!",
    tanda: "¡Llega otra tanda!",
    busquen: "¿Ya vieron el suyo?",
    final: "¡La mesa final!",
    suspenso: "La mesa se queda en silencio…",
    ultima: "Solo uno se lleva el premio.",
  },
  en: {
    intro: "Find your name!",
    tanda: "Here comes another group!",
    busquen: "Did you spot yours?",
    final: "The final table!",
    suspenso: "The table goes quiet…",
    ultima: "Only one takes the prize.",
  },
} satisfies Textos;
