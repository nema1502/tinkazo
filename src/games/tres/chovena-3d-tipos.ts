import type { EntradaBase } from "./tipos";

/**
 * Lo que el 2D de la chovena (`pixi/chovena.ts`) le pasa a su vista 3D en cada cuadro. Solo tipos: el archivo del juego
 * lo importa sin traer three.js.
 *
 * Todo viene en píxeles del mundo 2D y ya calculado por el 2D: el 3D no decide ni recalcula nada del sorteo. En
 * particular **no recibe quién gana**: la ganadora lleva `modo: "salta"` recién cuando el 2D la corona (a partir de
 * `T_CROWN`), igual que el 2D. Antes de eso, todos los bailarines se describen con los mismos campos.
 */

/**
 * Qué está haciendo cada uno:
 * - `rueda`: baila de la mano de sus vecinos (o suelto, si se soltó en un corte falso). En el arranque, mientras `filas` pesa
 *   de 1 a 0, está en su fila: ellas con las manos en la cintura y ellos dando palmadas.
 * - `camina`: salió; se va hacia el borde de la plaza o hacia la sala.
 * - `sentado`: sentado al borde, aplaudiendo con la música.
 * - `festeja`: salió y, con el golpe de la corona, se para con los brazos arriba.
 * - `salta`: la ganadora coronada, saltando en el medio.
 */
export type ModoBailarin = "rueda" | "camina" | "sentado" | "festeja" | "salta";

export interface BailarinEntrada {
  id: number;
  /** `false` si el 2D ya no lo dibuja (salió de la pantalla). */
  visible: boolean;
  /** Va de tipoy (cintas en el escote y el ruedo) o de camisa y sombrero de saó (cinta en el sombrero). */
  tipoy: boolean;
  /** El color de sus cintas: el de su cara en el nombre. */
  color: number;
  /** Dónde pisa, en el mundo 2D. */
  x: number;
  y: number;
  /** Cuánto se levanta del piso (el trote, el salto), en píxeles del mundo 2D. */
  alto: number;
  modo: ModoBailarin;
  /** El medio de su rueda, adonde mira cuando baila (mundo 2D). */
  cx: number;
  cy: number;
  /** Para dónde gira su rueda: 1, -1, o 0 si no gira. */
  sentido: number;
  /** De 0 a 1: cuánto mira a la sala en vez de al medio (las filas, la final, la corona, los que se van). */
  haciaSala: number;
  /** En la final, con quién baila (mira a la sala pero un poco hacia él), o -1. */
  pareja: number;
  /** La inclinación del cuerpo en el plano de la pantalla, en radianes, positiva hacia la derecha (el trote y el tambaleo). */
  inclinacion: number;
  /** Los pasos: seno del pulso, de -1 a 1. Un pie sube con el positivo y el otro con el negativo. 0 si no baila. */
  paso: number;
  /** De 0 a 1: cuánto se sentó. */
  sentado: number;
  /** De 0 a 1: cuánto sigue en las filas del arranque. */
  filas: number;
  /** Segundos desde que se soltó (el braceo al caminar), o -1. */
  salida: number;
  /** El «¡!» del que trastabilla (lo dibuja PixiJS sobre su cabeza). */
  alerta: boolean;
  /** 0 sigue en la rueda, 1 salió, 2 salió con premio. */
  tinte: 0 | 1 | 2;
}

export interface EntradaChovena extends EntradaBase {
  /** La plaza del 2D, en píxeles: su medio, sus radios, el alto de un bailarín, dónde terminan las casas y su alto. */
  plaza: { cx: number; cy: number; rx: number; ry: number; dh: number; yB: number; hs: number };
  bailarines: BailarinEntrada[];
  /** Pares de bailarines que van de la mano en este cuadro, `[a, b, a, b, ...]`. En la final, la pareja viene dos veces (de las dos manos). */
  eslabones: number[];
  /** El conjunto: si toca, y el pulso (golpes de la música). Con el corte, quieto y con los palillos arriba. */
  banda: { toca: boolean; pulso: number };
  /** El aplauso de los sentados, de 0 a 1. */
  aplauso: number;
  /** Seno del pulso: las palmadas de los hombres de las filas. */
  ritmo: number;
  /** La música está cortada (de verdad o falso) en este cuadro. */
  quieto: boolean;
  /**
   * De 0 a 1: cuánto es chica la rueda (de tres a seis). El 2D la abre a lo hondo para que se vea redonda en la pantalla
   * (`shapeOf`), y en el piso del 3D queda estirada: la cámara sube, sin mover a nadie en la pantalla, para que las manos se alcancen.
   */
  chica: number;
  /** Dónde está el cartel «¡QUIETOS!» en la pantalla (el del cuadro anterior), o null si no se ve. Solo lo usa la medición de `?auditar=3d`. */
  cartel: { x: number; y: number; w: number; h: number } | null;
  /** Segundos desde la corona (`T_CROWN`), o -1 antes. */
  corona: number;
  /** Segundos desde el golpe del foco (`T_GOLPE`), o -1 antes. */
  golpe: number;
  /** De 0 a 1: cuánto va de la última vuelta de la final, hasta su corte. 0 fuera de la final. */
  tension: number;
}
