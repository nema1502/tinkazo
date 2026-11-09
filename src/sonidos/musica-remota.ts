/**
 * De dónde sale la música de archivo de los juegos.
 *
 * Las camas musicales no viajan con el repositorio: las entrega un servicio propio
 * (`workers/musica`, en m.tinkazo.app) y solo al sitio. Este módulo dice la dirección,
 * o `null` si hoy no toca bajarla; con `null` el banco de sonido sigue con los
 * osciladores de siempre, sin error ni hueco.
 *
 * Solo en tinkazo.app y www.tinkazo.app: en localhost, en las vistas de Vercel o en
 * cualquier copia del sitio el servicio contestaría 403, así que ni se pide. Y si el
 * navegador pide ahorrar datos, tampoco.
 */

const SERVICIO = "https://m.tinkazo.app";

/** Los hosts desde los que el servicio entrega música. */
const SITIOS = ["tinkazo.app", "www.tinkazo.app"] as const;

/** Los nombres fijos de las camas, uno por juego. Los mismos que sube `workers/musica/subir.mjs`. */
export const JUEGOS_CON_MUSICA = ["race", "chovena", "trompo", "pinata", "oruro", "wheel", "teleferico", "sapo", "guajojo", "toborochi"] as const;

/** Lo que cambia entre un navegador y otro; se pasa a mano en las pruebas. */
export interface Entorno {
  hostname: string;
  ahorraDatos: boolean;
}

/** Lee el navegador. Sin `location` (pruebas, otro motor) devuelve un host que no recibe música. */
export function leerEntorno(): Entorno {
  let hostname = "";
  let ahorraDatos = false;
  try {
    hostname = location.hostname;
  } catch {
    /* sin dirección */
  }
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    ahorraDatos = nav.connection?.saveData === true || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-data: reduce)").matches);
  } catch {
    /* sin datos de conexión: se asume que no hay ahorro */
  }
  return { hostname, ahorraDatos };
}

/** La dirección de la cama de música del juego, o `null` si hoy no se pide. */
export function urlMusica(juego: string, entorno: Entorno = leerEntorno()): string | null {
  if (!(JUEGOS_CON_MUSICA as readonly string[]).includes(juego)) return null;
  if (!(SITIOS as readonly string[]).includes(entorno.hostname)) return null;
  if (entorno.ahorraDatos) return null;
  return `${SERVICIO}/${juego}.mp3`;
}
