/**
 * El plan del video del sorteo, sin dibujo y sin navegador.
 *
 * Es la parte pura del prototipo del issue nema1502/tinkazo#31 («Descargar el
 * video del sorteo tal como pasó»): de una ronda (la lista, el ganador, la
 * semilla y el enlace del comprobante) a la secuencia de cuadros que hay que
 * dibujar. La misma ronda da siempre el mismo plan: el show es reproducible,
 * como el juego que narra (`docs/juegos.md`).
 *
 * Es un reencuentro propio del show, no el show real: dibuja una reencarnación
 * 2D vertical (720x1280) de la idea de todos los juegos — participantes que
 * avanzan con la tensión subiendo, el ganador que llega primero y el cierre con
 * «Verificalo vos» y el QR del comprobante. Lo que se mide con este plan es el
 * costo de volver a dibujar y codificar, no la fidelidad visual del motor.
 *
 * Las escenas: entrada (el cartel del sorteo), show (la carrera), ganador (el
 * cartel) y cierre (el QR). En total entre 20 y 30 segundos, como pide el
 * issue. No importa nada del navegador: lo prueban las pruebas de Node.
 */

/** Una ronda para el video: lo que el sorteo ya sabe de sí mismo. */
export interface RondaVideo {
  /** Quienes participan, en el orden de la lista sellada. */
  nombres: string[];
  /** Quien ganó: tiene que estar en la lista. */
  ganador: string;
  /** La semilla de la ronda: con ella el show sale igual. */
  seed: number;
  /** El enlace del comprobante: va en el QR del cierre. */
  enlace: string;
  /** El premio, o nada si no hubo. */
  premio?: string;
  /** El título del sorteo, o el de siempre si no tiene. */
  titulo?: string;
}

/** Vertical, como lo quiere WhatsApp: 720x1280. */
export const ANCHO_VIDEO = 720;
export const ALTO_VIDEO = 1280;
/** 30 cuadros por segundo: el piso que un celular reproduce sin tropezar. */
export const FPS_VIDEO = 30;

/** Cuántos corren en el show, como mucho; con listas chiquitas, corren menos. */
export const CARRILES_VIDEO = 6;

/** Las escenas del video, con sus segundos: 27 en total. «cartel» es el cartel del que ganó. */
export const SEGUNDOS_ESCENA = { entrada: 3, show: 14, cartel: 4, cierre: 6 } as const;

export type IdEscena = keyof typeof SEGUNDOS_ESCENA;

export interface EscenaPlan {
  id: IdEscena;
  /** El cuadro en que empieza, contando desde 0. */
  desde: number;
  segundos: number;
  cuadros: number;
}

/** Lo que toca dibujar en un cuadro del show. */
export interface CuadroShow {
  /** La fracción de carrera: 0 largada, 1 meta. */
  q: number;
  /** Cuánto avanzó cada carril, de 0 a 1. El carril 0 es el ganador. */
  posiciones: number[];
  /** La tensión del momento, de 0 a 1: la que mueve la música y la pantalla. */
  tension: number;
}

export interface PlanVideo {
  ronda: RondaVideo;
  ancho: number;
  alto: number;
  fps: number;
  /** Cuántos carriles corren, y qué participante va en cada uno (índice en `nombres`). El carril 0 es el ganador. */
  carriles: number;
  laneDe: number[];
  escenas: EscenaPlan[];
  /** Cuadros en total, y cuánto dura: la suma de las escenas. */
  cuadros: number;
  segundos: number;
  /** Un dato por cuadro de la escena del show, en orden. */
  show: CuadroShow[];
}

/** Un generador sembrado (mulberry32), el mismo de las pruebas del repo. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** La escena de un cuadro, o null si no está en el plan. */
export function escenaDe(p: PlanVideo, cuadro: number): { escena: EscenaPlan; local: number } | null {
  if (cuadro < 0 || cuadro >= p.cuadros) return null;
  for (const e of p.escenas) {
    if (cuadro < e.desde + e.cuadros) return { escena: e, local: cuadro - e.desde };
  }
  return null;
}

/**
 * El plan de cuadros de un sorteo. Tira si la ronda no sirve: sin nombres, con
 * un ganador que no está en la lista, o sin enlace para el QR.
 */
export function planDeShow(ronda: RondaVideo): PlanVideo {
  if (!ronda.nombres.length) throw new Error("la ronda no tiene nombres");
  if (!ronda.nombres.includes(ronda.ganador)) throw new Error("el ganador no está en la lista");
  if (!ronda.enlace) throw new Error("la ronda no tiene enlace para el QR");

  const rng = seeded(ronda.seed);
  const ganadorI = ronda.nombres.indexOf(ronda.ganador);

  // El ganador corre en el carril 0; los demás carriles salen de un orden sembrado de la lista.
  const otros = ronda.nombres.map((_, i) => i).filter((i) => i !== ganadorI);
  for (let i = otros.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [otros[i], otros[j]] = [otros[j] as number, otros[i] as number];
  }
  const carriles = Math.min(CARRILES_VIDEO, ronda.nombres.length);
  const laneDe = [ganadorI, ...otros.slice(0, carriles - 1)];

  // Cada carril tiene su paso: el ganador llega justo a 1; los demás se quedan
  // a una distancia que la semilla decide, con una cadencia propia.
  const pasos = laneDe.map((_, k) => (k === 0 ? 1 : 0.82 + rng() * 0.12));
  const cadencias = laneDe.map(() => 2 + Math.floor(rng() * 3));
  const fases = laneDe.map(() => rng() * Math.PI * 2);

  const escenas: EscenaPlan[] = [];
  let desde = 0;
  for (const [id, segundos] of Object.entries(SEGUNDOS_ESCENA) as Array<[IdEscena, number]>) {
    const cuadros = Math.round(segundos * FPS_VIDEO);
    escenas.push({ id, desde, segundos, cuadros });
    desde += cuadros;
  }
  const cuadros = desde;
  const showEscena = escenas.find((e) => e.id === "show") as EscenaPlan;

  const show: CuadroShow[] = [];
  for (let i = 0; i < showEscena.cuadros; i++) {
    const q = i / (showEscena.cuadros - 1);
    // La tensión sube con la carrera, como la música que la persigue (src/music.ts).
    const tension = Math.min(1, 0.1 + q * 0.9);
    const posiciones = laneDe.map((_, k) => {
      const base = pasos[k]! * q;
      // Un vaivén chico por carril: cada uno tropeza y remonta a su ritmo.
      const vaiven = k === 0 ? 0 : Math.sin(q * Math.PI * 2 * cadencias[k]! + fases[k]!) * 0.025;
      return Math.max(0, Math.min(1, base + vaiven));
    });
    show.push({ q, posiciones, tension });
  }

  return {
    ronda,
    ancho: ANCHO_VIDEO,
    alto: ALTO_VIDEO,
    fps: FPS_VIDEO,
    carriles,
    laneDe,
    escenas,
    cuadros,
    segundos: cuadros / FPS_VIDEO,
    show,
  };
}
