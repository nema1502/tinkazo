/**
 * El orden del grupo, puro: quién va primera, segunda... en cada instante.
 *
 * Es `orden(t)`. **No mira a nadie.** Es un paseo sembrado con la ronda que no
 * conoce a las finalistas, a la ganadora ni a las que se van a echar: la punta
 * la lleva cualquiera de las que siguen, también una que se echa un rato
 * después. Así "va adelante" no adelanta qué le pasa, y tampoco se fuerza que
 * la ganadora nunca esté en la punta a la mitad (eso también delataría).
 *
 * - **Cada una tiene su paseo**: una suma de tres ondas lentas (de 5 a 13 s) que
 *   la adelantan o la atrasan un poco. Nada de esto depende de quién es.
 * - **La punta cambia de dueña cada 4 a 6 s**: un sorteo entre las que siguen
 *   (en ese momento) le suma a una un empujón largo, sin mirar quién es. Si la
 *   que lleva la punta se echa, la punta pasa a la siguiente del paseo.
 * - **Convergencia**: en el último tramo (después de la última echada) las
 *   finalistas se ordenan como entran a la recta (`entrada`, el orden de la
 *   final al 7 %, que `planRace` sortea parejo sumando los cuatro arcos). Antes
 *   de eso las finalistas son tan intercambiables como cualquiera: el orden de
 *   entrada es independiente del paseo, así que en toda la carrera el puesto de
 *   la ganadora es uno de ocho parejo.
 *
 * Función pura del tiempo: saltar, estirar el reloj o redibujar tras un cambio
 * de tamaño dan lo mismo.
 */

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
  /** Desde cuándo las finalistas se ordenan hacia la entrada (después de la última echada). */
  tConv: number;
  /** Cuándo se abre la recta. */
  tAbre: number;
  /** El azar sembrado del grupo, aparte del de la final. */
  rng: () => number;
}

export interface Orden {
  /** Las que siguen en `t`, de la primera a la última. */
  en(t: number): number[];
  /** La primera en `t` (-1 si no queda nadie). */
  lider(t: number): number;
  /** Cuándo y quién toma la punta (sin contar las echadas de quien la llevaba). */
  cambios: { t: number; quien: number }[];
}

const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

/** Cuánto le suma a una el empujón de la punta: más que lo que separa a las cuatro primeras del paseo. */
const EMPUJON = 2.4;
/** Entre cuántas de las primeras del paseo se sortea quién toma la punta. */
const PRIMERAS = 4;
/** Lo que separa a un puesto del siguiente en el paseo: contra ±0,27 de las ondas, los puestos se mueven de a poco. */
const ENTRE_PUESTOS = 0.45;
/** Cuánto tardan en cruzarse la que deja la punta y la que la toma. */
const TRASPASO = 0.9;

interface Onda {
  amp: number;
  w: number;
  fase: number;
}

