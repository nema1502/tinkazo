import { esc } from "../dom";
import { entradaDe } from "../games/pixi/kit/catalogo";
import { leyendaEn, type Leyenda } from "../games/pixi/kit/leyenda";

/**
 * La leyenda de un juego, después del resultado.
 *
 * Los juegos con raíz local traen una leyenda opcional en el catálogo del kit
 * (`kit/catalogo.ts`, `kit/leyenda.ts`): hasta cinco líneas, en español y en
 * inglés, con su fuente. Nunca se cuenta durante el show: sale **después** del
 * resultado, en una tarjeta plegada, "¿De dónde viene este juego?", en tres
 * lugares: debajo del resultado (`draw.ts`), en la página de verificación
 * (`verificar.html?juego=<id>`) y en la ficha del juego en `juegos.html`.
 *
 * No importa el diccionario del sitio: la herramienta y la página de
 * verificación cargan diccionarios distintos, así que cada una pasa su idioma
 * y sus rótulos.
 */
export interface Rotulos {
  titulo: string;
  fuente: string;
}

/** El HTML de la tarjeta plegada, o `null` si el juego no trae leyenda. Cerrada de entrada: nadie la lee en medio del sorteo. */
export function htmlDeLeyenda(leyenda: Leyenda | undefined, idioma: "es" | "en", rotulos: Rotulos): string | null {
  if (!leyenda) return null;
  const { lineas, fuente } = leyendaEn(leyenda, idioma);
  return (
    `<details class="leyenda-det"><summary>${esc(rotulos.titulo)}</summary>` +
    lineas.map((x) => `<p>${esc(x)}</p>`).join("") +
    `<a class="mono lore-src" href="${esc(fuente.url)}" target="_blank" rel="noopener">${esc(rotulos.fuente)}: ${esc(fuente.titulo)} ↗</a>` +
    `</details>`
  );
}

/** Pinta la leyenda del juego `id` en la caja, o la esconde si no trae. */
export function pintarLeyenda(caja: HTMLElement, id: string | null | undefined, idioma: "es" | "en", rotulos: Rotulos): void {
  const html = id ? htmlDeLeyenda(entradaDe(id)?.leyenda, idioma, rotulos) : null;
  caja.innerHTML = html ?? "";
  caja.style.display = html ? "block" : "none";
}
