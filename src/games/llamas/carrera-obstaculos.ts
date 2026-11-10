import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import type { Plan as PlanFinal } from "./plan";

/**
 * Los obstáculos de la recta, puros: tres cosas que le pasan a cualquiera.
 *
 * - **Las piedras del cerro**: caen del cielo delante de una llama, que frena en seco, se sacude y sigue.
 * - **La valla**: una cerca baja que cruzan todas de un salto; alguna la hace mal y pierde un puesto.
 * - **La ráfaga del altiplano**: un golpe de viento que corre a un grupo de carriles hacia afuera y lo desordena.
 *
 * Son eventos del plan: salen de un azar aparte (`ctx.azar("carrera:obstaculos")`)
 * y **no miran quién gana**. Le tocan a cualquiera, también a la ganadora, que
 * se recupera: cada efecto se apaga solo. Antes de la llegada no hay obstáculos,
 * así que la meta y la foto siguen siendo las de siempre. Quién se echa, quién
 * llega y el protocolo no cambian.
 *
 * **Con tacto** (`carrera-marcha.ts`): ningún efecto es un salto de lugar. Cada uno es
 * una curva suave en segundos: la llama lo ve venir y reacciona medio segundo antes de que
 * llegue la piedra o la valla (frena, inclina), pierde unos cuerpos de a poco y se recupera
 * en dos o tres segundos, con la velocidad y la aceleración dentro de los topes de una causa.
 * Cada obstáculo es una causa anotada en el guion (`Datos.causas`).
 *
 * Una o dos ventanas en la parte pareja de la recta, antes del 46 % (A y B). Cada carrera tiene uno o dos
 * obstáculos (30 y 70 %), de tipos distintos y en orden de ventana.
 *
 * Todo es función de la ronda y de `q`: saltar o redibujar da lo mismo.
 */

export type TipoObstaculo = "piedras" | "salto" | "viento";

/** Cuánto se ensanchan en la pantalla las diferencias entre carriles (`carrera.ts` las dibuja así). */
export const ENSANCHE = 1.7;
/** Un cuerpo de llama, en fracción de la recta. */
const CUERPO = 0.0115;

export interface Obstaculo {
  tipo: TipoObstaculo;
  /** Cuándo empieza (piedras y viento) o cuándo llega la primera a la valla, en fracción de la recta. */
  q: number;
  /** Cuánto dura el efecto, en fracción de la recta. */
  dur: number;
  /** Las que lo sufren: una (piedras), un grupo contiguo (viento) o todas (valla). */
  carriles: number[];
  /** En la valla, las que la hacen mal. */
  malas: number[];
  /** En la ráfaga, hacia dónde las corre: -1 hacia arriba de la pantalla, 1 hacia abajo. */
  lado: -1 | 1;
  /** En la valla, dónde está, en la coordenada visual de la pista (`q + ENSANCHE * (pos - q)`). */
  valla: number;
  /** En la valla, cuándo llega cada carril a ella (fracción de la recta), por carril. */
  llegan: number[];
  /** El tramo de la recta en que se apaga el efecto. */
  ventana: [number, number];
}

/** Las ventanas donde puede empezar cada obstáculo (en fracción de la recta): lo bastante separadas para que un efecto de unos seis segundos no pise al siguiente. */
const VENTANAS: [number, number][] = [[0.08, 0.26], [0.36, 0.46]];
/** Media anchura de la valla en la pista visual (cuánto antes empieza el salto y cuánto después termina). */
export const SALTO_MEDIO = 0.022;

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * x * (x * (6 * x - 15) + 10);
};
const entre = (rng: () => number, a: number, b: number): number => a + (b - a) * rng();

/**
 * Una pérdida de lugar con tacto: `A` cuerpos que se pierden de a poco (`sube` segundos, empezando `antes` segundos antes de que llegue el
 * obstáculo) y se recuperan de a poco (`baja` segundos), `s` segundos después de la llegada. Quinto grado: continua en la velocidad y la aceleración.
 */
const pulso = (s: number, _A: number, antes: number, sube: number, sostiene: number, baja: number): number => suave((s + antes) / sube) * (1 - suave((s + antes - sube - sostiene) / baja));
/** La piedra y la valla mal hecha: lo que pierden, en cuerpos, y sus tiempos (segundos). Con `V ≤ 0,77` y `a ≤ 0,66` cuerpos por segundo (`carrera-marcha.ts`: lo que queda del tope tras la base). */
const PIEDRA = { A: 0.6, antes: 0.5, sube: 2.6, sostiene: 0.2, baja: 2.6 };
/** Todas pierden un respiro al saltar la valla. */
const SALTA = { A: 0.07, antes: 0.4, sube: 1.8, sostiene: 0, baja: 1.8 };
/** La ráfaga: cuánto corre a cada una hacia un costado (en filas) y cuánto le suma o le resta de avance (en cuerpos). */
const RAFAGA = { filas: 0.3, antes: 0.6, sube: 2.2, sostiene: 0.6, baja: 2.2, avance: { sube: 2.2, baja: 2.2 } };

