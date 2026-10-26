import { acotar } from "./kit/azar";
import { planoEntero, planoSobre } from "./kit/director";
import { PRIORIDAD } from "./kit/guion";
import type { Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas } from "./kit/tipos";

/**
 * __NOMBRE__: el plan, puro.
 *
 * De la lista y la ronda sale todo lo que va a pasar y cuándo: quiénes llegan en
 * cada tanda, quiénes quedan en la mesa final, qué dice el relator y adónde
 * mira la cámara. Nada de esto decide quién gana: el ganador llega dado
 * (`ctx.ganadores`) y el plan solo lo cuenta. Sin DOM, sin reloj y sin
 * `Math.random`: la misma ronda cuenta lo mismo en cualquier equipo, y se
 * prueba en Node (`__ID__-plan.test.ts`).
 *
 * Además de lo que pasa, el plan declara lo que pide la regla del niño (26 de
 * octubre de 2026): cualquier cuadro, sin leer, dice quién va adelante, hacia
 * dónde van, cuánto falta y qué acaba de pasar.
 *
 * - `sentido`: un solo sentido de avance por juego, de principio a fin.
 * - `marcador(t)`: el único contador, arriba a la izquierda (lo dibuja el kit).
 * - `respuestas(t)`: la verdad en cada segundo, para `audit-nino`.
 * - `hecho` en las líneas del guion: lo que la línea cuenta, que el cuerpo
 *   tiene que mostrar a los 0,3 s.
 * - `meta`: la llegada, la flecha o la tiza, si tu juego la tiene.
 *
 * Este plan es el punto de partida que escribió `nuevo-juego.mjs`: los nombres
 * llegan a la mesa de a ocho (para que cada uno se busque), quedan los
 * finalistas y gana quien salió del sorteo. Cambialo por el giro de tu juego.
 */
export interface Datos {
  n: number;
  /** Quien gana el primer premio: su puesto en la lista. */
  ganador: number;
  /** La mesa final: quienes ganan, la rival de la historia y algunos más, en el orden de la lista. */
  finalistas: number[];
  /** Cuántas tandas de nombres hay antes de la mesa final. */
  tandas: number;
  /** Entre qué segundos de juego van las tandas. */
  tTandas: [number, number];
  /** Cuándo queda la mesa final. */
  tFinal: number;
}

/** Hasta cuándo se ve la mesa entera. */
const T_PRESENTACION = 3;
const T_ARRANCA = 0.8;
const POR_TANDA = 4.5;
/** Lo que dura la mesa final antes de coronar. */
const T_MESA_FINAL = 7;

/** El tamaño de la pantalla y la franja libre entre la barra de arriba y el relator. */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

/**
 * Quiénes están en la mesa en el segundo `t`: de a ocho por tanda, repartidos
 * por toda la lista. Con más de treinta y dos se ve una muestra de cada tanda:
 * una figura nunca baja de su tamaño para que entren todas.
 */
export function tandaDe(n: number, t: number, t0: number, t1: number): number[] {
  if (n <= 0 || t < t0 || t >= t1) return [];
  const B = acotar(Math.ceil(n / 8), 1, 4);
  const b = Math.min(B - 1, Math.floor(((t - t0) / (t1 - t0)) * B));
  return Array.from({ length: n }, (_, i) => i).filter((i) => i % B === b).slice(0, 8);
}

/**
 * Dónde se sienta cada uno de los `m` que se ven a la vez: una grilla centrada
 * en la franja libre. Apaisada, hasta tres columnas; en un celular parado, una
 * sola, para que ningún nombre se corte.
 */
