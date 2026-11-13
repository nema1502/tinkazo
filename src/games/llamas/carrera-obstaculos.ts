import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import type { Plan as PlanFinal } from "./plan";

/**
 * Los obstáculos de la recta, puros: cuatro cosas que le pasan a cualquiera.
 *
 * - **Las piedras del cerro**: caen del cielo delante de una llama, que frena en seco, se sacude y sigue.
 * - **La valla**: una cerca baja que cruzan todas de un salto; alguna la hace mal y pierde un puesto.
 * - **La ráfaga del altiplano**: un golpe de viento que corre a un grupo de carriles hacia afuera y lo desordena.
 * - **La escupida**: una vecina gira la cabeza, carga y escupe a la de al lado, que se sacude y pierde terreno.
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
 * La ventana A (del 18 % al 24 % de la recta) trae valla o remolino en el 60 % de las carreras, y la ventana B (del 42 % al 48 %)
 * trae siempre un obstáculo: piedras o escupida si hubo ventana A, y cualquiera de los cuatro si no. Así la valla y el remolino
 * salen cada uno en el 40 % de las carreras y los dos hechos quedan separados por 2,3 segundos o más.
 *
 * Las ventanas C (del 31 % al 35 %, del 52 % al 55 % y del 61 % al 64 %) traen piedras o escupida, de una sola llama, para que
 * la segunda mitad de la recta no quede callada. La víctima se sortea entre las que todavía no sufrieron un obstáculo ni
 * escupieron: se excluye por los obstáculos de antes, nunca por quién gana. Las de C2 y C3 son cortas (medio cuerpo, todo en
 * unos 3,5 s), así que su efecto termina antes de los tres segundos finales. Cuántas ventanas C hay depende de cuántas corren
 * la final (`CUPO_C`): con pocas llamas, la misma recibiría un golpe tras otro.
 *
 * Todo es función de la ronda y de `q`: saltar o redibujar da lo mismo.
 */

export type TipoObstaculo = "piedras" | "salto" | "viento" | "escupida";

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
  /** En la escupida, qué carril escupe (la vecina de la víctima, que es `carriles[0]`); -1 en los demás. */
  escupe: number;
  /** El tramo de la recta en que se apaga el efecto. */
  ventana: [number, number];
  /** Si es un obstáculo tardío, de pulso corto (ventanas C2 y C3): medio cuerpo y todo en unos 3,5 s. */
  corta: boolean;
}

/** La ventana A: valla o remolino, cuando las llamas todavía están entrando a sus carriles. */
const VENTANA_A: [number, number] = [0.18, 0.24];
/** La ventana B: siempre hay un obstáculo, ya con los carriles formados, y su efecto termina antes de la llegada. */
const VENTANA_B: [number, number] = [0.42, 0.48];
/**
 * Las ventanas C, en orden: siempre piedras o escupida, de una sola llama. Las que empiezan después de la mitad de la recta (C2 y C3) llevan el pulso
 * corto: su efecto termina antes de los tres segundos finales (`carrera-drama.test.ts` lo mide sobre el lugar final, después del tope de aceleración).
 */
export const VENTANAS_C: readonly [number, number][] = [
  [0.31, 0.35],
  [0.52, 0.55],
  [0.61, 0.64],
];
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
/** La piedra y la valla mal hecha: lo que pierden, en cuerpos, y sus tiempos (segundos). Con `V ≤ 0,58` y `a ≤ 0,62` cuerpos por segundo (`carrera-marcha.ts`: lo que queda del tope tras la base). */
const PIEDRA = { A: 0.9, antes: 0.5, sube: 2.9, sostiene: 0.2, baja: 2.9 };
/** Todas pierden un respiro al saltar la valla. */
const SALTA = { A: 0.07, antes: 0.4, sube: 1.8, sostiene: 0, baja: 1.8 };
/** La ráfaga: cuánto corre a cada una hacia un costado (en filas) y cuánto le suma o le resta de avance (en cuerpos). */
const RAFAGA = { filas: 0.3, antes: 0.6, sube: 2.2, sostiene: 0.6, baja: 2.2, avance: { sube: 2.2, baja: 2.2 } };
/** La escupida: lo que pierde quien la recibe (empieza a perder cuando le llega, a los 0,35 s de que sale) y lo poco que pierde quien escupe. */
const ESCUPIDA = { A: 0.7, sube: 2.6, sostiene: 0.2, baja: 2.6 };
const ESCUPE = { A: 0.2, sube: 2.6, sostiene: 0.2, baja: 2.6 };
/**
 * La piedra y la escupida tardías (ventanas C2 y C3): medio cuerpo, que se pierde en 1,6 s y se recupera en 1,6 s. Por la forma del pulso la
 * aceleración llega a 5,77 × A/sube² ≈ 1,13 cuerpos por segundo cada segundo, más de lo que les queda a los obstáculos tras la base: lo que la deja
 * dentro del tope es `conTopeDeAceleracion` (`carrera-tope.ts`), que se pone sobre la suma. Por eso el fin del efecto se mide sobre el lugar final.
 */