/** Cuántos obstáculos tiene una recta de `L` carriles. */
export const cuantosObstaculos = (rng: () => number): number => (rng() < 0.3 ? 1 : 2);

interface Borrador {
  tipo: TipoObstaculo;
  ventana: [number, number];
  q: number;
  dur: number;
  carriles: number[];
  malas: number[];
  lado: -1 | 1;
  /** Para el viento: cuánto pierde o gana cada carril del grupo, en cuerpos, y cuándo le llega (retraso en segundos después de la ráfaga). */
  golpe: { k: number; cuerpos: number; retraso: number }[];
}

/** Sortea los obstáculos de una recta de `L` carriles: tipos, ventanas, a quién y cuándo. Sin mirar a nadie. */
function sortear(L: number, rng: () => number): Borrador[] {
  const n = Math.min(VENTANAS.length, cuantosObstaculos(rng));
  const tipos: TipoObstaculo[] = ["piedras", "salto", "viento"];
  for (let i = tipos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tipos[i], tipos[j]] = [tipos[j] as TipoObstaculo, tipos[i] as TipoObstaculo];
  }
  const vent = VENTANAS.map((_, i) => i);
  for (let i = vent.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [vent[i], vent[j]] = [vent[j] as number, vent[i] as number];
  }
  const elegidas = vent.slice(0, n).sort((a, b) => a - b);
  return elegidas.map((vi, i): Borrador => {
    const tipo = tipos[i] as TipoObstaculo;
    const ventana = VENTANAS[vi] as [number, number];
    const largo = tipo === "viento" ? 0.26 : tipo === "piedras" ? 0.2 : 0.08;
    const q = ventana[0] + rng() * (ventana[1] - ventana[0]);
    const b: Borrador = { tipo, ventana, q, dur: largo, carriles: [], malas: [], lado: 1, golpe: [] };
    const sorteo = (xs: number[]): number => xs.splice(Math.floor(rng() * xs.length), 1)[0] as number;
    const todos = Array.from({ length: L }, (_, k) => k);
    if (tipo === "piedras") b.carriles = [sorteo(todos)];
    else if (tipo === "salto") {
      b.carriles = [...todos];
      const m = Math.min(L, 1 + (rng() < 0.4 ? 1 : 0));
      b.malas = Array.from({ length: m }, () => sorteo(todos)).sort((x, y) => x - y);
    } else {
      const g = Math.min(L, 2 + Math.floor(rng() * 3));
      const desde = Math.floor(rng() * (L - g + 1));
      b.carriles = Array.from({ length: g }, (_, j) => desde + j);
      b.lado = desde + (g - 1) / 2 < (L - 1) / 2 ? -1 : 1;
      // La ráfaga desordena: a unas las frena, a otras las empuja, cada una a su hora.
      b.golpe = b.carriles.map((k) => ({ k, cuerpos: entre(rng, -0.2, 0.25), retraso: rng() * 0.6 }));
    }
    return b;
  });
}

/**
 * Le pone los obstáculos a una recta. Devuelve un plan con la misma forma (`PlanFinal`) más lo que hace falta para
 * dibujarlos: `obstaculos`, `lateral` (cuánto se corre cada carril hacia un costado, en filas de carril) y `salto`
 * (cuánto sube, en filas de carril). Con menos de dos carriles devuelve el plan tal cual.
 */
