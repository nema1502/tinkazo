import { clamp, ease } from "../overlay";
import { writeStory, type Story } from "../drama";
import { cuantosGrupos, GRUPOS, grupoDe } from "../grupos";

/**
 * El plan del teleférico por grupos (sección 7.7 del plan de juegos).
 *
 * Cada grupo automático (`grupos.ts`) va en una cabina pintada con el color de
 * una línea de Mi Teleférico. En cada estación se baja un grupo entero sin
 * premio. En la penúltima parada, de cada cabina con premio se bajan todos los
 * que no ganan menos uno, y en la última estación se baja ese uno: a la cumbre
 * llegan exactamente quienes ganan, en una sola cabina.
 *
 * Los cuatro giros se conservan: la puerta y la mordaza pasan en la última
 * estación, con la cabina de los dos que quedan; el apagón y la ráfaga, como antes.
 *
 * Es presentación. El ganador viene de la ronda pública antes de que arranque
 * esta función; el azar que se consume acá (orden de los grupos, lugar de cada
 * cabina, quién queda con el ganador, la historia) sale de la semilla de la
 * ronda y no cambia el resultado.
 */

export const LINES = ["#d7263d", "#e9b000", "#2f9e44", "#1c64c8", "#f2771a", "#ececec", "#5bc0eb", "#7d3c98", "#8b5a2b", "#aab2bd"];
export const MIN_STATIONS = 4;
export const T_BOARD = 2.0;
/**
 * Cuándo arranca el último tramo, el de la cabina sola con quien gana. Desde el 7
 * de octubre de 2026 es 14,0 y no 13,4 como en `cablecar.ts`: la subida con el
 * ganador ya sabido duraba 2,4 s de juego, y esos 0,6 se reparten entre las
 * paradas.
 */
export const T_RUN = 14.0;
export const T_DOCK = 15.8;
export const T_CROWN = 16.4;
/** Cuánto después de la bajada que decide se pasan los premios a la cabina anfitriona, y lo que tarda cada uno en volar. */
export const JUNTA_ESPERA = 0.45;
export const JUNTA_VUELO = 0.5;
/**
 * Los pisos del final, en segundos de juego. Los doce segundos del viaje se
 * reparten por pesos entre las paradas, y con 37 personas o más (diez cabinas,
 * once paradas) la parada que decide quedaba en 1 s: con la puerta el relator
 * decía cuatro líneas en 0,9 s, el "¡se queda!" se veía 0,2 s y la pregunta de
 * quién llega arriba casi no tenía lugar (revisión del 13 de noviembre de 2026).
 * Ahora la última parada, el viaje que llega a ella y el apagón no bajan de
 * esto, y lo que les falta sale de los otros viajes. Con pocas personas los
 * pesos ya dan más y los pisos no cambian nada.
 */
export const PISO_ULTIMA = 2.2;
/** La última parada con la puerta o la mordaza, que tienen su amague antes de la bajada. */
export const PISO_ULTIMA_GIRO = 2.7;
/** Lo que se suma a la última parada cuando los premios de varias cabinas se juntan en una. */
export const PISO_JUNTA = 0.6;
/** El viaje que llega a la última estación: ahí el relator pregunta quién llega arriba. */
export const PISO_VIAJE_FINAL = 1.3;
/** El apagón, entero: se corta, queda a oscuras y vuelve. */
export const PISO_APAGON = 1.2;

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

