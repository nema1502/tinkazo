/**
 * Ruleta: cómo gira la rueda, en un módulo puro (sin Pixi ni DOM) para probarlo
 * en Node. No decide nada: el gajo que gana ya está fijado (`landing`, dentro
 * del gajo del ganador) y esto solo dice por dónde pasa la flecha a cada hora.
 *
 * Hasta el 21 de octubre de 2026 la rueda frenaba siempre igual: al empezar el
 * último tramo le quedaban unos seis gajos, y después de trabarse avanzaba uno
 * y medio, o uno justo después de la parada falsa. El auditor de delatores lo
 * medía: ganaba el gajo siguiente al último que nombraba el relator en 166 de
 * 200 semillas, y el nombrado en la parada falsa no ganaba nunca. Ahora sale de
 * la semilla, sin tocar quién gana:
 *
 * - cuánto le falta al empezar el último tramo (`L`, desde `T_CREEP`): un
 *   número cualquiera de gajos dentro de una vuelta entera de nombres, así el
 *   gajo que está bajo la flecha en ese momento no dice nada de cuál gana;
 * - cuánto avanza después de trabarse (`T_HOLD`): la mitad de las veces se
 *   queda en ese gajo, y si no pasa al siguiente o, más raro, al otro;
 * - en la parada falsa, si se queda en el gajo nombrado o se destraba y avanza
 *   uno o dos.
 *
 * Arranca y gira a fondo como siempre; frena, y desde `T_CREEP` se arrastra sin
 * cortes, cada vez más despacio, hasta trabarse del todo en `T_LOCK`. Con la
 * parada falsa se para en `T_HOLD`, queda quieta y después se destraba (o
 * tiembla y se queda). Lo que hace falta para que la flecha caiga justo donde
 * tiene que caer se agrega o se quita mientras gira a fondo, que es cuando no
 * se nota: así los tramos del final recorren exactamente lo que dice la semilla.
 * Antes la curva entera se estiraba o se encogía, y al trabarse en `T_HOLD` la
 * rueda casi paraba y volvía a acelerar para el empujón de la paleta.
 */
import { FALSA, T_BRAKE, T_CREEP, T_HOLD, T_LOCK, T_SPIN, T_WIND } from "./wheel-beats";

/** Velocidad a fondo, en gajos por segundo. */
export const W0 = 38.4;
/** Lo mínimo que le falta a la rueda al empezar el último tramo, en gajos. */
export const L_MIN = 5;
/** La forma del arrastre hasta la parada falsa: la velocidad baja como (1 - x) a esta potencia. */
const Q0 = 1.6;
/** Sin parada falsa, la forma del arrastre va entre estas dos: con 1 baja parejo; con 3,5, frena pronto y se arrastra mucho. */
const Q_MIN = 1;
const Q_MAX = 3.5;
/** En la parada falsa que se queda, la rueda tiembla apenas, sin salir del gajo. */
export const TIEMBLA = 0.06;

export interface WheelMotion {
  /** Gajos recorridos desde el arranque hasta la hora `t`. */
  pos(t: number): number;
  /** Gajos por segundo a la hora `t`. */
  speed(t: number): number;
  /** Lo recorrido hasta trabarse del todo: `pos(T_LOCK)`. */
  total: number;
  /** Lo que le falta recorrer al empezar el último tramo (`T_CREEP`). */
  L: number;
  /** Lo que avanza después de `T_HOLD`. */
  despues: number;
  /** Cuántos gajos avanza después de `T_HOLD`: 0 si gana el gajo en que se trabó. */
  gajosDespues: number;
  /** En la parada falsa: si se queda en el gajo nombrado. */
  seQueda: boolean;
}

export interface WheelMotionInput {
  /** Cuántos gajos tiene la rueda. */
  segs: number;
  /** Cada cuántos gajos se repite una persona (o un grupo): una vuelta entera de nombres. */
  ciclo: number;
  /** Dónde está la flecha al arrancar, en gajos. */
  startSeg: number;
  /** Dónde para la flecha, en gajos: dentro del gajo que gana, nunca en su borde. */
  landing: number;
  /** El arco "susto": la parada falsa. */
  falsa: boolean;
  rng: () => number;
}

/**
 * Lo que avanza después de `T_HOLD`, para que gane el gajo `k` lugares más
 * allá del que está bajo la flecha en ese momento. `u` es dónde cae la flecha
 * dentro del gajo que gana, y la flecha queda en `T_HOLD` entre `s0` y `s1` de
 * su gajo (lejos del borde). Para k = 0, lo que entra antes de `u`.
 */
function avance(k: number, u: number, x: number, s0: number, s1: number): number {
  if (k === 0) return 0.04 + Math.max(0, u - 0.08 - 0.04) * x;
  return k + u - (s0 + (s1 - s0) * x);
}

