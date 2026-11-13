/**
 * Las poses de la llama que acompaña (`llama-guia.ts`).
 *
 * Es la llama del logo (`public/icon.svg`): los mismos rectángulos, sin curvas, sin cara y sin ropa (docs/marca.md, La
 * llama). Cada pose es esa lista de rectángulos con algún giro o corrimiento, así se reconoce de un vistazo, como en
 * los stickers. Se dibuja en tres capas iguales: la sombra dura corrida, el borde (el mismo rectángulo con trazo) y el
 * relleno magenta. Los colores son las variables del tema, así que el tema oscuro sale solo.
 *
 * Las poses se arman una vez, como SVG en línea: cero imágenes y cero pedidos, unos cientos de bytes cada una. Este
 * archivo no importa nada, para que un guion de Node también pueda leer las formas.
 */

export type PoseDeLlama = "saluda" | "anima" | "espera" | "festeja" | "preocupa";

/** Las cinco, en el orden en que aparecen en un recorrido. */
export const POSES: readonly PoseDeLlama[] = ["saluda", "anima", "espera", "festeja", "preocupa"];

/** x, y, ancho y alto en la grilla del logo (la llama de pie mide 22 por 26, con las patas en y = 24). */
export type Rect = readonly [number, number, number, number];

/** Una parte del dibujo. `t` es una transformación de SVG (solo `translate` y `rotate`). */
export interface Parte {
  readonly r: Rect;
  readonly t?: string;
  /** Una parte que se mueve sola: la pata que saluda, la oreja que escucha, los puntos de la espera. */
  readonly anima?: string;
}

export type ColorDePapel = "yellow" | "teal" | "orange" | "purple" | "magenta";

export interface Papel extends Parte {
  readonly color: ColorDePapel;
}

export interface Pose {
  /** El giro o el salto de la llama entera. */
  readonly todo?: string;
  readonly partes: readonly Parte[];
  /** Trazos de tinta sin sombra: las líneas de velocidad, los puntos de la espera. */
  readonly detalle?: readonly Parte[];
  /** El papel picado de los cinco colores. */
  readonly papel?: readonly Papel[];
}

/** El lienzo común: todas las poses en la misma caja, así la llama no cambia de tamaño al cambiar de pose. */
export const CAJA = { x: -6, y: -11, ancho: 37, alto: 37 } as const;
/** El trazo del borde (la mitad queda afuera del rectángulo) y el corrimiento de la sombra, en unidades de la grilla. */
export const BORDE = 2;
export const SOMBRA = 1.6;

/** Una pata de la llama, metida dos unidades dentro del cuerpo para que al girar no se despegue. Gira en (x + 1,25, 18). */
const pata = (x: number, giro = 0): Parte => ({ r: [x, 16, 2.5, 8], ...(giro ? { t: `rotate(${giro} ${x + 1.25} 18)` } : {}) });

/** La cabeza alta: cuello, cabeza y oreja del logo, una unidad más arriba. */
const cabezaAlta = (t?: string): Parte[] => [
  { r: [15, 2, 4, 11], ...(t ? { t } : {}) },
  { r: [14, -1, 8, 4], ...(t ? { t } : {}) },
  { r: [20, -3, 2, 3], ...(t ? { t } : {}) },
];

const CUERPO: Parte = { r: [2, 11, 16, 7] };

