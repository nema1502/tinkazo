import type { Geo } from "../pixi/toborochi-arbol";
import { perfil, type PerfilMapa } from "./camara";
import type { EntradaBase } from "./tipos";

/**
 * El Toborochi en 3D, la cuenta pura: del árbol que el plan 2D ya puso (cada flor en píxeles de la pantalla) al mundo 3D,
 * y la cámara que mira lo mismo que el director del 2D. Sin three.js ni DOM: se prueba en Node.
 *
 * El mundo. El 2D dibuja el árbol de frente, con la `y` de la pantalla hacia abajo. El 3D lo mira igual (de frente, casi
 * a la altura de la vista) y por eso la `y` del 2D es una **altura**: `Y = suelo - y`. La profundidad de cada flor sale de
 * un hash de su lugar en la copa (nunca de quién es ni de quién gana) y es chica, para que el árbol tenga volumen sin que
 * ninguna se vea más grande que otra. La alfombra de abajo es el piso que viene hacia quien mira: lo que el 2D pone en la
 * franja de la alfombra, el 3D lo apoya en el piso a la profundidad en que la cámara en reposo lo ve en ese mismo lugar
 * de la pantalla (`aMundo`), así los nombres de la alfombra y las flores tendidas quedan juntos como en el 2D.
 *
 * La cámara. Mira al mismo punto que el director del 2D, a la distancia que encuadra lo mismo. Encima de eso solo suma
 * altura y un giro chico, y de la hora del show: nunca de quién gana.
 */

/** Cuántos píxeles de profundidad (en proporción al alto de la pantalla) tiene la copa de lado a lado. */
export const PROF_COPA = 0.05;
/** El campo de visión, igual que el de la carrera. */
export const FOV = (36 * Math.PI) / 180;

/** Una flor tal como el 2D la dejó en este cuadro, en píxeles de la pantalla. */
export interface FlorE {
  /** El centro de la flor y su giro sobre la pantalla (el que el 2D ya calculó con el viento, el temblor y la caída). */
  x: number;
  y: number;
  rot: number;
  /** El tamaño: 0 cerrada, 1 abierta; con el golpe, crece. */
  escala: number;
  /** Ya llegó a la alfombra. */
  suelo: boolean;
  /** Cuánto de su caída hizo, de 0 a 1 (0 si todavía está en el árbol). */
  cae: number;
  /** Cuánto brilla, de 0 a 1: la que se va con premio mientras cae y la que se enciende con el golpe. */
  brillo: number;
  /** Su lugar en la copa unitaria: de ahí sale su profundidad. */
  u: number;
  v: number;
  /** Dónde se prende su ramita a la rama (la rama a la altura de su abanico), o NaN si ya no tiene. */
  rx: number;
  ry: number;
}

export interface RamaE {
  /** El extremo de la rama en la pantalla (el pie es `geo.cx`, `geo.copa.base`). */
  x1: number;
  y1: number;
  /** 1 entera, 0 desvanecida (la rama que se quedó sin flores). */
  alfa: number;
}

export interface ColibriE {
  visible: boolean;
  x: number;
  y: number;
  /** 1 mira a la derecha, -1 a la izquierda. */
  mira: 1 | -1;
  /** Cuántos píxeles mide una unidad del dibujo del colibrí. */
  escala: number;
  /** 0 quieto, 1 aleteo a pleno. */
  aleteo: number;
  /** Cuánto adelante de la flor vuela, en radios de flor (negativo: atrás de la copa). Es igual para las dos visitas. */
  prof: number;
}

/** Lo que el 3D recibe en cada cuadro además de lo común: lo que el 2D ya puso, y nada de quién gana hasta el golpe. */
export interface EntradaToborochi extends EntradaBase {
  geo: Geo;
  n: number;
  /** Con más de 64 no hay caras ni contorno en cada flor. */
  conCara: boolean;
  flores: FlorE[];
  ramas: RamaE[];
  colibri: ColibriE;
  /** La fuerza del viento, de 0 a 1; por dónde va el frente (-1 si no hay ráfaga) y de qué ráfaga. */
  viento: number;
  frente: number;
  olaJ: number;
  /** Cuánto se nubla el cielo (solo el cielo), de 0 a 1. */
  nube: number;
  /** Segundos desde el golpe (-1 antes), y la hora en que quedan dos. */
  tau: number;
  tQuedan0: number;
  /** La hora en que el colibrí mete el pico (desde ahí la cámara se va sobre quien gana): solo para los medidores. */
  tPico: number;
  /** Quién gana, recién cuando cae el golpe (-1 antes). */
  ganador: number;
}

/** Lo que `pantallaDe` devuelve para una flor: donde apoya su nombre, y dónde y cómo cae su cara. */
export interface PantallaFlor {
  /** (x, y) es el punto de arriba de la flor, y `alto` lo que mide de arriba abajo. */
  x: number;
  y: number;
  alto: number;
  /** Cuánto mira a la cámara, de -1 (de espaldas) a 1 (de frente). */
  mira: number;
  /** La cara: su matriz en la pantalla (para `setFromMatrix` de PixiJS, con la imagen de 1 por 1 y centrada). */
  m: { a: number; b: number; c: number; d: number; tx: number; ty: number };
}

const c01 = (v: number): number => Math.max(0, Math.min(1, v));
export const suave = (v: number): number => {
  const x = c01(v);
  return x * x * (3 - 2 * x);
};

