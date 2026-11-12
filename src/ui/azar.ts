/**
 * El botón Sorprendeme del panel Elegí el juego (`espera.ts`): elige con qué juego
 * contar el sorteo cuando quien organizó no quiere elegir. Es un módulo puro:
 * dado el catálogo de juegos del panel, la cantidad de personas de la ronda y
 * una semilla, devuelve el juego elegido y el recorrido de resaltados de la
 * animación (tipo ruleta: corre parejo y desacelera antes de quedar).
 *
 * Dada la misma semilla sale siempre lo mismo: la elegibilidad y el orden de
 * la animación se reproducen en pruebas. Nada de esto entra al sorteo de
 * verdad: el ganador lo fija el protocolo antes de que exista este botón, y
 * el juego elegido acá solo decide con qué escena se narra.
 *
 * El generador es mulberry32, el mismo de los juegos (`games/pixi/stage.ts`,
 * `seeded`), copiado acá para no arrastrar esa pieza (y PixiJS con ella) al
 * paquete de la espera.
 */

/** El tramo de personas de un juego: el mismo de `ui/recomendar.ts` (`RANGOS`), sin el puntaje que ahí solo desempata. */
export interface RangoAzar {
  minimo?: number;
  maximo?: number;
}

/** Un juego del catálogo del panel, con su tramo de personas. */
export interface JuegoAzar {
  game: string;
  rango: RangoAzar;
}

/** Un resaltado de la animación: la tarjeta `indice` del catálogo, que se sostiene `pausa` ms antes del siguiente. */
export interface PasoAzar {
  indice: number;
  pausa: number;
}

/** Lo que sale del sorteo al azar: el juego y el camino de la animación hasta él. */
export interface Azar {
  /** El juego elegido, o `null` si con esa cantidad no encaja ninguno. */
  elegido: JuegoAzar | null;
  /** Los resaltados en orden; el último es el elegido. Vacío si no hubo elegido. */
  recorrido: PasoAzar[];
}

