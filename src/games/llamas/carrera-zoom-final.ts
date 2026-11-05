import type { Container } from "pixi.js";
import { unir, type Caja } from "../pixi/encuadre";

/** The existing 520 px phone boundary, applied to the short side in landscape. */
export function primerPlanoHorizontal(p: { w: number; h: number; retrato: boolean }): boolean {
  return !p.retrato && p.w > p.h && p.h <= 520;
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
