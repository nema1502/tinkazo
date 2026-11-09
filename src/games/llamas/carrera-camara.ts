/**
 * La cámara del 3D de la carrera, pura: de la recta al festejo, sin DOM ni three.js, para probarla en Node con cualquier
 * pantalla. `carrera-3d.ts` la dibuja y `carrera.ts` la maneja; este archivo solo decide dónde está la cámara y hacia dónde mira.
 *
 * Es lo que pide la sección 4 de la dirección de la carrera y la 2, la foto. La cámara no decide nada
 * del sorteo: lee dónde pisa cada finalista (`posicion` de la escena) y encuadra. Todo sale de la hora y de esas posiciones;
 * no hay azar, y la misma ronda se mira igual cuadro por cuadro.
 *
 * Tampoco depende de cuántos cuadros reales hubo ni de cuándo cayeron (como las fichas de nombre, `carrera-fichas-mov.ts`): lo que se
 * integra en el tiempo, el riel de la recta, avanza sobre una grilla fija de pasos virtuales atada a la hora del show (el paso
 * `k = floor(t * 60)`) y con el objetivo evaluado en la hora de cada paso, no en la del cuadro; y los hitos (la llegada, la foto, el
 * golpe) son horas nominales, no el cuadro que cayó primero. Así, en una hora dada, la cámara es la misma con cuadros a 20, 60 o 120
 * por segundo, y también con un cuadro largo en el medio.
 *
 * Los tramos, con T el instante en que la ganadora cruza la meta:
 *
 * - **base**: hasta que se abre la recta manda la cámara del director del 2D, traducida a perspectiva (`camara3D`).
 * - **recta**: de costado, un poco adelante y baja, sobre un riel junto a la pista: la cámara viaja con el grupo de punta (el
 *   promedio de las cinco de adelante, nunca una sola llama) sin girar. Las finalistas miden de 150 px de alto en 1080 (`ALTO_RECTA`).
 * - **llegada** (de T − 3 s a T + 0,4 s): sin corte, el riel se vuelve la vista de la foto. En los 3 s la cámara gira de a poco hasta quedar
 *   perpendicular a la línea, sube un poco, se acerca `ACERCA_LLEGADA` veces y su punto mirado pasa del riel (que sigue al grupo) a la línea
 *   de la meta: a T mira la línea, de costado, y las que pelean se ven correr hasta ella con su nombre, en el orden en que van. No apunta a
 *   nadie: el riel es el promedio del grupo y la línea es la línea. De T a T + 0,4 s queda quieta: las llamas paran en la línea y se ve quién
 *   tiene la nariz adelante. El plano de frente de antes (un corte a la cámara de la meta, con lente largo) aplastaba la distancia: el público
 *   veía a las ocho «en fila, quietas» y a la ganadora salir de la nada.
 * - **foto** (de T + 0,4 s al golpe): la misma vista, y un acercamiento de `ACERCA_LLEGADA` a `FOTO_A` veces sobre las narices que llega
 *   justo cuando cae el golpe. La línea cae vertical en el centro de la pantalla (la cámara está en su plano), así que la nariz que la pasó
 *   primero se ve pasada en cualquier carril.
 * - **festejo** (del golpe en adelante): desde el golpe, la cámara se acerca a la ganadora hasta que mide `ALTO_FESTEJO` de la
 *   pantalla (300 px en 1080), en el tercio de abajo (el cartel va arriba), y después gira muy despacio.
 *
 * Los topes de movimiento (los verifica `carrera-camara.test.ts` cuadro a cuadro, salvo el corte declarado del celular y la foto):
 *
 * - **Giro**: el eje óptico gira `GIRO_MAX` (30 grados por segundo) como mucho. Los cambios de plano que no son cortes se hacen con una
 *   curva suave (cero en los extremos, pico de 1,5 veces el promedio) que dura lo que hace falta para que el pico quede en `GIRO_PICO`
 *   (24 grados por segundo): el resto del margen es para el giro de las órbitas que corren a la vez. El riel de la recta no gira.
 * - **Acercamiento**: la ampliación en el punto mirado (1 / (distancia por tangente de la mitad del campo)) cambia `ZOOM_MAX` (1,5 veces por
 *   segundo) como mucho, con el mismo reparto: pico de `ZOOM_PICO` (1,38 veces por segundo) en los cambios. La foto es la excepción
 *   declarada (`ZOOM_FOTO_MAX`): son 0,6 s y es el plano que la dirección pide que se acerque.
 * - **Sin sacudón, sin desenfoque**: la cámara 3D no recibe el sacudón del golpe del 2D.
 */

import { LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO } from "./carrera-forma";
import { TAM3D, ZC, escala3D, type Pose3D } from "./carrera-3d-mapa";
import { cabe, crecer, unir, type Caja, type Zona } from "../pixi/encuadre";
import { PASOS_POR_SEGUNDO, pasoDe } from "./carrera-fichas-mov";
import { PUESTOS_AL_90 } from "./carrera-marcha";

export type V3 = [number, number, number];

/* ------------------------------------------------------------------ los topes */
const RAD = Math.PI / 180;
/** Lo que más puede girar el eje óptico, en radianes por segundo (30 grados: la dirección). */
export const GIRO_MAX = 30 * RAD;
/** Lo más que cambia la ampliación, en logaritmo natural por segundo (1,5 veces por segundo: la dirección). */
export const ZOOM_MAX = Math.log(1.5);
/** El pico que se permite un cambio de plano: deja el 20 % para lo que gira o se acerca a la vez. */
export const GIRO_PICO = 24 * RAD;
export const ZOOM_PICO = 0.32;
/**
 * La foto es la excepción de la dirección ("salvo la foto"): un acercamiento de 1,2 a 1,7 veces en los 0,6 s entre T + 0,4 s y el golpe.
 * Su pico no pasa de 1,1 en logaritmo por segundo (3 veces por segundo); si el golpe cae antes de lo que pide la dirección (hoy el foco
 * más rápido llega a T + 0,5 s), el acercamiento se acorta para no pasar de ahí.
 */
