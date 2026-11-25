/**
 * Las partes de `scripts/capturar-vistas.mjs` que hablan con la página pero se pueden
 * probar sin navegador: cada una recibe lo que necesita (el clic, la espera, el reloj)
 * y el guion le pasa lo de verdad. Siguen siendo solo datos: nada de lo que llega de
 * la lista se evalúa como código.
 */

/** El clic con reintento: cuánto espera a que pase lo esperado tras cada clic y cuánto insiste en total. */
export const CLIC_HASTA = { esperaMs: 1000, topeMs: 20_000 };

/**
 * Hace clic en `selector` y espera hasta un segundo a que se vea `hasta`. Si no se ve, vuelve a
 * hacer clic, hasta que pasen 20 s. Sirve cuando la página todavía no estaba lista y el clic no
 * hizo nada. Es para botones que abren algo y no alternan: con uno que alterna, un clic que
 * tardó en notarse se cancelaría con el siguiente. Devuelve cuántos clics hicieron falta.
 *
 * `deps`: `clic(page, selector)`, `estaVisible(page, selector, ms)` (verdadero o falso, sin
 * lanzar), `ahora()` en milisegundos y, si hace falta, `revisar()`, que lanza si la página
 * ya falló por otro motivo y no vale la pena seguir insistiendo.
 */
export async function clicHasta(page, paso, deps) {
  const { clic, estaVisible, ahora, revisar } = deps;
  const inicio = ahora();
  let intentos = 0;
  for (;;) {
    revisar?.();
    intentos++;
    await clic(page, paso.selector);
    if (await estaVisible(page, paso.hasta, CLIC_HASTA.esperaMs)) return intentos;
    if (ahora() - inicio >= CLIC_HASTA.topeMs) {
      throw new Error(`hice clic ${intentos} veces en ${paso.selector} y en ${Math.round(CLIC_HASTA.topeMs / 1000)} s no apareció ${paso.hasta}`);
    }
  }
}
