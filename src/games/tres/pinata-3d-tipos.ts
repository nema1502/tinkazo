import type { EntradaBase } from "./tipos";

/**
 * Lo que el 2D de la piñata (`pixi/pinata.ts`) le pasa a su vista 3D en cada cuadro. Solo tipos: el archivo del juego
 * lo importa sin traer three.js.
 *
 * Todo viene en píxeles del mundo 2D y ya calculado por el 2D: el 3D no decide ni recalcula nada del sorteo. En
 * particular **no recibe quién gana**: de los caramelos solo sabe si están adentro o afuera, y la ganadora lleva la
 * marca `ganadora` recién cuando el 2D la dibuja grande (después de la rotura), igual que el 2D.
 */

export type FasePinata = "hang" | "hits" | "break" | "crown";

/** Un caramelo: adentro de la olla no se ve; afuera, el 2D dice dónde está, cuánto gira y de qué tamaño se dibuja. */
export interface Caramelo3D {
  dentro: boolean;
  x: number;
  y: number;
  rot: number;
  /** El color de su dueño (el mismo de su cara en el 2D). */
  color: number;
  /** El tamaño con que lo dibuja el 2D. */
  tam: number;
  ganadora: boolean;
}

export interface EntradaPinata extends EntradaBase {
  fase: FasePinata;
  /** Las medidas del patio del 2D, en píxeles. */
  mundo: {
    /** La y del piso donde se apoyan los caramelos. */
    piso: number;
    /** El radio de la olla. */
    R: number;
    /** La unidad de la pantalla (`S.u()`). */
    k: number;
    /** La escala del chico. */
    ks: number;
    /** La y de los pies del chico. */
    ky: number;
    /** El borde de arriba que dejan la cinta y el contador. */
    top: number;
    /** La y de la piñata colgada quieta, para la altura de las guirnaldas. */
    restY: number;
  };
  olla: {
    x: number;
    y: number;
    /** La inclinación que le pone el 2D (la del vaivén), en radianes, positiva hacia la derecha. */
    rot: number;
    /** El aplastón del palo: cuánto se ensancha y cuánto se achata. */
    escX: number;
    escY: number;
    /** `false` desde que se rompe. */
    ver: boolean;
    /** Cuántas grietas lleva (una por palo que pegó). */
    grietas: number;
  };
  /** De dónde cuelga la cuerda (arriba de la pantalla). */
  cuerda: { x: number; y: number };
  chico: {
    x: number;
    /** Las vueltas que lleva dadas, en vueltas enteras (0 a 3): son de verdad, sobre su eje. */
    vueltas: number;
    /** El tambaleo del mareo, en radianes. */
    inclina: number;
    /** La fase del paso y cuánto camina, de 0 a 0,45. */
    paso: number;
    amp: number;
    /** El ángulo del palo en el dibujo del 2D (y hacia abajo), en radianes. */
    palo: number;
    /** Qué tan mareado está, de 0 a 1 (las estrellitas). */
    mareo: number;
    /** El color de su remera. */
    remera: number;
  };
  /** Todos los caramelos, por id; se rellena en el lugar para no crear objetos en cada cuadro. */
  car: Caramelo3D[];
  /** El caramelo que se asoma por la rajadura en el susto. Mismo dibujo sea quien sea. */
  asoma: { ver: boolean; x: number; y: number; tam: number; rot: number; color: number };
  /** Segundos desde que se rompe la piñata (negativo mientras cuelga entera). */
  rotura: number;
  /** Segundos desde que llega el cartel (negativo antes). */
  corona: number;
}
