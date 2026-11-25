import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { SELECTOR } from "./recomendar";
import { entradaDe } from "../games/pixi/kit/catalogo";
import type { Game } from "../state";

/**
 * Presentar a los de la lista sellada durante la cuenta del show (issue #78).
 *
 * Mientras la espera en grande cuenta los segundos que faltan, cada persona
 * que participa se presenta una vez: su nombre, su lugar en la lista sellada
 * («1 de 3») y, cuando el juego elegido lo trae, su gancho visual: la captura
 * que el juego ya publica (`/juegos/selector/…`, la usan el selector de la
 * página y el panel de la espera). Para la Carrera de llamas esa captura es la
 * largada, con la fila de llamas lista para arrancar. El show entra en el
 * juego sin tocar su escena ni su lógica, que viven en `src/games/` y no se
 * montan hasta que nace la ronda.
 *
 * La regla de lo sellado: todo lo
 * que se ve acá sale de la lista sellada que entra por parámetro, con su orden
 * tal cual. Del resultado no sale nada, porque todavía no existe: la
 * presentación se arma mientras la cuenta corre, antes de que nazca la ronda.
 * Nada de esto usa `app.drawn`, ni nombra a quien gana, ni toca la selección.
 */

/**
 * ¿El juego tiene gancho visual? La misma regla del panel de la espera
 * (`tieneCaptura` de espera.ts, que no se importa de vuelta para no cerrar un
 * círculo): hay captura para los juegos del selector y, de los del kit,
 * aquellos que nacieron con la suya. Devuelve las dos rutas (tema oscuro y
 * tema claro) o nada.
 */
function ganchoVisual(game: string): string | null {
  if (!SELECTOR.includes(game as Game)) return null;
  if (entradaDe(game)?.captura === false) return null;
  // Una sola captura por tarjeta, la del tema con que se ve la sala. Las reglas que esconden la otra en styles.css
  // valen solo dentro del selector de juegos, y la capa de la espera no está ahí: sin elegir, se pedían las dos
  // por persona.
  return temaOscuro() ? `/juegos/selector/${game}.webp` : `/juegos/selector/${game}-light.webp`;
}

/** El tema con que se ve la sala: el forzado de la página si lo hay, y si no, el del sistema (la misma regla del motor de los juegos). */
function temaOscuro(): boolean {
  const forzado = document.documentElement.dataset.theme;
  if (forzado === "dark") return true;
  if (forzado === "light") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Cuántas personas se presentan como mucho. Con 150 en la lista, una tarjeta por persona empujaba el reloj y las
 * cintas fuera de la pantalla, que es lo primero que ve la sala: las demás se cuentan en una línea. La lista
 * entera sigue visible en las cintas de abajo.
 */
export const TOPE_TARJETAS = 6;

/**
 * Una tarjeta: el nombre de una persona, su lugar en la lista sellada y el
 * gancho visual del juego si lo hay.
 */
function tarjeta(nombre: string, gancho: string | null, lugar: number, total: number): string {
  const imgs = gancho ? `<img class="sel-img" src="${gancho}" width="76" height="43" alt="" loading="lazy" decoding="async" />` : "";
  return (
    // El aspecto vive en styles.css (`.espera-teaser-tarjeta`), con los colores de la marca.
    `<span class="espera-teaser-tarjeta" role="listitem" data-nombre="${esc(nombre)}">` +
    imgs +
    `<b>${esc(nombre)}</b>` +
    `<small>${esc(T[getLang()].espTeaserDe(lugar + 1, total))}</small>` +
    `</span>`
  );
}

/**
 * Arma la presentación de la lista sellada: el titular y una tarjeta por
 * persona, en el orden de la lista. Todo queda a la vista de la sala durante
 * la cuenta; como la capa entera se cierra al nacer el número o al salir
 * (`cerrar` de espera.ts la quita del documento), no hay temporizadores ni
 * nada que parar.
 *
 * `nombres` son los nombres ya listos para mostrar (los de las cintas, con las
 * etiquetas de equipos resueltas). Con caja o lista vacías no arma nada: el
 * show queda como siempre.
 */
export function presentarTeaser(caja: HTMLElement | null, juego: string, nombres: readonly string[]): void {
  if (!caja || nombres.length === 0) return;
  // El gancho visual: si el juego elegido no expone captura, la presentación va sin imagen y igual presenta a cada uno.
  const gancho = ganchoVisual(juego);
  const resto = nombres.length - TOPE_TARJETAS;
  caja.innerHTML =
    `<div class="espera-teaser" role="list" data-juego="${esc(juego)}" data-fuente="sellada" aria-label="${esc(t("espTeaserT"))}">` +
    `<p class="espera-teaser-t">${esc(t("espTeaserT"))}</p>` +
    // Las tarjetas, en el orden sellado y hasta el tope: nacen y mueren con la capa, que muere entera al nacer el número.
    nombres.slice(0, TOPE_TARJETAS).map((nombre, i) => tarjeta(nombre, gancho, i, nombres.length)).join("") +
    // Las que no entran, contadas en una línea: la lista entera sigue en las cintas.
    (resto > 0 ? `<span class="espera-teaser-mas" role="listitem">${esc(T[getLang()].espTeaserMas(resto))}</span>` : "") +
    `</div>`;
}