export const ZOOM_FOTO_MAX = 1.1;
/** Lo más rápido que corre el punto mirado cuando va a buscar al grupo, en alturas de llama por segundo. */
export const VIAJE_MAX = 7;
/** El pico de la curva suave es 1,5 veces su velocidad media. */
const PICO_SUAVE = 1.5;
/** Lo menos que dura un cambio de plano que no es un corte, en segundos. */
export const GLIDE_MIN = 1.4;

/* --------------------------------------------------------------- las medidas */
/** Alto de las finalistas en la recta, como fracción del alto de la pantalla: 0,153 son 165 px en 1080 (la meta pide 150 de mediana). */
export const ALTO_RECTA = 0.155;
/** Lo mismo en el celular, parado: 90 px en 844 (la meta pide 70). */
export const ALTO_RECTA_CEL = 0.108;
/**
 * Cuánto se acerca la cámara en la llegada (de T − 3 s a T), en veces la ampliación de la recta: a T las finalistas miden hasta 1,6 veces lo de la
 * recta (unos 265 px en 1080; la meta pide de 200 a 450 de mediana en los últimos 3 s) y la foto sigue desde ahí hasta `FOTO_A`. Con 1,5 la mediana
 * quedaba en 198 px con 8 personas y en 195 con 18 (`medir-escala-carrera`, 8-nov-2026). En el celular parado entra poco a lo ancho (390 px): menos.
 */
export const ACERCA_LLEGADA = 1.6;
export const ACERCA_LLEGADA_CEL = 1.3;
/**
 * Lo que la llegada deja libre arriba (la cinta y el nombre sobre la cabeza) y abajo, como fracción del alto de la pantalla, para que a T las cuatro de
 * adelante entren enteras; en la foto el pie puede quedar un poco fuera (lo que importa son las narices).
 */
export const MARGEN_LLEGADA_ARRIBA = 0.17;
export const MARGEN_LLEGADA_ABAJO = 0.04;
export const MARGEN_FOTO_ABAJO = -0.12;
/**
 * A qué altura mira la vista de la línea, en altos de llama desde el suelo. A media altura (0,5) lo que limitaba el acercamiento era el borde de
 * abajo (la llama del carril más cercano, que se ve más grande y más abajo, sacaba los pies) y arriba sobraba lugar; además, las de punta que
 * venían por los carriles cercanos se salían por abajo en el último segundo. Mirando más abajo el cuadro se reparte parejo: entra más acercamiento
 * y se cortan menos.
 */
export const MIRA_LINEA_Y = 0.2;
/** Alto de la ganadora en el festejo, como fracción del alto de la pantalla: 0,31 son 335 px en 1080 (la meta pide 300). */
export const ALTO_FESTEJO = 0.31;
/** A qué altura de la pantalla va el centro de la ganadora en el festejo (el cartel queda arriba). */
export const Y_FESTEJO = 0.66;

/** Cuánto antes de T empieza la llegada (el viaje del riel a la vista de la foto), y cuánto después de T empieza el acercamiento de la foto, en segundos. */
export const LLEGADA_ANTES = 3;
export const FOTO_DESPUES = 0.4;
/** Hasta cuánto se acerca la foto (veces la ampliación de la recta): empieza en `ACERCA_LLEGADA`. */
export const FOTO_A = 1.7;
/**
 * Cuánto antes de abrirse la recta empieza a bajar la cámara. El viaje de la base al riel (más baja y más cerca) dura de 1,4 a 2,4 s por los
 * topes de giro y de acercamiento: si empezara recién al abrirse, durante el primer segundo y medio de la recta las finalistas se verían
 * a mitad de camino. Así llega cuando las llamas ya están en sus carriles.
 */
export const RECTA_ANTES = 1.6;
/**
 * Más tiempo que esto entre dos cuadros, o ir hacia atrás, es un corte del reloj (saltar el show, abrir la página en medio, armar la cámara de
 * nuevo): la cámara corta sin viaje. Un cuadro largo que no llega a esto no es un corte: el riel avanza todos los pasos que se perdió.
 */
export const SALTO_RELOJ = 1;
/** Cuántos segundos atrás se rehace el riel cuando no se lo venía siguiendo: el filtro de 0,7 s olvida todo lo anterior (queda menos de 0,2 px). */
const REHACE_RIEL = 6;
/** Cuánto después de su hora nominal puede caer el golpe (el cuadro que lo ve) para contar como el nominal. */
const TOLERA_GOLPE = 0.25;
/**
 * Cuánto antes de su hora nominal puede caer el golpe para contar como el nominal: un cuadro. El kit (`crear.ts`) suma a la espera del golpe el
 * cuadro entero que cruza T, así que el golpe cae hasta un cuadro antes; un cuadro no pasa de 0,05 s reales (`overlay.ts`), que con el ritmo más
 * corto (0,55) son 0,09 s de juego.
 */
const TOLERA_GOLPE_ANTES = 0.1;
/** Cuántas de adelante marcan el centro del riel de la recta. */
export const GRUPO_RIEL = 5;

/** Cómo mira cada plano: el costado desde donde se mira (`yaw`, adelante es positivo), qué tan baja (`pitch`) y el campo vertical. */
export const FOV_RECTA = 28 * RAD;
export const YAW_RECTA = 0.34;
export const PITCH_RECTA = 0.2;
/**
 * La foto mira desde más arriba que la recta: con la cámara casi a ras (0,1) la llama del carril de adelante quedaba gigante y cortada tapando la línea, y los
 * carriles no se escalonaban; con 0,3 se ven de arriba y se distingue quién cruza. El lente es más largo (`FOV_FOTO`) para lo mismo: la cámara queda más lejos
 * y ninguna llama está en primer plano; el acercamiento (alto de las llamas) es el mismo.
 */
export const PITCH_FOTO = 0.3;
export const FOV_FOTO = 20 * RAD;
export const YAW_FESTEJO = 0.5;
export const PITCH_FESTEJO = 0.15;
/**
 * En un celular parado la pantalla es alta y angosta: con la cámara baja, los ocho carriles quedaban en una franja de un cuarto del alto y abajo,
 * pista vacía (se vio en las tiras). Más alta, los carriles se abren hacia abajo y llenan la pantalla (el alto de las llamas no cambia: la
 * distancia se calcula con el ángulo).
 */
