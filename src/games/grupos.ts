/**
 * Los grupos automáticos de la lista sellada (sección 8.4 del plan de juegos).
 *
 * Cuando no hay grupos armados por quien organiza, la lista se reparte sola al
 * sellar: cada persona cae en un grupo según su lugar en la lista canónica, y
 * todos los grupos quedan parejos (a cuatro por grupo, con un máximo de diez).
 * El nombre de cada grupo es de un animal de Bolivia y es el mismo en todos los
 * juegos. En el teleférico, el grupo va en una cabina pintada con el color de
 * una línea de Mi Teleférico.
 *
 * Esto es presentación. Quién queda en cada grupo no cambia la chance de nadie,
 * porque cada nombre sigue valiendo uno, y no depende del azar del sorteo: sale
 * solo del orden de la lista, que ya está sellada cuando existe la semilla.
 */

/** Hasta diez grupos: son las diez líneas de Mi Teleférico. */
export const MAX_GRUPOS = 10;

/** A cuántas personas por grupo se apunta. */
export const POR_GRUPO = 4;

/**
 * Los nombres, con su artículo para leerlos en una frase ("las Parabas"). El
 * orden importa: el grupo `g` lleva el color de la línea `g` del teleférico.
 */
export const GRUPOS: readonly { nombre: string; articulo: string }[] = [
  { nombre: "Parabas", articulo: "las" },
  { nombre: "Cóndores", articulo: "los" },
  { nombre: "Vicuñas", articulo: "las" },
  { nombre: "Jucumaris", articulo: "los" },
  { nombre: "Tojos", articulo: "los" },
  { nombre: "Tatús", articulo: "los" },
  { nombre: "Surubís", articulo: "los" },
  { nombre: "Llamas", articulo: "las" },
  { nombre: "Londras", articulo: "las" },
  { nombre: "Tucanes", articulo: "los" },
];

/**
 * El color de cada grupo: el de su línea de Mi Teleférico (Roja, Amarilla,
 * Verde, Azul, Naranja, Blanca, Celeste, Morada, Café y Plateada), el mismo en
 * todos los juegos. En el teleférico pinta la cabina (`LINES` en
 * `pixi/cablecar-plan.ts`, que la prueba compara con esta lista) y en La Entrada
 * el traje de la fraternidad.
 */
export const COLORES: readonly string[] = ["#d7263d", "#e9b000", "#2f9e44", "#1c64c8", "#f2771a", "#ececec", "#5bc0eb", "#7d3c98", "#8b5a2b", "#aab2bd"];

/** Cuántos grupos arma una lista de `n` personas: de a cuatro, hasta diez. */
export function cuantosGrupos(n: number): number {
  return Math.max(1, Math.min(MAX_GRUPOS, Math.ceil(n / POR_GRUPO)));
}

/**
 * El grupo (0 a K-1) de la persona `i` de una lista de `n`. El reparto es de a
 * uno por vez, en el orden de la lista: los grupos quedan de tamaños que
 * difieren en una persona como mucho.
 */
export function grupoDe(i: number, n: number): number {
  return i % cuantosGrupos(n);
}
