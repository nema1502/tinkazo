/**
 * La luz de la carrera: de qué color es el cielo, el piso y los cerros según el tema de la página, para el 2D
 * (`carrera.ts`) y para el 3D (`carrera-3d.ts`). Puro, sin DOM ni three.js, para probarlo en Node.
 *
 * - **Claro: día en el altiplano.** Mediodía, cielo celeste claro, sol alto a la izquierda, pasto ocre verdoso, pista de
 *   tierra roja, cerros con nieve al fondo, tribuna de colores.
 * - **Oscuro: el atardecer de siempre** (cielo `#1d2248` a naranja, sol bajo), sin cambios: la noche de estadio con torres
 *   de luz es de después del primer sorteo en mainnet (`docs/motores.md`).
 *
 * El tema solo cambia colores y luces. Las llamas, los obstáculos, el reloj y el orden de llegada salen del plan
 * (`carrera-show.ts`), que no lee el tema: la misma ronda cuenta la misma carrera de día y de noche.
 *
 * El contraste de lo que se lee (las fichas de nombre, el cartel del ganador y la bandera de la meta) se mide en
 * `scripts/audit-lavado.mjs`, también con la pantalla lavada de un proyector pobre (`?lavado=1`): ver `docs/motores.md`.
 */

import type { Terreno } from "./carrera-tiempos";

export type TemaCarrera = "claro" | "oscuro";
export type ZonaDeSuelo = Terreno | "corral" | "recta";

export interface LuzCarrera {
  tema: TemaCarrera;
  /** El cielo del 2D, en franjas de arriba abajo. */
  franjas: readonly number[];
  /** El cielo del 3D: del cenit al horizonte (el horizonte es también el color de la niebla). */
  cenit: number;
  medio: number;
  alto: number;
  horizonte: number;
  /** El sol del 2D: color, opacidad, y dónde está en la pantalla (fracción del ancho y del alto). */
  sol: { color: number; alfa: number; x: number; y: number; halo: boolean };
  /** El sol del 3D: el color del disco. */
  solDisco: number;
  /** Los cerros: dos tonos que se alternan. Con `nieve`, las cumbres altas llevan un casquete blanco. */
  cerros: readonly [number, number];
  nieve: boolean;
  /** El suelo de cada tramo y el color con que se adorna (matas, piedras, banderitas). */
  terreno: Readonly<Record<ZonaDeSuelo, number>>;
  acento: Readonly<Record<ZonaDeSuelo, number>>;
  /** Los charcos de lodo del barro (manchas más oscuras que el piso). */
  charco: number;
  /** Las matas de pasto que salpican el suelo de más allá de la pista, en el 3D (`null`: ninguna, como al atardecer). */
  matas: number | null;
  /** Lo que se ve más allá de la pista en el 3D. */
  base: number;
  /** Las luces del 3D: la hemisférica (cielo, suelo, fuerza) y el sol (color, fuerza, de dónde cae respecto de lo que se mira). */
  hemi: { cielo: number; suelo: number; fuerza: number };
  luzSol: { color: number; fuerza: number; desde: readonly [number, number, number] };
  /** La tribuna del 3D: el cemento de las gradas, de a dos tonos. */
  tribuna: readonly [number, number];
  /** Qué tan opacas son las fichas de nombre (tinta con letra crema) sobre el piso: de día el piso es claro y la ficha tiene que tapar más. */
  fichaAlfa: number;
  fichaEchadaAlfa: number;
}

const OSCURO: LuzCarrera = {
  tema: "oscuro",
  franjas: [0x1d2248, 0x2d2c5e, 0x4b3b6e, 0x7b4a73, 0xb06a6a, 0xe0956a],
  cenit: 0x1d2248, medio: 0x4b3b6e, alto: 0x7b4a73, horizonte: 0xd98a64,
  sol: { color: 0xffe9a8, alfa: 0.9, x: 0.82, y: 0.2, halo: false },
  solDisco: 0xffe9a8,
  cerros: [0x3a3566, 0x2d2a52],
  nieve: false,
  terreno: { corral: 0x8a6a4a, cuesta: 0x6b8f3f, barro: 0x6a4a32, piedras: 0x7a7a84, viento: 0xb4c49a, recta: 0xa05d48 },
  acento: { corral: 0xd9b36b, cuesta: 0x2f9e44, barro: 0xa86f3f, piedras: 0xcfd2dc, viento: 0x7ad0e8, recta: 0xffc629 },
  charco: 0x3e2a1c,
  matas: null,
  base: 0x5a4a6e,
  hemi: { cielo: 0xcfd4ff, suelo: 0x6a5a58, fuerza: 1.35 },
  luzSol: { color: 0xffe2b8, fuerza: 1.9, desde: [-60, 90, 70] },
  tribuna: [0x2f2f44, 0x3a3a4e],
  // Antes 0,62 y 0,78. Con la pantalla lavada de un proyector, la letra crema sobre la ficha al 62 % bajaba de 4,5 a 1 sobre
  // el piso claro del viento (3,3) y sobre el horizonte del cielo (3,6): con 0,82 la peor queda en 4,5.
  fichaAlfa: 0.82,
  fichaEchadaAlfa: 0.95,
};

