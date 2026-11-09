import type { PerspectiveCamera } from "three";
import type { Camara2D } from "./tipos";

/**
 * De la cámara del director del 2D a una cámara con perspectiva, y de los puntos del mundo 2D (píxeles) a los del 3D
 * (unidades). Puro, sin DOM y casi sin three.js (solo el tipo de la cámara): se prueba en Node.
 *
 * El 3D no calcula nada del juego. Todo lo que dibuja sale de una cuenta de unidades, y esa cuenta vive acá, una sola
 * vez, para que la prueba de igualdad (`prueba.ts`) y la vista usen la misma:
 *
 * - `x3 = x * s`: el avance en la pantalla es el mismo, uno a uno.
 * - `z3 = y * s * zc`: la profundidad es la fila o la y de la pantalla, estirada por `zc`. Con la cámara en altura las
 *   filas se comprimen (por `sin(elevación)`); `zc` lo compensa. `perfilFiel` lo calcula para que el piso se vea con las
 *   mismas proporciones que en el 2D.
 * - `y3 = alto * s`: la altura es la altura del dibujo, a la misma escala.
 *
 * `s` sale de la unidad `u` de la pantalla (`1 / (30 u)`): el mundo 3D mide lo mismo en un celular que en un proyector
 * y la que cambia es la cámara.
 */

/** Cómo mira la cámara y cómo se estira el mundo de un juego. */
export interface PerfilMapa {
  /** Cuánto se ensancha la profundidad respecto de la y del 2D. */
  zc: number;
  /** La altura de la cámara sobre el horizonte, en radianes. */
  elevacion: number;
  /** Desde qué costado mira, en radianes (positivo: un poco por delante, para ver las caras). */
  azimut: number;
  /** Campo de visión vertical, en radianes. */
  fov: number;
  /** Qué parte del alto que veía el 2D encuadra el 3D (con perspectiva, a pleno alto las figuras quedan chicas). */
  acerca: number;
  /** Cuánto se agranda cada figura respecto de su tamaño en el 2D (las filas del 2D dejan lugar para el nombre; en el 3D el nombre queda en la pantalla). */
  tam: number;
  /** A qué altura sobre el piso mira la cámara, en píxeles del dibujo (el centro del cuerpo de quien se mira). 0: al piso. */
  altoMira: number;
  /** Cuánto se suma a la y del centro de la cámara 2D para llegar al piso, en píxeles (en la carrera el centro de la pantalla es el cuerpo, y el piso está `altoMira` más abajo). */
  pieMira: number;
}

export const PERFIL_BASE: PerfilMapa = {
  zc: 1.2,
  elevacion: 0.62,
  azimut: 0.22,
  fov: (36 * Math.PI) / 180,
  acerca: 0.82,
  tam: 1,
  altoMira: 0,
  pieMira: 0,
};

/** Un perfil: lo que no se dice queda como en `PERFIL_BASE`. */
export const perfil = (p: Partial<PerfilMapa> = {}): PerfilMapa => ({ ...PERFIL_BASE, ...p });

/**
 * Un perfil que conserva las proporciones del piso del 2D: `zc = 1 / sin(elevación)` y sin giro de costado. Lo que en
 * el 2D está a la misma altura de la pantalla queda a la misma altura en el 3D (salvo la perspectiva), así las
 * etiquetas, la guardia del ganador y el foco del 2D siguen cayendo donde corresponde. Para los juegos vistos desde
 * arriba (el trompo, la piñata, el sapo): la elevación alta da los trompos de verdad, y los nombres no se mueven.
 */
export const perfilFiel = (elevacion: number, p: Partial<PerfilMapa> = {}): PerfilMapa =>
  perfil({ elevacion, azimut: 0, zc: 1 / Math.sin(elevacion), acerca: 1, ...p });

/** Unidades 3D por píxel del mundo 2D, para una pantalla con unidad `u`. */
export const escala3D = (u: number): number => 1 / (30 * Math.max(0.1, u));