/** El generador sembrado, el mismo de todos los juegos (`games/pixi/stage.ts`). */
function sembrado(semilla: number): () => number {
  let s = semilla | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** ¿El juego encaja con `personas`? Los extremos cuentan, como en la tarjeta del selector (`rangoVisible`). */
function encaja(j: JuegoAzar, personas: number): boolean {
  return personas >= (j.rango.minimo ?? 2) && personas <= (j.rango.maximo ?? 200);
}

/**
 * Los juegos del catálogo que pueden salir con `personas`, en el orden del catálogo. Con más de doscientas personas (o con
 * una sola) no queda ninguno: la espera usa esto para no ofrecer Sorprendeme cuando no hay a dónde ir.
 */
export function posiblesDe(catalogo: readonly JuegoAzar[], personas: number): JuegoAzar[] {
  return catalogo.filter((j) => encaja(j, personas));
}

/**
 * Las tarjetas en el orden en que da la vuelta una luz: por el ángulo de cada una alrededor del centro de la lista. En
 * una grilla de dos filas, la de arriba va de izquierda a derecha y la de abajo de derecha a izquierda, así la luz no
 * salta de una punta a la otra. Es pura: `centroDe` dice dónde está cada tarjeta (el navegador mide, la prueba inventa)
 * y, si no se sabe (todas en el mismo punto), queda el orden de siempre.
 */
export function enRueda<T>(tarjetas: readonly T[], centroDe: (t: T) => { x: number; y: number }, centro: { x: number; y: number }): T[] {
  const angulo = (t: T): number => {
    const c = centroDe(t);
    return Math.atan2(c.y - centro.y, c.x - centro.x);
  };
  return tarjetas
    .map((t, i) => ({ t, i, a: angulo(t) }))
    .sort((p, q) => p.a - q.a || p.i - q.i)
    .map(({ t }) => t);
}

/* ------------------------------------------------------------ la ruleta */

/** Los ms entre resaltados cuando la ruleta corre parejo. */
const RAPIDO = 110;
/** La pausa final del recorrido, con la ruleta ya frenada. */
const ULTIMA = 480;
/** El recorrido completo dura ~2,5 s. */
const TOTAL = 2500;
/**
 * Cuánto se queda la tarjeta donde cayó antes de que el panel se cierre. La sala lo lee desde el fondo: con la pausa de
 * un paso de la ruleta (medio segundo) el resultado pasaba sin verse, y lo único que quedaba era el nombre chico de
 * arriba.
 */
export const QUEDA_MS = 1400;
/** Los pasos del recorrido: pocas tarjetas dan más vueltas, muchas menos. */
const PASOS_MIN = 10;

/**
 * Las pausas de un recorrido de `pasos` resaltados: una por paso, primero
 * parejas (`RAPIDO`) y después creciendo en curva cuadrática hasta `ULTIMA`.
 * El total ronda los `TOTAL` ms. Es pura: la animación de `espera.ts` solo la
 * ejecuta con sus temporizadores.
 */
export function pausasDe(pasos: number): number[] {
  if (pasos <= 0) return [];
  const n = Math.max(1, Math.floor(pasos));
  if (n === 1) return [ULTIMA];
  const parejas = Math.max(1, Math.round(n * 0.45));
  const frenadas = n - parejas;
  // La curva de frenado: de RAPIDO a ULTIMA, con la desaceleración al final del final.
  const forma =
    frenadas === 1
      ? [ULTIMA]
      : Array.from({ length: frenadas }, (_, j) => RAPIDO + (ULTIMA - RAPIDO) * (j / (frenadas - 1)) ** 2);
  const fijo = parejas * RAPIDO;
  const resto = Math.max(RAPIDO * frenadas, TOTAL - fijo);
  const escala = resto / forma.reduce((a, b) => a + b, 0);
  return [
    ...Array<number>(parejas).fill(RAPIDO),
    ...forma.map((v) => Math.max(RAPIDO, Math.round(v * escala))),
  ];
}

/**
 * El sorteo al azar del botón. `catalogo` son los juegos del panel (los que
 * muestra el selector para esta ronda, con su `rango`); `personas`, la
 * cantidad de la entrada; `semilla`, el número que deja reproducible todo lo
 * que sigue. Encajan los juegos cuyo tramo incluye a la gente, y entre ellos
 * sale uno parejo: la semilla pasa dos veces por el generador (una para el
 * elegido, otra para la tarjeta donde arranca la ruleta) y de allí salen las
 * vueltas hasta caer en el elegido, con las pausas de `pausasDe`.
 *
 * `excluir` es el juego que ya estaba elegido: con dos o más posibles no sale
 * (para quien organiza, caer en el mismo es como si no hubiera pasado nada), pero
 * sigue en el camino de la ruleta, que recorre todas las tarjetas posibles.
 */
export function elegirAlAzar(catalogo: readonly JuegoAzar[], personas: number, semilla: number, excluir?: string): Azar {
  const enJuego = catalogo.map((j, indice) => ({ j, indice })).filter(({ j }) => encaja(j, personas));
  if (!enJuego.length) return { elegido: null, recorrido: [] };
  const rng = sembrado(semilla);
  const candidatos = excluir !== undefined && enJuego.length >= 2 ? enJuego.filter(({ j }) => j.game !== excluir) : enJuego;
  const elegido = candidatos[Math.floor(rng() * candidatos.length)];
  const arranque = Math.floor(rng() * enJuego.length);
  if (!elegido) return { elegido: null, recorrido: [] };
  const posicion = enJuego.indexOf(elegido);
  const delta = (posicion - arranque + enJuego.length) % enJuego.length;
  // Vueltas completas antes de caer en el elegido: con pocas tarjetas, más vueltas (el mismo tramo de tiempo); con
  // ocho o más, una vuelta alcanza.
  const vueltas = enJuego.length >= 8 ? 1 : Math.max(2, Math.ceil(PASOS_MIN / enJuego.length));
  const pasos = vueltas * enJuego.length + delta + 1;
  const pausas = pausasDe(pasos);
  const recorrido: PasoAzar[] = [];
  let pos = arranque;
  for (const pausa of pausas) {
    const enJuegoPaso = enJuego[pos];
    if (!enJuegoPaso) break;
    recorrido.push({ indice: enJuegoPaso.indice, pausa });
    pos = (pos + 1) % enJuego.length;
  }
  return { elegido: elegido.j, recorrido };
}