/**
 * El día. El piso va en un tono medio (ni el blanco de las llamas claras ni el café de las oscuras se confunden con él) y
 * las fichas de nombre son más opacas: con la tinta al 62 % sobre un piso claro, la letra crema bajaba de 4,5 a 1 en
 * cuanto un proyector lavaba la imagen.
 */
const CLARO: LuzCarrera = {
  tema: "claro",
  franjas: [0x5aa6df, 0x78b8e6, 0x9ccbea, 0xbcdcee, 0xdcecef, 0xfff0d6],
  cenit: 0x5aa6df, medio: 0x9ccbea, alto: 0xcfe6ee, horizonte: 0xfff0d6,
  sol: { color: 0xfffbe6, alfa: 1, x: 0.17, y: 0.13, halo: true },
  solDisco: 0xfffbe6,
  cerros: [0x9db3cf, 0xb8a27a],
  nieve: true,
  terreno: { corral: 0xc9a56e, cuesta: 0xa3aa5c, barro: 0x946d4a, piedras: 0xaaa59b, viento: 0xd9c38f, recta: 0xc2705a },
  acento: { corral: 0xe3c88f, cuesta: 0x5f8a38, barro: 0x6e4a2e, piedras: 0x7a756c, viento: 0x00a896, recta: 0xffc629 },
  charco: 0x6e4d2e,
  matas: 0x7d8f3c,
  base: 0xb9aa7e,
  // Blanco cálido arriba y tierra abajo: con el celeste de la otra paleta el piso rojo viraba al rosa.
  hemi: { cielo: 0xf6f4ee, suelo: 0xcdb48e, fuerza: 1.35 },
  luzSol: { color: 0xfff2da, fuerza: 1.7, desde: [-30, 140, 40] },
  tribuna: [0xb8b1a3, 0xa7a091],
  fichaAlfa: 0.88,
  fichaEchadaAlfa: 0.95,
};

/** El gris oscuro de la ficha de quien se echó: antes `0x3a3a46`, que lavado por un proyector dejaba la letra crema en 3,8 a 1. */
export const FICHA_ECHADA = 0x2c2c38;

export const LUCES: Readonly<Record<TemaCarrera, LuzCarrera>> = { claro: CLARO, oscuro: OSCURO };

/** La luz del tema de la página: `oscuro` si el escenario lo pide, `claro` si no. */
export const luzDe = (tema: TemaCarrera): LuzCarrera => LUCES[tema];

/**
 * El filtro de `?lavado=1` (`styles.css`: `contrast(0.6) brightness(1.1)`): la pantalla de un proyector pobre con luz en la sala.
 * `contrast(0,6)` sube el negro a un 20 % de gris y baja el blanco a un 80 %; `brightness(1,1)` lo aclara un poco. Solo para
 * auditar: el mismo cálculo de `scripts/lib/contraste.mjs`.
 */
export const LAVADO = { contraste: 0.6, brillo: 1.1 } as const;

/** Cómo queda un color 0xRRGGBB después del lavado, canal por canal en sRGB (como lo hace CSS). */
export function lavar(c: number): number {
  const k = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, ((v / 255 - 0.5) * LAVADO.contraste + 0.5) * LAVADO.brillo)));
  return (k((c >> 16) & 255) << 16) | (k((c >> 8) & 255) << 8) | k(c & 255);
}

/** El color que resulta de poner `arriba` con opacidad `alfa` sobre `abajo` (mezcla en sRGB, como PixiJS). */
export function sobre(arriba: number, alfa: number, abajo: number): number {
  const k = (s: number): number => Math.round(((arriba >> s) & 255) * alfa + ((abajo >> s) & 255) * (1 - alfa));
  return (k(16) << 16) | (k(8) << 8) | k(0);
}

/** La luminancia relativa de WCAG 2.x de un color 0xRRGGBB (0 a 1). */
export function luminancia(c: number): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((c >> 16) & 255) + 0.7152 * lin((c >> 8) & 255) + 0.0722 * lin(c & 255);
}

/** El contraste de WCAG 2.x entre dos colores (1 a 21). */
export function contraste(a: number, b: number): number {
  const x = luminancia(a), y = luminancia(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
