/**
 * La tarjeta de nombres de la carrera en un celular parado, pura: cuántas columnas, de qué tamaño de letra y cuánto mide, para que ocupe
 * el 25 % de la pantalla como mucho (sección 4 de la dirección de la carrera, "El celular").
 *
 * Hoy la tarjeta era una lista en una o dos columnas centrada en la pantalla: con 18 personas tapaba el 28 % y el corral entero; con 30, más
 * de un tercio. Acá se elige, de las formas que entran a lo ancho de la pantalla, la que menos área ocupa:
 *
 * 1. Con los nombres enteros y la letra de siempre. Más columnas es una tarjeta más baja y más ancha; una columna de más no entra.
 * 2. Si ninguna llega al tope, la letra baja de a un 8 % hasta el mínimo que se lee (`pxMinimo`, 16 px en un celular).
 * 3. Si todavía no, los nombres cortos ("María M."), los mismos de las fichas de las llamas.
 *
 * Un nombre más ancho que su columna se parte en dos renglones por el espacio más cercano al medio, nunca se corta con «…». Si ni así entra
 * (una sola palabra larguísima, o un nombre de decenas de letras), la tarjeta no falla: primero se prueba partir ese nombre por las letras y,
 * solo si todavía no cabe, se le corta lo que sobra con «…». Eso se hace con ese nombre y no con los demás: los otros siguen enteros. Sin DOM
 * ni Pixi: el ancho de un texto lo da quien llama (`medir`).
 */

export interface EntradaTarjeta {
  /** Los nombres, en el orden en que van a leerse, enteros y en su forma corta. */
  textos: readonly string[];
  cortos: readonly string[];
  /** El ancho de un texto en píxeles a un tamaño de letra. */
  medir(texto: string, px: number): number;
  /** La pantalla y su unidad de diseño. */
  w: number;
  h: number;
  u: number;
  /** El tamaño de letra de siempre y el menor que se permite. */
  pxNominal: number;
  pxMinimo: number;
  /** Cuánto de la pantalla puede ocupar, de 0 a 1 (0,25 en el celular). */
  tope?: number;
}

export interface DisenoTarjeta {
  cols: number;
  filas: number;
  px: number;
  /** Se usan los nombres cortos. */
  corto: boolean;
  /** El ancho de cada columna y qué nombres van en dos renglones. */
  anchoCol: number[];
  dosLineas: boolean[];
  /** El texto de cada nombre tal como se dibuja: con un salto de renglón (`\n`) si va en dos y, de ser necesario, cortado. Es lo que hay que poner en pantalla. */
  rotulos: string[];
  /** El alto de cada renglón y el relleno de la tarjeta. */
  lineaH: number;
  padX: number;
  padY: number;
  gap: number;
  /** La tarjeta entera, con su relleno, y qué parte de la pantalla ocupa (de 0 a 1). */
  w: number;
  h: number;
  parte: number;
}

/** Parte un nombre en dos líneas por el espacio más cercano al medio. */
export function partirEnDos(nombre: string): string[] {
  const p = nombre.split(" ");
  if (p.length < 2) return [nombre];
  let mejor = 1, dif = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p.slice(0, i).join(" ").length, b = p.slice(i).join(" ").length;
    if (Math.abs(a - b) < dif) {
      dif = Math.abs(a - b);
      mejor = i;
    }
  }
  return [p.slice(0, mejor).join(" "), p.slice(mejor).join(" ")];
}

/** Las columnas máximas que prueba: en 390 px de ancho, más de cuatro dejan columnas de 80 px. */
const COLUMNAS_MAX = 4;
/** Cuánto de la pantalla a lo ancho puede ocupar la tarjeta, y el pasito con que baja la letra. */
const ANCHO_MAX = 0.96;
const BAJA_LETRA = 0.92;

/**
 * Qué se le permite a un nombre que no entra en su columna: nada (se descarta la forma), partirse por las letras, o además cortarse con «…».
 * Cada modo admite todo lo del anterior.
 */
type Corte = "no" | "letras" | "puntos";

const PUNTOS = "…";

/** El mayor número de letras, de `minimo` a `n`, para el que `cabe` es verdad (el ancho crece con las letras: se busca por la mitad). */
function mayorQueCabe(n: number, minimo: number, cabe: (m: number) => boolean): number {
  let lo = minimo, hi = n;
  while (lo < hi) {
    const medio = Math.ceil((lo + hi) / 2);
    if (cabe(medio)) lo = medio;
    else hi = medio - 1;
  }
  return lo;
}

/**
 * Los renglones de un nombre que no entra en `maxCol` ni partido en dos por un espacio. Por la mitad de las letras si cada mitad cabe; si no, el
 * primer renglón lleno hasta donde entra y el segundo con lo que sigue, cortado con «…» si tampoco cabe (`null` si no se permite cortar).
 * Se cuentan las letras como las ve el ojo (un emoji es una sola), nunca una mitad de un par sustituto.
 */
function partirPorLetras(e: EntradaTarjeta, t: string, px: number, maxCol: number, corte: Corte): string[] | null {
  const letras = Array.from(t);
  const junta = (desde: number, hasta: number): string => letras.slice(desde, hasta).join("");
  const cabe = (s: string): boolean => e.medir(s, px) <= maxCol;
  const mitad = Math.ceil(letras.length / 2);
  if (cabe(junta(0, mitad)) && cabe(junta(mitad, letras.length))) return [junta(0, mitad), junta(mitad, letras.length)];
  if (corte !== "puntos") return null;
  const n1 = mayorQueCabe(letras.length, 1, (m) => cabe(junta(0, m)));
  if (cabe(junta(n1, letras.length))) return [junta(0, n1), junta(n1, letras.length)];
  const n2 = mayorQueCabe(letras.length - n1, 0, (m) => cabe(junta(n1, n1 + m) + PUNTOS));
  return [junta(0, n1), junta(n1, n1 + n2) + PUNTOS];
}

