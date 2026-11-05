import type { Container } from "pixi.js";
import { unir, type Caja, type Zona } from "../pixi/encuadre";
import type { PlanoToma } from "../pixi/kit/tipos";
import type { Camara2D } from "./carrera-3d-mapa";

/** The existing 520 px phone boundary, applied to the short side in landscape. */
export function primerPlanoHorizontal(p: { w: number; h: number; retrato: boolean }): boolean {
  return !p.retrato && p.w > p.h && p.h <= 520;
}

/** The final close-up gate, the same in 2D and 3D: a landscape phone, from the crown on. */
export function primerPlanoFinal(p: { w: number; h: number; retrato: boolean }, t: number, tCrown: number): boolean {
  return t >= tCrown && primerPlanoHorizontal(p);
}

/** Actual rendered runner/name bounds, expressed in the camera's world space. */
export function cajaVisual(elementos: readonly Container[], mundo: Container): Caja {
  const cajas = elementos.map((elemento): Caja => {
    const b = elemento.getBounds();
    const puntos = [
      mundo.toLocal({ x: b.x, y: b.y }),
      mundo.toLocal({ x: b.x + b.width, y: b.y }),
      mundo.toLocal({ x: b.x, y: b.y + b.height }),
      mundo.toLocal({ x: b.x + b.width, y: b.y + b.height }),
    ];
    const x = Math.min(...puntos.map((p) => p.x));
    const y = Math.min(...puntos.map((p) => p.y));
    return { x, y, w: Math.max(...puntos.map((p) => p.x)) - x, h: Math.max(...puntos.map((p) => p.y)) - y };
  });
  return unir(cajas);
}

/** Public audit callbacks use the same physical elements, after camera transforms. */
export function cajaVisible(elementos: readonly Container[]): Caja {
  return unir(elementos.map((elemento) => {
    const b = elemento.getBounds();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }));
}

/**
 * A screen box drawn by the 3D view, back in the director's world through the 2D camera that the 3D camera was posed
 * from (`camara3D` uses the base zoom, without the punch). The director frames it with its usual 2D maths; the 3D
 * perspective makes that approximate, and the next frame measures again what was drawn, so it settles where it is seen.
 */
export function alMundo(c: Caja, cam: Camara2D, w: number, h: number): Caja {
  const z = cam.zoom > 0 ? cam.zoom : 1;
  return { x: cam.x + (c.x - w / 2) / z, y: cam.y + (c.y - h / 2) / z, w: c.w / z, h: c.h / z };
}

/** The 3D close-up shot: the same zone and pace as the 2D one, on what the 3D drew, with the 3D zoom cap. */
export function tomaPrimerPlano3D(visto: Caja, cam: Camara2D, w: number, h: number, zona: Zona, tope: number): PlanoToma {
  return { caja: alMundo(visto, cam, w, h), zona, ritmo: 3, zoomMax: tope };
}

/** Max measure → clear → re-pose rounds per frame: the 3D perspective is not the 2D linear map the clearance assumes. */
export const PASOS_DESPEJE = 3;

/**
 * Clearance measured on what the 3D draws: measure the drawn box, let the stage move the director's camera
 * (`despejarGanador`), re-pose the 3D camera from it and measure again, until the camera stops moving. True when it
 * moved (the caller must draw the 3D again with the new camera).
 */
export function despejarVisto(o: {
  medir: () => Caja | null;
  despejar: (c: Caja) => void;
  pose: () => readonly number[];
  reencuadrar: () => void;
}, pasos = PASOS_DESPEJE): boolean {
  let movida = false;
  for (let i = 0; i < pasos; i++) {
    const caja = o.medir();
    if (!caja) break;
    const antes = o.pose();
    o.despejar(caja);
    const despues = o.pose();
    if (despues.length === antes.length && despues.every((v, j) => v === antes[j])) break;
    movida = true;
    o.reencuadrar();
  }
  return movida;
}

