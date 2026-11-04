import type { Plan as PlanFinal } from "./plan";

/**
 * El cierre de la recta, puro: cómo se decide la carrera en el último tramo.
 *
 * Hasta el 75 % la recta es la de `planRace` (los puestos de la ganadora se
 * sortean parejos y se cumplen). Lo que se vio medido (`scripts/medir-drama-carrera.mjs`):
 * del 75 al 100 % la ganadora quedaba en el podio el 100 % de las veces al 90 %,
 * y primera o segunda siempre, porque la historia mandaba a todas las demás
 * atrás. La sala lo aprende: quien va ahí gana. Ahora el último tramo (del 76
 * al 98,5 %) tiene tres formas, repartidas por la ronda:
 *
 * - **la remontada**: la ganadora viene atrás hasta el 90 % o más y pasa en los
 *   últimos metros, después de que otras dos o tres se hayan pasado la punta;
 * - **la disputa**: dos o tres cambios de punta en la recta final, y la
 *   ganadora la toma y la pierde antes de quedársela;
 * - **la que aguanta**: la ganadora toma la punta temprano y alguien se le pega
 *   al final, a menos de un cuerpo, pero no la pasa.
 *
 * Nada de esto decide quién gana ni le da un lugar: la ganadora es la que fija
 * el protocolo y llega primera, como siempre (el cierre vuelve al plan base
 * antes de la meta, así que la llegada y la foto del duelo no cambian). Y la
 * forma sale del arco y de un azar aparte, sin mirar a la ganadora más que
 * para ponerla en el tramo: las otras dos o tres de la pelea se sortean entre
 * todas, y la ganadora es una más con los mismos movimientos (la que toma la
 * punta primero puede ser cualquiera).
 *
 * Todo es función de la ronda y de `q`: saltar o redibujar da lo mismo.
 */

export type FormaCierre = "remontada" | "disputa" | "aguanta";

/** Un cuerpo de llama, en fracción de la recta (`carrera-recta.ts`). */
const CUERPO = 0.0115;
/** Desde dónde se mezcla con el plan base, dónde llega entero, dónde empieza a volver y dónde termina de volver. */
const DESDE = 0.752;
const PLENA = 0.805;
const BAJA = 0.975;
const HASTA = 0.995;
/** El ancho de un cruce (de una a otra en la punta), en fracción de la recta: medio segundo con la recta de 15 s. */
const CRUCE = 0.04;
/** Cuántos cuerpos sobre la línea queda la que va primera, y cuántos las que van atrás (cada una el suyo). */
const ADELANTE = 0.8;

/**
 * La compensación de la mitad: en la recta de siempre, entre los puntos donde se sortea el puesto de la ganadora, la que iba
 * adelante en el susto y el duelo se pasaba de largo y llevaba la punta más que cualquiera (el doble en esos tramos). Acá se
 * la frena un poco, solo cuando va primera o casi, y siempre vuelve a cero en el punto de control: lo parejo de esos puestos
 * queda exacto. Cada tramo: desde, hasta y cuántos cuerpos. Medido con `scripts/medir-drama-carrera.mjs`.
 */
const COMPENSA: [number, number, number][] = [[0.07, 0.25, 1.3], [0.38, 0.5, 0.8], [0.5, 0.62, 0.8]];

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};
const entre = (rng: () => number, a: number, b: number): number => a + (b - a) * rng();

export interface Relevo {
  /** El carril que toma la punta. */
  quien: number;
  /** Dónde de la recta (0 a 1) cambia de manos. */
  q: number;
}

export interface InfoCierre {
  forma: FormaCierre;
  /** Los carriles que pelean adelante: la ganadora y dos o tres más. */
  contendientes: number[];
  /** Quién lleva la punta en cada tramo, de la que está al abrirse el cierre en adelante. */
  relevos: Relevo[];
  /** Para `aguanta`: la que se le pega a la ganadora. */
  acosa?: number;
}

/**
 * Los tramos de la punta de cada forma: cuántos cambios y entre qué cuándos. La que abre el cierre es la que va primera en el plan
 * base al 76 % (`primero`), así quien está adelante al abrirse es una cualquiera: la ganadora una de cada ocho veces, como siempre.
 * Todos los cambios caen antes del 97 %, para que la ganadora llegue mandando.
 */
