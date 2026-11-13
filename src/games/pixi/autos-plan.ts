import { acotar } from "./kit/azar";
import { planoEntero, planoSobre } from "./kit/director";
import { PRIORIDAD } from "./kit/guion";
import { marcadorPorSalidas } from "./kit/marcador";
import type { Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas, TipoPaso } from "./kit/tipos";

/**
 * Carrera de autos: el plan, puro.
 *
 * Una carrera de costado, de izquierda a derecha. De la lista y la ronda sale
 * todo lo que va a pasar y cuándo: en qué carril larga cada auto, en qué ola
 * cae cada uno (en un hoyo o bajo una roca), cuándo la roca roza a quien gana,
 * qué dice el relator y adónde mira la cámara. Nada de esto decide quién gana:
 * el ganador llega dado (`ctx.ganadores`) y es el único que cruza la meta. Sin
 * DOM, sin reloj y sin `Math.random`: la misma ronda cuenta lo mismo en
 * cualquier equipo, y se prueba en Node (`autos-plan.test.ts`).
 *
 * Las reglas de los peligros (`docs/juegos/autos.md`):
 *
 * - Las rocas caen sobre cualquiera, también sobre quien gana: a quien gana la
 *   roca del susto lo roza y sigue (`susto`), y roza también a otros para que
 *   sobrevivir no delate a nadie.
 * - Los hoyos se abren bajo cualquiera menos bajo quien gana: quien gana nunca
 *   es víctima de ninguna ola.
 * - Las caídas van en olas (hasta ocho), separadas por más de un segundo; con
 *   dos olas o más hay de los dos tipos; la rival de la historia cae última.
 *
 * Además de lo que pasa, el plan declara lo que pide la regla del niño:
 * `sentido` (derecha, de principio a fin), `marcador(t)` (baja con cada ola y
 * llega a 1 con el golpe), `respuestas(t)` (adelante es seguir en carrera),
 * `hecho` en las líneas del guion y `meta` (la cinta del camino alrededor del
 * pelotón).
 */
export type Peligro = "hoyo" | "roca";

/** Una ola: un hoyo que se abre o una roca que cae, y quiénes quedan en el camino. */
export interface Ola {
  /** El segundo de juego en que caen. */
  t: number;
  tipo: Peligro;
  /** Quiénes caen, por su puesto en la lista. El primero es a quien señala la línea del relator. */
  victimas: number[];
}

export interface Datos {
  n: number;
  /** Quien gana el primer premio: su puesto en la lista. Es el único que cruza la meta. */
  ganador: number;
  /** La rival de la historia: cae última, en la última ola. */
  rival: number;
  /** El segundo de juego en que largan. */
  tLargada: number;
  /** El segundo de juego en que quien gana cruza la meta (`plan.duracion`). */
  duracion: number;
  /** Las olas, en orden: cada uno de los que no ganan cae en una sola. */
  olas: Ola[];
  /** La roca que roza y no aplasta: a quien gana y a cero, uno o dos más que siguen en carrera. */
  susto: { t: number; rozados: number[] };
  /** Cuántos carriles tiene la ruta: uno por auto, hasta ocho. */
  carriles: number;
  /** El carril de cada persona. */
  carril: number[];
  /** Cuánto se adelanta (o se atrasa) cada auto, en fracción de la ruta: dos del mismo carril nunca van pegados. */
  ventaja: number[];
}

/** El tamaño de la pantalla y la franja libre entre la barra de arriba y el relator. */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

/** Los tres segundos de la grilla: cada uno se busca antes de la largada. */
const T_LARGADA = 3;
/** Lo que separa una ola de la siguiente, como mínimo: la roca del susto entra en el medio sin pisar a ninguna. */
const ENTRE_OLAS = 2.8;
/** Hasta cuántas olas: con más gente, las olas se llevan a varios. */
const OLAS_MAX = 8;
const CARRILES_MAX = 8;
/** Lo más que un auto se adelanta o se atrasa del pelotón, en fracción de la ruta. */
const VENTAJA_MAX = 0.05;

