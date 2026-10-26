/**
 * La forma del pelotón en la pantalla, sin dibujo: cuántas columnas, de qué
 * tamaño es cada llama y dónde va cada una cuando quedan `m` en carrera.
 *
 * Puro, para probarlo con cualquier tamaño de pantalla (celular vertical y
 * girado, tablet, proyector) sin abrir un navegador. Lo usa `pixi-peloton.ts`.
 *
 * Las llamas van en filas con perspectiva: las de adelante (abajo) un poco más
 * grandes, las filas alternadas corridas media celda. Las columnas se eligen
 * para que la llama sea lo más grande posible **sin que el nombre del nivel que
 * le toca por cantidad deje de entrar** en su celda; a igual tamaño, más filas,
 * que se lee más como un pelotón.
 */

export interface Lugar {
  x: number;
  /** Dónde pisan las patas. */
  y: number;
  /** La escala de la llama (1 es la que mide 98 unidades de alto). */
  s: number;
}

export interface Disposicion {
  m: number;
  /** Columnas y filas. */
  C: number;
  R: number;
  /** Lo ancho de cada celda y lo que separa a las filas, en píxeles. */
  cellW: number;
  pitch: number;
  lugares: Lugar[];
}

export interface EntradaForma {
  /** Cuántas llamas quedan en carrera. */
  m: number;
  /** El ancho de la pantalla y la unidad (un píxel de un diseño de 720 de alto). */
  sw: number;
  u: number;
  /** Dónde pisa la primera fila y la última. */
  piesMin: number;
  piesMax: number;
  /** La escala más grande que puede tener una llama. */
  sTope: number;
  /** Lo ancho que es la ficha del nivel que toca por cantidad, con su margen. */
  necesita: number;
}

export interface EntradaZona {
  sw: number;
  sh: number;
  u: number;
  portrait: boolean;
  /** Dónde empieza el juego debajo de la barra de arriba (`S.top()`). */
  top: number;
  /** Dónde está la pista de la final (la de siempre) y dónde termina. */
  trackTop: number;
  trackBot: number;
  /** Cuántas van a la tribuna a lo largo del pelotón. */
  echados: number;
}

export interface Zona {
  /** Vertical o pantalla baja: el pelotón usa todo el alto y la tribuna pasa a ser filas arriba de todo. */
  compacto: boolean;
  filasTrib: number;
  porFila: number;
  /** El lado de cada emblema de la tribuna y lo que separa a las filas. */
  lado: number;
  pasoFila: number;
  /** Donde pisan los de la primera fila de la tribuna. */
  triY: number;
  /** La valla, y el piso de la pista. */
  banda0: number;
  banda1: number;
  piesMin: number;
  piesMax: number;
  sTope: number;
}

/**
 * Dónde va el pelotón. En vertical (y en una pantalla baja, un celular
 * girado) usa todo el alto: la tribuna de los que se echan pasa a ser una o
 * dos filas arriba de todo, la valla baja justo debajo, y el suelo ocupa el
 * resto hasta el relator, tapando la tribuna del estadio. En una pantalla
 * ancha y alta queda como la pista de siempre, con la tribuna detrás.
 */
export function zonaPeloton(e: EntradaZona): Zona {
  const { sw, sh, u, portrait, top, trackTop, trackBot, echados } = e;
  const compacto = portrait || sh < 560;
  const filasTrib = portrait ? 2 : 1;
  const porFila = Math.max(1, Math.ceil(echados / filasTrib));
  const lado = Math.min(26 * u, ((sw * 0.9) / porFila) * 0.86);
  const pasoFila = lado * 1.6 + 4 * u;
  const triY = compacto ? top + 32 * u + lado : trackTop - 24 * u;
  const triBajo = triY + (filasTrib - 1) * pasoFila;
  const banda0 = compacto ? triBajo + lado * 0.6 + 22 * u : trackTop;
  const banda1 = trackBot;
  const piesMax = banda1 - 2 * u;
  const sTope = (portrait ? 1.3 : 1.2) * Math.max(u, 0.8);
  const piesMin = banda0 + 26 * u + 100 * 0.74 * Math.min(sTope, 1.2 * u);
  return { compacto, filasTrib, porFila, lado, pasoFila, triY, banda0, banda1, piesMin, piesMax, sTope };
}

/** Cuánto del ancho de la pantalla ocupa el pelotón. */
export const ANCHO_UTIL = 0.94;
/** Lo que mide de ancho una llama a escala 1, con aire, y cuánto de alto pide cada fila. */
const ANCHO_LLAMA = 68;
const ALTO_FILA = 66;

