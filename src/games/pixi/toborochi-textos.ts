import type { Textos } from "./kit";

/**
 * Lo que dice el relator de El Toborochi, en los dos idiomas. Viven acá y no en
 * el diccionario del sitio para que el juego viaje solo. Una clave en un idioma
 * y no en el otro la atrapa la prueba del plan (`toborochi-plan.test.ts`).
 *
 * La regla del niño: seis palabras o menos, un nombre por línea y ningún número
 * (los números van en el marcador). El ritmo lo llevan el cuerpo y el sonido.
 *
 * En pantalla, «surazo» (en inglés, «the south wind»). Solo exclamaciones y nunca
 * eliminado, perdió, suerte ni el nombre de la leyenda: la leyenda no se cuenta
 * durante el show, va en la tarjeta de después.
 */
export const TEXTOS = {
  es: {
    marcadorQuedan: "EN EL ÁRBOL",
    intro: "¡Florece el toborochi!",
    busquen: "¡Busquen su flor!",
    ya: "¿Ya viste la tuya?",
    cada: "¡Cada flor, un nombre!",
    ahiVa: "¡Ahí va el viento!",
    sopla: "¡Sopla el surazo!",
    soplaOtra: "¡Otra vez el surazo!",
    aguanta: "¡Aguantá tu flor!",
    asoma: "¡Se asoma un colibrí!",
    paso: "¡Pasó la ráfaga!",
    conPremio: (n: string) => `¡Se va ${n}, con premio!`,
    hilo: (n: string) => `¡${n} cuelga de un hilo!`,
    engancha: (n: string) => `¡${n} se agarró más abajo!`,
    quedanDos: "¡Quedan las dos últimas!",
    colibri: "¡Llega el colibrí!",
    visita: (n: string) => `¿Será ${n}?`,
    visitaSin: "¿Será esta flor?",
    visitaOtra: "¿O será la otra?",
    ultima: "Una sola se lleva el premio.",
    ultimaDos: "Las dos se llevan premio.",
  },
  en: {
    marcadorQuedan: "ON THE TREE",
    intro: "The toborochi blooms!",
    busquen: "Find your flower!",
    ya: "Did you spot yours?",
    cada: "Every flower, a name!",
    ahiVa: "Here comes the wind!",
    sopla: "The south wind blows!",
    soplaOtra: "The south wind again!",
    aguanta: "Hold on, flower!",
    asoma: "A hummingbird peeks in!",
    paso: "The gust has passed!",
    conPremio: (n: string) => `There goes ${n}, with a prize!`,
    hilo: (n: string) => `${n} hangs by a thread!`,
    engancha: (n: string) => `${n} caught on lower down!`,
    quedanDos: "The last two remain!",
    colibri: "Here comes the hummingbird!",
    visita: (n: string) => `Is it ${n}?`,
    visitaSin: "Is it this flower?",
    visitaOtra: "Or is it the other?",
    ultima: "Only one takes the prize.",
    ultimaDos: "Both of them take a prize.",
  },
} satisfies Textos;
