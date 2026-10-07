import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { drawAvatar, paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, ease, mount, drawWinnerPlate, flashScreen, winnerNames, winnersLabel } from "./overlay";
import { writeStory } from "./drama";

/**
 * El Teleférico.
 *
 * Un convoy de cabinas sube por el cable y en cada estación se baja la mitad
 * de los pasajeros, hasta que una sola cabina llega a la cumbre y abre la
 * puerta. Es el primer juego que se lee de abajo hacia arriba, y por eso el
 * mejor en un celular: el cable cruza la pantalla en diagonal y el progreso es
 * la altura.
 *
 * Tres decisiones que no son de estilo:
 *
 * - **Los últimos cinco en bajarse van cada uno en una cabina distinta.** Así,
 *   cuando quedan cinco o menos, cada cabina lleva a una sola persona y se la
 *   puede nombrar. Y la cabina del ganador cae en un puesto sorteado del
 *   convoy: si fuera siempre la de adelante, la sala lo aprende al segundo
 *   sorteo y se acabó la tensión.
 * - **Con poca gente hay estaciones de largo.** Dos participantes son una
 *   sola parada; en vez de estirarla hasta la cámara lenta, el convoy pasa de
 *   largo por las primeras y el narrador lo dice. Nunca se anuncia una bajada
 *   que no ocurre.
 * - **Todo es una función del tiempo de juego.** Dónde está el convoy, cuánto
 *   se hamaca una cabina, dónde va cada pasajero que se baja: nada se acumula
 *   cuadro a cuadro. Saltar es poner el reloj al final, y la misma ronda
 *   dibuja los mismos cuadros.
 *
 * El juego no decide nada: el orden de bajada sale de la ronda con el ganador
 * puesto al final, y el cable solo lo cuenta.
 */

/**
 * Las diez líneas de Mi Teleférico, que se llaman por su color.
 *
 * El amarillo no es el de la casa a propósito: el cartel del ganador es
 * amarillo, y una cabina del mismo tono competiría con él en la foto final.
 */
const LINES = ["#d7263d", "#e9b000", "#2f9e44", "#1c64c8", "#f2771a", "#ececec", "#5bc0eb", "#7d3c98", "#8b5a2b", "#aab2bd"];

/** Cuántas cabinas lleva el convoy, como máximo. */
const MAXC = 5;
/** Cuántas estaciones como mínimo, contando las de largo. */
const MIN_STATIONS = 4;

/* Los tiempos, en segundos de juego desde el arranque. */
const T_BOARD = 2.0;
const T_RUN = 13.4;
const T_DOCK = 15.8;
const T_CROWN = 16.4;

/**
 * Un frenazo en el aire: el tramo viaja normal hasta `a`, frena en `b`
 * segundos, se queda quieto `dur` y vuelve a tomar velocidad en `b2`.
 */
interface Stall { a: number; b: number; dur: number; b2: number }

type Leg =
  | { kind: "glide"; t0: number; t1: number; from: number; to: number; span: number; stall?: Stall }
  | { kind: "stop"; t0: number; t1: number; at: number; station: number; round: number; last: boolean };

/**
 * La hora del tramo sin el frenazo. Antes de frenar es la misma; frenando
 * avanza cada vez más despacio hasta quedarse quieta; después recupera el
 * paso. Es una función continua y que nunca baja, así que el convoy nunca
 * retrocede ni salta.
 */
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

interface Hop {
  /** Cabina de la que sale y estación adonde va. */
  cab: number;
  station: number;
  t0: number;
  /** Desparramo sobre el andén, sembrado. */
  dx: number;
  hue: string;
}