export const PITCH_RECTA_CEL = 0.45;
export const PITCH_FOTO_CEL = 0.35;
export const PITCH_FESTEJO_CEL = 0.28;
/**
 * Cuánto tarda en aplicarse el despeje del cartel desde el golpe: el cartel entra desde cero y la cámara no salta (cero velocidad en los extremos).
 * Con `cartelConGolpe` el cartel crece desde el golpe (`stage.ts`): su escala va de 0 a 1 en 0,9 s con `elastic.out(1, 0.55)`, que llega a 1 por
 * primera vez a un cuarto del período (0,55 / 4 de la curva), o sea a los 0,124 s. El despeje termina en ese momento, cuando el cartel ya está entero.
 */
export const RAMPA_CARTEL = (0.9 * 0.55) / 4;
/** El giro lento del festejo y hasta dónde llega, en radianes por segundo y en radianes. */
export const GIRO_FESTEJO = 0.035;
export const GIRO_FESTEJO_TOPE = 0.22;
/** La cámara de la recta lleva el grupo a este tanto del ancho de la pantalla desde la izquierda (0,5 es el centro): deja aire adelante. */
export const COLOCA_GRUPO = 0.44;

/* ------------------------------------------------------------------ proyección */
const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Dónde cae un punto del mundo 3D en una pantalla de `W` por `H`, con la pose de la cámara (la misma cuenta de `PerspectiveCamera` y
 * `lookAt` de three.js, con el vertical arriba). `prof` es la distancia a lo largo del eje óptico: negativa, el punto está detrás.
 */
export function proyectar(pose: Pose3D, W: number, H: number, p: V3): { x: number; y: number; prof: number } {
  const f: V3 = [pose.mira[0] - pose.pos[0], pose.mira[1] - pose.pos[1], pose.mira[2] - pose.pos[2]];
  const lf = Math.hypot(f[0], f[1], f[2]) || 1;
  f[0] /= lf; f[1] /= lf; f[2] /= lf;
  // derecha = f × arriba (arriba = (sin giro, cos giro, 0))
  const up: V3 = [Math.sin(pose.giro), Math.cos(pose.giro), 0];
  let r: V3 = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const lr = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / lr, r[1] / lr, r[2] / lr];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const d: V3 = [p[0] - pose.pos[0], p[1] - pose.pos[1], p[2] - pose.pos[2]];
  const cx = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const cy = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const prof = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const foco = H / 2 / Math.tan(pose.fov / 2);
  return { x: W / 2 + (cx / prof) * foco, y: H / 2 - (cy / prof) * foco, prof };
}

/** Una finalista tal como la deja la escena: dónde pisa en el mundo 2D (píxeles) y de qué tamaño. */
export interface Puesto {
  persona: number;
  x: number;
  y: number;
  esc: number;
  /**
   * Lo más alto que llega su salto en esta hora (el festejo de quien gana), en píxeles del mundo 2D, como el `salto` del 3D: la llama entera sube eso.
   * Sin él, pisa el suelo.
   */
  salto?: number;
}

/** Dónde caen en la pantalla la cabeza y los pies de una llama (en lo más alto de su salto, si salta): lo que mide `medir-escala-carrera` (el alto de su caja). */
export function cajaEnPantalla(pose: Pose3D, W: number, H: number, u: number, c: Puesto): { x: number; y: number; alto: number; prof: number } {
  const s = escala3D(u);
  const escala = c.esc * s * TAM3D;
  const x = c.x * s, z = c.y * s * ZC;
  const aire = Math.max(0, c.salto ?? 0) * s;
  const cab = proyectar(pose, W, H, [x + 6 * escala, LLAMA_ALTO * escala + aire, z]);
  const pie = proyectar(pose, W, H, [x, aire, z]);
  return { x: cab.x, y: cab.y, alto: Math.abs(pie.y - cab.y), prof: cab.prof };
}

/** ¿El centro de la caja de la llama (de la cabeza al pie) está adentro de la pantalla? Igual que `aLaVista` de `scripts/lib/escala-carrera.mjs`. */
export function aLaVistaPx(c: { x: number; y: number; alto: number; prof: number }, W: number, H: number): boolean {
  return c.prof > 0 && c.x >= 0 && c.x <= W && c.y + c.alto / 2 >= 0 && c.y + c.alto / 2 <= H;
}

/* ----------------------------------------------------------------- las órbitas */
/** Cómo mira la cámara a un punto: desde qué costado, qué tan alto, a qué distancia (logaritmo) y con qué campo (logaritmo de su tangente). */
interface Orbita {
  yaw: number;
  pitch: number;
  lDist: number;
  lTg: number;
}
interface Mira extends Orbita {
  m: V3;
}

const orbita = (yaw: number, pitch: number, dist: number, fov: number): Orbita => ({ yaw, pitch, lDist: Math.log(dist), lTg: Math.log(Math.tan(fov / 2)) });
const distDe = (o: Orbita): number => Math.exp(o.lDist);
const fovDe = (o: Orbita): number => 2 * Math.atan(Math.exp(o.lTg));
/** La ampliación en el punto mirado (en logaritmo): sube cuando la cámara se acerca o cierra el campo. */
const lMag = (o: Orbita): number => -(o.lDist + o.lTg);

/** La pose de three.js para una mira: la cámara a `dist` del punto mirado, del costado `yaw` (adelante es +x), a la altura `pitch`. */
export function poseDe(m: Mira): Pose3D {
  const d = distDe(m), ce = Math.cos(m.pitch);
  return { pos: [m.m[0] + d * Math.sin(m.yaw) * ce, m.m[1] + d * Math.sin(m.pitch), m.m[2] + d * Math.cos(m.yaw) * ce], mira: [m.m[0], m.m[1], m.m[2]], fov: fovDe(m), giro: 0 };
}

