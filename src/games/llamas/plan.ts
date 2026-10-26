import { writeStory, type Arc, type Story } from "../drama";

/**
 * El plan de la carrera, sin dibujo.
 *
 * Es la carrera de `race.ts` (quiénes corren, en qué carril, la historia del
 * director y dónde va cada una en cada instante), pero medida en fracción de
 * pista: 0 es la largada y 1 la meta. Así la puede dibujar cualquier motor.
 *
 * Todo es función de la ronda y de `q`, la fracción de carrera: nada se
 * acumula cuadro a cuadro.
 *
 * **Lo que se ve no delata a la ganadora** (auditor de delatores, 21 de
 * octubre de 2026). Hasta entonces la ganadora iba primera al 25% en casi
 * todos los sustos, en la recta final iba siempre segunda (la que iba primera
 * perdía 157 de 157 veces) y en el duelo corría en el carril de arriba de la
 * rival. Ahora:
 *
 * - **El puesto de la ganadora** apenas largan (cuando el relator anuncia a la
 *   primera), al 25%, al 50% y al 75% se sortea en una franja de cada arco, y
 *   las cuatro franjas se reparten los puestos: sumando los arcos, cada puesto
 *   sale exactamente una de cada ocho veces, en cada uno de esos cuatro
 *   momentos (el auditor de delatores lo mide con 1.500 rondas: chi cuadrado
 *   con siete grados de libertad). Al largar y al 25% va adelante en el susto y
 *   el duelo, y atrás en la remontada y la tapada; al 50%, en el duelo del 1.º
 *   al 4.º, en la tapada del 3.º al 6.º, en la remontada del 5.º al 8.º y en
 *   el susto 1.ª o 2.ª si todavía no tropezó y 7.ª u 8.ª si ya (el tropiezo
 *   cae antes o después de la mitad, mitad y mitad); al 75%, primera o
 *   segunda en el duelo, tercera o cuarta en el susto y en la mitad de atrás
 *   en la remontada y la tapada. Cada puesto sorteado se cumple en la
 *   pantalla: lo que se ve es lo que se sorteó (`puestos`).
 * - **En la recta final** (90%) va primera o segunda, mitad y mitad: unas
 *   veces aguanta adelante, otras pasa en los últimos metros.
 * - **En el duelo** la rival corre en el carril de arriba o en el de abajo,
 *   sorteado.
 * - **En la remontada** vienen de atrás dos: la ganadora y otra, que se
 *   desinfla en los últimos metros. El relator las nombra a las dos.
 *
 * El motor anterior (`race.ts`) no se cambió: la misma ronda ya no cuenta ahí
 * la misma historia, pero el ganador es el mismo, que es lo único que importa.
 */

export interface Plan {
  /** Índice en la lista de nombres, por carril. */
  lanes: number[];
  story: Story;
  /** En el duelo, la llegada en cámara lenta desde acá. */
  foto: number;
  /** En la remontada, la otra que viene de atrás (un carril), o -1. */
  decoy: number;
  /** Por quién grita la tribuna en la recta final: un carril sorteado entre todos. */
  hinchada: number;
  /** En la remontada, a cuál de las dos que vienen de atrás va la cámara: sorteada. */
  foco: number;
  /** Los puestos que se sortearon para la ganadora, a la altura `q` de la pista (y que `pos` cumple). */
  puestos: { q: number; r: number }[];
  /** Dónde va el actor `k` a la altura `q`, en fracción de pista. */
  pos(k: number, q: number): number;
  /** En qué momento de la historia está un actor, para la postura. */
  beatOf(k: number, q: number): { kind: string; p: number } | null;
}

/** La ventaja se mide en anchos de pantalla en `race.ts`; la pista mide 2,4. */
const GK = 1 / 2.4;

