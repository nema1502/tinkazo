/**
 * Los emblemas de los participantes: cosas de Bolivia y de la región que se
 * reconocen de un vistazo (una llama, un charango, una salteña), una por
 * persona, para que en un pelotón de treinta cada uno tenga su cara.
 *
 * Este archivo es la parte pura: elige QUÉ emblema y QUÉ color le toca a cada
 * persona. No dibuja nada, no toca el DOM y no usa el azar: con la misma ronda
 * y los mismos nombres devuelve siempre lo mismo, en cualquier equipo. El
 * dibujo vive aparte (`emblemas-dibujo.ts`) y se puede cambiar por el
 * definitivo sin tocar esto: lo único que se comparte son las claves de abajo.
 *
 * Contrato para quien lo use (la carrera de treinta, el módulo de nombres):
 *
 * - `emblemaDe(nombre, ronda)` es el emblema que le toca a ese nombre en esa
 *   ronda, mirándolo solo a él. Dos personas distintas pueden caer en el mismo.
 * - `emblemasDe(nombres, ronda)` es el que hay que usar con una lista entera:
 *   hasta 32 personas nadie repite emblema, y con más nadie repite emblema y
 *   color (hasta 256; después, lo más parejo posible). El resultado no
 *   depende del orden de la lista: cada persona conserva el suyo si se
 *   reordena.
 * - La clave (`clave`) nombra el dibujo; el color (`color`) es el del aro de
 *   la ficha. La silueta es lo principal y el color, lo secundario: nadie
 *   debe depender del color para distinguir a dos personas.
 *
 * Nada de acá depende de quién gana: el emblema sale del nombre y de la ronda,
 * y la ronda ya es pública cuando se sella la lista.
 */

/** Las 32 claves, agrupadas por categoría. Cambiar un dibujo no cambia la clave. */
export const CLAVES = [
  // Fauna
  "llama",
  "condor",
  "flamenco",
  "paraba",
  "tucan",
  "jaguar",
  "oso",
  "capibara",
  "bufeo",
  "tatu",
  "caiman",
  "perezoso",
  "rana",
  // Comida
  "saltena",
  "cunape",
  "papa",
  "maiz",
  "aji",
  // Instrumentos y objetos
  "charango",
  "zampona",
  "aguayo",
  "trompo",
  "teleferico",
  "sombrero",
  "bombo",
  // Plantas
  "toborochi",
  "cantuta",
  "cactus",
  "palmera",
  // Paisaje y otros
  "mariposa",
  "montana",
  "sol",
] as const;

export type ClaveEmblema = (typeof CLAVES)[number];

/**
 * Los ocho colores del aro. Los cinco primeros son los acentos de la casa
 * (docs/marca.md); los otros tres separan a quienes comparten emblema cuando
 * la lista pasa de 32.
 */
export const COLORES = [
  "#e93d9c", // magenta
  "#ff7a1a", // naranja
  "#00a896", // turquesa
  "#ffc629", // amarillo
  "#6c4ce0", // morado
  "#2f7de1", // azul
  "#e5383b", // rojo
  "#4caf50", // verde
] as const;

export interface Emblema {
  clave: ClaveEmblema;
  /** El color del aro, en hex de seis cifras. */
  color: string;
  /** La posición del color en `COLORES`, por si hace falta un nombre estable. */
  tono: number;
}

/** Cuántas combinaciones de emblema y color hay. */
export const COMBINACIONES = CLAVES.length * COLORES.length;

/** Lo que identifica una ronda: su número, o el `randomness` de la baliza. */
export type Ronda = number | string;

/**
 * FNV-1a de 32 bits sobre los puntos de código, más el mezclador final de
 * MurmurHash3. Sin criptografía: lo único que se pide es que el mismo texto
 * dé siempre el mismo número y que textos parecidos se separen bien.
 */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (const ch of texto) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** El mismo nombre escrito con otra forma Unicode ("é" suelta o compuesta) da lo mismo. */