export function disponerPeloton(e: EntradaForma): Disposicion {
  const { m, sw, u, piesMin, piesMax, sTope, necesita } = e;
  const zonaW = sw * ANCHO_UTIL;
  const medidas = (C: number): { R: number; cellW: number; pitch: number; sF: number } => {
    const R = Math.ceil(m / C);
    const cellW = zonaW / (C + (R > 1 ? 0.5 : 0));
    const pitch = R > 1 ? (piesMax - piesMin) / (R - 1) : 0;
    const sF = Math.min(R > 1 ? pitch / ALTO_FILA : Infinity, cellW / ANCHO_LLAMA, sTope);
    return { R, cellW, pitch, sF };
  };
  let mejor: { C: number; score: number } | null = null;
  for (let C = 1; C <= Math.min(m, 12); C++) {
    const { cellW, sF } = medidas(C);
    const ajusta = Math.min(1, (cellW - 4 * u) / necesita);
    const score = sF * ajusta ** 1.5;
    // A igual tamaño, las columnas más angostas: más filas.
    if (!mejor || score > mejor.score * 1.03) mejor = { C, score };
  }
  const C = mejor?.C ?? 1;
  const { R, cellW, pitch, sF } = medidas(C);
  const lugares: Lugar[] = [];
  for (let k = 0; k < m; k++) {
    const r = Math.floor(k / C), c = k % C;
    const enFila = r === R - 1 ? m - (R - 1) * C : C;
    const fr = R > 1 ? r / (R - 1) : 1;
    const y = R > 1 ? piesMin + r * pitch : piesMax - 0.35 * (piesMax - piesMin);
    const s = sF * (R > 1 ? 0.74 + 0.26 * fr : 1);
    const x = sw / 2 + (c - (enFila - 1) / 2) * cellW + (R > 1 && enFila === C ? (r % 2 ? 0.25 : -0.25) * cellW : 0);
    lugares.push({ x, y, s });
  }
  return { m, C, R, cellW, pitch, lugares };
}

/**
 * Asignación de costo mínimo (el método húngaro): `costo[i][j]` es lo que cuesta poner a `i` en `j`; devuelve
 * la columna de cada fila. Cuadrada, y con unas treinta filas son pocas cuentas.
 */
function asignarMinimo(costo: readonly (readonly number[])[]): number[] {
  const n = costo.length;
  const at = (a: number[], i: number): number => a[i] as number;
  const u: number[] = new Array(n + 1).fill(0);
  const v: number[] = new Array(n + 1).fill(0);
  const p: number[] = new Array(n + 1).fill(0);
  const way: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv: number[] = new Array(n + 1).fill(Infinity);
    const usado: boolean[] = new Array(n + 1).fill(false);
    do {
      usado[j0] = true;
      const i0 = at(p, j0);
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (usado[j]) continue;
        const cur = ((costo[i0 - 1] as readonly number[])[j - 1] as number) - at(u, i0) - at(v, j);
        if (cur < at(minv, j)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (at(minv, j) < delta) {
          delta = at(minv, j);
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (usado[j]) {
          u[at(p, j)] = at(u, at(p, j)) + delta;
          v[j] = at(v, j) - delta;
        } else minv[j] = at(minv, j) - delta;
      }
      j0 = j1;
    } while (at(p, j0) !== 0);
    do {
      const j1 = at(way, j0);
      p[j0] = at(p, j1);
      j0 = j1;
    } while (j0);
  }
  const out: number[] = new Array(n).fill(0);
  for (let j = 1; j <= n; j++) out[at(p, j) - 1] = j - 1;
  return out;
}

/**
 * A qué celda va cada uno de los que siguen cuando alguien se echa y el pelotón cierra filas.
 *
 * Antes cada uno tomaba la celda de su lugar en la lista de los que siguen: al irse uno, todos los de
 * atrás corrían un lugar y el primero de cada fila saltaba al final de la anterior, y cada vez que
 * cambiaban las columnas pasaba lo mismo en todas las filas. Las llamas se cruzaban y se montaban justo
 * cuando se lee el nombre. Ahora cada una va a la celda que la mueve menos: la asignación de menor suma de
 * distancias al cuadrado entre dónde estaba y las celdas de la disposición nueva. Así cada una se queda o
 * se corre un lugar, y las que sobran del final van al hueco más cercano; y como las que van a la misma
 * velocidad por esa asignación no chocan entre sí, no se montan una sobre otra.
 *
 * Solo mira dónde está cada una, nunca quién es: no tiene nada que ver con quién gana.
 *
 * `previas[i]` es la celda que ocupaba en `antes` el que sigue número `i`; devuelve su celda en `ahora`
 * (`ahora.m` celdas, una por persona: es una permutación de 0 a `ahora.m - 1`).
 */
export function reasignarCeldas(previas: readonly number[], antes: Disposicion, ahora: Disposicion): number[] {
  const costo = previas.map((c) => {
    const a = antes.lugares[c] as Lugar;
    return ahora.lugares.map((b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  });
  return asignarMinimo(costo);
}
