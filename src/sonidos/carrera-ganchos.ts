/**
 * Los ganchos por donde la carrera pide el sonido que se eligió escuchando.
 *
 * El show de la carrera (`carrera-show.ts`) es puro y no puede traer el audio. Llama a estas funciones; la
 * implementación (`carrera-uso.ts`) se registra cuando se carga el anfitrión de la página. Sin implementación, o con
 * la elección `hoy`, todas devuelven `false` y el juego toca lo de siempre.
 */

export type ObstaculoDeLaCarrera = "piedras" | "viento" | "valla";

export interface GanchosDeSonido {
  paso(j: number): boolean;
  echada(): boolean;
  obstaculo(tipo: ObstaculoDeLaCarrera): boolean;
  programarFinal(sonar: (t: number, hacer: () => void) => void, tCruce: number): void;
}

let ganchos: GanchosDeSonido | null = null;

export function registrarGanchos(g: GanchosDeSonido): void {
  ganchos = g;
}

/** Un paso de la llama (`j` cuenta los pasos). `true` si lo tocó una candidata. */
export const sonarPaso = (j: number): boolean => ganchos?.paso(j) ?? false;

/** Una llama se echa a descansar. */
export const sonarEchada = (): boolean => ganchos?.echada() ?? false;

/** Un obstáculo: las piedras caen, sopla el viento, hay que saltar la valla. */
export const sonarObstaculo = (tipo: ObstaculoDeLaCarrera): boolean => ganchos?.obstaculo(tipo) ?? false;

/** Programa el bombo que crece, el clic y el silencio de los últimos tres segundos. `sonar(t, hacer)` agenda algo en el segundo `t` del show. */
export const programarFinal = (sonar: (t: number, hacer: () => void) => void, tCruce: number): void => ganchos?.programarFinal(sonar, tCruce);
