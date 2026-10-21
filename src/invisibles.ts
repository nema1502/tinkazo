/**
 * Los caracteres que no se ven, en los nombres de la lista.
 *
 * "Ana Quispe" y "Ana Quispe" con un espacio de ancho cero en el medio
 * (U+200B), un "word joiner" (U+2060) o un guion blando (U+00AD) se ven
 * iguales y son dos entradas distintas de la lista canónica: la misma persona
 * entraba dos veces y la marca de repetidos no lo veía. Suelen llegar sin que
 * nadie los ponga, pegados desde WhatsApp, Word o un formulario web, y alguien
 * los puede poner a propósito.
 *
 * Son dos cosas distintas:
 * - `stripInvisibles`, al cargar la lista (pegar, un archivo, el importador),
 *   antes de sellar: saca los que nunca se ven. Cambia lo que se sella, no
 *   cómo se sella: la lista canónica sigue sin normalizar nada
 *   (docs/protocolo.md §1), y los comprobantes de antes no cambian.
 * - `withoutInvisibles`, solo para comparar: saca todo lo que Unicode marca
 *   como ignorable al dibujar. Así la marca de repetidos y la búsqueda ven lo
 *   mismo que la sala, también en una lista que llegó por otro camino (escrita
 *   a mano, o sellada antes de este arreglo).
 */

/**
 * Los que se sacan siempre: el guion blando (U+00AD), el espacio de ancho
 * cero (U+200B), el "word joiner" (U+2060) y los operadores invisibles que lo
 * siguen, la marca de orden de bytes (U+FEFF), el separador de vocales mongol
 * (U+180E), los formatos desusados (U+206A a U+206F) y los controles de
 * dirección (U+061C, U+200E, U+200F, U+202A a U+202E y U+2066 a U+2069), que
 * además pueden mostrar un nombre al revés.
 */
const ALWAYS = /[\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

/** El que separa (ZWNJ, U+200C) y el que une (ZWJ, U+200D). */
const JOINER = /[\u200C\u200D]/;
/** Lo que arma un emoji compuesto: el dibujo, el tono de piel y el selector de emoji (U+FE0F). */
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
const LETTER = /[\p{L}\p{M}]/u;
/** Escrituras cuyas letras no se enlazan: entre ellas, un ZWJ o un ZWNJ no cambian nada. */
const UNJOINED = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}\p{Script=Inherited}]/u;

/** ¿Junto a este carácter un ZWJ o un ZWNJ cambian el dibujo? */
const joins = (c: string | undefined): boolean =>
  c !== undefined && (EMOJI.test(c) || (LETTER.test(c) && !UNJOINED.test(c)));

/**
 * Un nombre sin los caracteres que nunca se ven.
 *
 * El ZWJ y el ZWNJ se sacan solo donde no hacen nada. Entre dos emojis
 * arman uno (la programadora es una mujer, el ZWJ y una computadora) y entre letras
 * del árabe, el persa, el cingalés o las escrituras de la India cambian cómo
 * se enlazan: ahí se ven, y sacarlos le cambiaría el nombre a alguien. Para
 * los repetidos no importa: `withoutInvisibles` los saca igual al comparar.
 */
export function stripInvisibles(s: string): string {
  const out = s.replace(ALWAYS, "");
  if (!JOINER.test(out)) return out;
  // Por punto de código y no por unidad de UTF-16: los emojis ocupan dos.
  const cps = Array.from(out);
  return cps.filter((c, i) => !JOINER.test(c) || (joins(cps[i - 1]) && joins(cps[i + 1]))).join("");
}

/**
 * Un texto de un nombre por línea, sin los invisibles, y en cuántas líneas con
 * algo escrito se sacó alguno: eso es lo que cuenta el aviso.
 */
export function stripInvisiblesByLine(text: string): { text: string; lines: number } {
  let lines = 0;
  const out = text.split("\n").map((line) => {
    const clean = stripInvisibles(line);
    if (clean !== line && line.trim() !== "") lines++;
    return clean;
  });
  return { text: out.join("\n"), lines };
}

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * Para comparar: sin nada de lo que no se dibuja. Además de los de arriba,
 * los ZWJ de los emojis, los selectores de variante y los rellenos del
 * coreano (U+3164 y sus parientes), que se usan para nombres "en blanco".
 */
export const withoutInvisibles = (s: string): string => s.replace(IGNORABLE, "");
