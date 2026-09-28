import { clamp, ease } from "../overlay";
import { writeStory, type Story } from "../drama";

/**
 * El plan del teleférico, sin dibujo: el mismo de `cablecar.ts`, copiado tal
 * cual para que el motor nuevo cuente exactamente la misma historia con la
 * misma ronda (el orden de bajada, las cabinas, el horario y los cuatro
 * giros). Consume el azar en el mismo orden que el juego de siempre.
 *
 * Si el motor nuevo gana, `cablecar.ts` pasa a usar este módulo y la copia
 * desaparece. Hasta entonces el de siempre no se toca.
 */

export const LINES = ["#d7263d", "#e9b000", "#2f9e44", "#1c64c8", "#f2771a", "#ececec", "#5bc0eb", "#7d3c98", "#8b5a2b", "#aab2bd"];
export const MAXC = 5;
export const MIN_STATIONS = 4;
export const T_BOARD = 2.0;
export const T_RUN = 13.4;
export const T_DOCK = 15.8;
export const T_CROWN = 16.4;

interface Stall { a: number; b: number; dur: number; b2: number }
export type Leg =
  | { kind: "glide"; t0: number; t1: number; from: number; to: number; span: number; stall?: Stall }
  | { kind: "stop"; t0: number; t1: number; at: number; station: number; round: number; last: boolean };

function tauOf(L: Extract<Leg, { kind: "glide" }>, x: number): number {
  const s = L.stall;
  if (!s || x <= s.a) return x;
  const ts = s.a + s.b;
  if (x <= ts) {
    const u = x - s.a;
    return s.a + u - (u * u) / (2 * s.b);
  }
  if (x <= ts + s.dur) return s.a + s.b / 2;
  if (x <= ts + s.dur + s.b2) {
    const w = x - ts - s.dur;
    return s.a + s.b / 2 + (w * w) / (2 * s.b2);
  }
  return x - (s.dur + s.b / 2 + s.b2 / 2);
}

export type CableCarPlan = ReturnType<typeof planCableCar>;

