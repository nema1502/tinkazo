import type { Textos } from "../pixi/kit";

/**
 * Lo que dice el relator de la carrera: seis palabras o menos, un nombre por
 * línea como mucho y ningún número (los números van en el marcador). El ritmo lo
 * llevan el cuerpo y el sonido, no la voz. Los nombres llegan cortos (nombre de
 * pila e inicial): el nombre entero está en el cartel de la salida.
 *
 * En la final los momentos (se plantó, tropezó, viene de atrás, mano a mano) no
 * llevan nombre: nombrarlos decía quién gana. Los nombres de la final son los de
 * la tribuna (`carHinchada`), sorteados sin mirar quién gana.
 *
 * "Salida", no "largada", y nada que huela a hipódromo de apuestas.
 */
export const TEXTOS_CARRERA: Textos = {
  es: {
    carMeta: "¡Gana quien llegue a la meta!",
    carBusquen: "¡Busquen su nombre!",
    carSalida: "¡Salida!",
    carRotuloMeta: "META",
    carTramo: (terreno: string) => `¡Ahora, ${terreno}!`,
    carCuesta: "la cuesta",
    carBarro: "el barro",
    carPiedras: "las piedras",
    carViento: "el viento",
    carEcha: (n: string, v: number) => [`¡${n} se echa a descansar!`, `¡Se echó ${n}!`, `¡${n} descansa un rato!`][v % 3] ?? "",
    carVa: (n: string) => `¡Va adelante ${n}!`,
    carAdelante: (n: string, v: number) => [`¡Pasa adelante ${n}!`, `¡Ahora va ${n}!`, `¡${n} toma la punta!`][v % 3] ?? "",
    carRecta: "¡A la recta final!",
    carCasi: "¡Ya se ve la meta!",
    carPlantada: "¡Alguien se plantó!",
    carTropiezo: "¡Alguien tropezó!",
    carPique: "¡Alguien viene por afuera!",
    carEscupida: "¡Alguien escupió!",
    carRemonta: "¡Vienen de atrás!",
    carDuelo: "¡Mano a mano!",
    carAprieta: "¡Aprietan los dos!",
    carCuela: "¡Alguien se cuela!",
    carHinchada: (n: string) => `¡Vamos, ${n}!`,
    carFoto: "¡Foto finish!",
    carTanda: "¡Siguiente tanda!",
    carPasa: (n: string) => `¡Pasa ${n}!`,
    carCierraTanda: "¡Se cierra el portón!",
  },
  en: {
    carMeta: "Whoever reaches the finish wins!",
    carBusquen: "Find your name!",
    carSalida: "Go!",
    carRotuloMeta: "FINISH",
    carTramo: (terreno: string) => `Now, ${terreno}!`,
    carCuesta: "the hill",
    carBarro: "the mud",
    carPiedras: "the rocks",
    carViento: "the wind",
    carEcha: (n: string, v: number) => [`${n} lies down to rest!`, `${n} lay down!`, `${n} rests a while!`][v % 3] ?? "",
    carVa: (n: string) => `${n} is in front!`,
    carAdelante: (n: string, v: number) => [`${n} moves up front!`, `Now ${n} leads!`, `${n} takes the lead!`][v % 3] ?? "",
    carRecta: "On to the home stretch!",
    carCasi: "The finish is in sight!",
    carPlantada: "Someone dug in!",
    carTropiezo: "Someone stumbled!",
    carPique: "Someone comes wide!",
    carEscupida: "Someone spat!",
    carRemonta: "They come from behind!",
    carDuelo: "Neck and neck!",
    carAprieta: "Both push!",
    carCuela: "Someone sneaks in!",
    carHinchada: (n: string) => `Go, ${n}!`,
    carFoto: "Photo finish!",
    carTanda: "Next heat!",
    carPasa: (n: string) => `${n} gets through!`,
    carCierraTanda: "The gate closes!",
  },
};