export function planWheelMotion(o: WheelMotionInput): WheelMotion {
  const { segs, rng, falsa } = o;
  const ciclo = Math.max(1, Math.round(o.ciclo));
  // Una vuelta entera de nombres, o varias si son pocos: con dos personas, ocho gajos.
  const span = ciclo * Math.ceil(8 / ciclo);
  const L = L_MIN + span * rng();
  /** Dónde cae la flecha dentro de su gajo, de 0 a 1. */
  const u = ((o.landing % 1) + 1) % 1;
  const Dc = (falsa ? T_HOLD : T_LOCK) - T_CREEP;
  /** Qué fracción del arrastre queda para después de `T_HOLD` en el tiempo (sin parada falsa). */
  const resto = 1 - (T_HOLD - T_CREEP) / (T_LOCK - T_CREEP);

  let despues: number;
  let seQueda = false;
  let q: number;
  if (falsa) {
    // La parada falsa: se queda en el gajo nombrado, o se destraba y avanza
    // uno o dos. Lo que avanza no pasa de dos gajos.
    const r = rng();
    const k = r < 0.35 ? 0 : r < 0.8 || u > 0.75 ? 1 : 2;
    seQueda = k === 0;
    despues = seQueda ? TIEMBLA : avance(k, u, rng(), k === 2 ? Math.max(0.15, u + 0.05) : 0.15, 0.85);
    q = Q0;
  } else {
    // Sin parada falsa, la rueda llega a trabarse y se sigue arrastrando: la
    // mitad de las veces se queda en ese gajo, y si no pasa al siguiente o,
    // más raro, al otro. Lo que puede avanzar depende de cuánto le faltaba:
    // con la forma más pareja del arrastre, como mucho un octavo de eso.
    const r = rng();
    const x = rng();
    const tope = L * resto ** (Q_MIN + 1);
    const piso = L * resto ** (Q_MAX + 1);
    let k = r < 0.5 ? 0 : r < 0.9 ? 1 : 2;
    while (k > 0 && avance(k, u, 1, 0.12, 0.88) > tope) k--;
    despues = Math.min(tope, Math.max(piso, avance(k, u, x, 0.12, Math.min(0.88, k + u - piso))));
    // La forma del arrastre que deja justo eso para después de `T_HOLD`.
    q = Math.log(L / despues) / Math.log(1 / resto) - 1;
  }
  /** Lo que recorre arrastrándose desde `T_CREEP`. */
  const C = falsa ? L - despues : L;
  const vc = ((q + 1) * C) / Dc;
  // El frenado, de `W0` a `vc`, termina con la misma pendiente con que arranca
  // el arrastre: sin quiebre.
  const Db = T_CREEP - T_BRAKE;
  const sigma = Math.min(3, ((q * vc) / Dc) * (Db / (W0 - vc)));
  const h = (x: number): number => (2 - sigma) * x ** 3 + (sigma - 3) * x ** 2 + 1;
  const H = (x: number): number => ((2 - sigma) * x ** 4) / 4 + ((sigma - 3) * x ** 3) / 3 + x;
  const Ds = T_SPIN - T_WIND;
  const Df = T_BRAKE - T_SPIN;
  const S_SPIN = (W0 * Ds) / 3.2;
  const S_BRAKE = Db * (vc + (W0 - vc) * H(1));
  // Lo que falta (o sobra) para caer en `landing`, menos de media vuelta, va
  // mientras gira a fondo: una joroba de velocidad que empieza y termina en W0.
  const sinAjuste = S_SPIN + W0 * Df + S_BRAKE + L;
  const falta = o.landing - o.startSeg - sinAjuste;
  const delta = falta - Math.round(falta / segs) * segs;
  const extra = (2 * delta) / Df;

  const S_FULL = S_SPIN + W0 * Df + delta;
  const a = T_HOLD + FALSA;
  const d = T_LOCK - a;
  const arrastre = (t: number): number => C * (1 - (1 - Math.min(1, (t - T_CREEP) / Dc)) ** (q + 1));
  const pos = (t: number): number => {
    if (t <= T_WIND) return 0;
    if (t < T_SPIN) return S_SPIN * ((t - T_WIND) / Ds) ** 3.2;
    if (t < T_BRAKE) {
      const y = (t - T_SPIN) / Df;
      return S_SPIN + W0 * (t - T_SPIN) + (extra * Df * (y - Math.sin(2 * Math.PI * y) / (2 * Math.PI))) / 2;
    }
    if (t <= T_CREEP) return S_FULL + Db * (vc * ((t - T_BRAKE) / Db) + (W0 - vc) * H((t - T_BRAKE) / Db));
    const base = S_FULL + S_BRAKE;
    if (!falsa || t <= T_HOLD) return base + arrastre(t);
    // La parada falsa: quieta, y después se destraba (o tiembla).
    if (t <= a) return base + C;
    if (t >= T_LOCK) return base + L;
    return base + C + (despues / 2) * (1 - Math.cos((Math.PI * (t - a)) / d));
  };
  const speed = (t: number): number => {
    if (t <= T_WIND) return 0;
    if (t < T_SPIN) return W0 * ((t - T_WIND) / Ds) ** 2.2;
    if (t < T_BRAKE) return W0 + extra * Math.sin((Math.PI * (t - T_SPIN)) / Df) ** 2;
    if (t <= T_CREEP) return vc + (W0 - vc) * h((t - T_BRAKE) / Db);
    if (t < T_CREEP + Dc) return vc * (1 - (t - T_CREEP) / Dc) ** q;
    if (!falsa || t <= a || t >= T_LOCK) return 0;
    return ((Math.PI * despues) / (2 * d)) * Math.sin((Math.PI * (t - a)) / d);
  };
  const gajosDespues = Math.floor(o.landing) - Math.floor(o.landing - despues);
  return { pos, speed, total: S_FULL + S_BRAKE + L, L, despues, gajosDespues, seQueda };
}
