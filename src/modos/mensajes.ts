import { type Lang, textos } from "../idioma";
import { turnOrderText } from "./turnos";

/**
 * Los mensajes de un orden de turnos: el que se pega en el grupo y el aviso a cada persona.
 *
 * Usan solo `idioma.ts`, sin el diccionario entero, para que los pueda cargar la página de verificación (que comparte el
 * sorteo otra vez con `compartir.ts`). Las frases son las del diccionario, en los dos idiomas: nada de ganar ni de premio.
 *
 * El mensaje del grupo dice el orden, y que nadie lo eligió porque la lista se cerró antes de que existiera el número que lo
 * decidió. Sin sello no promete lo que no se puede comprobar: igual que el mensaje de un sorteo común, ofrece el enlace para
 * ver la lista y la cuenta, sin «nadie eligió» ni «verificarlo».
 */

/** El texto de una clave en el idioma pedido. Si falta, la clave misma. */
function cad(lang: Lang, clave: string): string {
  const v = textos(lang)[clave];
  return typeof v === "string" ? v : clave;
}

/** Reemplaza las marcas {así} en una sola pasada: lo que se pone no se vuelve a mirar. */
function rellenar(plantilla: string, datos: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (marca, clave: string) => (clave in datos ? String(datos[clave]) : marca));
}

/** El mensaje para el grupo: «Orden de los turnos: 1. Ana, 2. Beto...», que nadie lo eligió, y cómo verificarlo. `orden` ya viene en el orden del sorteo. */
export function turnMessage(lang: Lang, d: { orden: readonly string[]; enlace: string; sinSello?: boolean }): string {
  return [
    rellenar(cad(lang, "turnsMsgCab"), { orden: turnOrderText(d.orden) }),
    ...(d.sinSello
      ? [cad(lang, "redSinSelloEtiqueta"), rellenar(cad(lang, "cmpVerSinSello"), { enlace: d.enlace })]
      : [cad(lang, "turnsPie"), rellenar(cad(lang, "cmpVerificarUno"), { enlace: d.enlace })]),
    "",
    cad(lang, "cmpPie"),
  ].join("\n");
}

/** El aviso a una persona: «Te tocó el turno 3 de 12. Revisalo vos: {enlace}». `turn` cuenta desde 1. */
export function turnNotice(lang: Lang, d: { turn: number; of: number; enlace: string; sinSello?: boolean }): string {
  return [rellenar(cad(lang, d.sinSello ? "turnsTellSin" : "turnsTell"), { k: d.turn, n: d.of, enlace: d.enlace }), "", cad(lang, "cmpPie")].join("\n");
}
