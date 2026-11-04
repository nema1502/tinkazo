import { crearMapa, perfil, type Mapa, type PerfilMapa } from "./camara";
import type { Camara2D, EntradaBase } from "./tipos";

/**
 * El Guajojó en 3D, la cuenta pura: del sendero del plan 2D (`x` de -1 a 1, `z` de 0 a 1) al mundo 3D, y la cámara que
 * mira lo mismo que el director del 2D. Sin three.js ni DOM: se prueba en Node.
 *
 * Por qué no sirve el `perfilFiel` de siempre. El 2D del Guajojó ya viene en perspectiva: `proyectar` (guajojo-plan.ts) es
 * un agujero de aguja con el horizonte en `yH`, la cámara a `D0` cuerpos de la largada y una escala `s = 1 / (1 + 1,8 z)`.
 * Eso es una cámara de verdad. Acá se la pone en el 3D con las mismas cuentas: la misma altura (`ALTO_CAMARA`), el mismo
 * horizonte, el mismo campo de visión; y lo que el director hace en el 2D (el recorte y el acercamiento) se hace con un
 * desplazamiento de lente (`setViewOffset`). Así cada cosa cae en la pantalla donde el 2D dice: el palo, quien llega a la
 * meta, el foco, la placa, las fichas y las reservas de nombres no se enteran de que hay un 3D debajo.
 *
 * Unidades. El 3D mide en cuerpos (una persona de pie mide 1) y los pasa al mundo con el mapa de la casa
 * (`crearMapa`): un cuerpo son `CUERPO_PX` píxeles del dibujo, y el mapa los lleva a unidades 3D. La profundidad de la
 * pantalla es `-y`: lo que está más lejos del que mira, más abajo en el eje z.
 */

/** Cuántos píxeles del dibujo mide un cuerpo (una persona). */
export const CUERPO_PX = 100;
/** La unidad de pantalla con que se arma el mundo del Guajojó: no cambia con la pantalla, la que cambia es la cámara. */
export const U_MUNDO = 1;
/** A cuántos cuerpos está la cámara de la largada (z = 0). */
export const D0 = 7;
/** Cuántos cuerpos de profundidad vale cada unidad de `z` del sendero (la escala del 2D es `1 / (1 + 1,8 z)`). */
export const PROF = 1.8 * D0;
/** Dónde esperan los últimos y dónde llega quien gana (guajojo-plan.ts: `Z_ULTIMOS`, `Z_META`, `Z_PALO`). */
export const Z_BLOQUEO = 1;

export const PERFIL: PerfilMapa = perfil({ zc: 1, elevacion: 0.4, azimut: 0, acerca: 1, tam: 1 });

/** El mapa de la casa para el mundo del Guajojó. */
export const mapaDelMundo = (): Mapa => crearMapa(PERFIL, U_MUNDO);

/** Cuántas unidades 3D mide un cuerpo. */
export const cuerpo3D = (mapa: Mapa = mapaDelMundo()): number => mapa.escalaFigura(CUERPO_PX);

/** Lo que el 2D sabe de cómo proyecta el sendero (`Geo` de guajojo-plan.ts). */
export interface GeoG {
  yH: number;
  yPie: number;
  mitad: number;
  cuerpo: number;
  cx: number;
  alto: number;
  retrato: boolean;
}

/** Cuánto mide el sendero de ancho (de mitad a mitad), en cuerpos. */
export const mitadEnCuerpos = (g: GeoG): number => g.mitad / g.cuerpo;
/** Con qué escala se ve a la altura de `z` (la de `proyectar`). */
export const escalaEn = (z: number): number => 1 / (1 + 1.8 * z);
/** A cuántos cuerpos de altura está la cámara (el piso de la largada cae a `yPie - yH` píxeles bajo el horizonte). */
export const altoCamara = (g: GeoG): number => (g.yPie - g.yH) / g.cuerpo;
/** La distancia focal del 2D, en píxeles. */
export const focal = (g: GeoG): number => D0 * g.cuerpo;
/** Cuánto mide el palo, en cuerpos (la caja del palo del 2D, medida a su distancia). */
export const altoDelPalo = (g: GeoG, zPalo: number): number => (0.34 * g.alto) / (g.cuerpo * escalaEn(zPalo));

/** Un lugar del sendero en píxeles del dibujo: `x` a lo ancho, `y` lo que se aleja (negativo: más lejos). */
export function aDibujo(g: GeoG, x: number, z: number): { x: number; y: number } {
  return { x: x * mitadEnCuerpos(g) * CUERPO_PX, y: -z * PROF * CUERPO_PX };
}

