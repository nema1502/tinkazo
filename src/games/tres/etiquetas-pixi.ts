import { Container } from "pixi.js";
import { repartirEtiquetas, type PedidoEtiqueta, type Zona } from "./etiquetas";
import type { Pantalla3D } from "./tipos";

/**
 * Las fichas de nombre de un juego en 3D, con PixiJS (`S.chip`: la letra y los colores de la casa, al tamaño legible de
 * siempre, y con la guardia de bordes del estadio). Cómo se reparten (que no se pisen ni tapen una cara) está en
 * `etiquetas.ts`; acá solo se crean, se llevan a su lugar y se esconden.
 */

/** Lo mínimo del estadio (`PixiStage`) que usan las fichas. */
export interface EstadioEtiquetas {
  hud: Container;
  app: { stage: Container };
  chip(name: string, scale?: number, faceOf?: string, textura?: null, conCara?: boolean): Container;
  sw(): number;
  sh(): number;
  u(): number;
  top(): number;
  bottom(): number;
}

export interface QuienEtiqueta {
  id: number;
  nombre: string;
  /** Más alto, más manda. `PRIORIDAD_SIEMPRE` o más: se ve siempre (quien nombra el relator, quien gana). */
  prioridad?: number;
}

/**
 * Se crea una vez al armar el juego y, en cada cuadro (después de `vista.frame`), se llama `poner` con quién se nombra
 * y la `pantallaDe` de la vista. `caras` son los `id` de las figuras que no llevan ficha en este cuadro pero cuya
 * cara tampoco hay que tapar.
 */
export class Etiquetas3D {
  private readonly fichas = new Map<number, Container>();
  private readonly capa = new Container();

  constructor(private readonly S: EstadioEtiquetas) {
    // Arriba de la escena y del hud, debajo del cartel del ganador.
    const i = S.app.stage.children.indexOf(S.hud);
    S.app.stage.addChildAt(this.capa, i >= 0 ? i + 1 : S.app.stage.children.length);
  }

  poner(quienes: readonly QuienEtiqueta[], pantallaDe: (id: number) => Pantalla3D | null, caras: readonly number[] = []): void {
    const S = this.S;
    const k = S.u();
    for (const f of this.fichas.values()) f.visible = false;
    const pedidos: PedidoEtiqueta[] = [];
    const W = S.sw(), H = S.sh();
    const con = new Set<number>();
    for (const q of quienes) {
      const p = pantallaDe(q.id);
      if (!p || p.x < -20 || p.x > W + 20 || p.y < S.top() - 20 || p.y > H) continue;
      let f = this.fichas.get(q.id);
      if (!f) {
        f = S.chip(q.nombre, 1);
        this.fichas.set(q.id, f);
        this.capa.addChild(f);
      }
      con.add(q.id);
      pedidos.push({ id: q.id, x: p.x, y: p.y, alto: p.alto, w: f.width, h: f.height, prioridad: q.prioridad ?? 0 });
    }
    const otras: { id: number; x: number; y: number; alto: number }[] = [];
    for (const id of caras) {
      if (con.has(id)) continue;
      const p = pantallaDe(id);
      if (p && p.x > 0 && p.x < W) otras.push({ id, x: p.x, y: p.y, alto: p.alto });
    }
    const zona: Zona = { x0: 8 * k, y0: S.top() + 2 * k, x1: W - 8 * k, y1: H - S.bottom() };
    const lugares = repartirEtiquetas(pedidos, zona, 2 * k, otras);
    pedidos.forEach((p, i) => {
      const f = this.fichas.get(p.id) as Container;
      const l = lugares[i];
      if (!l) return;
      f.visible = l.visible;
      // La ficha de PixiJS está anclada por la izquierda al medio.
      if (l.visible) f.position.set(l.x - p.w / 2, l.y);
    });
  }

  destruir(): void {
    if (!this.capa.destroyed) this.capa.destroy({ children: true });
    this.fichas.clear();
  }
}
