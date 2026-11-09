/**
 * El 3D de la carrera, en lo que no necesita three.js: los tipos del enchufe y
 * la cuenta que pasa el mundo del 2D (píxeles) al del 3D (unidades) y la
 * cámara del 2D a una cámara con perspectiva. Puro, sin DOM, para probarlo en Node.
 *
 * El 3D no calcula nada de la carrera. Cada cuadro recibe lo que la escena 2D
 * (`carrera.ts`) ya puso: dónde está cada llama, qué postura tiene y adónde
 * mira la cámara del director. Acá solo se cambia de unidades:
 *
 * - `x3 = x * s`: el avance de la carrera es el mismo, uno a uno.
 * - `z3 = y * s * ZC`: la profundidad es la fila o el carril de la pantalla, un
 *   poco más separada (`ZC`), porque con la cámara en altura las filas se
 *   comprimen y los nombres se pisarían.
 * - la altura es la altura del dibujo, a la misma escala `s`.
 *
 * `s` sale de la unidad `u` de la pantalla (`1 / (30 u)`): así el mundo 3D mide
 * lo mismo en un celular que en un proyector, y la cámara es la que cambia.
 */

import { LLAMA_ALTO } from "./carrera-forma";
import type { TemaCarrera } from "./carrera-luz";
import type { Momento } from "./llama";

/** Cuánto se ensancha la profundidad respecto de las filas de la pantalla. */
export const ZC = 1.2;
/** La cámara mira desde esta altura sobre el horizonte, en radianes (unos 27 grados). */
export const ELEVACION = 0.62;
/**
 * Qué parte del ancho del 2D encuadra el 3D: con perspectiva y la pista en diagonal, a pleno ancho las llamas
 * quedaban chicas y las fichas de nombre las tapaban.
 */
export const ACERCA = 0.82;
/** Y desde este costado: positivo, un poco por delante de lo que mira, para ver las caras. */
export const AZIMUT = 0.22;
/** Campo de visión vertical, en radianes (36 grados). */
export const FOV = (36 * Math.PI) / 180;

/** Unidades 3D por píxel del mundo 2D, para una pantalla con unidad `u`. */
export const escala3D = (u: number): number => 1 / (30 * Math.max(0.1, u));

/** Una persona que corre, tal como la dejó la escena 2D en este cuadro. */
export interface Corredora3D {
  persona: number;
  /** Dónde pisa, en píxeles del mundo 2D. */
  x: number;
  y: number;
  /** Cuánto sube de golpe (la ganadora festejando), en píxeles. */
  salto: number;
  /** Cuánto se agranda el dibujo respecto de su tamaño base (el de `LLAMA_ALTO`). */
  esc: number;
  velocidad: number;
  momento: Momento;
  /** La fase del paso, en radianes. */
  fase: number;
}

/** La borla del líder: dónde pisa quien la lleva y a qué altura va. */
export interface Borla3D {
  x: number;
  pie: number;
  alto: number;
  radio: number;
  /** Quién la lleva en este cuadro (la que va adelante en el momento). */
  duenia: number;
  /** La carrera nueva: en vez de la borla, una manta amarilla sobre el lomo (una tira de color). */
  manta?: boolean;
  /** Va de una llama a otra: la marca sigue `x` y `pie`, que se deslizan, y no la llama de su dueña. */
  vuela?: boolean;
}

/** La cámara del director del 2D en este cuadro. */
export interface Camara2D {
  x: number;
  y: number;
  zoom: number;
  rot: number;
}

/**
 * Un obstáculo en marcha (`carrera-obstaculos.ts`), tal como la escena 2D lo ve en este cuadro, en píxeles del mundo 2D. El plan decide
 * cuándo y a quién; el 3D solo lo dibuja: las piedras que caen y ruedan, el polvo y el pasto de la ráfaga.
 */
export interface Efecto3D {
  tipo: "piedras" | "viento";
  /** Cuánto lleva la animación, de 0 a 1. */
  s: number;
  /** Piedras: donde cae la principal (x) y el piso del carril (y). Viento: el centro del grupo (x) y el piso del primer carril (y). */
  x: number;
  y: number;
  /** Viento: el piso del último carril, y cuánto mide el grupo a lo ancho. */
  y1: number;
  ancho: number;
  /** Viento: hacia dónde corre (-1 hacia arriba de la pantalla, 1 hacia abajo). */
  lado: number;
  /** Cuál de los obstáculos de la recta es (para repartir lo que parece azar con un hash). */
  id: number;
}

