import type { Beacon } from "../../state";
import type { Motor3D } from "./motor";

/**
 * Los tipos del contrato entre un juego en 2D (el que decide todo) y su vista en 3D (que solo dibuja).
 * Sin three.js ni DOM: se pueden importar desde el archivo del juego sin traer nada de más.
 *
 * Qué recibe el 3D en cada cuadro, siempre: `EntradaBase` (la hora del juego, el tamaño de la pantalla y la cámara del
 * director del 2D) más lo propio del juego (`E`): dónde está cada cosa, en píxeles del mundo 2D, y su estado.
 */

/**
 * La cámara del 2D en este cuadro, ya con todo lo que el director le sumó: el acercamiento de emoción, el golpe, el
 * "pum" de un choque y la guardia del ganador. Sale de `camaraDeEscena` (camara.ts), que la lee de la escena de
 * PixiJS después de `cam.apply`.
 */
export interface Camara2D {
  /** El punto del mundo que queda en el centro de la pantalla, en píxeles del mundo 2D (sin el sacudón). */
  x: number;
  y: number;
  /** El acercamiento que se aplicó de verdad. */
  zoom: number;
  /** La inclinación, en radianes (incluye el temblor fino del sacudón). */
  rot: number;
  /** El sacudón en píxeles de pantalla; el 3D lo copia como un corrimiento de la cámara. */
  sacudonX: number;
  sacudonY: number;
}

/** Lo que el 3D recibe en todos los juegos, en cada cuadro. */
export interface EntradaBase {
  /** La hora del juego, en segundos: todo lo que se mueve solo en el 3D es función de esto. */
  t: number;
  /** El tamaño de la pantalla, en píxeles. */
  w: number;
  h: number;
  /** La unidad de la pantalla (`S.u()`): un píxel de un diseño de 720 de alto. */
  u: number;
  cam: Camara2D;
}

/** Dónde cae en la pantalla una figura: el punto de arriba de la cabeza (donde apoya su nombre) y cuánto mide. */
export interface Pantalla3D {
  x: number;
  y: number;
  /** El alto que ocupa en la pantalla, en píxeles. */
  alto: number;
}

/** Lo que el juego en 2D espera de su vista en 3D. */
export interface Vista3D<E extends EntradaBase = EntradaBase> {
  /** Dibuja el cuadro: acomoda la escena a lo que dice `e`, mueve la cámara y renderiza. */
  frame(e: E): void;
  /** Dónde cae en la pantalla la cabeza de `id` en el último cuadro, o null si no se ve. */
  pantallaDe(id: number): Pantalla3D | null;
  /** El mundo 2D cambió (otro tamaño de pantalla): rearma lo fijo. Opcional. */
  reconstruir?(): void;
  /** Suelta lo que la vista creó. El motor (renderer, escena, contexto) lo suelta `enchufar3D`. */
  destruir(): void;
}

/** Lo que la fábrica recibe además del motor: lo del juego que el 3D necesita saber para vestirlo. */
export interface OpcionesVista {
  /** El tema de la página: el cielo y la luz cambian (día en el claro, atardecer en el oscuro). */
  tema: "claro" | "oscuro";
  /** `?auditar=3d`: anotar cuadros por segundo y posiciones en `window.__tres`. */
  auditar: boolean;
}

/** Cómo se arma la vista de un juego. Es lo que usa cada `<juego>-3d.ts`. */
export type Fabrica3D<E extends EntradaBase = EntradaBase> = (motor: Motor3D, o: OpcionesVista) => Vista3D<E>;

/**
 * Lo que el 2D recibe del archivo `<juego>-3d.ts`: crea el motor y la vista juntos y los suelta juntos. Devuelve null si
 * el 3D no arranca en este equipo (sin WebGL, sin memoria): el juego sigue en 2D como si nada. Este tipo no pesa nada;
 * el motor, sí (`motor.ts`, con three.js).
 */
export type Montaje3D<E extends EntradaBase = EntradaBase> = (lienzoPixi: HTMLCanvasElement, o: OpcionesVista) => Vista3D<E> | null;

/** Cómo arranca un juego (la firma de `PIXI[...]` en `pixi/index.ts`). */
export type Lanzador = (names: string[], winners: readonly number[], beacon: Beacon, done: () => void) => Promise<void>;

/**
 * La señal de la mano que tira: qué hacen los dedos y en qué parte del lanzamiento va. La calcula el 2D, que ya
 * tiene el guion de tiros y su reloj, y la consume el 3D, así las dos escenas lanzan con la misma hora. Son campos
 * opcionales: una vista que todavía no los lee sigue funcionando con los valores por defecto.
 */
export interface SenalMano {
  /** Cuánto están abiertos los dedos, de 0 a 1: 0 curvados agarrando la moneda, 1 abiertos de golpe tras soltar.
   * Si falta, la mano descansa con los dedos a medio encoger (0,4). */
  flex?: number;
  /** La fase del lanzamiento: de 0 a 1 se echa atrás (toma impulso); de 0 a -1 látiga tras soltar.
   * Si falta, 0: mano quieta. */
  fase?: number;
}
