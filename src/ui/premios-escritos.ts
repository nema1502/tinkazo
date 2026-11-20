import { T, getLang } from "../i18n";

/**
 * Lo que el resumen de junto a «Sellar la lista» y la barra de lo que sigue dicen del premio antes de sellar. Lee los
 * campos de la página (`#prize` y los de cada lugar que arma `premios.ts`) y no los toca. Vive aparte de `premios.ts`
 * porque muchas pruebas reemplazan ese módulo con dos o tres funciones, y el resumen y la barra se pintan igual.
 */

/** Los premios escritos ahora, del 1.er lugar en adelante, sin espacios de más y sin los campos vacíos. */
export function premiosEscritos(): string[] {
  const campos = [document.getElementById("prize"), ...document.querySelectorAll("#prize-lugares input[data-lugar]")];
  return campos
    .map((c) => (c instanceof HTMLInputElement ? c.value.trim().replace(/\s+/g, " ") : ""))
    .filter((p) => p !== "");
}

/**
 * El premio tal como se resume: con varios escritos, cuántos son («3 premios»), porque nombrar solo el primero hacía
 * creer que todos se llevaban ese. Con uno solo, ese, como siempre. Sin ninguno, "".
 */
export function premioDelResumen(): string {
  const escritos = premiosEscritos();
  return escritos.length > 1 ? T[getLang()].prizeCuantos(escritos.length) : (escritos[0] ?? "");
}
