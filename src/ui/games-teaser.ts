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
 * largada, con la fila de llamas lista para arrancar — el show entra en el
 * juego sin tocar su escena ni su lógica, que viven en `src/games/` y no se
 * montan hasta que nace la ronda.
 *
 * La regla del cortado (S2 y S4, no se toca lo que de verdad importa): todo lo
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
function ganchoVisual(game: string): { oscura: string; clara: string } | null {
  if (!SELECTOR.includes(game as Game)) return null;
  if (entradaDe(game)?.captura === false) return null;
  return { oscura: `/juegos/selector/${game}.webp`, clara: `/juegos/selector/${game}-light.webp` };
}

/**
 * Una tarjeta: el nombre de una persona, su lugar en la lista sellada y el
 * gancho visual del juego si lo hay.
 */
function tarjeta(nombre: string, gancho: { oscura: string; clara: string } | null, lugar: number, total: number): string {
  const imgs = gancho
    ? `<img class="sel-img sel-osc" src="${gancho.oscura}" width="76" height="43" alt="" loading="lazy" decoding="async" />` +
      `<img class="sel-img sel-cla" src="${gancho.clara}" width="76" height="43" alt="" loading="lazy" decoding="async" />`
    : "";
  return (
    // Sin hoja de estilos propia (esta superficie no toca `styles.css`): los
    // colores los pone el texto de la capa en la que baja (`currentColor`) y
    // el resto es forma.
    `<span class="espera-teaser-tarjeta" role="listitem" data-nombre="${esc(nombre)}" style="display:inline-flex;align-items:center;gap:7px;padding:3px 14px 3px 4px;border:2px solid currentColor;border-radius:999px">` +
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
  // El gancho visual: si el juego elegido no expone captura, la presentación va sin imagen y igual presenta a cada uno (S1, donde exista el gancho).
  const gancho = ganchoVisual(juego);
  caja.innerHTML =
    `<div class="espera-teaser" role="list" data-juego="${esc(juego)}" data-fuente="sellada" aria-label="${esc(t("espTeaserT"))}" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:center;margin:4px 0 2px">` +
    `<p class="espera-teaser-t" style="width:100%;text-align:center;margin:0;font-weight:700">${esc(t("espTeaserT"))}</p>` +
    // Las tarjetas, en el orden sellado: nacen y mueren con la capa, que muere entera al nacer el número.
    nombres.map((nombre, i) => tarjeta(nombre, gancho, i, nombres.length)).join("") +
    `</div>`;
}