export function crearOrden(e: EntradaOrden): Orden {
  const idx = new Map<number, number>();
  e.gente.forEach((g, j) => idx.set(g, j));
  // El paseo de cada una: tres ondas lentas con amplitudes 0,12 + 0,09 + 0,06 = 0,27.
  const AMPS = [0.12, 0.09, 0.06];
  const ondas: Onda[][] = e.gente.map(() => AMPS.map((amp) => ({ amp, w: (2 * Math.PI) / (5 + 8 * e.rng()), fase: 2 * Math.PI * e.rng() })));
  // Cada una arranca en un lugar del paseo, repartido parejo y sin mirar quién es: así los puestos se mueven de a poco.
  const base = e.gente.map(() => 0);
  const reparto = e.gente.map((_, j) => j);
  for (let i = reparto.length - 1; i > 0; i--) {
    const j = Math.floor(e.rng() * (i + 1));
    [reparto[i], reparto[j]] = [reparto[j] as number, reparto[i] as number];
  }
  reparto.forEach((j, r) => {
    base[j] = (r - (reparto.length - 1) / 2) * ENTRE_PUESTOS;
  });
  // La punta: cada 4 a 6 s, una de las primeras del paseo (sorteada, sin mirar quién es) toma la delantera.
  const toma: { t: number; quien: number }[] = [];
  const turnos = toma;
  const empujon = (g: number, tt: number): number => {
    let v = 0;
    for (let k = 0; k < turnos.length; k++) {
      const tk = turnos[k] as { t: number; quien: number };
      if (tk.quien !== g) continue;
      const fin = k + 1 < turnos.length ? (turnos[k + 1] as { t: number }).t : e.tConv;
      // La que entra sube antes de su turno y la que sale baja después: siempre una de las dos tiene el empujón entero,
      // y en el traspaso no se cuela una tercera (el paseo pelado) por unos décimos.
      v += suave((tt - (tk.t - TRASPASO)) / TRASPASO) * (1 - suave((tt - fin) / TRASPASO));
    }
    return v;
  };
  const paseoDe = (g: number, tt: number): number => {
    const j = idx.get(g) as number;
    let v = base[j] as number;
    for (const o of ondas[j] as Onda[]) v += o.amp * Math.sin(o.w * tt + o.fase);
    return v;
  };
  const porPuntaje = (a: { g: number; s: number }, b: { g: number; s: number }): number => b.s - a.s || (idx.get(a.g) as number) - (idx.get(b.g) as number);
  let t = e.t0 + 1.5;
  const ultimoTurno = e.tConv - 1.5;
  while (t < ultimoTurno) {
    // Quien la lleva ahora (con su empujón) no puede volver a tomarla: cada turno es un cambio de punta.
    const actual = e.gente.filter((g) => e.cae(g) > t).map((g) => ({ g, s: paseoDe(g, t) + EMPUJON * empujon(g, t) })).sort(porPuntaje)[0]?.g ?? -1;
    // Una de las primeras del paseo, sorteada, la toma: es un adelantamiento de al lado y no un salto desde el fondo.
    // El paseo no conoce a nadie, así que la elegida es una cualquiera de las que siguen.
    const vivas = e.gente.filter((g) => e.cae(g) > t && g !== actual);
    if (vivas.length) {
      const primeras = vivas.map((g) => ({ g, s: paseoDe(g, t) })).sort(porPuntaje).slice(0, PRIMERAS);
      const quien = (primeras[Math.min(primeras.length - 1, Math.floor(e.rng() * primeras.length))] as { g: number }).g;
      toma.push({ t, quien });
    }
    t += 4 + 2 * e.rng();
  }
  const objetivo = new Map<number, number>();
  e.entrada.forEach((g, r) => objetivo.set(g, 5 - 0.6 * r));
  const finales = new Set(e.finalistas);

  const puntaje = (g: number, tt: number): number => {
    const j = idx.get(g) as number;
    let paseo = base[j] as number;
    for (const o of ondas[j] as Onda[]) paseo += o.amp * Math.sin(o.w * tt + o.fase);
    const libre = paseo + EMPUJON * empujon(g, tt);
    const beta = suave((tt - e.tConv) / Math.max(0.5, e.tAbre - e.tConv));
    const meta = finales.has(g) ? (objetivo.get(g) as number) : -3;
    return (1 - beta) * libre + beta * meta;
  };

  const en = (tt: number): number[] => {
    const vivas = e.gente.filter((g) => e.cae(g) > tt);
    const p = new Map<number, number>();
    for (const g of vivas) p.set(g, puntaje(g, tt));
    return vivas.sort((a, b) => (p.get(b) as number) - (p.get(a) as number) || (idx.get(a) as number) - (idx.get(b) as number));
  };
  const lider = (tt: number): number => en(tt)[0] ?? -1;

  // Los cambios de punta, mirando el orden de verdad cada 0,05 s. Solo cuentan los que se sostienen un segundo: el relator no
  // anuncia una punta que se pierde antes de que se termine de decir (la que entra y a los pocos décimos se echa o la pasan).
  const cambios: { t: number; quien: number }[] = [];
  let actual = lider(e.t0);
  let desde = e.t0;
  for (let tt = e.t0; tt <= e.tAbre; tt += 0.05) {
    const l = lider(tt);
    if (l !== actual && l >= 0) {
      const lEcho = Number.isFinite(e.cae(actual)) && e.cae(actual) <= tt && tt - e.cae(actual) < 0.1;
      if (!lEcho && tt - desde >= 0.5 && lider(tt + 1) === l) cambios.push({ t: tt, quien: l });
      actual = l;
      desde = tt;
    }
  }
  return { en, lider, cambios };
}
