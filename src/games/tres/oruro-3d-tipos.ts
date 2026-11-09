import type { Renderer, Texture } from "pixi.js";
import type { Instrument, PoseMode, Wardrobe } from "../pixi/entrada-bailes";
import type { Dance } from "../pixi/entrada-plan";
import { perfil, type PerfilMapa } from "./camara";
import type { EntradaBase } from "./tipos";

/**
 * Lo que La Entrada le pasa a su vista en 3D, y las cuentas puras del 3D (qué cuadro del ciclo toca, cómo se mira en
 * cada tramo). Sin three.js: el archivo del juego en 2D lo importa solo por sus tipos, y las pruebas lo corren en Node.
 *
 * El 3D de La Entrada es un teatro de papel: la calle, las fachadas, los arcos y el Socavón son de verdad, y cada
 * bailarín es un recorte de cartón parado en la calle, con el dibujo ya revisado del 2D (`entrada-bailes.ts`) como
 * textura. El 3D no decide nada: el cuadro del ciclo, el salto y la inclinación salen de lo que el 2D ya calculó.
 */

/** Cuánto mide la celda de un recorte en el atlas, en unidades del dibujo del 2D, y dónde pisa (sus pies). */
export const CELDA_W = 120;
export const CELDA_H = 156;
export const ANCLA_X = 60;
export const ANCLA_Y = 146;
/** La cabeza del dibujo, respecto de los pies (`HEAD_Y` en entrada-bailes.ts), hacia arriba. */
export const CABEZA_ALTO = 86;

/** Cuántos cuadros tiene cada ciclo del atlas. */
export const N_BAILE = 16;
export const N_SALUDO = 6;
export const N_TROPIEZO = 6;
export const N_CAIDA = 8;
export const N_MUSICA = 8;

/** `pantallaDe(ANCLA_FRAT + g)`: dónde cae sobre el bloque de la fraternidad `g` el cartel con su nombre. */
export const ANCLA_FRAT = 100000;
/** `pantallaDe(CUERPO_ENTERO + id)`: el cuerpo entero, de los pies a la punta de lo que lleva en la cabeza (el foco del ganador). */
export const CUERPO_ENTERO = 200000;

export type Tramo = "pres" | "walk" | "duel" | "crown";

/** Un bailarín tal como el 2D lo dejó en este cuadro. Todo en píxeles del mundo 2D salvo lo que dice. */
export interface BailarinOruro {
  id: number;
  /** Su fraternidad. */
  g: number;
  /** Con el traje de ellas. */
  mujer: boolean;
  /** Dónde pisa. */
  x: number;
  y: number;
  modo: PoseMode;
  /** La fase efectiva del paso, en radianes (la del 2D más los desfases propios de cada uno). */
  fase: number;
  /** En el salto la altura; en el tropezón y la caída, por dónde va (0 a 1). */
  f: number;
  /** Para dónde se cae: -1 izquierda, 1 derecha. */
  dir: number;
  /** El reloj de la pose (el saludo y lo que gira solo). */
  t: number;
  /** El desfase propio de su traje (para el saludo). */
  semilla: number;
  /** Cuánto sube el cuerpo en unidades del dibujo (negativo: se hunde al caer sentado). */
  alto: number;
  /** La inclinación del cuerpo, en radianes. */
  inclina: number;
  /** La escala del dibujo: la horizontal lleva el signo (mira para un lado o para el otro). */
  ex: number;
  ey: number;
  /** A qué altura del dibujo apoya su nombre (ya con el salto del contrapunto). */
  nombre: number;
  /** Lo que mide de alto con lo que lleva en la cabeza. */
  tope: number;
  /** Dónde va lo que lleva en la cabeza respecto de su lugar de reposo, en unidades del dibujo, y cuánto gira. */
  cdx: number;
  cdy: number;
  crot: number;
}