export function cableCar(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
): void {
  // La animación se centra en el primero; el cartel y el narrador cantan a
  // todos. Con tres premios sorteados, la sala tiene que oír tres nombres.
  const winnerIdx = winners[0] ?? 0;
  const st = mount(beacon, done, () => skip());
  if (!st) {
    done();
    return;
  }
  const { c, W, H, u, rng, color, say, chip, dark, cleanup, run } = st;
  setGameLength(T_CROWN, WINNER_HOLD);

  const n = names.length;
  const lang = getLang();

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
  st.canvas.dataset.arco = story.arc;
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

  /* ------------------------------------------------------------- estado */
  let tAll = 0;
  let tHold = 0;
  let flashK = 0;
  let shake = 0;
  let didCrown = false;
  let didDock = false;
  let silent = false;
  let lastHum = -1;
  let boardTicks = 0;
  let beat = -1;
  let beatDark = -1;
  let lastSaid = -99;
  const hops: Hop[] = [];
  const fired = new Set<string>();
  /** Lo que muestra cada andén: cuántos se bajaron y, si son pocos, quiénes. */
  const platform = new Map<number, { off: number; who: number[]; t: number }>();

  const seedOf = (k: number): number => {
    const v = parseInt(beacon.randomness.slice((k * 2) % 56, ((k * 2) % 56) + 8), 16);
    return (v % 1000) / 1000;
  };

  /* ----------------------------------------------------------- eventos */
  function once(key: string, due: boolean, fn: () => void): void {
    if (!due || fired.has(key)) return;
    fired.add(key);
    fn();
  }
  const sayNow = (msg: string, heat: number): void => {
    if (silent) return;
    lastSaid = tAll;
    say(msg, heat);
  };
  const ding = (hi = 12, lo = 8): void => {
    if (silent) return;
    beep(note(hi), 0.16, "triangle", 0.05);
    setTimeout(() => beep(note(lo), 0.22, "triangle", 0.045), 200);
  };

  function events(): void {
    once("board", tAll >= 0.05, () => sayNow(t("cTelBoard"), 0.1));
    once("count", tAll >= 0.9, () => sayNow(T[lang].cTelCount(n, C), 0.15));
    once("go", tAll >= T_BOARD, () => {
      sayNow(t("cTelGo"), 0.4);
      ding(15, 10);
    });
    for (const p of passes) {
      once(`pass${p.station}`, tAll >= p.t, () => {
        sayNow(T[lang].cTelPass(p.station), 0.35);
        if (!silent) beep(note(12), 0.14, "triangle", 0.04);
      });
    }
    for (const s of stops) {
      once(`arrive${s.station}`, tAll >= s.t0, () => {
        ding();
        if (s.last) sayNow(t("cTelLast"), 0.8);
      });
      once(`off${s.station}`, tAll >= s.tOff, () => {
        const who = rank.slice(left[s.round + 1] as number, left[s.round] as number);
        platform.set(s.station, { off: who.length, who: who.slice(0, 3), t: s.tOff });
        // Una partícula por pasajero, hasta cuarenta: con doscientos se ve
        // una cascada, y más que eso es basura para el procesador.
        const step = Math.max(1, Math.ceil(who.length / 40));
        for (let i = 0; i < who.length; i += step) {
          const idx = who[i] as number;
          hops.push({
            cab: cabinOf.get(idx) ?? 0, station: s.station, t0: s.tOff + (i / who.length) * 0.35,
            dx: seedOf(i) * 2 - 1, hue: color(idx),
          });
        }
        if (s.last) {
          // Con varios premios, el último que se baja también ganó, y el relator
          // decía "¡Hasta acá llegó X!" de un ganador.
          const idx = who[0] as number;
          sayNow((winners.includes(idx) ? T[lang].cTelPrize : T[lang].cTelOff)(names[idx] ?? ""), 0.9);
        } else sayNow(T[lang].cTelStop(s.station, who.length, left[s.round + 1] as number), 0.5 + 0.3 * (s.round / Math.max(1, R)));
        if (!silent) {
          const blips = Math.min(6, who.length);
          for (let i = 0; i < blips; i++) setTimeout(() => beep(note(15 - i), 0.07, "sine", 0.032), i * 70);
        }
      });
      once(`detach${s.station}`, tAll >= s.tDetach, () => {
        if (!silent && detachT.some((d) => d === s.tDetach)) beep(note(3), 0.08, "square", 0.036);
      });
    }
    if (puerta) {
      once("puerta", tAll >= puertaA, () => {
        sayNow(T[lang].cTelDoor(names[winnerIdx] ?? ""), 0.85);
        if (!silent) {
          beep(note(12), 0.08, "triangle", 0.04);
          setTimeout(() => beep(note(15), 0.1, "triangle", 0.035), 70);
        }
      });
      once("cierra", tAll >= puertaB, () => {
        sayNow(t("cTelStays"), 0.9);
        if (!silent) beep(note(5), 0.08, "square", 0.05);
      });
    }
    if (mordaza) {
      once("suelta", tAll >= mA, () => {
        const who = slipCab === winnerCab ? winnerIdx : (rank[1] as number);
        sayNow(T[lang].cTelSlip(names[who] ?? ""), 0.9);
        // Cinco notas que bajan: la cabina que se va cable abajo.
        if (!silent) [14, 12, 10, 8, 6].forEach((d, i) => setTimeout(() => beep(note(d), 0.06, "square", 0.035), i * 45));
      });
      once("agarra", tAll >= mB, () => {
        sayNow(t("cTelCaught"), 0.95);
        if (!silent) {
          beep(note(2), 0.12, "square", 0.06);
          beep(note(0), 0.3, "sine", 0.08);
        }
      });
    }
    if (apagon) {
      once("corte", tAll >= corte, () => {
        sayNow(t("cTelDark"), 0.85);
        // La luz que se va: cuatro notas que caen.
        if (!silent) [12, 9, 6, 3].forEach((d, i) => setTimeout(() => beep(note(d), 0.09, "sawtooth", 0.035), i * 70));
      });
      once("vuelve", tAll >= vuelve, () => {
        sayNow(t("cTelLight"), 0.8);
        // Un clic por cada vez que prende, al compás del titileo.
        if (!silent) {
          beep(note(10), 0.05, "square", 0.04);
          setTimeout(() => beep(note(12), 0.05, "square", 0.04), 160);
          setTimeout(() => beep(note(15), 0.1, "triangle", 0.045), 300);
        }
      });
    }
    if (rafaga) {
      once("rafagaSnd", tAll >= rafagaT, () => {
        if (silent) return;
        beepFor(note(1), 1.3, "sawtooth", 0.028);
        beepFor(note(3), 0.9, "triangle", 0.03);
      });
      // El relator la canta si no acaba de hablar; si justo estaba diciendo
      // otra cosa, la ráfaga se ve y se oye igual.
      once("rafaga", tAll >= rafagaT && tAll < rafagaT + 1.4 && tAll - lastSaid > 0.5, () => sayNow(t("cTelWind"), 0.7));
    }
    once("climb", tAll >= T_RUN + 0.15, () => sayNow(t("cTelClimb"), 0.9));
    if (tAll >= T_DOCK && !didDock) {
      didDock = true;
      flashK = Math.max(flashK, 0.5);
      shake = 1;
      sayNow(t("cTelDock"), 0.95);
      if (!silent) {
        beep(note(0), 0.45, "sine", 0.1);
        setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
        setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
      }
    }
    if (tAll >= T_CROWN) crowned();
    // Un relleno para los viajes largos: nunca más de dos segundos y medio
    // sin que el relator diga algo mientras el convoy sube. Sólo en viaje:
    // "sigue subiendo" con el convoy parado en un andén es mentira.
    const moving = headAt(tAll + 0.05) - headAt(tAll) > 0.002;
    if (moving && tAll > T_BOARD && tAll < T_RUN && tAll - lastSaid > 2.4) sayNow(t("cTelUp"), 0.4);
  }

  function sounds(): void {
    if (silent) return;
    // El embarque: un clic por pasajero que sube, con tope de catorce por
    // segundo, por la escala y no por hercios sueltos.
    if (tAll < T_BOARD) {
      const want = Math.min(Math.round((tAll / T_BOARD) * 22), Math.min(22, n + 4));
      while (boardTicks < want) {
        beep(note(5 + (boardTicks % 8)), 0.05, "square", 0.03);
        boardTicks++;
      }
    }
    // El cable zumba mientras el convoy se mueve, y baja de tono al frenar.
    const v = Math.abs(headAt(tAll + 0.05) - headAt(tAll)) / 0.05;
    if (tAll >= T_BOARD && tAll < T_DOCK && v > 0.05) {
      const hum = Math.floor(tAll / 0.3);
      if (hum !== lastHum) {
        lastHum = hum;
        beepFor(note(2 + Math.round(clamp(v, 0, 1.2) * 4)), 0.36, "sawtooth", 0.026);
      }
    }
    // A oscuras y quieto, lo único que se oye es un latido.
    if (tAll >= quieto && tAll < vuelve) {
      const b = Math.floor((tAll - quieto) / 0.42);
      if (b !== beatDark) {
        beatDark = b;
        beep(note(0), 0.14, "sine", 0.075);
      }
    }
    // El latido de la última estación y del último tramo, cada vez más seguido.
    const last = stops.find((s) => s.last);
    const from = last ? last.t0 : T_RUN;
    if (tAll >= from && tAll < T_DOCK) {
      // Cada tramo cuenta sus golpes desde que empieza. Contados los dos desde
      // la estación, al pasar de medio segundo a 0,36 el índice saltaba y
      // podían sonar dos golpes casi juntos: cuatro en un segundo y medio, que
      // el auditor de sonido marca como golpe repetido.
      const b = tAll < T_RUN ? Math.floor((tAll - from) / 0.5) : 1000 + Math.floor((tAll - T_RUN) / 0.36);
      if (b !== beat) {
        beat = b;
        beep(note(tAll < T_RUN ? 0 : 2), 0.12, "sine", 0.07);
      }
    }
  }

  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    flashK = 1;
    say(T[lang].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  function skip(): void {
    if (tAll >= T_CROWN) return;
    // Se corre el reloj al final y se aplican todas las bajadas sin sonido
    // ni relato: lo único que se oye es la corona, que `events` dispara una
    // sola vez.
    silent = true;
    tAll = T_CROWN;
    events();
    silent = false;
    hops.length = 0;
  }

  /* ---------------------------------------------------------- geometría */
  const geo = () => {
    const vertical = H() > W() * 1.1;
    // La unidad no puede salir sólo del alto: en un celular vertical daría
    // cabinas más anchas que un tercio de la pantalla.
    const k = Math.min(u(), W() / 720);
    const theta = vertical ? 0.95 : 0.4;
    const dir = { x: Math.cos(theta), y: -Math.sin(theta) };
    // Cuánto mide una unidad de cable en píxeles: la próxima estación asoma
    // por el borde a mitad de viaje.
    const span = vertical ? H() * 0.52 : W() * 0.62;
    const ax = vertical ? W() * 0.5 : W() * 0.52;
    const ay = vertical ? H() * 0.5 : H() * 0.56;
    return { k, dir, span, ax, ay, vertical, cw: 104 * k, ch: 78 * k, gap: 132 * k };
  };

  let camX = 0;
  /** La cámara sigue a la cabeza, un poco adelantada mientras viaja. */
  function camAt(x: number): number {
    const hx = headAt(x);
    const ahead = (headAt(x + 0.4) - hx) * 1.2;
    return clamp(hx + ahead - 0.12, -0.1, TOP - 0.05);
  }

  /** Un punto del cable, de unidades a píxeles. `off` corre a lo largo, en píxeles. */
  function onCable(pos: number, off = 0): { x: number; y: number } {
    const g = geo();
    const d = (pos - camX) * g.span - off;
    return { x: g.ax + g.dir.x * d, y: g.ay + g.dir.y * d };
  }

  /* ------------------------------------------------------------- dibujo */
  // La línea de cumbres de la cordillera, sembrada una vez.
  const ridge: [number, number][] = Array.from({ length: 17 }, (_, i) => [i / 16, 0.3 + rng() * 0.62]);
  // Las luces de la hoyada, sembradas una vez. Cada una tiene su profundidad.
  const lights = Array.from({ length: 150 }, () => ({ x: rng(), y: rng(), z: 0.15 + rng() * 0.4, tw: rng() * 6 }));

  function drawSky(now: number): void {
    const g = c.createLinearGradient(0, 0, 0, H());
    g.addColorStop(0, dark ? "#0b1230" : "#152052");
    g.addColorStop(0.55, dark ? "#2a1b48" : "#3a2560");
    g.addColorStop(1, dark ? "#b3553f" : "#d86f4d");
    c.fillStyle = g;
    c.fillRect(0, 0, W(), H());
    const { k, dir, span } = geo();
    // La cordillera al fondo, casi quieta: la parte más lejana del paisaje.
    // Genérica a propósito, como la de la carrera: la marca no pone montañas
    // reconocibles (docs/marca.md), y un nevado de tres picos se lee como una
    // postal. La nieve va recortada dentro de la silueta.
    const par = camX * span * 0.03;
    const baseY = H() * 0.66;
    const mh = Math.min(H() * 0.24, 200 * k);
    const span0 = W() * 1.6;
    const x0 = -W() * 0.3 - dir.x * par;
    c.save();
    c.beginPath();
    c.moveTo(x0, baseY);
    ridge.forEach(([q, h]) => c.lineTo(x0 + q * span0, baseY - h * mh));
    c.lineTo(x0 + span0, baseY);
    c.closePath();
    c.fillStyle = dark ? "#3b3563" : "#4a3f78";
    c.fill();
    c.clip();
    c.fillStyle = "#e8e4f4";
    c.beginPath();
    c.moveTo(x0, baseY - mh * 2);
    c.lineTo(x0 + span0, baseY - mh * 2);
    for (let i = 40; i >= 0; i--) {
      const q = i / 40;
      c.lineTo(x0 + q * span0, baseY - mh * (i % 2 === 0 ? 0.66 : 0.58));
    }
    c.closePath();
    c.fill();
    c.restore();
    // La ciudad en la hoyada: luces cálidas que titilan y se corren con la
    // cámara según su profundidad.
    for (const L of lights) {
      const shift = camX * span * L.z;
      const x = ((((L.x * W() * 1.6 - dir.x * shift) % (W() * 1.6)) + W() * 1.6) % (W() * 1.6)) - W() * 0.3;
      const y = H() * (0.7 + L.y * 0.3) - dir.y * shift * 0.25;
      if (y < H() * 0.6 || y > H()) continue;
      const tw = 0.55 + 0.45 * Math.sin(now * 2 + L.tw);
      // En el apagón se apaga la ciudad entera: es lo que dice que se cortó la
      // luz, y no que el teleférico se trabó.
      c.globalAlpha = (0.35 + 0.5 * tw * L.z * 2) * (0.06 + 0.94 * luzAt(tAll));
      c.fillStyle = L.tw > 3 ? "#ffd38a" : "#ffb35c";
      const s = (1.6 + L.z * 3) * k;
      c.fillRect(x, y, s, s);
    }
    c.globalAlpha = 1;
  }

  function drawCable(): void {
    const { k } = geo();
    // Las torres, a mitad de camino entre estación y estación.
    for (let i = 0; i <= S; i++) {
      const p = onCable(i * D + D / 2);
      if (p.x < -60 * k || p.x > W() + 60 * k) continue;
      c.fillStyle = dark ? "#1b1830" : "#231d3d";
      c.beginPath();
      c.moveTo(p.x - 7 * k, p.y + 6 * k);
      c.lineTo(p.x + 7 * k, p.y + 6 * k);
      c.lineTo(p.x + 20 * k, H());
      c.lineTo(p.x - 20 * k, H());
      c.closePath();
      c.fill();
      c.fillStyle = INK;
      c.fillRect(p.x - 26 * k, p.y - 4 * k, 52 * k, 10 * k);
    }
    // Dos cables: el de subida y el de vuelta, un poco más abajo.
    const a = onCable(-1);
    const b = onCable(TOP + 1);
    c.lineCap = "round";
    for (const [dy, w, col] of [[0, 4, "#0d0b16"], [14, 3, "rgba(13,11,22,0.7)"]] as const) {
      c.strokeStyle = col;
      c.lineWidth = w * k;
      c.beginPath();
      c.moveTo(a.x, a.y + dy * k);
      c.lineTo(b.x, b.y + dy * k);
      c.stroke();
    }
  }

  /** Dónde va cada estación y qué tamaño tiene. */
  function station(s_: number): { x: number; y: number; bw: number; bh: number; y0: number; top: boolean; base: boolean } {
    const { k } = geo();
    const p = onCable(s_ * D);
    const top = s_ === S + 1;
    const base = s_ === 0;
    const bw = (top ? 230 : base ? 210 : 160) * k;
    const bh = 160 * k;
    // El cable entra por arriba del edificio: el techo queda por encima.
    return { x: p.x, y: p.y, bw, bh, y0: p.y - 40 * k, top, base };
  }
  const onScreen = (x: number, y: number, m: number): boolean => x > -m && x < W() + m && y > -m && y < H() + m;

  function drawStations(): void {
    const { k } = geo();
    for (let s_ = 0; s_ <= S + 1; s_++) {
      const { x, bw, bh, y0, top } = station(s_);
      if (!onScreen(x, y0, 260 * k)) continue;
      c.fillStyle = INK;
      c.fillRect(x - bw / 2 + 8 * k, y0 + 8 * k, bw, bh);
      c.fillStyle = top ? "#f6efe2" : dark ? "#d9d2c4" : "#e8e1d3";
      c.fillRect(x - bw / 2, y0, bw, bh);
      c.lineWidth = 3 * k;
      c.strokeStyle = INK;
      c.strokeRect(x - bw / 2, y0, bw, bh);
      // La boca por donde entran las cabinas, en sombra.
      c.fillStyle = dark ? "#2b2640" : "#3a3450";
      c.fillRect(x - bw / 2 + 14 * k, y0 + 30 * k, bw - 28 * k, bh - 58 * k);
      c.fillStyle = top ? "#ffc629" : (LINES[(s_ + 2) % LINES.length] as string);
      c.fillRect(x - bw / 2, y0, bw, 16 * k);
      c.strokeRect(x - bw / 2, y0, bw, 16 * k);
      // El andén.
      c.fillStyle = INK;
      c.fillRect(x - bw / 2 - 10 * k, y0 + bh - 18 * k, bw + 20 * k, 10 * k);
      // La bandera de la estación, en su color, en un mástil alto sobre la
      // esquina izquierda: el rótulo y la cuenta de los que se bajaron van al
      // centro y no se tapan.
      const mx = x - bw / 2 + 14 * k;
      c.strokeStyle = INK;
      c.lineWidth = 3 * k;
      c.beginPath();
      c.moveTo(mx, y0);
      c.lineTo(mx, y0 - 136 * k);
      c.stroke();
      drawFlag(mx, y0 - 134 * k, 88 * k, 46 * k, top ? "#ffc629" : (LINES[(s_ + 2) % LINES.length] as string), s_ * 1.9, false);
      if (top) drawBunting(x, y0, bw);
    }
  }

  /**
   * Una bandera que flamea desde un mástil. Va para la izquierda, que es para
   * donde sopla el viento en este valle, y ondula más y se estira con la
   * ráfaga. Todo sale de la hora de juego: la misma ronda la dibuja igual.
   */
  function drawFlag(x: number, y: number, w: number, h: number, col: string, seed: number, pennant: boolean): void {
    const { k } = geo();
    const wind = windAt(tAll);
    const len = w * (0.82 + 0.22 * wind);
    const amp = h * (0.1 + 0.34 * wind);
    const ph = tAll * (3.4 + wind * 8) + seed;
    const N = 8;
    const wave = (s: number): number => Math.sin(ph - s * 4) * amp * s;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      c.lineTo(x - s * len, y + (pennant ? (s * h) / 2 : 0) + wave(s));
    }
    for (let i = N; i >= 0; i--) {
      const s = i / N;
      c.lineTo(x - s * len, y + (pennant ? h - (s * h) / 2 : h) + wave(s) * 1.05);
    }
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.lineWidth = 2 * k;
    c.strokeStyle = INK;
    c.stroke();
  }

  /**
   * Los banderines de la cumbre, colgados de esquina a esquina. Se mueven con
   * el viento, y cuando llega la cabina ganadora se sacuden de fiesta.
   */
  function drawBunting(x: number, y0: number, bw: number): void {
    const { k } = geo();
    const n_ = 11;
    const x0 = x - bw / 2, x1 = x + bw / 2;
    const sag = 28 * k;
    const fiesta = tAll > T_DOCK ? Math.exp(-(tAll - T_DOCK) * 0.6) : 0;
    const at = (q: number): { x: number; y: number } => ({ x: x0 + (x1 - x0) * q, y: y0 + 4 * k + sag * 4 * q * (1 - q) });
    c.strokeStyle = INK;
    c.lineWidth = 2 * k;
    c.beginPath();
    for (let i = 0; i <= 20; i++) {
      const p = at(i / 20);
      c.lineTo(p.x, p.y);
    }
    c.stroke();
    for (let i = 0; i < n_; i++) {
      const q = (i + 0.5) / n_;
      const p = at(q);
      const sw = Math.sin(tAll * (3 + windAt(tAll) * 6) + i * 1.3) * (0.12 + windAt(tAll) * 0.3 + fiesta * 0.5);
      const half = ((x1 - x0) / n_) * 0.42;
      const len = 22 * k;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(sw);
      c.beginPath();
      c.moveTo(-half, 0);
      c.lineTo(half, 0);
      c.lineTo(0, len);
      c.closePath();
      c.fillStyle = LINES[i % LINES.length] as string;
      c.fill();
      c.stroke();
      c.restore();
    }
  }

  /**
   * Los rótulos de las estaciones, por encima del techo y después de las
   * cabinas. Iban en la fachada, y la cabina que llega tapaba justo el número
   * de la estación y la cuenta de los que se bajaron: lo único que la sala
   * tenía que leer ahí.
   */
  function drawStationTags(): void {
    const { k } = geo();
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (let s_ = 0; s_ <= S + 1; s_++) {
      const { x, y0, bw, top, base } = station(s_);
      if (!onScreen(x, y0, 260 * k)) continue;
      const ty = y0 - 34 * k;
      if (top || base) {
        const label = top ? t("cTelTop") : t("cTelBase");
        c.font = `900 ${24 * k}px system-ui, sans-serif`;
        const tw = c.measureText(label).width + 26 * k;
        c.fillStyle = INK;
        c.fillRect(x - tw / 2 + 4 * k, ty - 14 * k, tw, 36 * k);
        c.fillStyle = top ? "#ffc629" : "#f6efe2";
        c.fillRect(x - tw / 2, ty - 18 * k, tw, 36 * k);
        c.lineWidth = 3 * k;
        c.strokeStyle = INK;
        c.strokeRect(x - tw / 2, ty - 18 * k, tw, 36 * k);
        c.fillStyle = INK;
        c.fillText(label, x, ty + 1 * k);
      } else {
        // El número en un disco: amarillo si ahí se baja gente, claro si se
        // pasa de largo.
        c.fillStyle = INK;
        c.beginPath();
        c.arc(x + 3 * k, ty + 3 * k, 27 * k, 0, 7);
        c.fill();
        c.fillStyle = stopOf.has(s_) ? "#ffc629" : "#f6efe2";
        c.beginPath();
        c.arc(x, ty, 27 * k, 0, 7);
        c.fill();
        c.lineWidth = 3 * k;
        c.strokeStyle = INK;
        c.stroke();
        c.font = `900 ${30 * k}px system-ui, sans-serif`;
        c.fillStyle = INK;
        c.fillText(String(s_), x, ty + 1 * k);
      }
      // Los que se bajaron acá: la cuenta y, si son pocos, los nombres.
      const pl = platform.get(s_);
      if (!pl || top || base) continue;
      const since = tAll - pl.t;
      const e = ease.outBack(clamp(since / 0.4, 0, 1));
      c.save();
      c.translate(x - 40 * k, ty);
      c.scale(e, e);
      c.font = `900 ${36 * k}px system-ui, sans-serif`;
      c.textAlign = "right";
      c.fillStyle = "#ffc629";
      c.strokeStyle = INK;
      c.lineWidth = 7 * k;
      c.strokeText(`−${pl.off}`, 0, 0);
      c.fillText(`−${pl.off}`, 0, 0);
      c.restore();
      c.textAlign = "center";
      if (pl.who.length && pl.off <= 3 && since < 2.4 && since > 0.3) {
        const a = clamp(Math.min(since - 0.3, 2.4 - since) / 0.3, 0, 1);
        pl.who.forEach((idx, i) => chip(names[idx] ?? "", x - bw / 2 - 190 * k, ty + 34 * k + i * 30 * k, a));
        c.textAlign = "center";
        c.textBaseline = "middle";
      }
    }
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
  }

  /** La puerta del amague, en la última estación: se abre, se sostiene y se cierra. */
  const ultima = stops.find((x) => x.last);
  const puertaA = ultima ? ultima.t0 + (ultima.t1 - ultima.t0) * 0.2 : Infinity;
  const puertaB = ultima ? ultima.t0 + (ultima.t1 - ultima.t0) * 0.5 : Infinity;
  function puertaAt(x: number): number {
    if (!puerta || x < puertaA || x > puertaB) return 0;
    return clamp(Math.sin((Math.PI * (x - puertaA)) / (puertaB - puertaA)) * 1.6, 0, 1);
  }

  /** Un rectángulo redondeado, o recto en un navegador que no los sabe dibujar. */
  function box(x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    if (typeof c.roundRect === "function") c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  /** Una cabina colgada del cable en `(x, y)`. */
  function drawCabin(cab: number, x: number, y: number, alpha: number, swing: number, glow: number): void {
    const { k, cw, ch } = geo();
    const who = aboard(cab, tAll);
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    // La mordaza sobre el cable.
    c.fillStyle = INK;
    c.fillRect(-12 * k, -6 * k, 24 * k, 12 * k);
    c.rotate(swing);
    c.lineWidth = 4 * k;
    c.strokeStyle = INK;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 24 * k);
    c.stroke();
    const top = 24 * k;
    const col = LINES[cab % LINES.length] as string;
    // Sombra dura de la casa, como los chips.
    c.fillStyle = INK;
    box(-cw / 2 + 6 * k, top + 6 * k, cw, ch, 12 * k);
    c.fill();
    if (glow > 0) {
      c.strokeStyle = `rgba(255,198,41,${glow})`;
      c.lineWidth = 16 * k;
      box(-cw / 2, top, cw, ch, 12 * k);
      c.stroke();
    }
    c.fillStyle = who.length || tAll < T_BOARD ? col : "#77727f";
    box(-cw / 2, top, cw, ch, 12 * k);
    c.fill();
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.stroke();
    // El banderín, en la esquina de atrás del techo.
    const bx = -cw / 2 + 14 * k;
    c.lineWidth = 2.5 * k;
    c.beginPath();
    c.moveTo(bx, top);
    c.lineTo(bx, top - 38 * k);
    c.stroke();
    drawFlag(bx, top - 37 * k, 48 * k, 26 * k, "#f6efe2", cab * 2.3, true);
    // La ventana.
    const wx = -cw / 2 + 8 * k, wy = top + 10 * k, ww = cw - 16 * k, wh = ch * 0.58;
    c.fillStyle = "#1d2336";
    c.fillRect(wx, wy, ww, wh);
    const av = wh - 8 * k;
    // En el amague, el pasajero se corre hacia la puerta, que está a la derecha.
    const asoma = cab === winnerCab ? puertaAt(tAll) : 0;
    if (who.length === 1) {
      drawAvatar(c, names[who[0] as number] ?? "", -av / 2 + asoma * (ww / 2 - av / 2 - 2 * k), wy + 4 * k, av);
    } else if (who.length > 1) {
      const show = Math.min(3, who.length);
      const small = Math.min(av, (ww - 8 * k) / 3 - 3 * k);
      for (let i = 0; i < show; i++) {
        drawAvatar(c, names[who[i] as number] ?? "", wx + 4 * k + i * (small + 3 * k), wy + (wh - small) / 2, small);
      }
    }
    // La puerta del amague: un hueco oscuro que se abre en el costado.
    if (asoma > 0) {
      const dw = cw * 0.26 * asoma;
      c.fillStyle = INK;
      c.fillRect(cw / 2 - dw - 2 * k, top + 6 * k, dw, ch - 12 * k);
    }
    // Las puertas se abren al llegar arriba.
    if (cab === winnerCab && tAll > T_DOCK) {
      const o = ease.outCubic(clamp((tAll - T_DOCK - 0.2) / 0.5, 0, 1));
      c.fillStyle = col;
      c.fillRect(wx, wy, (ww / 2) * (1 - o), wh);
      c.fillRect(wx + ww / 2 + (ww / 2) * o, wy, (ww / 2) * (1 - o), wh);
    }
    // Sin luz, las ventanas quedan a oscuras y apenas se adivinan las caras.
    const luz = luzAt(tAll);
    if (luz < 1) {
      c.fillStyle = `rgba(4,5,12,${(1 - luz) * 0.82})`;
      c.fillRect(wx, wy, ww, wh);
    }
    c.lineWidth = 2 * k;
    c.strokeStyle = INK;
    c.strokeRect(wx, wy, ww, wh);
    // Cuántos van adentro, cuando no entran todas las caras.
    if (who.length > 1) {
      const label = `×${who.length}`;
      c.font = `900 ${17 * k}px system-ui, sans-serif`;
      const tw = c.measureText(label).width + 12 * k;
      c.fillStyle = "#ffc629";
      c.fillRect(cw / 2 - tw + 6 * k, top + ch - 20 * k, tw, 24 * k);
      c.strokeRect(cw / 2 - tw + 6 * k, top + ch - 20 * k, tw, 24 * k);
      c.fillStyle = INK;
      c.textBaseline = "middle";
      c.fillText(label, cw / 2 - tw + 12 * k, top + ch - 8 * k);
      c.textBaseline = "alphabetic";
    }
    c.restore();
  }

  function drawConvoy(): void {
    const { k, gap, ch, cw, vertical } = geo();
    const head = headAt(tAll);
    const sw = swingAt(tAll);
    const few = leftAt(tAll) <= C && tAll > T_BOARD;
    const labels: { name: string; x: number; y: number; izq?: boolean }[] = [];
    for (let cab = C - 1; cab >= 0; cab--) {
      const td = detachT[cab] as number;
      let alpha = 1;
      let back = 0;
      if (tAll > td) {
        // La cabina vacía se suelta y vuelve para abajo, apagándose.
        const since = tAll - td;
        back = 0.5 * 2.2 * since * since * 140 * k;
        alpha = clamp(1 - since / 0.9, 0, 1);
        if (alpha <= 0) continue;
      }
      const slot = slotAt(cab, tAll);
      // La mordaza: la cabina resbala cable abajo más de media cabina.
      const resbala = cab === slipCab ? slipAt(tAll) * gap * 0.62 : 0;
      const p = onCable(head, slot * gap + back + resbala);
      const glow = cab === winnerCab && tAll > T_DOCK ? 0.6 + 0.4 * Math.sin(tAll * 8) : 0;
      let sacude = cab === winnerCab ? puertaAt(tAll) * 0.07 * Math.sin(tAll * 22) : 0;
      // En la ráfaga cada una se hamaca a su tiempo, no como un bloque.
      sacude += (windAt(tAll) - 0.2) * 0.12 * Math.sin(tAll * 6.3 + cab * 1.7);
      // Cuando la mordaza agarra, el tirón la deja hamacándose fuerte.
      if (cab === slipCab && tAll > mB && tAll < mB + 3) {
        sacude += 0.3 * Math.exp(-(tAll - mB) * 2.4) * Math.sin((tAll - mB) * 9);
      }
      drawCabin(cab, p.x, p.y, alpha, sw * (1 - slot * 0.06) + sacude, glow);
      if (cab === slipCab && tAll > mB && tAll < mB + 0.55) drawSparks(p.x, p.y, tAll - mB);
      // Con una persona por cabina, se la nombra debajo.
      const who = aboard(cab, tAll);
      // En vertical, a la izquierda: la cabina de abajo queda justo debajo y el
      // nombre la tapaba; a la derecha no entra y se corría encima de la
      // cabina, tapando la puerta del amague.
      if (few && who.length === 1 && alpha === 1) {
        labels.push(vertical
          ? { name: names[who[0] as number] ?? "", x: p.x - cw / 2 - 14 * k, y: p.y + 24 * k + ch / 2 + 8 * k, izq: true }
          : { name: names[who[0] as number] ?? "", x: p.x - 40 * k, y: p.y + 24 * k + ch + 28 * k });
      }
    }
    if (tAll < T_CROWN) for (const L of labels) chip(L.name, L.x, L.y, 1, 1.15, L.izq);
  }

  /**
   * El embarque: cada pasajero salta del andén de la base a su cabina, justo
   * antes de aparecer en la ventana. Sale de la misma cuenta que `aboard`, así
   * que el salto y la cara llegan juntos. Con mucha gente, como mucho cuarenta.
   */
  function drawBoarding(): void {
    if (tAll >= T_BOARD) return;
    const { k, gap } = geo();
    const perCab = Math.ceil(n / C);
    const show = Math.min(perCab, Math.ceil(40 / C));
    const b = station(0);
    for (let cab = 0; cab < C; cab++) {
      const count = Math.min(pax[cab]?.length ?? 0, perCab);
      for (let i = 0; i < Math.min(count, show); i++) {
        // El pasajero `slot` de la cabina aparece cuando `boardedAt` llega a slot + 1.
        const slot = Math.floor((i * perCab) / show);
        const tb = 0.25 + ((slot + 1) / perCab) * (T_BOARD - 0.55);
        const q = (tAll - (tb - 0.35)) / 0.35;
        if (q < 0 || q > 1) continue;
        const to = onCable(headAt(tAll), slotAt(cab, tAll) * gap);
        const fx = b.x - b.bw / 2 + 20 * k + (i % 5) * 16 * k;
        const fy = b.y0 + b.bh - 30 * k;
        const x = fx + (to.x - fx) * q;
        const y = fy + (to.y + 60 * k - fy) * q - Math.sin(q * Math.PI) * 90 * k;
        const idx = pax[cab]?.[slot] ?? 0;
        c.fillStyle = INK;
        c.fillRect(x - 7 * k, y - 7 * k, 14 * k, 14 * k);
        c.fillStyle = color(idx);
        c.fillRect(x - 5 * k, y - 5 * k, 10 * k, 10 * k);
      }
    }
  }

  /** Los que se bajan: saltan de la cabina al andén con un arco. */
  function drawHops(): void {
    const { k, gap } = geo();
    for (const h of hops) {
      const p = (tAll - h.t0) / 0.55;
      if (p < 0 || p > 1.6) continue;
      const q = clamp(p, 0, 1);
      const stop = stops.find((s) => s.station === h.station);
      if (!stop) continue;
      const from = onCable(stop.at, slotAt(h.cab, h.t0) * gap);
      const st_ = station(h.station);
      const tx = st_.x + h.dx * (st_.bw / 2 - 12 * k);
      const ty = st_.y0 + st_.bh - 26 * k;
      const x = from.x + (tx - from.x) * q;
      const y = from.y + 60 * k + (ty - from.y - 60 * k) * q - Math.sin(q * Math.PI) * 80 * k;
      c.globalAlpha = p > 1 ? clamp(1.6 - p, 0, 1) / 0.6 : 1;
      c.fillStyle = INK;
      c.fillRect(x - 7 * k, y - 7 * k, 14 * k, 14 * k);
      c.fillStyle = h.hue;
      c.fillRect(x - 5 * k, y - 5 * k, 10 * k, 10 * k);
    }
    c.globalAlpha = 1;
  }

  /** Las chispas de la mordaza cuando agarra el cable. */
  const chispas = Array.from({ length: 14 }, () => ({ a: -Math.PI * (0.1 + rng() * 0.8), v: 0.6 + rng() * 0.8 }));
  function drawSparks(x: number, y: number, since: number): void {
    const { k } = geo();
    const fade = clamp(1 - since / 0.55, 0, 1);
    for (const s of chispas) {
      const d = s.v * since * 260 * k;
      const px = x + Math.cos(s.a) * d;
      const py = y + Math.sin(s.a) * d + since * since * 900 * k;
      c.globalAlpha = fade;
      c.fillStyle = s.v > 1 ? "#fff3c4" : "#ffc629";
      c.fillRect(px - 2.5 * k, py - 2.5 * k, 5 * k, 5 * k);
    }
    c.globalAlpha = 1;
  }

  /** Las vetas de la ráfaga, que cruzan la pantalla hacia la izquierda. */
  const vetas = Array.from({ length: 22 }, () => ({ y: rng(), len: 0.08 + rng() * 0.14, v: 1.1 + rng() * 1.2, off: rng() }));
  function drawWind(): void {
    const w = windAt(tAll) - 0.2;
    if (w <= 0.02) return;
    const { k } = geo();
    c.strokeStyle = "#f6efe2";
    c.lineCap = "round";
    c.lineWidth = 2.5 * k;
    for (const v of vetas) {
      const span = W() * 1.4;
      const x = W() * 1.2 - ((((tAll * v.v * W() * 0.9 + v.off * span) % span) + span) % span);
      const y = H() * (0.08 + v.y * 0.84);
      c.globalAlpha = Math.min(0.55, w * 0.6);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + v.len * W(), y + Math.sin(tAll * 3 + v.off * 9) * 6 * k);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** El apagón oscurece la escena, pero no el tablero: la cuenta sigue a la vista. */
  function drawDark(): void {
    const luz = luzAt(tAll);
    if (luz >= 1) return;
    c.fillStyle = `rgba(3,3,10,${(1 - luz) * 0.5})`;
    c.fillRect(0, 0, W(), H());
  }

  function drawHud(): void {
    const { k } = geo();
    const top = chrome(c).arriba + 18 * k;
    // En el embarque, los que ya están en una cabina: la misma cuenta que
    // dibuja las caras, así el número y las ventanas nunca se contradicen.
    const m = tAll < T_BOARD ? pax.reduce((a, _, cab) => a + aboard(cab, tAll).length, 0) : leftAt(tAll);
    c.textAlign = "left";
    c.textBaseline = "top";
    c.font = `800 ${14 * k}px system-ui, sans-serif`;
    c.fillStyle = "rgba(246,239,226,0.8)";
    c.fillText(tAll < T_BOARD ? t("cTelAboard") : t("cTelLeft"), 22 * k, top);
    c.font = `900 ${52 * k}px system-ui, sans-serif`;
    c.fillStyle = "#ffc629";
    c.strokeStyle = INK;
    c.lineWidth = 6 * k;
    c.strokeText(String(m), 22 * k, top + 18 * k);
    c.fillText(String(m), 22 * k, top + 18 * k);
    // En qué estación va, sobre cuántas.
    const head = headAt(tAll);
    const at = Math.min(S, Math.floor(head / D + 0.02));
    if (tAll >= T_BOARD && tAll < T_RUN) {
      c.font = `800 ${16 * k}px system-ui, sans-serif`;
      c.fillStyle = "rgba(246,239,226,0.85)";
      c.fillText(T[lang].cTelOf(Math.max(1, at), S), 22 * k, top + 82 * k);
    }
    c.textBaseline = "alphabetic";
    c.font = `700 ${12 * k}px ui-monospace, monospace`;
    c.fillStyle = "rgba(246,239,226,0.55)";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, 22 * k, H() - chrome(c).abajo);
  }

  function drawCrown(p: number): void {
    const { vertical } = geo();
    flashScreen(c, W(), H(), flashK);
    const e = ease.outBack(Math.min(1, p * 1.6));
    drawWinnerPlate(c, winnerNames(names, winners), W() / 2, H() * (vertical ? 0.22 : 0.24), u() * (vertical ? 0.8 : 1), e, 52);
  }

  /* ------------------------------------------------------------- bucle */
  run((dt, now) => {
    tAll += dt;
    shake = Math.max(0, shake - dt * 2.2);
    flashK = Math.max(0, flashK - dt * paceFactor() * 4);
    events();
    sounds();
    camX = camAt(tAll);

    const tem = shake > 0;
    if (tem) {
      c.save();
      c.translate(Math.sin(shake * 97) * 8 * shake * u(), Math.sin(shake * 131 + 1.7) * 6 * shake * u());
    }
    drawSky(now);
    drawCable();
    drawStations();
    drawBoarding();
    drawConvoy();
    drawHops();
    drawStationTags();
    drawWind();
    drawDark();
    if (tem) c.restore();
    drawHud();
    if (tAll >= T_CROWN) {
      drawCrown(tAll - T_CROWN);
      tHold += dt * paceFactor();
    }
    if (tHold >= WINNER_HOLD) cleanup();
  });

}