/** De una pose a su mira (la cámara que viene de la base, con el vertical arriba): para empezar un cambio de plano desde donde está. */
export function miraDe(p: Pose3D): Mira {
  const o: V3 = [p.pos[0] - p.mira[0], p.pos[1] - p.mira[1], p.pos[2] - p.mira[2]];
  const d = Math.hypot(o[0], o[1], o[2]) || 1;
  return { m: [p.mira[0], p.mira[1], p.mira[2]], yaw: Math.atan2(o[0], o[2]), pitch: Math.asin(Math.max(-1, Math.min(1, o[1] / d))), lDist: Math.log(d), lTg: Math.log(Math.tan(p.fov / 2)) };
}

/** Hacia dónde mira la cámara, normalizado. */
export function ejeDe(p: Pose3D): V3 {
  const f: V3 = [p.mira[0] - p.pos[0], p.mira[1] - p.pos[1], p.mira[2] - p.pos[2]];
  const l = Math.hypot(f[0], f[1], f[2]) || 1;
  return [f[0] / l, f[1] / l, f[2] / l];
}

/** El ángulo entre dos ejes, en radianes. */
export const anguloEntre = (a: V3, b: V3): number => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/** La ampliación de una pose en su punto mirado (en logaritmo): 1 / (distancia por tangente de la mitad del campo). */
export function ampliacionDe(p: Pose3D): number {
  const d = Math.hypot(p.pos[0] - p.mira[0], p.pos[1] - p.mira[1], p.pos[2] - p.mira[2]);
  return -Math.log(d * Math.tan(p.fov / 2));
}

/* --------------------------------------------------------------- el director */
export type Plano = "base" | "recta" | "llegada" | "foto" | "festejo";

export interface Marco {
  w: number;
  h: number;
  u: number;
}

export interface ConfigCamara {
  marco: Marco;
  /** Cuándo se abre la recta, cuándo cruza la ganadora (T) y cuándo cae el golpe si no se mueve (T + lo que tarda el foco dividido por el ritmo, como en `crear.ts`). */
  tAbre: number;
  tCrown: number;
  tGolpe: number;
  /** Dónde está la meta, en x del mundo 2D, y los carriles de la final (píxeles del mundo 2D). */
  metaX: number;
  carriles: { y0: number; y1: number; n: number; esc: number };
}

export interface EntradaCamara {
  t: number;
  /** Las finalistas en este cuadro, con la posición que les dio la escena. */
  puestos: readonly Puesto[];
  /**
   * Dónde pisa cada finalista en una hora cualquiera (la misma cuenta que `puestos`, que son las de `t`): la cámara la pide para las horas de
   * la grilla por las que pasa entre dos cuadros y para las de los hitos. Sin ella, todas las horas usan `puestos`.
   */
  puestosEn?: (t: number) => readonly Puesto[];
  /** La cámara del director del 2D traducida a perspectiva: manda hasta que se abre la recta. */
  base: Pose3D;
  /** Quién gana (se mira recién desde el golpe), y la hora de juego en que cayó el golpe (`null` si no cayó). */
  ganadora: number;
  golpeEn: number | null;
  /**
   * Dónde termina el cartel de quien gana, en píxeles desde arriba de la pantalla (con su margen). Desde el golpe la cabeza de la ganadora no queda
   * encima de ese borde: si el viaje al festejo la pasa por detrás del cartel, la cámara sube entera (sin girar ni cambiar el acercamiento) lo que haga
   * falta. Sin él no se despeja nada.
   */
  bajoCartel?: number;
}

export interface SalidaCamara {
  pose: Pose3D;
  plano: Plano;
  /** Este cuadro es un corte declarado (de un plano a otro sin viaje, o un salto del reloj): los auditores no lo cuentan como giro. */
  corte: boolean;
  /** Este cuadro es el acercamiento de la foto (el único con tope de acercamiento más alto). */
  foto: boolean;
}

export interface Camara3D {
  cuadro(e: EntradaCamara): SalidaCamara;
  /** La hora de juego en que empieza la llegada y en que empieza la foto, para los auditores: las nominales, las mismas en cualquier corrida. */
  hitos(): { llegada: number; foto: number };
}

/** Cuántos segundos hace falta para ir de `a` a `b` sin pasar el pico de giro ni de acercamiento. */
export function duracionDelCambio(a: Orbita, b: Orbita): number {
  // Lo que gira el eje: el costado (sobre el círculo a la altura de la cámara) y la altura.
  const giro = Math.hypot(Math.cos((a.pitch + b.pitch) / 2) * (b.yaw - a.yaw), b.pitch - a.pitch);
  const zoom = Math.abs(lMag(b) - lMag(a));
  return Math.max(GLIDE_MIN, (PICO_SUAVE * giro) / GIRO_PICO, (PICO_SUAVE * zoom) / ZOOM_PICO);
}