export interface MusicoOruro {
  i: number;
  kind: Instrument;
  x: number;
  y: number;
  /** La fase del bombo de la banda, en radianes. */
  fase: number;
  /** 1 toca, 0 está quieto. */
  e: number;
  alto: number;
  inclina: number;
  ey: number;
}

export interface FraternidadOruro {
  g: number;
  dance: Dance;
  color: number;
}

/** Lo que se arma una sola vez por ronda: quiénes hay y con qué se dibujan. */
export interface RepartoOruro {
  /** Cuántas personas hay en la ronda. */
  n: number;
  frats: FraternidadOruro[];
  /** La fraternidad del final: la del ganador. Sus recortes llevan también el salto, el tropezón y la caída. */
  heroe: number;
  /** Qué trajes hay en la calle: una fraternidad, con el traje de ellos y el de ellas. */
  clases: { g: number; mujer: boolean }[];
  banda: Instrument[];
  /** El retrato de cada persona, por su lugar en la lista (el del 2D: el emblema de su nombre). */
  caras: Texture[];
  /** Para pasar los trajes a cartón: el motor de PixiJS y el ropero del 2D. */
  pixi: { renderer: Renderer; wardrobe: Wardrobe };
}

/** El lugar de las cosas fijas de la calle, en píxeles del mundo 2D. Cambia (otro objeto) cuando cambia el tamaño de la pantalla. */
export interface MundoOruro {
  k: number;
  streetTop: number;
  streetBot: number;
  x0: number;
  x1: number;
  doorX: number;
  socX: number;
  archX: number[];
  /** La escala de los bailarines (más chicos con más gente). */
  escala: number;
  oscuro: boolean;
}

export interface PancartaOruro {
  g: number;
  x: number;
  y: number;
  color: number;
}

export interface AnclaFrat {
  g: number;
  x: number;
  y: number;
  alto: number;
}

export interface EntradaOruro extends EntradaBase {
  mundo: MundoOruro;
  reparto: RepartoOruro;
  tramo: Tramo;
  /** Las horas del plan que cambian cómo se mira: cuándo arranca el recorrido, el contrapunto, la llegada. */
  horas: { go: number; socavon: number; llegada: number };
  /** De 0 a 1: cuánto se acerca la comparsa al Socavón. */
  cerca: number;
  /** De 0 a 1: cuánto dura el primer plano de los que se quedan (sube y baja suave). */
  primerPlano: number;
  /** La banda se calló: todo congelado. */
  silencio: boolean;
  /** Segundos desde el golpe de la coronación, o -1 si todavía no. */
  golpe: number;
  /** Quien gana, para dejarle su color pleno cuando baja la luz. */
  ganador: number;
  bailarines: BailarinOruro[];
  banda: MusicoOruro[];
  pancartas: PancartaOruro[];
  anclas: AnclaFrat[];
  /** Si el 3D no arranca del todo (los recortes no se armaron), el 2D vuelve a dibujar todo él. */
  reponer2D: () => void;
}

/* ============================================================================ las cuentas del ciclo */

const DOS_PI = Math.PI * 2;
const frac = (x: number): number => x - Math.floor(x);
export const suave = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const mezcla = (a: number, b: number, k: number): number => a + (b - a) * k;

/** El cuadro del ciclo del paso: el paso completo son cuatro tiempos de la banda (4π de fase). */
export const cuadroBaile = (fase: number): number => Math.min(N_BAILE - 1, Math.floor(frac(fase / (2 * DOS_PI)) * N_BAILE));
/** El saludo agita los brazos a `sin(t * 7 + semilla)`: un ciclo cada 2π/7 segundos. */
export const cuadroSaludo = (t: number, semilla: number): number => Math.min(N_SALUDO - 1, Math.floor(frac((t * 7 + semilla) / DOS_PI) * N_SALUDO));
export const cuadroTropiezo = (f: number): number => Math.min(N_TROPIEZO - 1, Math.floor(Math.min(0.9999, Math.max(0, f)) * N_TROPIEZO));
export const cuadroCaida = (f: number): number => Math.min(N_CAIDA - 1, Math.floor(Math.min(0.9999, Math.max(0, f)) * N_CAIDA));
export const cuadroMusica = (fase: number): number => Math.min(N_MUSICA - 1, Math.floor(frac(fase / DOS_PI) * N_MUSICA));
/** El salto tiene dos cuadros: el despegue y lo alto. */
export const cuadroSalto = (f: number): number => (f < 22 ? 0 : 1);

