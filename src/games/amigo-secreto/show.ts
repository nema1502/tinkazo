import { asignarAmigos } from "./asignacion";
import { acotar } from "../pixi/kit/azar";
import { planoEntero, planoSobre } from "../pixi/kit/director";
import { PRIORIDAD } from "../pixi/kit/guion";
import type { Textos } from "../pixi/kit";
import type { Caja, Contexto, Kit, LineaGuion, Momentos, Plan, Respuestas, TipoPaso } from "../pixi/kit/tipos";

/**
 * Amigo secreto: el plan, puro.
 *
 * El show del amigo secreto: una mesa de sobres con la cara y el nombre de cada
 * uno, que se abren de a uno revelando a quién le toca regalar, y al final el
 * sobre del premio se abre con el golpe y su tarjeta queda amarilla con
 * confeti. La asignación no la elige nadie: sale del faro con el módulo puro
 * `asignacion.ts` (S2), y el ganador del premio llega ya decidido del protocolo
 * (`ctx.ganadores`, S1): el juego solo lo cuenta.
 *
 * Los tiempos: cada sobre abierto de a uno dura un golpe de show (1,2 s), con
 * el ganador al final. Con listas largas (más de diez) no se abre todo en
 * cámara: se abre un puñado de ejemplos y el resto se revela en grupo («mirá
 * tu sobre en el comprobante»), para que el show dure lo mismo con doscientas
 * que con doce.
 *
 * Además de lo que pasa, el plan declara lo que pide la regla del niño:
 * `sentido` (derecha: la revelación avanza por la mesa), `marcador(t)` (el
 * único contador: los sobres que quedan por abrir, y llega a 1 con el golpe),
 * `respuestas(t)` (todos siguen en juego: nadie sale), `hecho` en las líneas
 * del guion y `meta` (el sobre que se está abriendo).
 */

export interface Datos {
  n: number;
  /** Quien gana el premio: su puesto en la lista. Su sobre es el último, y se abre con el golpe. */
  ganador: number;
  /** La asignación del faro: `asignacion[i]` es a quién le regala la persona `i`. */
  asignacion: readonly number[];
  /** El orden de la revelación, en puestos de la lista. El ganador va último. */
  orden: readonly number[];
  /** El segundo de juego en que se abre cada sobre, por puesto de la lista. El del ganador, con el golpe. */
  tiempos: readonly number[];
  /** Cuántos sobres se abren de a uno en cámara (los demás, en grupo). */
  individuales: number;
  /** El segundo en que empieza la revelación en grupo, o `null` si todos abren el suyo en cámara. */
  tGrupo: number | null;
  /** El sobre con el que compite el del premio en la tensión (nunca al ganador solo). */
  rival: number;
}

/** El tamaño de la pantalla y la franja libre entre la barra de arriba y el relator. */
export interface Pant {
  w: number;
  h: number;
  k: number;
  top: number;
  bottom: number;
}

/** Cuánto dura la presentación: la mesa entera, cada uno se busca. */
const T_PRESENTE = 3;
/** Lo que dura la apertura de cada sobre, en segundos de juego. */
const POR_SOBRE = 1.2;
/** Cuántos sobres se abren de a uno; los demás van en la revelación en grupo. */
const INDIVIDUALES_MAX = 9;
/** Lo que dura la revelación en grupo. */
const GRUPO_DUR = 2.6;
/** Lo que respira el final, desde el último sobre hasta el golpe del premio. */
const COLA = 2.2;
/** La duración más corta que un show. */
const DURACION_MIN = 8;

/* ----------------------------------------------------------- la mesa */

/** La mesa de sobres: una grilla centrada en la franja libre, con columnas que siguen el ancho. */
export interface Mesa {
  /** El centro de cada sobre, por puesto de la lista. */
  pos: { x: number; y: number }[];
  /** El lado de cada tarjeta. */
  lado: number;
  cols: number;
  filas: number;
}

