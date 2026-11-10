import { CUERPO, FILA_CUERPOS, medirMarcha, type Causa, type MedidasMarcha, type SerieLlama } from "./carrera-marcha";
import type { Datos } from "./carrera-show";

/**
 * Las series de lugar de todas las que corren, tal como las dibujan el 2D y el 3D, en cuerpos y cuadro a cuadro (a 60 por segundo): del
 * grupo (`orden.puntaje`) a la recta (`final.pos`) en un solo número por llama. Las usan la prueba de la marcha y `scripts/audit-tacto.mjs`.
 * Puro: sin Pixi ni DOM.
 *
 * x es el lugar respecto del frente común (el camino que avanza igual para todas) y `y` el costado (la ráfaga), los dos en cuerpos.
 */
export interface SeriesDelShow {
  t0: number;
  dt: number;
  series: SerieLlama[];
  /** Las causas a la vista del guion (`Datos.causas`), por si la medida las necesita. */
  causas: readonly Causa[];
}

export function seriesDelShow(d: Datos, dt = 1 / 60): SeriesDelShow {
  const t0 = d.tSalida;
  const N = Math.floor((d.tCrown - t0) / dt) + 1;
  const carriles = new Map<number, number>();
  d.lanes.forEach((p, k) => carriles.set(p, k));
  const personas = new Set<number>([...d.gente, ...d.lanes]);
  const series: SerieLlama[] = [];
  for (const p of personas) {
    const cae = d.tiempos.cae.get(p) ?? Infinity;
    const k = carriles.get(p);
    const x = new Float64Array(N), y = new Float64Array(N), corre = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const t = t0 + i * dt;
      if (t < d.tAbre) {
        if (t >= cae) continue;
        x[i] = d.orden.puntaje(p, t);
        corre[i] = 1;
      } else if (k !== undefined) {
        const q = d.q(t);
        x[i] = (d.final.pos(k, q) - q) / CUERPO;
        y[i] = (d.final.lateral?.(k, q) ?? 0) * FILA_CUERPOS;
        corre[i] = 1;
      }
    }
    series.push({ id: p, x, y, corre });
  }
  return { t0, dt, series, causas: d.causas };
}

/** Las medidas de la marcha de todo el show (desde la salida hasta la meta), con las causas del guion. */
export function medirShow(d: Datos, dt = 1 / 60): MedidasMarcha {
  const s = seriesDelShow(d, dt);
  return medirMarcha(s.series, s.t0, s.dt, s.causas);
}
