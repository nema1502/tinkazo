import type { Container } from "pixi.js";
import { cabe, centrar, unir, type Caja, type Vista, type Zona } from "./encuadre";

export interface WheelFrame {
  R: number;
  u: number;
  cx: number;
  sw: number;
  sh: number;
}

/** El encuadre original de la rueda entera, incluido su aro y sombra. */
export function wheelInBox(g: WheelFrame, yTop: number, yBot: number, zMax: number, conPoste: boolean): Vista {
  const { u, R, sw, sh } = g;
  const arriba = conPoste ? R + 54 * u : R;
  // El aro y su sombra, corrida 10 a la derecha y 12 hacia abajo.
  const abajo = R + 12 * u;
  const z = Math.max(0.3, Math.min(zMax, (yBot - yTop) / (arriba + abajo), (sw - 16 * u) / (2 * R + 10 * u)));
  const cy = yTop + (yBot - yTop - z * (arriba + abajo)) / 2 + z * arriba;
  // A lo ancho, donde la deja la disposición, acercada hacia el centro como
  // la acerca la cámara, y sin cortarse contra los bordes.
  const media = z * R;
  const cx = Math.min(Math.max(sw / 2 + (g.cx - sw / 2) * z, media + 8 * u), sw - media - 18 * u);
  return { x: (sw / 2 - cx) / z, y: (sh / 2 - cy) / z, z };
}

/** Bounds físicos del gajo elegido y la flecha; nunca de la rueda completa. */
export function wheelSelectedBody(sector: Container, pointer: Container, scene?: Container): Caja {
  return unir([sector, pointer].map((g) => {
    if (!scene) {
      const b = g.getBounds();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }
    // La caja local del dibujo, con su giro y desplazamiento reales. Pasarla
    // por la escena evita confundir píxeles de pantalla con mundo de cámara.
    const b = g.getLocalBounds();
    return unir([
      { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y },
      { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height },
    ].map((p) => {
      const q = scene.toLocal(p, g);
      return { x: q.x, y: q.y, w: 0, h: 0 };
    }));
  }));
}

/** La toma final; la variante apaisada recibe solo el gajo elegido y su flecha. */
export function wheelFinalView(g: WheelFrame, portrait: boolean, selected: Caja, safe: Zona): Vista {
  // La misma pantalla baja apaisada que usa zoomBajo en Teleférico. No cambia
  // el plano original de escritorio ni el del celular parado.
  if (!portrait && g.sh < 500 && selected.w > 0 && selected.h > 0 && safe.y1 > safe.y0) {
    return centrar(selected, safe, g.sw, g.sh, cabe(selected, safe));
  }
  return wheelInBox(g, safe.y0, safe.y1, portrait ? 0.96 : 0.84, false);
}
