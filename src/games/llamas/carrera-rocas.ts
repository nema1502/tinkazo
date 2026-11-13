import { sembrar } from "../pixi/kit/azar";
import { ZC } from "./carrera-3d-mapa";
import { CARRIL_DURA } from "./carrera-marcha";

/**
 * Los sólidos del terreno de la carrera: las rocas y las matas como una lista pura, en píxeles del mundo 2D. La lista es la única fuente:
 * el 3D la instancia y el 2D la pinta como manchas. Nada de esto decide la carrera.
 *
 * La siembra nueva (`sembrarRocas`) pone las rocas y las matas en los pasillos entre filas y en los bordes, y tira las que tocan la
 * huella de alguna llama en las muestras de su trayectoria: por construcción, nadie atraviesa nada. La lista de siempre
 * (`rocasDeHoy`) queda para comparar contra la siembra anterior.
 */

/** Una roca, una mata o una piedrita: una elipse en el piso, con su alto. */
export interface Roca {
  tipo: "roca" | "mata" | "piedrita";
  /** El centro de la huella, en píxeles del mundo 2D. */
  x: number;
  y: number;
  /** Los semiejes de la elipse en el piso, en píxeles (`a` en el avance, `b` en el fondo del mundo 2D). */
  a: number;
  b: number;
  /** El giro alrededor de la vertical, en radianes. */
  giro: number;
  /** El alto, en píxeles del mundo 2D ya a la escala del dibujo 3D. */
  alto: number;
  /** La piedrita: la fila que la salta. */
  fila?: number;
  /** La piedrita: el tramo de piedras donde está (su lugar en los tramos del plan). */
  tramo?: number;
}

