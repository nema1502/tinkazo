/**
 * El modo «Orden de turnos»: lo que se decide sin pantalla.
 *
 * Un orden de turnos no es un sorteo distinto. Es un sorteo común donde ganan tantas personas como hay en la lista: el
 * contrato lo admite, la selección lo rehace y la verificación lo comprueba, todo como está. Lo único propio del modo es
 * cómo se elige (la cantidad sigue a la lista) y cómo se muestra (una lista de turnos). Por eso no hay ningún campo nuevo
 * en el sello ni en el comprobante: el orden se reconoce por lo que ya está sellado, la cantidad y el nombre.
 */

import { cierraComoReparto, nombreDePersona, seCuentaPorPersona } from "../participaciones";
import type { ModeName } from "./bandera";

/**
 * El nombre de un orden de turnos empieza con «Turnos» o «Turns», sin distinguir mayúsculas. Después de la palabra no
 * puede seguir otra letra: «Turnos de limpieza» y «Turnos: pasanaku» sí, pero «Turnstile» no.
 */
const TURN_PRIZE = /^\s*(?:turnos|turns)(?!\p{L})/iu;

/** ¿El nombre del sorteo (el campo `meta` del sello) empieza como un orden de turnos? */
export const isTurnPrize = (prize: string): boolean => TURN_PRIZE.test(prize.normalize("NFKC"));

/**
 * ¿Un sorteo es un orden de turnos? Cuando ganan tantas personas como hay en la lista Y el nombre empieza con «Turnos» o
 * «Turns». Las dos cosas juntas: tres poleras entre tres personas no son turnos, ni «Turnos de limpieza» con 3 de 12.
 * Es la única función que lo decide: el resultado, la pantalla grande, la verificación, Mis sorteos y los mensajes la usan.
 * Con menos de dos personas no hay sorteo (el contrato pide dos).
 */
export const isTurnOrder = (people: number, winners: number, prize: string): boolean => people >= 2 && winners === people && isTurnPrize(prize);

/**
 * El modo que lleva el enlace de verificación de un sorteo, para que quien lo abre lo cuente como la herramienta. Solo con
 * los modos a la vista: sin ellos el enlace queda como siempre, también el de un orden de turnos (que la verificación
 * reconoce igual por lo sellado, con `isTurnOrder`). Un orden lleva `turnos`; un reparto que se cuenta por persona con la
 * regla de todos (`seCuentaPorPersona`), `varias`. El enlace guarda un solo modo.
 */
export function modoDelComprobante(names: readonly string[], winners: number, prize: string, modosALaVista: boolean): ModeName | null {
  if (!modosALaVista) return null;
  if (isTurnOrder(names.length, winners, prize)) return "turnos";
  return seCuentaPorPersona(names, true) ? "varias" : null;
}

/**
 * Los nombres en el orden de los turnos: el turno 1 es el primero que salió del sorteo, el 2 el segundo, y así. No
 * reordena nada: es `winners` tal cual, mapeado a la lista. Todo lo que muestra un orden sale de acá.
 */
export const turnOrder = (names: readonly string[], winners: readonly number[]): string[] => winners.map((i) => names[i] ?? "");

/** El orden como se pega en un grupo: «1. Ana, 2. Beto, 3. Carla». */
export const turnOrderText = (ordered: readonly string[]): string => ordered.map((name, i) => `${i + 1}. ${name}`).join(", ");

/**
 * Los nombres del orden para mostrar en el resultado: cuando la lista sellada es un reparto que cierra (cada persona
 * con sus líneas «(k/m)» completas) y hay más líneas que personas, cada turno muestra el nombre de la persona, sin el
 * sufijo de la línea. Lo sellado no cambia: es solo cómo se lee el orden, y lo copiado sale del mismo arreglo.
 */
export function turnOrderDisplayNames(names: readonly string[], winners: readonly number[]): string[] {
  const orden = turnOrder(names, winners);
  // La misma prueba de reparto que cuenta la lista (`cierraComoReparto`). Si se quita el sufijo o no lo decide
  // quien llama, por el modo (`sinSufijos` en la lista de turnos).
  return cierraComoReparto(names) ? orden.map((linea) => nombreDePersona(linea)) : orden;
}

/**
 * El nombre que queda en un orden de turnos: el que escribió la persona si ya empieza con «Turnos» o «Turns», la palabra
 * sola si no escribió nada, y si escribió otra cosa («Orden de noviembre») la palabra por delante («Turnos: Orden de
 * noviembre»), para que el sorteo se siga reconociendo como orden. No pasa de `max` caracteres, como el campo.
 */
export function turnPrize(text: string, base: string, max = 60): string {
  const clean = text.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!clean) return base;
  if (isTurnPrize(clean)) return Array.from(clean).slice(0, max).join("");
  return Array.from(`${base}: ${clean}`).slice(0, max).join("");
}

/**
 * El resultado que está en pantalla es un orden de turnos. La marca la pone `draw.ts` al mostrar cada
 * resultado (`reveal`), y la leen los carteles finales de los juegos (`cWin` de `i18n.ts`), que dicen
 * que el orden quedó listo en vez de quién ganó. Vive acá porque `i18n.ts` no puede importar el
 * estado de la pantalla sin arrastrarlo a las páginas de lectura.
 */
let resultadoDeTurnos = false;
export const esResultadoDeTurnos = (): boolean => resultadoDeTurnos;
export const setResultadoDeTurnos = (si: boolean): void => {
  resultadoDeTurnos = si;
};