export function lugares(p: Pant, m: number): { x: number; y: number }[] {
  const cols = p.w > p.h * 1.1 ? Math.max(1, Math.min(m, 3)) : 1;
  const filas = Math.max(1, Math.ceil(m / cols));
  const alto = p.bottom - p.top;
  // Cada figura mide lo que pide la regla (`tamanoMinimoFigura`) y lleva su nombre al lado: 92 de alto y 440 de ancho, en unidades de diseño.
  const paso = Math.min(alto / filas, 92 * p.k);
  const ancho = Math.min((p.w * 0.94) / cols, 440 * p.k);
  return Array.from({ length: m }, (_, i) => ({
    x: p.w / 2 + ((i % cols) - (cols - 1) / 2) * ancho,
    y: (p.top + p.bottom) / 2 + (Math.floor(i / cols) - (filas - 1) / 2) * paso,
  }));
}

/** Lo que ocupa un nombre en la mesa, para encuadrarlo. */
const cajaDe = (p: Pant, c: { x: number; y: number }): Caja => {
  // Nunca más ancha que la pantalla: en un celular parado la meta no tiene que alejar la cámara.
  const w = Math.min(440 * p.k, p.w * 0.96);
  return { x: c.x - w / 2, y: c.y - 46 * p.k, w, h: 92 * p.k };
};

/** La caja que cubre a la mesa final entera. */
function cajaDeLaMesaFinal(p: Pant, m: number): Caja {
  const cs = lugares(p, m).map((c) => cajaDe(p, c));
  const x0 = Math.min(...cs.map((c) => c.x));
  const y0 = Math.min(...cs.map((c) => c.y));
  return { x: x0, y: y0, w: Math.max(...cs.map((c) => c.x + c.w)) - x0, h: Math.max(...cs.map((c) => c.y + c.h)) - y0 };
}