export function layoutTarjetas(p: Pant, n: number): Mesa {
  const zona = Math.max(1, p.bottom - p.top);
  const cols = Math.max(1, Math.min(12, Math.ceil(Math.sqrt(n * 1.9))));
  const filas = Math.max(1, Math.ceil(n / cols));
  // El lado de cada tarjeta: lo más grande que entra en la franja, con aire de sobra.
  let lado = Math.max(8 * p.k, Math.min(170 * p.k, (p.w * 0.86) / cols, (zona * 0.86) / filas));
  let aire = Math.min(20 * p.k, lado * 0.15);
  // Si con el aire de sobra no entra toda la grilla, la tarjetas ceden un poco antes que la mesa se salga.
  const sobraW = p.w * 0.86 - (lado * cols + aire * (cols - 1));
  const sobraH = zona * 0.86 - (lado * filas + aire * (filas - 1));
  if (sobraW < 0) lado += sobraW / cols;
  if (sobraH < 0) lado += sobraH / filas;
  lado = Math.max(6 * p.k, lado);
  const pasoX = lado + aire;
  const pasoY = lado + aire;
  const x0 = p.w / 2 - ((cols - 1) * pasoX) / 2;
  const y0 = p.top + zona / 2 - ((filas - 1) * pasoY) / 2;
  const pos = Array.from({ length: n }, (_, i) => ({ x: x0 + (i % cols) * pasoX, y: y0 + Math.floor(i / cols) * pasoY }));
  return { pos, lado, cols, filas };
}

/** La caja de un sobre, centrada en su lugar de la mesa. */
export function cajaDe(p: Pant, mesa: Mesa, i: number): Caja {
  const q = mesa.pos[i] ?? { x: p.w / 2, y: (p.top + p.bottom) / 2 };
  return { x: q.x - mesa.lado / 2, y: q.y - mesa.lado / 2, w: mesa.lado, h: mesa.lado };
}

/** La caja que cubre a todas, o `null` si no hay ninguna. */
function unirCajas(cs: readonly Caja[]): Caja | null {
  if (cs.length === 0) return null;
  const x0 = Math.min(...cs.map((c) => c.x));
  const y0 = Math.min(...cs.map((c) => c.y));
  return { x: x0, y: y0, w: Math.max(...cs.map((c) => c.x + c.w)) - x0, h: Math.max(...cs.map((c) => c.y + c.h)) - y0 };
}

/* ----------------------------------------------------------- el plan */

