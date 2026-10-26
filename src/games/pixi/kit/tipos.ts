import type { Texture } from "pixi.js";
import type { Arc, Story } from "../../drama";
import type { Caja, Zona } from "../encuadre";
import type { FocoPunto } from "../foco-vista";
import type { Estadio, Musica } from "./anfitrion";
import type { Figura, ModoFiguras } from "./figuras";
import type { Rol } from "./nombres";
import type { Direccion, Respuestas, TipoPaso } from "./respuestas";
import type { Sonido } from "./sonido";

/**
 * Los tipos del kit de juegos: la frontera entre un juego y el motor.
 *
 * Un juego recibe la semilla, la lista y los momentos, y devuelve el show. Todo
 * lo demás (el selector, los textos de la página, los auditores) se conecta por
 * fuera, desde `catalogo.ts` y `anfitrion.ts`: en este archivo no hay nada que
 * sepa de tinkazo.app (`docs/juegos.md`, "Cómo nace un juego").
 */
export type { Arc, Caja, Zona, FocoPunto, Story, Direccion, Respuestas, TipoPaso };

export type Idioma = "es" | "en";

/** Lo que el kit lee de la baliza pública: el número y el azar que la ronda trae. */
export interface Baliza {
  round: number;
  randomness: string;
  signature: string;
}

/** Cómo se lanza un juego: la misma firma que usa `pixi/index.ts`. */
export type Lanzador = (nombres: string[], ganadores: readonly number[], baliza: Baliza, listo: () => void) => Promise<void>;

/** Lo mínimo de la cámara que usa el director, para probarlo sin placa de video. */
export interface Camara {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  lookAt(x: number, y: number, zoom?: number, rate?: number, rot?: number): unknown;
  tension(dur: number, amt: number): unknown;
  golpe(amt?: number, hold?: number, vuelta?: number): number;
  punch(z: number): unknown;
  shake(a: number): unknown;
  proteger(caja: Caja | null, zona?: Zona): unknown;
  toScreen(x: number, y: number, sw: number, sh: number): { x: number; y: number };
}

/** Lo que mira la cámara: el punto del mundo que va en el medio de la pantalla, y el acercamiento. */
export interface Vista {
  x: number;
  y: number;
  z: number;
}

/**
 * Un plano de cámara. O una caja del mundo que tiene que verse entera (el
 * director la encuadra entre la barra de arriba, el relator y el cartel), o una
 * vista ya calculada por el juego. `ritmo` es qué tan seco llega (3 si no se
 * pide otro) y `respira` cuánto late el acercamiento, como fracción: un plano
 * nunca se queda quieto.
 */
export type PlanoToma = ({ caja: Caja; zoomMax?: number; zona?: Zona } | { vista: Vista }) & {
  ritmo?: number;
  respira?: number;
};

/** Una toma: dónde mirar en el segundo `t` del juego. */
export type Toma = (k: Kit, t: number) => PlanoToma;

/** Los momentos de cámara de un plan, en segundos de juego. */
export interface Momentos {
  /** Plano entero mientras cada uno se busca en la pantalla. */
  presentacion: { hasta: number; toma: Toma };
  /** Planos intermedios: el último que ya empezó es el que vale. */
  tomas?: readonly { desde: number; toma: Toma }[];
  /**
   * La tensión: desde `desde` la cámara se acerca lento hacia lo que decide
   * (el puntero, los que quedan), nunca sobre el ganador solo: apuntar a uno
   * solo lo delata. `empuje` pisa el 12 % de siempre.
   */
  tension: { desde: number; toma: Toma; empuje?: number };
  /** Dónde está quien gana en la pantalla. Se pide recién al coronar. */
  foco(k: Kit): FocoPunto;
  /**
   * La meta (la llegada, la flecha, la cumbre, la tiza) o la cinta del camino, si el juego la tiene: la cámara
   * la guarda en todo cuadro y ninguna toma la suelta. Regla 1 de la regla del niño.
   */
  meta?(k: Kit, t: number): Caja | null;
  /** Lo que ningún zoom puede cortar una vez que sale el ganador (opcional). */
  protegido?(k: Kit): { caja: Caja; zona: Zona } | null;
}

/**
 * Una línea del guion: algo que dice el relator, algo que pasa, o las dos
 * cosas. Los textos llegan resueltos (`ctx.txt`), en el idioma de la sala.
 */
export interface LineaGuion<K = Kit> {
  /** El segundo de juego en que le toca. */
  t: number;
  /**
   * Lo que dice el relator. Una función lo arma recién cuando se dice: así una
   * frase con variantes sortea en el segundo en que sale y no antes, y el azar
   * del juego se gasta en el mismo orden que si la dijera el propio juego.
   */
  texto?: string | (() => string);
  /** De 0 a 1: cuánta tensión pone en la música. */
  calor?: number;
  /** 1 normal, 2 importante, `PRIORIDAD.ganador` pisa todo. */
  prioridad?: number;
  /** El relator la dice entera en mayúsculas. */
  grito?: boolean;
  /** Cuántos segundos puede esperar en la cola antes de tirarse (1,5 si no se pide otro). */
  vence?: number;
  /**
   * Lo que esta línea cuenta, si cuenta un hecho (una salida, un paso adelante): a los 0,3 s de la línea el
   * cuerpo lo tiene que mostrar, y `respuestas` lo tiene que decir (`problemasDeRespuestas`).
   */
  hecho?: { tipo: TipoPaso; quien?: number };
  /** Algo que pasa en ese segundo: un sonido, un sacudón. */
  hacer?: (k: K) => void;
}