/** Un lugar del sendero (y una altura en cuerpos) en el 3D, por el mapa de la casa. */
export function colocar(mapa: Mapa, g: GeoG, x: number, z: number, alto = 0): [number, number, number] {
  const p = aDibujo(g, x, z);
  return mapa.a3D(p.x, p.y, alto * CUERPO_PX);
}

/* ----------------------------------------------------------------- la cámara */
const c01 = (v: number): number => Math.max(0, Math.min(1, v));
export const suave = (v: number): number => {
  const x = c01(v);
  return x * x * (3 - 2 * x);
};

/** Lo que el 2D dice de la fase del show y la cámara 3D usa para subir o bajar (nada de esto sabe quién gana). */
export interface FaseCamara {
  /** La hora del juego. */
  t: number;
  /** De 0 a 0,5: cuánto se oscureció el monte por el silencio (el 2D lo calcula para su tinte). */
  oscuro: number;
  /** El último silencio. */
  ultimo: boolean;
  /** Segundos desde el golpe, o negativo si todavía no cayó. */
  tau: number;
  /** Pantalla de celular (vertical): entra menos alta, para que la gente no quede cortada por el subtítulo. */
  retrato?: boolean;
}

/**
 * Cuánto se sube (positivo) o se baja (negativo) la cámara respecto de la del 2D, en cuerpos. Es una función de la hora
 * y de la fase: la misma ronda se ve igual y nada depende de quién gana.
 *
 * - Arranque: entra alta y baja en 2,6 s (se ve el lugar entero, con profundidad).
 * - Silencio: baja unos 3 grados, con los ojos encima del grupo; en el último, un poco más.
 * - Golpe: contrapicado leve, de héroe.
 */
export function alturaExtra(f: FaseCamara): number {
  const entra = (f.retrato ? 1.3 : 2.6) * (1 - suave(f.t / 2.6));
  const silencio = -0.5 * c01(f.oscuro / 0.36);
  const tension = f.ultimo ? -0.3 * c01(f.oscuro / 0.5) : 0;
  const golpe = f.tau >= 0 ? -1.25 * suave(f.tau / 0.6) : 0;
  return entra + silencio + tension + golpe;
}

