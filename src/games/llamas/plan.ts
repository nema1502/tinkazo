import { writeStory, type Arc, type Story } from "../drama";

/**
 * El plan de la carrera, sin dibujo.
 *
 * Es la misma carrera de `race.ts` (quiénes corren, en qué carril, la historia
 * del director y dónde va cada una en cada instante), pero medida en fracción
 * de pista: 0 es la largada y 1 la meta. Así la puede dibujar cualquier motor.
 * El prototipo en PixiJS la usa entera; si el prototipo gana, `race.ts` también.
 *
 * Todo es función de la ronda y de `q`, la fracción de carrera: nada se
 * acumula cuadro a cuadro.
 */

export interface Plan {
  /** Índice en la lista de nombres, por carril. */
  lanes: number[];
  story: Story;
  /** En el duelo, la llegada en cámara lenta desde acá. */
  foto: number;
  /** Dónde va el actor `k` a la altura `q`, en fracción de pista. */
  pos(k: number, q: number): number;
  /** En qué momento de la historia está un actor, para la postura. */
  beatOf(k: number, q: number): { kind: string; p: number } | null;
}

/** La ventaja se mide en anchos de pantalla en `race.ts`; la pista mide 2,4. */
const GK = 1 / 2.4;

/**
 * Para comparar lado a lado con `race.ts` con la misma ronda, el azar se
 * consume en el mismo orden: `race.ts` siembra el paisaje (cerros, nubes,
 * estrellas) entre los carriles y la historia, y dice la primera línea (que
 * sortea su variante) antes de ubicar a la ganadora. `sceneryDraws` y
 * `beforePlace` reproducen esas dos cosas.
 */
