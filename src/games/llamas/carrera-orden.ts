/**
 * El orden del grupo, puro: quién va primera, segunda... en cada instante.
 *
 * Es `orden(t)`. **No mira a nadie.** El lugar de cada una es una distancia en cuerpos, continua en el tiempo y con la velocidad y la
 * aceleración acotadas (`carrera-marcha.ts`): nadie salta de un casillero a otro. Se suma de cuatro cosas, ninguna sabe quién es quién:
 *
 * - **El lugar con que sale** (`base`): un sorteo parejo entre todas. Entre las ocho de la final ese orden es el de entrada a la recta
 *   (`entrada`): ocupan los mismos lugares que les tocaron, así que el puesto de la ganadora al entrar sigue siendo uno de ocho parejo.
 * - **El paseo**: tres ondas lentas (de 6 a 13 s) que la adelantan o la atrasan un poco.
 * - **El hueco que se cierra**: cuando una se echa, las que venían atrás avanzan un lugar, de a poco (`CIERRA`), y no de golpe.
 * - **El pique de la punta** (`relevos`): cada 6 a 8 s una de las primeras del paseo (sorteada) se acerca durante cinco segundos a la
 *   que va adelante, la pasa despacio y se queda; la anterior se deja caer después. Cada pique es una causa a la vista.
 *
 * Función pura del tiempo: saltar, estirar el reloj o redibujar tras un cambio de tamaño dan lo mismo.
 */

import { ENTRE_PUESTOS } from "./carrera-marcha";

export interface EntradaOrden {
  /** Las que salen, en el orden del corral. */
  gente: readonly number[];
  /** Cuándo se echa cada una (`Infinity` si no se echa). */
  cae(i: number): number;
  /** Las que llegan a la recta. */
  finalistas: readonly number[];
  /** Las finalistas en el orden en que entran a la recta, de la primera a la última. */
  entrada: readonly number[];
  /** La salida. */
  t0: number;
  /** La última echada (más o menos): de ahí en adelante no hay más piques. */
  tConv: number;
  /** Cuándo se abre la recta. */
  tAbre: number;
  /** El azar sembrado del grupo, aparte del de la final. */
  rng: () => number;
  /**
   * Con tandas: cada una sale del corral en el lugar que le toca por su orden de salida por el portón (la primera en salir va adelante, la
   * última atrás, cerca del portón), en vez de un sorteo. Las finalistas ya salen en el orden de entrada a la recta (`armarTandas`), así que ocupan
   * los lugares que les tocaron y el puesto de la ganadora al entrar sigue siendo uno de ocho parejo.
   */
  porSalida?: boolean;
  /** Cuánto tarda el paseo en arrancar (segundos): con tandas, más: coincide con la primera echada y las dos aceleraciones no se suman. */
  rampa?: number;
  /** El lugar con que la recta recibe a `g` (cuerpos) `tt` segundos de la hora del show, o `null` si no corre la recta: el grupo lo adopta en el último segundo y no hay empalme brusco. */
  empalme?: (g: number, tt: number) => number | null;
}

/** Un pique de la punta: quién toma la delantera y cuándo se ve. */
export interface Relevo {
  quien: number;
  /** Cuándo empieza a acercarse, cuándo ya va adelante, cuándo empieza a dejarla (el siguiente pique o el fin del grupo) y cuándo termina de caer. */
  desde: number;
  t: number;
  cae: number;
  hasta: number;
}

export interface Orden {
  /** Las que siguen en `t`, de la primera a la última. */
  en(t: number): number[];
  /** La primera en `t` (-1 si no queda nadie). */
  lider(t: number): number;
  /** La distancia de `g` en `t`, en cuerpos desde el lugar de adelante con que salió: es lo que ordena a `en`, continua en el tiempo. */
  puntaje(g: number, t: number): number;
  /** El puesto con que sale `g`, de 0 (la de adelante) a la última: le da su fila, que no cambia en toda la carrera. */
  rango(g: number): number;
  /** Cuánto separa un puesto del siguiente al salir, en cuerpos. */
  entrePuestos: number;
  /** Cuándo y quién toma la punta (sin contar las echadas de quien la llevaba). */
  cambios: { t: number; quien: number }[];
  /** Los piques de la punta, uno por turno. */
  relevos: Relevo[];
}

/** Una subida o bajada suave (de quinto grado): continua en la velocidad y en la aceleración. */
const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * x * (x * (6 * x - 15) + 10);
};

