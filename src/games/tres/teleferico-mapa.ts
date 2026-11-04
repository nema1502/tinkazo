import { crearMapa, escala3D, perfil, type Mapa, type PerfilMapa } from "./camara";
import type { Camara2D } from "./tipos";

/**
 * La cuenta del teleférico entre el mundo 2D y el 3D. Puro, sin three.js ni DOM: se prueba en Node.
 *
 * El teleférico se mira de costado. En el 2D, `pt(pos, off)` pone todo sobre la recta del cable y la `y` de la pantalla
 * es la altura de verdad. En el 3D: `x` es `x`, la altura es `-y` y la profundidad es el fondo. Con el mapa de la casa
 * (`crearMapa`) eso es `a3D(x, 0, -y)`: el "alto" del mapa es la altura del dibujo, y la "y" del piso no se usa.
 *
 * Lo que se mira en el plano del cable (`z = 0`) cae donde el 2D lo puso, al píxel, porque la cámara mira de frente a
 * ese plano: las cabinas, las estaciones y los nombres que PixiJS pone encima coinciden. Lo que da profundidad es lo
 * que no está en ese plano: los cuerpos tienen volumen, la ladera, la ciudad y la cordillera están atrás, y la cámara
 * se "levanta" con un corrimiento de la lente (no con una inclinación), así el plano del cable no se deforma y
 * se ven los techos y la hoyada desde un poco más arriba.
 */

export const PERFIL_TELEFERICO: PerfilMapa = perfil({ zc: 1, elevacion: 0, azimut: 0, acerca: 1, tam: 1, altoMira: 0, pieMira: 0 });

export const mapaTeleferico = (u: number): Mapa => crearMapa(PERFIL_TELEFERICO, u);

/** Un punto del mundo 2D (`x`, `y` de la pantalla) en el 3D, sobre el plano del cable. */
export const alMundo = (m: Mapa, x: number, y: number): [number, number, number] => m.a3D(x, 0, -y);

/** De vuelta: un punto del 3D en el mundo 2D. */
export function deMundo(m: Mapa, x3: number, y3: number): { x: number; y: number } {
  const r = m.a2D(x3, y3, 0);
  return { x: r.x, y: -r.alto };
}

/** La pose de la cámara: de frente al plano del cable, levantada `alza` radianes y con la lente corrida para que el centro siga siendo el del 2D. */
export interface PoseLateral {
  pos: [number, number, number];
  /** A donde apunta la cámara (a su misma altura: mira horizontal). */
  mira: [number, number, number];
  /** El punto del plano del cable que queda en el centro de la pantalla. */
  centro: [number, number, number];
  fov: number;
  giro: number;
  /** Cuánto se corre la lente, en píxeles de la pantalla: `setViewOffset(w, h, x, y, w, h)`. */
  corrimiento: { x: number; y: number };
  /** Distancia de la cámara al plano del cable, en unidades 3D. */
  dist: number;
}

export function poseLateral(cam: Camara2D, h: number, u: number, alza: number, fov = (36 * Math.PI) / 180): PoseLateral {
  const s = escala3D(u);
  const zoom = Math.max(0.05, cam.zoom || 1);
  const cx = cam.x - (cam.sacudonX || 0) / zoom;
  const cy = cam.y - (cam.sacudonY || 0) / zoom;
  const dist = ((h / zoom) * s) / (2 * Math.tan(fov / 2));
  const centro: [number, number, number] = [cx * s, -cy * s, 0];
  const hh = dist * Math.tan(alza);
  // PixiJS gira la escena hacia la derecha de la pantalla con la `rot` positiva; la cámara del 3D gira al revés para que sea lo mismo.
  const giro = -(cam.rot || 0);
  // Cuántos píxeles de la pantalla vale un "tan" de ángulo, y dónde cae el centro en la imagen sin corrimiento.
  const f = h / (2 * Math.tan(fov / 2));
  return {
    pos: [centro[0], centro[1] + hh, dist],
    mira: [centro[0], centro[1] + hh, 0],
    centro,
    fov,
    giro,
    corrimiento: { x: ((hh * Math.sin(giro)) / dist) * f, y: ((hh * Math.cos(giro)) / dist) * f },
    dist,
  };
}

/** El ángulo con que se levanta la cámara en cada fase (radianes): 10 grados en el andén, 20 en el viaje, 5 en el final. */
export const ALZA = {
  arranque: (10 * Math.PI) / 180,
  viaje: (20 * Math.PI) / 180,
  estacion: (10 * Math.PI) / 180,
  tension: (5 * Math.PI) / 180,
  cumbre: (9 * Math.PI) / 180,
} as const;

export type FaseCamara = keyof typeof ALZA;
