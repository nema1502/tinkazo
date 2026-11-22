/**
 * Lo que la vista previa del celular muestra de la campaña, en los dos idiomas.
 * Es una función pura: le entran las líneas ya armadas por el resto de la pieza
 * y sale la lista de renglones, con los pasos numerados en su orden del idioma
 * pedido. La pieza de la pantalla previa del celular no se toca: esto se pinta
 * en `empresa.html` y no comparte el dibujo.
 */

import { stripInvisibles } from "../invisibles";
import type { Lang } from "../idioma";

export interface DatosDeVista {
  /** El nombre de la empresa, como texto de la campaña. */
  empresa: string;
  /** El día del evento, ya escrito en el idioma, o null si falta. */
  cuando: string | null;
  /** El lugar completo, o null si falta. */
  lugar: string | null;
  /** La hora de cierre, ya escrita, o null si falta. */
  cierre: string | null;
  /** El premio para cada persona, ya escrito, o null si falta. */
  premio: string | null;
  /** El total de los premios, ya escrito, o null si falta. */
  premios: string | null;
  /** Los pasos de la campaña, en su orden, con su texto en los dos idiomas. */
  pasos: { texto: { es: string; en: string } }[];
}

const TITULOS: Record<Lang, string> = { es: "Cómo jugar", en: "How to play" };
const CIERRA: Record<Lang, string> = { es: "Cierra el", en: "Closes on" };

/** Los renglones de la vista previa, en el idioma pedido. */
export function vistaDelCelular(d: DatosDeVista, idioma: Lang): string[] {
  const lineas: string[] = [];
  const empresa = stripInvisibles(d.empresa).trim();
  if (empresa !== "") lineas.push(empresa);
  if (d.premio !== null && d.premio !== "") lineas.push(d.premio);
  if (d.premios !== null && d.premios !== "") lineas.push(d.premios);
  const lugar = d.lugar !== null ? stripInvisibles(d.lugar).trim() : "";
  if (lugar !== "") lineas.push(`${idioma === "es" ? "Dónde" : "Where"}: ${lugar}`);
  const cuando = d.cuando !== null ? stripInvisibles(d.cuando).trim() : "";
  if (cuando !== "" && d.cierre !== null && d.cierre !== "") {
    lineas.push(`${CIERRA[idioma]} ${cuando} ${d.cierre}`);
  } else if (cuando !== "") {
    lineas.push(`${CIERRA[idioma]} ${cuando}`);
  }
  const pasos = d.pasos.filter((p) => stripInvisibles(p.texto[idioma]).trim() !== "");
  if (pasos.length > 0) {
    lineas.push(TITULOS[idioma]);
    pasos.forEach((p, i) => lineas.push(`${i + 1}. ${p.texto[idioma]}`));
  }
  if (lineas.length === 0) lineas.push(idioma === "es" ? "Nada para mostrar todavía" : "Nothing to show yet");
  return lineas;
}