const forma = (nombre: string): string => nombre.normalize("NFC").trim();

/** El número de la persona en el intento `k` (0 es el primero, 1 en adelante son los desempates). */
const semilla = (nombre: string, ronda: Ronda, k: number): number =>
  hash(`${String(ronda)}\u0000${forma(nombre)}\u0000${k}`);

const emblemaDeSemilla = (h: number): Emblema => {
  const tono = (h >>> 5) % COLORES.length;
  return {
    clave: CLAVES[h % CLAVES.length] as ClaveEmblema,
    color: COLORES[tono] as string,
    tono,
  };
};

/** El emblema que le toca a un nombre en una ronda, mirándolo solo a él. */
export function emblemaDe(nombre: string, ronda: Ronda): Emblema {
  return emblemaDeSemilla(semilla(nombre, ronda, 0));
}

/** La posición de un emblema entre las `COMBINACIONES`. */
const combinacion = (e: Emblema): number => CLAVES.indexOf(e.clave) * COLORES.length + e.tono;

const deCombinacion = (c: number): Emblema => {
  const tono = c % COLORES.length;
  return {
    clave: CLAVES[Math.floor(c / COLORES.length) % CLAVES.length] as ClaveEmblema,
    color: COLORES[tono] as string,
    tono,
  };
};

/** Cuántas veces intenta desempatar con el azar sembrado antes de recorrer todas las combinaciones. */
const INTENTOS = 64;

/**
 * Los emblemas de una lista entera, uno por nombre y en el mismo orden.
 *
 * Cada persona tiene un primer emblema (el de `emblemaDe`). Si ya lo tiene otra,
 * prueba con el siguiente que le toca a ella (`semilla(…, 1)`, `2`, …) hasta
 * hallar uno libre. Se reparte por la semilla de cada una y no por el lugar en
 * la lista, así reordenar la lista no cambia el emblema de nadie.
 *
 * - Hasta 32 personas, ningún emblema se repite.
 * - Con más, ninguno se usa más de `ceil(n / 32)` veces y ninguna combinación
 *   de emblema y color más de `ceil(n / 256)`: nadie comparte emblema y color
 *   hasta 256 personas.
 *
 * Si dos nombres son idénticos, empata el lugar en la lista.
 */
export function emblemasDe(nombres: readonly string[], ronda: Ronda): Emblema[] {
  const n = nombres.length;
  const topeClave = Math.max(1, Math.ceil(n / CLAVES.length));
  const topePar = Math.max(1, Math.ceil(n / COMBINACIONES));
  const porClave = new Map<string, number>();
  const porPar = new Map<number, number>();
  const libre = (e: Emblema): boolean =>
    (porClave.get(e.clave) ?? 0) < topeClave && (porPar.get(combinacion(e)) ?? 0) < topePar;
  const tomar = (e: Emblema): Emblema => {
    porClave.set(e.clave, (porClave.get(e.clave) ?? 0) + 1);
    const c = combinacion(e);
    porPar.set(c, (porPar.get(c) ?? 0) + 1);
    return e;
  };

  const orden = nombres
    .map((nombre, i) => ({ i, h: semilla(nombre, ronda, 0) }))
    .sort((a, b) => a.h - b.h || a.i - b.i);

  const res = new Array<Emblema>(n);
  for (const { i, h } of orden) {
    const nombre = nombres[i] as string;
    let e = emblemaDeSemilla(h);
    for (let k = 1; !libre(e) && k <= INTENTOS; k++) e = emblemaDeSemilla(semilla(nombre, ronda, k));
    if (!libre(e)) {
      // Casi todo ocupado: se recorren las combinaciones desde la suya. Siempre
      // queda una libre porque los topes suman más que la cantidad de personas.
      const desde = combinacion(emblemaDeSemilla(h));
      for (let j = 0; j < COMBINACIONES && !libre(e); j++) e = deCombinacion((desde + j) % COMBINACIONES);
    }
    res[i] = tomar(e);
  }
  return res;
}
