import { ajustar, mediana, nivelBase, nivelPorCantidad, nivelesDe, planNombres, type Nivel, type PlanNombres } from "../../nombres";

/**
 * Los nombres legibles: la regla de letra del kit.
 *
 * Los nombres dentro de un juego miden **al menos el 2,6 % del alto** de la
 * pantalla en un proyector (28 px en 1080p) y **16 px** en un celular. Con más
 * gente se acorta el texto, nunca la letra por debajo de eso (barrido de letra,
 * 25 de octubre de 2026): lo que cuenta es el ángulo de la altura de la x. 28 px
 * a 6 m de una imagen de 1,5 m de alto dan 11,6 minutos de arco, el mínimo para
 * leer; 16 px a 35 cm dan 13,4.
 *
 * Tres roles:
 *
 * - **nombre**: el de cada persona en la escena. 19 px de diseño (a 720 de alto);
 *   en 1080p son 28,5, el 2,64 % del alto.
 * - **apoyo**: contadores y rótulos. 16 de diseño, nunca menos de 14 px.
 * - **cartel**: la pregunta o el aviso que lee toda la sala. 33 de diseño: el
 *   4,6 % del alto.
 *
 * Se achica el **texto**, no la letra: los niveles de `games/nombres.ts` (la
 * inicial con más de 20, el nombre de pila hasta 20, con la inicial del apellido
 * hasta 12, entero hasta 8, todos a la vez y nunca por quién) y, si no entra,
 * dos líneas. Nunca "…" y nunca una palabra cortada a la mitad.
 *
 * Puro, sin DOM: se prueba en Node a 390, 720 y 1080.
 */
export { nivelBase as nivelParaLugar, nivelPorCantidad, nivelesDe, planNombres, mediana };
export type { Nivel, PlanNombres };

export type Rol = "nombre" | "apoyo" | "cartel";

/** El tamaño de diseño de cada rol, en píxeles de una pantalla de 720 de alto. */
export const LETRA_DISENO: Readonly<Record<Rol, number>> = { nombre: 19, apoyo: 16, cartel: 33 };
/** Lo que nunca baja de esto, en píxeles de pantalla (un celular de 390). */
export const MINIMO_PX: Readonly<Record<Rol, number>> = { nombre: 16, apoyo: 14, cartel: 22 };
/** Lo que pide la regla en un proyector, como fracción del alto de la pantalla. */
export const FRACCION_ALTO: Readonly<Record<Rol, number>> = { nombre: 0.026, apoyo: 0.022, cartel: 0.045 };

/** La unidad de diseño de una pantalla: un píxel de un diseño de 720 de alto (o lo que entre en un celular parado). */
export const unidadDe = (ancho: number, alto: number): number => (alto > ancho * 1.1 ? Math.min(ancho / 420, alto / 900) : alto / 720);

/** La pantalla es de proyector o de escritorio: apaisada. Ahí vale la regla en proporción del alto. */
const apaisada = (ancho: number, alto: number): boolean => ancho > alto;

/**
 * El tamaño de letra de un rol para la unidad `u` (`PixiStage.u()`): crece con
 * la pantalla hasta el doble, un veinte por ciento más con el modo para
 * compartir, y nunca baja del piso del rol.
 */
export function tamanoLetra(rol: Rol, u: number, compartir = false): number {
  return Math.max(MINIMO_PX[rol], LETRA_DISENO[rol] * Math.min(2, u) * (compartir ? 1.2 : 1));
}

/** Lo menos que puede medir un rol en una pantalla de `ancho` por `alto`: la regla, en píxeles. */
export function minimoPx(rol: Rol, ancho: number, alto: number): number {
  return Math.max(MINIMO_PX[rol], apaisada(ancho, alto) ? FRACCION_ALTO[rol] * alto : 0);
}

/**
 * Cuánto hay que agrandar un texto para que, con la cámara a `zoom`, se vea al
 * menos de `minimoPantalla` píxeles. 1 si ya se ve bien o si la cámara se acerca.
 * Cuando la cámara se aleja, la escena achica los nombres con ella: esto los
 * devuelve a lo legible.
 */
export function compensarZoom(px: number, zoom: number, minimoPantalla: number): number {
  const enPantalla = px * zoom;
  return enPantalla > 0 && enPantalla < minimoPantalla ? minimoPantalla / enPantalla : 1;
}

/** Un rectángulo: el cuerpo de una figura o la caja de un nombre, en la misma unidad. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cuánto puede separarse el nombre del cuerpo, como fracción del alto del cuerpo: pegado, no al lado. */
export const SEPARACION_MAX = 0.25;