/** Cuánto le suma el pique a quien toma la punta, en cuerpos: más que lo que separa a las primeras del paseo. */
const EMPUJON = 1.5;
/** Entre cuántas de las primeras del paseo se sortea quién toma la punta. */
const PRIMERAS = 4;
/** Lo que separa a un puesto del siguiente al salir, en cuerpos. */
/** Cuánto tarda en subir quien toma la punta y en bajar quien la deja (segundos): con ellos el pique no pasa de 0,6 cuerpos por segundo. */
const SUBE = 6;
const BAJA = 6;
/** Cuánto tarda en cerrarse el hueco que deja una echada. */
const CIERRA = 3.6;
/** Un hueco que se abre cerca de la recta se cierra antes de que las finalistas pasen a la curva de la recta (`EMPALME`), pero no en menos de esto. */
const CIERRA_MIN = 2.2;
/** Entre un pique y el siguiente, en segundos. */
const ENTRE_RELEVOS = [7, 9] as const;
/** Las ondas del paseo: amplitudes en cuerpos (suman 0,3; con períodos de 6 a 13 s la velocidad no pasa de 0,31). */
const AMPS = [0.12, 0.09, 0.05];
/** El paseo se apaga en los últimos segundos del grupo: las ocho llegan a la recta en el orden de entrada. */
const APAGA = 2.4;
/** El último segundo del grupo, en que las finalistas pasan a la curva de la recta. */
const EMPALME = 1;

interface Onda {
  amp: number;
  w: number;
  fase: number;
}

