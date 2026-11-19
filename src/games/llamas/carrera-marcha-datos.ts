import { CUERPO, FILA_CUERPOS, medirMarcha, type Causa, type MedidasMarcha, type Pase, type SerieLlama } from "./carrera-marcha";
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

/**
 * Las dos varas de los adelantamientos (regla M4 de la dirección). Sin un obstáculo encima, más de 0,88 de los cruces duran 1,2 s o más.
 * Con un obstáculo encima de la que pasa o de la pasada, nueve de cada diez duran 0,8 s o más: es la misma regla que la velocidad, que con
 * una causa a la vista permite ir una vez y media más rápido (1,2 dividido 1,5). Se miden con 64 semillas por cantidad de personas: con 16,
 * la misma carrera daba entre 0,79 y 0,92 según qué semillas tocaran. Las usan la prueba de la marcha y `scripts/audit-tacto.mjs`.
 */
export const VARAS_CRUCE = {
  sinObstaculo: { cruce: 1.2, parte: 0.88 },
  conObstaculo: { cruce: 0.8, parte: 0.9 },
} as const;

/**
 * Las causas del guion que vienen de un obstáculo de la recta: la piedra, la valla, el remolino y la escupida de los obstáculos. Las escupidas
 * de la historia (`carrera-marcha.ts`) llevan el mismo tipo pero no son obstáculos: se separan por su aviso, que en los obstáculos es 1,5 s
 * antes de que el obstáculo llegue.
 */
export function causasDeObstaculos(d: Datos): Causa[] {
  const escupidas = (d.final.obstaculos ?? []).filter((o) => o.tipo === "escupida").map((o) => d.tDeQ(o.q) - 1.5);
  return d.causas.filter((c) => c.tipo === "piedra" || c.tipo === "valla" || c.tipo === "viento" || (c.tipo === "escupida" && escupidas.some((a) => Math.abs(a - c.aviso) < 1e-6)));
}

/** Si el adelantamiento `p` pasa con un obstáculo encima de la que pasa o de la pasada: entre el aviso del obstáculo y el fin de su efecto. */
export function conObstaculoEncima(obstaculos: readonly Causa[], p: Pase): boolean {
  return obstaculos.some((c) => (c.quienes.includes(p.pasa) || c.quienes.includes(p.pasada)) && p.t >= c.aviso - 1e-9 && p.t <= c.hasta + 1e-9);
}
