import { cabe, centrar, unir, type Caja, type Vista, type Zona } from "./encuadre";

export interface SapoFinalFrame {
  table: Caja;
  zone: Zona;
  width: number;
  height: number;
  portrait: boolean;
  portraitLimit: number;
  chip?: { x: number; y: number; w: number; h: number; ax: number; ay: number };
  /** The selected target's painted outline, excluding effects and table. */
  target: Caja;
  closeUp: boolean;
}

/** Reuse the game's portrait flag and the existing 520px phone breakpoint on the short side. */
export function sapoFinalCloseUp(width: number, height: number, portrait: boolean, landed: boolean): boolean {
  return landed && !portrait && width > height && Math.min(width, height) <= 520;
}

/** Sapo's final composition; names in the HUD have screen-space dimensions. */
export function sapoFinalFrame(p: SapoFinalFrame): Vista {
  if (p.closeUp) return centrar(p.target, p.zone, p.width, p.height, cabe(p.target, p.zone));
  let box = p.table;
  let z = Math.min(p.portrait ? Math.min(1, p.portraitLimit) : 1.5, cabe(box, p.zone));
  if (!p.portrait && p.chip) {
    const c = p.chip;
    for (let turn = 0; turn < 2; turn++) {
      box = unir([p.table, { x: c.x - c.w * c.ax / z, y: c.y + c.h * (0.5 - c.ay) / z - c.h / 2 / z, w: c.w / z, h: c.h / z }]);
      z = Math.min(1.5, cabe(box, p.zone));
    }
  }
  return centrar(box, p.zone, p.width, p.height, z);
}

/** Para el auditor del cierre (`estadoGanador`): activo desde la corona, con el reloj del juego contado desde ahí, como la ruleta. */
export function sapoEstadoGanador(tAll: number, tCrown: number): { activa: boolean; tiempo: number; fase: string } {
  return { activa: tAll >= tCrown, tiempo: tAll - tCrown, fase: "sapo-final" };
}

/** Cuánto se suelta el tope del acercamiento 3D (0 a 1), desde que cae la última argolla, solo con el primer plano: en 0,6 s y sin saltos. */
export function sapoPrimerPlano3D(closeUp: boolean, desdeQueCae: number): number {
  if (!closeUp) return 0;
  const k = Math.min(1, Math.max(0, desdeQueCae / 0.6));
  return k * k * (3 - 2 * k);
}
