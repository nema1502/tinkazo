/**
 * La lectura del texto sellado con un premio por lugar («1.er premio: Bici, 2.º premio: Termo»), sin nada más: no toca
 * la página ni el idioma. Vive aparte de `premios.ts` para que la usen el resultado, la línea del lugar, el pago y
 * «No está» aunque las pruebas reemplacen `./premios`. `premios.ts` la vuelve a exportar, así nada cambia para quien
 * ya la importaba de ahí.
 */

/** Un lugar de los premios, como lo devuelve la lectura del texto armado. */
export interface LugarDePremio {
  /** El lugar, contando desde el 1: el 1.er premio, el 2.º premio y así. */
  lugar: number;
  /** Lo que se lleva, limpio de espacios de más. */
  premio: string;
}

/**
 * El rótulo de un lugar en el texto del sello: el número, su marca y la palabra, con los dos puntos. La marca está
 * suelta (`\.?`) para reconocer «1.er premio» como «1er premio», y las dos palabras para leer lo sellado en
 * cualquiera de los dos idiomas.
 */
const ROTULO_DE_LUGAR = /(\d{1,3})\s*\.?\s*(?:er|º|ª|st|nd|rd|th)\s+(?:premio|prize)\s*:\s*/gi;

/**
 * Si un texto trae algo con forma de rótulo («3º premio:»). Escrito dentro de un premio, la lectura lo tomaría por
 * otro lugar. `search` no usa el estado de la búsqueda global, así se puede llamar las veces que haga falta.
 */
export const pareceRotulo = (s: string): boolean => s.search(ROTULO_DE_LUGAR) >= 0;

/**
 * Lee de vuelta el texto de lugares que armó `armarMeta`, con el premio de cada uno. Si el texto no sigue el formato
 * (un `meta` de antes, un premio escrito a mano) devuelve `null`: quien lo muestra lo deja tal cual.
 */
export function lugaresDeMeta(meta: string): LugarDePremio[] | null {
  const texto = meta;
  const rotulos = [...texto.matchAll(ROTULO_DE_LUGAR)];
  // Un solo rótulo no es el formato: lo armado con más de un lugar lleva por lo menos dos.
  if (rotulos.length < 2) return null;
  // Antes del primer rótulo no puede haber nada.
  if (texto.slice(0, rotulos[0]?.index ?? 0).trim() !== "") return null;
  const lugares: LugarDePremio[] = [];
  for (let i = 0; i < rotulos.length; i++) {
    const m = rotulos[i] as RegExpMatchArray;
    const desde = (m.index ?? 0) + (m[0] ?? "").length;
    const hasta = i + 1 < rotulos.length ? (rotulos[i + 1] as RegExpMatchArray).index ?? texto.length : texto.length;
    const crudo = texto.slice(desde, hasta).trim().replace(/\s+/g, " ");
    // La coma que separa de los lugares era del armado, no del premio. En el último no hay nada que separar.
    const premio = i + 1 < rotulos.length ? crudo.replace(/,\s*$/, "") : crudo;
    if (!premio) return null;
    lugares.push({ lugar: Number(m[1]), premio });
  }
  return lugares;
}

/**
 * Lo que se lleva el lugar `lugar` (contando desde el 1, en el orden de los ganadores que dio el sorteo) según el texto
 * sellado. Con premios por lugar es el de ese lugar, o "" si ese lugar quedó sin premio escrito. Sin lugares (un solo
 * premio, un sorteo de antes) es `null`: el texto entero vale para todos, como siempre. Solo lee: no decide quién gana.
 */
export function premioDeLugarEn(meta: string, lugar: number): string | null {
  const lugares = lugaresDeMeta(meta);
  if (lugares === null) return null;
  return lugares.find((l) => l.lugar === lugar)?.premio ?? "";
}

/**
 * Lo que se vuelve a sortear cuando no está quien ganó en los lugares `lugares` («No está»): el premio de cada uno de
 * esos lugares, en el orden dado, y "" si alguno quedó sin premio. Sin lugares es `null`: se vuelve a sortear el premio
 * entero, como siempre. Solo lee el texto: quiénes ganaron y en qué orden lo decidió el sorteo.
 */
export function premiosDeLosLugares(meta: string, lugares: readonly number[]): string[] | null {
  if (lugaresDeMeta(meta) === null) return null;
  return lugares.map((lugar) => premioDeLugarEn(meta, lugar) ?? "");
}
