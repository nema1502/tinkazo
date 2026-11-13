/**
 * El botón de entrar, para los auditores (13 de noviembre de 2026).
 *
 * Los guiones abrían la lista de entrar tocando el primer botón de la caja de la cabecera (`#wallet-box button`). Con los
 * modos, el primer botón de esa caja es el de Prueba u Oficial, y tocarlo abre la hoja que pregunta en qué modo se sortea:
 * la ventana de ingreso nunca aparecía y todo lo que se mide después de entrar quedaba sin medir.
 *
 * Lo que distingue al botón de entrar es el estado que lleva el chip de la cuenta (`src/ui/cuenta-chip.ts`):
 * `data-estado="fuera"`. Es el mismo marcador que el sitio usa para elegir qué dibujar, así que nadie lo cambia sin
 * querer, y la prueba de este archivo lo arma con el chip de verdad. Dentro, conectando y retomando llevan otro estado:
 * mientras la cuenta no esté afuera, el botón de entrar no existe y las esperas no se adelantan.
 *
 * Primero el botón del cuadro de la herramienta (`#gate`, el de «Entrar» que aparece al pedir la cuenta) y, si no está,
 * el de la cabecera. Es el mismo orden de siempre, con el chip bien elegido.
 *
 * Son expresiones de JavaScript para `page.eval` y `page.waitFor`: se evalúan en la página.
 */

/** El chip de la cabecera cuando la cuenta está afuera: el botón «Entrar». */
export const SELECTOR_CHIP_ENTRAR = "#wallet-box .cuenta-chip[data-estado='fuera']";

/** El cuadro de la herramienta que pide la cuenta. Tiene un solo botón, el de entrar. */
export const SELECTOR_BOTON_DEL_CUADRO = "#gate button";

/** El botón de entrar: el del cuadro de la herramienta si existe y, si no, el de la cabecera. `null` si no hay ninguno. */
export const BOTON_ENTRAR_JS = `(document.querySelector(${JSON.stringify(SELECTOR_BOTON_DEL_CUADRO)}) || document.querySelector(${JSON.stringify(SELECTOR_CHIP_ENTRAR)}))`;

/** Verdadero cuando hay un botón de entrar para tocar. Para `page.waitFor`. */
export const HAY_BOTON_ENTRAR_JS = `!!${BOTON_ENTRAR_JS}`;

/** Toca el botón de entrar. Devuelve `true` si lo tocó y `false` si no había ninguno. Para `page.eval`. */
export const TOCAR_ENTRAR_JS = `(() => { const b = ${BOTON_ENTRAR_JS}; if (!b) return false; b.click(); return true; })()`;