/** La distancia de la cámara al árbol, en píxeles del dibujo, con la pantalla de alto `h` y sin acercamiento. */
export const distanciaDe = (h: number): number => h / (2 * Math.tan(FOV / 2));

/** La mayor profundidad de una flor hacia cada lado, en píxeles. */
export const profMax = (h: number): number => PROF_COPA * h;

/**
 * La profundidad de una flor: un hash de su lugar en la copa más una panza suave (el centro un poco más adelante).
 * Nunca depende de quién está en la flor. Entre -1 y 1 veces `profMax`.
 */
export function profundidadDe(u: number, v: number, h: number): number {
  const a = Math.floor((u + 1) * 500) * 7919 + Math.floor(v * 1000) * 104729;
  let x = Math.imul(a | 0, 0x27d4eb2d) ^ 0x165667b1;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  const r = ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  const panza = 1 - u * u;
  return profMax(h) * (0.55 * (r * 2 - 1) + 0.45 * (panza * 2 - 1) * 0.5);
}

/** Un punto del 2D en el mundo 3D, en píxeles del dibujo: `X` a lo ancho, `Y` la altura sobre el piso, `Z` hacia quien mira. */
export interface PuntoMundo {
  X: number;
  Y: number;
  Z: number;
  /** Cuánto se achica lo que está ahí para verse del mismo tamaño que en el 2D (1 en el árbol; menos en la alfombra, que viene hacia la cámara). */
  k: number;
}

/**
 * De un punto de la pantalla 2D (`x`, `y`) al mundo. Por encima del suelo del árbol, es el plano del árbol con su
 * profundidad `dz`. Por debajo, la alfombra: el piso, a la profundidad en que la cámara en reposo lo vería en esa `y`
 * (la cámara está a la altura de `cy0` sobre el piso `suelo`), y corrido hacia el centro para caer en la misma `x`.
 */
export function aMundo(g: Geo, D: number, x: number, y: number, dz: number): PuntoMundo {
  if (y <= g.suelo) {
    // La profundidad se apaga hacia el suelo, para que una flor que cae se junte con la alfombra sin un salto.
    const m = c01((g.suelo - y) / Math.max(1, g.copa.alto * 0.3));
    return { X: x, Y: g.suelo - y, Z: dz * m, k: 1 };
  }
  const cy0 = (g.top + g.bottom) / 2;
  const Hc = Math.max(1, g.suelo - cy0);
  const d = Math.max(Hc, y - cy0);
  const k = Hc / d;
  return { X: g.cx + (x - g.cx) * k, Y: 0, Z: D * (1 - k), k };
}

/** La altura de la cámara sobre el horizonte en el show: entra un poco más arriba y baja; con el golpe, un contrapicado leve. */
export function elevacionEn(t: number, tau: number): number {
  return 0.17 * (1 - suave(t / 2.6)) - 0.07 * suave(tau / 0.6);
}

/** El giro de la cámara alrededor del árbol: desde «quedan dos», cinco grados hacia un lado fijo (el mismo siempre). */
export function azimutEn(t: number, tQuedan0: number): number {
  return 0.085 * suave((t - tQuedan0) / 2.2);
}

/** El perfil de la cámara de este cuadro: mira a la altura que el director mira, a la distancia que encuadra lo mismo. */
export function perfilEn(e: Pick<EntradaToborochi, "t" | "tau" | "tQuedan0" | "geo" | "cam">): PerfilMapa {
  return perfil({
    zc: 1,
    elevacion: elevacionEn(e.t, e.tau),
    azimut: azimutEn(e.t, e.tQuedan0),
    acerca: 1,
    tam: 1,
    // El centro de la cámara 2D es una `y` de pantalla; en el 3D es la altura sobre el piso.
    altoMira: e.geo.suelo - e.cam.y,
    pieMira: 0,
  });
}

/** La cámara del director, lista para el motor: sin la inclinación de la escena (el horizonte queda quieto, con tope de dos grados). */
export function camaraParaMotor(c: EntradaBase["cam"]): EntradaBase["cam"] {
  const tope = (2 * Math.PI) / 180;
  return { ...c, y: 0, rot: Math.max(-tope, Math.min(tope, c.rot || 0)) };
}

/** Una entrada vacía, con los arreglos ya armados: el 2D la llena en cada cuadro sin crear nada. */
export function entradaVacia(n: number, geo: Geo, conCara: boolean): EntradaToborochi {
  return {
    t: 0,
    w: geo.w,
    h: geo.h,
    u: 1,
    cam: { x: geo.w / 2, y: (geo.top + geo.bottom) / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
    geo,
    n,
    conCara,
    flores: Array.from({ length: n }, () => ({ x: 0, y: 0, rot: 0, escala: 0, suelo: false, cae: 0, brillo: 0, u: 0, v: 0, rx: Number.NaN, ry: Number.NaN })),
    ramas: [],
    colibri: { visible: false, x: 0, y: 0, mira: 1, escala: 10, aleteo: 0, prof: 0 },
    viento: 0,
    frente: -1,
    olaJ: -1,
    nube: 0,
    tau: -1,
    tQuedan0: Number.POSITIVE_INFINITY,
    tPico: Number.POSITIVE_INFINITY,
    ganador: -1,
  };
}
