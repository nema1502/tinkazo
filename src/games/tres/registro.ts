import type { Lanzador } from "./tipos";

/**
 * Qué juegos tienen versión en 3D y cómo se lanzan. Sin editar este archivo: cada `<juego>-3d.ts` de esta carpeta que
 * exporte `lanzador3D` queda registrado solo, con el nombre del juego (el id de `Game`: `trompo-3d.ts` es el trompo,
 * `wheel-3d.ts` la ruleta, `teleferico-3d.ts` el teleférico...). Así nueve personas portan nueve juegos y nadie toca el
 * mismo archivo compartido.
 *
 * Cada módulo se baja recién cuando el 3D está prendido y el juego se va a jugar (`import.meta.glob` perezoso): sin la
 * bandera, el 3D no suma nada a lo que baja el sitio. Y three.js viaja en un trozo con nombre propio que todos
 * comparten (`vite.config.ts`), así que se baja una sola vez por sesión.
 *
 * Si el módulo no baja (el wifi del evento se cortó justo) o no tiene versión, devuelve `null`: el juego sigue en 2D.
 */
type Modulo = { lanzador3D?: () => Promise<Lanzador> };

const MODULOS = import.meta.glob<Modulo>("./*-3d.ts");

const archivoDe = (juego: string): string => `./${juego}-3d.ts`;

/** `true` si el juego tiene versión en 3D (sin bajarla). */
export const tiene3D = (juego: string): boolean => archivoDe(juego) in MODULOS;

/** La versión en 3D del juego lista para lanzar, o null si no hay o no se pudo bajar. */
export async function lanzador3D(juego: string): Promise<Lanzador | null> {
  const carga = MODULOS[archivoDe(juego)];
  if (!carga) return null;
  try {
    const m = await carga();
    return (await m.lanzador3D?.()) ?? null;
  } catch (err) {
    console.warn("[3d] no bajó, sigue el 2D", err);
    return null;
  }
}

/** Baja el módulo del juego sin arrancarlo (la cuenta regresiva sirve para eso). Nunca falla. */
export function precargar3D(juego: string): void {
  void MODULOS[archivoDe(juego)]?.().catch(() => undefined);
}