export function planCableCar(names: string[], winners: readonly number[], rng: () => number) {
  const winnerIdx = winners[0] ?? 0;
  const n = names.length;

  /* ------------------------------------------------------ orden de bajada */
  // Los ganadores van primero y por lo tanto son los últimos en bajarse; el
  // resto, sembrado. `rank[0]` llega a la cumbre.
  const rest = names.map((_, i) => i).filter((i) => !winners.includes(i));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j] as number, rest[i] as number];
  }
  const rank = [...winners.filter((w) => w >= 0 && w < n), ...rest];

  /** Cuántos quedan después de cada parada: se parte a la mitad hasta uno. */
  const left: number[] = [n];
  while ((left[left.length - 1] as number) > 1) left.push(Math.ceil((left[left.length - 1] as number) / 2));
  const R = left.length - 1;

  /* ------------------------------------------------------------ cabinas */
  const C = Math.max(1, Math.min(MAXC, n));
  // Los últimos C en bajarse, uno por cabina, en un orden sorteado del convoy.
  const perm = Array.from({ length: C }, (_, i) => i);
  for (let i = C - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
  }
  const cabinOf = new Map<number, number>();
  rank.slice(0, C).forEach((idx, i) => cabinOf.set(idx, perm[i] as number));
  // El resto, repartido de a uno para que las cabinas vayan parejas.
  const start = Math.floor(rng() * C);
  rank.slice(C).forEach((idx, i) => cabinOf.set(idx, (start + i) % C));
  /** Cuándo se baja cada persona: el índice de la parada, o R si llega arriba. */
  const offAt = new Map<number, number>();
  for (let r = 0; r < R; r++) {
    for (let p = left[r + 1] as number; p < (left[r] as number); p++) offAt.set(rank[p] as number, r);
  }
  const pax: number[][] = Array.from({ length: C }, () => []);
  for (const idx of rank) pax[cabinOf.get(idx) as number]?.push(idx);
  /** La parada en la que se vacía cada cabina: la de su último pasajero. */
  const emptiesAt = pax.map((ps) => Math.max(...ps.map((p) => offAt.get(p) ?? R)));
  const winnerCab = cabinOf.get(winnerIdx) ?? 0;

  /* El director de emoción elige el arco, y en el teleférico cada arco tiene
     su giro. Siempre pasa algo, pero nunca lo mismo:

     - Susto, la puerta: en la última estación se abre la de la cabina
       ganadora, el pasajero se asoma como para bajarse, y la puerta se
       cierra. El que se baja es el de la otra.
     - Duelo, la mordaza: en la última estación la cabina de atrás se suelta
       y resbala cable abajo, hasta que la mordaza la agarra y la vuelve a
       subir. A veces es la del ganador y a veces la de la otra: la sala no
       puede aprender que "la del susto se salva".
     - Tapada, el apagón: justo antes de la última estación se corta la luz,
       el convoy frena en el aire y se hamaca a oscuras. Vuelve la luz,
       titilando, y sigue.
     - Remontada, la ráfaga: a mitad de viaje entra un viento que hamaca a
       todas las cabinas y hace flamear las banderas. */
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  const puerta = story.arc === "susto" && R >= 1 && C >= 2;
  const mordaza = story.arc === "duelo" && R >= 1 && C >= 2;
  const apagon = story.arc === "tapada" && R >= 1;
  const rafaga = story.arc === "remontada" || ((story.arc === "susto" || story.arc === "duelo") && !puerta && !mordaza);
  /** En la mordaza, la cabina que se suelta: la de más atrás de las dos que quedan. */
  const loserCab = cabinOf.get(rank[1] ?? -1) ?? winnerCab;
  const slipCab = Math.max(winnerCab, loserCab);

  /* ---------------------------------------------------------- estaciones */
  // Con menos paradas que estaciones, las que sobran son de largo. La última
  // parada es siempre la última estación: ahí se bajan de a uno.
  const S = Math.max(R, MIN_STATIONS);
  const stopOf = new Map<number, number>();
  if (R >= 1) stopOf.set(S, R - 1);
  const q = R - 1;
  for (let i = 0; i < q; i++) {
    const k = R >= S ? i + 1 : 1 + Math.floor(((i + 1) * (S - 1)) / (q + 1));
    stopOf.set(Math.min(S - 1, k), i);
  }
  // Si el reparto hizo chocar dos paradas en la misma estación, se corren.
  if (stopOf.size < R) {
    stopOf.clear();
    for (let i = 0; i < R; i++) stopOf.set(S - R + 1 + i, i);
  }

  /* --------------------------------------------------------- el horario */
  // Pesos: viajar a una estación vale 1, una parada 0,8, la última 1,7 porque
  // ahí está el amague. El total se reparte entre el fin del embarque y el
  // arranque del último tramo.
  const wTravel = 1;
  const wStop = 0.8;
  // Con la puerta o la mordaza, la última parada se toma más tiempo: primero
  // el amague. El apagón se lleva su propio pedazo del viaje.
  const wLast = mordaza ? 2.6 : puerta ? 2.4 : 1.7;
  const W_STALL = 1.3;
  let wSum = apagon ? W_STALL : 0;
  for (let k = 1; k <= S; k++) {
    wSum += wTravel;
    const r = stopOf.get(k);
    if (r !== undefined) wSum += r === R - 1 ? wLast : wStop;
  }
  const unit = (T_RUN - T_BOARD) / wSum;
  /** Distancia entre estaciones, en unidades de cable. */
  const D = 1;
  const legs: Leg[] = [];
  let tt = T_BOARD;
  let glideFrom = 0;
  let glideT0 = T_BOARD;
  for (let k = 1; k <= S; k++) {
    tt += wTravel * unit;
    const r = stopOf.get(k);
    if (r === undefined && k < S) continue;
    const span = tt - glideT0;
    if (apagon && k === S) {
      // El apagón, en el tramo que llega a la última estación: frena cuando
      // más rápido va, que es cuando más se nota.
      const lost = W_STALL * unit;
      const b = Math.min(0.3, lost * 0.2);
      const b2 = Math.min(0.5, lost * 0.3);
      const stall = { a: glideT0 + span * 0.42, b, b2, dur: lost - b / 2 - b2 / 2 };
      legs.push({ kind: "glide", t0: glideT0, t1: tt + lost, from: glideFrom, to: k * D, span, stall });
      tt += lost;
    } else {
      legs.push({ kind: "glide", t0: glideT0, t1: tt, from: glideFrom, to: k * D, span });
    }
    if (r !== undefined) {
      const dur = (r === R - 1 ? wLast : wStop) * unit;
      legs.push({ kind: "stop", t0: tt, t1: tt + dur, at: k * D, station: k, round: r, last: r === R - 1 });
      tt += dur;
    }
    glideFrom = k * D;
    glideT0 = tt;
  }
  const TOP = (S + 1) * D;

  const inOutQuad = (p: number): number => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));

  /** Dónde está la cabeza del convoy, en unidades de cable, a la hora `x`. */
  function headAt(x: number): number {
    if (x <= T_BOARD) return 0;
    for (const L of legs) {
      if (x > L.t1) continue;
      if (L.kind === "stop") return L.at;
      if (x < L.t0) return L.from;
      return L.from + (L.to - L.from) * inOutQuad(clamp((tauOf(L, x) - L.t0) / L.span, 0, 1));
    }
    if (x < T_RUN) return S * D;
    if (x < T_DOCK) return S * D + (TOP - S * D) * ease.inOutCubic((x - T_RUN) / (T_DOCK - T_RUN));
    return TOP;
  }

  /** Las paradas, en orden, con su hora de bajada y la de soltar cabinas. */
  const stops = legs.filter((L): L is Extract<Leg, { kind: "stop" }> => L.kind === "stop").map((L) => ({
    ...L,
    // La última se toma su tiempo: el latido arranca antes que la bajada.
    tOff: L.t0 + (L.t1 - L.t0) * (L.last ? (puerta || mordaza ? 0.64 : 0.55) : 0.28),
    tDetach: L.t0 + (L.t1 - L.t0) * (L.last ? (puerta || mordaza ? 0.84 : 0.78) : 0.62),
  }));

  /* ------------------------------------------------------------- los giros */
  /** El tramo del apagón y sus horas: se corta, frena, queda quieto, vuelve. */
  const stallLeg = legs.find((L): L is Extract<Leg, { kind: "glide" }> => L.kind === "glide" && !!L.stall);
  const corte = stallLeg?.stall ? stallLeg.stall.a : Infinity;
  const quieto = stallLeg?.stall ? corte + stallLeg.stall.b : Infinity;
  // Con muchísima gente el apagón es corto; aun así, entre "se cortó" y "volvió"
  // el relator se toma su respiro.
  const vuelve = stallLeg?.stall ? quieto + Math.max(0.3, stallLeg.stall.dur - 0.32) : Infinity;
  /**
   * Cuánta luz hay, de 0 a 1. Se corta de golpe y vuelve titilando, como
   * vuelve la luz de verdad: prende, se apaga, prende, se apaga, y queda.
   */
  function luzAt(x: number): number {
    if (x < corte) return 1;
    if (x < vuelve) return clamp(1 - (x - corte) / 0.08, 0, 1);
    const d = x - vuelve;
    if (d < 0.07) return 1;
    if (d < 0.16) return 0.1;
    if (d < 0.22) return 1;
    if (d < 0.3) return 0.2;
    return 1;
  }

  /** La ráfaga: a qué hora entra. Se siembra más abajo, cuando ya se sabe por dónde pasa. */
  let rafagaT = Infinity;
  /** El viento, de 0,2 (la brisa de siempre) a 1,2 (la ráfaga). */
  function windAt(x: number): number {
    const d = x - rafagaT;
    if (d < 0 || d > 3.2) return 0.2;
    const env = d < 0.3 ? d / 0.3 : d < 1.4 ? 1 : 1 - (d - 1.4) / 1.8;
    return 0.2 + env * (0.9 + 0.1 * Math.sin(d * 11));
  }

  /** La mordaza, en la última estación: resbala, la agarra, la vuelve a subir. */
  const ult = stops.find((s) => s.last);
  const md = ult ? ult.t1 - ult.t0 : 0;
  const mA = ult && mordaza ? ult.t0 + md * 0.18 : Infinity;
  const mB = ult && mordaza ? ult.t0 + md * 0.36 : Infinity;
  const mC = ult && mordaza ? ult.t0 + md * 0.42 : Infinity;
  const mD = ult && mordaza ? ult.t0 + md * 0.58 : Infinity;
  /** Cuánto resbaló la cabina, de 0 a 1 del tramo que resbala. */
  function slipAt(x: number): number {
    if (x < mA || x > mD) return 0;
    if (x < mB) {
      const q = (x - mA) / (mB - mA);
      return q * q;
    }
    if (x < mC) return 1 + Math.sin((x - mB) * 34) * Math.exp(-(x - mB) * 9) * 0.06;
    return 1 - ease.inOutCubic((x - mC) / (mD - mC));
  }
  /** A qué hora pasa la cabeza por cada estación de largo. */
  const passes: { station: number; t: number }[] = [];
  for (let k = 1; k <= S; k++) {
    if (stopOf.has(k)) continue;
    let a = T_BOARD, b = T_RUN;
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (headAt(m) >= k * D) b = m;
      else a = m;
    }
    passes.push({ station: k, t: b });
  }
  // La ráfaga entra en la mitad del viaje, sembrada, pero no encima de lo que
  // el relator ya tiene que decir: una estación, una pasada de largo.
  if (rafaga) {
    const agenda = [T_BOARD, ...passes.map((p) => p.t), ...stops.flatMap((s) => [s.t0, s.tOff])];
    rafagaT = T_BOARD + (T_RUN - T_BOARD) * (0.36 + rng() * 0.24);
    for (let i = 0; i < 24 && agenda.some((a) => Math.abs(a - rafagaT) < 0.7); i++) rafagaT += 0.2;
  }

  /** Cuándo se suelta cada cabina que se vacía. Infinity si llega arriba. */
  const detachT = pax.map((_, cab) => {
    const r = emptiesAt[cab] ?? R;
    if (cab === winnerCab || r >= R) return Infinity;
    return stops.find((s) => s.round === r)?.tDetach ?? Infinity;
  });

  /** Cuántos quedan a la hora `x`: baja en cada parada, cuando se bajan. */
  function leftAt(x: number): number {
    let m = n;
    for (const s of stops) if (x >= s.tOff + 0.35) m = left[s.round + 1] as number;
    return m;
  }
  /** Quiénes siguen arriba de una cabina a la hora `x`. */
  function aboard(cab: number, x: number): number[] {
    let done_ = -1;
    for (const s of stops) if (x >= s.tOff) done_ = s.round;
    const boarded = x >= T_BOARD ? Infinity : boardedAt(x);
    return (pax[cab] ?? []).filter((p, i) => (offAt.get(p) ?? R) > done_ && i < boarded);
  }
  /** Durante el embarque: cuántos pasajeros subió cada cabina. */
  function boardedAt(x: number): number {
    const perCab = Math.ceil(n / C);
    return Math.floor(clamp((x - 0.25) / (T_BOARD - 0.55), 0, 1) * perCab + 0.001);
  }

  /** El orden de cada cabina en el convoy, cerrando los huecos de las que se fueron. */
  function slotAt(cab: number, x: number): number {
    let s = cab;
    for (let j = 0; j < cab; j++) {
      const td = detachT[j] as number;
      if (x > td) s -= ease.inOutCubic(clamp((x - td - 0.25) / 0.9, 0, 1));
    }
    return s;
  }

  /**
   * Cuánto se hamaca el convoy. Sale de la aceleración de la cabeza, que es
   * lo que hace una cabina de verdad: se va para atrás al arrancar y para
   * adelante al frenar, y después oscila hasta quedarse quieta.
   */
  function swingAt(x: number): number {
    const h = 0.05;
    const a = (headAt(x + h) - 2 * headAt(x) + headAt(x - h)) / (h * h);
    let s = -a * 0.1;
    for (const L of legs) {
      if (L.kind !== "glide" || x < L.t1) continue;
      const since = x - L.t1;
      if (since < 3) s += 0.07 * Math.exp(-since * 2.4) * Math.sin(since * 8);
    }
    if (x > T_DOCK) {
      const since = x - T_DOCK;
      if (since < 3) s += 0.1 * Math.exp(-since * 2.2) * Math.sin(since * 9);
    }
    // El apagón: después del frenazo el convoy queda hamacándose a oscuras.
    if (x > quieto) {
      const since = x - quieto;
      if (since < 4) s += 0.16 * Math.exp(-since * 1.2) * Math.sin(since * 6.5);
    }
    // La ráfaga empuja a todas juntas.
    s += (windAt(x) - 0.2) * 0.18 * Math.sin(x * 5.2);
    return clamp(s, -0.32, 0.32);
  }

  const ultima = stops.find((x) => x.last);
  const puertaA = ultima ? ultima.t0 + (ultima.t1 - ultima.t0) * 0.2 : Infinity;
  const puertaB = ultima ? ultima.t0 + (ultima.t1 - ultima.t0) * 0.5 : Infinity;
  function puertaAt(x: number): number {
    if (!puerta || x < puertaA || x > puertaB) return 0;
    return clamp(Math.sin((Math.PI * (x - puertaA)) / (puertaB - puertaA)) * 1.6, 0, 1);
  }

  return {
    n, rank, left, R, C, cabinOf, offAt, pax, winnerCab, loserCab, slipCab,
    story: story as Story, puerta, mordaza, apagon, rafaga,
    S, stopOf, legs, TOP, headAt, stops, passes, detachT,
    corte, quieto, vuelve, luzAt, windAt, rafagaT: () => rafagaT,
    mA, mB, mC, mD, slipAt, puertaA, puertaB, puertaAt,
    leftAt, aboard, slotAt, swingAt,
  };
}
