/**
 * Qué imágenes de `public/juegos/**` quedaron más viejas que el código de su
 * juego. Es la parte pura de `scripts/check-imagenes.mjs`: recibe las fechas
 * (la del último commit que tocó cada archivo) y devuelve qué avisar.
 */

/** Los juegos del selector y los archivos de código de cada uno (rutas desde la raíz, con `*` para lo que siga). */
export const JUEGOS = {
  race: ["src/games/race.ts", "src/games/llamas/*"],
  sapo: ["src/games/pixi/sapo*"],
  trompo: ["src/games/pixi/trompo*"],
  chovena: ["src/games/pixi/chovena*"],
  pinata: ["src/games/pixi/pinata*"],
  wheel: ["src/games/wheel*", "src/games/pixi/wheel*"],
  teleferico: ["src/games/pixi/cablecar*"],
  oruro: ["src/games/pixi/oruro*"],
  // Estos dos se arman sobre el kit: lo que cambia ahí cambia lo que se ve.
  guajojo: ["src/games/pixi/guajojo*", "src/games/pixi/kit/*"],
  toborochi: ["src/games/pixi/toborochi*", "src/games/pixi/kit/*"],
};

const esPrueba = (ruta) => /\.test\.[mc]?[jt]s$/.test(ruta);

/** ¿La ruta cae en alguno de los patrones? `*` final vale por cualquier cosa. */
export function coincide(ruta, patrones) {
  return patrones.some((p) => (p.endsWith("*") ? ruta.startsWith(p.slice(0, -1)) : ruta === p));
}

/** El juego al que pertenece una imagen (`public/juegos/portada/race-light.webp` es `race`), o null. */
export function juegoDeImagen(ruta) {
  const m = /^public\/juegos\/(?:(?:portada|selector)\/)?([a-z]+)(?:-light)?\.webp$/.exec(ruta);
  return m && m[1] in JUEGOS ? m[1] : null;
}

/**
 * `imagenes`: `{ ruta, t }` con `t` en segundos (fecha del último commit que la tocó).
 * `codigos`: `{ ruta, t }` de los archivos de código, ídem. Las pruebas no cuentan.
 * Devuelve, por juego con imágenes viejas, el código más nuevo y las imágenes que lo preceden.
 */
export function imagenesViejas(imagenes, codigos) {
  const viejas = [];
  for (const juego of Object.keys(JUEGOS)) {
    const nuevo = codigos
      .filter((c) => !esPrueba(c.ruta) && coincide(c.ruta, JUEGOS[juego]))
      .reduce((a, c) => (!a || c.t > a.t ? c : a), null);
    if (!nuevo) continue;
    const atrasadas = imagenes.filter((i) => juegoDeImagen(i.ruta) === juego && i.t < nuevo.t).map((i) => i.ruta);
    if (atrasadas.length) viejas.push({ juego, codigo: nuevo.ruta, imagenes: atrasadas });
  }
  return viejas;
}
