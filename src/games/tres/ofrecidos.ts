import type { Game } from "../../state";
import { tiene3D } from "./registro";

/**
 * Los juegos cuyo "Ver en 3D" el selector ofrece. Un juego entra acá recién cuando su versión en 3D está aprobada; hasta
 * entonces su módulo (`<juego>-3d.ts`) existe pero solo se abre con `?motor=3d`. Es la única lista: el interruptor no
 * mira otra cosa.
 */
export const JUEGOS_CON_3D: readonly Game[] = ["race", "trompo", "pinata", "toborochi", "sapo"];

/** Juegos cuyo 3D no vive en el registro del kit, sino enchufado en el propio juego (la carrera: `llamas/carrera-3d`). */
const MODULO_APARTE: readonly Game[] = ["race"];

/**
 * `true` si el interruptor "Ver en 3D" aparece con este juego elegido: tiene versión en 3D y además está en la lista.
 * `tieneModulo` y `lista` se pueden cambiar para probar sin bajar nada.
 */
export function ofrece3D(juego: Game, tieneModulo: (juego: string) => boolean = tiene3D, lista: readonly Game[] = JUEGOS_CON_3D): boolean {
  if (!lista.includes(juego)) return false;
  return MODULO_APARTE.includes(juego) || tieneModulo(juego);
}