/** La valla del salto: cruza los carriles de la final en `x`, con `alto` píxeles de altura. */
export interface Valla3D {
  x: number;
  y0: number;
  y1: number;
  alto: number;
}

/** Lo que la escena le da a la vista 3D en cada cuadro. */
export interface Entrada3D {
  t: number;
  w: number;
  h: number;
  u: number;
  cam: Camara2D;
  /**
   * La cámara del director 3D (`carrera-camara.ts`): de la recta al festejo manda sobre `cam`, que sigue siendo la del director del 2D
   * y es la de antes. Sin `pose`, el 3D mira lo que mira el 2D.
   */
  pose?: Pose3D | null;
  gente: Corredora3D[];
  borla: Borla3D | null;
  campeona: number;
  /** Segundos desde que la ganadora cruza la meta (negativo antes). */
  corona: number;
  /** Los obstáculos que están pasando en este cuadro. */
  efectos: Efecto3D[];
  /** Para los auditores: la hora de juego en que la recta está al 25, 50, 70, 88 y 100 % (`d.tDeQ`). */
  horas: number[];
}

/** El terreno de cada tramo del camino, con sus colores. */
export interface ZonaSuelo {
  desde: number;
  hasta: number;
  tipo: "corral" | "cuesta" | "barro" | "piedras" | "viento" | "recta";
  color: number;
  acento: number;
}

/** El mundo 2D que el 3D tiene que vestir: dónde están la salida, la meta, el camino y los carriles. */
export interface Geometria3D {
  w: number;
  h: number;
  u: number;
  /** Dónde está el frente del grupo parado, la línea de salida (0), el comienzo de la recta y la meta, en x del mundo. */
  F0: number;
  Xs: number;
  metaX: number;
  gateX: number;
  /** La franja de la pista, de arriba a abajo en y del mundo, y la de los carriles de la final. */
  y0: number;
  y1: number;
  carY0: number;
  carY1: number;
  carN: number;
  zonas: ZonaSuelo[];
  /** Cada cuántos píxeles va un poste con su bandera. */
  pasoPostes: number;
  /** Hay tandas: el portón queda en `gateX`. */
  conPorton: boolean;
  /** Hay portones de la recta, donde el grupo se abre en carriles. */
  conPortonesRecta: boolean;
  /** Cuánto mide el corral hacia atrás de la línea de salida. */
  corral: number;
  rotuloMeta: string;
  rotuloSalida: string;
  /** Las vallas del salto, si la carrera las tiene. */
  vallas: Valla3D[];
}

export interface Pantalla3D {
  x: number;
  y: number;
  /** El alto que ocupa la llama en la pantalla, en píxeles. */
  alto: number;
}