/** Cuánto se cae hacia atrás el recorte al sentarse (0 a 1): el cuerpo se tumba como un cartón. */
export const tumbado = (f: number): number => suave(Math.min(1, Math.max(0, f)) / 0.6);

/** Cuánto baja la luz del mundo con el golpe: al 35 % en un cuarto de segundo, y vuelve al 60 % mientras se sostiene el cartel. */
export function luzDelGolpe(g: number): number {
  if (g < 0) return 1;
  if (g < 0.25) return 1 + (0.35 - 1) * suave(g / 0.25);
  return 0.35 + 0.25 * suave((g - 0.25) / 1.6);
}

/* ============================================================================ cómo se mira */

/** La altura de la cámara por tramo, en radianes. El brief: 12 a 17 grados en la presentación, 30 en el recorrido, 15 en el contrapunto y 6 a 8 en el golpe. */
export const ELEV = { pres: 0.3, walk: 0.5, primer: 0.32, socavon: 0.26, duelo: 0.26, golpe: 0.34 } as const;
/** El giro hacia el Socavón (negativo: la cámara queda del lado de donde vienen y mira hacia donde van). Nunca más de 20 grados. */
export const AZIM = { pres: -0.05, walk: -0.26, duelo: -0.2, golpe: -0.1 } as const;
/** La profundidad se estira para que las filas de la calle se vean como en el 2D con la cámara del recorrido. */
export const ZC_ORURO = 1 / Math.sin(ELEV.walk);

/**
 * Cómo se mira en este cuadro. Es una función de la hora del juego y del tramo, sin memoria: la misma hora se ve igual
 * con cualquier ritmo de cuadros. La profundidad (`zc`) es fija: lo que cambia es solo la cámara, así los bailarines no se
 * corren de lugar cuando ella sube o baja.
 */
export function perfilOruro(e: Pick<EntradaOruro, "t" | "tramo" | "horas" | "cerca" | "primerPlano" | "golpe" | "mundo">): PerfilMapa {
  const { horas, t } = e;
  const toWalk = suave((t - horas.go) / 1.0);
  const toDuel = suave((t - horas.socavon) / 0.9);
  let el: number = ELEV.pres;
  let az: number = AZIM.pres;
  // El recorrido.
  el = mezcla(el, mezcla(ELEV.walk, ELEV.primer, e.primerPlano), toWalk);
  az = mezcla(az, AZIM.walk, toWalk);
  // Llegando al Socavón la cámara baja y el templo aparece al fondo.
  const acerca = e.tramo === "walk" ? e.cerca : 0;
  el = mezcla(el, ELEV.socavon, Math.max(toDuel, acerca * 0.8) * (toWalk > 0 ? 1 : 0));
  az = mezcla(az, AZIM.duelo, toDuel);
  // El golpe: contrapicado del que llega.
  const gol = suave(e.golpe / 0.9);
  el = mezcla(el, ELEV.golpe, e.tramo === "crown" ? Math.max(gol, suave((t - horas.llegada) / 0.8)) : 0);
  az = mezcla(az, AZIM.golpe, e.tramo === "crown" ? gol : 0);
  const hm = 62 * e.mundo.escala;
  return perfil({ elevacion: el, azimut: az, zc: ZC_ORURO, fov: (24 * Math.PI) / 180, acerca: 0.96, tam: 1, altoMira: hm, pieMira: hm });
}