export function crearCamara3D(cfg: ConfigCamara): Camara3D {
  const { marco, tAbre, tCrown, metaX, carriles } = cfg;
  const { w: W, h: H, u } = marco;
  const retrato = H > W * 1.1;
  const s = escala3D(u);
  const metaX3 = metaX * s;
  // El alto de una llama de las finalistas en el mundo 3D, y el centro de los carriles a lo ancho de la pista.
  const hl = LLAMA_ALTO * carriles.esc * s * TAM3D;
  const zLanes = ((carriles.y0 + carriles.y1) / 2) * s * ZC;
  const x3 = (c: Puesto): number => (c.x + ((LLAMA_HOCICO + LLAMA_COLA) / 2) * c.esc) * s;
  const z3 = (c: Puesto): number => c.y * s * ZC;
  const nariz = (c: Puesto): number => (c.x + LLAMA_HOCICO * c.esc) * s;
  const altoRecta = retrato ? ALTO_RECTA_CEL : ALTO_RECTA;
  const acercaLlegada = retrato ? ACERCA_LLEGADA_CEL : ACERCA_LLEGADA;
  /** Las horas nominales de los hitos: no dependen de los cuadros que haya habido. */
  const tRecta = tAbre - RECTA_ANTES;
  const tLlegada = tCrown - LLEGADA_ANTES;
  // La foto dura desde T + 0,4 s hasta el golpe; si el golpe llega antes (el foco del arco más rápido), la foto empieza a la mitad.
  const tFoto = Math.min(tCrown + FOTO_DESPUES, tCrown + (cfg.tGolpe - tCrown) * 0.5);
  const tGolpeNominal = Math.max(tFoto + 0.05, cfg.tGolpe);

  /** La distancia a la que una llama de alto `hl` mide `frac` del alto de la pantalla, mirada desde la altura `pitch` con el campo `fov`. */
  const distPara = (frac: number, pitch: number, fov: number): number => (hl * Math.cos(pitch)) / (2 * frac * Math.tan(fov / 2));

  /* ------------------------------------------------------------ los planos */
  // La recta: la órbita fija. El punto mirado lo pone el riel.
  const pitchRecta = retrato ? PITCH_RECTA_CEL : PITCH_RECTA;
  const pitchFoto = retrato ? PITCH_FOTO_CEL : PITCH_FOTO;
  const fovFoto = retrato ? FOV_RECTA : FOV_FOTO;
  const pitchFestejo = retrato ? PITCH_FESTEJO_CEL : PITCH_FESTEJO;
  const ORB_RECTA = orbita(YAW_RECTA, pitchRecta, distPara(altoRecta, pitchRecta, FOV_RECTA), FOV_RECTA);
  /** Medio ancho de la pantalla a la distancia de la recta, en unidades 3D: para colocar el grupo. */
  const mediaAnchoRecta = (distDe(ORB_RECTA) * Math.tan(FOV_RECTA / 2) * W) / H;
  const MIRA_Y = 0.55 * hl;

  /** El centro del grupo de punta: el promedio de los cuerpos de las `k` de adelante (por la nariz). Nunca una sola. */
  const centroDelGrupo = (puestos: readonly Puesto[], k: number): { x: number; z: number } => {
    const todas = [...puestos].sort((a, b) => nariz(b) - nariz(a) || a.persona - b.persona);
    const orden = todas.slice(0, Math.max(1, Math.min(k, todas.length)));
    const n = orden.length || 1;
    let sx = 0, sz = 0;
    for (const c of orden) {
      sx += x3(c);
      sz += z3(c);
    }
    return { x: orden.length ? sx / n : metaX3, z: orden.length ? sz / n : zLanes };
  };

  /* --------------------------------------------------------------- el estado */
  let plano: Plano = "base";
  let tPrev = -Infinity;
  let ultimaBase: Pose3D | null = null;
  /** El cambio de plano en curso: desde dónde, desde cuándo y cuánto dura. */
  let cambio: { t0: number; dur: number; desde: Mira } | null = null;
  /** El festejo: desde cuándo corre (la hora nominal del golpe) y cómo termina el cambio. */
  let tFestejo = -1;
  let ultimoMira: Mira | null = null;

  function salida(m: Mira, p: Plano, corte: boolean, foto = false): SalidaCamara {
    ultimoMira = m;
    return { pose: poseDe(m), plano: p, corte, foto };
  }

  /* ------------------------------------------------------------ el riel */
  const H_PASO = 1 / PASOS_POR_SEGUNDO;
  /** Un pasa-bajos suave (0,7 s) y con tope de velocidad: el riel acompaña al grupo sin tirones. Los dos, por paso de la grilla. */
  const FILTRO_RIEL = 1 - Math.exp(-H_PASO / 0.7);
  const TOPE_RIEL = VIAJE_MAX * hl * H_PASO;
  /** El primer paso de la grilla en que existe el riel: el de la hora en que empieza la recta. */
  const kRecta = pasoDe(tRecta);
  const REHACE_PASOS = Math.round(REHACE_RIEL * PASOS_POR_SEGUNDO);
  /** El riel en el paso `rielK` (`rielA`) y en el siguiente (`rielB`, que se calcula adelantado para mostrar entre los dos pasos). */
  let rielK = 0;
  let rielA: V3 | null = null;
  let rielB: V3 | null = null;

  /** Dónde quiere estar el riel: el punto mirado va delante del centro del grupo lo justo para que el grupo quede a `COLOCA_GRUPO` del ancho (deja aire adelante). */
  const objetivoRiel = (puestos: readonly Puesto[]): V3 => {
    const g = centroDelGrupo(puestos, GRUPO_RIEL);
    return [g.x + (0.5 - COLOCA_GRUPO) * 2 * mediaAnchoRecta, MIRA_Y, zLanes];
  };
  /** El riel en el paso `k + 1` a partir del que tiene en el paso `k`, con el objetivo de la hora de ese paso. */
  const pasoRiel = (r: V3, k: number, en: (t: number) => readonly Puesto[]): V3 => {
    const objetivo = objetivoRiel(en((k + 1) * H_PASO));
    const sale: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const d = ((objetivo[i] as number) - (r[i] as number)) * FILTRO_RIEL;
      sale[i] = (r[i] as number) + Math.max(-TOPE_RIEL, Math.min(TOPE_RIEL, d));
    }
    return sale;
  };

  /**
   * Dónde está el riel en la hora `t`: función de la hora y nada más. Avanza los pasos enteros de la grilla (60 por segundo) que van desde el
   * último calculado hasta el de `t`, sin importar cuántos cuadros hubo ni cuándo cayeron, y entre dos pasos se muestra la mezcla de los dos
   * (así a 120 cuadros por segundo no se mueve de a escalones). Empieza en el objetivo del primer paso de la recta; si no se lo venía siguiendo
   * (la hora salta, o la cámara es nueva) se rehace desde seis segundos antes, de donde el filtro ya olvidó cómo era.
   */
  function rielEn(t: number, en: (t: number) => readonly Puesto[]): V3 {
    const k = pasoDe(t);
    let a = rielA, b = rielB;
    if (!a || k < rielK || k - rielK > REHACE_PASOS) {
      rielK = Math.max(kRecta, k - REHACE_PASOS);
      a = objetivoRiel(en(rielK * H_PASO));
      b = null;
    }
    while (rielK < k) {
      a = b ?? pasoRiel(a, rielK, en);
      b = null;
      rielK++;
    }
    b ??= pasoRiel(a, rielK, en);
    rielA = a;
    rielB = b;
    const f = Math.max(0, Math.min(1, t * PASOS_POR_SEGUNDO - k));
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  }

  /** La mira del riel de la recta: la órbita fija con el punto mirado en el riel. */
  const miraRecta = (t: number, en: (t: number) => readonly Puesto[]): Mira => ({ ...ORB_RECTA, m: rielEn(t, en) });

  /**
   * La vista de la foto, a `veces` la ampliación de la recta: de costado, perpendicular a la línea, mirando la línea misma a `MIRA_LINEA_Y` del alto
   * de una llama y a la profundidad `z` (entre los carriles de las que pelean). La cámara queda en el plano de la línea, así que la línea cae vertical en el
   * centro de la pantalla en todos los carriles: una nariz que la pasó se ve pasada esté en el carril que esté (mirando un punto antes de la línea,
   * la perspectiva la inclinaba y una nariz del carril de atrás parecía más atrás de lo que iba).
   */
  const miraSobreLaLinea = (veces: number, z: number): Mira => ({ ...orbita(0, pitchFoto, distPara(altoRecta, pitchFoto, fovFoto) / veces, fovFoto), m: [metaX3, MIRA_LINEA_Y * hl, z] });

  /**
   * Lo que fija la vista de la llegada y de la foto, con las finalistas tal como están en la hora nominal en que empieza la llegada (no en el cuadro
   * que cayó primero): las cuatro de adelante (`grupoFinal2D`, las mismas que encuadra el 2D; la ganadora es una de ellas en todas las rondas y
   * cae parejo entre las cuatro) marcan la profundidad que se mira, el medio entre sus carriles, y el acercamiento es el mayor que las deja a todas
   * enteras en la pantalla a T (de la cabeza al pie, debajo de la cinta de arriba) hasta `ACERCA_LLEGADA`; el de la foto, el mayor que deja sus
   * cabezas a la vista hasta `FOTO_A`. Con las cuatro en carriles vecinos se acerca todo; repartidas de punta a punta de la pista, menos. No mira
   * quién va adelante: solo en qué carriles corren.
   */
  function fijarLlegada(puestos: readonly Puesto[]): { z: number; veces: number; vecesFoto: number } {
    const grupo = new Set(grupoFinal2D(puestos.map((c) => ({ q: c.persona, nariz: nariz(c) }))));
    const zs = puestos.filter((c) => grupo.has(c.persona)).map(z3);
    const zMin = zs.length ? Math.min(...zs) : zLanes, zMax = zs.length ? Math.max(...zs) : zLanes;
    const z = (zMin + zMax) / 2;
    /** ¿A `veces` entran la cabeza (con su nombre arriba) y el pie de una llama parada en la línea en los dos carriles extremos del grupo? */
    const caben = (veces: number, arriba: number, abajo: number): boolean => {
      const pose = poseDe(miraSobreLaLinea(veces, z));
      for (const zz of [zMin, zMax]) {
        if (proyectar(pose, W, H, [metaX3, hl, zz]).y < arriba * H) return false;
        if (proyectar(pose, W, H, [metaX3, 0, zz]).y > (1 - abajo) * H) return false;
      }
      return true;
    };
    /** El mayor acercamiento, entre 1 y `tope`, con el que caben: acercarse las separa, así que se busca por bisección. */
    const mayor = (tope: number, arriba: number, abajo: number): number => {
      if (caben(tope, arriba, abajo)) return tope;
      let lo = 1, hi = tope;
      if (!caben(lo, arriba, abajo)) return lo;
      for (let i = 0; i < 16; i++) {
        const m = (lo + hi) / 2;
        if (caben(m, arriba, abajo)) lo = m;
        else hi = m;
      }
      return lo;
    };
    const veces = mayor(acercaLlegada, MARGEN_LLEGADA_ARRIBA, MARGEN_LLEGADA_ABAJO);
    return { z, veces, vecesFoto: Math.max(veces, mayor(FOTO_A, MARGEN_LLEGADA_ARRIBA, MARGEN_FOTO_ABAJO)) };
  }
  /** La vista de la llegada de esta ronda, fijada la primera vez que hace falta (siempre con las finalistas de la hora nominal). */
  let llegada: { z: number; veces: number; vecesFoto: number } | null = null;
  const llegadaDe = (en: (t: number) => readonly Puesto[]): { z: number; veces: number; vecesFoto: number } => (llegada ??= fijarLlegada(en(tLlegada)));

  /**
   * La llegada: del riel (tal como viene, con su órbita de la recta) a la vista de la foto, con la curva suave de los cambios de plano en los
   * `LLEGADA_ANTES` segundos antes de T. Todo a la vez y sin corte: el costado, la altura, el lente, la distancia y el punto mirado, que pasa del
   * riel (que sigue al grupo hasta la línea) a la línea. Desde T es la vista de la foto, quieta, hasta que empieza el acercamiento.
   */
  function miraLlegada(t: number, en: (t: number) => readonly Puesto[]): Mira {
    const r = mezclar(t, miraRecta(t, en));
    const ll = llegadaDe(en);
    const f = miraSobreLaLinea(ll.veces, ll.z);
    const k = suave((t - tLlegada) / LLEGADA_ANTES);
    // Desde T, la vista de la foto tal cual (sin la cuenta de la mezcla, que deja restos de redondeo): quieta hasta que empieza el acercamiento.
    if (k >= 1) return f;
    return {
      m: [lerp(r.m[0], f.m[0], k), lerp(r.m[1], f.m[1], k), lerp(r.m[2], f.m[2], k)],
      yaw: lerp(r.yaw, f.yaw, k), pitch: lerp(r.pitch, f.pitch, k), lDist: lerp(r.lDist, f.lDist, k), lTg: lerp(r.lTg, f.lTg, k),
    };
  }

  /** La foto: la misma vista de la llegada y un acercamiento sobre las narices (hasta `FOTO_A` veces la recta) que llega con el golpe. */
  function miraFoto(t: number, en: (t: number) => readonly Puesto[]): Mira {
    const ll = llegadaDe(en);
    const dur = Math.max(0.05, tGolpeNominal - tFoto);
    const u = suave((t - tFoto) / dur);
    // El pico de la curva suave es 1,5 veces la velocidad media: el acercamiento de la foto se acorta si la ventana es chica.
    const sube = Math.min(Math.log(ll.vecesFoto / ll.veces), (ZOOM_FOTO_MAX * dur) / PICO_SUAVE);
    return miraSobreLaLinea(Math.exp(Math.log(ll.veces) + sube * u), ll.z);
  }

  /** El festejo: la ganadora a `ALTO_FESTEJO` en el tercio de abajo, vista de tres cuartos, y un giro lento. */
  function miraFestejo(puestos: readonly Puesto[], ganadora: number, t: number): Mira {
    const c = puestos.find((p) => p.persona === ganadora) ?? puestos[0];
    const giro = Math.min(GIRO_FESTEJO_TOPE, Math.max(0, t - (tFestejo + cambioDur)) * GIRO_FESTEJO);
    const dist = distPara(ALTO_FESTEJO, pitchFestejo, FOV_RECTA);
    // Para que el cuerpo de la ganadora caiga en `Y_FESTEJO` de la pantalla, el punto mirado va por encima: el desplazamiento vertical
    // del encuadre a esa distancia es (Y_FESTEJO − 0,5) del alto visible.
    const sube = (Y_FESTEJO - 0.5) * 2 * dist * Math.tan(FOV_RECTA / 2);
    const cx = c ? x3(c) : metaX3;
    const cz = c ? z3(c) : zLanes;
    return { ...orbita(YAW_FESTEJO + giro, pitchFestejo, dist, FOV_RECTA), m: [cx, 0.5 * hl + sube, cz] };
  }
  let cambioDur = GLIDE_MIN;

  /**
   * Despeja el cartel: si la cabeza de la ganadora (en lo más alto de su salto del festejo, `Puesto.salto`) quedó más arriba que el borde de abajo del cartel
   * (`bajo`, en píxeles), sube la cámara entera lo que haga falta para que baje en la pantalla. Es un desplazamiento de toda la mira sin girar: el eje y el acercamiento no cambian. Entra de a poco desde el golpe
   * (`RAMPA_CARTEL`) porque el cartel entra desde cero. Función de la hora y de las posiciones, como todo lo demás.
   */
  function bajoElCartel(m: Mira, puestos: readonly Puesto[], ganadora: number, t: number, golpe: number | null, bajo: number | undefined): Mira {
    const c = puestos.find((p) => p.persona === ganadora);
    if (bajo === undefined || !c || golpe === null) return m;
    // Subir la mira `dy` en el mundo baja a todo lo que está a la profundidad de la ganadora `dy por foco / prof` píxeles; con la perspectiva (la cabeza no está
    // a la misma profundidad que el centro) no es exacto, así que se corrige con lo que sigue faltando.
    const sube = (dy: number): { falta: number; escala: number } => {
      const pose = poseDe({ ...m, m: [m.m[0], m.m[1] + dy, m.m[2]] });
      const cab = cajaEnPantalla(pose, W, H, u, c);
      return { falta: bajo - cab.y, escala: cab.prof > 0 ? (2 * cab.prof * Math.tan(pose.fov / 2)) / H : 0 };
    };
    let dy = 0;
    for (let i = 0; i < 4; i++) {
      const r = sube(dy);
      if (i === 0 && !(r.falta > 0)) return m;
      if (!(r.escala > 0) || Math.abs(r.falta) < 0.01) break;
      dy += r.falta * r.escala;
    }
    if (!(dy > 0)) return m;
    // Entra de a poco desde el golpe: el cartel entra desde cero y la cámara no salta.
    return { ...m, m: [m.m[0], m.m[1] + dy * suave((t - golpe) / RAMPA_CARTEL), m.m[2]] };
  }

  /** Empieza un cambio de plano suave desde donde está la cámara ahora hasta `hasta`. */
  function empezar(t: number, desde: Mira, hasta: Mira): void {
    cambioDur = duracionDelCambio(desde, hasta);
    cambio = { t0: t, dur: cambioDur, desde };
  }

  /** Mezcla la mira que viene (`cambio.desde`) con la del plano nuevo: punto mirado y órbita con la misma curva suave. */
  function mezclar(t: number, hasta: Mira): Mira {
    if (!cambio) return hasta;
    const k = suave((t - cambio.t0) / cambio.dur);
    if (k >= 1) {
      cambio = null;
      return hasta;
    }
    const d = cambio.desde;
    return {
      m: [lerp(d.m[0], hasta.m[0], k), lerp(d.m[1], hasta.m[1], k), lerp(d.m[2], hasta.m[2], k)],
      yaw: lerp(d.yaw, hasta.yaw, k), pitch: lerp(d.pitch, hasta.pitch, k), lDist: lerp(d.lDist, hasta.lDist, k), lTg: lerp(d.lTg, hasta.lTg, k),
    };
  }

  /**
   * La hora nominal del golpe: la del plan si el golpe cayó en el cuadro que le toca (desde un cuadro antes hasta un cuarto de segundo después), y si no la que cayó.
   * Así la hora no depende de la cadencia de la pantalla.
   */
  const horaGolpe = (golpeEn: number | null): number | null => (golpeEn === null ? null : golpeEn - tGolpeNominal >= -TOLERA_GOLPE_ANTES && golpeEn - tGolpeNominal <= TOLERA_GOLPE ? tGolpeNominal : golpeEn);

  /** El plano que toca a la hora `t`. */
  const planoEn = (t: number, golpe: number | null): Plano => {
    if (t < tRecta) return "base";
    if (t < tLlegada) return "recta";
    if (t < tFoto) return "llegada";
    if (golpe === null || t < golpe) return "foto";
    return "festejo";
  };

  return {
    hitos: () => ({ llegada: tLlegada, foto: tFoto }),
    cuadro(e) {
      const { t, puestos } = e;
      const en = e.puestosEn ?? (() => puestos);
      const dtBruto = t - tPrev;
      // Saltar el show (o abrir la página en medio) manda la hora de golpe: se corta sin viaje. Un cuadro largo no es un salto.
      const salto = !Number.isFinite(dtBruto) || dtBruto < 0 || dtBruto > SALTO_RELOJ;
      tPrev = t;
      const golpe = horaGolpe(e.golpeEn);
      const quiero = planoEn(t, golpe);
      if (quiero === "base") {
        ultimaBase = e.base;
        plano = "base";
        rielA = rielB = null;
        ultimoMira = null;
        return { pose: e.base, plano: "base", corte: salto, foto: false };
      }
      const antes = plano;

      /* ---- el cambio de plano (con corte o sin él): todo sale de la hora nominal del hito, no del cuadro que cayó ---- */
      let corte = false;
      if (quiero !== antes || salto) {
        plano = quiero;
        if (salto) cambio = null;
        if (quiero === "recta") {
          // De la cámara de base a la del riel: viaje suave desde donde estaba (si no hay base, corte).
          const desde = salto ? null : (ultimoMira ?? (ultimaBase ? miraDe(ultimaBase) : null));
          if (desde) empezar(tRecta, desde, miraRecta(tRecta, en));
          else {
            cambio = null;
            corte = true;
          }
        } else if (quiero === "llegada" || quiero === "foto") {
          // La llegada sigue del riel y la foto sigue de la llegada: función de la hora, sin corte (salvo que el reloj haya saltado).
          corte = salto;
        } else {
          // El festejo: viaje suave desde la foto (tal como termina) hasta la ganadora; si se saltó, directo. El giro lento empieza igual que si
          // el viaje se hubiera hecho (`cambioDur`): una cámara nueva, o la que salta, queda donde estaría la que siguió la ronda.
          // En el celular parado es un corte declarado, como los otros: el viaje dura hasta 2,5 s y en vertical el pelotón se tapa a sí mismo, así que la ganadora
          // quedaba escondida detrás de otra llama justo cuando sale el cartel. Con el corte llega al encuadre del festejo en el golpe, y el giro lento empieza ahí.
          tFestejo = golpe ?? t;
          if (retrato) {
            cambioDur = 0;
            cambio = null;
            corte = true;
          } else {
            empezar(tFestejo, miraFoto(tFestejo, en), miraFestejo(en(tFestejo), e.ganadora, tFestejo));
            if (salto) {
              cambio = null;
              corte = true;
            }
          }
        }
      }

      /* ---- la mira del plano ---- */
      if (plano === "recta") return salida(mezclar(t, miraRecta(t, en)), "recta", corte);
      if (plano === "llegada") return salida(miraLlegada(t, en), "llegada", corte);
      if (plano === "foto") return salida(miraFoto(t, en), "foto", corte, true);
      return salida(bajoElCartel(mezclar(t, miraFestejo(puestos, e.ganadora, t)), puestos, e.ganadora, t, golpe, e.bajoCartel), "festejo", corte);
    },
  };
}