/** Lo que un juego decide antes de arrancar, puro y probable en Node. */
export interface Plan<P> {
  /** Segundos de juego hasta coronar. */
  duracion: number;
  /** El arco del director de emoción: da el sabor de la cámara y los tiempos del foco. */
  arco: Arc;
  /** Cuándo se corta la música antes del golpe (la duración si no se pide otro). */
  respiro?: number;
  momentos: Momentos;
  guion: readonly LineaGuion[];
  /** Hacia dónde avanza el juego: un solo sentido de principio a fin, y `respuestas.hacia` lo repite en todo cuadro. */
  sentido: Direccion;
  /** Cuántos siguen en el segundo `t`: el único contador, arriba a la izquierda en todos los juegos (`marcador.ts`). */
  marcador(t: number): number;
  /** La prueba del niño: en el segundo `t`, quién va adelante, hacia dónde, cuánto falta y qué acaba de pasar. */
  respuestas(t: number): Respuestas;
  /**
   * Cuánto promete "Normal" este juego, en segundos de show, si no es lo de todos los juegos (la carrera dura más
   * cuanta más gente corre). `null` o sin decir: vale el de siempre.
   */
  normal?: number | null;
  /** Datos que quedan anotados para los auditores (`data-*` del lienzo). */
  marcas?: Readonly<Record<string, string>>;
  /** Lo propio del juego: el kit no lo mira. */
  datos: P;
}

/** Lo que recibe el plan: la ronda y los medios para sembrarla, sin tocar la pantalla. */
export interface Contexto {
  readonly nombres: string[];
  readonly ganadores: readonly number[];
  /** El `randomness` de la baliza. */
  readonly ronda: string;
  /** El azar de la ronda. El kit nunca lo llama: lo gasta el plan, en el orden que quiera. */
  readonly rng: () => number;
  readonly idioma: Idioma;
  /** Una frase en el idioma de la sala. */
  txt(clave: string, ...args: readonly unknown[]): string;
  /** Un azar derivado de la ronda y de una etiqueta; no gasta el `rng`. */
  azar(etiqueta: string): number;
  /** La historia del director de emoción. Gasta `rng` en el momento en que se la pide. */
  historia(actores: number, ganador: number): Story;
}

/** Lo que reciben la escena y las tomas: el estadio, la cámara y los módulos del kit. */
export interface Kit {
  readonly S: Estadio;
  readonly cam: Estadio["cam"];
  readonly nombres: readonly string[];
  readonly ganadores: readonly number[];
  readonly ronda: string;
  readonly idioma: Idioma;
  /** La hora del juego, en segundos. */
  readonly t: number;
  /** Ya cayó el golpe: quien gana ya está a la vista. */
  readonly coronado: boolean;
  /** La escena que devolvió `arma`, para que las tomas y el foco la puedan mirar (el tipo lo conoce el juego). */
  readonly escena: unknown;
  txt(clave: string, ...args: readonly unknown[]): string;
  azar(etiqueta: string): number;
  /** Sostiene la música en esa tensión (de 0 a 1) sin decir nada: el tic de una espera. */
  calor(tension: number): void;
  readonly sonido: Sonido;
  /** La figura de cada persona, en el orden de la lista. */
  readonly figuras: readonly Figura[];
  /**
   * La escala con que se pide un chip del estadio (`S.chip(nombre, escala)`) para que la figura mida lo que pide
   * la regla (`tamanoMinimoFigura`): la persona es una figura con cara y nombre, no un emblema de 30 px.
   */
  escalaDeFigura(): number;
  /** La textura de la persona `i`: su emblema o su cara. */
  figura(i: number): Texture;
  /** El tamaño de letra mínimo de un rol (nombre, apoyo, cartel) en esta pantalla. */
  letra(rol: Rol): number;
  /** La pantalla y la franja libre entre la barra de arriba y el relator. */
  pantalla(): { w: number; h: number; k: number; top: number; bottom: number; retrato: boolean };
}

export type Dic = Readonly<Record<string, string | ((...args: any[]) => string)>>;

/** Los textos propios de un juego, en los dos idiomas: así el juego viaja sin el diccionario del sitio. */
export interface Textos {
  es: Dic;
  en: Dic;
}

/** La definición de un juego: el plan puro, la escena y el cuadro. */
export interface DefJuego<P, E> {
  /** El valor de `?demo=` y la clave de los auditores. */
  id: string;
  musica?: Musica;
  /** Caras de siempre o un emblema por persona. */
  figuras?: ModoFiguras;
  /** `false` para coronar sin foco (el cartel sale como siempre). */
  foco?: boolean;
  textos?: Textos;
  /** Puro: de la lista y la ronda, el plan. */
  plan(ctx: Contexto): Plan<P>;
  /** Dibuja. Se llama al empezar y de nuevo al cambiar el tamaño, con la escena anterior. */
  arma(k: Kit, plan: Plan<P>, previa?: E): E;
  /** Una función de `t`: pone la escena como va en ese segundo. */
  cuadro(k: Kit, plan: Plan<P>, escena: E, t: number): void;
}