const PIEDRA_CORTA = { A: 0.5, antes: 0.3, sube: 1.6, sostiene: 0.1, baja: 1.6 };
const ESCUPIDA_CORTA = { A: 0.5, sube: 1.6, sostiene: 0.1, baja: 1.6 };
const ESCUPE_CORTA = { A: 0.15, sube: 1.6, sostiene: 0.1, baja: 1.6 };
/** Cuánto tarda el escupitajo en ir del hocico de una a la cara de la otra, en segundos. */
export const VUELO_ESCUPIDA = 0.35;
/** Cuánto dura la carga de quien escupe antes de soltar, en segundos. */
export const CARGA_ESCUPIDA = 1;

interface Borrador {
  tipo: TipoObstaculo;
  ventana: [number, number];
  q: number;
  dur: number;
  carriles: number[];
  malas: number[];
  lado: -1 | 1;
  /** En la escupida, qué carril escupe; -1 en los demás. */
  escupe: number;
  /** Para el viento: cuánto pierde o gana cada carril del grupo, en cuerpos, y cuándo le llega (retraso en segundos después de la ráfaga). */
  golpe: { k: number; cuerpos: number; retraso: number }[];
  /** El obstáculo tardío, de pulso corto. */
  corta: boolean;
}

/**
 * Cuándo termina el efecto de las piedras o de la escupida (de quien la recibe y de quien escupe), en segundos del show desde su hora (`q`), según la
 * forma del pulso. El lugar final pasa además por el tope de aceleración, que puede correr un poco ese fin: lo que se ve lo mide `carrera-drama.test.ts`.
 */
export function finDelEfecto(o: { tipo: "piedras" | "escupida"; corta: boolean }): number {
  if (o.tipo === "piedras") {
    const P = o.corta ? PIEDRA_CORTA : PIEDRA;
    return P.sube + P.sostiene + P.baja - P.antes;
  }
  const E = o.corta ? ESCUPIDA_CORTA : ESCUPIDA;
  const S = o.corta ? ESCUPE_CORTA : ESCUPE;
  return VUELO_ESCUPIDA + Math.max(E.sube + E.sostiene + E.baja, S.sube + S.sostiene + S.baja);
}

/**
 * El cupo de ventanas C según cuántas corren la final: con dos o tres, solo C3; de cuatro a seis, C2 y C3; con siete u ocho, las tres. Con pocas
 * llamas la víctima no puede salir distinta de las anteriores: con las tres ventanas, con dos finalistas una misma llama perdía terreno cuatro o cinco
 * veces en la recta en el 21 % de las carreras (contando el remolino y a quien escupe, cuatro golpes o más en el 77 %). Con el cupo, en 600 rondas de
 * 2 a 8 personas, una misma llama pierde terreno cuatro veces en una sola carrera (con cuatro finalistas) y nunca cinco. Se quedan C2 y C3 porque cortan
 * el tramo más largo sin hechos, el que va de la ventana B a la meta.
 */
export function ventanasC(L: number): (readonly [number, number])[] {
  if (L >= 7) return [...VENTANAS_C];
  if (L >= 4) return VENTANAS_C.slice(1);
  return VENTANAS_C.slice(2);
}

/**
 * Hasta dónde de la recta no caen piedras cuando las finalistas llegan tarde a sus carriles (`carrilesTarde`): con tandas y sin nadie más en el
 * grupo, la recta se abre en la salida y el paso de las filas del grupo a los carriles termina pasada la mitad de la recta. Mientras tanto
 * varias van por la misma fila, y las piedras de una le quedarían en el camino a otra. La escupida va de una llama a otra y no tiene ese problema.
 * Con 0,5 quedaban piedras en C2, a mitad del paso: con 80, 130 y 200 personas, en 3 a 5 de cada 28 otra finalista pasaba a menos de 0,2 filas de
 * una de las cinco rocas. Con 0,6 solo C3 trae piedras, con el paso a tres cuartos, y la roca más cercana a otra queda a 0,39 filas o más.
 */