function armarRelevos(forma: FormaCierre, w: number, primero: number, otros: number[], rng: () => number): { relevos: Relevo[]; acosa?: number } {
  const [a, b] = otros as [number, number, number];
  const rel = (...xs: [number, number][]): Relevo[] => xs.map(([quien, q]) => ({ quien, q }));
  const abre = primero === w;
  if (forma === "remontada" && !abre) {
    // Otras llevan la punta y la ganadora la toma al final. Un cambio o dos antes.
    const final = entre(rng, 0.935, 0.965);
    return rng() < 0.5
      ? { relevos: rel([primero, 0], [w, final]) }
      : { relevos: rel([primero, 0], [b, entre(rng, 0.865, 0.9)], [w, final]) };
  }
  if (forma === "aguanta" && !abre) {
    // La que aguanta: pasa a la que iba y se queda; la que acosa es esa misma, que vuelve.
    return { relevos: rel([primero, 0], [w, entre(rng, 0.9, 0.96)]), acosa: primero };
  }
  if (abre) {
    // La ganadora ya iba adelante al abrirse: la pierde y la recupera, o la sostiene y alguien se le pega.
    if (forma === "aguanta") return { relevos: rel([w, 0]), acosa: a };
    return { relevos: rel([w, 0], [a, entre(rng, 0.86, 0.885)], [w, entre(rng, 0.93, 0.955)]) };
  }
  const plantilla = Math.floor(rng() * 3);
  if (plantilla === 0) return { relevos: rel([primero, 0], [w, 0.84 + rng() * 0.01], [primero, 0.9 + rng() * 0.01], [w, entre(rng, 0.94, 0.96)]) };
  if (plantilla === 1) return { relevos: rel([primero, 0], [a === primero ? b : a, entre(rng, 0.85, 0.88)], [w, entre(rng, 0.925, 0.955)]) };
  return { relevos: rel([primero, 0], [w, 0.84 + rng() * 0.01], [a === primero ? b : a, 0.895 + rng() * 0.01], [w, entre(rng, 0.94, 0.96)]) };
}

/**
 * Envuelve un plan de la recta con el cierre. Devuelve un plan con la misma
 * forma (`PlanFinal`) y el campo `cierre` con lo que se armó. Con menos de tres
 * carriles no hay pelea que armar y devuelve el plan tal cual.
 */
