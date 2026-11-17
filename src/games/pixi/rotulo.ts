import type { Lang } from "../../idioma";

/**
 * El rótulo del panel final de los juegos (la corona de `stage.ts`): quién se lleva qué.
 *
 * - Un orden de turnos no tiene ganadores: el panel dice que es el orden, con los nombres numerados debajo
 *   (`esResultadoDeTurnos`, `modos/turnos.ts`). Va primero: también vale en una ronda de stand.
 * - En una ronda de stand nadie gana nada: «salió», nunca «gana».
 * - En un sorteo común, gana uno o ganan varios.
 *
 * Es una función aparte, sin PixiJS, para probarla sin pantalla.
 */
export function rotuloDelPanel(lang: Lang, cuantos: number, o: { stand: boolean; turnos: boolean }): string {
  const varios = cuantos > 1;
  if (o.turnos) return lang === "es" ? "EL ORDEN" : "THE ORDER";
  if (o.stand) return lang === "es" ? (varios ? "SALIERON" : "SALIÓ") : "PICKED";
  return lang === "es" ? (varios ? "GANAN" : "GANA") : varios ? "WINNERS" : "WINNER";
}
