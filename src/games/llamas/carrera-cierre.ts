import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
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
/** Desde dónde manda el final por casilleros, y cuánto del tramo se tardan en juntarse hacia la línea. */
const FINAL = 0.9;
const JUNTAN = 0.62;
/** Lo menos que lleva la punta la ganadora antes de cruzar, en segundos; y lo menos que separa dos de sus pases. */
const LIDERA_MIN = 1.05;
const SEPARA = 0.21;
/** Lo que se tarda en empalmar con la velocidad que traía la llama al 90 %, y lo que ocupan los dos cruces de la rival que se la vuelve a pasar. */
const EMPALME = 0.8;
const CONTRA = 1.7;
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

/** Un pase del final: la ganadora (`sube`) pasa a quien tiene delante, o quien tenía detrás se la vuelve a pasar. */
export interface Pase {
  /** El carril de la otra que cambia de lugar con la ganadora. */
  con: number;
  /** Dónde de la recta (0 a 1) se cruzan. */
  q: number;
  /** La ganadora pasa adelante (true) o la pasan (false). */
  sube: boolean;
}

export interface InfoCierre {
  forma: FormaCierre;
  /** Los carriles que pelean adelante: la ganadora y dos o tres más. */
  contendientes: number[];
  /** Quién lleva la punta en cada tramo hasta el 90 %, de la que está al abrirse el cierre en adelante. */
  relevos: Relevo[];
  /** Para `aguanta`: la que se le pega a la ganadora. */
  acosa?: number;
  /** Desde el 90 %, los cambios de lugar de la ganadora, en orden (ver `final`). */
  pases: Pase[];
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
  const pos0 = (k: number, q: number): number => {
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

  /* ---------------------------------------------------------- el final, desde el 90 % */
  // Hasta el 90 % vale lo de arriba (los puestos que se sortean y el puesto de la ganadora al 90 % no cambian). De ahí a la meta
  // el pelotón corre por casilleros: en cada instante hay ocho lugares ordenados, de la punta al fondo, que se van juntando hacia
  // la línea, y cada llama ocupa uno. La ganadora, que sale del 90 % en el puesto que ya tenía, sube de casillero en casillero,
  // de a uno, cada pase con su subida suave (la velocidad no da saltos), y en algunas carreras la rival más cercana se la
  // vuelve a pasar antes de que la ganadora se la quede. El orden en que cruzan las demás es el del plan base.
  const foto = base.foto;
  const t0 = segundosDeQ(FINAL, foto);
  const T = segundosDeQ(1, foto) - t0;
  const sDe = (q: number): number => Math.max(0, Math.min(T, segundosDeQ(q, foto) - t0));
  const carriles = Array.from({ length: L }, (_, k) => k);
  const salida = (k: number): number => (pos0(k, FINAL) - FINAL) / CUERPO;
  const ordenSalida = carriles.slice().sort((a, b) => pos0(b, FINAL) - pos0(a, FINAL));
  const casilla0 = new Map<number, number>(ordenSalida.map((k, i) => [k, i]));
  const rangoGanadora = casilla0.get(w) as number; // 0 es la primera
  // Cómo llegan: la ganadora donde la deja el plan base (sobre la línea); la segunda, a menos de medio cuerpo casi siempre, y las demás apretadas detrás.
  // El orden en que cruzan las que no ganan no lo decide nada del protocolo: es el que traen del 90 %.
  const fin: number[] = [(base.pos(w, 1) - 1) / CUERPO];
  const estrecha = rng() < 0.78;
  fin.push((fin[0] as number) - (estrecha ? entre(rng, 0.14, 0.44) : entre(rng, 0.5, 0.9)));
  for (let i = 2; i < L; i++) fin.push((fin[i - 1] as number) - (i === 2 ? entre(rng, 0.12, 0.4) : entre(rng, 0.2, 0.55)));
  const inicio = ordenSalida.map(salida);
  const juntan = (s: number): number => suave(s / (JUNTAN * T));
  const casillero = (i: number, s: number): number => (inicio[i] as number) + ((fin[i] as number) - (inicio[i] as number)) * juntan(s);

  // Los cambios de lugar de la ganadora. Cada uno es una subida (o bajada) entre dos casilleros vecinos: se cruza en `t`.
  interface Cambio { b: number; sube: boolean; t: number }
  const cambios: Cambio[] = [];
  const DURA = 0.5;
  const tope = T - LIDERA_MIN;
  const ups = rangoGanadora; // cuántas tiene delante
  if (ups === 0) {
    // Ya iba primera: a veces la rival más cercana se la pasa y la ganadora se la vuelve a quedar.
    if (rng() < 0.45) {
      const tb = entre(rng, 0.45, 0.85);
      cambios.push({ b: 0, sube: false, t: tb }, { b: 0, sube: true, t: Math.min(tope, tb + entre(rng, 0.7, 0.9)) });
    }
  } else {
    const paso = ups > 1 ? Math.min(SEPARA, Math.max(0.2, (tope - 0.35) / (ups - 1))) : SEPARA;
    const sortea = rng() < 0.35;
    // Con la rival que se la vuelve a pasar hace falta lugar para dos cruces más: solo si entran en el tramo.
    const contra = sortea && 0.3 + paso * (ups - 1) + CONTRA <= tope;
    const minimo = 0.3 + paso * (ups - 1) + (contra ? CONTRA : 0);
    const final = Math.min(tope, minimo + Math.pow(rng(), 3) * Math.max(0, tope - minimo));
    // El último pase y los que lo preceden, de atrás para adelante, cada uno `paso` antes.
    let t = final;
    if (contra) {
      cambios.push({ b: 0, sube: true, t });
      const tb = t - entre(rng, 0.65, 0.85);
      cambios.push({ b: 0, sube: false, t: tb });
      t = tb - entre(rng, 0.6, 0.8);
      cambios.push({ b: 0, sube: true, t });
      for (let b = 1; b < ups; b++) {
        t -= paso;
        cambios.push({ b, sube: true, t });
      }
    } else {
      cambios.push({ b: 0, sube: true, t });
      for (let b = 1; b < ups; b++) {
        t -= paso;
        cambios.push({ b, sube: true, t });
      }
    }
    cambios.sort((x, y) => x.t - y.t);
  }
  // Quién cambia con la ganadora en cada uno: la que tiene el casillero al que se acerca (o del que baja) en ese momento.
  const ocupa = ordenSalida.slice(); // casillero -> carril, a medida que pasan los cambios
  const qCambio: Pase[] = [];
  interface Efecto { b: number; con: number; signo: 1 | -1; t: number }
  const efectos: Efecto[] = [];
  for (const c of cambios) {
    const arriba = c.b, abajo = c.b + 1;
    if (c.sube) {
      // La ganadora está en `abajo`; el carril de `arriba` baja.
      const otra = ocupa[arriba] as number;
      efectos.push({ b: c.b, con: otra, signo: 1, t: c.t });
      ocupa[arriba] = w;
      ocupa[abajo] = otra;
      qCambio.push({ con: otra, q: qDeSegundos(t0 + c.t, foto), sube: true });
    } else {
      const otra = ocupa[abajo] as number;
      efectos.push({ b: c.b, con: otra, signo: -1, t: c.t });
      ocupa[abajo] = w;
      ocupa[arriba] = otra;
      qCambio.push({ con: otra, q: qDeSegundos(t0 + c.t, foto), sube: false });
    }
  }
  // La ganadora empezó en su casillero; las demás, en el suyo. Cada cambio mueve a las dos entre casilleros vecinos.
  const pendienteAlSalir = (k: number): number => {
    const h = 0.012;
    const q0 = Math.max(0.5, FINAL - h);
    return ((pos0(k, FINAL + h) - (FINAL + h)) - (pos0(k, q0) - q0)) / CUERPO / (segundosDeQ(FINAL + h, foto) - segundosDeQ(q0, foto));
  };
  const velocidad0 = carriles.map(pendienteAlSalir);
  const ajuste = (s: number): number => (s < EMPALME ? s * (1 - s / EMPALME) ** 2 : 0);
  const lugar = (k: number, s: number): number => {
    let o = casillero(casilla0.get(k) as number, s);
    for (const e of efectos) {
      if (k !== w && k !== e.con) continue;
      const paso = suave((s - (e.t - DURA / 2)) / DURA);
      if (paso <= 0) continue;
      const salto = casillero(e.b, s) - casillero(e.b + 1, s);
      o += (k === w ? e.signo : -e.signo) * salto * paso;
    }
    return o + (velocidad0[k] as number) * ajuste(s);
  };
  const posNueva = (k: number, q: number): number => q + lugar(k, sDe(q)) * CUERPO;

  const pos = (k: number, q: number): number => (q <= FINAL ? pos0(k, q) : posNueva(k, q));

  const info: InfoCierre = { forma, contendientes, relevos: relevos.filter((r) => r.q <= FINAL), ...(acosa !== undefined ? { acosa } : {}), pases: qCambio };
  return { ...base, pos, cierre: info, puestos: base.puestos.filter((p) => p.q <= 0.75) };
}
