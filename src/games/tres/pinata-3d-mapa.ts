import { escala3D, type Pose3D } from "./camara";
import type { Caja } from "./pinata-3d-tipos";
import type { Camara2D } from "./tipos";

/**
 * La cuenta del 2D al 3D de la piñata. Puro: sin three.js ni DOM, así se prueba en Node.
 *
 * La piñata es un escenario visto de frente (la y del 2D es la altura, no la fila del piso), así que no sirve el perfil
 * de piso del kit (`poseCamara` pone la mira a `y * zc` de profundidad). Acá la cámara mira de frente, apenas desde
 * arriba, al mismo punto que el director del 2D y a la distancia en que el plano de la piñata se ve del mismo alto.
 *
 * Y para que las caras de los caramelos, las fichas de nombre y la estrella del golpe, que siguen siendo de PixiJS y
 * caen en la pantalla donde el 2D puso cada cosa, coincidan con el 3D, cada cosa que se mueve se coloca llevando su
 * punto de la pantalla del 2D hasta el plano de su profundidad por el rayo de la cámara (`Proyector`). Así, sea cual sea
 * el ángulo de la cámara, el caramelo 3D se ve exactamente donde el 2D dice que está.
 */

/** Campo de visión vertical: lente larga, como pide el estilo (de 32 a 40 grados). */
export const FOV = (36 * Math.PI) / 180;
/** Cuánto mira desde arriba en los palos, en radianes (unos 9 grados): el piso se ve lo justo para el montón. */
export const ELEVACION = 0.16;
/** El giro de entrada: la cámara arranca un poco a la izquierda y vuelve a 0 en `ENTRADA_S` segundos. */
export const AZIMUT_ENTRADA = 0.05;
export const ENTRADA_S = 3;
/** El tilt del director se copia con este tope (2 grados). */
export const GIRO_TOPE = (2 * Math.PI) / 180;

export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
/** Sube de 0 a 1 entre `a` y `b`, suave en las puntas. */
export const suave = (x: number, a: number, b: number): number => {
  const f = clamp((x - a) / (b - a), 0, 1);
  return f * f * (3 - 2 * f);
};

/** Unidades 3D por píxel del 2D para una pantalla con unidad `u` (la del kit). */
export const escala = escala3D;

/** Dónde cae en la pantalla un punto del mundo 2D, con la cámara del director (incluidos el sacudón y la inclinación). */
export function aPantalla(cam: Camara2D, w: number, h: number, x: number, y: number): { x: number; y: number } {
  const dx = (x - cam.x) * cam.zoom, dy = (y - cam.y) * cam.zoom;
  const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  return { x: w / 2 + cam.sacudonX + dx * c - dy * s, y: h / 2 + cam.sacudonY + dx * s + dy * c };
}

/**
 * Cuánto mira desde arriba la cámara en este cuadro. Sale de lo que el director ya hizo (el acercamiento, la rotura, la
 * corona), nunca de quién gana: en los palos 9 grados; cuando el director se acerca a la rajadura, sube un poco para
 * verla de frente y de arriba; rota la piñata baja con el caramelo hasta el piso, y con el cartel queda apenas por
 * debajo (un contrapicado leve).
 */
export function elevacionDe(zoom: number, rotura: number, corona: number): number {
  const cerca = suave(zoom, 1.5, 1.8);
  const base = ELEVACION + 0.05 * cerca;
  const baja = suave(rotura, 0, 1.4);
  const alPiso = suave(corona, 0, 0.7);
  const e = base + (0.07 - base) * baja;
  return e + (-0.035 - e) * alPiso;
}

/** El giro de costado del arranque: de `AZIMUT_ENTRADA` a 0 en tres segundos, sin sacudidas. */
export const azimutDe = (t: number): number => AZIMUT_ENTRADA * (1 - suave(t, 0, ENTRADA_S));

/**
 * La cámara 3D del cuadro. El mundo 3D mide `escala(u)` unidades por píxel del 2D, con el piso del 2D (`piso`, su y) en
 * y = 0 y el centro de la escena en x = 0 del 2D.
 */
export function poseFrontal(cam: Camara2D, w: number, h: number, u: number, piso: number, elevacion: number, azimut: number): Pose3D {
  const s = escala(u);
  const zoom = Math.max(0.05, cam.zoom || 1);
  const cx = cam.x - (cam.sacudonX || 0) / zoom;
  const cy = cam.y - (cam.sacudonY || 0) / zoom;
  const mira: [number, number, number] = [cx * s, (piso - cy) * s, 0];
  const dist = ((h / zoom) * s) / (2 * Math.tan(FOV / 2));
  const ce = Math.cos(elevacion);
  return {
    pos: [mira[0] + dist * Math.sin(azimut) * ce, mira[1] + dist * Math.sin(elevacion), mira[2] + dist * Math.cos(azimut) * ce],
    mira,
    fov: FOV,
    // El `up` del kit es (sin giro, cos giro): para que gire como la escena de PixiJS, al revés.
    giro: -clamp(cam.rot || 0, -GIRO_TOPE, GIRO_TOPE),
  };
}

