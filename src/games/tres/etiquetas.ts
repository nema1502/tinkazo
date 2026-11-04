import type { Pantalla3D } from "./tipos";

/**
 * Los nombres sobre las figuras del 3D.
 *
 * En el 3D los nombres no son parte de la escena: son fichas de PixiJS (`S.chip`, con la letra y los colores de la
 * casa, del tamaño legible de siempre) que se apoyan sobre la cabeza de cada figura en la pantalla. Con perspectiva,
 * las filas de atrás se apilan sobre las de adelante y las fichas se pisan entre sí o tapan la cara de otra persona.
 * Acá se reparten:
 *
 * 1. Manda quien tiene más `prioridad` (quien va adelante, quien nombra el relator): se queda donde cae. Después van
 *    las demás, de la más cercana a la cámara a la más lejana (la de adelante se lee mejor).
 * 2. Cada ficha prueba su lugar (arriba de su cabeza) y, si ahí choca con otra ficha o con la cara de otra figura, un
 *    escalón más arriba, uno más abajo y corrida medio ancho a cada lado.
 * 3. Si ni así cabe, en ese cuadro no se muestra: un nombre se ve entero y sin tapar a nadie, o no se ve. Vuelve a
 *    salir cuando hay lugar. Las de prioridad máxima (`>= PRIORIDAD_SIEMPRE`) se muestran siempre, aunque tapen.
 *
 * `repartirEtiquetas` es puro (se prueba en Node). `Etiquetas3D` (`etiquetas-pixi.ts`) lo usa con fichas de PixiJS.
 */

export const PRIORIDAD_SIEMPRE = 1e6;

export interface PedidoEtiqueta {
  id: number;
  /** El punto de arriba de la cabeza en la pantalla (`Pantalla3D`) y el alto de la figura. */
  x: number;
  y: number;
  alto: number;
  /** El tamaño de la ficha, en píxeles de pantalla. */
  w: number;
  h: number;
  prioridad: number;
  /** Profundidad en la cámara (menor: más cerca); desempata a igual prioridad. Sin esto, se usa `y`. */
  z?: number;
}

export interface Zona {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LugarEtiqueta {
  id: number;
  visible: boolean;
  /** El centro de la ficha, en píxeles de pantalla. */
  x: number;
  y: number;
}

const choca = (a: Zona, b: Zona): boolean => a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.y0 < b.y1 - 1 && a.y1 > b.y0 + 1;

/** La cara de una figura: lo que ninguna ficha ajena debe tapar. */
export const cajaDeCabeza = (p: { x: number; y: number; alto: number }): Zona => ({
  x0: p.x - p.alto * 0.28,
  x1: p.x + p.alto * 0.28,
  y0: p.y - p.alto * 0.02,
  y1: p.y + p.alto * 0.3,
});

/**
 * Reparte las fichas. `gap` es el aire entre fichas (en píxeles). Devuelve un lugar por pedido, en el mismo orden.
 * Es determinista: la misma entrada da la misma salida.
 */
export function repartirEtiquetas(
  pedidos: readonly PedidoEtiqueta[],
  zona: Zona,
  gap = 2,
  /** Figuras sin ficha en este cuadro, cuya cara tampoco se tapa. */
  otrasCabezas: readonly { id: number; x: number; y: number; alto: number }[] = [],
): LugarEtiqueta[] {
  const lugares = new Map<number, LugarEtiqueta>();
  const cabezas = [...pedidos, ...otrasCabezas].map((p) => ({ id: p.id, caja: cajaDeCabeza(p) }));
  const puestas: Zona[] = [];
  const orden = [...pedidos].sort((a, b) => b.prioridad - a.prioridad || (a.z ?? -a.y) - (b.z ?? -b.y) || a.id - b.id);
  for (const p of orden) {
    const { w, h } = p;
    const x0 = p.x;
    const y0 = p.y - h / 2 - gap;
    const paso = h + gap;
    const siempre = p.prioridad >= PRIORIDAD_SIEMPRE;
    const caja = (dx: number, dy: number): Zona => ({ x0: x0 + dx - w / 2, x1: x0 + dx + w / 2, y0: y0 + dy - h / 2, y1: y0 + dy + h / 2 });
    const adentro = (c: Zona): boolean => c.x0 >= zona.x0 && c.x1 <= zona.x1 && c.y0 >= zona.y0 && c.y1 <= zona.y1;
    const libre = (c: Zona): boolean =>
      !puestas.some((q) => choca(c, q)) && (siempre || !cabezas.some((k) => k.id !== p.id && choca(c, k.caja)));
    let lugar: { dx: number; dy: number } | null = null;
    for (const dy of [0, -paso, paso, -2 * paso, 2 * paso]) {
      for (const dx of [0, -w * 0.5, w * 0.5]) {
        if (!lugar && adentro(caja(dx, dy)) && libre(caja(dx, dy))) lugar = { dx, dy };
      }
    }
    if (!lugar && siempre) {
      // Entera en la pantalla aunque tape: se corre lo justo.
      const c = caja(0, 0);
      const dx = c.x0 < zona.x0 ? zona.x0 - c.x0 : c.x1 > zona.x1 ? zona.x1 - c.x1 : 0;
      const dy = c.y0 < zona.y0 ? zona.y0 - c.y0 : c.y1 > zona.y1 ? zona.y1 - c.y1 : 0;
      lugar = { dx, dy };
    }
    if (!lugar) {
      lugares.set(p.id, { id: p.id, visible: false, x: x0, y: y0 });
      continue;
    }
    puestas.push(caja(lugar.dx, lugar.dy));
    lugares.set(p.id, { id: p.id, visible: true, x: x0 + lugar.dx, y: y0 + lugar.dy });
  }
  return pedidos.map((p) => lugares.get(p.id) as LugarEtiqueta);
}