/* ------------------------------------------------------------------- el 2D */
/**
 * El 2D no tiene plano de frente (la dirección, sección 4): en los últimos 3 s se acerca al grupo de punta a `ACERCA_FINAL_2D` veces el plano
 * general que traía, sin ficha ni nada que marque a una. La curva es la misma suave de los cambios de plano del 3D, y dura lo que hace falta
 * para que su pico (1,5 veces el promedio) no pase del tope de acercamiento: `DUR_ACERCA_2D`.
 */
export const ACERCA_FINAL_2D = 1.8;
export const DUR_ACERCA_2D = 2.4;

/** El acercamiento del 2D en `t`, si el plano general traía `z0` cuando empezó el cabeza a cabeza en `tF`. */
export const zoomFinal2D = (z0: number, t: number, tF: number): number => z0 * (1 + (ACERCA_FINAL_2D - 1) * suave((t - tF) / DUR_ACERCA_2D));

/**
 * La caja que le pide al director el 2D en los últimos 3 s: la zona de la pantalla achicada al acercamiento `z`, centrada en el promedio de
 * los cuerpos del grupo de punta (que se pasan con su nombre), y nunca más chica que ellos juntos: si el grupo no entra, el acercamiento baja.
 * `margen` es el que le suma después `planoSobre` a cada lado.
 */