type V3 = [number, number, number];

/** Los ejes de la cámara de three.js (`lookAt` con `up = (sin giro, cos giro, 0)`): derecha, arriba y hacia adelante. */
export function ejes(pose: Pose3D): { der: V3; arriba: V3; adelante: V3 } {
  const f: V3 = [pose.mira[0] - pose.pos[0], pose.mira[1] - pose.pos[1], pose.mira[2] - pose.pos[2]];
  const lf = Math.hypot(f[0], f[1], f[2]) || 1;
  const adelante: V3 = [f[0] / lf, f[1] / lf, f[2] / lf];
  const up: V3 = [Math.sin(pose.giro), Math.cos(pose.giro), 0];
  const r: V3 = [adelante[1] * up[2] - adelante[2] * up[1], adelante[2] * up[0] - adelante[0] * up[2], adelante[0] * up[1] - adelante[1] * up[0]];
  const lr = Math.hypot(r[0], r[1], r[2]) || 1;
  const der: V3 = [r[0] / lr, r[1] / lr, r[2] / lr];
  const arriba: V3 = [der[1] * adelante[2] - der[2] * adelante[1], der[2] * adelante[0] - der[0] * adelante[2], der[0] * adelante[1] - der[1] * adelante[0]];
  return { der, arriba, adelante };
}

/** Dónde cae en la pantalla un punto del 3D con esta pose (la cuenta de `Vector3.project`). Null si queda detrás de la cámara. */
export function proyectar(pose: Pose3D, w: number, h: number, p: readonly [number, number, number]): { x: number; y: number } | null {
  const { der, arriba, adelante } = ejes(pose);
  const v: V3 = [p[0] - pose.pos[0], p[1] - pose.pos[1], p[2] - pose.pos[2]];
  const fz = v[0] * adelante[0] + v[1] * adelante[1] + v[2] * adelante[2];
  if (fz <= 0) return null;
  const th = Math.tan(pose.fov / 2);
  const nx = (v[0] * der[0] + v[1] * der[1] + v[2] * der[2]) / (fz * th * (w / Math.max(1, h)));
  const ny = (v[0] * arriba[0] + v[1] * arriba[1] + v[2] * arriba[2]) / (fz * th);
  return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h };
}

export type { Caja } from "./pinata-3d-tipos";

/**
 * Una pieza puesta en el escenario: dónde (en unidades del escenario), cómo gira (los ángulos de `rotation.set(0, giroY,
 * giroZ)` de three.js, en su orden XYZ) y de qué tamaño (`scale.setScalar(tam)`).
 */
export interface Pieza3D { x: number; y: number; z: number; giroY: number; giroZ: number; tam: number }

/**
 * El primer plano del final se mide en el 3D solo en el celular apaisado: la misma pantalla del acercamiento del 2D
 * (más ancha que alta y con el lado corto de 520 px o menos). En retrato y en la pantalla grande queda el de antes.
 */
export const primerPlano = (w: number, h: number): boolean => w > h && h <= 520;

/**
 * La caja en la pantalla de una pieza tal como la dibuja three.js con esta pose: cada punto de su silueta (`puntos`, de a
 * tres, en unidades de la pieza, agrandados `k` veces como su contorno), girado, escalado, llevado al escenario (que
 * está en `y = base.y` y mide `base.s` por unidad) y proyectado con `proyectar`. Null si algún punto queda detrás de la
 * cámara.
 */