export function plan__CAP__(ctx: Contexto): Plan<Datos> {
  const n = ctx.nombres.length;
  const ganador = ctx.ganadores[0] ?? 0;
  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  // El plan la pide acá, antes de gastar el azar en otra cosa: así el orden es siempre el mismo.
  const historia = ctx.historia(Math.max(2, n), ganador % Math.max(2, n));

  // La mesa final: quienes ganan, la rival y algunos más, repartidos por el azar de la ronda.
  const quedan = new Set<number>(ctx.ganadores.slice(0, 6));
  quedan.add(historia.rival % Math.max(1, n));
  const otros = Array.from({ length: n }, (_, i) => i).filter((i) => !quedan.has(i));
  for (let i = otros.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [otros[i], otros[j]] = [otros[j] as number, otros[i] as number];
  }
  const meta = Math.min(n, Math.max(4, quedan.size));
  for (const i of otros) {
    if (quedan.size >= meta) break;
    quedan.add(i);
  }
  const finalistas = [...quedan].sort((a, b) => a - b);

  const tandas = acotar(Math.ceil(n / 8), 1, 4);
  const t1 = T_ARRANCA + tandas * POR_TANDA;
  const duracion = t1 + T_MESA_FINAL;
  /** El primero de cada tanda: a quien la línea de la tanda señala. */
  const primeroDe = (i: number): number => tandaDe(n, T_ARRANCA + i * POR_TANDA + 0.01, T_ARRANCA, t1)[0] ?? 0;

  // Lo que dice el relator: seis palabras o menos, un nombre y ningún número (los números van en el marcador).
  const guion: LineaGuion[] = [{ t: 0.3, texto: ctx.txt("intro"), calor: 0.15 }];
  for (let i = 0; i < tandas; i++) {
    const t = T_ARRANCA + i * POR_TANDA;
    guion.push({ t, texto: ctx.txt("tanda"), calor: 0.2 + 0.2 * (i / tandas), hecho: { tipo: "adelante", quien: primeroDe(i) }, hacer: (k) => k.sonido.escalera([7, 8, 9], 70) });
    guion.push({ t: t + 2.3, texto: ctx.txt("busquen"), calor: 0.3 });
  }
  // Un sonido suave cada segundo y medio: la sala nunca espera cuatro segundos en silencio.
  for (let j = 0; T_ARRANCA + j * 1.5 < t1 - 0.2; j++) guion.push({ t: T_ARRANCA + 0.7 + j * 1.5, hacer: (k) => k.sonido.tono(7 + (j % 3), "fondo") });
  guion.push({ t: t1, texto: ctx.txt("final"), calor: 0.6, prioridad: PRIORIDAD.importante, hecho: { tipo: "adelante", quien: finalistas[0] }, hacer: (k) => k.sonido.tono(10, "evento") });
  guion.push({ t: t1 + 3.2, texto: ctx.txt("suspenso"), calor: 0.75 });
  guion.push({ t: duracion - 1.6, texto: ctx.txt("ultima"), calor: 0.9 });
  // El tic de la mesa final, como un reloj de cocina: da el pulso sin señalar a nadie.
  for (let j = 0; t1 + 0.6 + j * 0.5 < duracion - 0.3; j++) guion.push({ t: t1 + 0.6 + j * 0.5, hacer: (k) => k.sonido.tic(j) });

  // El único contador, arriba a la izquierda (lo dibuja el kit): todos hasta que se arma la mesa final, después los
  // finalistas, y 1 con el golpe. Pasar lista no es eliminar: si tu juego saca a la gente de a uno, que baje de a uno.
  const marcador = (t: number): number => (t >= duracion ? 1 : t >= t1 ? finalistas.length : n);

  // Lo que pasó, para la prueba del niño: empezó, llegó una tanda, quedó la mesa final, ganó.
  const eventos: { desde: number; tipo: "empezo" | "adelante" | "gano"; quien?: number }[] = [{ desde: 0, tipo: "empezo" }];
  for (let i = 0; i < tandas; i++) eventos.push({ desde: T_ARRANCA + i * POR_TANDA, tipo: "adelante", quien: primeroDe(i) });
  eventos.push({ desde: t1, tipo: "adelante", quien: finalistas[0] }, { desde: duracion, tipo: "gano", quien: ganador });

  /** Quién va adelante, hacia dónde, cuánto falta y qué acaba de pasar, en el segundo `t`. */
  const respuestas = (t: number): Respuestas => {
    const ult = [...eventos].filter((e) => e.desde <= t).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    const quienes = t >= duracion ? [ganador] : t >= t1 ? finalistas : tandaDe(n, Math.max(t, T_ARRANCA), T_ARRANCA, t1);
    return {
      adelante: { quienes, lugar: "centro" },
      hacia: "centro",
      progreso: acotar(t / duracion, 0, 1),
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  const mundo = (k: Kit): Caja => {
    const p = k.pantalla();
    return { x: 0, y: p.top, w: p.w, h: p.bottom - p.top };
  };
  const momentos: Momentos = {
    // Plano entero mientras cada uno se busca.
    presentacion: { hasta: T_PRESENTACION, toma: planoEntero(mundo) },
    // La tensión mira a la mesa final entera: nunca a quien gana solo, que lo delataría.
    tension: {
      desde: t1,
      toma: planoSobre((k) => lugares(k.pantalla(), finalistas.length).map((c) => cajaDe(k.pantalla(), c)), { margen: 24, zoomMax: 1.5 }),
    },
    // La meta de este juego es la mesa final: ninguna toma la suelta. En una carrera sería la llegada.
    meta: (k) => cajaDeLaMesaFinal(k.pantalla(), finalistas.length),
    // Dónde está quien gana en la pantalla: el foco se enciende ahí, y el cartel nunca queda encima.
    foco: (k) => {
      const p = k.pantalla();
      const c = lugares(p, finalistas.length)[finalistas.indexOf(ganador)] ?? { x: p.w / 2, y: (p.top + p.bottom) / 2 };
      const s = k.cam.toScreen(c.x, c.y, p.w, p.h);
      const z = Math.max(0.3, k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x);
      return { x: s.x, y: s.y, r: 44 * p.k * z };
    },
  };

  return {
    duracion,
    arco: historia.arc,
    sentido: "centro",
    marcador,
    respuestas,
    momentos,
    guion,
    marcas: { __ID__: `${n}/${finalistas.length}` },
    datos: { n, ganador, finalistas, tandas, tTandas: [T_ARRANCA, t1], tFinal: t1 },
  };
}