/** En qué segundo sale del juego la persona `i`; `null` para quien gana (y para quien no cae en ninguna ola). */
export function salidaDe(d: Datos, i: number): number | null {
  for (const o of d.olas) if (o.victimas.includes(i)) return o.t;
  return null;
}

/** Quiénes siguen en carrera en el segundo `t`, en el orden de la lista. */
export function vivos(d: Datos, t: number): number[] {
  return Array.from({ length: d.n }, (_, i) => i).filter((i) => {
    const s = salidaDe(d, i);
    return s === null || t < s;
  });
}

/**
 * Cuánto recorrió el auto `i` en el segundo `t`, de 0 (la grilla) a 1 (la meta).
 * Todos avanzan con el reloj de la carrera; la ventaja de cada uno entra de a poco
 * después de la largada y se achica al llegar, así quien gana pisa la meta justo
 * con el golpe. Nunca retrocede: la rampa de la ventaja es lo bastante larga para
 * que el más atrasado no frene. Quien cae se queda donde cayó.
 */
export function avanceDe(d: Datos, i: number, t: number): number {
  const s = salidaDe(d, i);
  const u = s === null ? t : Math.min(t, s);
  const largo = Math.max(1e-6, d.duracion - d.tLargada);
  const base = acotar((u - d.tLargada) / largo, 0, 1);
  const rampa = Math.max(2, 0.1 * largo);
  const entra = acotar((u - d.tLargada) / rampa, 0, 1);
  return acotar(base + (d.ventaja[i] ?? 0) * entra * (1 - base), 0, 1);
}

/** La ruta en el mundo: de la grilla (`x0`) a la meta (`x1`), y la franja de los carriles, con un margen. */
export function pista(p: Pant): { x0: number; x1: number; y0: number; y1: number } {
  const x0 = 0.12 * p.w;
  const alto = p.bottom - p.top;
  return { x0, x1: x0 + 3.2 * p.w, y0: p.top + 0.08 * alto, y1: p.bottom - 0.08 * alto };
}

/** Dónde va el auto `i` en el segundo `t`, en el mundo: avanza por su carril, que no cambia. */
export function posicionDe(p: Pant, d: Datos, i: number, t: number): { x: number; y: number } {
  const r = pista(p);
  const c = d.carril[i] ?? 0;
  const carriles = Math.max(1, d.carriles);
  return {
    x: r.x0 + avanceDe(d, i, t) * (r.x1 - r.x0),
    y: r.y0 + ((r.y1 - r.y0) * (c + 0.5)) / carriles,
  };
}

/** Lo que ocupa un auto, centrado en su posición, para encuadrarlo. */
export function cajaDeAuto(p: Pant, pos: { x: number; y: number }): Caja {
  return { x: pos.x - 48 * p.k, y: pos.y - 24 * p.k, w: 96 * p.k, h: 48 * p.k };
}

/** La caja que cubre a todas, o `null` si no hay ninguna. */
function unirCajas(cs: readonly Caja[]): Caja | null {
  if (cs.length === 0) return null;
  const x0 = Math.min(...cs.map((c) => c.x));
  const y0 = Math.min(...cs.map((c) => c.y));
  return { x: x0, y: y0, w: Math.max(...cs.map((c) => c.x + c.w)) - x0, h: Math.max(...cs.map((c) => c.y + c.h)) - y0 };
}

/** Mezcla en el lugar con el azar de la ronda (Fisher-Yates). */
function mezclar<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
  }
  return xs;
}