/**
 * `sceneryDraws` consume el azar que `race.ts` usa para el paisaje entre los
 * carriles y la historia, y `beforePlace` sortea la primera línea del relator
 * antes de ubicar a la ganadora, como siempre.
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
  // La rival del duelo, pegada a la ganadora: arriba o abajo, sorteado. Siempre
  // abajo, la de arriba ganaba 39 de 48 duelos.
  if (story.arc === "duelo") {
    const lado = rng() < 0.5 ? -1 : 1;
    const junto = story.winner + lado >= 0 && story.winner + lado < lanes.length ? story.winner + lado : story.winner - lado;
    if (story.rival !== junto) swapLanes(junto, story.rival);
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
      return story.arc === "remontada" || story.arc === "tapada" ? g.map((v) => v * intensidad) : g.slice();
    }
    if (k === story.rival) return ARC_V[story.arc].slice();
    if (story.arc === "tapada" && k === story.rival2) return V2_TAPADA.slice();
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

  // Varias corren pegadas al tope de ventaja (0,045) y quedan en el mismo punto: con un empate la ganadora
  // no puede ser 2.ª entre tres iguales. Un desempate de una cienmillonésima por carril (invisible) lo evita.
  const pos = (k: number, q: number): number => {
    const tau = Math.max(0, Math.min(1, q - delayAt(k, q)));
    return tau + gapAt(k, tau) * GK + k * 1e-8;
  };

  opts.beforePlace?.();

  // La otra que viene de atrás en la remontada: una de las que no están en el
  // arco y no tienen un momento que la retrase (una plantada o una escupida le
  // cuestan para siempre). Se queda atrás hasta el 62%, viene con todo, llega a
  // pelear adelante y se desinfla en los últimos metros.
  let decoy = -1;
  if (story.arc === "remontada") {
    const fuera = lanes.map((_, k) => k).filter((k) => k !== story.winner && k !== story.rival);
    const momentos = (k: number): typeof story.beats => story.beats.filter((bt) => bt.actor === k || bt.target === k);
    // Si todas tuvieron un momento, una que lo tuvo temprano: le cuesta poco.
    const sinNada = fuera.filter((k) => momentos(k).every((bt) => bt.kind === "pique" && bt.at <= 0.45));
    const libres = sinNada.length ? sinNada : fuera.filter((k) => momentos(k).every((bt) => bt.at <= 0.45));
    if (libres.length) {
      decoy = libres[Math.floor(rng() * libres.length)] as number;
      const g = gaps[decoy] as number[];
      g[4] = Math.min(g[4] as number, -0.11);
      g[5] = -0.13 - 0.03 * rng();
      g[6] = -0.08 - 0.03 * rng();
      g[7] = 0.01 + 0.03 * rng();
      g[8] = 0.015 + 0.025 * rng();
      g[9] = -0.03 - 0.04 * rng();
    }
  }

  /** En qué puesto va el actor `k` a la altura `q`. */
  const puestoEn = (k: number, q: number): number => {
    const xs = lanes.map((_, j) => pos(j, q));
    const x = xs[k] as number;
    return 1 + xs.filter((v, j) => j !== k && v > x).length;
  };
  /**
   * Lleva a la ganadora al puesto `r` en `q`: le suma a su ventaja una joroba
   * (`joroba`, por punto de control) hasta que entra en ese puesto, y se queda
   * en el medio del tramo que lo da, así un cuadro de más o de menos no la
   * cambia de puesto.
   */
  function llevar(q: number, r: number, joroba: number[]): void {
    const base = (gaps[story.winner] as number[]).slice();
    const con = (d: number): number => {
      gaps[story.winner] = base.map((v, i) => v + (joroba[i] ?? 0) * d);
      return puestoEn(story.winner, q);
    };
    const borde = (rr: number): number => {
      let lo = -0.45, hi = 0.25;
      for (let it = 0; it < 28; it++) {
        const m = (lo + hi) / 2;
        if (con(m) <= rr) hi = m;
        else lo = m;
      }
      return hi;
    };
    const d1 = borde(r);
    const d2 = r > 1 ? borde(r - 1) : d1 + 0.06;
    con((d1 + d2) / 2);
  }

  // Las franjas de puestos, como fracciones del pelotón: con ocho, la primera
  // cuarta parte son los puestos 1 y 2; la última, 7 y 8.
  const L_ = lanes.length;
  const franja = (a: number, b: number): number => {
    const lo = Math.min(L_, Math.floor(a * L_) + 1);
    const hi = Math.max(lo, Math.min(L_, Math.ceil(b * L_)));
    return lo + Math.floor(rng() * (hi - lo + 1));
  };
  const tropiezo = story.beats.find((bt) => bt.actor === story.winner && bt.kind === "tropiezo");
  const arc = story.arc;
  const adelante = arc === "duelo" || arc === "susto";
  // En el susto, la ganadora tropieza antes de la mitad o después, mitad y
  // mitad (el director la sortea entre el 38% y el 66%, y eso deja el 43% antes
  // de la mitad): así a la mitad va atrás o adelante la mitad de las veces.
  if (arc === "susto" && tropiezo) {
    tropiezo.at = rng() < 0.5 ? 0.38 + rng() * 0.12 : 0.5 + rng() * 0.16;
    story.beats.sort((a, b) => a.at - b.at);
  }
  const r25 = adelante ? franja(0, 0.5) : franja(0.5, 1);
  // A la mitad, cuatro franjas que juntas dan un octavo por puesto (con ocho):
  // el duelo del 1.º al 4.º, la tapada del 3.º al 6.º, la remontada del 5.º al
  // 8.º y el susto 1.ª o 2.ª (si todavía no tropezó) o 7.ª u 8.ª (si ya). Antes
  // era un poco más adelante que atrás (el 1.º salía 1,3 veces lo que toca) y
  // eso se veía: quien iba primera a la mitad ganaba más que una de cada ocho.
  const r50 = arc === "duelo" ? franja(0, 0.5)
    : arc === "tapada" ? franja(0.25, 0.75)
      : arc === "remontada" ? franja(0.5, 1)
        : tropiezo && tropiezo.at < 0.5 ? franja(0.75, 1) : franja(0, 0.25);
  const r75 = arc === "duelo" ? franja(0, 0.25) : arc === "susto" ? franja(0.25, 0.5) : franja(0.5, 1);
  // En la recta final, primera (aguanta adelante) o segunda (pasa en los
  // últimos metros), mitad y mitad en cada arco.
  const r90 = L_ >= 2 && rng() < 0.5 ? 2 : 1;
  // Apenas largan, el relator anuncia a la que va adelante: también ahí la
  // ganadora va adelante en el susto y el duelo y atrás en las otras.
  const r07 = adelante ? franja(0, 0.5) : franja(0.5, 1);
  const jorobas: { q: number; r: number; joroba: number[] }[] = [
    { q: 0.25, r: r25, joroba: [0, 0.5, 1, 0.5, 0, 0, 0, 0, 0, 0] },
    { q: 0.067, r: r07, joroba: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    { q: 0.5, r: r50, joroba: [0, 0, 0, 0.5, 1, 0.5, 0, 0, 0, 0] },
    { q: 0.75, r: r75, joroba: [0, 0, 0, 0, 0, 0.5, 1, 0.3, 0, 0] },
    { q: 0.9, r: r90, joroba: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0] },
  ];
  for (const j of jorobas) llevar(j.q, j.r, j.joroba);
  // Cada joroba mueve un poco lo que dejaron las anteriores (la del 90% corre el
  // puesto del 75%, y el susto caía en 3.º, 4.º y a veces 5.º): se repiten las
  // que quedaron flojas hasta que valen todas a la vez.
  for (let vuelta = 0; vuelta < 12; vuelta++) {
    const flojas = jorobas.filter((j) => puestoEn(story.winner, j.q) !== j.r);
    if (!flojas.length) break;
    for (const j of flojas) llevar(j.q, j.r, j.joroba);
  }
  const hinchada = Math.floor(rng() * L_);
  const foco = decoy >= 0 && rng() < 0.5 ? decoy : story.winner;

  function beatOf(k: number, q: number): { kind: string; p: number } | null {
    for (const bt of story.beats) {
      const lasts = bt.kind === "plantada" ? 0.075 : bt.kind === "pique" ? 0.09 : bt.kind === "escupida" ? 0.05 : 0.035;
      if ((bt.actor === k || bt.target === k) && q >= bt.at && q < bt.at + lasts) {
        return { kind: bt.target === k && bt.actor !== k ? "escupido" : bt.kind, p: (q - bt.at) / lasts };
      }
    }
    return null;
  }

  return { lanes, story, foto: story.arc === "duelo" ? 0.962 : 2, decoy, hinchada, foco, puestos: jorobas.map(({ q, r }) => ({ q, r })), pos, beatOf };
}