export function crearOrden(e: EntradaOrden): Orden {
  const idx = new Map<number, number>();
  e.gente.forEach((g, j) => idx.set(g, j));
  // El paseo de cada una: tres ondas lentas.
  const ondas: Onda[][] = e.gente.map(() => AMPS.map((amp) => ({ amp, w: (2 * Math.PI) / (6 + 7 * e.rng()), fase: 2 * Math.PI * e.rng() })));
  // Cada una sale de un lugar sorteado, sin mirar quién es. `reparto[r]` es el índice de la que sale en el lugar `r` (0, el de adelante).
  const reparto = e.gente.map((_, j) => j);
  // (El sorteo se hace igual aunque salgan por orden: el azar del grupo gasta los mismos números en las dos formas.)
  const sorteo = reparto.map((_, j) => j);
  for (let i = sorteo.length - 1; i > 0; i--) {
    const j = Math.floor(e.rng() * (i + 1));
    [sorteo[i], sorteo[j]] = [sorteo[j] as number, sorteo[i] as number];
  }
  if (!e.porSalida) sorteo.forEach((v, i) => { reparto[i] = v; });
  // Entre las finalistas, los lugares que les tocaron se ocupan en el orden de entrada a la recta (el conjunto de lugares sigue siendo
  // un sorteo parejo, y el orden de entrada es el que sortea la recta: independiente del paseo).
  const finales = new Set(e.finalistas);
  const lugaresFinal: number[] = [];
  reparto.forEach((j, r) => {
    if (finales.has(e.gente[j] as number)) lugaresFinal.push(r);
  });
  e.entrada.forEach((g, k) => {
    const j = idx.get(g);
    const r = lugaresFinal[k];
    if (j !== undefined && r !== undefined) reparto[r] = j;
  });
  const rangoDe: number[] = e.gente.map(() => 0);
  const base: number[] = e.gente.map(() => 0);
  reparto.forEach((j, r) => {
    base[j] = -r * ENTRE_PUESTOS;
    rangoDe[j] = r;
  });
  /** Cuántos lugares cerraron las echadas de las que salían delante de `g`, cada una de a poco. */
  const huecos = (g: number, tt: number): number => {
    const r = rangoDe[idx.get(g) as number] as number;
    let h = 0;
    for (let k = 0; k < r; k++) {
      const c = e.cae(e.gente[reparto[k] as number] as number);
      if (Number.isFinite(c) && tt > c) h += suave((tt - c) / Math.max(CIERRA_MIN, Math.min(CIERRA, e.tAbre - EMPALME - 0.1 - c)));
    }
    return h;
  };
  const turnos: { t: number; quien: number }[] = [];
  const paseoDe = (g: number, tt: number): number => {
    let v = 0;
    for (const o of ondas[idx.get(g) as number] as Onda[]) v += o.amp * Math.sin(o.w * tt + o.fase);
    // Arranca de a poco (en la salida las llamas estaban quietas): sin este paso la velocidad del paseo saltaba de cero a cuatro décimas.
    return v * suave((tt - e.t0) / (e.rampa ?? 1.5));
  };
  /** Cuándo deja la punta quien la tomó en el turno `k`: cuando la toma la siguiente o, la última, a tiempo de haber bajado antes de que se apague el paseo. */
  const caeDe = (k: number): number => (k + 1 < turnos.length ? (turnos[k + 1] as { t: number }).t : Math.max((turnos[k] as { t: number }).t + 1, e.tAbre - APAGA - BAJA - 0.1));
  const empujon = (g: number, tt: number): number => {
    let v = 0;
    for (let k = 0; k < turnos.length; k++) {
      const tk = turnos[k] as { t: number; quien: number };
      if (tk.quien !== g) continue;
      const fin = caeDe(k);
      v += suave((tt - (tk.t - SUBE)) / SUBE) * (1 - suave((tt - fin) / BAJA));
    }
    return v;
  };
  const apaga = (tt: number): number => 1 - suave((tt - (e.tAbre - APAGA)) / APAGA);
  const libre = (g: number, tt: number): number => (base[idx.get(g) as number] as number) + ENTRE_PUESTOS * huecos(g, tt) + apaga(tt) * paseoDe(g, tt) + EMPUJON * empujon(g, tt);
  const puntaje = (g: number, tt: number): number => {
    const p = libre(g, tt);
    if (!e.empalme || tt <= e.tAbre - EMPALME) return p;
    const v = e.empalme(g, tt);
    if (v === null) return p;
    const b = suave((tt - (e.tAbre - EMPALME)) / EMPALME);
    return p + (v - p) * b;
  };
  const porPuntaje = (a: { g: number; s: number }, b: { g: number; s: number }): number => b.s - a.s || (idx.get(a.g) as number) - (idx.get(b.g) as number);

  // Los piques: cada 6 a 8 s, una de las primeras del paseo (sorteada) toma la delantera. Ninguno empieza tan tarde que no alcance a
  // subir la que toma y a bajar la que deja antes de que se abra la recta.
  const ultimoTurno = e.tAbre - SUBE - BAJA * 0.6;
  let t = e.t0 + SUBE + 1;
  while (t < ultimoTurno) {
    const vivas = e.gente.filter((g) => e.cae(g) > t + SUBE);
    const actual = vivas.map((g) => ({ g, s: puntaje(g, t) })).sort(porPuntaje)[0]?.g ?? -1;
    const candidatas = vivas.filter((g) => g !== actual);
    if (candidatas.length) {
      const primeras = candidatas.map((g) => ({ g, s: puntaje(g, t) })).sort(porPuntaje).slice(0, PRIMERAS);
      const quien = (primeras[Math.min(primeras.length - 1, Math.floor(e.rng() * primeras.length))] as { g: number }).g;
      turnos.push({ t, quien });
    }
    t += ENTRE_RELEVOS[0] + (ENTRE_RELEVOS[1] - ENTRE_RELEVOS[0]) * e.rng();
  }
  const relevos: Relevo[] = turnos.map((tk, k) => {
    const cae = caeDe(k);
    return { quien: tk.quien, desde: tk.t - SUBE, t: tk.t, cae, hasta: cae + BAJA };
  });

  const en = (tt: number): number[] => {
    const vivas = e.gente.filter((g) => e.cae(g) > tt);
    const p = new Map<number, number>();
    for (const g of vivas) p.set(g, puntaje(g, tt));
    return vivas.sort((a, b) => (p.get(b) as number) - (p.get(a) as number) || (idx.get(a) as number) - (idx.get(b) as number));
  };
  const lider = (tt: number): number => en(tt)[0] ?? -1;

  // Los cambios de punta, mirando el orden de verdad cada 0,05 s. Solo cuentan los que se sostienen segundo y medio (y
  // dos nunca caen más cerca): el relator no anuncia una punta que se pierde antes de que se termine de decir.
  const cambios: { t: number; quien: number }[] = [];
  let actual = lider(e.t0);
  let desde = e.t0;
  for (let tt = e.t0; tt <= e.tAbre; tt += 0.05) {
    const l = lider(tt);
    if (l !== actual && l >= 0) {
      const lEcho = Number.isFinite(e.cae(actual)) && e.cae(actual) <= tt && tt - e.cae(actual) < 0.1;
      if (!lEcho && tt - desde >= 1.5 && lider(tt + 1.5) === l) cambios.push({ t: tt, quien: l });
      actual = l;
      desde = tt;
    }
  }
  const rango = (g: number): number => rangoDe[idx.get(g) as number] ?? 0;
  return { en, lider, puntaje, rango, entrePuestos: ENTRE_PUESTOS, cambios, relevos };
}
