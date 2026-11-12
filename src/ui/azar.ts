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

/* ------------------------------------------------------------ la ruleta */

/** Los ms entre resaltados cuando la ruleta corre parejo. */
const RAPIDO = 110;
/** La pausa final del recorrido, con la ruleta ya frenada. */
const ULTIMA = 480;
/** El recorrido completo dura ~2,5 s. */
const TOTAL = 2500;
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
 */
export function elegirAlAzar(catalogo: readonly JuegoAzar[], personas: number, semilla: number): Azar {
  const enJuego = catalogo.map((j, indice) => ({ j, indice })).filter(({ j }) => encaja(j, personas));
  if (!enJuego.length) return { elegido: null, recorrido: [] };
  const rng = sembrado(semilla);
  const posicion = Math.floor(rng() * enJuego.length);
  const elegido = enJuego[posicion];
  const arranque = Math.floor(rng() * enJuego.length);
  if (!elegido) return { elegido: null, recorrido: [] };
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
