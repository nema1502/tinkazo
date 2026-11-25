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
 * ("1 de 3") y, cuando el juego elegido lo trae, su gancho visual: la captura
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
 * Cuántas personas caben en la presentación de una pantalla ancha. La presentación es de la lista entera o de nadie:
 * con más personas que tarjetas no aparece, porque mostrar solo a las primeras las destacaría justo antes del sorteo,
 * como si fueran las elegidas. Entonces la espera queda con el reloj y las cintas de nombres, que pasan a todas.
 */
export const TOPE_TARJETAS = 6;

/** Hasta este ancho (en píxeles) la pantalla es de celular: cada tarjeta ocupa una fila entera. */
export const ANCHO_ANGOSTO = 480;

/**
 * Cuántas personas caben en la presentación de un celular. Con cada tarjeta en su propia fila, seis ocuparían casi toda
 * la pantalla: con dos, el titular, el reloj y las cintas entran. Con más, no hay presentación (ver `TOPE_TARJETAS`).
 */
export const TOPE_TARJETAS_ANGOSTO = 2;

/** ¿Pantalla de celular? Se consulta cada vez que se arma: un celular que se gira cambia de ancho con la cuenta en marcha. */
function esAngosta(): boolean {
  return typeof matchMedia === "function" && matchMedia(`(max-width: ${ANCHO_ANGOSTO}px)`).matches;
}

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
 * Solo aparece si entran todas las personas de la lista en las tarjetas que
 * caben en esta pantalla. Si no, deja la caja vacía y la espera queda con el
 * reloj y las cintas de siempre: nunca se presenta un pedazo de la lista. Se
 * decide cada vez que se llama, así que un celular que gira con la cuenta en
 * marcha la muestra o la quita según el ancho nuevo.
 *
 * `nombres` son los nombres ya listos para mostrar (los de las cintas, con las
 * etiquetas de equipos resueltas). Con caja o lista vacías no arma nada: el
 * show queda como siempre.
 */
export function presentarTeaser(caja: HTMLElement | null, juego: string, nombres: readonly string[]): void {
  if (!caja) return;
  // La cantidad que caben la decide el ancho de la pantalla de ahora.
  const tope = esAngosta() ? TOPE_TARJETAS_ANGOSTO : TOPE_TARJETAS;
  if (nombres.length === 0 || nombres.length > tope) {
    // Sin presentación: la caja vacía no ocupa lugar (styles.css) y la próxima vez que entren todas se arma de cero.
    delete caja.dataset.clave;
    caja.replaceChildren();
    return;
  }
  // El gancho visual: si el juego elegido no expone captura, la presentación va sin imagen y igual presenta a cada uno.
  const gancho = ganchoVisual(juego);
  // Lo mismo que ya está armado no se rehace: un cambio de tamaño que deja lo mismo no parpadea las tarjetas.
  const clave = [juego, gancho ?? "", getLang(), nombres.join("\u0000")].join("|");
  if (caja.dataset.clave === clave && caja.firstElementChild) return;
  caja.dataset.clave = clave;
  caja.innerHTML =
    `<div class="espera-teaser" role="list" data-juego="${esc(juego)}" data-fuente="sellada" aria-label="${esc(t("espTeaserT"))}">` +
    `<p class="espera-teaser-t">${esc(t("espTeaserT"))}</p>` +
    // Las tarjetas, una por persona y en el orden sellado: nacen y mueren con la capa, que muere entera al nacer el número.
    nombres.map((nombre, i) => tarjeta(nombre, gancho, i, nombres.length)).join("") +
    `</div>`;
  // Una captura que no llega (la red del evento falla) se esconde sin quitarla: su lugar ya está reservado, así que la tarjeta
  // no cambia de tamaño, nada empuja al reloj y tampoco queda el ícono de imagen rota.
  for (const img of caja.querySelectorAll<HTMLImageElement>(".sel-img")) {
    img.addEventListener("error", () => img.setAttribute("data-fallo", ""), { once: true });
  }
}
