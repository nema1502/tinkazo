import type { Idioma } from "./tipos";

/**
 * La leyenda de un juego: de dónde viene.
 *
 * Los juegos con raíz local (el Guajojó, el Toborochi) no cuentan su leyenda
 * durante el show: durante el show, solo el juego (decisión del 26 de
 * octubre de 2026). Cada juego puede traer en cambio una leyenda opcional, en
 * español y en inglés, de hasta cinco líneas y con su fuente, que se muestra en
 * tres lugares y siempre **después** del resultado:
 *
 * 1. una tarjeta plegada debajo del resultado ("¿De dónde viene este juego?");
 * 2. la página de verificación del sorteo;
 * 3. la ficha del juego en `juegos.html`.
 *
 * Ningún dato sin fuente primaria (`games/lore.ts`): sin enlace `https://` y
 * sin título de la fuente, la leyenda no existe. Puro, sin DOM.
 */
export interface Leyenda {
  es: readonly string[];
  en: readonly string[];
  fuente: { titulo: string; url: string };
}

export const MAX_LINEAS = 5;
export const MAX_CARACTERES = 200;

/** Lo que está mal en una leyenda. Vacío si se puede mostrar. */
export function problemasDeLeyenda(l: Leyenda): string[] {
  const p: string[] = [];
  for (const idioma of ["es", "en"] as const) {
    const lineas = l[idioma];
    if (lineas.length < 1 || lineas.length > MAX_LINEAS) p.push(`${idioma}: tiene que haber de 1 a ${MAX_LINEAS} líneas (hay ${lineas.length})`);
    lineas.forEach((x, i) => {
      if (!x.trim()) p.push(`${idioma}: la línea ${i + 1} está vacía`);
      else if (x.length > MAX_CARACTERES) p.push(`${idioma}: la línea ${i + 1} pasa de ${MAX_CARACTERES} caracteres`);
    });
  }
  if (l.es.length !== l.en.length) p.push("las líneas en español y en inglés no son las mismas");
  if (l.es.some((x, i) => x.trim() !== "" && x.trim() === (l.en[i] ?? "").trim() && x.length > 24)) p.push("una línea larga quedó igual en los dos idiomas: falta traducirla");
  if (!l.fuente.titulo.trim()) p.push("falta el título de la fuente");
  if (!/^https:\/\/[^\s]+\.[^\s]+/.test(l.fuente.url)) p.push("la fuente tiene que ser un enlace https");
  return p;
}

/** Lo que se muestra en un idioma: las líneas y la fuente. */
export function leyendaEn(l: Leyenda, idioma: Idioma): { lineas: readonly string[]; fuente: Leyenda["fuente"] } {
  return { lineas: l[idioma], fuente: l.fuente };
}