/** Baraja con el azar sembrado, en el mismo orden de siempre. */
function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export function planCableCar(names: string[], winners: readonly number[], rng: () => number) {
  const winnerIdx = winners[0] ?? 0;
  const n = names.length;
  /**
   * El arco del director, primero: sale de la semilla antes que el plan, así no
   * depende de cuántos grupos hay, de cuántos premios ni de cómo se reparte la
   * última estación. Cada arco tiene su giro (más abajo).
   */
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));

  /* ------------------------------------------------------------ grupos */
  // Un grupo por cabina, y los grupos parejos (`grupoDe`). Los grupos sin
  // premio se bajan enteros, uno por estación. Los que tienen premio siguen
  // hasta el final.
  const K = Math.max(1, cuantosGrupos(n));
  const members: number[][] = Array.from({ length: K }, () => []);
  for (let i = 0; i < n; i++) members[grupoDe(i, n)]?.push(i);
  /** Quienes ganan: distintos y de la lista. Son los únicos que llegan a la cumbre. */
  const premios = winners.filter((w, i) => w >= 0 && w < n && winners.indexOf(w) === i);
  if (!premios.length && n > 0) premios.push(clamp(winnerIdx, 0, n - 1));
  const esPremio = new Set(premios);
  const winG = n > 0 ? grupoDe(premios[0] as number, n) : 0;
  const conPremio = new Set(premios.map((w) => grupoDe(w, n)));

  /** El orden en que se bajan los grupos sin premio. */
  const otros = shuffled(
    Array.from({ length: K }, (_, g) => g).filter((g) => !conPremio.has(g)),
    rng,
  );

  /**
   * En cada grupo con premio, uno que no gana llega a la última estación junto a
   * los que ganan: el suplente, sorteado a ciegas entre los que no ganan de ese
   * grupo. Los demás que no ganan se bajan antes, todos juntos, en la penúltima
   * parada (la bajada grande). En la última estación se baja el suplente: esa es
   * la bajada que decide, y a la cumbre llegan solo quienes ganan.
   *
   * Hasta el 13 de noviembre de 2026 llegaban dos a la cumbre (el ganador y otro
   * de su grupo) y la duda se resolvía recién con el foco, con la cabina x2: no se
   * entendía quién había ganado. Con varios premios, los de otros grupos se
   * bajaban antes con su grupo y arriba seguían llegando dos.
   */
  const suplentes: number[] = [];
  const grandeSinOrden: number[] = [];
  for (const g of [...conPremio].sort((a, b) => a - b)) {
    const resto = shuffled((members[g] ?? []).filter((i) => !esPremio.has(i)), rng);
    if (resto.length) suplentes.push(resto[0] as number);
    grandeSinOrden.push(...resto.slice(1));
  }
  const grande = shuffled(grandeSinOrden, rng);
  /** Quienes llegan arriba, en un orden sorteado. */
  const surv = shuffled(premios, rng);
  /**
   * El grupo de la cabina anfitriona: la que recibe a los premios de las otras
   * cabinas y sube a la cumbre. Con premios en varias cabinas se sortea entre
   * ellas, a ciegas. Hasta el 13 de noviembre de 2026 era siempre la del primer
   * premio, y como la junta vuela a ella y la puerta, la mordaza y la cámara de
   * la última estación caen en ella, el show dejaba adivinar quién tenía el
   * primer premio antes de que lo dijera el relator. Con una sola cabina con
   * premio no se consume azar: con un premio el plan es el de siempre.
   */
  const gruposConPremio = [...conPremio].sort((a, b) => a - b);
  const hostG = gruposConPremio.length > 1 ? (gruposConPremio[Math.floor(rng() * gruposConPremio.length)] as number) : winG;
  /**
   * A quién nombra el relator en la puerta, la mordaza y el apagón, que pasan con
   * la cabina anfitriona llevando a sus premios y a su suplente: uno cualquiera
   * de ellos, sorteado. Antes era uno de los dos que llegan arriba, y ganaba la
   * mitad de las veces con cuatro a bordo (auditor de delatores, 21 de octubre
   * de 2026).
   */
  const enLaFinal = [...premios.filter((w) => grupoDe(w, n) === hostG), ...suplentes.filter((i) => grupoDe(i, n) === hostG)];
  const nombrado = enLaFinal.length ? (enLaFinal[Math.floor(rng() * enLaFinal.length)] as number) : winnerIdx;
  /** Los que se bajan en la última estación: un suplente por cabina con premio. */
  const deAUno = suplentes;

  /**
   * Las rondas, en orden de bajada: un grupo entero por parada, después la bajada
   * grande (si hay a quién bajar) y al final los suplentes. `enteras` dice cuáles
   * son de un grupo entero, que el relator nombra por su grupo.
   */
  const rondas: number[][] = [...otros.map((g) => members[g] ?? []), ...(grande.length ? [grande] : []), suplentes];
  const enteras: boolean[] = [...otros.map(() => true), ...(grande.length ? [false] : []), false];
  const R = rondas.length;

  /** La posición de cada persona en el orden de la lista de bajada: los que llegan arriba, al principio. */
  const rank = [...surv, ...rondas.flat().reverse()];
  /** Cuántos quedan después de cada parada: cada ronda se resta de una vez. */
  const left: number[] = [n];
  for (const r of rondas) left.push((left[left.length - 1] as number) - r.length);

  /* ------------------------------------------------------------ cabinas */
  // Cada grupo tiene su cabina; la cabina de cada grupo cae en un puesto
  // sorteado del convoy, y la del ganador también.
  const puesto = shuffled(Array.from({ length: K }, (_, g) => g), rng);
  const cabinOf = new Map<number, number>();
  const groupOfCab: number[] = Array.from({ length: K }, () => 0);
  /**
   * Quiénes van en cada cabina, en un orden sorteado a ciegas: es el orden de las
   * caras en la ventana y de los nombres cuando quedan dos. Antes seguía el orden
   * de bajada, y quien gana iba siempre entre las primeras caras.
   */
  const pax: number[][] = Array.from({ length: K }, () => []);
  for (let g = 0; g < K; g++) {
    const cab = puesto[g] as number;
    groupOfCab[cab] = g;
    for (const idx of members[g] ?? []) cabinOf.set(idx, cab);
    pax[cab] = shuffled(members[g] ?? [], rng);
  }
  /** Cuándo se baja cada persona: el índice de la parada, o R si llega arriba. */
  const offAt = new Map<number, number>();
  for (let r = 0; r < R; r++) {
    for (let p = left[r + 1] as number; p < (left[r] as number); p++) offAt.set(rank[p] as number, r);
  }
  /** La parada en la que se vacía cada cabina: la de su último pasajero. */
  const emptiesAt = pax.map((ps) => Math.max(...ps.map((p) => offAt.get(p) ?? R)));
  /**
   * La cabina que sube a la cumbre: la anfitriona (`hostG`). Con un solo grupo con
   * premio es la de quien gana, como siempre. Con varios es una de las cabinas con
   * premio, sorteada, y no dice nada del orden de los premios.
   */
  const winnerCab = puesto[hostG] ?? 0;
  /**
   * Las otras cabinas con premio. Después de la bajada que decide, sus premios
   * se pasan a la anfitriona (`juntados`) y ellas se sueltan: sube una sola
   * cabina, con todos los que ganan.
   */
  const juntaCabs = new Set([...conPremio].map((g) => puesto[g] as number).filter((cab) => cab !== winnerCab));
  const juntados = pax.flatMap((ps, cab) => (juntaCabs.has(cab) ? ps.filter((i) => esPremio.has(i)) : []));
  /** La cabina que se mira junto a la del ganador en la última estación: la otra con premio más lejana, o la misma. */
  const loserCab = [...juntaCabs].reduce((a, c) => (Math.abs(c - winnerCab) > Math.abs(a - winnerCab) ? c : a), winnerCab);
  const slipCab = winnerCab;

  /* El director de emoción elige el arco, y en el teleférico cada arco tiene
     su giro. Siempre pasa algo, pero nunca lo mismo:

     - Susto, la puerta: en la última estación se abre la puerta de la cabina
       de los dos que quedan; el ganador se asoma como para bajarse, y la puerta
       se cierra. El que se baja es uno del grupo, de a uno, como siempre.
     - Duelo, la mordaza: en la última estación la cabina se suelta y resbala
       cable abajo, hasta que la mordaza la agarra y la vuelve a subir.
     - Tapada, el apagón: justo antes de la última estación se corta la luz,
       el convoy frena en el aire y se hamaca a oscuras. Vuelve la luz,
       titilando, y sigue.
     - Remontada, la ráfaga: a mitad de viaje entra un viento que hamaca a
       todas las cabinas y hace flamear las banderas. */
  const puerta = story.arc === "susto" && R >= 1;
  const mordaza = story.arc === "duelo" && R >= 1;
  const apagon = story.arc === "tapada" && R >= 1;
  const rafaga = story.arc === "remontada" || ((story.arc === "susto" || story.arc === "duelo") && !puerta && !mordaza);

  /* ---------------------------------------------------------- estaciones */
  // Una parada por grupo. Con menos paradas que estaciones, las que sobran son
  // de largo. La última parada es siempre la última estación: ahí se bajan de a uno.
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
  // Pesos: viajar a una estación vale 1, una parada 0,8, la última parada lo
  // que tarda bajar a los de a uno (más por cada uno que se baja) y, con la
  // puerta o la mordaza, un poco más por el amague. El apagón se lleva su
  // propio pedazo del viaje.
  const wTravel = 1;
  const wStop = 0.8;
  const deAUnoN = deAUno.length;
  // Si en la última no se baja nadie (dos personas, o el grupo del ganador de
  // dos), la parada no tiene nada que mostrar fuera del giro: con dos personas
  // y la ráfaga eran más de cinco segundos con la pantalla quieta (auditor
  // exigente, 21 de octubre de 2026). Entonces es una parada como las otras,
  // o lo justo para el giro.
  // Con premios en varias cabinas, la última se alarga lo que tardan en pasarse a la cabina anfitriona.
  const wLast = (deAUnoN ? (mordaza ? 2.6 : puerta ? 2.4 : 1.7) + 0.1 * deAUnoN : mordaza ? 1.7 : puerta ? 1.5 : wStop) + (juntados.length ? 0.6 : 0);
  const W_STALL = 1.3;
  let wSum = apagon ? W_STALL : 0;
  for (let k = 1; k <= S; k++) {
    wSum += wTravel;
    const r = stopOf.get(k);
    if (r !== undefined) wSum += r === R - 1 ? wLast : wStop;
  }
  // Los pisos del final (`PISO_ULTIMA` y los demás): cada tramo con piso dura lo
  // que le dan los pesos o su piso, lo que sea más. Los que quedan en su piso
  // salen del reparto, y el resto se reparte de nuevo. Un piso que alcanza a la
  // unidad de ahora la alcanza también a una menor, así que el conjunto solo
  // crece y en pocas vueltas queda quieto.
  const pisoUltima = deAUnoN ? (puerta || mordaza ? PISO_ULTIMA_GIRO : PISO_ULTIMA) + (juntados.length ? PISO_JUNTA : 0) : 0;
  const pisos: [number, number][] = [[wLast, pisoUltima], [wTravel, PISO_VIAJE_FINAL], ...(apagon ? [[W_STALL, PISO_APAGON] as [number, number]] : [])];
  const viaje = T_RUN - T_BOARD;
  let unit = viaje / wSum;
  for (let vuelta = 0, enPiso = 0; vuelta <= pisos.length; vuelta++) {
    let fijo = 0, peso = 0, cuantos = 0;
    for (const [w, piso] of pisos) {
      if (w * unit >= piso) continue;
      fijo += piso;
      peso += w;
      cuantos++;
    }
    if (vuelta > 0 && cuantos === enPiso) break;
    enPiso = cuantos;
    unit = (viaje - fijo) / (wSum - peso);
  }
  const durUltima = Math.max(wLast * unit, pisoUltima);
  const durViajeFinal = Math.max(wTravel * unit, PISO_VIAJE_FINAL);
  const durApagon = apagon ? Math.max(W_STALL * unit, PISO_APAGON) : 0;
  /** Distancia entre estaciones, en unidades de cable. */
  const D = 1;
  const legs: Leg[] = [];
  let tt = T_BOARD;
  let glideFrom = 0;
  let glideT0 = T_BOARD;
  for (let k = 1; k <= S; k++) {
    tt += k === S ? durViajeFinal : wTravel * unit;
    const r = stopOf.get(k);
    if (r === undefined && k < S) continue;
    const span = tt - glideT0;
    if (apagon && k === S) {
      // El apagón, en el tramo que llega a la última estación: frena cuando
      // más rápido va, que es cuando más se nota.
      const lost = durApagon;
      const b = Math.min(0.3, lost * 0.2);
      const b2 = Math.min(0.5, lost * 0.3);
      const stall = { a: glideT0 + span * 0.42, b, b2, dur: lost - b / 2 - b2 / 2 };
      legs.push({ kind: "glide", t0: glideT0, t1: tt + lost, from: glideFrom, to: k * D, span, stall });
      tt += lost;
    } else {
      legs.push({ kind: "glide", t0: glideT0, t1: tt, from: glideFrom, to: k * D, span });
    }
    if (r !== undefined) {
      const dur = r === R - 1 ? durUltima : wStop * unit;
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
    // La última se toma su tiempo: el latido arranca antes que la bajada. Con la
    // puerta, la bajada espera un poco más después de que se cierra (0,68 y no
    // 0,64), para que el "¡se queda!" se alcance a leer antes de quién se baja.
    tOff: L.t0 + (L.t1 - L.t0) * (L.last ? (puerta ? 0.68 : mordaza ? 0.64 : 0.55) : 0.28),
    tDetach: L.t0 + (L.t1 - L.t0) * (L.last ? (puerta || mordaza ? 0.84 : 0.78) : 0.62),
  }));

  /* ------------------------------------------------------------ los giros */
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
   *
   * Y antes de cortarse titila dos veces, en el último cuarto de segundo: los
   * dos parpadeos son el aviso que hace mirar.
   */
  function luzAt(x: number): number {
    if (x < corte) {
      const d = corte - x;
      if (d > 0.24) return 1;
      if (d > 0.19) return 0.3;
      if (d > 0.13) return 1;
      if (d > 0.08) return 0.2;
      return 1;
    }
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
  /**
   * Cuándo pregunta el relator quién llega arriba: en el viaje a la última
   * estación, después de que se bajan los de la bajada grande (y de que vuelve la
   * luz, con el apagón) y antes de la llegada. Infinity si en la última no se baja
   * nadie, porque entonces no hay nada que preguntar.
   */
  const previa = stops.filter((s) => !s.last).at(-1);
  const tPregunta = previa && ult && deAUnoN
    ? Math.max(previa.t1 + 0.1, previa.tOff + 0.6, apagon && vuelve < ult.t0 ? vuelve + 0.6 : -Infinity)
    : Infinity;
  // La ráfaga entra en la mitad del viaje, sembrada, pero no encima de lo que
  // el relator ya tiene que decir: una estación, una pasada de largo, la pregunta.
  if (rafaga) {
    const agenda = [T_BOARD, ...passes.map((p) => p.t), ...stops.flatMap((s) => [s.t0, s.tOff]), ...(Number.isFinite(tPregunta) ? [tPregunta] : [])];
    rafagaT = T_BOARD + (T_RUN - T_BOARD) * (0.36 + rng() * 0.24);
    for (let i = 0; i < 24 && agenda.some((a) => Math.abs(a - rafagaT) < 0.7); i++) rafagaT += 0.2;
    // Con diez cabinas las paradas van tan seguidas que esa búsqueda se queda sin
    // lugar, y la ráfaga caía encima de la pregunta. Entonces va antes de que
    // llegue la bajada grande: lo que sigue es la pregunta y la bajada que decide.
    if (previa && agenda.some((a) => Math.abs(a - rafagaT) < 0.7)) rafagaT = Math.min(rafagaT, previa.t0 - 0.35);
  }

  /**
   * Cuándo los premios de las otras cabinas se pasan a la anfitriona: apenas
   * aterriza en el andén la cara del que se bajó en la última. Infinity si no hay
   * a quién pasar.
   */
  const tJunta = juntados.length && ult ? ult.tOff + JUNTA_ESPERA : Infinity;
  /** Cuándo se suelta cada cabina que se vacía. Infinity si llega arriba. */
  const detachT = pax.map((_, cab) => {
    if (juntaCabs.has(cab)) return tJunta + JUNTA_VUELO + 0.1;
    const r = emptiesAt[cab] ?? R;
    if (cab === winnerCab || r >= R) return Infinity;
    return stops.find((s) => s.round === r)?.tDetach ?? Infinity;
  });

  /**
   * Cuántos quedan a la hora `x`. Baja en cada parada en el mismo instante en
   * que el relator lo dice y los que se bajan dejan su cabina (`tOff`): bajaba
   * 0,35 s de juego después, y en ese rato arriba decía "QUEDAN 11" con "Quedan
   * 7" en la caja (revisión visual, 21 de octubre de 2026).
   */
  function leftAt(x: number): number {
    let m = n;
    for (const s of stops) if (x >= s.tOff) m = left[s.round + 1] as number;
    return m;
  }
  /**
   * Quiénes siguen arriba de una cabina a la hora `x`. Mientras dura la junta, los
   * premios que se pasan van en el aire (`volando`); después, en la anfitriona.
   */
  function aboard(cab: number, x: number): number[] {
    let done_ = -1;
    for (const s of stops) if (x >= s.tOff) done_ = s.round;
    const boarded = x >= T_BOARD ? Infinity : boardedAt(cab, x);
    const van = (pax[cab] ?? []).filter((p, i) => (offAt.get(p) ?? R) > done_ && i < boarded);
    if (x < tJunta) return van;
    if (juntaCabs.has(cab)) return [];
    return cab === winnerCab && x >= tJunta + JUNTA_VUELO ? [...van, ...juntados] : van;
  }
  /** Los premios que van en el aire de su cabina a la anfitriona, a la hora `x`. */
  function volando(x: number): number[] {
    return x >= tJunta && x < tJunta + JUNTA_VUELO ? juntados : [];
  }
  /** Durante el embarque: cuántos pasajeros subió cada cabina, de los de su grupo. */
  function boardedAt(cab: number, x: number): number {
    const size = pax[cab]?.length ?? 0;
    return Math.floor(clamp((x - 0.25) / (T_BOARD - 0.55), 0, 1) * size + 0.001);
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
    n, rank, left, R, C: K, cabinOf, offAt, pax, winnerCab, loserCab, slipCab,
    /** El grupo de cada cabina (0 a K-1): su nombre en `GRUPOS` y su color en `LINES`. */
    groupOfCab, grupos: GRUPOS, surv, deAUno: deAUno.length, nombrado, enteras,
    /** La junta: quiénes se pasan a la cabina anfitriona, desde qué cabinas y a qué hora. */
    juntados, juntaCabs, tJunta,
    story: story as Story, puerta, mordaza, apagon, rafaga,
    S, stopOf, legs, TOP, headAt, stops, passes, detachT,
    corte, quieto, vuelve, luzAt, windAt, rafagaT: () => rafagaT, tPregunta,
    mA, mB, mC, mD, slipAt, puertaA, puertaB, puertaAt,
    leftAt, aboard, volando, slotAt, swingAt,
  };
}