export function conCierre(base: PlanFinal, rng: () => number): PlanFinal {
  const L = base.lanes.length;
  const w = base.story.winner;
  if (L < 3) return base;
  const arc = base.story.arc;
  // La forma sale del arco (así el relator y el cierre cuentan lo mismo) y, en la tapada, de un sorteo.
  const forma: FormaCierre = arc === "remontada" ? "remontada" : arc === "tapada" ? (rng() < 0.5 ? "remontada" : "disputa") : arc === "duelo" ? "disputa" : "aguanta";

  // Las que pelean: la rival de la historia, la otra que viene o la tapada, y una más sorteada. La ganadora es una de ellas.
  const resto = Array.from({ length: L }, (_, k) => k).filter((k) => k !== w);
  const sortear = (xs: number[]): number => xs.splice(Math.floor(rng() * xs.length), 1)[0] as number;
  const pelean: number[] = [];
  const primera = base.story.rival !== w ? base.story.rival : sortear(resto);
  pelean.push(primera);
  const segunda = arc === "tapada" && base.story.rival2 !== w && base.story.rival2 !== primera ? base.story.rival2 : base.decoy >= 0 && base.decoy !== primera && base.decoy !== w ? base.decoy : -1;
  const quedan = resto.filter((k) => !pelean.includes(k));
  if (segunda >= 0) pelean.push(segunda);
  while (pelean.length < Math.min(3, L - 1) && quedan.length) {
    const k = sortear(quedan);
    if (!pelean.includes(k)) pelean.push(k);
  }
  // Una más, sorteada, en la disputa y la remontada: más pelea, menos pista.
  const sobran = resto.filter((k) => !pelean.includes(k));
  if (forma !== "aguanta" && sobran.length && L >= 6) pelean.push(sortear(sobran));
  // Cuál de ellas es la que abre y la que sigue en el tramo sale del azar, no de lo que hacen en el plan base.
  const otros = pelean.slice();
  for (let i = otros.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [otros[i], otros[j]] = [otros[j] as number, otros[i] as number];
  }
  // La que abre el cierre es la que va primera en el plan base: que pelee, sea quien sea.
  let primero = 0;
  for (let k = 1; k < L; k++) if (base.pos(k, DESDE) > base.pos(primero, DESDE)) primero = k;
  if (primero !== w) {
    if (!pelean.includes(primero)) pelean.push(primero);
    otros.splice(0, otros.length, primero, ...otros.filter((k) => k !== primero));
  }
  while (otros.length < 3) otros.push(otros[otros.length - 1] as number);
  const { relevos, acosa } = armarRelevos(forma, w, primero, otros, rng);
  const contendientes = [w, ...new Set(pelean)];

  // Dónde quedan las que no mandan: cada una, el suyo, entre uno y tres cuerpos atrás de la línea.
  const atras = new Map<number, number>();
  for (const k of contendientes) atras.set(k, -entre(rng, 1.1, 2.0));
  // La ganadora en la remontada viene más atrás.
  if (forma === "remontada") atras.set(w, -entre(rng, 1.4, 3.4));
  // Un temblor lento, distinto para cada una, para que no corran como rieles.
  const onda = new Map<number, { f: number; fase: number; amp: number }>();
  for (const k of contendientes) onda.set(k, { f: entre(rng, 5, 9), fase: entre(rng, 0, 2 * Math.PI), amp: entre(rng, 0.12, 0.28) });
  // La que acosa a la ganadora en `aguanta`: dónde se pega, cuánto y hasta dónde llega.
  const acoso = acosa === undefined ? null : { centro: entre(rng, 0.945, 0.965), mitad: entre(rng, 0.03, 0.04), hueco: entre(rng, 0.35, 0.8) };

  /** Cuánto manda `k` (de 0 a 1) en `q`: la suma de sus turnos en la punta, con cruces suaves. */
  const manda = (k: number, q: number): number => {
    let s = 0;
    for (let i = 0; i < relevos.length; i++) {
      const r = relevos[i] as Relevo;
      if (r.quien !== k) continue;
      const sig = relevos[i + 1];
      const sube = i === 0 ? 1 : suave((q - (r.q - CRUCE / 2)) / CRUCE);
      const baja = sig ? suave((q - (sig.q - CRUCE / 2)) / CRUCE) : 0;
      s += sube - baja;
    }
    return Math.max(0, Math.min(1, s));
  };

  /** A cuántos cuerpos de la línea va `k` (que es `q` + el hueco que le da el plan base a quien llega a cero) en `q`. */
  const objetivo = (k: number, q: number): number => {
    const piso = atras.get(k) as number;
    const m = manda(k, q);
    const ond = onda.get(k) as { f: number; fase: number; amp: number };
    let o = piso + (ADELANTE - piso) * m + ond.amp * Math.sin(ond.f * q + ond.fase) * (1 - m);
    if (acoso && k === acosa) {
      const h = suave((q - (acoso.centro - acoso.mitad)) / acoso.mitad) * (1 - suave((q - acoso.centro) / acoso.mitad));
      o = o * (1 - h) + (ADELANTE - acoso.hueco) * h;
    }
    return o;
  };

  const envolvente = (q: number): number => suave((q - DESDE) / (PLENA - DESDE)) * (1 - suave((q - BAJA) / (HASTA - BAJA)));
  const mia = new Set(contendientes);
  const compensa = (q: number): number => {
    for (const [a, z, cuerpos] of COMPENSA) if (q > a && q < z) return cuerpos * Math.sin((Math.PI * (q - a)) / (z - a)) ** 2;
    return 0;
  };
  const pos = (k: number, q: number): number => {
    const b = base.pos(k, q);
    if (k === w && q < DESDE) {
      const c = compensa(q);
      if (c <= 0) return b;
      // Solo frena a la que va primera o casi: la distancia a la mejor de las otras, en cuerpos.
      let mejor = -Infinity;
      for (let j = 0; j < L; j++) if (j !== w) mejor = Math.max(mejor, base.pos(j, q));
      const m = (b - mejor) / CUERPO;
      return b - c * CUERPO * suave((m + 0.5) / 1.5);
    }
    if (!mia.has(k)) return b;
    const e = envolvente(q);
    if (e <= 0) return b;
    const meta = q + objetivo(k, q) * CUERPO + k * 1e-9;
    return b + e * (meta - b);
  };

  const info: InfoCierre = { forma, contendientes, relevos, ...(acosa !== undefined ? { acosa } : {}) };
  return { ...base, pos, cierre: info, puestos: base.puestos.filter((p) => p.q <= 0.75) };
}
