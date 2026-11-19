/**
 * Lo que comparten el plan, las tandas, la escena y las pruebas de la carrera:
 * las medidas del show y dos ayudas con nombres. Puro, sin Pixi ni DOM.
 */

import { formasDe, palabras } from "../nombres";
import { esNombreEntero } from "../nombres-enteros";

/**
 * La marcha pareja de la carrera de siempre (13 de noviembre de 2026): hasta tres segundos antes de la meta la ganadora es una llama más. En la
 * recta todas las finalistas se mueven con la misma regla que la ganadora (cada una busca los puestos de su propio arco, de la misma tabla), el
 * grupo de punta de los tres segundos finales es la ganadora y tres sorteadas sin mirar el pasado, y los momentos le tocan a cualquiera y se ven.
 * Quién gana, el margen y la foto no cambian. En false, la carrera de antes, número por número (`carrera-huella.test.ts`).
 */
export const SENUELOS = true;

/** Cuántas llegan a la recta: las ocho de la final. */
export const FINALISTAS = 8;
/** Hasta cuántas corren en el mismo grupo sin tandas: con más, las tandas arman el grupo. */
export const PELOTON_MAX = 30;
/** El vuelo de la cámara, de la meta a la salida. */
export const T_VUELO = 3;
/**
 * El cartel con todos los nombres, enteros y en orden alfabético, antes de la salida (hasta 30 personas). En Rápido el
 * show se comprime hasta 0,82 (con 2 personas; 0,86 con 9 o más): 3,7 s del plan son 3 s de verdad, lo que hace falta para leer.
 */
export const T_NOMBRES = 3.7;
/** Los segundos de la recta final, sin estirar (el reloj de la recta, `carrera-ritmo.ts`, los reparte: la cámara lenta del duelo suma unos décimos). */
export const DUR_FINAL = 15.1;
/** La recta mide esto, en anchos de pantalla. */
export const RECTA = 2;
/** Los segundos que no se estiran: el sostén del cartel de quien gana y la cuenta de la sala. */
export const FIJOS = 6;
/** La tarjeta de "cómo se juega" que va antes del show: sale del mismo total que promete "Normal" (`CARD_SECONDS`). */
export const TARJETA = 3.5;
/** Lo que más dura un show con cualquier cantidad de gente, en segundos (de 9 a 200 personas; ver docs/juegos/carrera.md). */
export const TOPE_NORMAL = 90;

/**
 * El nombre corto de la línea del relator: el mismo que escribe la ficha de la llama (`formasDe`, nivel 3: el de pila
 * y la inicial del último apellido, "María Quispe Mamani" es "María M."), con dos palabras como mucho. El nombre de un
 * equipo (`nombres-enteros.ts`) no se acorta.
 */
export function corto(nombre: string): string {
  if (!nombre.trim()) return "";
  // El de un equipo va entero: «¡Vamos, Las Wawas!», nunca «¡Vamos, Las W.!» (ensayo del 6 de noviembre de 2026).
  if (esNombreEntero(nombre)) return palabras(nombre).join(" ");
  return palabras(formasDe(nombre)[2]).slice(0, 2).join(" ");
}

/** Los nombres en orden alfabético (el de los carteles): sin tildes ni mayúsculas, estable. */
export function alfabetico(nombres: readonly string[], quienes: readonly number[]): number[] {
  const clave = (i: number): string => (nombres[i] ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return [...quienes].sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : a - b));
}

export function barajar<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}