/** La cuenta del mundo 2D al 3D y de vuelta, para un perfil y una pantalla. */
export interface Mapa {
  /** Unidades 3D por píxel del 2D. */
  s: number;
  perfil: PerfilMapa;
  /** Un punto del mundo 2D (`x`, `y` del piso, `alto` sobre el piso) en el 3D, `[x, y, z]`. */
  a3D(x: number, y: number, alto?: number): [number, number, number];
  /** De vuelta: un punto del 3D en el mundo 2D. */
  a2D(x3: number, y3: number, z3: number): { x: number; y: number; alto: number };
  /** El tamaño en el 3D de una figura dibujada en el 2D a escala `esc` (el modelo está en píxeles del dibujo). */
  escalaFigura(esc: number): number;
}

export function crearMapa(p: PerfilMapa, u: number): Mapa {
  const s = escala3D(u);
  return {
    s,
    perfil: p,
    a3D: (x, y, alto = 0) => [x * s, alto * s, y * s * p.zc],
    a2D: (x3, y3, z3) => ({ x: x3 / s, y: z3 / (s * p.zc), alto: y3 / s }),
    escalaFigura: (esc) => esc * s * p.tam,
  };
}

/** La pose de una cámara con perspectiva. */
export interface Pose3D {
  pos: [number, number, number];
  mira: [number, number, number];
  /** Campo de visión vertical, en radianes. */
  fov: number;
  /** Cuánto gira la cámara sobre su eje, en radianes (la inclinación del director). */
  giro: number;
}

/**
 * La cámara del 3D a partir de la del 2D.
 *
 * Mira al mismo punto: el centro de la pantalla del 2D, corrido el sacudón (que se copia como un corrimiento del punto
 * mirado, no como un temblor aparte). Y está a la distancia en que el alto que se ve a esa distancia es el mismo que
 * veía el 2D con ese acercamiento (`h / zoom`), por `acerca`: lo que el director encuadra, el 3D lo encuadra.
 */
export function poseCamara(cam: Camara2D, h: number, u: number, p: PerfilMapa): Pose3D {
  const s = escala3D(u);
  const zoom = Math.max(0.05, cam.zoom || 1);
  const cx = cam.x - (cam.sacudonX || 0) / zoom;
  const cy = cam.y - (cam.sacudonY || 0) / zoom;
  const mira: [number, number, number] = [cx * s, p.altoMira * s * p.tam, (cy + p.pieMira) * s * p.zc];
  const dist = ((h / zoom) * s * p.acerca) / (2 * Math.tan(p.fov / 2));
  const ce = Math.cos(p.elevacion);
  return {
    pos: [mira[0] + dist * Math.sin(p.azimut) * ce, mira[1] + dist * Math.sin(p.elevacion), mira[2] + dist * Math.cos(p.azimut) * ce],
    mira,
    fov: p.fov,
    giro: cam.rot || 0,
  };
}

/** Pone la pose en una `PerspectiveCamera` de three.js. */
export function aplicarPose(c: PerspectiveCamera, pose: Pose3D, aspecto: number): void {
  c.fov = (pose.fov * 180) / Math.PI;
  c.aspect = aspecto;
  c.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  c.up.set(Math.sin(pose.giro), Math.cos(pose.giro), 0);
  c.lookAt(pose.mira[0], pose.mira[1], pose.mira[2]);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
}

/**
 * La cámara del 2D tal como quedó aplicada en la escena de PixiJS: se llama en el cuadro, DESPUÉS de `cam.apply(...)`.
 * Lee de la escena y no de `cam.x`, `cam.zoom`, porque la escena ya trae el acercamiento de emoción, el golpe, el "pum"
 * del choque, el temblor y lo que corrigió la guardia del ganador (`cam.proteger`): el 3D ve lo mismo que el 2D vería.
 */
export function camaraDeEscena(
  scene: { pivot: { x: number; y: number }; position: { x: number; y: number }; scale: { x: number }; rotation: number },
  sw: number,
  sh: number,
): Camara2D {
  return {
    x: scene.pivot.x,
    y: scene.pivot.y,
    zoom: scene.scale.x,
    rot: scene.rotation,
    sacudonX: scene.position.x - sw / 2,
    sacudonY: scene.position.y - sh / 2,
  };
}
