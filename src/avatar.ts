/**
 * El avatar de cada participante, dibujado acá.
 *
 * Antes se le pedía a un servicio externo, con el nombre de la persona en la
 * dirección. Eso contradecía de frente lo que promete el producto: la lista no
 * llega a nuestro servidor, pero salía igual del navegador, nombre por nombre,
 * hacia otro. Con doscientos participantes eran doscientas peticiones, cada una
 * con el nombre de alguien real adentro.
 *
 * Ahora sale de un hash del nombre y no toca la red. De paso: aparece al
 * instante, funciona con el wifi del evento caído, y doscientos avatares dejan
 * de ser doscientas peticiones.
 *
 * El dibujo es simétrico a propósito. Una cara mal hecha se ve mal; un patrón
 * simétrico se lee como un emblema y encaja con el estilo de la casa: fondo de
 * color plano, borde de tinta, formas cuadradas.
 */

const INK = "#191919";

/** Los mismos cinco acentos de la paleta, en claro. */
const COLORS = ["#e93d9c", "#ff7a1a", "#00a896", "#ffc629", "#6c4ce0"];

/**
 * Hash del nombre.
 *
 * FNV-1a de 32 bits sobre los puntos de código. No es criptográfico y no hace
 * falta que lo sea: lo único que se pide es que el mismo nombre dé siempre el
 * mismo dibujo y que nombres parecidos den dibujos distintos.
 */
function hash(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface Emblem {
  color: string;
  /** Celdas de tinta en una grilla de 7 por 7, con un margen de una celda. */
  cells: readonly (readonly [number, number])[];
}

const emblems = new Map<string, Emblem>();

/** El dibujo de una persona: su color y sus celdas. Lo comparten el SVG y el lienzo. */
function emblem(name: string): Emblem {
  const hit = emblems.get(name);
  if (hit) return hit;
  const h = hash(name);
  const color = COLORS[h % COLORS.length] ?? COLORS[0] ?? INK;
  // Cinco columnas por cinco filas, con espejo: las tres primeras columnas
  // deciden el dibujo entero y la simetría hace que siempre se vea a propósito.
  const cells: [number, number][] = [];
  let bits = h >>> 3;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      // Tres de cada cuatro celdas se pintan: con la mitad el emblema queda
      // hueco y se lee como ruido en vez de como un dibujo.
      const on = (bits & 3) !== 0;
      bits = bits >>> 2;
      if (!on && !(x === 1 && y > 0 && y < 4)) continue;
      cells.push([x + 1, y + 1]);
      if (x !== 2) cells.push([5 - x, y + 1]);
    }
  }
  const e = { color, cells };
  emblems.set(name, e);
  return e;
}

/**
 * Pinta el avatar directo en un lienzo, en el cuadro que empieza en `x, y`.
 *
 * Los juegos lo dibujaban con una imagen hecha del SVG, y una imagen se
 * decodifica **cuando el navegador quiere**: los primeros cuadros de cada ficha
 * salían sin cara, y el momento en que aparecía dependía de la máquina. Eso
 * rompía la promesa de que la misma ronda dibuja la misma animación, y el
 * auditor exigente lo vio: dos corridas de la ruleta diferían en 264 de 300
 * cuadros. Pintado a mano está desde el primer cuadro, en cualquier equipo.
 *
 * Las celdas se ajustan al píxel entero: sin eso, dos celdas vecinas dejan
 * entre ellas una raya del color de fondo por el suavizado de bordes.
 */
export function drawAvatar(c: CanvasRenderingContext2D, name: string, x: number, y: number, size: number): void {
  const { color, cells } = emblem(name);
  const s = size / 7;
  const px = (v: number): number => Math.round(v);
  c.fillStyle = color;
  c.fillRect(px(x), px(y), px(x + size) - px(x), px(y + size) - px(y));
  c.fillStyle = INK;
  for (const [cx, cy] of cells) {
    const x0 = px(x + cx * s), y0 = px(y + cy * s);
    c.fillRect(x0, y0, px(x + (cx + 1) * s) - x0, px(y + (cy + 1) * s) - y0);
  }
}

const cache = new Map<string, string>();

/**
 * Devuelve el avatar como una dirección `data:` lista para el `src` de una
 * imagen. El tamaño solo fija el lienzo: el dibujo es vectorial y escala solo.
 * Es para el HTML; en un lienzo, `drawAvatar`.
 */
export function avatar(name: string, size: number): string {
  const key = `${name}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { color, cells } = emblem(name);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<rect width="7" height="7" fill="${color}"/>` +
    `<g fill="${INK}">${cells.map(([cx, cy]) => `<rect x="${cx}" y="${cy}" width="1" height="1"/>`).join("")}</g>` +
    `</svg>`;

  // `encodeURIComponent` y no base64: el SVG es corto y así queda legible en
  // las herramientas del navegador, que ayuda cuando algo se ve raro.
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}