/** El hash del lugar que usaba el 3D para repartir la decoración: depende solo de la casilla, nunca de la hora. */
export function hashLugar(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Lo que necesita la siembra de siempre: las zonas del suelo en píxeles del mundo y la franja de la pista. */
export interface EntradaRocasHoy {
  zonas: readonly { desde: number; hasta: number; tipo: string }[];
  y0: number;
  y1: number;
  u: number;
  F0: number;
  corral: number;
  metaX: number;
}

/**
 * Las rocas y las matas de siempre, como lista: por cada zona de piedras, las rocas; por cada zona de cuesta, las matas. Cada una guarda
 * el tamaño que el 3D le daba (el icosaedro unidad escalado), pasado a semiejes y alto en píxeles, y el giro sobre la vertical.
 */
export function rocasDeHoy(e: EntradaRocasHoy): Roca[] {
  const salida: Roca[] = [];
  const T = 150 * e.u;
  e.zonas.forEach((z, zi) => {
    if (z.tipo !== "piedras" && z.tipo !== "cuesta") return;
    const a = Math.max(e.F0 - e.corral - 400 * e.u, z.desde), b = Math.min(e.metaX + 400 * e.u, z.hasta);
    for (let i = Math.floor(a / T); i * T < b; i++) {
      for (let m = 0; m < 4; m++) {
        const px = i * T + hashLugar(i * 31 + m, zi * 7 + 1) * T;
        if (px < a || px > b) continue;
        const py = lerp(e.y0, e.y1 + 30 * e.u, hashLugar(i * 17 + m, zi * 5 + 3));
        const r = hashLugar(i * 13 + m, zi * 3 + 9);
        if (z.tipo === "piedras") {
          salida.push({ tipo: "roca", x: px, y: py, a: (0.9 + r * 1.1) * 30 * e.u, b: ((0.8 + r) * 30 * e.u) / ZC, giro: r * 7, alto: (0.6 + r * 0.7) * 30 * e.u });
        } else {
          salida.push({ tipo: "mata", x: px, y: py, a: 0.45 * 30 * e.u, b: (0.45 * 30 * e.u) / ZC, giro: 0, alto: (1.2 + r * 0.6) * 30 * e.u });
        }
      }
    }
  });
  return salida.sort((p, q) => p.x - q.x);
}

/* ------------------------------------------------------------ la siembra nueva */

/** La holgura alrededor de cada roca, como fracción del largo de la huella: ni rozarse. */
export const HOLGURA = 0.1;
/** La holgura de costado de un pasillo angosto, como fracción del ancho de la huella: solo donde con `HOLGURA` no entra ninguna roca. */
export const HOLGURA_ANGOSTA = 0.1;
/** El paso entre muestras de trayectoria con que se descarta, en segundos. */
export const PASO_MUESTRA = 1 / 30;
/** El fondo mínimo de una roca, como fracción del ancho de la huella: menos que eso es una raya. */
export const FONDO_MIN = 0.3;
/** El hueco entre rocas de un pasillo, en cuerpos. */
export const ROCA_HUECO: readonly [number, number] = [0.4, 1.4];
/** El largo de una roca, en cuerpos. */
export const ROCA_LARGO: readonly [number, number] = [0.35, 0.9];
/** El fondo total de una roca, como fracción de la distancia entre filas. */
export const ROCA_FONDO: readonly [number, number] = [0.25, 0.45];
/** El alto de una roca de pasillo, como fracción del alto de la llama. */
export const ROCA_ALTO_PASILLO: readonly [number, number] = [0.22, 0.4];
/** El alto de una roca del borde de atrás, como fracción del alto de la llama: ahí van las grandes. */
export const ROCA_ALTO_ATRAS: readonly [number, number] = [0.5, 0.85];
/** El giro de una roca, en radianes, solo alrededor de la vertical. */
export const ROCA_GIRO = 0.35;
/** El radio de una mata, en cuerpos. */
export const MATA_RADIO: readonly [number, number] = [0.1, 0.18];
/** El alto de una mata, como fracción del alto de la llama. */
export const MATA_ALTO: readonly [number, number] = [0.35, 0.55];
/** El hueco entre matas, en cuerpos. */
export const MATA_HUECO: readonly [number, number] = [0.6, 2.0];
/** Los hoyos de mentira por cada echada, para que el hueco de la que se echa no se distinga. */
export const SENUELOS = 2;

/**
 * Hasta qué hora se mira el camino de las llamas para sembrar las rocas, las matas y las piedritas: la carrera entera, no hasta que se abre
 * la recta. Al abrirse la recta las de atrás del grupo todavía cruzan el pedregal mientras pasan a su carril (el auditor de sólidos con
 * navegador encontró a una dentro de una roca en un celular parado), y las echadas siguen echadas en el campo. Cortar cuando la última
 * llega a su carril (`tCarriles` más `CARRIL_DURA`) todavía dejaba dos cuadros en 16 carreras: se mira hasta la meta, que no cuesta, porque
 * cada roca solo mira las muestras que le pasan cerca.
 */
export function finDeLaSiembra(d: { tAbre: number; tCarriles: number; tCrown: number }): number {
  return Math.max(d.tAbre, d.tCrown, d.tCarriles + CARRIL_DURA);
}

/** Lo que necesita la siembra nueva: la semilla de la ronda, las zonas, las filas, la huella y las trayectorias ya muestreadas. */
export interface EntradaRocas {
  semilla: number;
  zonas: readonly { desde: number; hasta: number; tipo: string }[];
  /** El pie de cada fila del grupo (`forma.yPie`), de atrás hacia adelante. */
  filasY: readonly number[];
  y0: number;
  y1: number;
  huella: { atras: number; adelante: number; medio: number; alto: number };
  cuerpo: number;
  /** Las muestras de `crearTrayectorias` a 30 por segundo durante el grupo: cuatro números por muestra (x, y, alza, esc). */
  muestras: Map<number, Float64Array>;
  /**
   * El tamaño de llama con que se armó `huella` (`forma.esc`). Con él, la huella de cada muestra se agranda o se achica con el tamaño de la
   * llama en esa muestra: la que pasa a su carril cambia de tamaño (en un celular parado, casi el doble), y la huella del grupo se le quedaba
   * corta. Sin él, toda muestra usa `huella` tal cual.
   */
  esc?: number;
  echadas: readonly { quien: number; t: number }[];
  /**
   * Por fila (en el orden de `filasY`), cuánto se corre de su línea, hacia arriba y hacia abajo, alguna de las que corren en ella (sus
   * subfilas, `Trayectorias.bandas`): cada pasillo deja libre eso, más un poco, del lado de cada fila. Sin ellas (o en 0), los pasillos
   * de siempre.
   */
  bandas?: readonly { arriba: number; abajo: number }[];
}

interface Pasillo {
  centro: number;
  /** El semieje en y más grande que cabe sin tocar una fila. */
  bMax: number;
  altoMin: number;
  altoMax: number;
  /** La holgura de costado de sus rocas (en y): la de siempre, o la angosta si con la de siempre no entra ninguna. */
  holguraY: number;
}

const entre = (azar: () => number, rango: readonly [number, number]): number => rango[0] + azar() * (rango[1] - rango[0]);

/**
 * ¿La elipse agrandada por la holgura (`holgura` en x, `holguraY` en y) toca la caja de una huella (centro `cx`, `cy`, semiejes de la
 * caja `ax`, `ay`)?
 */
function tocaCaja(r: Roca, holgura: number, holguraY: number, cx: number, cy: number, ax: number, ay: number): boolean {
  const px = Math.max(cx - ax, Math.min(r.x, cx + ax));
  const py = Math.max(cy - ay, Math.min(r.y, cy + ay));
  const dx = (px - r.x) / (r.a + holgura), dy = (py - r.y) / (r.b + holguraY);
  return dx * dx + dy * dy <= 1;
}

/**
 * Las rocas y las matas de la siembra nueva, ordenadas por x. Función pura de la entrada: la misma semilla y las mismas trayectorias
 * dan la misma lista, se la pida como se la pida.
 *
 * El orden: se arman los pasillos entre filas (y los dos bordes), se siembra en cada pasillo con la semilla, se tira todo lo que toca
 * una huella en las muestras (con la elipse agrandada por la holgura y solo si la llama no pasa por encima), y por cada echada se
 * abren además hoyos de mentira en lugares sorteados, para que el hueco de la que se echa no se lea. Las piedritas no entran acá:
 * llegan con su salto, en su paso.
 */
export function sembrarRocas(e: EntradaRocas): Roca[] {
  const zonas = e.zonas.filter((z) => z.tipo === "piedras" || z.tipo === "cuesta");
  if (!zonas.length || !e.filasY.length) return [];
  const azar = sembrar(e.semilla);
  const holgura = HOLGURA * (e.huella.atras + e.huella.adelante);
  const fondoMin = FONDO_MIN * 2 * e.huella.medio;
  const filas = e.filasY;
  const distancia = filas.length > 1 ? (filas[filas.length - 1]! - filas[0]!) / (filas.length - 1) : e.y1 - e.y0;

  // Los pasillos: entre cada par de filas, el borde de atrás (de `y0` a la fila 0) y el de adelante (de la última fila a `y1`).
  const pasillos: Pasillo[] = [];
  // Lo que deja libre cada fila hacia un lado: el medio ancho de la huella, la holgura y, con subfilas, la banda de ese lado más un 2 % del
  // medio ancho de aire (sin ese aire la roca queda justo tangente y el descarte la tira). Sin bandas, el pasillo de siempre: centrado y con
  // el medio ancho y la holgura de cada lado. Si con la holgura de siempre no entra ninguna roca (el celular parado con dos por fila, una en
  // cada subfila), el pasillo usa de costado la holgura angosta, un décimo del ancho de la huella en vez de un décimo del largo: sus rocas
  // son más finas y se descartan con esa misma holgura, así que tampoco tocan a nadie.
  const holguraAngosta = HOLGURA_ANGOSTA * 2 * e.huella.medio;
  const margen = (banda: number, h: number): number => e.huella.medio + h + (banda > 0 ? banda + 0.02 * e.huella.medio : 0);
  const agregar = (bandaArriba: number | null, yArriba: number, bandaAbajo: number | null, yAbajo: number, alto: readonly [number, number]): void => {
    for (const h of [holgura, holguraAngosta]) {
      // `null` es el borde de la pista: guarda el medio ancho y la holgura de siempre, como antes.
      const desde = yArriba + margen(bandaArriba ?? 0, bandaArriba === null ? holgura : h);
      const hasta = yAbajo - margen(bandaAbajo ?? 0, bandaAbajo === null ? holgura : h);
      const bMax = (hasta - desde) / 2;
      if (bMax >= fondoMin / 2) {
        pasillos.push({ centro: (desde + hasta) / 2, bMax, altoMin: alto[0], altoMax: alto[1], holguraY: h });
        return;
      }
    }
  };
  const banda = (f: number, lado: "arriba" | "abajo"): number => e.bandas?.[f]?.[lado] ?? 0;
  agregar(null, e.y0, banda(0, "arriba"), filas[0]!, ROCA_ALTO_ATRAS);
  for (let f = 0; f + 1 < filas.length; f++) agregar(banda(f, "abajo"), filas[f]!, banda(f + 1, "arriba"), filas[f + 1]!, ROCA_ALTO_PASILLO);
  agregar(banda(filas.length - 1, "abajo"), filas[filas.length - 1]!, null, e.y1, ROCA_ALTO_PASILLO);
  if (!pasillos.length) return [];

  // La siembra: pasillo por pasillo y zona por zona, avanzando en x con huecos de la semilla.
  const salida: Roca[] = [];
  /** La holgura de costado de cada roca: la de su pasillo. */
  const holguraDe = new Map<Roca, number>();
  for (const z of zonas) {
    for (const p of pasillos) {
      let x = z.desde;
      for (;;) {
        x += entre(azar, z.tipo === "piedras" ? ROCA_HUECO : MATA_HUECO) * e.cuerpo;
        if (z.tipo === "piedras") {
          const largo = entre(azar, ROCA_LARGO) * e.cuerpo;
          const a = largo / 2;
          if (x + a > z.hasta) break;
          const b = Math.min((entre(azar, ROCA_FONDO) * distancia) / 2, p.bMax);
          const r: Roca = { tipo: "roca", x: x + a, y: p.centro, a, b, giro: (azar() * 2 - 1) * ROCA_GIRO, alto: entre(azar, [p.altoMin, p.altoMax]) * e.huella.alto };
          salida.push(r);
          holguraDe.set(r, p.holguraY);
          x += largo;
        } else {
          const radio = entre(azar, MATA_RADIO) * e.cuerpo;
          if (x + radio > z.hasta) break;
          const r: Roca = { tipo: "mata", x: x + radio, y: p.centro, a: radio, b: Math.min(radio, p.bMax), giro: 0, alto: entre(azar, MATA_ALTO) * e.huella.alto };
          salida.push(r);
          holguraDe.set(r, p.holguraY);
          x += radio * 2;
        }
      }
    }
  }

  // El descarte contra las trayectorias: las huellas de todas las muestras, ordenadas por x para mirar solo las cercanas, cada una con su
  // tamaño (`f`, el de la llama en esa muestra sobre el de la huella).
  const huellas: { x: number; y: number; alza: number; f: number }[] = [];
  let fMax = 1;
  for (const a of e.muestras.values()) {
    for (let i = 0; i + 3 < a.length; i += 4) {
      const f = e.esc ? a[i + 3]! / e.esc : 1;
      if (f > fMax) fMax = f;
      huellas.push({ x: a[i]!, y: a[i + 1]!, alza: a[i + 2]!, f });
    }
  }
  huellas.sort((p, q) => p.x - q.x);
  const xs = huellas.map((h) => h.x);
  const primeraCerca = (x: number): number => {
    let lo = 0, hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const tocaTrayectoria = (r: Roca): boolean => {
    const hy = holguraDe.get(r) ?? holgura;
    const desde = r.x - r.a - holgura - e.huella.adelante * fMax, hasta = r.x + r.a + holgura + e.huella.atras * fMax;
    for (let i = primeraCerca(desde); i < huellas.length && xs[i]! <= hasta; i++) {
      const h = huellas[i]!;
      if (h.alza >= r.alto) continue;
      const atras = e.huella.atras * h.f, adelante = e.huella.adelante * h.f, medio = e.huella.medio * h.f;
      if (Math.abs(h.y - r.y) > r.b + hy + medio) continue;
      if (tocaCaja(r, holgura, hy, h.x + (adelante - atras) / 2, h.y, (atras + adelante) / 2, medio)) return true;
    }
    return false;
  };
  const quedan = salida.filter((r) => !tocaTrayectoria(r));

  // Los señuelos: por cada echada, hoyos de mentira en una fila y un lugar sorteados de su zona, para mezclar el hueco verdadero.
  for (let s = 0; s < e.echadas.length * SENUELOS; s++) {
    const z = zonas[Math.min(zonas.length - 1, Math.floor(azar() * zonas.length))]!;
    const gx = z.desde + azar() * (z.hasta - z.desde);
    const gy = filas[Math.min(filas.length - 1, Math.floor(azar() * filas.length))]!;
    for (let i = quedan.length - 1; i >= 0; i--) {
      const r = quedan[i]!;
      if (Math.abs(r.x - gx) > r.a + holgura + e.huella.atras + e.huella.adelante) continue;
      if (tocaCaja(r, holgura, holguraDe.get(r) ?? holgura, gx + (e.huella.adelante - e.huella.atras) / 2, gy, (e.huella.atras + e.huella.adelante) / 2, e.huella.medio)) quedan.splice(i, 1);
    }
  }
  return quedan.sort((p, q) => p.x - q.x);
}
