import type { Arc, Beat, BeatKind, Story } from "../drama";
import type { Plan as PlanFinal } from "./plan";

/**
 * La recta intercambiable, pura (`?carrera=nueva`).
 *
 * Es la final de la carrera, medida en fracción de pista (0 la entrada, 1 la
 * meta), con la misma forma que `planRace` (`PlanFinal`) para que el show y la
 * escena no cambien. Lo que cambia es **cuándo se decide**. Tres fases:
 *
 * 1. **Hasta el 70 %**, todas las llamas salen del mismo generador: un camino
 *    sembrado y, para cualquiera, algunos sucesos (planta, tropiezo, pique,
 *    escupida) que el azar reparte sin mirar quién gana. La ganadora es una
 *    carril más. Lo que se ve en esta fase no dice nada del final.
 * 2. **Del 70 al 88 %, el acordeón**: la última subida las aprieta a menos de
 *    1,2 cuerpos, en un orden sorteado aparte (que tampoco mira a la ganadora).
 * 3. **Del 88 al 100 %** (1,8 s con la recta de 15 s) ataca la ganadora con dos
 *    señuelos sorteados, y gana por entre 0,1 y 1,5 cuerpos. Ahí se decide.
 *
 * Medido con el adivinador del auditor de delatores (`scripts/lib/delatores-bayes.mjs`):
 * mirando los puestos hasta el 88 %, acierta como el azar (1 / carriles). Se
 * paga una cosa: ya no hay remontadas con guion; quien viene de atrás al 88 %
 * pasa a ser una de las ocho, y el arco (`susto`, `tapada`, `duelo`, `remontada`)
 * se nombra por **cómo terminó**, nunca antes.
 *
 * Función pura de la ronda y de `q`: saltar o redibujar da lo mismo. Sin
 * `Math.random`.
 */

/** Un cuerpo de llama, en fracción de la recta (66 u de dibujo por 1,4 de escala sobre dos anchos de 1920). */
export const CUERPO = 0.0115;
/** Hasta dónde corre cada una libre (no se mira a la ganadora). */
export const LIBRE_HASTA = 0.7;
/** Dónde queda el acordeón (todas a menos de 1,2 cuerpos). */
export const ACORDEON = 0.88;
/** Cuánto mide el acordeón, en cuerpos, de la primera a la última. */
export const ACORDEON_CUERPOS = 1.2;
/** Entre cuántos cuerpos se separan las ocho al entrar a la recta (la de adelante a la de atrás, por puesto). */
export const ENTRADA_CUERPOS = 0.5;
/** La llegada más apretada que se llama foto, en cuerpos (una de cada cuatro llegadas). */
export const FOTO_CUERPOS = 0.35;

const GRID = [0, 0.12, 0.25, 0.38, 0.5, 0.62, LIBRE_HASTA, ACORDEON, 0.95, 1];
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const rampa = (q: number, a: number, dur: number): number => clamp((q - a) / dur, 0, 1);

/** Los carriles: la ganadora, las otras que premian (`co`) y las que completan hasta ocho; mezcladas con el azar de la ronda. */
export function carrilesDe(names: readonly string[], winnerIdx: number, rng: () => number, co: readonly number[] = []): number[] {
  const L = Math.min(8, names.length);
  const pool = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  const premios = co.filter((i, j, a) => i !== winnerIdx && i >= 0 && i < names.length && a.indexOf(i) === j).slice(0, L - 1);
  const resto = premios.length ? pool.filter((i) => !premios.includes(i)) : pool;
  const lanes = [winnerIdx, ...premios, ...resto.slice(0, L - 1 - premios.length)];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j] as number, lanes[i] as number];
  }
  return lanes;
}

export interface Suceso {
  kind: BeatKind;
  actor: number;
  target?: number;
  at: number;
}

/** Cuántos sucesos tiene una recta de `L` carriles: pocos con pocas, hasta tres con ocho. */
export const cuantosSucesos = (L: number): number => (L <= 2 ? 1 : L <= 5 ? 2 : 3);

/**
 * El plan de la recta. `lanes` son las ocho (o menos) de la final, `winnerLane`
 * el carril de la ganadora; `rng` es el azar de la recta, aparte del que elige
 * a la ganadora y del que ordena el grupo.
 */
