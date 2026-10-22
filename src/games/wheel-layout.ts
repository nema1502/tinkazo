/**
 * Ruleta: reparto de la lista en gajos. Módulo puro (sin Pixi ni DOM), para
 * poder probarlo en Node.
 *
 * Con veinticuatro personas o menos, cada una tiene su gajo (y la rueda reparte
 * varios por persona cuando hay pocas, ver `wheel.ts`). Con más, la rueda sigue
 * con veinticuatro gajos y cada uno reúne a un grupo de personas seguidas en el
 * orden de la lista. Así el ritmo de los clics es el mismo con veinticinco que
 * con doscientas, y el gajo que gana trae a su grupo: dentro, el lugar del
 * ganador.
 *
 * El reparto depende solo de cuántas personas hay. El ganador no cambia: lo fija
 * el protocolo (docs/protocolo.md), y esto solo dice dónde se ve.
 */

/** Gajos de la rueda cuando hay más de veinticuatro personas. */
export const GAJOS = 24;

/**
 * Parte las personas `0 … n-1` en grupos seguidos, uno por gajo. Los tamaños
 * difieren en una persona como mucho (los primeros grupos llevan la de más),
 * cada persona aparece una sola vez y el orden de la lista se conserva. Con
 * `n <= gajos`, un grupo por persona; sin personas, ningún grupo.
 */
export function repartir(n: number, gajos: number = GAJOS): number[][] {
  const total = Math.max(0, Math.floor(n));
  if (total === 0) return [];
  const cuantos = Math.min(total, Math.max(1, Math.floor(gajos)));
  const base = Math.floor(total / cuantos);
  const extra = total % cuantos;
  const grupos: number[][] = [];
  let desde = 0;
  for (let g = 0; g < cuantos; g++) {
    const tam = base + (g < extra ? 1 : 0);
    const grupo: number[] = [];
    for (let j = 0; j < tam; j++) grupo.push(desde + j);
    grupos.push(grupo);
    desde += tam;
  }
  return grupos;
}

/** El gajo que tiene a la persona `i`, o -1 si no está en el reparto. */
export function gajoDe(grupos: readonly (readonly number[])[], i: number): number {
  return grupos.findIndex((g) => g.includes(i));
}
