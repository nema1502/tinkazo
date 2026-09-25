import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { drawAvatar, paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, ease, mount, drawWinnerPlate, flashScreen, winnerNames, winnersLabel } from "./overlay";

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

type Leg =
  | { kind: "glide"; t0: number; t1: number; from: number; to: number }
  | { kind: "stop"; t0: number; t1: number; at: number; station: number; round: number; last: boolean };

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
  const wLast = 1.7;
  let wSum = 0;
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
    legs.push({ kind: "glide", t0: glideT0, t1: tt, from: glideFrom, to: k * D });
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
      return L.from + (L.to - L.from) * inOutQuad((x - L.t0) / (L.t1 - L.t0));
    }
    if (x < T_RUN) return S * D;
    if (x < T_DOCK) return S * D + (TOP - S * D) * ease.inOutCubic((x - T_RUN) / (T_DOCK - T_RUN));
    return TOP;
  }

  /** Las paradas, en orden, con su hora de bajada y la de soltar cabinas. */
  const stops = legs.filter((L): L is Extract<Leg, { kind: "stop" }> => L.kind === "stop").map((L) => ({
    ...L,
    // La última se toma su tiempo: el latido arranca antes que la bajada.
    tOff: L.t0 + (L.t1 - L.t0) * (L.last ? 0.55 : 0.28),
    tDetach: L.t0 + (L.t1 - L.t0) * (L.last ? 0.78 : 0.62),
  }));
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
        if (s.last) sayNow(T[lang].cTelOff(names[who[0] as number] ?? ""), 0.9);
        else sayNow(T[lang].cTelStop(s.station, who.length, left[s.round + 1] as number), 0.5 + 0.3 * (s.round / Math.max(1, R)));
        if (!silent) {
          const blips = Math.min(6, who.length);
          for (let i = 0; i < blips; i++) setTimeout(() => beep(note(15 - i), 0.07, "sine", 0.032), i * 70);
        }
      });
      once(`detach${s.station}`, tAll >= s.tDetach, () => {
        if (!silent && detachT.some((d) => d === s.tDetach)) beep(note(3), 0.08, "square", 0.036);
      });
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
    // El latido de la última estación y del último tramo, cada vez más seguido.
    const last = stops.find((s) => s.last);
    const from = last ? last.t0 : T_RUN;
    if (tAll >= from && tAll < T_DOCK) {
      const gap = tAll < T_RUN ? 0.5 : 0.36;
      const b = Math.floor((tAll - from) / gap);
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
    say(T[lang].cWin(winnersLabel(names, winners)), 1);
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
      c.globalAlpha = 0.35 + 0.5 * tw * L.z * 2;
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
    // La ventana.
    const wx = -cw / 2 + 8 * k, wy = top + 10 * k, ww = cw - 16 * k, wh = ch * 0.58;
    c.fillStyle = "#1d2336";
    c.fillRect(wx, wy, ww, wh);
    const av = wh - 8 * k;
    if (who.length === 1) {
      drawAvatar(c, names[who[0] as number] ?? "", -av / 2, wy + 4 * k, av);
    } else if (who.length > 1) {
      const show = Math.min(3, who.length);
      const small = Math.min(av, (ww - 8 * k) / 3 - 3 * k);
      for (let i = 0; i < show; i++) {
        drawAvatar(c, names[who[i] as number] ?? "", wx + 4 * k + i * (small + 3 * k), wy + (wh - small) / 2, small);
      }
    }
    // Las puertas se abren al llegar arriba.
    if (cab === winnerCab && tAll > T_DOCK) {
      const o = ease.outCubic(clamp((tAll - T_DOCK - 0.2) / 0.5, 0, 1));
      c.fillStyle = col;
      c.fillRect(wx, wy, (ww / 2) * (1 - o), wh);
      c.fillRect(wx + ww / 2 + (ww / 2) * o, wy, (ww / 2) * (1 - o), wh);
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
    const labels: { name: string; x: number; y: number }[] = [];
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
      const p = onCable(head, slot * gap + back);
      const glow = cab === winnerCab && tAll > T_DOCK ? 0.6 + 0.4 * Math.sin(tAll * 8) : 0;
      drawCabin(cab, p.x, p.y, alpha, sw * (1 - slot * 0.06), glow);
      // Con una persona por cabina, se la nombra debajo.
      const who = aboard(cab, tAll);
      // En vertical, al costado: la cabina de abajo queda justo debajo y el
      // nombre la tapaba.
      if (few && who.length === 1 && alpha === 1) {
        labels.push(vertical
          ? { name: names[who[0] as number] ?? "", x: p.x + cw / 2 + 14 * k, y: p.y + 24 * k + ch / 2 + 8 * k }
          : { name: names[who[0] as number] ?? "", x: p.x - 40 * k, y: p.y + 24 * k + ch + 28 * k });
      }
    }
    if (tAll < T_CROWN) for (const L of labels) chip(L.name, L.x, L.y, 1, 1.15);
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
    if (tem) c.restore();
    drawHud();
    if (tAll >= T_CROWN) {
      drawCrown(tAll - T_CROWN);
      tHold += dt * paceFactor();
    }
    if (tHold >= WINNER_HOLD) cleanup();
  });

}