export const PIEDRAS_TARDE_DESDE = 0.6;

/** Sortea los obstáculos de una recta de `L` carriles: tipos, ventanas, a quién y cuándo. Sin mirar a nadie. */
function sortear(L: number, rng: () => number, carrilesTarde: boolean): Borrador[] {
  /** Los tipos que pueden salir en `ventana`: mientras las finalistas no estén cerca de sus carriles, la escupida toma el lugar de las piedras (los demás tipos salen igual de seguido). */
  const tiposEn = (tipos: TipoObstaculo[], ventana: readonly [number, number]): TipoObstaculo[] =>
    carrilesTarde && ventana[0] < PIEDRAS_TARDE_DESDE ? tipos.map((t) => (t === "piedras" ? "escupida" : t)) : tipos;
  const hacer = (tipo: TipoObstaculo, ventana: [number, number], libres?: number[]): Borrador => {
    const largo = tipo === "viento" ? 0.26 : tipo === "piedras" ? 0.2 : 0.08;
    const q = ventana[0] + rng() * (ventana[1] - ventana[0]);
    const b: Borrador = { tipo, ventana, q, dur: largo, carriles: [], malas: [], lado: 1, escupe: -1, golpe: [], corta: false };
    const sorteo = (xs: number[]): number => xs.splice(Math.floor(rng() * xs.length), 1)[0] as number;
    // La víctima sale entre las libres si quedan dos o más; si no, entre todas.
    const todos = libres && libres.length >= 2 ? [...libres] : Array.from({ length: L }, (_, k) => k);
    if (tipo === "piedras") b.carriles = [sorteo(todos)];
    else if (tipo === "escupida") {
      // La víctima sale pareja entre los carriles y quien escupe es una vecina, sorteada sin mirar posiciones ni a nadie.
      b.carriles = [sorteo(todos)];
      const victima = b.carriles[0] as number;
      const vecinas = [victima - 1, victima + 1].filter((k) => k >= 0 && k < L);
      b.escupe = vecinas[Math.floor(rng() * vecinas.length)] as number;
      b.lado = (b.escupe < victima ? -1 : 1) as -1 | 1;
    } else if (tipo === "salto") {
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
  };
  // La ventana A trae valla o remolino en el 60 % de las carreras; la B siempre trae uno, de una sola llama si ya hubo A.
  const borradores: Borrador[] = [];
  if (rng() < 0.6) borradores.push(hacer(rng() < 0.5 ? "salto" : "viento", VENTANA_A));
  const tiposB: TipoObstaculo[] = borradores.length ? ["piedras", "escupida"] : ["piedras", "salto", "viento", "escupida"];
  const tiposBEn = tiposEn(tiposB, VENTANA_B);
  borradores.push(hacer(tiposBEn[Math.floor(rng() * tiposBEn.length)] as TipoObstaculo, VENTANA_B));
  // Las ventanas C: piedras o escupida, a una que todavía no sufrió nada ni escupió. Se excluye por los obstáculos, sin mirar a nadie más.
  const tiposC: TipoObstaculo[] = ["piedras", "escupida"];
  for (const v of ventanasC(L)) {
    const ventana: [number, number] = [v[0], v[1]];
    const usadas = new Set(borradores.flatMap((x) => [...(x.tipo === "salto" ? x.malas : x.carriles), x.escupe]));
    const libres = Array.from({ length: L }, (_, k) => k).filter((k) => !usadas.has(k));
    const tiposCEn = tiposEn(tiposC, ventana);
    const c = hacer(tiposCEn[Math.floor(rng() * tiposCEn.length)] as TipoObstaculo, ventana, libres);
    c.corta = ventana[0] > 0.5;
    borradores.push(c);
  }
  // En el orden de la recta: A, C1, B, C2, C3.
  return borradores.sort((a, b) => a.ventana[0] - b.ventana[0]);
}

/**
 * Le pone los obstáculos a una recta. Devuelve un plan con la misma forma (`PlanFinal`) más lo que hace falta para
 * dibujarlos: `obstaculos`, `lateral` (cuánto se corre cada carril hacia un costado, en filas de carril) y `salto`
 * (cuánto sube, en filas de carril). Con menos de dos carriles devuelve el plan tal cual. Con `carrilesTarde` (las finalistas pasan a sus
 * carriles hasta pasada la mitad de la recta) no hay piedras antes de `PIEDRAS_TARDE_DESDE`. Depende de cuántas corren, nunca de quién gana.
 */
export function conObstaculos(base: PlanFinal, rng: () => number, op: { carrilesTarde?: boolean } = {}): PlanFinal {
  const L = base.lanes.length;
  if (L < 2) return base;
  const borradores = sortear(L, rng, !!op.carrilesTarde);
  const tau = (q: number): number => segundosDeQ(q, base.foto);
  /** La forma de una causa, de 0 a 1, `q` en la recta y `q0` donde llega. */
  const forma = (q: number, q0: number, retraso: number, par: { antes: number; sube: number; sostiene: number; baja: number }): number => pulso(tau(q) - tau(q0) - retraso, 1, par.antes, par.sube, par.sostiene, par.baja);

  // Las posiciones sin la valla: de ahí salen cuándo llega cada una a ella (la valla no cambia cuándo llega, sino cuándo se levanta).
  const efectoSinValla = (k: number, q: number): number => {
    let perdida = 0;
    for (const b of borradores) {
      if (b.tipo === "piedras" && b.carriles[0] === k) {
        const P = b.corta ? PIEDRA_CORTA : PIEDRA;
        perdida += P.A * forma(q, b.q, 0, P);
      } else if (b.tipo === "escupida" && b.carriles[0] === k) {
        const E = b.corta ? ESCUPIDA_CORTA : ESCUPIDA;
        perdida += E.A * forma(q, b.q, VUELO_ESCUPIDA, { antes: 0, sube: E.sube, sostiene: E.sostiene, baja: E.baja });
      } else if (b.tipo === "escupida" && b.escupe === k) {
        const E = b.corta ? ESCUPE_CORTA : ESCUPE;
        perdida += E.A * forma(q, b.q, VUELO_ESCUPIDA, { antes: 0, sube: E.sube, sostiene: E.sostiene, baja: E.baja });
      }
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
    if (b.tipo !== "salto") return { tipo: b.tipo, q: b.q, dur: b.dur, carriles: b.carriles, malas: [], lado: b.lado, valla: 0, llegan: [], ventana: b.ventana, escupe: b.escupe, corta: b.corta };
    const centro = b.q + 0.04;
    const valla = centro;
    const llegan = b.carriles.map((k) => {
      for (let q = Math.max(0, centro - 0.3); q <= 1; q += 0.002) if (visual(sinValla, k, q) >= valla) return q;
      return 1;
    });
    // Las que la hacen mal se sortean entre todas, sin mirar cuándo llegan: elegir las que cruzan dentro de la ventana favorecía a unas (las del
    // medio del pelotón) y la ganadora quedaba con menos tropiezos que el azar (`obstaculo-salta-mal`, auditor de delatores).
    const malas = [...b.malas];
    return { tipo: "salto", q: Math.min(...llegan), dur: b.dur, carriles: b.carriles, malas, lado: b.lado, valla, llegan, ventana: b.ventana, escupe: -1, corta: false };
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

  const beatOf = (k: number, q: number): { kind: string; p: number; giro?: number } | null => {
    for (const o of obstaculos) {
      if (o.tipo === "piedras" && o.carriles[0] === k && q >= o.q && q < o.q + o.dur) return { kind: "piedra", p: (q - o.q) / o.dur };
      if (o.tipo === "viento" && o.carriles.includes(k) && q >= o.q - 0.01 && q < o.q + o.dur * 1.5) return { kind: "ventarron", p: (q - o.q + 0.01) / (o.dur * 1.5 + 0.01) };
      if (o.tipo === "escupida") {
        // Los tiempos son de la hora del show: quien escupe carga un segundo, el escupitajo vuela 0,35 s y quien lo recibe se sacude hasta los 1,2 s de que salió.
        const s = tau(q) - tau(o.q);
        if (o.escupe === k && s >= -CARGA_ESCUPIDA && s < VUELO_ESCUPIDA) return { kind: "escupe", p: (s + CARGA_ESCUPIDA) / (CARGA_ESCUPIDA + VUELO_ESCUPIDA), giro: (o.carriles[0] as number) > k ? 1 : -1 };
        if (o.carriles[0] === k && s >= VUELO_ESCUPIDA && s < 1.2) return { kind: "escupido", p: (s - VUELO_ESCUPIDA) / (1.2 - VUELO_ESCUPIDA) };
      }
    }
    const c = cruzando(k, q);
    if (c) return { kind: c.o.malas.includes(k) ? "malsalto" : "salto", p: c.p };
    return base.beatOf(k, q);
  };

  return { ...base, pos, beatOf, obstaculos, lateral, salto };
}
