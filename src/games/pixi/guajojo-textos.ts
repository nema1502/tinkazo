import type { Textos } from "./kit";

/**
 * Lo que dice el relator del Guajojó, en los dos idiomas. Viven acá y no en el
 * diccionario del sitio para que el juego viaje solo. Una clave en un idioma y
 * no en el otro la atrapa la prueba del plan (`guajojo-plan.test.ts`).
 *
 * La regla del niño: seis palabras o menos, un nombre por línea y ningún número
 * (los números van en el marcador). El ritmo lo llevan el cuerpo y el sonido.
 *
 * Nunca: eliminado, perdió, muerte ni agüero. Quien se sienta no pierde, escucha;
 * el final es el amanecer. La leyenda no se cuenta durante el show: solo el juego.
 */
export const TEXTOS = {
  es: {
    intro: "¡Cae el sol en el monte!",
    lista: "¡Salen los caminantes!",
    busquen: "¡Busquen su nombre!",
    canta: "¡Canta el guajojó!",
    cantaOtra: "¡Vuelve a cantar!",
    cantaMas: "¡Canta más cerca!",
    calla: "¡Calló! ¡Quietos!",
    callaOtra: "¡Otra vez! ¡Quietos!",
    ultimos: "¡Quedan los dos últimos!",
    enUnPie: () => "¡Alguien en un pie!",
    aguanta: () => "¡Uno aguantó!",
    alguien: "¿Quién aguanta?",
    crac: (n: string) => `¡Crac! Te escuchó, ${n}`,
    varios: "¡Crac! ¡Se sientan varios!",
    conPremio: "¡Se sienta, pero con premio!",
    amanece: "¡Amanece!",
  },
  en: {
    intro: "The sun sets on the forest!",
    lista: "The walkers step out!",
    busquen: "Find your name!",
    canta: "The guajojó sings!",
    cantaOtra: "It sings again!",
    cantaMas: "It sings closer!",
    calla: "It stopped! Freeze!",
    callaOtra: "Again! Freeze!",
    ultimos: "The last two remain!",
    enUnPie: () => "Someone on one foot!",
    aguanta: () => "One held on!",
    alguien: "Who holds on?",
    crac: (n: string) => `Snap! It heard you, ${n}`,
    varios: "Snap! Several sit down!",
    conPremio: "Sits down, but with a prize!",
    amanece: "Dawn breaks!",
  },
} satisfies Textos;