/** La etiqueta centrada contra el cuerpo, debajo (o arriba), separada `sep`. El nombre va pegado al cuerpo en todos los juegos. */
export function pegarAlCuerpo(cuerpo: Rect, etiqueta: { w: number; h: number }, o: { arriba?: boolean; sep?: number } = {}): Rect {
  const sep = o.sep ?? 0;
  return {
    x: cuerpo.x + cuerpo.w / 2 - etiqueta.w / 2,
    y: o.arriba ? cuerpo.y - etiqueta.h - sep : cuerpo.y + cuerpo.h + sep,
    w: etiqueta.w,
    h: etiqueta.h,
  };
}

/** El hueco entre la etiqueta y el cuerpo: 0 si se tocan o se montan. */
export function huecoAlCuerpo(cuerpo: Rect, e: Rect): number {
  const dx = Math.max(0, cuerpo.x - (e.x + e.w), e.x - (cuerpo.x + cuerpo.w));
  const dy = Math.max(0, cuerpo.y - (e.y + e.h), e.y - (cuerpo.y + cuerpo.h));
  return Math.hypot(dx, dy);
}

/** ¿El nombre está pegado a su cuerpo? Debajo o arriba, a lo ancho de él, a lo sumo `SEPARACION_MAX` de su alto. */
export function estaPegado(cuerpo: Rect, e: Rect): boolean {
  const solapa = e.x < cuerpo.x + cuerpo.w && e.x + e.w > cuerpo.x;
  return solapa && huecoAlCuerpo(cuerpo, e) <= SEPARACION_MAX * cuerpo.h;
}

/**
 * Dónde queda el nombre de quien sale: donde pasó, pegado a lo último que se
 * vio de su cuerpo, y legible. Nunca en una fila aparte: solo se corre lo justo
 * para que entre en la zona.
 */
export function nombreDeSalida(ultimoCuerpo: Rect, etiqueta: { w: number; h: number }, zona: Rect, o: { arriba?: boolean; sep?: number } = {}): Rect {
  const e = pegarAlCuerpo(ultimoCuerpo, etiqueta, o);
  return {
    ...e,
    x: Math.max(zona.x, Math.min(zona.x + zona.w - e.w, e.x)),
    y: Math.max(zona.y, Math.min(zona.y + zona.h - e.h, e.y)),
  };
}

/** ¿Hay tres o más nombres sueltos, sin cuerpo pegado, alineados en una banda angosta? Es la fila aparte de emblemas que la regla prohíbe. */
export function enFilaAparte(cuerpos: readonly Rect[], etiquetas: readonly Rect[]): boolean {
  const sueltas = etiquetas.filter((e) => !cuerpos.some((c) => estaPegado(c, e)));
  if (sueltas.length < 3) return false;
  const ys = sueltas.map((e) => e.y + e.h / 2);
  const alto = Math.max(...sueltas.map((e) => e.h));
  return Math.max(...ys) - Math.min(...ys) <= alto * 1.5;
}

export interface NombreLegible {
  /** Una o dos líneas, nunca cortadas por el medio de una palabra. */
  lineas: string[];
  /** El tamaño de letra final, siempre al menos `minimo`. */
  px: number;
  /** El nivel con que quedó: puede ser menor al pedido si el nombre no entraba. */
  nivel: Nivel;
}

/**
 * El nombre de la persona `i` escrito en una caja de `ancho`, a `tamano` píxeles
 * de letra y sin bajar de `minimo`. Prueba el nivel pedido: la letra normal, una
 * línea más chica o dos líneas, siempre sin bajar de `minimo`. Si no entra,
 * baja un nivel (menos texto, la misma letra). La inicial es el último recurso;
 * si ni ella entra, queda a la letra mínima y el que llama decide.
 *
 * `medir(texto, px)` es el ancho que ocupa el texto a esa letra (con PixiJS,
 * `new Text(…).width`; en las pruebas, una cuenta).
 */
export function nombreLegible(
  plan: PlanNombres,
  i: number,
  nivel: Nivel,
  ancho: number,
  tamano: number,
  minimo: number,
  medir: (texto: string, px: number) => number,
): NombreLegible {
  const formas = plan.formas[i];
  for (let n: number = nivel; n >= 1; n--) {
    const texto = formas?.[n - 1] ?? plan.inicial[i] ?? "?";
    const a = ajustar(texto, ancho, (s) => medir(s, tamano), Math.min(1, minimo / tamano));
    const px = tamano * a.escala;
    if (!a.partida && px >= minimo - 1e-6) return { lineas: a.lineas, px: Math.max(px, minimo), nivel: n as Nivel };
  }
  return { lineas: [plan.inicial[i] ?? "?"], px: minimo, nivel: 1 };
}
