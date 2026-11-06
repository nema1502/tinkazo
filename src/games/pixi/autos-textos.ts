import type { Textos } from "./kit";

/**
 * Lo que dice el relator de Carrera de autos, en los dos idiomas. Viven acá y no en
 * el diccionario del sitio para que el juego viaje solo. Una clave en un idioma
 * y no en el otro la atrapa la prueba del plan (`autos-plan.test.ts`).
 *
 * La regla del niño: seis palabras o menos, ningún nombre (los nombres van sobre
 * los autos) y ningún número (los números van en el marcador). El ritmo lo llevan
 * el cuerpo y el sonido. Nada de apuestas ni de choques entre personas: los autos
 * caen en un hoyo o quedan bajo una roca.
 */
export const TEXTOS = {
  es: {
    intro: "¡A sus autos!",
    motores: "¡Rugen los motores!",
    largaron: "¡Largaron!",
    fondo: "¡Pisen a fondo!",
    hoyo: "¡Se abre un hoyo!",
    roca: "¡Cae una roca gigante!",
    queda: "Uno se queda en el camino.",
    esquiven: "¡Roca! ¡Esquiven!",
    recta: "¡Recta final!",
    meta: "¡La meta está ahí!",
  },
  en: {
    intro: "To your cars!",
    motores: "Engines roaring!",
    largaron: "They're off!",
    fondo: "Pedal to the metal!",
    hoyo: "A hole opens up!",
    roca: "A giant rock falls!",
    queda: "One stays behind on the road.",
    esquiven: "Rock! Dodge it!",
    recta: "Final stretch!",
    meta: "The finish line is there!",
  },
} satisfies Textos;