export function planAutos(ctx: Contexto): Plan<Datos> {
  const n = ctx.nombres.length;
  const ganador = ctx.ganadores[0] ?? 0;
  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  // El plan la pide acá, antes de gastar el azar en otra cosa: así el orden es siempre el mismo.
  const actores = Math.max(2, n);
  const historia = ctx.historia(actores, ganador % actores);
  const arco = historia.arc;
  // La rival es un puesto de la lista que no es quien gana; si choca (o se sale), la siguiente.
  let rival = historia.rival % Math.max(1, n);
  if (rival === ganador && n > 1) rival = (rival + 1) % n;

  // Las víctimas: todos menos quien gana, mezclados, con la rival al final.
  const victimas = mezclar(
    Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador && i !== rival),
    ctx.rng,
  );
  if (rival !== ganador) victimas.push(rival);

  // Las olas: hasta ocho, repartidas lo más parejo posible, las más grandes primero.
  const W = Math.max(1, Math.min(victimas.length, OLAS_MAX));
  const tamanos = Array.from({ length: W }, (_, i) => Math.floor(victimas.length / W) + (i < victimas.length % W ? 1 : 0));
  // Cada ola, un hoyo o una roca. La última es la del momento que hace gritar: el hoyo bajo la rival a metros
  // de la meta, salvo en la tapada, donde caen juntos bajo la última roca. Con dos olas o más, de los dos tipos.
  const tipos: Peligro[] = tamanos.map(() => (ctx.rng() < 0.5 ? "hoyo" : "roca"));
  tipos[W - 1] = arco === "tapada" ? "roca" : "hoyo";
  if (W >= 2 && tipos.every((x) => x === tipos[0])) tipos[0] = tipos[0] === "hoyo" ? "roca" : "hoyo";

  // Los tiempos: la largada, las olas parejas entre la primera recta y la última, y la meta con el golpe.
  const tLargada = T_LARGADA;
  const duracion = Math.max(12, tLargada + 3 + W * ENTRE_OLAS + 3);
  const a = tLargada + 3;
  const b = duracion - 3;
  const espacio = (b - a) / W;
  let usadas = 0;
  const olas: Ola[] = tamanos.map((m, i) => {
    const o = { t: a + (b - a) * ((i + 0.5) / W), tipo: tipos[i] as Peligro, victimas: victimas.slice(usadas, usadas + m) };
    usadas += m;
    return o;
  });

  // Los carriles y la ventaja de cada uno: en cada carril, puestos parejos de atrás para adelante, mezclados,
  // así dos autos del mismo carril nunca van pegados. Un auto solo en su carril larga donde le toque.
  const carriles = Math.max(1, Math.min(n, CARRILES_MAX));
  const carril = Array.from({ length: n }, (_, i) => i % carriles);
  const ventaja = new Array<number>(n).fill(0);
  for (let c = 0; c < carriles; c++) {
    const suyos = carril.flatMap((x, i) => (x === c ? [i] : []));
    const m = suyos.length;
    const puestos =
      m === 1
        ? [(ctx.rng() * 2 - 1) * VENTAJA_MAX * 0.75]
        : mezclar(
            Array.from({ length: m }, (_, j) => -VENTAJA_MAX + (2 * VENTAJA_MAX * j) / (m - 1)),
            ctx.rng,
          );
    suyos.forEach((i, j) => (ventaja[i] = puestos[j] ?? 0));
    // El giro del arco: en la remontada quien gana larga atrás de su carril; en el susto, adelante.
    if (suyos.includes(ganador) && (arco === "remontada" || arco === "susto")) {
      const objetivo = arco === "remontada" ? Math.min(...suyos.map((i) => ventaja[i] ?? 0)) : Math.max(...suyos.map((i) => ventaja[i] ?? 0));
      const otro = suyos.find((i) => ventaja[i] === objetivo);
      if (m === 1) ventaja[ganador] = (arco === "remontada" ? -1 : 1) * VENTAJA_MAX * 0.85;
      else if (otro !== undefined && otro !== ganador) [ventaja[otro], ventaja[ganador]] = [ventaja[ganador] ?? 0, objetivo];
    }
  }

  // El susto: una roca entre dos olas, a la mitad de la carrera, que roza a quien gana y a cero, uno o dos más.
  const j = Math.floor((W - 1) / 2);
  const tSusto = Math.max(tLargada + 1.5, (olas[j]?.t ?? a) - espacio / 2);
  const datosParciales = { n, olas } as Pick<Datos, "n" | "olas">;
  const cerca = new Set(olas.filter((o) => Math.abs(o.t - tSusto) < 1).flatMap((o) => o.victimas));
  const candidatos = mezclar(
    vivos(datosParciales as Datos, tSusto).filter((i) => i !== ganador && !cerca.has(i)),
    ctx.rng,
  );
  const rozados = [ganador, ...candidatos.slice(0, Math.floor(ctx.rng() * 3))];

  const datos: Datos = { n, ganador, rival, tLargada, duracion, olas, susto: { t: tSusto, rozados }, carriles, carril, ventaja };

  // Lo que dice el relator: seis palabras o menos, ningún nombre (van sobre los autos) y ningún número.
  const guion: LineaGuion[] = [
    { t: 0.3, texto: ctx.txt("intro"), calor: 0.15 },
    { t: 1.4, texto: ctx.txt("motores"), calor: 0.2, hacer: (k) => k.sonido.escalera([5, 7, 9], 80) },
    { t: tLargada, texto: ctx.txt("largaron"), calor: 0.3, prioridad: PRIORIDAD.importante, hacer: (k) => k.sonido.escalera([9, 11, 13], 60) },
  ];
  // La cuenta de la grilla, como un semáforo: tres tics antes de la largada.
  [1.0, 1.7, 2.4].forEach((t, i) => guion.push({ t, hacer: (k) => k.sonido.tic(i) }));
  olas.forEach((o, i) => {
    guion.push({
      t: o.t,
      texto: ctx.txt(o.tipo),
      calor: 0.4 + (0.45 * i) / Math.max(1, W - 1),
      prioridad: PRIORIDAD.importante,
      hecho: { tipo: "salio", quien: o.victimas[0] },
      hacer: (k) => k.sonido.salida(),
    });
  });
  guion.push({
    t: tSusto,
    texto: ctx.txt("esquiven"),
    calor: 0.6,
    prioridad: PRIORIDAD.importante,
    hecho: { tipo: "casi", quien: ganador },
    hacer: (k) => k.sonido.tono(14, "evento"),
  });
  const ultima = olas.at(-1) as Ola;
  guion.push({ t: ultima.t - 1.4, texto: ctx.txt("recta"), calor: 0.8 });
  guion.push({ t: duracion - 1.0, texto: ctx.txt("meta"), calor: 0.95 });
  // Las frases de relleno van solo donde no pisan a otra: así la cola no tira ninguna.
  const libre = (t: number): boolean => guion.every((l) => l.texto === undefined || Math.abs(l.t - t) >= 0.8);
  if (libre(tLargada + 1.8)) guion.push({ t: tLargada + 1.8, texto: ctx.txt("fondo"), calor: 0.35 });
  for (const o of olas) if (libre(o.t + 1.3)) guion.push({ t: o.t + 1.3, texto: ctx.txt("queda"), calor: 0.5 });
  // El motor, cada segundo y medio: la sala nunca espera en silencio.
  for (let m = 0; tLargada + 0.7 + m * 1.5 <= duracion - 0.3; m++) {
    guion.push({ t: tLargada + 0.7 + m * 1.5, hacer: (k) => k.sonido.tono(4 + (m % 2), "fondo") });
  }
  guion.sort((x, y) => x.t - y.t);

  // El único contador, arriba a la izquierda (lo dibuja el kit): baja con cada ola, de a tantos como caen, y
  // llega a 1 con el golpe.
  const marcador = marcadorPorSalidas(
    n,
    olas.flatMap((o) => o.victimas.map(() => o.t)),
    duracion,
  );

  // Lo que pasó, para la prueba del niño: largaron, cayó una ola, la roca rozó a quien gana, ganó.
  const eventos: { desde: number; tipo: TipoPaso; quien?: number }[] = [
    { desde: 0, tipo: "empezo" },
    ...olas.map((o) => ({ desde: o.t, tipo: "salio" as const, quien: o.victimas[0] })),
    { desde: tSusto, tipo: "casi", quien: ganador },
    { desde: duracion, tipo: "gano", quien: ganador },
  ];
  eventos.sort((x, y) => x.desde - y.desde);

  /** Quién va adelante (los que siguen en carrera), hacia dónde, cuánto falta y qué acaba de pasar, en el segundo `t`. */
  const respuestas = (t: number): Respuestas => {
    const ult = eventos.filter((e) => e.desde <= t).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    return {
      adelante: { quienes: t >= duracion ? [ganador] : vivos(datos, t), lugar: "centro" },
      hacia: "derecha",
      progreso: avanceDe(datos, ganador, t),
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  /** Las cajas de los autos que siguen en carrera en el segundo `t` (al menos la de quien gana). */
  const cajasVivas = (p: Pant, t: number): Caja[] => {
    const v = vivos(datos, t);
    return (v.length ? v : [ganador]).map((i) => cajaDeAuto(p, posicionDe(p, datos, i, t)));
  };

  const momentos: Momentos = {
    // Plano entero de la grilla mientras cada uno se busca.
    presentacion: {
      hasta: tLargada,
      toma: planoEntero((k) => {
        const p = k.pantalla();
        const c = unirCajas(Array.from({ length: n }, (_, i) => cajaDeAuto(p, posicionDe(p, datos, i, tLargada)))) as Caja;
        return { x: c.x - 40 * p.k, y: c.y - 40 * p.k, w: c.w + 80 * p.k, h: c.h + 80 * p.k };
      }),
    },
    // Durante la carrera, la cámara sigue al pelotón de los que siguen.
    tomas: [
      {
        desde: tLargada,
        toma: (k, t) => planoSobre((kk, tt) => cajasVivas(kk.pantalla(), tt), { margen: 60 * k.pantalla().k, zoomMax: 1.3 })(k, t),
      },
    ],
    // La tensión mira a quien gana y a la rival (o a su hoyo): nunca a quien gana solo, que lo delataría.
    tension: {
      desde: ultima.t - 1.5,
      toma: (k, t) => {
        const p = k.pantalla();
        return planoSobre(() => [cajaDeAuto(p, posicionDe(p, datos, ganador, t)), cajaDeAuto(p, posicionDe(p, datos, rival, t))], {
          margen: 70 * p.k,
          zoomMax: 1.4,
        })(k, t);
      },
    },
    // La cinta del camino alrededor del pelotón: el ancho de la ruta donde van los autos, nunca más que la pantalla.
    meta: (k, t) => {
      const p = k.pantalla();
      const r = pista(p);
      const c = unirCajas(cajasVivas(p, t)) as Caja;
      let x = c.x - 30 * p.k;
      let w = c.w + 60 * p.k;
      if (w > 0.9 * p.w) {
        // Demasiado ancha: se queda con la punta, donde va el líder.
        x = x + w - 0.9 * p.w;
        w = 0.9 * p.w;
      }
      return { x, y: r.y0, w, h: r.y1 - r.y0 };
    },
    // Dónde está quien gana en la pantalla: el foco se enciende ahí, y el cartel nunca queda encima.
    foco: (k) => {
      const p = k.pantalla();
      const t = Number.isFinite(k.t) ? k.t : duracion;
      const c = posicionDe(p, datos, ganador, t);
      const s = k.cam.toScreen(c.x, c.y, p.w, p.h);
      const z = Math.max(0.3, k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x);
      const r = 40 * p.k * z;
      // La cámara sigue a quien gana al coronar; si todavía no llegó, el foco nunca sale de la pantalla.
      return { x: acotar(s.x, r, p.w - r), y: acotar(s.y, p.top, p.bottom), r };
    },
  };

  return {
    duracion,
    arco,
    sentido: "derecha",
    marcador,
    respuestas,
    momentos,
    guion,
    marcas: { autos: `${n}/${W}` },
    datos,
  };
}