export function cajaEnPantalla(
  pose: Pose3D, w: number, h: number, base: { y: number; s: number }, pieza: Pieza3D, puntos: ArrayLike<number>, k = 1,
): Caja | null {
  const cy = Math.cos(pieza.giroY), sy = Math.sin(pieza.giroY);
  const cz = Math.cos(pieza.giroZ), sz = Math.sin(pieza.giroZ);
  const t = pieza.tam * k;
  const p: V3 = [0, 0, 0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 2 < puntos.length; i += 3) {
    const ax = puntos[i]! * t, ay = puntos[i + 1]! * t, az = puntos[i + 2]! * t;
    // Primero el giro en el plano (z) y después el de su eje vertical (y), como la matriz de three.js con orden XYZ.
    const bx = ax * cz - ay * sz, by = ax * sz + ay * cz;
    const ox = bx * cy + az * sy, oz = -bx * sy + az * cy;
    p[0] = (pieza.x + ox) * base.s;
    p[1] = base.y + (pieza.y + by) * base.s;
    p[2] = (pieza.z + oz) * base.s;
    const q = proyectar(pose, w, h, p);
    if (!q) return null;
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  if (x0 > x1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Lleva puntos de la pantalla del 2D al 3D por el rayo de la cámara, sin crear objetos en cada llamada (se usa para cada
 * caramelo en cada cuadro). Se fija una vez por cuadro con `fijar` y después:
 *
 * - `plano(x, y, z)`: el punto del 3D en el plano vertical `z` que cae donde el 2D puso `(x, y)`.
 * - `suelo(x, y, yPlano)`: el punto del 3D sobre el piso (`y = yPlano`) que cae donde el 2D puso `(x, y)`.
 * - `compensa(z)`: cuánto hay que achicar o agrandar una figura puesta en el plano `z` para que en la pantalla mida lo
 *   mismo que en el 2D (la perspectiva la agranda si está más cerca).
 */
export class Proyector {
  private ox = 0; private oy = 0; private oz = 0;
  private fx = 0; private fy = 0; private fz = 0;
  private rx = 0; private ry = 0; private rz = 0;
  private ux = 0; private uy = 0; private uz = 0;
  private th = 1; private asp = 1;
  private w = 1; private h = 1;
  private cam: Camara2D = { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
  private dx = 0; private dy = 0; private dz = 0;

  fijar(pose: Pose3D, cam: Camara2D, w: number, h: number): void {
    const e = ejes(pose);
    this.ox = pose.pos[0]; this.oy = pose.pos[1]; this.oz = pose.pos[2];
    this.fx = e.adelante[0]; this.fy = e.adelante[1]; this.fz = e.adelante[2];
    this.rx = e.der[0]; this.ry = e.der[1]; this.rz = e.der[2];
    this.ux = e.arriba[0]; this.uy = e.arriba[1]; this.uz = e.arriba[2];
    this.th = Math.tan(pose.fov / 2);
    this.asp = w / Math.max(1, h);
    this.w = w;
    this.h = h;
    this.cam = cam;
  }

  /** La dirección del rayo por el punto del mundo 2D `(x, y)`: queda en `dx, dy, dz` (sin normalizar). */
  private rayo(x: number, y: number): void {
    const c = this.cam;
    const ddx = (x - c.x) * c.zoom, ddy = (y - c.y) * c.zoom;
    const co = Math.cos(c.rot), si = Math.sin(c.rot);
    const px = this.w / 2 + c.sacudonX + ddx * co - ddy * si;
    const py = this.h / 2 + c.sacudonY + ddx * si + ddy * co;
    const nx = ((px / this.w) * 2 - 1) * this.th * this.asp;
    const ny = (1 - (py / this.h) * 2) * this.th;
    this.dx = this.fx + this.rx * nx + this.ux * ny;
    this.dy = this.fy + this.ry * nx + this.uy * ny;
    this.dz = this.fz + this.rz * nx + this.uz * ny;
  }

  plano(x: number, y: number, z: number, fuera: V3): V3 {
    this.rayo(x, y);
    const k = Math.abs(this.dz) < 1e-9 ? 0 : (z - this.oz) / this.dz;
    fuera[0] = this.ox + this.dx * k;
    fuera[1] = this.oy + this.dy * k;
    fuera[2] = z;
    return fuera;
  }

  suelo(x: number, y: number, yPlano: number, fuera: V3): V3 {
    this.rayo(x, y);
    // Si el rayo no baja hasta el piso (la cámara mira desde abajo del todo), cae en el plano de la piñata.
    if (this.dy > -1e-6) return this.plano(x, y, 0, fuera);
    const k = (yPlano - this.oy) / this.dy;
    fuera[0] = this.ox + this.dx * k;
    fuera[1] = yPlano;
    fuera[2] = this.oz + this.dz * k;
    return fuera;
  }

  /**
   * Cuánto hay que estirar en vertical una figura plana (el chico) puesta en el plano de la piñata para que en la pantalla
   * conserve las proporciones del 2D: una tarjeta vertical vista desde arriba se acorta por el coseno del ángulo del rayo.
   */
  estiramiento(x: number, y: number): number {
    this.rayo(x, y);
    return Math.hypot(this.dy, this.dz) / Math.max(1e-6, Math.abs(this.dz));
  }

  /** Cuánto mide hacia adelante de la cámara un punto del 3D. */
  profundidad(p: readonly [number, number, number]): number {
    return (p[0] - this.ox) * this.fx + (p[1] - this.oy) * this.fy + (p[2] - this.oz) * this.fz;
  }
}