export function conObstaculos(base: PlanFinal, rng: () => number): PlanFinal {
  const L = base.lanes.length;
  if (L < 2) return base;
  const borradores = sortear(L, rng);
  const tau = (q: number): number => segundosDeQ(q, base.foto);
  /** La forma de una causa, de 0 a 1, `q` en la recta y `q0` donde llega. */
  const forma = (q: number, q0: number, retraso: number, par: { antes: number; sube: number; sostiene: number; baja: number }): number => pulso(tau(q) - tau(q0) - retraso, 1, par.antes, par.sube, par.sostiene, par.baja);

  // Las posiciones sin la valla: de ahí salen cuándo llega cada una a ella (la valla no cambia cuándo llega, sino cuándo se levanta).
  const efectoSinValla = (k: number, q: number): number => {
    let perdida = 0;
    for (const b of borradores) {
      if (b.tipo === "piedras" && b.carriles[0] === k) perdida += PIEDRA.A * forma(q, b.q, 0, PIEDRA);
      else if (b.tipo === "viento") {
        const g = b.golpe.find((x) => x.k === k);
        if (g) perdida += g.cuerpos * forma(q, b.q, g.retraso, { antes: RAFAGA.antes, sube: RAFAGA.avance.sube, sostiene: 0, baja: RAFAGA.avance.baja });
      }
    }
    return perdida * CUERPO;
  };
  const sinValla = (k: number, q: number): number => base.pos(k, q) - efectoSinValla(k, q);
  const visual = (f: (k: number, q: number) => number, k: number, q: number): number => q + ENSANCHE * (f(k, q) - q);

  // La valla: en la coordenada visual donde una llama del medio del pelotón llega a `b.q`; cada una llega cuando su coordenada la cruza.
  const obstaculos: Obstaculo[] = borradores.map((b): Obstaculo => {
    if (b.tipo !== "salto") return { tipo: b.tipo, q: b.q, dur: b.dur, carriles: b.carriles, malas: [], lado: b.lado, valla: 0, llegan: [], ventana: b.ventana };
    const centro = b.q + 0.04;
    const valla = centro;
    const llegan = b.carriles.map((k) => {
      for (let q = Math.max(0, centro - 0.3); q <= 1; q += 0.002) if (visual(sinValla, k, q) >= valla) return q;
      return 1;
    });
    // Las que la hacen mal se sortean entre todas, sin mirar cuándo llegan: elegir las que cruzan dentro de la ventana favorecía a unas (las del
    // medio del pelotón) y la ganadora quedaba con menos tropiezos que el azar (`obstaculo-salta-mal`, auditor de delatores).
    const malas = [...b.malas];
    return { tipo: "salto", q: Math.min(...llegan), dur: b.dur, carriles: b.carriles, malas, lado: b.lado, valla, llegan, ventana: b.ventana };
  });

  const perdidaValla = (k: number, q: number): number => {
    let perdida = 0;
    for (const o of obstaculos) {
      if (o.tipo !== "salto") continue;
      const qa = o.llegan[k] as number;
      // La que llega a la valla pegada a la meta no la sufre: el efecto dura siete segundos y la llegada no se toca.
      if (tau(1) - tau(qa) < 7) continue;
      // Todas pierden un respiro al saltar; la que lo hace mal, lo que una piedra.
      if (o.malas.includes(k)) perdida += PIEDRA.A * forma(q, qa, 0, PIEDRA);
      else perdida += SALTA.A * forma(q, qa, 0, SALTA);
    }
    return perdida * CUERPO;
  };
  const pos = (k: number, q: number): number => sinValla(k, q) - perdidaValla(k, q);

  /** La valla que cruza `k` en `q`, si está sobre ella: su coordenada visual y el avance del salto (0 a 1). */
  const cruzando = (k: number, q: number): { o: Obstaculo; p: number } | null => {
    for (const o of obstaculos) {
      if (o.tipo !== "salto") continue;
      const v = visual(pos, k, q);
      const p = (v - (o.valla - SALTO_MEDIO)) / (2 * SALTO_MEDIO);
      if (p > 0 && p < 1) return { o, p };
    }
    return null;
  };

  const salto = (k: number, q: number): number => {
    const c = cruzando(k, q);
    if (!c) return 0;
    return (c.o.malas.includes(k) ? 0.3 : 0.62) * Math.sin(Math.PI * c.p);
  };

  /** El costado de la ráfaga: corre a cada una media fila, de a poco (sube en 2,4 s, aguanta uno, vuelve en 2,4). */
  const lateral = (k: number, q: number): number => {
    let l = 0;
    for (const o of obstaculos) {
      if (o.tipo !== "viento" || !o.carriles.includes(k)) continue;
      l += o.lado * RAFAGA.filas * forma(q, o.q, 0, RAFAGA);
    }
    return l;
  };

  const beatOf = (k: number, q: number): { kind: string; p: number } | null => {
    for (const o of obstaculos) {
      if (o.tipo === "piedras" && o.carriles[0] === k && q >= o.q && q < o.q + o.dur) return { kind: "piedra", p: (q - o.q) / o.dur };
      if (o.tipo === "viento" && o.carriles.includes(k) && q >= o.q - 0.01 && q < o.q + o.dur * 1.5) return { kind: "ventarron", p: (q - o.q + 0.01) / (o.dur * 1.5 + 0.01) };
    }
    const c = cruzando(k, q);
    if (c) return { kind: c.o.malas.includes(k) ? "malsalto" : "salto", p: c.p };
    return base.beatOf(k, q);
  };

  return { ...base, pos, beatOf, obstaculos, lateral, salto };
}
