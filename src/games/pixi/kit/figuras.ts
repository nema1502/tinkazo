import { CLAVES, emblemasDe, type Emblema, type Ronda } from "../../emblemas";

/**
 * Las figuras: qué dibuja cada persona de la lista.
 *
 * La cara de siempre (`avatar.ts`, una por nombre) o, para los juegos con
 * muchos personajes a la vez, un **emblema** por persona: una llama, un
 * charango, una salteña (`games/emblemas.ts`). Sin azar: sale del nombre y de la
 * ronda, que ya es pública cuando se sella la lista, así que nunca delata a
 * nadie.
 *
 * - Hasta 32 personas nadie repite emblema; con más, nadie repite emblema y
 *   color hasta 256, y después queda lo más parejo posible.
 * - Reordenar la lista no cambia el emblema de nadie.
 * - Si la hoja de dibujos todavía no cargó (o no cargó nunca), todos quedan con
 *   la cara de siempre: un juego nunca espera por una imagen.
 *
 * Puro, sin DOM: la textura la arma el anfitrión (`Kit.figura`).
 */
export type ModoFiguras = "caras" | "emblemas";

/**
 * Una figura es la persona: cara y nombre, nunca un emblema de 30 px. El emblema
 * es un adorno que no reemplaza ni la cara ni el nombre, y la figura no baja de
 * `tamanoMinimoFigura`.
 */
export type Figura = ({ tipo: "cara" } | { tipo: "emblema"; emblema: Emblema }) & { nombre: string };

/** El tamaño de una figura: 56 px de diseño (a 720 de alto), crece con la pantalla hasta el doble y nunca baja de 40. */
export const FIGURA = { diseno: 56, minimoPx: 40 } as const;

/** Lo menos que mide una figura, en píxeles, para la unidad `u` del juego (`PixiStage.u()`). */
export function tamanoMinimoFigura(u: number, compartir = false): number {
  return Math.max(FIGURA.minimoPx, FIGURA.diseno * Math.min(2, u) * (compartir ? 1.2 : 1));
}

/**
 * Cuántas figuras con su nombre caben en un área, de a una por lugar. Con más
 * gente de la que cabe, el juego las muestra por tandas: nunca como emblemas diminutos.
 */
export function cuantasCaben(area: { w: number; h: number }, tamano: number, altoNombre: number): number {
  const ancho = tamano * 1.4;
  const alto = tamano + altoNombre + tamano * 0.15;
  return Math.max(0, Math.floor(area.w / ancho)) * Math.max(0, Math.floor(area.h / alto));
}

/** Hasta cuántas personas puede tener la lista para que nadie comparta emblema. */
export const SIN_REPETIR = CLAVES.length;

export function figurasDe(nombres: readonly string[], ronda: Ronda, modo: ModoFiguras = "caras", hojaLista = true): Figura[] {
  if (modo !== "emblemas" || !hojaLista) return nombres.map((nombre): Figura => ({ tipo: "cara", nombre }));
  return emblemasDe(nombres, ronda).map((emblema, i): Figura => ({ tipo: "emblema", emblema, nombre: nombres[i] ?? "" }));
}

/** Cuántas personas comparten emblema con otra (0 si todas son distintas). Solo cuentan los emblemas. */
export function repetidas(figuras: readonly Figura[]): number {
  const vistos = new Map<string, number>();
  for (const f of figuras) if (f.tipo === "emblema") vistos.set(f.emblema.clave, (vistos.get(f.emblema.clave) ?? 0) + 1);
  let n = 0;
  for (const c of vistos.values()) if (c > 1) n += c;
  return n;
}