export function planRace(
  names: string[],
  winnerIdx: number,
  rng: () => number,
  opts: { sceneryDraws?: number; beforePlace?: () => void; co?: readonly number[] } = {},
): Plan {
  // Ocho carriles como mucho; los acompañantes y el carril del ganador salen
  // del azar sembrado, así que la lista no delata a nadie.
  const LANES = Math.min(8, names.length);
  const pool = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  // Con varios premios, los otros premiados corren seguro: con sesenta
  // inscritos la sala los veía ganar sin haberlos visto nunca en la pista.
  // Se eligen después de barajar y antes de repartir carriles, así que el azar
  // se consume igual que con un premio y la historia es la misma.
  const co = (opts.co ?? []).filter((i, j, a) => i !== winnerIdx && i >= 0 && i < names.length && a.indexOf(i) === j).slice(0, LANES - 1);
  const resto = co.length ? pool.filter((i) => !co.includes(i)) : pool;
  const lanes = [winnerIdx, ...co, ...resto.slice(0, LANES - 1 - co.length)];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j] as number, lanes[i] as number];
  }

  for (let i = 0; i < (opts.sceneryDraws ?? 0); i++) rng();
  const story = writeStory(rng, lanes.length, Math.max(0, lanes.indexOf(winnerIdx)));

  function swapLanes(a: number, b: number): void {
    if (a === b) return;
    [lanes[a], lanes[b]] = [lanes[b] as number, lanes[a] as number];
    const sw = (x: number): number => (x === a ? b : x === b ? a : x);
    story.winner = sw(story.winner);
    story.rival = sw(story.rival);
    story.rival2 = sw(story.rival2);
    for (const bt of story.beats) {
      bt.actor = sw(bt.actor);
      if (bt.target !== undefined) bt.target = sw(bt.target);
    }
  }
  if (story.arc === "tapada" && Math.abs(story.rival - story.rival2) > 1) {
    swapLanes(story.rival + (story.rival + 1 < lanes.length ? 1 : -1), story.rival2);
  }
  if (story.arc === "duelo" && Math.abs(story.winner - story.rival) > 1) {
    swapLanes(story.winner + (story.winner + 1 < lanes.length ? 1 : -1), story.rival);
  }
  for (const bt of story.beats) {
    if (bt.kind !== "escupida" || bt.actor === story.rival) continue;
    const enArco = (k: number): boolean => k === story.winner || k === story.rival || k === story.rival2;
    const vecino = [bt.actor + 1, bt.actor - 1].find((k) => k >= 0 && k < lanes.length && !enArco(k));
    if (vecino === undefined) {
      bt.kind = "plantada";
      delete bt.target;
    } else bt.target = vecino;
  }

  const GRID = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.74, 0.86, 0.94, 1];
  const ARC_W: Record<Arc, number[]> = {
    remontada: [0, -0.04, -0.1, -0.15, -0.18, -0.17, -0.13, -0.05, -0.012, 0],
    susto: [0, 0.02, 0.045, 0.06, 0.065, 0.06, 0.05, 0.035, 0.015, 0],
    duelo: [0, 0, 0.02, 0.012, 0.03, 0.024, 0.03, 0.02, 0.012, 0],
    tapada: [0, -0.03, -0.06, -0.07, -0.08, -0.08, -0.075, -0.045, -0.005, 0],
  };
  const ARC_V: Record<Arc, number[]> = {
    remontada: [0, 0.03, 0.05, 0.06, 0.07, 0.07, 0.06, 0.045, 0.02, -0.02],
    susto: [0, 0, 0.02, 0.035, 0.05, 0.06, 0.06, 0.045, 0.02, -0.018],
    duelo: [0, 0.01, 0.01, 0.025, 0.024, 0.035, 0.02, 0.028, 0.012, -0.012],
    tapada: [0, 0.02, 0.04, 0.05, 0.06, 0.07, 0.07, 0.055, 0.02, -0.03],
  };
  const V2_TAPADA = [0, 0.01, 0.03, 0.06, 0.05, 0.068, 0.075, 0.05, 0.01, -0.045];
  const DUELO_TARDE = [0, -0.02, -0.04, -0.06, -0.05, 0.01, 0.03, 0.02, 0.012, 0];
  const dueloTarde = story.arc === "duelo" && rng() < 0.5;
  const intensidad = 0.45 + 0.75 * rng();
  const gaps: number[][] = lanes.map((_, k) => {
    if (k === story.winner) {
      const g = dueloTarde ? DUELO_TARDE : ARC_W[story.arc];
      return story.arc === "remontada" || story.arc === "tapada" ? g.map((v) => v * intensidad) : g;
    }
    if (k === story.rival) return ARC_V[story.arc];
    if (story.arc === "tapada" && k === story.rival2) return V2_TAPADA;
    const g = [0];
    let v = 0;
    for (let i = 1; i < GRID.length; i++) {
      v = Math.max(-0.24, Math.min(0.045, v + (rng() - 0.52) * 0.09));
      g.push((GRID[i] as number) >= 0.74 ? Math.min(v, -0.02 - rng() * 0.03) : v);
    }
    g[g.length - 1] = Math.min(g[g.length - 1] as number, -0.04 - rng() * 0.12);
    return g;
  });

  function gapAt(k: number, q: number): number {
    const g = gaps[k] as number[];
    let i = 0;
    while (i < GRID.length - 2 && q > (GRID[i + 1] as number)) i++;
    const t0 = GRID[i] as number, t1 = GRID[i + 1] as number;
    const tan = (j: number): number => {
      const a = Math.max(0, j - 1), b = Math.min(GRID.length - 1, j + 1);
      return ((g[b] as number) - (g[a] as number)) / ((GRID[b] as number) - (GRID[a] as number));
    };
    const d = t1 - t0;
    const x = Math.max(0, Math.min(1, (q - t0) / d));
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1, h10 = x ** 3 - 2 * x ** 2 + x;
    const h01 = -2 * x ** 3 + 3 * x ** 2, h11 = x ** 3 - x ** 2;
    return h00 * (g[i] as number) + h10 * d * tan(i) + h01 * (g[i + 1] as number) + h11 * d * tan(i + 1);
  }

  function delayAt(k: number, q: number): number {
    let d = 0;
    const ramp = (a: number, dur: number): number => Math.max(0, Math.min(1, (q - a) / dur));
    for (const bt of story.beats) {
      const soyYo = bt.actor === k;
      const meTocan = bt.target === k;
      if (!soyYo && !meTocan) continue;
      const a = bt.at;
      if (bt.kind === "plantada" && soyYo) d += 0.06 * ramp(a, 0.06) - 0.03 * ramp(a + 0.06, 0.16);
      else if (bt.kind === "tropiezo" && soyYo) {
        if (k === story.winner) d += 0.05 * ramp(a, 0.05) - 0.05 * ramp(a + 0.05, Math.max(0.05, 0.95 - a - 0.05));
        else d += 0.025 * ramp(a, 0.025) - 0.015 * ramp(a + 0.025, 0.12);
      } else if (bt.kind === "pique" && soyYo) d -= 0.05 * ramp(a, 0.08) - 0.05 * ramp(a + 0.08, 0.16);
      else if (bt.kind === "escupida") {
        if (soyYo) d += 0.015 * ramp(a, 0.015) - 0.005 * ramp(a + 0.015, 0.1);
        if (meTocan) d += 0.035 * ramp(a + 0.01, 0.035) - 0.015 * ramp(a + 0.045, 0.12);
      }
    }
    return d;
  }

  const pos = (k: number, q: number): number => {
    const tau = Math.max(0, Math.min(1, q - delayAt(k, q)));
    return tau + gapAt(k, tau) * GK;
  };

  opts.beforePlace?.();
  // El puesto de la ganadora a mitad de carrera, sorteado según el arco: el
  // mismo cálculo que en `race.ts`, para que la mitad no la delate.
  {
    const L_ = lanes.length;
    const entre = (a: number, b: number): number => {
      const lo = Math.max(1, Math.min(a, L_));
      const hi = Math.max(lo, Math.min(b, L_));
      return lo + Math.floor(rng() * (hi - lo + 1));
    };
    const tropiezo = story.beats.find((bt) => bt.actor === story.winner && bt.kind === "tropiezo");
    const objetivo =
      story.arc === "remontada" ? entre(L_ - 3, L_)
        : story.arc === "tapada" ? entre(3, L_ - 2)
          : story.arc === "susto" ? (tropiezo && tropiezo.at > 0.5 ? 1 : entre(3, L_ - 2))
            : dueloTarde ? entre(3, 5) : entre(1, 2);
    const taper = [0, 0, 0.5, 0.85, 1, 0.6, 0.3, 0, 0, 0];
    const base = (gaps[story.winner] as number[]).slice();
    const puestoCon = (d: number): number => {
      gaps[story.winner] = base.map((v, i) => v + (taper[i] as number) * d);
      const xs = lanes.map((_, k) => pos(k, 0.5));
      const wx = xs[story.winner] as number;
      return 1 + xs.filter((x, k) => k !== story.winner && x > wx).length;
    };
    const borde = (r: number): number => {
      let lo = -0.45, hi = 0.25;
      for (let it = 0; it < 28; it++) {
        const m = (lo + hi) / 2;
        if (puestoCon(m) <= r) hi = m;
        else lo = m;
      }
      return hi;
    };
    const d1 = borde(objetivo);
    const d2 = objetivo > 1 ? borde(objetivo - 1) : d1 + 0.06;
    puestoCon((d1 + d2) / 2);
  }

  function beatOf(k: number, q: number): { kind: string; p: number } | null {
    for (const bt of story.beats) {
      const lasts = bt.kind === "plantada" ? 0.075 : bt.kind === "pique" ? 0.09 : bt.kind === "escupida" ? 0.05 : 0.035;
      if ((bt.actor === k || bt.target === k) && q >= bt.at && q < bt.at + lasts) {
        return { kind: bt.target === k && bt.actor !== k ? "escupido" : bt.kind, p: (q - bt.at) / lasts };
      }
    }
    return null;
  }

  return { lanes, story, foto: story.arc === "duelo" ? 0.962 : 2, pos, beatOf };
}