export function planRecta(lanes: readonly number[], winnerLane: number, rng: () => number): PlanFinal {
  const L = lanes.length;
  const w = winnerLane;
  const barajar = (n: number): number[] => {
    const xs = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j] as number, xs[i] as number];
    }
    return xs;
  };

  /* ---------------------------------------------- el orden de entrada (sorteado) */
  const entrada = barajar(L); // entrada[r] = el carril que entra en el puesto r
  const puestoDeEntrada: number[] = new Array<number>(L).fill(0);
  entrada.forEach((k, r) => (puestoDeEntrada[k] = r));

  /* ---------------------------------------------------- el camino libre (fase 1) */
  // Cada una, un paseo sembrado entre -0,11 y 0,05 de la recta; la ganadora sale del mismo generador que las demás.
  const gaps: number[][] = Array.from({ length: L }, (_, k) => {
    const g = [-(puestoDeEntrada[k] as number) * ENTRADA_CUERPOS * CUERPO];
    let v = 0;
    for (let i = 1; i < GRID.length - 3; i++) {
      v = clamp(v + (rng() - 0.5) * 0.07, -0.11, 0.05);
      g.push(v);
    }
    return g;
  });

  /* ---------------------------------------------------------- los sucesos (fase 1) */
  // Le pasan a cualquiera, también a la ganadora, repartidos entre el 10 y el 56 % con al menos 0,1 entre uno y otro.
  const quienes = barajar(L);
  const nSuc = Math.min(L, cuantosSucesos(L));
  const libre = Math.max(0, 0.46 - 0.1 * (nSuc - 1));
  const cortes = Array.from({ length: nSuc }, () => rng() * libre).sort((a, b) => a - b);
  const kinds: BeatKind[] = ["plantada", "tropiezo", "pique", "escupida"];
  const beats: Beat[] = cortes.map((c, i) => {
    const actor = quienes[i] as number;
    const kind = kinds[Math.floor(rng() * kinds.length)] as BeatKind;
    const otros = Array.from({ length: L }, (_, k) => k).filter((k) => k !== actor);
    const target = kind === "escupida" ? (otros[Math.floor(rng() * otros.length)] as number) : undefined;
    return { kind: target === undefined && kind === "escupida" ? "plantada" : kind, actor, at: 0.1 + c + i * 0.1, ...(target !== undefined ? { target } : {}) };
  });

  /* ------------------------------------------------------- el acordeón (fase 2) */
  const orden = barajar(L); // orden[p] = quién va en el puesto p del acordeón
  const g88 = new Array<number>(L).fill(0);
  orden.forEach((k, p) => (g88[k] = L > 1 ? (-p * ACORDEON_CUERPOS * CUERPO) / (L - 1) : 0));
  for (let k = 0; k < L; k++) gaps[k]?.push(g88[k] as number);

  /* ----------------------------------------------------------- el ataque (fase 3) */
  const otras = orden.filter((k) => k !== w);
  const senuelos: number[] = [];
  const quedan = [...otras];
  while (senuelos.length < Math.min(2, otras.length)) senuelos.push(quedan.splice(Math.floor(rng() * quedan.length), 1)[0] as number);
  for (let k = 0; k < L; k++) {
    const ataca = k === w || senuelos.includes(k);
    gaps[k]?.push((g88[k] as number) + (ataca ? 0.7 + 0.5 * rng() : -0.2 * rng()) * CUERPO);
  }
  const m = 0.1 + 0.6 * rng();
  for (let k = 0; k < L; k++) gaps[k]?.push(k === w ? 0 : -(m + 0.8 * rng()) * CUERPO);

  const gapAt = (k: number, q: number): number => {
    const g = gaps[k] as number[];
    let i = 0;
    while (i < GRID.length - 2 && q > (GRID[i + 1] as number)) i++;
    const t0 = GRID[i] as number, t1 = GRID[i + 1] as number;
    const tan = (j: number): number => {
      const a = Math.max(0, j - 1), b = Math.min(GRID.length - 1, j + 1);
      return ((g[b] as number) - (g[a] as number)) / ((GRID[b] as number) - (GRID[a] as number));
    };
    const d = t1 - t0;
    const x = clamp((q - t0) / d, 0, 1);
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1, h10 = x ** 3 - 2 * x ** 2 + x;
    const h01 = -2 * x ** 3 + 3 * x ** 2, h11 = x ** 3 - x ** 2;
    return h00 * (g[i] as number) + h10 * d * tan(i) + h01 * (g[i + 1] as number) + h11 * d * tan(i + 1);
  };

  /** Lo que el suceso le saca (o le suma) a su camino: vuelve a cero a los 3 a 5 s. Igual para todas, sin saber quién gana. */
  const demora = (k: number, q: number): number => {
    let d = 0;
    for (const bt of beats) {
      const soyYo = bt.actor === k;
      const meTocan = bt.target === k;
      if (!soyYo && !meTocan) continue;
      const a = bt.at;
      if (bt.kind === "plantada" && soyYo) d += 0.05 * rampa(q, a, 0.05) - 0.05 * rampa(q, a + 0.05, 0.16);
      else if (bt.kind === "tropiezo" && soyYo) d += 0.025 * rampa(q, a, 0.025) - 0.025 * rampa(q, a + 0.025, 0.12);
      else if (bt.kind === "pique" && soyYo) d -= 0.05 * rampa(q, a, 0.08) - 0.05 * rampa(q, a + 0.08, 0.16);
      else if (bt.kind === "escupida") {
        if (soyYo) d += 0.015 * rampa(q, a, 0.015) - 0.015 * rampa(q, a + 0.015, 0.1);
        if (meTocan) d += 0.035 * rampa(q, a + 0.01, 0.035) - 0.035 * rampa(q, a + 0.045, 0.12);
      }
    }
    return d;
  };
  const pos = (k: number, q: number): number => q + gapAt(k, q) - demora(k, q) + k * 1e-9;

  /* ----------------------------------------------- el arco, nombrado por cómo terminó */
  const puestoEn = (k: number, q: number): number => {
    const x = pos(k, q);
    let p = 1;
    for (let j = 0; j < L; j++) if (j !== k && pos(j, q) > x) p++;
    return p;
  };
  const margen = Math.min(...Array.from({ length: L }, (_, k) => (k === w ? Infinity : pos(w, 1) - pos(k, 1))));
  const mas = (k: number): number => pos(k, 1);
  const segunda = Array.from({ length: L }, (_, k) => k).filter((k) => k !== w).sort((a, b) => mas(b) - mas(a))[0] ?? w;
  const delante = Array.from({ length: L }, (_, k) => k).filter((k) => k !== w && pos(k, ACORDEON) > pos(w, ACORDEON)).sort((a, b) => pos(b, ACORDEON) - pos(a, ACORDEON));
  // El arco, por cómo llegó la ganadora al acordeón (el 88 %) y cómo terminó: la llegada apretada es el duelo; quien ya iba adelante,
  // el susto; quien estaba a media tabla y se coló entre dos o tres, la tapada; quien venía de atrás, la remontada.
  let arc: Arc;
  let rival = segunda;
  let rival2 = segunda;
  const puesto88 = puestoEn(w, ACORDEON);
  const fraccion = L > 1 ? (puesto88 - 1) / (L - 1) : 0;
  if (L >= 2 && margen < FOTO_CUERPOS * CUERPO) arc = "duelo";
  else if (fraccion <= 0.2) arc = "susto";
  else if (fraccion <= 0.5 && delante.length >= 2) {
    arc = "tapada";
    rival = delante[0] as number;
    rival2 = delante[1] as number;
  } else {
    arc = "remontada";
    rival = delante[0] ?? segunda;
  }
  const story: Story = { arc, winner: w, rival, rival2, beats };

  function beatOf(k: number, q: number): { kind: string; p: number } | null {
    for (const bt of beats) {
      const lasts = bt.kind === "plantada" ? 0.075 : bt.kind === "pique" ? 0.09 : bt.kind === "escupida" ? 0.05 : 0.035;
      if ((bt.actor === k || bt.target === k) && q >= bt.at && q < bt.at + lasts) {
        return { kind: bt.target === k && bt.actor !== k ? "escupido" : bt.kind, p: (q - bt.at) / lasts };
      }
    }
    return null;
  }

  const hinchada = Math.floor(rng() * L);
  return { lanes: [...lanes], story, foto: arc === "duelo" ? 0.962 : 2, decoy: -1, hinchada, foco: w, puestos: [], pos, beatOf };
}