export const POSES_DE_LLAMA: Readonly<Record<PoseDeLlama, Pose>> = {
  // De pie, la cabeza arriba, la cola alta y la pata de adelante levantada: saluda.
  saluda: {
    todo: "rotate(-3 11 18)",
    partes: [
      { r: [0, 9, 3, 4], t: "rotate(-25 3 11)" },
      CUERPO,
      ...cabezaAlta(),
      pata(3),
      pata(8),
      pata(12.5),
      // La pata levantada nace adentro del pecho y gira sobre su punta de arriba: girada tanto, no puede asomar por abajo.
      { r: [16, 16.5, 2.5, 6.5], t: "rotate(-135 17.25 16.5)", anima: "pata" },
    ],
  },
  // Al trote, inclinada hacia adelante, con las patas abiertas y tres líneas de velocidad: vamos.
  anima: {
    todo: "translate(0 -1) rotate(-5 10 14)",
    partes: [
      { r: [0, 9, 3, 4], t: "rotate(-35 3 11)" },
      CUERPO,
      ...cabezaAlta("rotate(8 17 13)"),
      pata(3, 32),
      pata(8, 12),
      pata(12.5, -12),
      pata(16, -34),
    ],
    detalle: [
      { r: [-5.5, 10.5, 3.5, 1.2] },
      { r: [-4.5, 14, 2.5, 1.2] },
      { r: [-6, 17.5, 4, 1.2] },
    ],
  },
  // Echada, con la cabeza arriba: espera. Los tres puntos dicen que algo está pasando.
  espera: {
    partes: [
      { r: [0, 14, 3, 4], t: "rotate(-15 3 16)" },
      { r: [2, 15, 16, 7] },
      { r: [15, 6, 4, 11] },
      { r: [14, 3, 8, 4] },
      { r: [20, 1, 2, 3], anima: "oreja" },
      { r: [3, 21, 5, 3] },
      { r: [12.5, 21, 5, 3] },
    ],
    detalle: [
      { r: [23, -3, 1.8, 1.8], anima: "punto1" },
      { r: [25.5, -3, 1.8, 1.8], anima: "punto2" },
      { r: [28, -3, 1.8, 1.8], anima: "punto3" },
    ],
  },
  // En el aire, con las patas abiertas y papel picado de los cinco colores: llegó.
  festeja: {
    todo: "translate(0 -4.5) rotate(-12 10 14)",
    partes: [
      { r: [0, 9, 3, 4], t: "rotate(-45 3 11)" },
      CUERPO,
      ...cabezaAlta(),
      pata(3, 45),
      pata(8, 25),
      pata(12.5, -25),
      pata(16, -45),
    ],
    papel: [
      { r: [-4, -5, 2, 2], t: "rotate(20 -3 -4)", color: "yellow" },
      { r: [2, -9, 1.8, 1.8], t: "rotate(-15 3 -8)", color: "teal" },
      { r: [25, -7, 2, 2], t: "rotate(30 26 -6)", color: "orange" },
      { r: [28, 1, 1.8, 1.8], color: "purple" },
      { r: [-5, 4, 1.8, 1.8], t: "rotate(40 -4 5)", color: "magenta" },
      { r: [24, 6, 1.6, 1.6], t: "rotate(10 25 7)", color: "yellow" },
    ],
  },
  // Se frena y mira para atrás, con la cabeza un poco baja, la cola caída y un paso atrás: algo se frenó. Con la cabeza
  // agachada hacia adelante se leía como que pastaba.
  preocupa: {
    todo: "translate(-1 0) rotate(-3 3 24)",
    partes: [
      { r: [0.5, 11, 2.5, 5.5], t: "rotate(10 2 11)" },
      CUERPO,
      { r: [15, 3, 4, 10] },
      { r: [12, 0.5, 8, 4], t: "rotate(-12 17 2.5)" },
      { r: [12, -1.5, 2, 3], t: "rotate(-12 17 2.5)" },
      pata(3, 6),
      pata(8),
      pata(12.5),
      pata(16, -10),
    ],
  },
};

const num = (v: number): string => String(Math.round(v * 100) / 100);

function rect(p: Parte): string {
  const [x, y, w, h] = p.r;
  const base = `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"`;
  // Una parte que se mueve lleva su giro fijo en un grupo: así la animación gira el rectángulo sobre su propio eje.
  if (p.anima) return `<g${p.t ? ` transform="${p.t}"` : ""}>${base} class="ll-a-${p.anima}"/></g>`;
  return `${base}${p.t ? ` transform="${p.t}"` : ""}/>`;
}

const cache = new Map<PoseDeLlama, string>();

/**
 * La llama en una pose, como SVG en línea. Decorativa: `aria-hidden`, porque lo que dice la pantalla lo dice el texto.
 * Se arma una sola vez por pose.
 */
export function svgDeLlama(pose: PoseDeLlama): string {
  const hecho = cache.get(pose);
  if (hecho) return hecho;
  const p = POSES_DE_LLAMA[pose];
  const cuerpo = p.partes.map((x) => rect(x)).join("");
  const capa = (estilo: string, mover = ""): string =>
    `<g style="${estilo}"${mover ? ` transform="${mover}"` : ""}><g${p.todo ? ` transform="${p.todo}"` : ""}>${cuerpo}</g></g>`;
  const tinta = `fill:var(--ink,#191919);stroke:var(--ink,#191919);stroke-width:${BORDE}`;
  const detalle = p.detalle ? `<g style="fill:var(--ink,#191919)">${p.detalle.map((x) => rect(x)).join("")}</g>` : "";
  const papel = p.papel
    ? `<g style="stroke:var(--ink,#191919);stroke-width:0.5">${p.papel.map((x) => rect(x).replace("<rect ", `<rect style="fill:var(--${x.color})" `)).join("")}</g>`
    : "";
  const svg =
    `<svg class="llg-svg" viewBox="${CAJA.x} ${CAJA.y} ${CAJA.ancho} ${CAJA.alto}" aria-hidden="true" focusable="false" data-pose="${pose}">` +
    capa(tinta, `translate(${SOMBRA} ${SOMBRA})`) +
    capa(tinta) +
    capa("fill:var(--magenta,#e93d9c)") +
    detalle +
    papel +
    "</svg>";
  cache.set(pose, svg);
  return svg;
}
