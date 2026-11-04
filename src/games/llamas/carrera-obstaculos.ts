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
 * se recupera: cada efecto se apaga solo y, además, una máscara lo anula antes
 * de los puntos donde el plan base sortea el puesto de la ganadora (el 25, el
 * 50 y el 75 %) y de la llegada, así que lo parejo de esos puestos, la meta y la
 * foto siguen siendo los de siempre. Quién se echa, quién llega y el protocolo
 * no cambian.
 *
 * Tres ventanas entre los puntos de control (A, B, C) y una en el cierre (D).
 * Cada carrera tiene uno, dos o tres obstáculos (20, 50 y 30 %), cada uno de
 * un tipo distinto, en ventanas distintas y en orden de ventana.
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

/** Las ventanas: entre los puntos de control del plan base. Cada efecto vale cero antes de `a` y 0,025 después de `b`. */
const VENTANAS: [number, number][] = [[0.09, 0.205], [0.28, 0.445], [0.53, 0.695], [0.77, 0.875]];
const BORDE = 0.025;
/** Media anchura de la valla en la pista visual (cuánto antes empieza el salto y cuánto después termina). */
export const SALTO_MEDIO = 0.022;

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};
const entre = (rng: () => number, a: number, b: number): number => a + (b - a) * rng();
const enVentana = (q: number, [a, b]: [number, number]): number => suave((q - a) / BORDE) * (1 - suave((q - b) / BORDE));

/** Cuántos obstáculos tiene una recta de `L` carriles. */
export const cuantosObstaculos = (rng: () => number): number => {
  const r = rng();
  return r < 0.2 ? 1 : r < 0.7 ? 2 : 3;
};

interface Borrador {
  tipo: TipoObstaculo;
  ventana: [number, number];
  q: number;
  dur: number;
  carriles: number[];
  malas: number[];
  lado: -1 | 1;
  /** Para el viento: cuánto pierde o gana cada carril del grupo, en cuerpos, y cuándo (retraso en la ráfaga, de 0 a 1). */
  golpe: { k: number; cuerpos: number; retraso: number }[];
}

/** Sortea los obstáculos de una recta de `L` carriles: tipos, ventanas, a quién y cuándo. Sin mirar a nadie. */
function sortear(L: number, rng: () => number): Borrador[] {
  const n = Math.min(3, cuantosObstaculos(rng));
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
  // La valla no va en el cierre (ventana D): ahí las que la cruzan en la ventana son las rezagadas, y la prueba sería de las de atrás.
  const dePaso = elegidas.findIndex((vi, i) => vi === 3 && tipos[i] === "salto");
  if (dePaso >= 0) {
    const otro = tipos.findIndex((t, i) => i < n && i !== dePaso && t !== "salto");
    if (otro >= 0) [tipos[dePaso], tipos[otro]] = [tipos[otro] as TipoObstaculo, tipos[dePaso] as TipoObstaculo];
    else elegidas[dePaso] = [0, 1, 2].find((x) => !elegidas.includes(x)) ?? 1;
    elegidas.sort((a, b) => a - b);
  }
  return elegidas.map((vi, i): Borrador => {
    const tipo = (tipos[i] === "salto" && vi === 3 ? "piedras" : tipos[i]) as TipoObstaculo;
    const ventana = VENTANAS[vi] as [number, number];
    const largo = tipo === "viento" ? 0.075 : tipo === "piedras" ? 0.1 : 0.08;
    const q = ventana[0] + 0.005 + rng() * Math.max(0, ventana[1] - ventana[0] - largo - 0.005);
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
      b.golpe = b.carriles.map((k) => ({ k, cuerpos: entre(rng, -1.0, 2.8), retraso: rng() * 0.35 }));
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

  /** Cuánto retrasa el golpe de las piedras a quien cae: se frena en seco y se recupera despacio. */
  const piedra = (q: number, q0: number): number => suave((q - q0) / 0.012) * (1 - suave((q - q0 - 0.03) / 0.07));

  // Las posiciones sin la valla: de ahí salen cuándo llega cada una a ella (la valla no cambia cuándo llega, sino cuándo se levanta).
  const efectoSinValla = (k: number, q: number): number => {
    let perdida = 0;
    for (const b of borradores) {
      if (b.tipo === "piedras" && b.carriles[0] === k) perdida += 3.6 * piedra(q, b.q) * enVentana(q, b.ventana);
      else if (b.tipo === "viento") {
        const g = b.golpe.find((x) => x.k === k);
        if (g) {
          const x = (q - b.q - g.retraso * b.dur) / (b.dur * 1.4);
          if (x > 0 && x < 1) perdida += g.cuerpos * Math.sin(Math.PI * x) ** 2 * enVentana(q, b.ventana);
        }
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
      const mala = o.malas.includes(k);
      // Todas pierden un respiro al saltar; la que lo hace mal, un puesto.
      const dura = mala ? 2.8 : 0.35;
      perdida += dura * suave((q - qa) / 0.015) * (1 - suave((q - qa - 0.02) / (mala ? 0.07 : 0.04))) * enVentana(q, o.ventana);
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

  const lateral = (k: number, q: number): number => {
    let l = 0;
    for (const o of obstaculos) {
      if (o.tipo !== "viento" || !o.carriles.includes(k)) continue;
      const x = (q - o.q + 0.012) / (o.dur * 1.6);
      if (x <= 0 || x >= 1) continue;
      // Sube rápido, aguanta y vuelve despacio.
      const perfil = x < 0.2 ? suave(x / 0.2) : x < 0.55 ? 1 : 1 - suave((x - 0.55) / 0.45);
      l += o.lado * 0.95 * perfil;
    }
    return l;
  };

  const beatOf = (k: number, q: number): { kind: string; p: number } | null => {
    for (const o of obstaculos) {
      if (o.tipo === "piedras" && o.carriles[0] === k && q >= o.q && q < o.q + 0.075) return { kind: "piedra", p: (q - o.q) / 0.075 };
      if (o.tipo === "viento" && o.carriles.includes(k) && q >= o.q - 0.01 && q < o.q + o.dur * 1.5) return { kind: "ventarron", p: (q - o.q + 0.01) / (o.dur * 1.5 + 0.01) };
    }
    const c = cruzando(k, q);
    if (c) return { kind: c.o.malas.includes(k) ? "malsalto" : "salto", p: c.p };
    return base.beatOf(k, q);
  };

  return { ...base, pos, beatOf, obstaculos, lateral, salto };
}