/** El desplazamiento de lente que reproduce el recorte del director del 2D. */
export interface VistaLente {
  fullW: number;
  fullH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CamaraG {
  /** Posición y punto mirado en unidades 3D. */
  pos: [number, number, number];
  mira: [number, number, number];
  /** Campo de visión vertical del cuadro entero (de lo que ve el 2D sin recortar), en radianes. */
  fov: number;
  lente: VistaLente;
  giro: number;
  /** A cuántos píxeles del dibujo cae el horizonte con esta altura. */
  horizonte: number;
  /** Cuántos cuerpos de altura tiene la cámara. */
  altura: number;
}

/**
 * La cámara 3D del cuadro. `cam` es la del director del 2D (ya con el sacudón y todo lo que sumó), `g` lo que proyecta el
 * 2D, `dH` lo que se sube o baja (`alturaExtra`) y `zBloqueo` la profundidad que no se mueve en la pantalla al subir o
 * bajar: el palo y quien llega a la meta quedan donde los espera el foco del 2D.
 */
export function camaraDe(e: Pick<EntradaBase, "w" | "h">, cam: Camara2D, g: GeoG, mapa: Mapa, dH = 0, zBloqueo = Z_BLOQUEO): CamaraG {
  const K = cuerpo3D(mapa);
  const f = focal(g);
  const zoom = Math.max(0.05, cam.zoom || 1);
  // El cuadro entero que "imprime" la cámara, mucho más grande que la pantalla: el recorte del director cae adentro.
  const fullH = 4 * e.h;
  const fullW = (fullH * e.w) / Math.max(1, e.h);
  // El horizonte baja o sube lo que hace falta para que lo que está a `zBloqueo` no se corra al subir o bajar la cámara.
  const horizonte = g.yH - dH * g.cuerpo * escalaEn(zBloqueo);
  const izq = cam.x - (e.w / 2 + (cam.sacudonX || 0)) / zoom;
  const arriba = cam.y - (e.h / 2 + (cam.sacudonY || 0)) / zoom;
  const altura = altoCamara(g) + dH;
  const y = altura * K;
  const z = D0 * K;
  return {
    pos: [0, y, z],
    mira: [0, y, z - 10 * K],
    fov: 2 * Math.atan(fullH / 2 / f),
    lente: { fullW, fullH, x: izq - (g.cx - fullW / 2), y: arriba - (horizonte - fullH / 2), w: e.w / zoom, h: e.h / zoom },
    giro: Math.max(-0.035, Math.min(0.035, cam.rot || 0)),
    horizonte,
    altura,
  };
}

/**
 * Dónde cae en la pantalla un punto del 3D con esta cámara, por la cuenta de un agujero de aguja con desplazamiento de
 * lente. Sirve para probar que el 3D cae donde el 2D (sin three.js); en el show lo hace la propia cámara de three.js.
 */
export function pantallaDe(c: CamaraG, e: Pick<EntradaBase, "w" | "h">, g: GeoG, p: readonly [number, number, number]): { x: number; y: number } | null {
  const prof = c.pos[2] - p[2];
  if (prof <= 0) return null;
  const f = focal(g);
  const K = c.pos[2] / D0;
  const dx = (p[0] - c.pos[0]) / K;
  const dy = (p[1] - c.pos[1]) / K;
  const D = prof / K;
  // En píxeles del cuadro entero: el centro es (g.cx, horizonte).
  const ix = g.cx + (f * dx) / D;
  const iy = c.horizonte - (f * dy) / D;
  // Al recorte: el 2D pone el recorte de ancho `w / zoom` en la pantalla de ancho `w`.
  const escala = e.w / c.lente.w;
  const fx = ix - (g.cx - c.lente.fullW / 2);
  const fy = iy - (c.horizonte - c.lente.fullH / 2);
  return { x: (fx - c.lente.x) * escala, y: (fy - c.lente.y) * escala };
}

/* ------------------------------------------------------------ lo que pasa el 2D */

/** Cómo está una persona en este cuadro, con los mismos números que el 2D le puso a su figura plana. */
export interface PersonaG {
  /** Dónde está en el sendero (x de -1 a 1, z de 0 a 1). */
  x: number;
  z: number;
  /** Los ángulos de las piernas y los brazos, en radianes, como los pone el 2D. */
  piernaI: number;
  piernaD: number;
  /** Cuánto se acorta la pierna izquierda al tambalear. */
  escPiernaI: number;
  torsoRot: number;
  /** Cuánto baja el torso (sentada, positivo) o sube (salto, paso), en cuerpos. */
  torsoDy: number;
  brazoI: number;
  brazoD: number;
  /** De 0 de pie a 1 sentada. */
  sentado: number;
}

/** Todo lo que el 3D recibe del Guajojó en cada cuadro. Nada de esto dice quién gana antes del golpe. */
export interface EntradaGuajojo extends EntradaBase {
  geo: GeoG;
  gente: PersonaG[];
  /** El color de cada persona, el mismo del 2D (`S.color(i)`). */
  colores: readonly number[];
  /** Figura completa (hasta 60 personas) o simple. */
  completa: boolean;
  /** El alba, de 0 (noche) a 1 (día). */
  alba: number;
  /** Cuánto se oscureció el monte por el silencio, de 0 a 0,5. */
  oscuro: number;
  ultimo: boolean;
  /** Segundos desde el golpe, o -1 si todavía no cayó. */
  tau: number;
  /** Quién gana, o -1 hasta el golpe. */
  ganador: number;
  /** Cuánto abre los ojos el palo, de 0 a 1, y adónde mira la pupila (de -1 a 1). */
  ojos: number;
  pupila: number;
  /** Adónde barre la mirada (x y z del sendero), o null si no hay. */
  mira: { x: number; z: number } | null;
  /** Las ramitas que se están partiendo: dónde, hace cuánto y quién. */
  cracs: { x: number; z: number; dt: number; i: number }[];
}

/** La entrada que el 2D va llenando cuadro a cuadro, sin crear objetos nuevos en cada uno. */
export function entradaVacia(n: number, completa: boolean, colores: readonly number[]): EntradaGuajojo {
  return {
    t: 0, w: 0, h: 0, u: 1, cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
    geo: { yH: 0, yPie: 1, mitad: 1, cuerpo: 1, cx: 0, alto: 1, retrato: false },
    gente: Array.from({ length: n }, () => ({ x: 0, z: 0, piernaI: 0, piernaD: 0, escPiernaI: 1, torsoRot: 0, torsoDy: 0, brazoI: 0, brazoD: 0, sentado: 0 })),
    colores, completa, alba: 0, oscuro: 0, ultimo: false, tau: -1, ganador: -1, ojos: 0, pupila: 0, mira: null, cracs: [],
  };
}
