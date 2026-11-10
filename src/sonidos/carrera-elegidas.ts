import type { Eleccion, Pieza } from "./carrera";

/**
 * Lo que suena en la carrera, pieza por pieza.
 *
 * Este archivo lo reescribe `scripts/sonidos/carrera-aplicar.mjs` con lo que se eligió escuchando en la página de
 * escucha (la que arma `scripts/sonidos/carrera-armar-escucha.mjs`). Mientras no se elija, todo es `hoy`:
 * el sitio suena exactamente como antes y ningún sonido nuevo se prende sin que alguien lo escuche.
 */
export const ELEGIDAS: Readonly<Record<Pieza, Eleccion>> = {
  musica: "hoy",
  pasos: "hoy",
  echarse: "hoy",
  obstaculos: "hoy",
  final: "hoy",
  festejo: "hoy",
};

/**
 * El bombo y el bajo de la música (`MEZCLA_GRAVE_PARLANTE_CHICO` en `src/music.ts`): `hoy` los deja como suenan en
 * producción y la mezcla para parlante chico solo suena con el arreglo de una candidata de la carrera; `chico` los pone
 * así también en la música de los diez juegos. Lo reescribe `carrera-aplicar.mjs` con lo que se eligió escuchando.
 */
export const BOMBO_Y_BAJO: "hoy" | "chico" = "hoy";