/** Los renglones de un nombre en una columna de `maxCol`: entero, partido por un espacio, y con `corte` partido por las letras o cortado. */
function renglonesDe(e: EntradaTarjeta, t: string, px: number, maxCol: number, corte: Corte): string[] | null {
  if (e.medir(t, px) <= maxCol) return [t];
  const mitades = partirEnDos(t);
  if (mitades.length === 2 && Math.max(...mitades.map((s) => e.medir(s, px))) <= maxCol) return mitades;
  // Más ancho que su columna y sin un espacio que lo parta bien: solo se sigue si se permite cortarlo.
  return corte === "no" ? null : partirPorLetras(e, t, px, maxCol, corte);
}

/** La tarjeta en `cols` columnas con la letra `px`. Con `corte: "puntos"` siempre se arma; con los demás, `null` si un nombre no entra. */
function disenar(e: EntradaTarjeta, textos: readonly string[], px: number, cols: number, corto: boolean, corte: "puntos"): DisenoTarjeta;
function disenar(e: EntradaTarjeta, textos: readonly string[], px: number, cols: number, corto: boolean, corte: Corte): DisenoTarjeta | null;
function disenar(e: EntradaTarjeta, textos: readonly string[], px: number, cols: number, corto: boolean, corte: Corte): DisenoTarjeta | null {
  const n = textos.length;
  const gap = 10 * e.u, padX = 12 * e.u, padY = 10 * e.u;
  const lineaH = px * 1.4;
  const filas = Math.ceil(n / cols);
  const disponible = e.w * ANCHO_MAX - 2 * padX - (cols - 1) * gap;
  const maxCol = disponible / cols;
  const anchoCol: number[] = [];
  const dosLineas: boolean[] = new Array<boolean>(n).fill(false);
  const rotulos: string[] = new Array<string>(n).fill("");
  let altoMax = 0;
  for (let c = 0; c < cols; c++) {
    let ancho = 0, alto = 0;
    for (let r = 0; r < filas; r++) {
      const j = c * filas + r;
      if (j >= n) break;
      const t = textos[j] as string;
      // Más ancho que su columna: en dos renglones; si ni así entra, esta forma no sirve (salvo que se permita cortar el nombre).
      const lineas = renglonesDe(e, t, px, maxCol, corte);
      if (!lineas) return null;
      dosLineas[j] = lineas.length > 1;
      rotulos[j] = lineas.join("\n");
      ancho = Math.max(ancho, ...lineas.map((s) => e.medir(s, px)));
      alto += lineas.length * lineaH;
    }
    anchoCol.push(ancho);
    altoMax = Math.max(altoMax, alto);
  }
  const w = anchoCol.reduce((a, b) => a + b, 0) + (cols - 1) * gap + 2 * padX;
  const h = altoMax + 2 * padY;
  return { cols, filas, px, corto, anchoCol, dosLineas, rotulos, lineaH, padX, padY, gap, w, h, parte: (w * h) / (e.w * e.h) };
}

/**
 * La búsqueda de siempre con un modo de corte: la letra más grande que deje la tarjeta bajo el tope, con los nombres enteros y después con
 * los cortos. La primera que llega al tope; si ninguna, la más chica que se pudo armar (`null` si con este modo no se pudo armar ninguna).
 */
function buscar(e: EntradaTarjeta, tope: number, corte: Corte): DisenoTarjeta | null {
  let mejorDeTodas: DisenoTarjeta | null = null;
  for (const corto of [false, true]) {
    const textos = corto ? e.cortos : e.textos;
    let px = Math.max(e.pxNominal, e.pxMinimo);
    for (let intento = 0; intento < 12; intento++) {
      let mejor: DisenoTarjeta | null = null;
      for (let cols = 1; cols <= Math.min(COLUMNAS_MAX, Math.max(1, textos.length)); cols++) {
        const d = disenar(e, textos, px, cols, corto, corte);
        if (d && (!mejor || d.parte < mejor.parte - 1e-9)) mejor = d;
      }
      if (mejor) {
        if (mejor.parte <= tope) return mejor;
        if (!mejorDeTodas || mejor.parte < mejorDeTodas.parte) mejorDeTodas = mejor;
      }
      if (px <= e.pxMinimo + 1e-9) break;
      px = Math.max(e.pxMinimo, px * BAJA_LETRA);
    }
  }
  return mejorDeTodas;
}

/**
 * La tarjeta del celular: la que menos pantalla ocupa de las que entran, con la letra más grande que deje bajo el tope. Si algún nombre no
 * entra ni partido en dos por un espacio, se prueba partirlo por las letras y, en último caso, cortarlo con «…»: siempre devuelve una tarjeta.
 */
export function tarjetaRetrato(e: EntradaTarjeta): DisenoTarjeta {
  const tope = (e.tope ?? 0.25) * 0.97;
  let masChica: DisenoTarjeta | null = null;
  for (const corte of ["no", "letras", "puntos"] as const) {
    const d = buscar(e, tope, corte);
    if (!d) continue;
    if (d.parte <= tope) return d;
    // Ninguna llega al tope con este modo: la más chica que se pudo armar, y se sigue por si cortando ese nombre sí llega.
    if (!masChica || d.parte < masChica.parte) masChica = d;
  }
  // Una columna a la letra mínima, con los nombres cortos cortados donde haga falta: lo único que no puede fallar.
  return masChica ?? disenar(e, e.cortos, e.pxMinimo, 1, true, "puntos");
}
