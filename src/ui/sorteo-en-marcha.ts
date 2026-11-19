/**
 * El sorteo lanzado que todavía no llegó al show: pasa por las compuertas del modo Oficial, espera el número y arma el
 * resultado. Lo marca `draw.ts` con el sello que se está sorteando y lo mira la cuenta regresiva de `freeze.ts`, que
 * mientras tanto no toca el botón de sortear.
 *
 * Vive aparte de `draw.ts` porque `freeze.ts` no lo puede importar (`draw.ts` importa a `freeze.ts`). Es por sello: el
 * sorteo de otro sello no frena a este. Si una compuerta corta, la marca se va con el intento y el botón vuelve a ser
 * de la cuenta regresiva: nunca queda apagado esperando un sorteo que no arrancó.
 */

let sello: object | null = null;

/** Hay un sorteo en marcha. Con `de`, solo si es el de ese sello. */
export function sorteoEnMarcha(de?: object | null): boolean {
  if (sello === null) return false;
  return de === undefined || sello === de;
}

/** El sorteo de este sello arrancó. */
export function marcarEnMarcha(de: object): void {
  sello = de;
}

/** El sorteo de este sello ya llegó al show, o no siguió. Si la marca es de otro sello, no la toca. */
export function soltarLaMarcha(de: object): void {
  if (sello === de) sello = null;
}