export function planAmigo(ctx: Contexto): Plan<Datos> {
  const n = ctx.nombres.length;
  const ganador = ctx.ganadores[0] ?? 0;
  // La asignación sale del faro, del módulo puro que comparte con la verificación: nadie la elige.
  const asignacion = asignarAmigos(ctx.nombres, ctx.ronda);
  if (!asignacion) throw new Error("amigo secreto: con menos de dos personas no hay juego");

  // La historia del director de emoción: su arco da el sabor de la cámara y del foco.
  const historia = ctx.historia(Math.max(2, n), ganador % Math.max(1, n));
  const arco = historia.arc;
  // El sobre con el que compite el del premio en la tensión: uno que no sea el ganador.
  const rival = (ganador + 1) % n;

  // El orden de la revelación: todos los sobres menos el del premio, en el orden en que los trae el azar
  // sembrado de la ronda, y el del premio al final, que se abre con el golpe.
  const mesa = Array.from({ length: n }, (_, i) => i).filter((i) => i !== ganador);
  for (let i = mesa.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.rng() * (i + 1));
    [mesa[i], mesa[j]] = [mesa[j] as number, mesa[i] as number];
  }
  mesa.push(ganador);
  const orden = mesa;

  // Los tiempos: la presentación, los sobres de a uno, la revelación en grupo si hay, y el golpe.
  const individuales = Math.min(n - 1, INDIVIDUALES_MAX);
  const tUltimoIndividual = T_PRESENTE + POR_SOBRE * individuales;
  const tGrupo = individuales < n - 1 ? tUltimoIndividual + 0.6 : null;
  const finGrupo = tGrupo !== null ? tGrupo + GRUPO_DUR : tUltimoIndividual;
  const duracion = Math.max(DURACION_MIN, finGrupo + COLA);

  const tiempos = new Array<number>(n).fill(duracion);
  for (let k = 0; k < individuales; k++) tiempos[orden[k] as number] = T_PRESENTE + POR_SOBRE * (k + 1);
  if (tGrupo !== null) {
    const resto = orden.slice(individuales, -1);
    const paso = Math.min(0.25, GRUPO_DUR / Math.max(1, resto.length + 1));
    resto.forEach((i, j) => (tiempos[i] = tGrupo + 0.3 + paso * j));
  }

  const datos: Datos = { n, ganador, asignacion, orden, tiempos, individuales, tGrupo, rival };

  // Lo que dice el relator: seis palabras o menos, ningún nombre (van en los sobres) y ningún número.
  const guion: LineaGuion[] = [{ t: 0.3, texto: ctx.txt("intro"), calor: 0.15 }];
  const alternadas = ["mas", "abrirOtro"] as const;
  for (let k = 0; k < individuales; k++) {
    const t = tiempos[orden[k] as number] as number;
    const linea: LineaGuion = { t, calor: 0.35 + 0.3 * (k / Math.max(1, individuales - 1)), hacer: (kk) => kk.sonido.tono(7 + (k % 3), "evento") };
    if (k === 0) {
      linea.texto = ctx.txt("abrir");
      linea.prioridad = PRIORIDAD.importante;
      linea.hecho = { tipo: "adelante", quien: orden[0] };
    } else if ((k + 1) % 3 === 0) {
      linea.texto = ctx.txt(alternadas[Math.floor(k / 3) % 2] as string);
      linea.prioridad = PRIORIDAD.importante;
      linea.hecho = { tipo: "adelante", quien: orden[k] };
    }
    guion.push(linea);
  }
  if (tGrupo !== null) {
    guion.push({
      t: tGrupo,
      texto: ctx.txt("grupo"),
      calor: 0.55,
      prioridad: PRIORIDAD.importante,
      hecho: { tipo: "adelante", quien: orden[individuales] },
      hacer: (kk) => kk.sonido.tono(11, "evento"),
    });
  }
  guion.push({ t: duracion - 1.4, texto: ctx.txt("ultimo"), calor: 0.9, prioridad: PRIORIDAD.importante });
  // El tic de la presentación: la sala se busca en la mesa.
  [1.0, 1.7, 2.4].forEach((t, i) => guion.push({ t, hacer: (kk) => kk.sonido.tic(i) }));
  guion.sort((x, y) => x.t - y.t);

  // El único contador: los sobres que quedan por abrir, y con el golpe queda 1 (el del premio, que se abre).
  const aberturas = orden.slice(0, -1).map((i) => tiempos[i] as number);
  const marcador = (t: number): number => Math.max(1, n - aberturas.filter((s) => s <= t).length);

  // Lo que pasó, para la prueba del niño: empezó, se abrió un sobre, ganó el premio.
  const eventos: { desde: number; tipo: TipoPaso; quien?: number }[] = [
    { desde: 0, tipo: "empezo" },
    ...orden.slice(0, -1).map((i) => ({ desde: tiempos[i] as number, tipo: "adelante" as const, quien: i })),
    { desde: duracion, tipo: "gano", quien: ganador },
  ];
  eventos.sort((x, y) => x.desde - y.desde);

  /** Quiénes siguen (todos: nadie sale del juego), hacia dónde, cuánto falta y qué acaba de pasar, en el segundo `t`. */
  const respuestas = (t: number): Respuestas => {
    const ult = eventos.filter((e) => e.desde <= t).at(-1) ?? (eventos[0] as (typeof eventos)[number]);
    const abiertos = aberturas.filter((s) => s <= t).length + (t >= duracion ? 1 : 0);
    return {
      adelante: { quienes: Array.from({ length: n }, (_, i) => i), lugar: "centro" },
      hacia: "derecha",
      progreso: acotar(abiertos / n, 0, 1),
      progresoVisible: true,
      paso: { tipo: ult.tipo, quien: ult.quien, desde: ult.desde },
    };
  };

  const mesaPant = (k: Kit): Mesa => layoutTarjetas(k.pantalla(), n);
  const cajasDeOrden = (k: Kit, t: number): Caja[] => {
    const m = mesaPant(k);
    const p = k.pantalla();
    // La apertura actual y las dos que siguen: la cámara viaja con la revelación, nunca con el ganador solo.
    const actual = orden.findIndex((i) => (tiempos[i] as number) > t);
    const desde = actual === -1 ? orden.length - 1 : actual;
    return orden.slice(Math.max(0, desde), Math.max(0, desde) + 3).map((i) => cajaDe(p, m, i));
  };

  const momentos: Momentos = {
    // La mesa entera mientras cada uno se busca.
    presentacion: {
      hasta: T_PRESENTE,
      toma: planoEntero((k) => {
        const p = k.pantalla();
        const m = mesaPant(k);
        const c = unirCajas(Array.from({ length: n }, (_, i) => cajaDe(p, m, i))) as Caja;
        return { x: c.x - 30 * p.k, y: c.y - 30 * p.k, w: c.w + 60 * p.k, h: c.h + 60 * p.k };
      }),
    },
    // La revelación: la cámara sigue la fila de sobres que se van abriendo.
    tomas: [
      {
        desde: T_PRESENTE,
        toma: (k, t) =>
          planoSobre((kk, tt) => cajasDeOrden(kk, tt), { margen: 46 * k.pantalla().k, zoomMax: 1.35 })(k, t),
      },
    ],
    // La tensión: el sobre del premio y su vecino, nunca el del premio solo.
    tension: {
      desde: Math.max(T_PRESENTE, duracion - COLA),
      toma: (k) => {
        const p = k.pantalla();
        const m = mesaPant(k);
        return planoSobre(() => [cajaDe(p, m, ganador), cajaDe(p, m, rival)], { margen: 56 * p.k, zoomMax: 1.45 })(k, duracion);
      },
    },
    // El sobre que se está abriendo: la meta en todo cuadro.
    meta: (k, t) => {
      const p = k.pantalla();
      const m = mesaPant(k);
      if (k.coronado || t >= duracion) return cajaDe(p, m, ganador);
      const actual = orden.find((i) => (tiempos[i] as number) > t) ?? ganador;
      return cajaDe(p, m, actual);
    },
    // Dónde está el sobre del premio en la pantalla: el foco y el cartel lo cuidan.
    foco: (k) => {
      const p = k.pantalla();
      const m = mesaPant(k);
      const c = m.pos[ganador] ?? { x: p.w / 2, y: (p.top + p.bottom) / 2 };
      const s = k.cam.toScreen(c.x, c.y, p.w, p.h);
      const r = Math.max(8, m.lado * 0.75);
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
    marcas: { amigo: `${n}/${individuales}` },
    datos,
  };
}

/* ----------------------------------------------------------- los textos */

/**
 * Lo que dice el relator de Amigo secreto, en los dos idiomas. Viven acá y no
 * en el diccionario del sitio para que el juego viaje solo. La regla del niño:
 * seis palabras o menos, ningún nombre (los nombres van en los sobres) y
 * ningún número (van en el marcador).
 */
export const TEXTOS = {
  es: {
    intro: "¡Amigo secreto!",
    abrir: "¡Se abre el primer sobre!",
    mas: "¡Otro sobre abierto!",
    abrirOtro: "¡Cada uno mira su sobre!",
    grupo: "Mirá tu sobre en el comprobante.",
    ultimo: "¡El último sobre!",
    marcadorQuedan: "SOBRES",
    marcadorDe: "DE",
  },
  en: {
    intro: "Secret friend, live!",
    abrir: "The first envelope opens!",
    mas: "Another envelope open!",
    abrirOtro: "Everyone checks their envelope!",
    grupo: "Check your envelope in the receipt.",
    ultimo: "The last envelope!",
    marcadorQuedan: "ENVELOPES",
    marcadorDe: "OF",
  },
} satisfies Textos;