/** Una caja en la pantalla, en píxeles: de `x0,y0` (arriba a la izquierda) a `x1,y1`. */
export interface CajaPantalla3D {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Lo que el enchufe espera de la vista 3D. Se arma con `Fabrica3D`. */
export interface Vista3D {
  /** Dibuja el cuadro: acomoda la escena, mueve la cámara y renderiza. */
  frame(e: Entrada3D): void;
  /** Dónde cae en la pantalla la cabeza de `persona` en el último cuadro, o null si no se ve. */
  pantallaDe(persona: number): Pantalla3D | null;
  /**
   * Dónde caen en la pantalla las letras de los letreros del mundo (SALIDA y META) con la cámara del último cuadro: solo los que están delante de la
   * cámara y asoman, aunque sea en parte, en la pantalla. Las fichas de nombre no se les ponen encima.
   */
  letreros(): CajaPantalla3D[];
  /** El mundo cambió (otro tamaño de pantalla): rearma lo fijo. */
  reconstruir(g: Geometria3D): void;
  destruir(): void;
}

export interface OpcionesFabrica3D {
  /** El lienzo de PixiJS: el 3D va justo debajo. */
  lienzoPixi: HTMLCanvasElement;
  geometria: () => Geometria3D;
  /** El color del pelaje y el de la manta de cada persona. */
  colores: (persona: number) => { pelaje: number; manta: number };
  /** Si piden anotar lo que se dibuja para los auditores (`?auditar=3d`). */
  auditar: boolean;
  /** El tema de la página: el día en el claro, el atardecer en el oscuro (`carrera-luz.ts`). */
  tema: TemaCarrera;
}

export type Fabrica3D = (o: OpcionesFabrica3D) => Vista3D;

/**
 * Cuánto se agranda cada llama respecto de su tamaño en el 2D. Las filas del 2D dejan lugar para el nombre
 * arriba de cada llama; en el 3D el nombre queda en la pantalla y la llama puede ocupar más de su fila.
 */
export const TAM3D = 1.45;

/** Dónde pisa una persona en el mundo 3D, y de qué tamaño. */
export interface Puesto3D {
  persona: number;
  x: number;
  y: number;
  z: number;
  /** Cuánto se escala el modelo de la llama (que está en píxeles del dibujo). */
  escala: number;
}

/** El único lugar donde la posición del 2D pasa al 3D: la usa la vista y la prueba contra el plan. */
export function colocar(c: Corredora3D, u: number): Puesto3D {
  const s = escala3D(u);
  return { persona: c.persona, x: c.x * s, y: Math.max(0, c.salto) * s, z: c.y * s * ZC, escala: c.esc * s * TAM3D };
}

export interface Pose3D {
  pos: [number, number, number];
  mira: [number, number, number];
  fov: number;
  /** Cuánto gira la cámara sobre su eje, en radianes (la inclinación del director). */
  giro: number;
}

/**
 * La cámara del 3D a partir de la del 2D.
 *
 * Mira al mismo punto: el centro de la pantalla del 2D es el centro del cuerpo
 * de quien está en esa fila. Y está a la distancia en que el ancho que se ve a
 * esa altura es el mismo que veía el 2D con ese acercamiento (`w / zoom`): lo
 * que el director encuadra a lo ancho, el 3D lo encuadra a lo ancho. `escRef`
 * es el tamaño de las llamas que se miran, para saber a qué altura queda el
 * centro de su cuerpo.
 */
export function camara3D(cam: Camara2D, w: number, h: number, u: number, escRef: number): Pose3D {
  const s = escala3D(u);
  const zoom = Math.max(0.05, cam.zoom || 1);
  const cuerpo = 0.5 * LLAMA_ALTO * escRef;
  const mira: [number, number, number] = [cam.x * s, cuerpo * s * TAM3D, (cam.y + cuerpo) * s * ZC];
  const dist = ((h / zoom) * s * ACERCA) / (2 * Math.tan(FOV / 2));
  const ce = Math.cos(ELEVACION);
  return {
    pos: [mira[0] + dist * Math.sin(AZIMUT) * ce, mira[1] + dist * Math.sin(ELEVACION), mira[2] + dist * Math.cos(AZIMUT) * ce],
    mira,
    fov: FOV,
    giro: cam.rot || 0,
  };
}

/** El aire mínimo, en píxeles, entre la llama que va adelante y el borde de la pantalla (con una holgura para que no roce). */
export const AIRE_LIDER = 24;
export const HOLGURA_LIDER = 14;

/**
 * Cuántos píxeles hay que correr la cámara hacia la derecha (positivo) o la izquierda (negativo) para que la llama que va
 * adelante, que ocupa de `x0` a `x1` en una pantalla de ancho `w`, quede entera con `aire` píxeles de margen. Cero si ya
 * está adentro. Solo en pantallas más altas que anchas: en un celular parado, la perspectiva empuja el carril de afuera
 * fuera del encuadre que decidió el director del 2D. Si no entra ni centrada, la centra.
 */
export function corrimientoLider(x0: number, x1: number, w: number, h: number, aire = AIRE_LIDER + HOLGURA_LIDER): number {
  if (w >= h) return 0;
  if (x1 - x0 > w - 2 * aire) return (x0 + x1) / 2 - w / 2;
  if (x1 > w - aire) return x1 - (w - aire);
  if (x0 < aire) return x0 - aire;
  return 0;
}

/** Las puntas de una llama, en unidades del dibujo y desde su origen (pies, centro): nariz, cola, cabeza arriba y los costados del cuerpo. */
export const PUNTOS_LLAMA: ReadonlyArray<readonly [number, number, number]> = [
  [38, 36, 0], [-36, 40, 0], [14, 100, 0], [0, 30, 13], [0, 30, -13], [14, 0, 0], [-14, 0, 0],
];