export function cajaFinal2D(grupo: readonly Caja[], zona: Zona, z: number, margen: number): Caja {
  const todos = unir(grupo);
  const cx = grupo.length ? grupo.reduce((a, c) => a + c.x + c.w / 2, 0) / grupo.length : todos.x + todos.w / 2;
  const cy = grupo.length ? grupo.reduce((a, c) => a + c.y + c.h / 2, 0) / grupo.length : todos.y + todos.h / 2;
  const w = Math.max(0, (zona.x1 - zona.x0) / z - 2 * margen), h = Math.max(0, (zona.y1 - zona.y0) / z - 2 * margen);
  const centrada: Caja = { x: cx - w / 2, y: cy - h / 2, w, h };
  return unir([centrada, crecer(todos, 0)]);
}

/**
 * El grupo de punta que encuadra el 2D en los últimos 3 s: las de adelante a la hora del corte, por la nariz y, si empatan, por persona. Sale
 * solo del orden a esa hora, nunca de quién gana. Son tantas como los puestos en que el plan puede poner a la ganadora a esa hora
 * (`PUESTOS_AL_90`, cuatro): con tres, cuando la ganadora iba cuarta y en un carril lejos, cruzaba la meta fuera de cuadro o cortada.
 */
export function grupoFinal2D(narices: readonly { q: number; nariz: number }[]): number[] {
  return [...narices]
    .sort((a, b) => b.nariz - a.nariz || a.q - b.q)
    .slice(0, Math.min(PUESTOS_AL_90, narices.length))
    .map((o) => o.q);
}

/** El acercamiento que da una caja con un margen en una zona: lo que resuelve el director. */
export const zoomDeCaja = (caja: Caja, zona: Zona, margen: number): number => cabe(crecer(caja, margen), zona);
